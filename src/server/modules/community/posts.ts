import type { PostType } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { forbidden, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { resolveTownship } from '../townships';
import { assertNotSuspended, isStaff, lockPost } from './common';

/** The feed: what residents post, what they see, and their own community record. */

export interface PostInput {
  type: PostType;
  title: string;
  body: string;
  location?: string;
  startsAt?: Date;
  capacity?: number;
}

export async function createPost(db: Db, actor: Actor, input: PostInput, now: Date) {
  if (!isStaff(actor)) {
    requireVerifiedResident(actor);
    await assertNotSuspended(db, actor.id, now);
  }
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

export async function closePost(db: Db, actor: Actor, postId: string) {
  return db.tx(async (tx) => {
    const post = await lockPost(tx, actor, postId);
    if (post.author_id !== actor.id && !isStaff(actor)) throw forbidden();
    if (post.status === 'OPEN') await tx.query(`UPDATE posts SET status = 'CLOSED' WHERE id = $1`, [postId]);
    return { ok: true };
  });
}
