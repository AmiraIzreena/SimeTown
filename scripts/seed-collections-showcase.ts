import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db, type Queryable } from '../src/server/db/client';
import { audit } from '../src/server/modules/audit';
import { bookCollection, createCollector, reportCollectionWeight, tellMissed } from '../src/server/modules/kitar/collections';
import { todayIn } from '../src/server/modules/settings';
import { scanPass } from '../src/server/modules/tamu/service';
import type { Material } from '../src/shared/domain';

/**
 * Recycling collections the gate record decides, to see and try from both sides: Daniel Tan's Kitar page (resident)
 * and Recycling collections in the console (staff, admins and HQ). Every case is made through the app's own services,
 * at the time it would have happened, with a partner collector who comes every day:
 *
 * - credited after a gate scan; a big e-waste weight counted up to its maximum; closed with no reward (no gate record);
 * - ready for Daniel to enter the weight today (the collector was scanned in);
 * - two missed collections Daniel can dispute with "The collector came": one the gate saw that day (on a neighbour's
 *   pass), so it is credited; one with no gate record, so it stays missed;
 * - one booked ahead with its gate pass;
 * - for staff, To watch: a home with three large weights, and a collector with three missed visits.
 *
 * Safe to run again: it does nothing once Daniel's fridge collection exists. A booking that would break the
 * one-per-day or three-open rules for a home is skipped rather than failing the seed.
 */

const DOMAIN = 'demo.kita.test';
const COLLECTOR = 'Elmina Green Collectors';

