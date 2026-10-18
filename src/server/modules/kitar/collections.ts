import { MATERIAL_INFO, shortAddress, type HomeAddress, type Material } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { recordAction, rewardUserById } from '../rewards';
import { getSettings, todayIn } from '../settings';
import { insertPass } from '../tamu/service';
import { HOME_ADDRESS_COLUMNS, resolveTownship } from '../townships';

/**
 * Kitar collections (the brief's "book local collections"). Partner collectors
 * list what they accept and when they come. A household books a pickup for
 * bulky or special items; once the collection is confirmed, the collector gets a
 * Tamu contractor pass for that day, so the gate expects them. The collector's
 * weighed total earns the household Impact XP (and any funded campaign's points).
 */

export const COLLECTION_SLOTS = ['MORNING', 'AFTERNOON'] as const;
export type CollectionSlot = (typeof COLLECTION_SLOTS)[number];
const MAX_OPEN_PER_HOME = 3;
const BOOK_AHEAD_DAYS = 30;

export async function listCollectors(db: Db, actor: Actor, material?: Material) {
  const resident = requireVerifiedResident(actor);
  return db.query(
    `SELECT id, name, phone, materials, days, notes FROM recycling_collectors
      WHERE township_id = $1 AND active AND ($2::text IS NULL OR $2 = ANY(materials)) ORDER BY name`,
    [resident.townshipId, material ?? null],
  );
}

export async function listCollectorsForStaff(db: Db, actor: Actor) {
  return db.query(
    `SELECT c.id, c.name, c.phone, c.materials, c.days, c.notes, c.active,
            (SELECT count(*)::int FROM recycling_collections x WHERE x.collector_id = c.id AND x.status = 'COLLECTED') AS collections,
            (SELECT coalesce(sum(x.weight_g), 0)::int FROM recycling_collections x WHERE x.collector_id = c.id AND x.status = 'COLLECTED') AS collected_g
       FROM recycling_collectors c WHERE ($1::uuid IS NULL OR c.township_id = $1) ORDER BY c.active DESC, c.name`,
    [actor.townshipId],
  );
}

export interface CollectorInput {
  name: string;
  phone?: string;
  materials: Material[];
  days: string;
  notes?: string;
}

