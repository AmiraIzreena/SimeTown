import type { Queryable } from '../db/client';
import { notificationCategory, notificationDestination, type NotificationCategory, type NotificationItem } from '@/shared/notifications';
import { decodeCursor, toPage } from '../http/pagination';
import { notFound } from '../errors';

export interface NotificationInput {
  title: string;
  body: string;
  link?: string;
  /** URGENT notifications are shown above everything else (BR19). */
  priority?: 'NORMAL' | 'URGENT';
  /** Stable event key. Stored once per recipient, including after dismissal. */
  dedupeKey?: string;
  category?: NotificationCategory;
}

/**
 * The one place notifications are created. In the pilot, push and SMS delivery
 * for URGENT items hooks in here; the prototype shows them in-app.
 */
export async function notify(q: Queryable, userIds: string[], n: NotificationInput): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await q.query(
    `INSERT INTO notifications (user_id, priority, title, body, link, dedupe_key, category)
     SELECT DISTINCT u, $2, $3, $4, $5, CASE WHEN $6::text IS NULL THEN NULL ELSE $6 || ':recipient:' || u END, $7 FROM unnest($1::uuid[]) AS u
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [userIds, n.priority ?? 'NORMAL', n.title, n.body, n.link ?? null, n.dedupeKey ?? null, n.category ?? notificationCategory(n.link)],
  );
  return rows.length;
}

export async function listNotifications(q: Queryable, userId: string, options: { cursor?: string; limit?: number; unread?: boolean; category?: NotificationCategory } = {}) {
  const [, cursor] = decodeCursor(options.cursor, 'id');
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const items = await q.query<NotificationItem>(
    `SELECT id::text, priority, title, body, link, category, read_at, created_at
       FROM notifications WHERE user_id = $1 AND dismissed_at IS NULL
       AND ($2::bigint IS NULL OR id < $2) AND (NOT $3::boolean OR read_at IS NULL)
       AND ($4::text IS NULL OR category = $4) ORDER BY notifications.id DESC LIMIT $5`,
    [userId, cursor, options.unread ?? false, options.category ?? null, limit + 1],
  );
  const unread = await q.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
    [userId],
  );
  const page = toPage(items, limit, (n) => [n.id, n.id]);
  return { ...page, items: page.items.map((n) => ({ ...n, link: notificationDestination(n.link) })), unread: unread[0]!.n };
}

export async function markAllRead(q: Queryable, userId: string, now: Date): Promise<void> {
  await q.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL', [userId, now]);
}

export async function updateNotification(q: Queryable, userId: string, id: string, action: 'read' | 'dismiss', now: Date) {
  const result = await q.query(`UPDATE notifications SET ${action === 'read' ? 'read_at = COALESCE(read_at, $3)' : 'dismissed_at = COALESCE(dismissed_at, $3)'} WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, id, now]);
  if (!result.length) throw notFound('Notification');
  return { ok: true };
}
