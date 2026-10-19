import { randomUUID } from 'node:crypto';
import type { Material } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { currentMonth } from '../offers/service';
import { recordAction, type RewardUser } from '../rewards';
import { getSettings, startOf, type Settings } from '../settings';
import { resolveTownship } from '../townships';
import { hasDropoffSource, machinesForResident } from './machine';
import { testEntryEnabled } from './test-entry';
import { listRates } from './rates';

/** Kitar: check the material, then record the drop-off at a township kiosk. */

export async function kitarOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const month = startOf('month', '$2', '$3');
  const [mine, street, recent, kiosks, machines, byMaterial, rates, limits, points] = await Promise.all([
    one<{ month_g: number; all_g: number; drops: number }>(
      db,
      `SELECT coalesce(sum(weight_g) FILTER (WHERE created_at >= ${month}), 0)::int AS month_g,
              coalesce(sum(weight_g), 0)::int AS all_g, count(*)::int AS drops
         FROM kitar_dropoffs WHERE user_id = $1`,
      [resident.id, now, tz],
    ),
    one<{ street: string; month_g: number }>(
      db,
      `SELECT h.street,
              (SELECT coalesce(sum(d.weight_g), 0)::int
                 FROM kitar_dropoffs d JOIN users u ON u.id = d.user_id JOIN homes n ON n.id = u.home_id
                WHERE n.township_id = h.township_id AND n.street = h.street AND d.created_at >= ${month}) AS month_g
         FROM homes h WHERE h.id = $1`,
      [resident.homeId, now, tz],
    ),
    recentDropOffs(db, resident.id),
    db.query(`SELECT id, name, location FROM kitar_kiosks WHERE township_id = $1 AND active ORDER BY name`, [resident.townshipId]),
    machinesForResident(db, resident.townshipId),
    db.query<{ material: Material; grams: number }>(
      `SELECT material, sum(weight_g)::int AS grams FROM kitar_dropoffs WHERE user_id = $1 AND created_at >= ${month} GROUP BY material`,
      [resident.id, now, tz],
    ),
    listRates(db),
    kitarLimits(db, resident, now, settings),
    pointsStatus(db, resident, now, settings),
  ]);
  return {
    monthGrams: mine!.month_g,
    allGrams: mine!.all_g,
    dropOffs: mine!.drops,
    street: street?.street ?? null,
    streetMonthGrams: street?.month_g ?? 0,
    recent,
    kiosks,
    machines,
    photoCheck: getConfig().AI_PROVIDER !== 'none',
    rates,
    monthGramsByMaterial: Object.fromEntries(byMaterial.map((m) => [m.material, m.grams])) as Partial<Record<Material, number>>,
    limits,
    points,
    // Only on a local demo (pglite in development): the XP a trip earns, for the practice preview. Never sent otherwise.
    ...(testEntryEnabled(getConfig()) ? { testEntry: { xp: (await one<{ xp: number }>(db, `SELECT xp FROM activity_rules WHERE activity = 'KITAR_DROPOFF'`))!.xp } } : {}),
  };
}

/**
 * The resident's last 10 drop-offs. `test` marks a practice entry from Kitar test mode: from the
 * row's TEST label (migration 016), or, on a database without 016, from the KITAR_TEST_ENTRY audit
 * entry that lists the row's id.
 */
async function recentDropOffs(db: Db, userId: string) {
  const test = (await hasDropoffSource(db))
    ? `d.source = 'TEST'`
    : `EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'KITAR_TEST_ENTRY' AND a.actor_user_id = d.user_id AND a.detail -> 'dropoffIds' @> jsonb_build_array(d.id::text))`;
  return db.query(
    `SELECT d.id, d.material, d.weight_g, d.created_at, k.name AS kiosk, ${test} AS test
       FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id WHERE d.user_id = $1 ORDER BY d.created_at DESC LIMIT 10`,
    [userId],
  );
}

/**
 * Recycling trips and the home's offer-backed points this month, counted the way
 * `recordAction` and `giveOfferPoints` count them (BR6), so the screen never says
 * a trip will count when it will not.
 */
async function kitarLimits(db: Db, resident: RewardUser, now: Date, settings: Settings) {
  const [rule, used, home] = await Promise.all([
    one<{ daily_cap_person: number; monthly_cap_home: number }>(db, `SELECT daily_cap_person, monthly_cap_home FROM activity_rules WHERE activity = 'KITAR_DROPOFF'`),
    one<{ today: number; month_home: number }>(
      db,
      `SELECT count(*) FILTER (WHERE e.user_id = $1 AND e.created_at >= ${startOf('day', '$3', '$4')})::int AS today,
              count(*)::int AS month_home
         FROM xp_events e JOIN users u ON u.id = e.user_id
        WHERE u.home_id = $2 AND e.activity = 'KITAR_DROPOFF' AND e.created_at >= ${startOf('month', '$3', '$4')}`,
      [resident.id, resident.homeId, now, settings.timezone],
    ),
    homeOfferPoints(db, resident.homeId, now, settings.timezone),
  ]);
  return {
    tripsToday: used!.today,
    tripsPerDay: rule!.daily_cap_person,
    homeTripsMonth: used!.month_home,
    homeTripsPerMonth: rule!.monthly_cap_home,
    homePointsMonth: home,
    homePointsMax: settings.offer_points_monthly_home,
  };
}