export async function createCollector(db: Db, actor: Actor, input: CollectorInput) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM recycling_collectors WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('COLLECTOR_EXISTS', 'A collector with this name already exists.');
    }
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO recycling_collectors (township_id, name, phone, materials, days, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [townshipId, input.name.trim(), input.phone?.trim() || null, [...new Set(input.materials)], input.days.trim(), input.notes?.trim() || null],
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

/** A household books a pickup with a collector who takes those materials. */
export async function bookCollection(db: Db, actor: Actor, input: BookingInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [resident.homeId]);
    const collector = await one<{ name: string; materials: Material[] }>(
      tx, 'SELECT name, materials FROM recycling_collectors WHERE id = $1 AND township_id = $2 AND active', [input.collectorId, resident.townshipId],
    );
    if (!collector) throw notFound('Collector');
    const notTaken = input.materials.filter((m) => !collector.materials.includes(m));
    if (notTaken.length) {
      throw ruleViolation('NOT_ACCEPTED', `${collector.name} does not take ${notTaken.map((m) => MATERIAL_INFO[m].label.toLowerCase()).join(', ')}.`);
    }
    const today = await todayIn(tx, now);
    const range = await one<{ ok: boolean }>(tx, `SELECT $1::date > $2::date AND $1::date <= $2::date + $3::int AS ok`, [input.day, today, BOOK_AHEAD_DAYS]);
    if (!range!.ok) throw ruleViolation('COLLECTION_DAY', `Choose a day from tomorrow up to ${BOOK_AHEAD_DAYS} days ahead.`);
    const open = await one<{ n: number; same_day: number }>(
      tx,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE day = $2::date)::int AS same_day FROM recycling_collections
        WHERE home_id = $1 AND status IN ('REQUESTED', 'CONFIRMED')`,
      [resident.homeId, input.day],
    );
    if (open!.same_day > 0) throw conflict('ALREADY_BOOKED', 'Your home already has a collection that day.');
    if (open!.n >= MAX_OPEN_PER_HOME) throw ruleViolation('TOO_MANY_COLLECTIONS', `Your home can have up to ${MAX_OPEN_PER_HOME} collections booked at a time.`);
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO recycling_collections (township_id, home_id, user_id, collector_id, materials, items, day, slot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [resident.townshipId, resident.homeId, resident.id, input.collectorId, [...new Set(input.materials)], input.items.trim(), input.day, input.slot, now],
    );
    const staff = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
      [resident.townshipId],
    );
    await notify(tx, staff.map((s) => s.id), { title: 'New recycling collection request', body: `Collector ${collector.name}, ${input.day}: ${input.items.trim().slice(0, 100)}`, link: '/console/recycling' });
    return { id: row!.id, status: 'REQUESTED' as const };
  });
}

const COLLECTION_SELECT = `
  SELECT x.id, x.materials, x.items, x.day::text AS day, x.slot, x.status, x.weight_g, x.created_at, x.confirmed_at, x.collected_at,
         c.name AS collector, c.phone AS collector_phone, p.code AS pass_code
    FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id LEFT JOIN visitor_passes p ON p.id = x.pass_id`;

export async function myCollections(db: Db, actor: Actor) {
  const resident = requireVerifiedResident(actor);
  return db.query(`${COLLECTION_SELECT} WHERE x.home_id = $1 ORDER BY x.day DESC, x.created_at DESC LIMIT 30`, [resident.homeId]);
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

export async function collectionsForStaff(db: Db, actor: Actor, status?: string) {
  const rows = await db.query<HomeAddress & Record<string, unknown>>(
    `SELECT x.id, x.materials, x.items, x.day::text AS day, x.slot, x.status, x.weight_g, x.created_at, c.name AS collector, ${HOME_ADDRESS_COLUMNS}
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id JOIN homes h ON h.id = x.home_id
      WHERE ($1::uuid IS NULL OR x.township_id = $1) AND ($2::text IS NULL OR x.status = $2)
      ORDER BY (x.status IN ('REQUESTED', 'CONFIRMED')) DESC, x.day, x.created_at LIMIT 200`,
    [actor.townshipId, status ?? null],
  );
  return rows.map(({ property_type, house_no, building, street, precinct, postcode, city, state, ...rest }) => ({
    ...rest,
    house: shortAddress({ property_type, house_no, building, street, precinct, postcode, city, state }),
  }));
}

async function loadForStaff(tx: Queryable, actor: Actor, id: string) {
  const x = await one<{ township_id: string; home_id: string; user_id: string; status: string; day: string; collector: string; materials: Material[] }>(
    tx,
    `SELECT x.township_id, x.home_id, x.user_id, x.status, x.day::text AS day, c.name AS collector, x.materials
       FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id WHERE x.id = $1 FOR UPDATE OF x`,
    [id],
  );
  if (!x) throw notFound('Collection');
  assertTownshipAccess(actor, x.township_id);
  return x;
}

/** The collector agrees to come. The gate gets a contractor pass for that whole day. */
export async function confirmCollection(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (x.status !== 'REQUESTED') throw conflict('COLLECTION_NOT_REQUESTED', 'Only a new request can be confirmed.');
    const tz = (await getSettings(tx)).timezone;
    const window = await one<{ from: Date; until: Date }>(
      tx,
      `SELECT ($1::date::timestamp AT TIME ZONE $2) AS "from", (($1::date + 1)::timestamp AT TIME ZONE $2) AS until`,
      [x.day, tz],
    );
    const pass = await insertPass(
      tx,
      { townshipId: x.township_id, homeId: x.home_id, hostUserId: x.user_id, type: 'CONTRACTOR', visitorName: `${x.collector} (recycling collection)`, validFrom: window!.from, validUntil: window!.until },
      now,
    );
    await tx.query(`UPDATE recycling_collections SET status = 'CONFIRMED', confirmed_at = $2, pass_id = $3 WHERE id = $1`, [id, now, pass.id]);
    await notify(tx, [x.user_id], { title: 'Recycling collection confirmed', body: `${x.collector} comes on ${x.day}. The gate has their pass.`, link: '/app/kitar' });
    await audit(tx, actor.id, 'COLLECTION_CONFIRMED', 'recycling_collection', id);
    return { ok: true, passCode: pass.code };
  });
}

/** The collector's weighed total is the proof: it earns Impact XP and any funded campaign's points. */
export async function completeCollection(db: Db, actor: Actor, id: string, weightG: number, now: Date) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (x.status !== 'CONFIRMED') throw conflict('COLLECTION_NOT_CONFIRMED', 'Confirm the collection before recording it.');
    await tx.query(`UPDATE recycling_collections SET status = 'COLLECTED', weight_g = $2, collected_at = $3 WHERE id = $1`, [id, weightG, now]);
    const user = await rewardUserById(tx, x.user_id);
    const reward = user ? await recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: `collection:${id}`, quantity: weightG, now }) : null;
    await notify(tx, [x.user_id], { title: 'Collected. Thank you for recycling', body: `${x.collector} took ${(weightG / 1000).toFixed(1)} kg.`, link: '/app/kitar' });
    await audit(tx, actor.id, 'COLLECTION_DONE', 'recycling_collection', id, { weightG });
    return { ok: true, reward };
  });
}

export async function missCollection(db: Db, actor: Actor, id: string) {
  return db.tx(async (tx) => {
    const x = await loadForStaff(tx, actor, id);
    if (!['REQUESTED', 'CONFIRMED'].includes(x.status)) throw conflict('COLLECTION_CLOSED', 'This collection is already closed.');
    await tx.query(`UPDATE recycling_collections SET status = 'MISSED' WHERE id = $1`, [id]);
    await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = (SELECT pass_id FROM recycling_collections WHERE id = $1) AND status = 'ACTIVE'`, [id]);
    await notify(tx, [x.user_id], { title: 'Recycling collection did not happen', body: `${x.collector} could not come on ${x.day}. Please book another day.`, link: '/app/kitar' });
    await audit(tx, actor.id, 'COLLECTION_MISSED', 'recycling_collection', id);
    return { ok: true };
  });
}

/**
 * The brief's test for the recycling guide: more material accepted. Accepted
 * weight from kiosks, smart machines and collections by month, and how often
 * the machines turned an item away (and why), so the guide can be improved.
 */
export async function recyclingStats(db: Db, actor: Actor, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const t = actor.townshipId;
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
