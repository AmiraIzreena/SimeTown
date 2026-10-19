import type { Db } from '../db/client';
import { deleteOldConversations } from './assistant/service';
import { deleteOldVisitorRecords } from './tamu/service';
import { deleteOldParcels } from './parcels/service';

/**
 * Keeps only what each feature promised to keep (proposal section 18). Part of
 * the daily `cleanup` job; safe to run any number of times.
 *
 *   Tamu    visitor records, passes, patrol scans: 90 days (BR26)
 *   Gerak   detailed routes: 30 days; an activity left running is closed (BR24)
 *   Jimat   bills read but never confirmed: 1 day (the file itself is never kept, BR25)
 *   Kitar   machine sessions nobody finished: closed after 15 minutes
 *   Assistant  conversations: 90 days after the last message
 *   Parcels collected or returned parcels, with their photos: 90 days
 *   Lockers finished locker parcels with their history: 90 days; wrong-code counts: 1 day; device messages: 30 days
 *   Banjir  raw sensor readings and signals: 90 days, summarised by day first (Appendix E.3);
 *           SMS outbox (phone numbers): 30 days
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
  const conversations = await deleteOldConversations(db, now);
  const parcels = await deleteOldParcels(db, now);
  // Smart lockers: finished parcels (with their history) after 90 days; wrong-code counts after a day; unlocked keypad records after 90 days; device messages after 30 days.
  const lockerParcels = await db.query(`DELETE FROM locker_parcels WHERE state IN ('COLLECTED', 'RETURNED', 'DELIVERY_FAILED') AND state_changed_at < $1::timestamptz - interval '90 days' AND id NOT IN (SELECT parcel_id FROM locker_commands WHERE parcel_id IS NOT NULL AND status IN ('PENDING', 'SENT')) RETURNING id`, [now]);
  await db.query(`DELETE FROM pickup_attempts WHERE at < $1::timestamptz - interval '1 day'`, [now]);
  await db.query(`DELETE FROM pickup_lockouts WHERE cleared_at < $1::timestamptz - interval '90 days'`, [now]);
  // Courier platform: scans and sign-ins after 180 days; resolved incidents after a year; finished sign-in attempts after a day.
  await db.query(`DELETE FROM courier_scans WHERE at < $1::timestamptz - interval '180 days'`, [now]);
  await db.query(`DELETE FROM courier_logins WHERE at < $1::timestamptz - interval '180 days'`, [now]);
  await db.query(`DELETE FROM courier_login_states WHERE expires_at < $1::timestamptz - interval '1 day'`, [now]);
  await db.query(`DELETE FROM incidents WHERE status = 'CLOSED' AND updated_at < $1::timestamptz - interval '365 days'`, [now]);
  await db.query(`DELETE FROM courier_referrals WHERE created_at < $1::timestamptz - interval '365 days'`, [now]);
  await db.query(`DELETE FROM sim_idp_codes WHERE expires_at < $1::timestamptz - interval '1 day'`, [now]);
  await db.query(`DELETE FROM locker_device_events WHERE received_at < $1::timestamptz - interval '30 days'`, [now]);
  const flood = await db.tx(async (tx) => {
    // Keep a summary of each sensor's (or zone's) day before the raw readings go.
    await tx.query(
      `INSERT INTO flood_readings_daily (zone_id, sensor_id, day, readings, min_pct, max_pct, avg_pct)
       SELECT zone_id, sensor_id, (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, count(*), min(level_pct), max(level_pct), round(avg(level_pct), 1)
         FROM flood_readings WHERE created_at < $1::timestamptz - interval '90 days'
        GROUP BY 1, 2, 3
       ON CONFLICT (zone_id, sensor_id, day) DO UPDATE SET readings = flood_readings_daily.readings + EXCLUDED.readings,
              min_pct = least(flood_readings_daily.min_pct, EXCLUDED.min_pct), max_pct = greatest(flood_readings_daily.max_pct, EXCLUDED.max_pct)`,
      [now],
    );
    const readings = await tx.query(`DELETE FROM flood_readings WHERE created_at < $1::timestamptz - interval '90 days' RETURNING id`, [now]);
    const signals = await tx.query(`DELETE FROM flood_signals WHERE created_at < $1::timestamptz - interval '90 days' RETURNING id`, [now]);
    const sms = await tx.query(`DELETE FROM sms_outbox WHERE created_at < $1::timestamptz - interval '30 days' RETURNING id`, [now]);
    return { readings: readings.length, signals: signals.length, sms: sms.length };
  });
  return {
    floodReadingsDeleted: flood.readings,
    floodSignalsDeleted: flood.signals,
    smsDeleted: flood.sms,
    visitorEntriesDeleted: visitors.entries,
    visitorPassesDeleted: visitors.passes,
    routesDeleted: routes.length,
    activitiesClosed: abandoned.length,
    unconfirmedBillsDeleted: bills.length,
    machineSessionsClosed: sessions.length,
    assistantConversationsDeleted: conversations,
    parcelsDeleted: parcels,
    lockerParcelsDeleted: lockerParcels.length,
  };
}
