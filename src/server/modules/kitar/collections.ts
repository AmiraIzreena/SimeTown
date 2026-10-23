import { BOOK_AHEAD_DAYS, formatSchedule, worksOn, type Schedule } from '@/shared/collector-schedule';
import { MATERIAL_INFO, shortAddress, type HomeAddress, type Material } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { badRequest, conflict, notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { notify } from '../notifications';
import { recordAction, rewardUserById } from '../rewards';
import { getSettings, todayIn } from '../settings';
import { insertPass } from '../tamu/service';
import { HOME_ADDRESS_COLUMNS, listScope, resolveTownship } from '../townships';
import { testEntryEnabled } from './test-entry';

/**
 * Kitar collections (the brief's "book local collections"). Partner collectors
 * list what they accept and when they come. A household books a pickup for
 * bulky or special items; the booking is confirmed at once and the collector
 * gets a Tamu contractor pass for that day, so the gate expects them. The
 * household types the weight, and the gate record decides it without staff: if the
 * collector was scanned in that day (on this pass or another home's), it is credited
 * (Impact XP and any funded campaign's points, never per-kg offer-backed points, BR23),
 * counted up to a maximum for the material; if not, it closes with no reward. The
 * nightly `recycling` job decides weights sent on the day itself and closes the rest
 * (collection-automation.ts). Staff only watch homes and collectors that keep
 * tripping the rules.
 */

export const COLLECTION_SLOTS = ['MORNING', 'AFTERNOON'] as const;
export type CollectionSlot = (typeof COLLECTION_SLOTS)[number];
const MAX_OPEN_PER_HOME = 3;
/** A weight over this is "large": a home that keeps sending large weights is flagged for staff to watch. */
export const AUTO_ACCEPT_MAX_G = 20_000;
/**
 * The most a collection counts for, by material, toward township figures and weight-based challenge goals (a fridge
 * is e-waste and weighs 50 to 70 kg). The household's own figure is kept as they sent it. The flat Impact XP for a
 * collection does not depend on its weight.
 */
export const COUNT_UP_TO_G: Record<Material, number> = {
  E_WASTE: 100_000, PAPER: 50_000, GLASS: 30_000, TEXTILE: 30_000, PLASTIC_PET: 20_000, PLASTIC_OTHER: 20_000, ALUMINIUM: 20_000, COOKING_OIL: 20_000,
};
/** What a collection's weight counts for: up to the highest maximum among its materials. */
export const countedWeight = (materials: readonly Material[], weightG: number) => Math.min(weightG, Math.max(...materials.map((m) => COUNT_UP_TO_G[m] ?? AUTO_ACCEPT_MAX_G)));
/** A collection the gate scanned but nobody weighed closes this many days after its day, with no points. */
export const CLOSE_UNWEIGHED_AFTER_DAYS = 2;
/** How long after a missed collection the household can still say the collector came. */
export const DISPUTE_DAYS = 7;
/** A home or a collector is flagged for staff at this many events inside the window. */
export const FLAG_THRESHOLD = 3;
export const FLAG_WINDOW_DAYS = 30;

export const REVIEW_REASONS = ['OVER_LIMIT', 'NO_GATE_SCAN', 'COLLECTOR_CAME'] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

const kgText = (g: number) => (g / 1000).toLocaleString('en-MY', { maximumFractionDigits: 1 });
/** The collector's gate pass has been scanned at the gate at least once. */
const GATE_SCANNED = 'EXISTS (SELECT 1 FROM visitor_entries e WHERE e.pass_id = x.pass_id)';
/**
 * The collector was scanned in at the gate on the collection's day, on any home's pass: they were in the township.
 * A collector visiting several homes often shows one pass only.
 */
const COLLECTOR_AT_GATE = `EXISTS (SELECT 1 FROM recycling_collections y JOIN visitor_entries e ON e.pass_id = y.pass_id
  WHERE y.collector_id = x.collector_id AND y.day = x.day)`;

const tellResident = (tx: Queryable, userId: string, n: { title: string; body: string; dedupeKey?: string }) =>
  notify(tx, [userId], { ...n, link: '/app/kitar', category: 'RECYCLING' });

/**
 * Active collectors in the resident's township. Given a day and a time, only those
 * who work then (see collector-schedule.ts); one with an older free-text schedule
 * always counts as available.
 */
export async function listCollectors(db: Db, actor: Actor, filter: { material?: Material; day?: string; slot?: CollectionSlot } = {}) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<{ id: string; name: string; phone: string | null; materials: Material[]; days: string; notes: string | null }>(
    `SELECT id, name, phone, materials, days, notes FROM recycling_collectors
      WHERE township_id = $1 AND active AND ($2::text IS NULL OR $2 = ANY(materials)) ORDER BY name`,
    [resident.townshipId, filter.material ?? null],
  );
  return filter.day && filter.slot ? rows.filter((c) => worksOn(c.days, filter.day!, filter.slot!)) : rows;
}

export async function listCollectorsForStaff(db: Db, actor: Actor, townshipId?: string) {
  return db.query(
    `SELECT c.id, c.name, c.phone, c.materials, c.days, c.notes, c.active, t.name AS township,
            (SELECT count(*)::int FROM recycling_collections x WHERE x.collector_id = c.id AND x.status = 'COLLECTED') AS collections,
            (SELECT coalesce(sum(x.weight_g), 0)::int FROM recycling_collections x WHERE x.collector_id = c.id AND x.status = 'COLLECTED') AS collected_g
       FROM recycling_collectors c JOIN townships t ON t.id = c.township_id
      WHERE ($1::uuid IS NULL OR c.township_id = $1) ORDER BY c.active DESC, c.name`,
    [listScope(actor, townshipId)],
  );
}

