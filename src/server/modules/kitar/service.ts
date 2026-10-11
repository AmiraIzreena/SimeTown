import { randomUUID } from 'node:crypto';
import type { Material } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { recordAction } from '../rewards';
import { getSettings, startOf } from '../settings';
import { resolveTownship } from '../townships';
import { machinesForResident } from './machine';

/** Kitar: check the material, then record the drop-off at a township kiosk. */

export async function kitarOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const tz = (await getSettings(db)).timezone;
  const month = startOf('month', '$2', '$3');
  const [mine, street, recent, kiosks, machines] = await Promise.all([
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
    db.query(
      `SELECT d.id, d.material, d.weight_g, d.created_at, k.name AS kiosk
         FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id WHERE d.user_id = $1 ORDER BY d.created_at DESC LIMIT 10`,
      [resident.id],
    ),
    db.query(`SELECT id, name, location FROM kitar_kiosks WHERE township_id = $1 AND active ORDER BY name`, [resident.townshipId]),
    machinesForResident(db, resident.townshipId),
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
  };
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
    `SELECT k.id, k.name, k.location, k.code, k.active,
            (SELECT coalesce(sum(weight_g), 0)::int FROM kitar_dropoffs d WHERE d.kiosk_id = k.id) AS total_g
       FROM kitar_kiosks k WHERE ($1::uuid IS NULL OR k.township_id = $1) ORDER BY k.name`,
    [actor.townshipId],
  );
}

export async function createKiosk(db: Db, actor: Actor, input: { name: string; location: string }) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
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
