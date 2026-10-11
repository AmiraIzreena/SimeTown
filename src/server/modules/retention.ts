import type { Db } from '../db/client';
import { deleteOldVisitorRecords } from './tamu/service';

/**
 * Keeps only what each feature promised to keep (proposal section 18). Part of
 * the daily `cleanup` job; safe to run any number of times.
 *
 *   Tamu    visitor records, passes, patrol scans: 90 days (BR26)
 *   Gerak   detailed routes: 30 days; an activity left running is closed (BR24)
 *   Jimat   bills read but never confirmed: 1 day (the file itself is never kept, BR25)
 *   Kitar   machine sessions nobody finished: closed after 15 minutes
 */
export async function retentionCleanup(db: Db, now: Date): Promise<Record<string, number>> {
  const visitors = await deleteOldVisitorRecords(db, now);
  const routes = await db.query(
    `UPDATE gerak_activities SET route = '[]', route_deleted_at = $1
      WHERE route_deleted_at IS NULL AND started_at < $1::timestamptz - interval '30 days' RETURNING id`,
    [now],
  );
  const abandoned = await db.query(
    `UPDATE gerak_activities SET status = 'ABANDONED', finished_at = $1, route = '[]', route_deleted_at = $1
      WHERE status = 'ACTIVE' AND coalesce(last_point_at, started_at) < $1::timestamptz - interval '6 hours' RETURNING id`,
    [now],
  );
  const bills = await db.query(`DELETE FROM jimat_bills WHERE status <> 'CONFIRMED' AND created_at < $1::timestamptz - interval '1 day' RETURNING id`, [now]);
  const sessions = await db.query(
    `UPDATE kitar_sessions SET status = 'EXPIRED', closed_at = $1
      WHERE status = 'OPEN' AND last_activity_at < $1::timestamptz - interval '15 minutes' RETURNING id`,
    [now],
  );
  return {
    visitorEntriesDeleted: visitors.entries,
    visitorPassesDeleted: visitors.passes,
    routesDeleted: routes.length,
    activitiesClosed: abandoned.length,
    unconfirmedBillsDeleted: bills.length,
    machineSessionsClosed: sessions.length,
  };
}