export interface CollectorInput {
  name: string;
  phone?: string;
  materials: Material[];
  /** When they work. The console always sends this; it is stored in the days column (collector-schedule.ts). */
  schedule?: Schedule;
  /** Older free text, still accepted from scripts. Read as "any day and time". */
  days?: string;
  notes?: string;
  /** SDP HQ names the township; township admins add to their own. */
  townshipId?: string;
}

export async function createCollector(db: Db, actor: Actor, input: CollectorInput) {
  const days = input.schedule ? formatSchedule(input.schedule) : input.days?.trim();
  if (!days || (input.schedule && input.schedule.days.length === 0)) throw badRequest('Choose at least one day.');
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor, input.townshipId);
    if (await one(tx, 'SELECT 1 FROM recycling_collectors WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('COLLECTOR_EXISTS', 'A collector with this name already exists.');
    }
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO recycling_collectors (township_id, name, phone, materials, days, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [townshipId, input.name.trim(), input.phone?.trim() || null, [...new Set(input.materials)], days, input.notes?.trim() || null],
    );
    await audit(tx, actor.id, 'COLLECTOR_CREATED', 'recycling_collector', row!.id, { name: input.name });
    return { id: row!.id };
  });
}

export async function setCollectorActive(db: Db, actor: Actor, id: string, active: boolean) {
  const c = await one<{ township_id: string }>(db, 'SELECT township_id FROM recycling_collectors WHERE id = $1', [id]);
  if (!c) throw notFound('Collector');
  assertTownshipAccess(actor, c.township_id);
  await db.query('UPDATE recycling_collectors SET active = $2 WHERE id = $1', [id, active]);
  return { ok: true };
}

export interface BookingInput {
  collectorId: string;
  materials: Material[];
  items: string;
  day: string;
  slot: CollectionSlot;
}

/** The collector's gate pass: a contractor pass for the whole collection day. */
async function issuePass(tx: Queryable, x: { townshipId: string; homeId: string; userId: string; collector: string; day: string }, now: Date) {
  const tz = (await getSettings(tx)).timezone;
  const window = await one<{ from: Date; until: Date }>(
    tx,
    `SELECT ($1::date::timestamp AT TIME ZONE $2) AS "from", (($1::date + 1)::timestamp AT TIME ZONE $2) AS until`,
    [x.day, tz],
  );
  return insertPass(
    tx,
    { townshipId: x.townshipId, homeId: x.homeId, hostUserId: x.userId, type: 'CONTRACTOR', visitorName: `${x.collector} (recycling collection)`, validFrom: window!.from, validUntil: window!.until },
    now,
  );
}

/**
 * A household books a pickup with a collector who takes those materials. Every
 * check below passed, so it is confirmed in the same step and the gate gets the
 * collector's pass: no one has to approve it.
 */
export async function bookCollection(db: Db, actor: Actor, input: BookingInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [resident.homeId]);
    const collector = await one<{ name: string; materials: Material[]; days: string }>(
      tx, 'SELECT name, materials, days FROM recycling_collectors WHERE id = $1 AND township_id = $2 AND active', [input.collectorId, resident.townshipId],
    );
    if (!collector) throw notFound('Collector');
    const notTaken = input.materials.filter((m) => !collector.materials.includes(m));
    if (notTaken.length) {
      throw ruleViolation('NOT_ACCEPTED', `${collector.name} does not take ${notTaken.map((m) => MATERIAL_INFO[m].label.toLowerCase()).join(', ')}.`);
    }
    const today = await todayIn(tx, now);
    const range = await one<{ ok: boolean }>(tx, `SELECT $1::date > $2::date AND $1::date <= $2::date + $3::int AS ok`, [input.day, today, BOOK_AHEAD_DAYS]);
    if (!range!.ok) throw ruleViolation('COLLECTION_DAY', `Choose a day from tomorrow up to ${BOOK_AHEAD_DAYS} days ahead.`);
    if (!worksOn(collector.days, input.day, input.slot)) {
      throw ruleViolation('COLLECTOR_NOT_AVAILABLE', `${collector.name} does not collect on that day or time. Choose another day or time.`);
    }
    const open = await one<{ n: number; same_day: number }>(
      tx,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE day = $2::date)::int AS same_day FROM recycling_collections
        WHERE home_id = $1 AND status IN ('REQUESTED', 'CONFIRMED')`,
      [resident.homeId, input.day],
    );
    if (open!.same_day > 0) throw conflict('ALREADY_BOOKED', 'Your home already has a collection that day.');
    if (open!.n >= MAX_OPEN_PER_HOME) throw ruleViolation('TOO_MANY_COLLECTIONS', `Your home can have up to ${MAX_OPEN_PER_HOME} collections booked at a time.`);
    const pass = await issuePass(tx, { townshipId: resident.townshipId, homeId: resident.homeId, userId: resident.id, collector: collector.name, day: input.day }, now);
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO recycling_collections (township_id, home_id, user_id, collector_id, materials, items, day, slot, created_at, status, confirmed_at, pass_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIRMED', $9, $10) RETURNING id`,
      [resident.townshipId, resident.homeId, resident.id, input.collectorId, [...new Set(input.materials)], input.items.trim(), input.day, input.slot, now, pass.id],
    );
    await tellResident(tx, resident.id, { title: 'Collection booked', body: `${collector.name} comes on ${input.day}. Gate pass ${pass.code} is ready in Tamu.` });
    return { id: row!.id, status: 'CONFIRMED' as const, passCode: pass.code };
  });
}

/**
 * The home's collections, with what the household can do next: type the weight
 * (on or after the day, while the collection is open) or, on a missed one, say
 * the collector came after all. On a local demo only (collection-demo.ts), a
 * confirmed collection also says which demo steps it offers.
 */
