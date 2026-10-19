import type { Activity, PostType } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { notify } from '../notifications';
import { recordAction, rewardUserById, type ActionReward } from '../rewards';
import { getSettings } from '../settings';
import { resolveTownship } from '../townships';

/**
 * Komuniti: Jiran (events, help board) and Kongsi (give away, lend) share one
 * model: a post, people who respond to it, and the author confirming what
 * happened. XP is given only at that confirmation (BR4).
 */

const isStaff = (actor: Actor) => actor.role !== 'RESIDENT';

export interface PostInput {
  type: PostType;
  title: string;
  body: string;
  location?: string;
  startsAt?: Date;
  capacity?: number;
}

export async function createPost(db: Db, actor: Actor, input: PostInput) {
  if (!isStaff(actor)) requireVerifiedResident(actor);
  if (input.type === 'EVENT' && !input.startsAt) throw ruleViolation('EVENT_NEEDS_DATE', 'An event needs a date and time.');
  const townshipId = await resolveTownship(db, actor);
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO posts (township_id, author_id, type, title, body, location, starts_at, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [townshipId, actor.id, input.type, input.title, input.body, input.location ?? null, input.startsAt ?? null, input.capacity ?? null],
  );
  return { id: row!.id };
}

interface PostRow {
  id: string;
  created_at: Date;
  is_mine: boolean;
}

export async function listPosts(db: Db, actor: Actor, filter: { type?: PostType[]; q?: string; mine?: boolean } & PageQuery) {
  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  const townshipId = isStaff(actor) ? actor.townshipId : townshipOf(actor);
  const rows = await db.query<PostRow>(
    `SELECT p.id, p.type, p.title, p.body, p.location, p.starts_at, p.capacity, p.status, p.created_at,
            split_part(a.full_name, ' ', 1) AS author_name, (a.role <> 'RESIDENT') AS by_township, (p.author_id = $1) AS is_mine,
            (SELECT count(*)::int FROM post_responses r WHERE r.post_id = p.id AND r.status <> 'DECLINED') AS responses,
            (SELECT r.status FROM post_responses r WHERE r.post_id = p.id AND r.user_id = $1) AS my_response,
            (SELECT to_char(r.due_back, 'YYYY-MM-DD') FROM post_responses r WHERE r.post_id = p.id AND r.user_id = $1) AS my_due_back
       FROM posts p JOIN users a ON a.id = p.author_id
      WHERE ($2::text[] IS NULL OR p.type = ANY($2::text[])) AND ($3::uuid IS NULL OR p.township_id = $3)
        AND (p.status IN ('OPEN', 'CLOSED') OR (p.author_id = $1 AND p.status = 'HIDDEN'))
        AND ($4::boolean IS NOT TRUE OR p.author_id = $1 OR EXISTS (SELECT 1 FROM post_responses r WHERE r.post_id = p.id AND r.user_id = $1))
        AND ($5::timestamptz IS NULL OR (p.created_at, p.id) < ($5::timestamptz, $6::uuid))
        AND ($8::text IS NULL OR p.title ILIKE '%' || $8 || '%' OR p.body ILIKE '%' || $8 || '%' OR p.location ILIKE '%' || $8 || '%')
      ORDER BY p.created_at DESC, p.id DESC LIMIT $7`,
    [actor.id, filter.type?.length ? filter.type : null, townshipId, filter.mine ?? false, after, afterId, filter.limit + 1, filter.q ? filter.q.replace(/[\\%_]/g, '\\$&') : null],
  );
  const page = toPage(rows, filter.limit, (r) => [r.created_at, r.id]);

  // Authors (and staff) also see who responded, so they can confirm.
  const visible = page.items.filter((p) => p.is_mine || isStaff(actor)).map((p) => p.id);
  const responders = visible.length
    ? await db.query<{ post_id: string }>(
        `SELECT r.post_id, r.user_id, split_part(u.full_name, ' ', 1) AS name, r.status, to_char(r.due_back, 'YYYY-MM-DD') AS due_back
           FROM post_responses r JOIN users u ON u.id = r.user_id WHERE r.post_id = ANY($1::uuid[]) ORDER BY r.created_at`,
        [visible],
      )
    : [];
  return {
    items: page.items.map((p) => ({ ...p, responders: responders.filter((r) => r.post_id === p.id) })),
    nextCursor: page.nextCursor,
  };
}

async function lockPost(tx: Queryable, actor: Actor, postId: string) {
  const post = await one<{ id: string; township_id: string; author_id: string; type: PostType; title: string; status: string; capacity: number | null; starts_at: Date | null }>(
    tx,
    'SELECT id, township_id, author_id, type, title, status, capacity, starts_at FROM posts WHERE id = $1 FOR UPDATE',
    [postId],
  );
  // Posts from another township do not exist as far as this person is concerned.
  if (!post || (actor.townshipId && post.township_id !== actor.townshipId)) throw notFound('Post');
  return post;
}