/** Offer-backed points every member of the home has earned this month, from any action (the household limit is shared). */
async function homeOfferPoints(q: Queryable, homeId: string, now: Date, tz: string): Promise<number> {
  const month = await currentMonth(q, now, tz);
  const row = await one<{ used: number }>(
    q,
    `SELECT coalesce(sum(l.amount), 0)::int AS used FROM offer_point_lots l JOIN users u ON u.id = l.user_id
      WHERE u.home_id = $1 AND l.source = 'ACTION' AND l.pledge_month = $2`,
    [homeId, month],
  );
  return row!.used;
}

/**
 * Whether a bin trip can earn points per kg right now, and if not, why: only the
 * reason, never the shops' amounts. Checked in the order `giveOfferPoints` applies
 * them. A material with a rate of 0 is shown on its own rate instead.
 */
async function pointsStatus(db: Db, resident: RewardUser, now: Date, settings: Settings): Promise<{ status: 'ON' | 'PROGRAMME_PAUSED' | 'NO_PROMISES' | 'HOME_LIMIT' }> {
  if (settings.issuance_paused) return { status: 'PROGRAMME_PAUSED' };
  const month = await currentMonth(db, now, settings.timezone);
  // Promises not made yet this month count too: the first award of the month makes them (ensurePledges).
  const promises = await one<{ promised: number; issued: number }>(
    db,
    `SELECT (SELECT coalesce(sum(p.budget_sen), 0) FROM offer_pledges p WHERE p.township_id = $1 AND p.month = $2::date)
          + (SELECT coalesce(sum(o.monthly_budget_sen), 0) FROM shop_offers o JOIN merchants m ON m.id = o.merchant_id
              WHERE m.township_id = $1 AND o.status = 'ACTIVE' AND m.status = 'ACTIVE'
                AND NOT EXISTS (SELECT 1 FROM offer_pledges p WHERE p.offer_id = o.id AND p.month = $2::date)) AS promised,
            coalesce((SELECT issued_points FROM offer_months WHERE township_id = $1 AND month = $2::date), 0) AS issued`,
    [resident.townshipId, month],
  );
  if (Number(promises!.promised) - Number(promises!.issued) <= 0) return { status: 'NO_PROMISES' };
  if ((await homeOfferPoints(db, resident.homeId, now, settings.timezone)) >= settings.offer_points_monthly_home) return { status: 'HOME_LIMIT' };
  return { status: 'ON' };
}

/**
 * The kiosk's printed code proves the resident was at the kiosk. The weight is
 * what they enter, so it is capped per drop-off and drop-offs are capped per
 * day (BR6). A capped drop-off is refused rather than stored without reward,
 * so the township's totals stay honest.
 */
export async function recordDropOff(db: Db, actor: Actor, input: { kioskCode: string; material: Material; weightG: number }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const kiosk = await one<{ id: string; name: string }>(
      tx,
      'SELECT id, name FROM kitar_kiosks WHERE code = $1 AND township_id = $2 AND active',
      [input.kioskCode.trim().toUpperCase(), resident.townshipId],
    );
    if (!kiosk) throw notFound('Kiosk');
    const id = randomUUID();
    const reward = await recordAction(tx, { user: resident, activity: 'KITAR_DROPOFF', ref: id, quantity: input.weightG, now });
    if (reward.skipped) throw ruleViolation(reward.skipped, 'You have reached the recycling limit for now. Please come back tomorrow.');
    await tx.query('INSERT INTO kitar_dropoffs (id, kiosk_id, user_id, material, weight_g, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      id,
      kiosk.id,
      resident.id,
      input.material,
      input.weightG,
      now,
    ]);
    return { id, kiosk: kiosk.name, reward };
  });
}

export async function listKiosksForStaff(db: Db, actor: Actor) {
  return db.query(
    `SELECT k.id, k.name, k.location, k.code, k.active, t.name AS township,
            (SELECT coalesce(sum(weight_g), 0)::int FROM kitar_dropoffs d WHERE d.kiosk_id = k.id) AS total_g
       FROM kitar_kiosks k JOIN townships t ON t.id = k.township_id WHERE ($1::uuid IS NULL OR k.township_id = $1) ORDER BY t.name, k.name`,
    [actor.townshipId],
  );
}

/** SDP HQ names the township for a new kiosk; township staff add to their own. */
export async function createKiosk(db: Db, actor: Actor, input: { name: string; location: string; townshipId?: string }) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor, input.townshipId);
    if (await one(tx, 'SELECT 1 FROM kitar_kiosks WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('KIOSK_EXISTS', 'A kiosk with this name already exists.');
    }
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO kitar_kiosks (township_id, name, location, code) VALUES ($1, $2, $3, $4) RETURNING id',
      [townshipId, input.name, input.location, `K${randomCode(9)}`],
    );
    await audit(tx, actor.id, 'KIOSK_CREATED', 'kitar_kiosk', row!.id, { name: input.name });
    return { id: row!.id };
  });
}