export async function myCollections(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const today = await todayIn(db, now);
  const demo = testEntryEnabled(getConfig());
  return db.query(
    `SELECT x.id, x.materials, x.items, x.day::text AS day, x.slot, x.status, x.weight_g, x.created_at, x.confirmed_at, x.collected_at,
            c.name AS collector, c.phone AS collector_phone, p.code AS pass_code,
            ${GATE_SCANNED} AS gate_scanned, x.reported_weight_g,
            (x.review_reason IS NOT NULL AND x.reviewed_at IS NULL) AS in_review,
            (x.status = 'CONFIRMED' AND x.reported_weight_g IS NOT NULL AND x.review_reason IS NULL) AS waiting_for_gate,
            ${COLLECTOR_AT_GATE} AS collector_at_gate, x.decided_by,
            (x.status = 'COLLECTED' AND x.weight_g IS NULL AND x.reviewed_at IS NOT NULL) AS no_reward,
            (x.status = 'CONFIRMED' AND x.reported_weight_g IS NULL AND x.review_reason IS NULL AND x.day <= $2::date) AS can_report,
            (x.status = 'MISSED' AND x.review_reason IS NULL AND x.day >= $2::date - $3::int) AS can_dispute,
            ($4::boolean AND x.status = 'CONFIRMED' AND NOT ${GATE_SCANNED} AND x.reported_weight_g IS NULL AND x.review_reason IS NULL) AS demo,
            (x.day = $2::date) AS is_today
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id LEFT JOIN visitor_passes p ON p.id = x.pass_id
      WHERE x.home_id = $1 ORDER BY x.day DESC, x.created_at DESC LIMIT 30`,
    [resident.homeId, today, DISPUTE_DAYS, demo],
  );
}

interface CreditTarget {
  id: string;
  user_id: string;
  collector: string;
}

/**
 * The one credit step for a collection, whoever supplies the weight: the
 * collection is closed as collected and the household earns Impact XP and any
 * funded campaign's points, inside its daily and monthly limits (BR6). It never
 * earns per-kg offer-backed points: only a signed bin record can (BR23).
 */
async function creditCollection(tx: Queryable, x: CreditTarget, weightG: number, now: Date, title = 'Collection recorded') {
  await tx.query(`UPDATE recycling_collections SET status = 'COLLECTED', weight_g = $2, collected_at = $3 WHERE id = $1`, [x.id, weightG, now]);
  const user = await rewardUserById(tx, x.user_id);
  const reward = user ? await recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: `collection:${x.id}`, quantity: weightG, now }) : null;
  const limitHit = reward?.skipped === 'DAILY_LIMIT' || reward?.skipped === 'MONTHLY_LIMIT' ? reward.skipped : null;
  if (limitHit) await tx.query('UPDATE recycling_collections SET limit_hit = $2 WHERE id = $1', [x.id, limitHit]);
  const kg = kgText(weightG);
  const body = limitHit
    ? `${kg} kg recorded. Your home has reached its recycling reward limit for now.`
    : !reward?.xp
      ? `${kg} kg recorded.`
      : reward.points
        ? `${kg} kg recorded: +${reward.xp} Impact XP and +${reward.points} points.`
        : `${kg} kg recorded: +${reward.xp} Impact XP.`;
  await tellResident(tx, x.user_id, { title, body, dedupeKey: `kitar-collection-recorded:${x.id}` });
  return reward;
}

interface ResidentCollectionRow extends CreditTarget {
  township_id: string;
  status: string;
  day: string;
  materials: Material[];
  reported_weight_g: number | null;
  review_reason: ReviewReason | null;
  gate_scanned: boolean;
  collector_at_gate: boolean;
}

const RESIDENT_ROW = `SELECT x.id, x.user_id, x.township_id, x.status, x.day::text AS day, x.materials, x.reported_weight_g, x.review_reason, c.name AS collector,
         ${GATE_SCANNED} AS gate_scanned, ${COLLECTOR_AT_GATE} AS collector_at_gate
    FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id`;

async function loadForResident(tx: Queryable, actor: Actor, id: string) {
  const resident = requireVerifiedResident(actor);
  const x = await one<ResidentCollectionRow>(tx, `${RESIDENT_ROW} WHERE x.id = $1 AND x.home_id = $2 FOR UPDATE OF x`, [id, resident.homeId]);
  if (!x) throw notFound('Collection');
  return x;
}

/** The gate saw the collector that day: credits the weight, counted up to the material's maximum. */
async function creditByGateRecord(tx: Queryable, x: ResidentCollectionRow, weightG: number, now: Date, actorId: string | null) {
  const counted = countedWeight(x.materials, weightG);
  const reward = await creditCollection(tx, x, counted, now);
  await audit(tx, actorId, 'COLLECTION_WEIGHT_ACCEPTED', 'recycling_collection', x.id, { weightG, countedG: counted, evidence: x.gate_scanned ? 'OWN_PASS' : 'SAME_DAY_VISIT' });
  return reward;
}

/** No gate record of the collector that day: the collection closes with no reward, decided by the system. */
async function closeWithoutGateRecord(tx: Queryable, x: ResidentCollectionRow, now: Date) {
  await tx.query(
    `UPDATE recycling_collections SET status = 'COLLECTED', collected_at = $2, review_reason = 'NO_GATE_SCAN', reviewed_at = $2, decided_by = 'SYSTEM' WHERE id = $1`,
    [x.id, now],
  );
  await tellResident(tx, x.user_id, {
    title: 'No reward for this collection',
    body: `The gate has no record of ${x.collector} on ${x.day}, so no Impact XP was given. Next time, make sure they show their pass at the gate.`,
    dedupeKey: `kitar-collection-no-gate:${x.id}`,
  });
  await audit(tx, null, 'COLLECTION_NO_GATE_RECORD', 'recycling_collection', x.id, { weightG: x.reported_weight_g, by: 'system' });
}

