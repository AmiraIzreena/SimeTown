import { formatAddress, type HomeAddress } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, ruleViolation } from '../../errors';
import { recordAction, sumRewards, type ActionReward } from '../rewards';
import { getSettings } from '../settings';
import { HOME_ADDRESS_COLUMNS } from '../townships';

/** Jimat: monthly electricity and water readings for a home, compared with the month before. */

interface Reading {
  month: string;
  /** Either may be missing for a month when only one bill has been read so far. */
  electricity_kwh: number | null;
  water_litres: number | null;
  electricity_sen: number | null;
  water_sen: number | null;
  electricity_source: 'TYPED' | 'BILL' | null;
  water_source: 'TYPED' | 'BILL' | null;
}

const pctChange = (now: number | null | undefined, before: number | null | undefined) =>
  now != null && before != null && before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;

function tipsFor(electricityPct: number | null, waterPct: number | null, leak: boolean): string[] {
  const tips: string[] = [];
  if (leak) tips.push('Water use jumped sharply. Turn off every tap and watch the meter: if it still moves, you may have a leak.');
  if (electricityPct !== null && electricityPct > 0) {
    tips.push('Set air-conditioning to 24–25°C and use the fan with it.', 'Switch appliances off at the wall instead of leaving them on standby.');
  }
  if (waterPct !== null && waterPct > 0 && !leak) {
    tips.push('Fix dripping taps and run the washing machine only with full loads.');
  }
  if (tips.length === 0) tips.push('Nice work. Keep going, and ask about solar if you want to cut the bill further.');
  return tips;
}

export async function jimatOverview(db: Db, actor: Actor) {
  const resident = requireVerifiedResident(actor);
  const readings = (
    await db.query<Reading>(
      `SELECT month::text AS month, electricity_kwh, water_litres, electricity_sen, water_sen, electricity_source, water_source
         FROM jimat_readings WHERE home_id = $1 ORDER BY month DESC LIMIT 12`,
      [resident.homeId],
    )
  ).reverse();
  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];
  const electricityPct = pctChange(latest?.electricity_kwh, previous?.electricity_kwh);
  const waterPct = pctChange(latest?.water_litres, previous?.water_litres);
  // "Leak alert": this month's water is at least 30% above the average of up to three earlier months.
  const earlier = readings.slice(-4, -1).filter((r) => r.water_litres !== null);
  const average = earlier.length ? earlier.reduce((sum, r) => sum + r.water_litres!, 0) / earlier.length : 0;
  const leakSuspected = Boolean(latest?.water_litres != null && average > 0 && latest.water_litres >= average * 1.3);
  const solar = await one(db, 'SELECT 1 FROM solar_leads WHERE user_id = $1', [resident.id]);
  return { readings, electricityPct, waterPct, leakSuspected, tips: latest ? tipsFor(electricityPct, waterPct, leakSuspected) : [], solarInterest: Boolean(solar) };
}

/**
 * One set of readings per home per month, for this month or last month.
 * Readings are typed in, so they earn Impact XP only, never points.
 */
export async function submitReading(db: Db, actor: Actor, input: { month: string; electricityKwh: number; waterLitres: number }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const tz = (await getSettings(tx)).timezone;
    const window = await one<{ ok: boolean }>(
      tx,
      `SELECT $1::date BETWEEN (date_trunc('month', $2::timestamptz AT TIME ZONE $3) - interval '1 month')::date
                           AND date_trunc('month', $2::timestamptz AT TIME ZONE $3)::date AS ok`,
      [`${input.month}-01`, now, tz],
    );
    if (!window!.ok) throw ruleViolation('MONTH_NOT_OPEN', 'You can enter readings for this month or last month only.');
    const added = await tx.query(
      `INSERT INTO jimat_readings (home_id, month, electricity_kwh, water_litres, electricity_source, water_source, entered_by, created_at)
       VALUES ($1, $2::date, $3, $4, 'TYPED', 'TYPED', $5, $6) ON CONFLICT DO NOTHING RETURNING month`,
      [resident.homeId, `${input.month}-01`, input.electricityKwh, input.waterLitres, resident.id, now],
    );
    if (added.length === 0) throw conflict('READING_EXISTS', 'Readings for that month have already been entered for your home.');

    const rewards: ActionReward[] = [await recordAction(tx, { user: resident, activity: 'JIMAT_READING', ref: input.month, now })];
    const previous = await one<Reading>(
      tx,
      `SELECT month::text AS month, electricity_kwh, water_litres FROM jimat_readings WHERE home_id = $1 AND month = ($2::date - interval '1 month')::date`,
      [resident.homeId, `${input.month}-01`],
    );
    // A "saver" month: neither figure went up, and at least one fell by 5% or more.
    const saved =
      previous !== undefined &&
      previous.electricity_kwh !== null &&
      previous.water_litres !== null &&
      input.electricityKwh <= previous.electricity_kwh &&
      input.waterLitres <= previous.water_litres &&
      (input.electricityKwh <= previous.electricity_kwh * 0.95 || input.waterLitres <= previous.water_litres * 0.95);
    if (saved) rewards.push(await recordAction(tx, { user: resident, activity: 'JIMAT_SAVER', ref: input.month, now }));
    return {
      saved,
      reward: sumRewards(rewards),
    };
  });
}

/** Solar offers are shown, and the resident's details shared with staff, only after they ask (BR16). */
export async function setSolarInterest(db: Db, actor: Actor, interested: boolean, note: string | undefined, now: Date) {
  const resident = requireVerifiedResident(actor);
  if (interested) {
    await db.query(
      'INSERT INTO solar_leads (user_id, consent_at, note) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET note = EXCLUDED.note',
      [resident.id, now, note ?? null],
    );
  } else {
    await db.query('DELETE FROM solar_leads WHERE user_id = $1', [resident.id]);
  }
  return { solarInterest: interested };
}

export async function listSolarLeads(db: Db, actor: Actor) {
  const rows = await db.query<HomeAddress & Record<string, unknown>>(
    `SELECT u.id, u.full_name, u.email, u.phone, s.consent_at, s.note, ${HOME_ADDRESS_COLUMNS}
       FROM solar_leads s JOIN users u ON u.id = s.user_id JOIN homes h ON h.id = u.home_id
      WHERE ($1::uuid IS NULL OR u.township_id = $1) AND u.status = 'ACTIVE' ORDER BY s.consent_at DESC LIMIT 500`,
    [actor.townshipId],
  );
  return rows.map((r) => ({ id: r.id, full_name: r.full_name, email: r.email, phone: r.phone, consent_at: r.consent_at, note: r.note, address: formatAddress(r) }));
}
