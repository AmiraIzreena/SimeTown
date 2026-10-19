import type { PostType } from '@/shared/domain';
import { one, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { forbidden, notFound, ruleViolation } from '../../errors';

/**
 * Komuniti: Jiran (events, help board) and Kongsi (give away, lend) share one
 * model: a post, people who respond to it, and the author confirming what
 * happened. XP is given only at that confirmation (BR4).
 *
 *   posts.ts       the feed: create, list, close, your impact
 *   responses.ts   respond, accept, decline, withdraw, confirm, return
 *   moderation.ts  residents' reports and the staff console
 */

export const isStaff = (actor: Actor) => actor.role !== 'RESIDENT';

/** Township dates are Malaysian dates (UTC+8, no daylight saving). */
export const localDate = (at: Date) => new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

export interface LockedPost {
  id: string;
  township_id: string;
  author_id: string;
  type: PostType;
  title: string;
  status: string;
  capacity: number | null;
  starts_at: Date | null;
}

export async function lockPost(tx: Queryable, actor: Actor, postId: string) {
  const post = await one<LockedPost>(
    tx,
    'SELECT id, township_id, author_id, type, title, status, capacity, starts_at FROM posts WHERE id = $1 FOR UPDATE',
    [postId],
  );
  // Posts from another township do not exist as far as this person is concerned.
  if (!post || (actor.townshipId && post.township_id !== actor.townshipId)) throw notFound('Post');
  return post;
}

export async function lockResponse(tx: Queryable, postId: string, responderId: string) {
  const response = await one<{ status: string }>(tx, 'SELECT status FROM post_responses WHERE post_id = $1 AND user_id = $2 FOR UPDATE', [postId, responderId]);
  if (!response) throw notFound('Response');
  return response;
}

export function requireAuthor(actor: Actor, post: { author_id: string }) {
  if (post.author_id !== actor.id) throw forbidden('Only the person who posted this can do that.');
}

/** A resident suspended by township admins or HQ cannot post or respond until it ends. */
export async function assertNotSuspended(q: Queryable, userId: string, now: Date) {
  const suspension = await one<{ until: Date }>(q, 'SELECT until FROM komuniti_suspensions WHERE user_id = $1 AND until > $2', [userId, now]);
  if (suspension) {
    throw ruleViolation('KOMUNITI_SUSPENDED', `You cannot post or respond in Komuniti until ${localDate(suspension.until)}. Township staff have sent you the reason.`);
  }
}