/** "I'm coming", "I can help" or "I'd like this". */
export async function respondToPost(db: Db, actor: Actor, postId: string) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    if (post.status !== 'OPEN') throw conflict('POST_CLOSED', 'This is no longer open.');
    if (post.author_id === resident.id) throw ruleViolation('OWN_POST', 'You cannot respond to your own post.');
    if (post.capacity) {
      const taken = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM post_responses WHERE post_id = $1 AND status <> 'DECLINED'`, [postId]);
      if (taken!.n >= post.capacity) throw ruleViolation('POST_FULL', 'All places are taken.');
    }
    // Someone who borrowed and returned an item may ask to borrow it again. A
    // declined request stays declined, so nobody can keep asking.
    const added = await tx.query(
      `INSERT INTO post_responses (post_id, user_id) VALUES ($1, $2)
       ON CONFLICT (post_id, user_id) DO UPDATE SET status = 'PENDING', created_at = now(), accepted_at = NULL, due_back = NULL, confirmed_at = NULL, returned_at = NULL
       WHERE post_responses.status = 'RETURNED'
       RETURNING user_id`,
      [postId, resident.id],
    );
    if (added.length) {
      await notify(tx, [post.author_id], { title: `Someone responded to "${post.title}"`, body: 'Open the post to see who.', link: '/app/komuniti' });
    }
    return { ok: true };
  });
}

/** The resident's own community record, counted from verified XP only. */
export async function myImpact(db: Db, actor: Actor) {
  return one<{ xp: number; activities: number; contributions: number; neighbours_helped: number }>(
    db,
    `SELECT coalesce(sum(xp), 0)::int AS xp,
            count(*) FILTER (WHERE activity = 'JIRAN_EVENT')::int AS activities,
            count(*) FILTER (WHERE activity = 'KONGSI_SHARE')::int AS contributions,
            count(*) FILTER (WHERE activity = 'JIRAN_HELP')::int AS neighbours_helped
       FROM xp_events WHERE user_id = $1 AND activity IN ('JIRAN_EVENT', 'JIRAN_HELP', 'KONGSI_SHARE')`,
    [actor.id],
  );
}

const XP_FOR: Record<PostType, { activity: Activity; to: 'responder' | 'author' }> = {
  EVENT: { activity: 'JIRAN_EVENT', to: 'responder' },
  HELP: { activity: 'JIRAN_HELP', to: 'responder' },
  GIVE: { activity: 'KONGSI_SHARE', to: 'author' },
  LEND: { activity: 'KONGSI_SHARE', to: 'author' },
};

/** The longest a neighbour can borrow something for. */
const MAX_LOAN_DAYS = 60;
/** Township dates are Malaysian dates (UTC+8, no daylight saving). */
const localDate = (at: Date) => new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

async function lockResponse(tx: Queryable, postId: string, responderId: string) {
  const response = await one<{ status: string }>(tx, 'SELECT status FROM post_responses WHERE post_id = $1 AND user_id = $2 FOR UPDATE', [postId, responderId]);
  if (!response) throw notFound('Response');
  return response;
}

function requireAuthor(actor: Actor, post: { author_id: string }) {
  if (post.author_id !== actor.id) throw forbidden('Only the person who posted this can do that.');
}

/**
 * Help, give-away and lend requests: the author picks who it goes to. Only one
 * neighbour can be accepted at a time, so an item is never promised twice. A
 * loan needs the date it should come back.
 */
export async function acceptResponse(db: Db, actor: Actor, postId: string, responderId: string, input: { dueBack?: string }, now: Date) {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    requireAuthor(actor, post);
    if (post.type === 'EVENT') throw ruleViolation('EVENT_NO_ACCEPT', 'Event places are taken on a first-come basis. Confirm attendance after the event.');
    if (post.status !== 'OPEN') throw conflict('POST_CLOSED', 'This is no longer open.');
    const response = await lockResponse(tx, postId, responderId);
    if (response.status !== 'PENDING') throw conflict('NOT_PENDING', 'This request has already been answered.');

    let dueBack: string | null = null;
    if (post.type === 'LEND') {
      if (!input.dueBack) throw ruleViolation('LOAN_NEEDS_DATE', 'Choose the date the item should come back.');
      const today = localDate(now);
      const latest = localDate(new Date(now.getTime() + MAX_LOAN_DAYS * 86_400_000));
      if (input.dueBack < today || input.dueBack > latest) throw ruleViolation('LOAN_DATE', `The return date must be between today and ${MAX_LOAN_DAYS} days from now.`);
      dueBack = input.dueBack;
    }
    const busy = await one<{ name: string; status: string }>(
      tx,
      `SELECT split_part(u.full_name, ' ', 1) AS name, r.status FROM post_responses r JOIN users u ON u.id = r.user_id
        WHERE r.post_id = $1 AND (r.status = 'ACCEPTED' OR (r.status = 'CONFIRMED' AND $2 = 'LEND')) LIMIT 1`,
      [postId, post.type],
    );
    if (busy) {
      throw conflict('ALREADY_ACCEPTED', busy.status === 'CONFIRMED'
        ? `${busy.name} still has this item. Mark it returned before lending it again.`
        : `You already accepted ${busy.name}. Decline them first to choose someone else.`);
    }
    await tx.query(`UPDATE post_responses SET status = 'ACCEPTED', accepted_at = $3, due_back = $4 WHERE post_id = $1 AND user_id = $2`, [postId, responderId, now, dueBack]);
    await notify(tx, [responderId], {
      title: `Accepted: ${post.title}`,
      body: post.type === 'LEND' ? `Arrange to collect it. Please return it by ${dueBack}.` : post.type === 'GIVE' ? 'Arrange a time to collect it.' : 'Arrange a time to help.',
      link: '/app/komuniti',
    });
    return { ok: true };
  });
}

/** The author says no, or changes their mind about an accepted neighbour before the handover. */
export async function declineResponse(db: Db, actor: Actor, postId: string, responderId: string) {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    requireAuthor(actor, post);
    const response = await lockResponse(tx, postId, responderId);
    if (response.status !== 'PENDING' && response.status !== 'ACCEPTED') throw conflict('NOT_PENDING', 'This can no longer be declined.');
    await tx.query(`UPDATE post_responses SET status = 'DECLINED', accepted_at = NULL, due_back = NULL WHERE post_id = $1 AND user_id = $2`, [postId, responderId]);
    await notify(tx, [responderId], { title: `Not this time: ${post.title}`, body: 'The neighbour who posted this has chosen someone else, or it is no longer available.', link: '/app/komuniti' });
    return { ok: true };
  });
}

/** A neighbour takes back their RSVP or request. Events: only before they start. */
export async function withdrawResponse(db: Db, actor: Actor, postId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    const response = await lockResponse(tx, postId, resident.id);
    if (response.status !== 'PENDING' && response.status !== 'ACCEPTED') throw conflict('CANNOT_WITHDRAW', 'This has already happened, so it cannot be cancelled.');
    if (post.type === 'EVENT' && post.starts_at && post.starts_at <= now) throw ruleViolation('EVENT_STARTED', 'The event has already started.');
    await tx.query('DELETE FROM post_responses WHERE post_id = $1 AND user_id = $2', [postId, resident.id]);
    await notify(tx, [post.author_id], {
      title: post.type === 'EVENT' ? `Someone can no longer come to "${post.title}"` : `A neighbour withdrew from "${post.title}"`,
      body: post.type === 'EVENT' ? 'Their place is free again.' : 'You can accept someone else.',
      link: '/app/komuniti',
    });
    return { ok: true };
  });
}

/**
 * The author confirms it really happened: the neighbour attended, helped,
 * collected the item, or took the loan. Help, give-away and lend need the
 * neighbour to have been accepted first. Township staff may also confirm
 * attendance at events. A loan earns XP when it comes back, not here.
 */
export async function confirmResponse(db: Db, actor: Actor, postId: string, responderId: string, now: Date): Promise<{ reward: ActionReward | null }> {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    const staffAtEvent = isStaff(actor) && post.type === 'EVENT';
    if (post.author_id !== actor.id && !staffAtEvent) throw forbidden('Only the person who posted this can confirm.');
    const response = await lockResponse(tx, postId, responderId);
    const ready = post.type === 'EVENT' ? 'PENDING' : 'ACCEPTED';
    if (response.status !== ready) {
      throw response.status === 'PENDING'
        ? ruleViolation('NOT_ACCEPTED', 'Accept this neighbour first, then confirm once it has happened.')
        : conflict('NOT_PENDING', 'This has already been confirmed or declined.');
    }
    await tx.query(`UPDATE post_responses SET status = 'CONFIRMED', confirmed_at = $3 WHERE post_id = $1 AND user_id = $2`, [postId, responderId, now]);

    if (post.type === 'LEND') {
      await notify(tx, [responderId], { title: `Enjoy: ${post.title}`, body: 'Please return it on time. The lender will mark it returned.', link: '/app/komuniti' });
      return { reward: null };
    }
    const rule = XP_FOR[post.type];
    const earner = await rewardUserById(tx, rule.to === 'responder' ? responderId : post.author_id);
    const reward = earner ? await recordAction(tx, { user: earner, activity: rule.activity, ref: `${postId}:${responderId}`, now }) : null;
    // An item can only be given once, and a favour is done once.
    if (post.type === 'GIVE' || post.type === 'HELP') await tx.query(`UPDATE posts SET status = 'CLOSED' WHERE id = $1`, [postId]);
    await notify(tx, [responderId], { title: `Confirmed: ${post.title}`, body: rule.to === 'responder' ? 'Thank you. Your Impact XP has been added.' : 'The exchange is complete.' });
    return { reward };
  });
}

/** The lender confirms the item came back. This completes the loan and gives the lender Impact XP. */
export async function markReturned(db: Db, actor: Actor, postId: string, responderId: string, now: Date): Promise<{ reward: ActionReward | null }> {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    requireAuthor(actor, post);
    if (post.type !== 'LEND') throw ruleViolation('NOT_A_LOAN', 'Only lent items can be returned.');
    const response = await lockResponse(tx, postId, responderId);
    if (response.status !== 'CONFIRMED') throw conflict('NOT_ON_LOAN', 'This item is not on loan to them.');
    await tx.query(`UPDATE post_responses SET status = 'RETURNED', returned_at = $3 WHERE post_id = $1 AND user_id = $2`, [postId, responderId, now]);
    // One reward per borrower per item, however many times they borrow it.
    const earner = await rewardUserById(tx, post.author_id);
    const reward = earner ? await recordAction(tx, { user: earner, activity: 'KONGSI_SHARE', ref: `${postId}:${responderId}`, now }) : null;
    await notify(tx, [responderId], { title: `Returned: ${post.title}`, body: 'Thank you for bringing it back.' });
    return { reward };
  });
}

export async function closePost(db: Db, actor: Actor, postId: string) {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    if (post.author_id !== actor.id && !isStaff(actor)) throw forbidden();
    if (post.status === 'OPEN') await tx.query(`UPDATE posts SET status = 'CLOSED' WHERE id = $1`, [postId]);
    return { ok: true };
  });
}

/** BR20: once enough different residents flag a post it is hidden until a moderator has looked. */
export async function flagPost(db: Db, actor: Actor, postId: string, reason: string) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    if (post.author_id === resident.id) throw ruleViolation('OWN_POST', 'You cannot flag your own post.');
    await tx.query('INSERT INTO post_flags (post_id, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [postId, resident.id, reason]);
    const flags = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM post_flags WHERE post_id = $1', [postId]);
    const hide = flags!.n >= (await getSettings(tx)).flag_hide_threshold && (post.status === 'OPEN' || post.status === 'CLOSED');
    if (hide) {
      await tx.query(`UPDATE posts SET status = 'HIDDEN' WHERE id = $1`, [postId]);
      await audit(tx, null, 'POST_HIDDEN', 'post', postId, { flags: flags!.n });
    }
    return { hidden: hide };
  });
}

export async function moderationQueue(db: Db, actor: Actor) {
  return db.query(
    `SELECT p.id, p.type, p.title, p.body, p.created_at, a.full_name AS author_name,
            (SELECT json_agg(f.reason ORDER BY f.created_at) FROM post_flags f WHERE f.post_id = p.id) AS reasons
       FROM posts p JOIN users a ON a.id = p.author_id
      WHERE p.status = 'HIDDEN' AND ($1::uuid IS NULL OR p.township_id = $1) ORDER BY p.created_at DESC LIMIT 100`,
    [actor.townshipId],
  );
}

export async function moderatePost(db: Db, actor: Actor, postId: string, action: 'RESTORE' | 'REMOVE') {
  return db.tx(async (tx) => {
    const post = await one<{ township_id: string; status: string; author_id: string; title: string }>(
      tx,
      'SELECT township_id, status, author_id, title FROM posts WHERE id = $1 FOR UPDATE',
      [postId],
    );
    if (!post) throw notFound('Post');
    assertTownshipAccess(actor, post.township_id);
    if (post.status !== 'HIDDEN') throw conflict('NOT_HIDDEN', 'This post is not waiting for review.');
    if (action === 'RESTORE') {
      await tx.query('DELETE FROM post_flags WHERE post_id = $1', [postId]);
      await tx.query(`UPDATE posts SET status = 'OPEN' WHERE id = $1`, [postId]);
    } else {
      await tx.query(`UPDATE posts SET status = 'REMOVED' WHERE id = $1`, [postId]);
      await notify(tx, [post.author_id], { title: `Your post "${post.title}" was removed`, body: 'It did not follow the community guidelines.' });
    }
    await audit(tx, actor.id, action === 'RESTORE' ? 'POST_RESTORED' : 'POST_REMOVED', 'post', postId);
    return { ok: true };
  });
}
