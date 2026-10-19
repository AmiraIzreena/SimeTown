import type { PostFlagCategory, PostStatus, PostType } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { localDate, lockPost } from './common';

/**
 * Keeping Komuniti safe. Residents report posts; once enough different
 * residents have reported one it is hidden until staff look (BR20). Township
 * staff, township admins and HQ work the queue: keep, hide or remove. Township
 * admins and HQ can also suspend a resident from Komuniti. Everyone sees their
 * own township; HQ sees every township, or one it picks.
 */

/** HQ may look at any township, or all of them; everyone else only at their own. */
function scopeOf(actor: Actor, requested?: string): string | null {
  if (actor.townshipId) {
    if (requested && requested !== actor.townshipId) throw forbidden();
    return actor.townshipId;
  }
  return requested ?? null;
}

async function townshipTeam(q: Queryable, townshipId: string) {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
    [townshipId],
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Residents report a post
// ---------------------------------------------------------------------------

export async function flagPost(db: Db, actor: Actor, postId: string, input: { category: PostFlagCategory; reason?: string }) {
  const resident = requireVerifiedResident(actor);
  if (input.category === 'OTHER' && !input.reason) throw ruleViolation('REASON_NEEDED', 'Tell us what is wrong with it.');
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    if (post.status === 'REMOVED') throw notFound('Post');
    if (post.author_id === resident.id) throw ruleViolation('OWN_POST', 'You cannot flag your own post.');
    // One report per resident per post, even after staff have decided on it.
    await tx.query(
      'INSERT INTO post_flags (post_id, user_id, category, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [postId, resident.id, input.category, input.reason ?? null],
    );
    const flags = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM post_flags WHERE post_id = $1 AND status = 'OPEN'`, [postId]);
    const hide = flags!.n >= (await getSettings(tx)).flag_hide_threshold && (post.status === 'OPEN' || post.status === 'CLOSED');
    if (hide) {
      await tx.query(`UPDATE posts SET status = 'HIDDEN' WHERE id = $1`, [postId]);
      await audit(tx, null, 'POST_HIDDEN', 'post', postId, { flags: flags!.n });
      await notify(tx, await townshipTeam(tx, post.township_id), {
        title: `A Komuniti post was hidden: "${post.title}"`,
        body: 'Several residents reported it. Review it in the console.',
        link: '/console/komuniti',
      });
    }
    return { hidden: hide };
  });
}

// ---------------------------------------------------------------------------
// The console: overview, reports, every post
// ---------------------------------------------------------------------------

export async function overview(db: Db, actor: Actor, filter: { townshipId?: string }, now: Date) {
  const townshipId = scopeOf(actor, filter.townshipId);
  return one<{ open_posts: number; reported: number; hidden: number; overdue_loans: number; removed_30d: number; new_30d: number; suspended: number }>(
    db,
    `SELECT
       (SELECT count(*)::int FROM posts p WHERE p.status = 'OPEN' AND ($1::uuid IS NULL OR p.township_id = $1)) AS open_posts,
       (SELECT count(DISTINCT f.post_id)::int FROM post_flags f JOIN posts p ON p.id = f.post_id
         WHERE f.status = 'OPEN' AND ($1::uuid IS NULL OR p.township_id = $1)) AS reported,
       (SELECT count(*)::int FROM posts p WHERE p.status = 'HIDDEN' AND ($1::uuid IS NULL OR p.township_id = $1)) AS hidden,
       (SELECT count(*)::int FROM post_responses r JOIN posts p ON p.id = r.post_id
         WHERE p.type = 'LEND' AND r.status = 'CONFIRMED' AND r.due_back < $3::date AND ($1::uuid IS NULL OR p.township_id = $1)) AS overdue_loans,
       (SELECT count(*)::int FROM posts p WHERE p.status = 'REMOVED' AND p.moderated_at > $2::timestamptz - interval '30 days' AND ($1::uuid IS NULL OR p.township_id = $1)) AS removed_30d,
       (SELECT count(*)::int FROM posts p WHERE p.created_at > $2::timestamptz - interval '30 days' AND ($1::uuid IS NULL OR p.township_id = $1)) AS new_30d,
       (SELECT count(*)::int FROM komuniti_suspensions s WHERE s.until > $2 AND ($1::uuid IS NULL OR s.township_id = $1)) AS suspended`,
    [townshipId, now, localDate(now)],
  );
}

/** Posts with reports waiting: hidden ones first, then scams and safety, then the most reported. */
export async function listReports(db: Db, actor: Actor, filter: { townshipId?: string }) {
  const townshipId = scopeOf(actor, filter.townshipId);
  return db.query(
    `SELECT p.id, p.type, p.title, p.body, p.status, p.created_at, t.name AS township_name, a.full_name AS author_name,
            count(*)::int AS open_reports,
            bool_or(f.category IN ('SCAM', 'UNSAFE')) AS urgent,
            json_agg(json_build_object('category', f.category, 'reason', f.reason, 'created_at', f.created_at) ORDER BY f.created_at) AS reports,
            max(f.created_at) AS last_reported_at
       FROM post_flags f
       JOIN posts p ON p.id = f.post_id
       JOIN users a ON a.id = p.author_id
       JOIN townships t ON t.id = p.township_id
      WHERE f.status = 'OPEN' AND ($1::uuid IS NULL OR p.township_id = $1)
      GROUP BY p.id, t.id, a.id
      ORDER BY (p.status = 'HIDDEN') DESC, bool_or(f.category IN ('SCAM', 'UNSAFE')) DESC, count(*) DESC, max(f.created_at) DESC
      LIMIT 100`,
    [townshipId],
  );
}

interface AdminPostRow {
  id: string;
  created_at: Date;
}

/** Every post, including hidden and removed ones, newest first. */
export async function listPosts(
  db: Db,
  actor: Actor,
  filter: { townshipId?: string; status?: PostStatus; type?: PostType; q?: string } & PageQuery,
  now: Date,
) {
  const townshipId = scopeOf(actor, filter.townshipId);
  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  const rows = await db.query<AdminPostRow>(
    `SELECT p.id, p.type, p.title, p.status, p.created_at, t.name AS township_name, a.full_name AS author_name,
            (SELECT count(*)::int FROM post_responses r WHERE r.post_id = p.id AND r.status <> 'DECLINED') AS responses,
            (SELECT count(*)::int FROM post_flags f WHERE f.post_id = p.id AND f.status = 'OPEN') AS open_reports,
            (SELECT count(*)::int FROM post_responses r WHERE r.post_id = p.id AND p.type = 'LEND' AND r.status = 'CONFIRMED' AND r.due_back < $8::date) AS overdue
       FROM posts p JOIN users a ON a.id = p.author_id JOIN townships t ON t.id = p.township_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1) AND ($2::text IS NULL OR p.status = $2) AND ($3::text IS NULL OR p.type = $3)
        AND ($4::text IS NULL OR p.title ILIKE '%' || $4 || '%' OR p.body ILIKE '%' || $4 || '%' OR a.full_name ILIKE '%' || $4 || '%')
        AND ($5::timestamptz IS NULL OR (p.created_at, p.id) < ($5::timestamptz, $6::uuid))
      ORDER BY p.created_at DESC, p.id DESC LIMIT $7`,
    [townshipId, filter.status ?? null, filter.type ?? null, filter.q ? filter.q.replace(/[\\%_]/g, '\\$&') : null, after, afterId, filter.limit + 1, localDate(now)],
  );
  return toPage(rows, filter.limit, (r) => [r.created_at, r.id]);
}

/** One post in full: who responded, every report and decision, and the author's record. */
export async function getPost(db: Db, actor: Actor, postId: string, now: Date) {
  const post = await one<{ township_id: string; author_id: string }>(
    db,
    `SELECT p.id, p.type, p.title, p.body, p.location, p.starts_at, p.capacity, p.status, p.created_at, p.township_id, t.name AS township_name,
            p.author_id, a.full_name AS author_name, (a.role <> 'RESIDENT') AS by_township,
            p.moderated_at, p.moderation_note, m.full_name AS moderated_by_name
       FROM posts p JOIN users a ON a.id = p.author_id JOIN townships t ON t.id = p.township_id LEFT JOIN users m ON m.id = p.moderated_by
      WHERE p.id = $1`,
    [postId],
  );
  if (!post) throw notFound('Post');
  assertTownshipAccess(actor, post.township_id);
  const [responders, reports, author] = await Promise.all([
    db.query(
      `SELECT r.user_id, u.full_name AS name, r.status, r.created_at, to_char(r.due_back, 'YYYY-MM-DD') AS due_back,
              (r.status = 'CONFIRMED' AND r.due_back < $2::date) AS overdue
         FROM post_responses r JOIN users u ON u.id = r.user_id WHERE r.post_id = $1 ORDER BY r.created_at`,
      [postId, localDate(now)],
    ),
    db.query(
      `SELECT f.user_id, u.full_name AS reporter_name, f.category, f.reason, f.status, f.created_at, f.reviewed_at
         FROM post_flags f JOIN users u ON u.id = f.user_id WHERE f.post_id = $1 ORDER BY f.created_at`,
      [postId],
    ),
    one(
      db,
      `SELECT (SELECT count(*)::int FROM posts WHERE author_id = $1) AS posts,
              (SELECT count(*)::int FROM posts WHERE author_id = $1 AND status = 'REMOVED') AS removed,
              (SELECT count(*)::int FROM post_flags f JOIN posts p ON p.id = f.post_id WHERE p.author_id = $1 AND f.status = 'UPHELD') AS upheld_reports,
              (SELECT json_build_object('until', s.until, 'reason', s.reason) FROM komuniti_suspensions s WHERE s.user_id = $1 AND s.until > $2) AS suspension`,
      [post.author_id, now],
    ),
  ]);
  return { ...post, responders, reports, author };
}

export type ModerationAction = 'KEEP' | 'HIDE' | 'REMOVE';

/**
 * KEEP: the reports are dismissed and a hidden or removed post is visible again.
 * HIDE: take it out of the feed while staff check.
 * REMOVE: take it down for good; the author is told why.
 * The author, the residents who reported it and anyone still waiting on it are told.
 */
export async function moderatePost(db: Db, actor: Actor, postId: string, input: { action: ModerationAction; note?: string }, now: Date) {
  return db.tx(async (tx) => {
    const post = await one<{ township_id: string; status: PostStatus; author_id: string; title: string }>(
      tx,
      'SELECT township_id, status, author_id, title FROM posts WHERE id = $1 FOR UPDATE',
      [postId],
    );
    if (!post) throw notFound('Post');
    assertTownshipAccess(actor, post.township_id);
    const reporters = (await tx.query<{ user_id: string }>(`SELECT user_id FROM post_flags WHERE post_id = $1 AND status = 'OPEN'`, [postId])).map((r) => r.user_id);
    const invisible = post.status === 'HIDDEN' || post.status === 'REMOVED';

    let status = post.status;
    let auditAction: string;
    if (input.action === 'KEEP') {
      if (!invisible && reporters.length === 0) throw conflict('NOTHING_TO_REVIEW', 'This post has no reports and is already visible.');
      if (invisible) status = 'OPEN';
      await tx.query(`UPDATE post_flags SET status = 'DISMISSED', reviewed_by = $2, reviewed_at = $3 WHERE post_id = $1 AND status = 'OPEN'`, [postId, actor.id, now]);
      await notify(tx, reporters, {
        title: `We reviewed "${post.title}"`,
        body: 'It does not break the community guidelines, so it stays up. Thank you for looking out for your neighbours.',
        link: '/app/komuniti',
      });
      if (invisible) await notify(tx, [post.author_id], { title: `Your post "${post.title}" is visible again`, body: 'Township staff reviewed it.', link: '/app/komuniti' });
      auditAction = invisible ? 'POST_RESTORED' : 'POST_REPORTS_DISMISSED';
    } else if (input.action === 'HIDE') {
      if (invisible) throw conflict('NOT_VISIBLE', 'This post is already hidden or removed.');
      status = 'HIDDEN';
      await notify(tx, [post.author_id], { title: `Your post "${post.title}" is hidden for now`, body: input.note ?? 'Township staff are reviewing it.', link: '/app/komuniti' });
      auditAction = 'POST_HIDDEN';
    } else {
      if (post.status === 'REMOVED') throw conflict('ALREADY_REMOVED', 'This post has already been removed.');
      if (!input.note) throw ruleViolation('REASON_NEEDED', 'Tell the author why it was removed.');
      status = 'REMOVED';
      await tx.query(`UPDATE post_flags SET status = 'UPHELD', reviewed_by = $2, reviewed_at = $3 WHERE post_id = $1 AND status = 'OPEN'`, [postId, actor.id, now]);
      const waiting = (await tx.query<{ user_id: string }>(`SELECT user_id FROM post_responses WHERE post_id = $1 AND status IN ('PENDING', 'ACCEPTED')`, [postId])).map((r) => r.user_id);
      await notify(tx, [post.author_id], { title: `Your post "${post.title}" was removed`, body: input.note, category: 'COMMUNITY' });
      await notify(tx, reporters, { title: `Thank you: "${post.title}" was removed`, body: 'Township staff agreed it broke the community guidelines.', category: 'COMMUNITY' });
      await notify(tx, waiting, { title: `"${post.title}" is no longer available`, body: 'Township staff removed the post.', category: 'COMMUNITY' });
      auditAction = 'POST_REMOVED';
    }

    await tx.query(
      'UPDATE posts SET status = $2, moderated_by = $3, moderated_at = $4, moderation_note = $5 WHERE id = $1',
      [postId, status, actor.id, now, input.note ?? null],
    );
    await audit(tx, actor.id, auditAction, 'post', postId, { reports: reporters.length, ...(input.note ? { note: input.note } : {}) });
    return { status };
  });
}

// ---------------------------------------------------------------------------
// Suspensions (township admins and HQ)
// ---------------------------------------------------------------------------

export async function listSuspensions(db: Db, actor: Actor, filter: { townshipId?: string }, now: Date) {
  const townshipId = scopeOf(actor, filter.townshipId);
  return db.query(
    `SELECT s.user_id, u.full_name AS name, s.until, s.reason, s.created_at, b.full_name AS suspended_by, t.name AS township_name
       FROM komuniti_suspensions s JOIN users u ON u.id = s.user_id JOIN users b ON b.id = s.created_by JOIN townships t ON t.id = s.township_id
      WHERE s.until > $2 AND ($1::uuid IS NULL OR s.township_id = $1)
      ORDER BY s.until`,
    [townshipId, now],
  );
}

/** Stop a resident posting or responding in Komuniti. Suspending again replaces the earlier one. */
export async function suspendResident(db: Db, actor: Actor, userId: string, input: { days: number; reason: string }, now: Date) {
  return db.tx(async (tx) => {
    const user = await one<{ role: string; township_id: string | null }>(tx, 'SELECT role, township_id FROM users WHERE id = $1', [userId]);
    if (!user || user.role !== 'RESIDENT' || !user.township_id) throw notFound('Resident');
    assertTownshipAccess(actor, user.township_id);
    const until = new Date(now.getTime() + input.days * 86_400_000);
    await tx.query(
      `INSERT INTO komuniti_suspensions (user_id, township_id, until, reason, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET until = EXCLUDED.until, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at`,
      [userId, user.township_id, until, input.reason, actor.id, now],
    );
    await notify(tx, [userId], {
      title: 'You are suspended from Komuniti',
      body: `You cannot post or respond until ${localDate(until)}. Reason: ${input.reason}`,
      link: '/app/komuniti',
    });
    await audit(tx, actor.id, 'KOMUNITI_SUSPENDED', 'user', userId, { days: input.days, reason: input.reason });
    return { until };
  });
}

export async function liftSuspension(db: Db, actor: Actor, userId: string, now: Date) {
  return db.tx(async (tx) => {
    const suspension = await one<{ township_id: string }>(tx, 'SELECT township_id FROM komuniti_suspensions WHERE user_id = $1 AND until > $2 FOR UPDATE', [userId, now]);
    if (!suspension) throw notFound('Suspension');
    assertTownshipAccess(actor, suspension.township_id);
    await tx.query('DELETE FROM komuniti_suspensions WHERE user_id = $1', [userId]);
    await notify(tx, [userId], { title: 'You can use Komuniti again', body: 'Township staff lifted your suspension.', link: '/app/komuniti' });
    await audit(tx, actor.id, 'KOMUNITI_SUSPENSION_LIFTED', 'user', userId);
    return { ok: true };
  });
}