/**
 * The household types what the collector took, and the gate record decides it at once: the collector scanned in that
 * day (on this pass or another home's) credits it; no record closes it with no reward. On the collection day itself
 * the collector may still reach the gate, so a weight with no record yet waits for the nightly check.
 */
export async function reportCollectionWeight(db: Db, actor: Actor, id: string, weightG: number, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForResident(tx, actor, id);
    if (x.status !== 'CONFIRMED') throw conflict('COLLECTION_CLOSED', 'This collection is already closed.');
    if (x.reported_weight_g !== null || x.review_reason !== null) throw conflict('WEIGHT_ALREADY_SENT', 'You have already sent the weight for this collection.');
    const today = await todayIn(tx, now);
    if (x.day > today) throw ruleViolation('COLLECTION_NOT_YET', 'You can add the weight on the collection day.');
    await tx.query('UPDATE recycling_collections SET reported_weight_g = $2, reported_at = $3 WHERE id = $1', [id, weightG, now]);

    if (x.gate_scanned || x.collector_at_gate) {
      return { status: 'COLLECTED' as const, reward: await creditByGateRecord(tx, x, weightG, now, actor.id) };
    }
    if (x.day === today) {
      await tellResident(tx, x.user_id, {
        title: 'Weight received',
        body: `The gate has no record of ${x.collector} yet today. It is checked tonight, and you will hear the result.`,
        dedupeKey: `kitar-collection-waiting:${id}`,
      });
      await audit(tx, actor.id, 'COLLECTION_WEIGHT_WAITING', 'recycling_collection', id, { weightG });
      return { status: 'WAITING_FOR_GATE' as const };
    }
    await closeWithoutGateRecord(tx, { ...x, reported_weight_g: weightG }, now);
    return { status: 'NO_GATE_RECORD' as const };
  });
}

/**
 * The nightly check for weights sent on the collection day before the gate had seen the collector: now the day is
 * over, the gate record decides each one. Run by the `recycling` job; safe to run again.
 */
export async function settleWaitingWeights(db: Db, now: Date) {
  const today = await todayIn(db, now);
  const waiting = await db.query<{ id: string }>(
    `SELECT id FROM recycling_collections WHERE status = 'CONFIRMED' AND reported_weight_g IS NOT NULL AND review_reason IS NULL AND day < $1::date`,
    [today],
  );
  let credited = 0;
  let closed = 0;
  for (const { id } of waiting) {
    await db.tx(async (tx) => {
      const x = await one<ResidentCollectionRow>(tx, `${RESIDENT_ROW} WHERE x.id = $1 FOR UPDATE OF x`, [id]);
      if (!x || x.status !== 'CONFIRMED' || x.review_reason !== null || x.reported_weight_g === null) return;
      if (x.gate_scanned || x.collector_at_gate) {
        await creditByGateRecord(tx, x, x.reported_weight_g, now, null);
        credited++;
      } else {
        await closeWithoutGateRecord(tx, x, now);
        closed++;
      }
    });
  }
  return { credited, closed };
}

/**
 * On a collection marked missed, the household says the collector did come, with the weight they took. The gate record
 * decides at once: the collector scanned in that day for another home credits it; no record keeps it missed.
 */
export async function reportCollectorCame(db: Db, actor: Actor, id: string, weightG: number, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForResident(tx, actor, id);
    if (x.status !== 'MISSED') throw conflict('COLLECTION_NOT_MISSED', 'Only a missed collection can be reported this way.');
    if (x.review_reason !== null) throw conflict('ALREADY_REPORTED', 'You have already reported this collection.');
    const open = await one<{ ok: boolean }>(tx, 'SELECT $1::date >= $2::date - $3::int AS ok', [x.day, await todayIn(tx, now), DISPUTE_DAYS]);
    if (!open!.ok) throw ruleViolation('DISPUTE_CLOSED', `This can be reported up to ${DISPUTE_DAYS} days after the collection day.`);
    await tx.query(
      `UPDATE recycling_collections SET reported_weight_g = $2, reported_at = $3, review_reason = 'COLLECTOR_CAME', reviewed_at = $3, decided_by = 'SYSTEM' WHERE id = $1`,
      [id, weightG, now],
    );
    if (x.collector_at_gate) {
      // They were in the township that day: not a miss after all.
      return { status: 'COLLECTED' as const, reward: await creditByGateRecord(tx, x, weightG, now, actor.id) };
    }
    await tellResident(tx, x.user_id, {
      title: 'The collection stays missed',
      body: `The gate has no record of ${x.collector} on ${x.day}, so no Impact XP was given. Next time, make sure they show their pass at the gate.`,
      dedupeKey: `kitar-collection-dispute:${id}`,
    });
    await audit(tx, actor.id, 'COLLECTION_DISPUTE_NO_GATE_RECORD', 'recycling_collection', id, { weightG, by: 'system' });
    return { status: 'MISSED' as const };
  });
}

