import type { Queryable } from '../db/client';

export interface NotificationInput {
  title: string;
  body: string;
  link?: string;
  /** URGENT notifications are shown above everything else (BR19). */
  priority?: 'NORMAL' | 'URGENT';
  /** When set, the same notification is never stored twice. Use with a single recipient. */
  dedupeKey?: string;
}

/**
 * The one place notifications are created. In the pilot, push and SMS delivery
 * for URGENT items hooks in here; the prototype shows them in-app.
 */
export async function notify(q: Queryable, userIds: string[], n: NotificationInput): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await q.query(
    `INSERT INTO notifications (user_id, priority, title, body, link, dedupe_key)
     SELECT u, $2, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS u
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [userIds, n.priority ?? 'NORMAL', n.title, n.body, n.link ?? null, n.dedupeKey ?? null],
  );
  return rows.length;
}

export async function listNotifications(q: Queryable, userId: string) {
  const items = await q.query(
    `SELECT id, priority, title, body, link, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50`,
    [userId],
  );
  const unread = await q.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return { items, unread: unread[0]!.n };
}

export async function markAllRead(q: Queryable, userId: string, now: Date): Promise<void> {
  await q.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [userId, now]);
}