async function actorByLogin(db: Queryable, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

/** A township date some days from another ("2026-10-23" minus 3). */
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** That date at a local (Malaysia, UTC+8) hour. */
const at = (day: string, hour: number) => new Date(`${day}T${String(hour - 8).padStart(2, '0')}:00:00Z`);

export async function seedCollectionsShowcase(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  if (await one(db, "SELECT 1 FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id WHERE c.name = $1 AND x.items = 'Old fridge'", [COLLECTOR])) {
    return log('Collections showcase: already there.');
  }
  const logins = ['daniel', 'priya', 'arjun', 'hafiz', 'siti', 'meiling', 'admin', 'guard'] as const;
  const found = await Promise.all(logins.map((l) => actorByLogin(db, l)));
  if (found.some((a) => !a)) return log('Collections showcase: demo accounts missing; skipped.');
  const [daniel, priya, arjun, hafiz, siti, meiling, admin, guard] = found as [Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor];

  const today = await todayIn(db, now);
  const existing = await one<{ id: string }>(db, 'SELECT id FROM recycling_collectors WHERE name = $1', [COLLECTOR]);
  const green = existing?.id ?? (await createCollector(db, admin, {
    name: COLLECTOR, phone: '+60355550103', materials: ['E_WASTE', 'PAPER', 'ALUMINIUM', 'GLASS'],
    schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], time: 'BOTH' }, notes: 'Demo partner: comes every day',
  })).id;

  /** Books a collection for that day, as the household would have the day before. */
  const book = (who: Actor, collectorId: string, day: string, materials: Material[], items: string) =>
    bookCollection(db, who, { collectorId, materials, items, day, slot: 'MORNING' }, at(shift(day, -1), 10));
  /** The nightly job's step for a past visit the gate never saw: missed, pass cancelled, household told. */
  const markMissed = async (id: string, day: string) => {
    await db.tx(async (tx) => {
      const x = await one<{ id: string; user_id: string; day: string; collector: string }>(
        tx,
        `UPDATE recycling_collections x SET status = 'MISSED' FROM recycling_collectors c WHERE c.id = x.collector_id AND x.id = $1
          RETURNING x.id, x.user_id, x.day::text AS day, c.name AS collector`,
        [id],
      );
      await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = (SELECT pass_id FROM recycling_collections WHERE id = $1) AND status = 'ACTIVE'`, [id]);
      await tellMissed(tx, x!);
      await audit(tx, null, 'COLLECTION_MISSED', 'recycling_collection', id, { by: 'recycling job', day });
    });
  };

  // --- Daniel ---------------------------------------------------------------------------------
  // 12 days ago: no gate record that day, weight sent the day after, so no reward.
  const noRecord = shift(today, -12);
  const a = await book(daniel, green, noRecord, ['PAPER'], 'Three boxes of old magazines');
  await reportCollectionWeight(db, daniel, a.id, 6000, at(shift(noRecord, 1), 9));

  // 9 days ago: an old fridge, 120 kg after a gate scan: credited, counted as 100 kg of e-waste.
  const fridge = shift(today, -9);
  const b = await book(daniel, green, fridge, ['E_WASTE'], 'Old fridge');
  await scanPass(db, guard, b.passCode, at(fridge, 10));
  await reportCollectionWeight(db, daniel, b.id, 120_000, at(fridge, 15));

  // 6 days ago: paper, after a gate scan: credited at once.
  const paper = shift(today, -6);
  const c = await book(daniel, green, paper, ['PAPER'], 'Flattened boxes from moving house');
  await scanPass(db, guard, c.passCode, at(paper, 10));
  await reportCollectionWeight(db, daniel, c.id, 12_000, at(paper, 14));

  // 3 days ago: missed, and the gate saw nobody from this collector that day. Disputing it keeps it missed.
  const unseen = shift(today, -3);
  const d = await book(daniel, green, unseen, ['ALUMINIUM'], 'Two bags of drink cans');
  await markMissed(d.id, unseen);

  // 2 days ago: missed on Daniel's pass, but the collector came in on Priya's. Disputing it credits it.
  const seen = shift(today, -2);
  const e = await book(daniel, green, seen, ['E_WASTE'], 'Broken microwave');
  const neighbour = await book(priya, green, seen, ['PAPER'], 'Old school books');
  await scanPass(db, guard, neighbour.passCode, at(seen, 9));
  await reportCollectionWeight(db, priya, neighbour.id, 8000, at(seen, 12));
  await markMissed(e.id, seen);

  // Today: the collector has been scanned in; Daniel can enter the weight (if his home has room for another booking).
  const open = await one<{ n: number; today: number }>(db, "SELECT count(*)::int AS n, count(*) FILTER (WHERE day = $2::date)::int AS today FROM recycling_collections WHERE home_id = $1 AND status IN ('REQUESTED', 'CONFIRMED')", [daniel.homeId, today]);
  if (open!.n < 3 && open!.today === 0) {
    const f = await book(daniel, green, today, ['GLASS'], 'A crate of glass jars');
    await scanPass(db, guard, f.passCode, new Date(Math.min(now.getTime(), at(today, 10).getTime())));
  }

  // Ahead: booked, gate pass ready, can be cancelled (unless Daniel already has a collection booked ahead).
  if (!(await one(db, "SELECT 1 FROM recycling_collections WHERE home_id = $1 AND status IN ('REQUESTED', 'CONFIRMED') AND day > $2::date", [daniel.homeId, today]))) {
    await book(daniel, green, shift(today, 4), ['E_WASTE', 'PAPER'], 'Old printer and its paper');
  }

  // --- To watch, for staff --------------------------------------------------------------------
  // Arjun's home: three large weights in the last month.
  for (const [days, kg] of [[20, 30], [15, 45], [8, 25]] as const) {
    const day = shift(today, -days);
    const x = await book(arjun, green, day, ['E_WASTE'], 'Old electronics from the store room');
    await scanPass(db, guard, x.passCode, at(day, 11));
    await reportCollectionWeight(db, arjun, x.id, kg * 1000, at(day, 16));
  }
  // Minyak Hijau Collectors (Thursdays): three visits it never made.
  const oil = await one<{ id: string }>(db, 'SELECT id FROM recycling_collectors WHERE name = $1', ['Minyak Hijau Collectors']);
  if (oil) {
    const thursdays: string[] = [];
    for (let back = 1; thursdays.length < 3 && back <= 28; back++) {
      const day = shift(today, -back);
      if (new Date(`${day}T00:00:00Z`).getUTCDay() === 4) thursdays.push(day);
    }
    for (const [n, day] of thursdays.entries()) {
      const who = [hafiz, siti, meiling][n]!;
      const x = await book(who, oil.id, day, ['COOKING_OIL'], 'Used cooking oil, two bottles');
      await markMissed(x.id, day);
    }
  }

  log('Collections showcase: Daniel’s collections in every state, and homes and collectors to watch, added.');
}