export async function cancelCollection(db: Db, actor: Actor, id: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const x = await one<{ status: string; pass_id: string | null; day: string }>(
      tx, 'SELECT status, pass_id, day::text AS day FROM recycling_collections WHERE id = $1 AND home_id = $2 FOR UPDATE', [id, resident.homeId],
    );
    if (!x) throw notFound('Collection');
    if (!['REQUESTED', 'CONFIRMED'].includes(x.status) || x.day < (await todayIn(tx, now))) throw conflict('COLLECTION_CLOSED', 'This collection can no longer be cancelled.');
    await tx.query(`UPDATE recycling_collections SET status = 'CANCELLED' WHERE id = $1`, [id]);
    if (x.pass_id) await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = $1 AND status = 'ACTIVE'`, [x.pass_id]);
    return { ok: true };
  });
}

const withHouse = <T extends HomeAddress>({ property_type, house_no, building, street, precinct, postcode, city, state, ...rest }: T) => ({
  ...rest,
  house: shortAddress({ property_type, house_no, building, street, precinct, postcode, city, state }),
});

/**
 * Recent collections, newest day first, for the read-only "handled automatically"
 * list. Each row says how it was settled, so staff can see the system at work.
 */
export async function collectionsForStaff(db: Db, actor: Actor, filter: { status?: string; townshipId?: string } = {}) {
  const rows = await db.query<HomeAddress & Record<string, unknown>>(
    `SELECT x.id, x.home_id, x.materials, x.items, x.day::text AS day, x.slot, x.status, x.weight_g, x.reported_weight_g, x.created_at,
            x.reviewed_at, x.decided_by, x.review_reason, (x.review_reason IS NOT NULL AND x.reviewed_at IS NULL) AS in_review, ${GATE_SCANNED} AS gate_scanned,
            c.name AS collector, t.name AS township, ${HOME_ADDRESS_COLUMNS}
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN homes h ON h.id = x.home_id JOIN townships t ON t.id = x.township_id
      WHERE ($1::uuid IS NULL OR x.township_id = $1) AND ($2::text IS NULL OR x.status = $2)
      ORDER BY x.day DESC, x.created_at DESC LIMIT 100`,
    [listScope(actor, filter.townshipId), filter.status ?? null],
  );
  return rows.map(withHouse);
}

/** How a collection ended up, as the history filters name it. */
export const HISTORY_OUTCOMES = ['BOOKED', 'CREDITED', 'NO_REWARD', 'MISSED', 'CANCELLED'] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];
const OUTCOME_SQL: Record<HistoryOutcome, string> = {
  BOOKED: `x.status IN ('REQUESTED', 'CONFIRMED')`,
  CREDITED: `x.status = 'COLLECTED' AND x.weight_g IS NOT NULL`,
  NO_REWARD: `x.status = 'COLLECTED' AND x.weight_g IS NULL`,
  MISSED: `x.status = 'MISSED'`,
  CANCELLED: `x.status = 'CANCELLED'`,
};
/** Who settled it: staff (a review, or a weight they recorded), the system (everything else that is closed), or nobody yet. */
const SETTLED_BY = `CASE
    WHEN x.decided_by = 'STAFF' OR (x.reviewed_at IS NOT NULL AND x.decided_by IS NULL) OR (x.reported_weight_g IS NULL AND x.weight_g IS NOT NULL) THEN 'STAFF'
    WHEN x.status IN ('COLLECTED', 'MISSED') THEN 'SYSTEM' END`;

export interface HistoryFilter extends PageQuery {
  townshipId?: string;
  q?: string;
  outcome?: HistoryOutcome;
  collectorId?: string;
  material?: Material;
  /** Days back from today, by collection day; absent for all time. */
  days?: number;
  settledBy?: 'SYSTEM' | 'STAFF';
}

/**
 * Collection history for staff, admins and HQ: every collection with what the household logged (the weight they
 * typed and when), what was counted, the gate record and who settled it. Searchable by household, resident, collector
 * or item, filtered by outcome, collector, material, period and who settled it, newest collection day first. The first
 * page also carries the total, the count for each outcome (with the other filters applied) and the collectors to pick.
 */
export async function collectionHistory(db: Db, actor: Actor, filter: HistoryFilter, now: Date) {
  const scope = listScope(actor, filter.townshipId);
  const today = await todayIn(db, now);
  const params: unknown[] = [scope];
  const add = (value: unknown) => `$${params.push(value)}`;
  const where: string[] = ['($1::uuid IS NULL OR x.township_id = $1)'];
  const q = filter.q?.trim();
  if (q) {
    const p = add(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.name ILIKE ${p} OR x.items ILIKE ${p} OR u.full_name ILIKE ${p} OR concat_ws(' ', h.house_no, h.building, h.street, h.precinct) ILIKE ${p})`);
  }
  if (filter.collectorId) where.push(`x.collector_id = ${add(filter.collectorId)}::uuid`);
  if (filter.material) where.push(`${add(filter.material)} = ANY(x.materials)`);
  if (filter.days) where.push(`x.day >= ${add(today)}::date - ${add(filter.days)}::int`);
  if (filter.settledBy) where.push(`(${SETTLED_BY}) = ${add(filter.settledBy)}`);
  const base = `FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN homes h ON h.id = x.home_id
                JOIN users u ON u.id = x.user_id JOIN townships t ON t.id = x.township_id
               WHERE ${where.join(' AND ')}`;
  const countParams = [...params];

  const outcome = filter.outcome ? ` AND ${OUTCOME_SQL[filter.outcome]}` : '';
  const [afterDay, afterId] = decodeCursor(filter.cursor, 'time');
  const page = afterDay && afterId ? ` AND (x.day, x.id) < (${add(afterDay.slice(0, 10))}::date, ${add(afterId)}::uuid)` : '';
  const rows = await db.query<HomeAddress & Record<string, unknown> & { day: string; id: string }>(
    `SELECT x.id, x.day::text AS day, x.slot, x.status, x.materials, x.items, x.reported_weight_g, x.reported_at, x.weight_g, x.collected_at,
            x.created_at, x.review_reason, x.reviewed_at, x.limit_hit, ${SETTLED_BY} AS settled_by,
            ${GATE_SCANNED} AS gate_scanned, ${COLLECTOR_AT_GATE} AS collector_at_gate,
            c.id AS collector_id, c.name AS collector, u.full_name AS resident, t.name AS township, ${HOME_ADDRESS_COLUMNS}
       ${base}${outcome}${page}
      ORDER BY x.day DESC, x.id DESC LIMIT ${add(filter.limit + 1)}`,
    params,
  );
  const result = toPage(rows, filter.limit, (r) => [`${r.day}T00:00:00.000Z`, r.id]);
  const items = result.items.map(withHouse);
  // Later pages only add rows: the total, counts and collectors come with the first page.
  if (filter.cursor) return { ...result, items, total: undefined, counts: undefined, collectors: undefined };

  const counts = await one<Record<'all' | Lowercase<HistoryOutcome>, number>>(
    db,
    `SELECT count(*)::int AS all, ${HISTORY_OUTCOMES.map((o) => `count(*) FILTER (WHERE ${OUTCOME_SQL[o]})::int AS ${o.toLowerCase()}`).join(', ')} ${base}`,
    countParams,
  );
  const collectors = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM recycling_collectors WHERE ($1::uuid IS NULL OR township_id = $1) ORDER BY name',
    [scope],
  );
  return { ...result, items, total: filter.outcome ? counts![filter.outcome.toLowerCase() as Lowercase<HistoryOutcome>] : counts!.all, counts, collectors };
}

