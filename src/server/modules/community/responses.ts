import type { Activity, PostType } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, forbidden, ruleViolation } from '../../errors';
import { notify } from '../notifications';
import { recordAction, rewardUserById, type ActionReward } from '../rewards';
import { assertNotSuspended, isStaff, localDate, lockPost, lockResponse, requireAuthor } from './common';

/**
 * What happens after something is posted. Events: RSVP, then the host confirms
 * attendance. Help, give and lend: Request, Accept, Confirm, and a loan is only
 * complete once the item comes back.
 */

const XP_FOR: Record<PostType, { activity: Activity; to: 'responder' | 'author' }> = {
  EVENT: { activity: 'JIRAN_EVENT', to: 'responder' },
  HELP: { activity: 'JIRAN_HELP', to: 'responder' },
  GIVE: { activity: 'KONGSI_SHARE', to: 'author' },
  LEND: { activity: 'KONGSI_SHARE', to: 'author' },
};

/** The longest a neighbour can borrow something for. */
const MAX_LOAN_DAYS = 60;

/** "I'm coming", "I can help" or "I'd like this". */
export async function respondToPost(db: Db, actor: Actor, postId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    await assertNotSuspended(tx, resident.id, now);
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
