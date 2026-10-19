import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { ACTOR_COLUMNS, toActor } from '../../auth/session';
import { getConfig, type Config } from '../../config';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { getSettings, todayIn } from '../settings';
import { scanPass } from '../tamu/service';
import { testEntryEnabled } from './test-entry';

/**
 * Demo helper for booked collections, for local demos only: shows the whole flow
 * in one sitting, without waiting for the collection day or signing in as the guard.
 *
 * It is locked exactly like Kitar test mode (test-entry.ts): a pglite database AND
 * the app in development, checked here on the server before anything else, whoever
 * asks. Only two things are simulated. "Move to today" changes the collection's day
 * and its gate pass window to today. "Pretend the gate scanned" calls the real gate
 * scan as the township's guard account, so the pass checks, the gate log, the
 * "arrived" notice and the weight prompt are all the real ones. The weight, the 20 kg
 * rule, BR6 limits and every notice after that are untouched. Each step is audited
 * as KITAR_DEMO_COLLECTION.
 */

type Lock = Pick<Config, 'APP_ENV' | 'DATABASE_URL'>;

async function loadOwn(db: Db, actor: Actor, id: string, lock: Lock) {
  // First, before anything else and whoever asks: no demo mode, no demo.
  if (!testEntryEnabled(lock)) throw forbidden('Demo mode is off.');
  const resident = requireVerifiedResident(actor);
  const x = await one<{ id: string; status: string; day: string; pass_id: string | null; pass_code: string | null; gate_scanned: boolean; held: boolean }>(
    db,
    `SELECT x.id, x.status, x.day::text AS day, x.pass_id, p.code AS pass_code, (x.reported_weight_g IS NOT NULL OR x.review_reason IS NOT NULL) AS held,
            EXISTS (SELECT 1 FROM visitor_entries e WHERE e.pass_id = x.pass_id) AS gate_scanned
       FROM recycling_collections x LEFT JOIN visitor_passes p ON p.id = x.pass_id
      WHERE x.id = $1 AND x.home_id = $2`,
    [id, resident.homeId],
  );
  // Another household's collection is simply not found.
  if (!x) throw notFound('Collection');
  if (x.status !== 'CONFIRMED') throw conflict('COLLECTION_CLOSED', 'Only a confirmed collection can be used in the demo.');
  if (x.held) throw conflict('WEIGHT_ALREADY_SENT', 'You have already sent the weight for this collection.');
  return { resident, x };
}

/** Demo: the collection and its gate pass move to today. Nothing else changes. */
export async function demoMoveToToday(db: Db, actor: Actor, id: string, now: Date, lock: Lock = getConfig()) {
  const { resident } = await loadOwn(db, actor, id, lock);
  return db.tx(async (tx) => {
    const x = (await one<{ day: string; pass_id: string | null; status: string; scanned: boolean }>(
      tx,
      `SELECT x.day::text AS day, x.pass_id, x.status, EXISTS (SELECT 1 FROM visitor_entries e WHERE e.pass_id = x.pass_id) AS scanned
         FROM recycling_collections x WHERE x.id = $1 FOR UPDATE`,
      [id],
    ))!;
    if (x.status !== 'CONFIRMED') throw conflict('COLLECTION_CLOSED', 'Only a confirmed collection can be used in the demo.');
    if (x.scanned) throw conflict('ALREADY_SCANNED', 'The gate has already scanned this pass.');
    const today = await todayIn(tx, now);
    if (x.day === today) return { day: today };
    // The booking rule still holds: one open collection per home per day.
    const clash = await one(tx, `SELECT 1 FROM recycling_collections WHERE home_id = $1 AND id <> $2 AND day = $3::date AND status IN ('REQUESTED', 'CONFIRMED')`, [resident.homeId, id, today]);
    if (clash) throw conflict('ALREADY_BOOKED', 'Your home already has a collection today.');
    await tx.query('UPDATE recycling_collections SET day = $2::date WHERE id = $1', [id, today]);
    if (x.pass_id) {
      const tz = (await getSettings(tx)).timezone;
      await tx.query(
        `UPDATE visitor_passes SET valid_from = ($2::date::timestamp AT TIME ZONE $3), valid_until = (($2::date + 1)::timestamp AT TIME ZONE $3) WHERE id = $1`,
        [x.pass_id, today, tz],
      );
    }
    await audit(tx, resident.id, 'KITAR_DEMO_COLLECTION', 'recycling_collection', id, { step: 'MOVE_TO_TODAY', from: x.day, to: today });
    return { day: today };
  });
}

/** Demo: the real gate scan, made with the township's guard account. The household is then asked for the weight as usual. */
export async function demoGateScan(db: Db, actor: Actor, id: string, now: Date, lock: Lock = getConfig()) {
  const { resident, x } = await loadOwn(db, actor, id, lock);
  if (!x.pass_code) throw ruleViolation('NO_PASS', 'This collection has no gate pass.');
  if (x.gate_scanned) throw conflict('ALREADY_SCANNED', 'The gate has already scanned this pass.');
  const guardRow = await one<Parameters<typeof toActor>[0]>(
    db,
    `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.township_id = $1 AND u.role = 'GUARD' AND u.status = 'ACTIVE' ORDER BY u.created_at LIMIT 1`,
    [resident.townshipId],
  );
  if (!guardRow) throw ruleViolation('NO_GUARD', 'This township has no guard account to stand in for the gate.');
  const guard = toActor(guardRow);
  // The real scan: refuses a pass that is not valid yet, records the entry and tells the household.
  const entry = await scanPass(db, guard, x.pass_code, now);
  await audit(db, resident.id, 'KITAR_DEMO_COLLECTION', 'recycling_collection', id, { step: 'GATE_SCAN', entryId: entry.entryId, guardId: guard.id });
  return { scanned: true as const };
}