interface StaffCollectionRow extends CreditTarget {
  township_id: string;
  home_id: string;
  status: string;
  day: string;
  materials: Material[];
  reported_weight_g: number | null;
  review_reason: ReviewReason | null;
  reviewed_at: Date | null;
}

async function loadForStaff(tx: Queryable, actor: Actor, id: string) {
  const x = await one<StaffCollectionRow>(
    tx,
    `SELECT x.id, x.township_id, x.home_id, x.user_id, x.status, x.day::text AS day, c.name AS collector, x.materials,
            x.reported_weight_g, x.review_reason, x.reviewed_at
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id WHERE x.id = $1 FOR UPDATE OF x`,
    [id],
  );
  if (!x) throw notFound('Collection');
  assertTownshipAccess(actor, x.township_id);
  return x;
}

const openReview = (x: StaffCollectionRow) => x.review_reason !== null && x.reviewed_at === null;

/** Confirms a request made before bookings confirmed themselves: the same pass and notice as a new booking. */
async function confirmRequest(tx: Queryable, x: StaffCollectionRow, now: Date) {
  const pass = await issuePass(tx, { townshipId: x.township_id, homeId: x.home_id, userId: x.user_id, collector: x.collector, day: x.day }, now);
  await tx.query(`UPDATE recycling_collections SET status = 'CONFIRMED', confirmed_at = $2, pass_id = $3 WHERE id = $1`, [x.id, now, pass.id]);
  await tellResident(tx, x.user_id, { title: 'Collection booked', body: `${x.collector} comes on ${x.day}. Gate pass ${pass.code} is ready in Tamu.` });
  return pass;
}

export async function confirmCollection(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (x.status !== 'REQUESTED') throw conflict('COLLECTION_NOT_REQUESTED', 'Only a new request can be confirmed.');
    const pass = await confirmRequest(tx, x, now);
    await audit(tx, actor.id, 'COLLECTION_CONFIRMED', 'recycling_collection', id);
    return { ok: true, passCode: pass.code };
  });
}

/** For the nightly job: requests still waiting from before bookings confirmed themselves, for today or later. */
export async function confirmWaitingRequests(db: Db, now: Date) {
  const today = await todayIn(db, now);
  const waiting = await db.query<{ id: string }>(`SELECT id FROM recycling_collections WHERE status = 'REQUESTED' AND day >= $1::date`, [today]);
  for (const { id } of waiting) {
    await db.tx(async (tx) => {
      const x = await one<StaffCollectionRow>(
        tx,
        `SELECT x.id, x.township_id, x.home_id, x.user_id, x.status, x.day::text AS day, c.name AS collector, x.materials, x.reported_weight_g, x.review_reason, x.reviewed_at
           FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id WHERE x.id = $1 FOR UPDATE OF x`,
        [id],
      );
      if (x?.status !== 'REQUESTED') return;
      await confirmRequest(tx, x, now);
      await audit(tx, null, 'COLLECTION_CONFIRMED', 'recycling_collection', id, { by: 'recycling job' });
    });
  }
  return waiting.length;
}

/** Staff record the collector's weighed total by hand. Same credit step as a household's own weight. */
export async function completeCollection(db: Db, actor: Actor, id: string, weightG: number, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (x.status !== 'CONFIRMED') throw conflict('COLLECTION_NOT_CONFIRMED', 'Confirm the collection before recording it.');
    if (openReview(x)) await tx.query(`UPDATE recycling_collections SET reviewed_at = $2, decided_by = 'STAFF' WHERE id = $1`, [id, now]);
    const reward = await creditCollection(tx, x, weightG, now);
    await audit(tx, actor.id, 'COLLECTION_DONE', 'recycling_collection', id, { weightG });
    return { ok: true, reward };
  });
}

/** The household hears a collection was missed: by staff, or by the nightly job. */
export const tellMissed = (tx: Queryable, x: { id: string; user_id: string; collector: string; day: string }) =>
  tellResident(tx, x.user_id, { title: 'Collection missed', body: `${x.collector} did not come on ${x.day}. Please book another day.`, dedupeKey: `kitar-collection-missed:${x.id}` });

