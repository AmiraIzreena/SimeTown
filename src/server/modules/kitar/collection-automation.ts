import type { Db } from '../../db/client';
import { audit } from '../audit';
import { notify } from '../notifications';
import { todayIn } from '../settings';
import { CLOSE_UNWEIGHED_AFTER_DAYS, collectionFlags, confirmWaitingRequests, FLAG_WINDOW_DAYS, tellMissed } from './collections';

/**
 * The collections clock, run nightly by the scheduler (the `recycling` job).
 * It confirms any request still waiting from before bookings confirmed
 * themselves; reminds a household the day before; marks a past collection the gate never
 * scanned, and nobody weighed, as missed and cancels its pass; closes one the
 * gate scanned but nobody weighed after CLOSE_UNWEIGHED_AFTER_DAYS, with no
 * weight and no points; and flags homes and collectors that keep tripping the
 * rules. It never credits anything, and never touches a collection waiting for
 * review. Every step is guarded by the row's state and every notice has a
 * dedupe key, so running it twice changes nothing.
 */
export async function runCollectionChecks(db: Db, now: Date) {
  const today = await todayIn(db, now);
  const counts = { confirmed: 0, reminders: 0, missed: 0, closedUnweighed: 0, homeFlags: 0, collectorFlags: 0 };

  // Requests from before bookings confirmed themselves: confirmed now, with the gate pass.
  counts.confirmed = await confirmWaitingRequests(db, now);

  // The day before: a reminder with the pass.
  const tomorrow = await db.query<{ id: string; user_id: string; collector: string; pass_code: string }>(
    `SELECT x.id, x.user_id, c.name AS collector, p.code AS pass_code
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN visitor_passes p ON p.id = x.pass_id
      WHERE x.status = 'CONFIRMED' AND x.day = $1::date + 1`,
    [today],
  );
  for (const x of tomorrow) {
    counts.reminders += await notify(db, [x.user_id], {
      title: 'Collection tomorrow', body: `${x.collector} comes tomorrow. Gate pass ${x.pass_code} is ready in Tamu.`,
      link: '/app/kitar', category: 'RECYCLING', dedupeKey: `kitar-collection-reminder:${x.id}`,
    });
  }

  // A past day with no gate scan and no weight: it did not happen.
  await db.tx(async (tx) => {
    const missed = await tx.query<{ id: string; user_id: string; pass_id: string | null; day: string; collector: string }>(
      `UPDATE recycling_collections x SET status = 'MISSED' FROM recycling_collectors c
        WHERE c.id = x.collector_id AND x.status IN ('REQUESTED', 'CONFIRMED') AND x.day < $1::date
          AND x.reported_weight_g IS NULL AND x.review_reason IS NULL
          AND NOT EXISTS (SELECT 1 FROM visitor_entries e WHERE e.pass_id = x.pass_id)
        RETURNING x.id, x.user_id, x.pass_id, x.day::text AS day, c.name AS collector`,
      [today],
    );
    const passes = missed.flatMap((x) => (x.pass_id ? [x.pass_id] : []));
    if (passes.length) await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [passes]);
    for (const x of missed) {
      await tellMissed(tx, x);
      await audit(tx, null, 'COLLECTION_MISSED', 'recycling_collection', x.id, { by: 'recycling job' });
    }
    counts.missed = missed.length;
  });

  // The gate scanned the collector but nobody sent a weight in time: closed, no weight, no points.
  await db.tx(async (tx) => {
    const closed = await tx.query<{ id: string }>(
      `UPDATE recycling_collections x SET status = 'COLLECTED', collected_at = $2
        WHERE x.status = 'CONFIRMED' AND x.day <= $1::date - $3::int
          AND x.reported_weight_g IS NULL AND x.review_reason IS NULL
          AND EXISTS (SELECT 1 FROM visitor_entries e WHERE e.pass_id = x.pass_id)
        RETURNING x.id`,
      [today, now, CLOSE_UNWEIGHED_AFTER_DAYS],
    );
    for (const x of closed) await audit(tx, null, 'COLLECTION_CLOSED_UNWEIGHED', 'recycling_collection', x.id, { by: 'recycling job' });
    counts.closedUnweighed = closed.length;
  });

  // Homes and collectors to look at: the township's staff and SDP HQ, once per run of events.
  const flags = await collectionFlags(db, null, now);
  const staffOf = async (townshipId: string) =>
    (await db.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'ACTIVE' AND (role = 'HQ_ADMIN' OR (township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN')))`,
      [townshipId],
    )).map((u) => u.id);
  for (const h of flags.homes) {
    const sent = await notify(db, await staffOf(h.township_id), {
      title: 'Home to check: recycling', body: `${h.house} (${h.township}) has ${h.events} large weights or reward limit hits in ${FLAG_WINDOW_DAYS} days.`,
      link: '/console/recycling', category: 'RECYCLING', dedupeKey: `kitar-flag-home:${h.home_id}:${h.first_id}`,
    });
    if (sent) counts.homeFlags++;
  }
  for (const c of flags.collectors) {
    const sent = await notify(db, await staffOf(c.township_id), {
      title: 'Collector to check', body: `${c.collector} (${c.township}) missed ${c.events} collections in ${FLAG_WINDOW_DAYS} days.`,
      link: '/console/recycling', category: 'RECYCLING', dedupeKey: `kitar-flag-collector:${c.collector_id}:${c.first_id}`,
    });
    if (sent) counts.collectorFlags++;
  }
  return counts;
}