export async function missCollection(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (!['REQUESTED', 'CONFIRMED'].includes(x.status)) throw conflict('COLLECTION_CLOSED', 'This collection is already closed.');
    await tx.query(`UPDATE recycling_collections SET status = 'MISSED', reviewed_at = CASE WHEN review_reason IS NULL THEN NULL ELSE $2::timestamptz END WHERE id = $1`, [id, now]);
    await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = (SELECT pass_id FROM recycling_collections WHERE id = $1) AND status = 'ACTIVE'`, [id]);
    await tellMissed(tx, x);
    await audit(tx, actor.id, 'COLLECTION_MISSED', 'recycling_collection', id);
    return { ok: true };
  });
}

/**
 * Staff settle an exception. Accept credits the weight (the household's, or a
 * corrected one from the collector) through the usual credit step. Reject
 * closes it with no points: a held weight closes as collected with no weight,
 * a disputed miss stays missed.
 */
export async function reviewCollection(db: Db, actor: Actor, id: string, input: { decision: 'ACCEPT' | 'REJECT'; weightG?: number }, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (!openReview(x)) throw conflict('NO_OPEN_REVIEW', 'This collection has nothing waiting for review.');
    await tx.query(`UPDATE recycling_collections SET reviewed_at = $2, decided_by = 'STAFF' WHERE id = $1`, [id, now]);
    if (input.decision === 'ACCEPT') {
      const weightG = input.weightG ?? x.reported_weight_g;
      if (!weightG) throw ruleViolation('WEIGHT_NEEDED', 'Enter the weight the collector took.');
      const reward = await creditCollection(tx, x, weightG, now, 'Collection review complete');
      await audit(tx, actor.id, 'COLLECTION_REVIEWED', 'recycling_collection', id, { decision: 'ACCEPT', reason: x.review_reason, weightG });
      return { status: 'COLLECTED' as const, reward };
    }
    if (x.status === 'CONFIRMED') await tx.query(`UPDATE recycling_collections SET status = 'COLLECTED', collected_at = $2 WHERE id = $1`, [id, now]);
    await tellResident(tx, x.user_id, { title: 'Collection review complete', body: 'No points were given for this collection.', dedupeKey: `kitar-collection-reviewed:${id}` });
    await audit(tx, actor.id, 'COLLECTION_REVIEWED', 'recycling_collection', id, { decision: 'REJECT', reason: x.review_reason });
    return { status: x.status === 'CONFIRMED' ? ('COLLECTED' as const) : ('MISSED' as const), reward: null };
  });
}

/**
 * Homes and collectors that keep tripping the rules, in a township or (HQ) all of
 * them. A home: large weights or BR6 limit hits. A collector: missed collections.
 * `firstId` is the oldest event in the window, so a flag is raised once per run of events.
 */
export async function collectionFlags(q: Queryable, townshipId: string | null, now: Date) {
  const today = await todayIn(q, now);
  const [homes, collectors] = await Promise.all([
    q.query<HomeAddress & { home_id: string; township_id: string; township: string; events: number; first_id: string }>(
      `SELECT x.home_id, x.township_id, t.name AS township, count(*)::int AS events,
              (array_agg(x.id::text ORDER BY coalesce(x.reported_at, x.collected_at), x.id))[1] AS first_id, ${HOME_ADDRESS_COLUMNS}
         FROM recycling_collections x JOIN homes h ON h.id = x.home_id JOIN townships t ON t.id = x.township_id
        WHERE ($1::uuid IS NULL OR x.township_id = $1)
          AND (x.reported_weight_g > $2 OR x.limit_hit IS NOT NULL)
          AND coalesce(x.reported_at, x.collected_at) > $3::timestamptz - make_interval(days => $4)
        GROUP BY x.home_id, x.township_id, t.name, h.id HAVING count(*) >= $5`,
      [townshipId, AUTO_ACCEPT_MAX_G, now, FLAG_WINDOW_DAYS, FLAG_THRESHOLD],
    ),
    q.query<{ collector_id: string; township_id: string; township: string; collector: string; phone: string | null; events: number; first_id: string }>(
      `SELECT c.id AS collector_id, c.township_id, t.name AS township, c.name AS collector, c.phone, count(*)::int AS events,
              (array_agg(x.id::text ORDER BY x.day, x.id))[1] AS first_id
         FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN townships t ON t.id = c.township_id
        WHERE ($1::uuid IS NULL OR c.township_id = $1) AND c.active AND x.status = 'MISSED' AND x.day > $2::date - $3::int
        GROUP BY c.id, c.township_id, t.name, c.name, c.phone HAVING count(*) >= $4`,
      [townshipId, today, FLAG_WINDOW_DAYS, FLAG_THRESHOLD],
    ),
  ]);
  return { homes: homes.map(withHouse), collectors };
}

/**
 * The staff queue: only what needs a person. Weights and disputes to check, then
 * homes and collectors to look at, and a 30-day summary of what ran by itself.
 */
export async function collectionExceptions(db: Db, actor: Actor, now: Date, townshipId?: string) {
  const scope = listScope(actor, townshipId);
  const today = await todayIn(db, now);
  const [reviews, flags, summary] = await Promise.all([
    db.query<HomeAddress & Record<string, unknown>>(
      `SELECT x.id, x.status, x.day::text AS day, x.slot, x.materials, x.items, x.reported_weight_g, x.reported_at, x.review_reason,
              ${GATE_SCANNED} AS gate_scanned, c.name AS collector, t.name AS township, ${HOME_ADDRESS_COLUMNS}
         FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN homes h ON h.id = x.home_id JOIN townships t ON t.id = x.township_id
        WHERE ($1::uuid IS NULL OR x.township_id = $1) AND x.review_reason IS NOT NULL AND x.reviewed_at IS NULL
        ORDER BY x.reported_at LIMIT 200`,
      [scope],
    ),
    collectionFlags(db, scope, now),
    one<{ upcoming: number; collected: number; by_staff: number; missed: number }>(
      db,
      `SELECT count(*) FILTER (WHERE status = 'CONFIRMED' AND day >= $2::date)::int AS upcoming,
              count(*) FILTER (WHERE status = 'COLLECTED' AND day > $2::date - 30)::int AS collected,
              count(*) FILTER (WHERE status = 'COLLECTED' AND day > $2::date - 30 AND ((reviewed_at IS NOT NULL AND decided_by IS DISTINCT FROM 'SYSTEM') OR (reported_weight_g IS NULL AND weight_g IS NOT NULL)))::int AS by_staff,
              count(*) FILTER (WHERE status = 'MISSED' AND day > $2::date - 30)::int AS missed
         FROM recycling_collections WHERE ($1::uuid IS NULL OR township_id = $1)`,
      [scope, today],
    ),
  ]);
  return { reviews: reviews.map(withHouse), ...flags, summary: summary! };
}

/** Collectors have no account: staff copy or print the day's list and pass it on. */
export async function collectorDaySheet(db: Db, actor: Actor, collectorId: string, now: Date) {
  const c = await one<{ township_id: string; name: string; phone: string | null }>(db, 'SELECT township_id, name, phone FROM recycling_collectors WHERE id = $1', [collectorId]);
  if (!c) throw notFound('Collector');
  assertTownshipAccess(actor, c.township_id);
  const day = await todayIn(db, now);
  const rows = await db.query<HomeAddress & Record<string, unknown>>(
    `SELECT x.id, x.slot, x.materials, x.items, p.code AS pass_code, ${HOME_ADDRESS_COLUMNS}
       FROM recycling_collections x JOIN homes h ON h.id = x.home_id LEFT JOIN visitor_passes p ON p.id = x.pass_id
      WHERE x.collector_id = $1 AND x.day = $2::date AND x.status = 'CONFIRMED'
      ORDER BY x.slot DESC, h.street, h.house_no`,
    [collectorId, day],
  );
  return { collector: c.name, phone: c.phone, day, collections: rows.map(withHouse) };
}

/**
 * The brief's test for the recycling guide: more material accepted. Accepted
 * weight from kiosks, smart machines and collections by month, and how often
 * the machines turned an item away (and why), so the guide can be improved.
 */
export async function recyclingStats(db: Db, actor: Actor, now: Date, townshipId?: string) {
  const tz = (await getSettings(db)).timezone;
  const t = listScope(actor, townshipId);
  const [months, reasons] = await Promise.all([
    db.query<{ month: string; kiosk_g: number; machine_g: number; collection_g: number; items: number; rejected: number }>(
      `WITH months AS (
         SELECT generate_series(date_trunc('month', ($2::timestamptz AT TIME ZONE $3)) - interval '5 months', date_trunc('month', ($2::timestamptz AT TIME ZONE $3)), interval '1 month')::date AS month
       )
       SELECT m.month::text AS month,
              (SELECT coalesce(sum(d.weight_g), 0)::int FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
                WHERE ($1::uuid IS NULL OR k.township_id = $1) AND date_trunc('month', d.created_at AT TIME ZONE $3)::date = m.month) AS kiosk_g,
              (SELECT coalesce(sum(i.weight_g) FILTER (WHERE i.accepted), 0)::int FROM kitar_items i JOIN kitar_sessions s ON s.id = i.session_id JOIN kitar_machines km ON km.id = s.machine_id
                WHERE ($1::uuid IS NULL OR km.township_id = $1) AND date_trunc('month', i.created_at AT TIME ZONE $3)::date = m.month) AS machine_g,
              (SELECT coalesce(sum(x.weight_g), 0)::int FROM recycling_collections x
                WHERE ($1::uuid IS NULL OR x.township_id = $1) AND x.status = 'COLLECTED' AND date_trunc('month', x.collected_at AT TIME ZONE $3)::date = m.month) AS collection_g,
              (SELECT count(*)::int FROM kitar_items i JOIN kitar_sessions s ON s.id = i.session_id JOIN kitar_machines km ON km.id = s.machine_id
                WHERE ($1::uuid IS NULL OR km.township_id = $1) AND date_trunc('month', i.created_at AT TIME ZONE $3)::date = m.month) AS items,
              (SELECT count(*) FILTER (WHERE NOT i.accepted)::int FROM kitar_items i JOIN kitar_sessions s ON s.id = i.session_id JOIN kitar_machines km ON km.id = s.machine_id
                WHERE ($1::uuid IS NULL OR km.township_id = $1) AND date_trunc('month', i.created_at AT TIME ZONE $3)::date = m.month) AS rejected
         FROM months m ORDER BY m.month`,
      [t, now, tz],
    ),
    db.query<{ reason: string; n: number }>(
      `SELECT i.reason, count(*)::int AS n FROM kitar_items i JOIN kitar_sessions s ON s.id = i.session_id JOIN kitar_machines km ON km.id = s.machine_id
        WHERE ($1::uuid IS NULL OR km.township_id = $1) AND NOT i.accepted AND i.reason IS NOT NULL AND i.created_at > $2::timestamptz - interval '90 days'
        GROUP BY i.reason ORDER BY n DESC LIMIT 5`,
      [t, now],
    ),
  ]);
  return {
    months: months.map((m) => ({
      month: m.month,
      acceptedG: m.kiosk_g + m.machine_g + m.collection_g,
      kioskG: m.kiosk_g,
      machineG: m.machine_g,
      collectionG: m.collection_g,
      rejectionPct: m.items ? Math.round((m.rejected / m.items) * 1000) / 10 : null,
    })),
    topRejections: reasons,
  };
}
