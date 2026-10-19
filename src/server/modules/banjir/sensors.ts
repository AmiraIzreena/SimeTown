import { randomBytes } from 'node:crypto';
import { FLOOD_FAULT_LABELS, type FloodFaultReason, type FloodSensorHealth, type FloodSensorKind, type FloodSensorSite } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { signReading, storeReadings, type SignedReading } from './ingest';

/**
 * The sensor registry (proposal Appendix E.3, modules/flood/sensors): register,
 * calibrate, set thresholds, watch health and keep a maintenance log.
 *
 * Rule 6, sensor health: no reading for 5 minutes, a value stuck for 20 minutes
 * or a low battery marks a sensor faulty. A faulty sensor cannot count as a
 * signal, and staff get a ticket that stays open until someone logs maintenance.
 */

export const NO_READING_MS = 5 * 60_000;
const STUCK_MS = 20 * 60_000;
const STUCK_MIN_READINGS = 10;

const COLUMNS = [
  'id', 'zone_id', 'code', 'kind', 'site', 'secret', 'base_cm', 'overflow_cm', 'rise_cm_10min', 'low_battery_pct', 'status', 'health', 'health_reason',
  'last_seen_at', 'last_level_cm', 'last_level_pct', 'last_battery', 'last_rssi', 'simulated', 'sim_level_cm', 'sim_battery', 'sim_paused', 'sim_stuck', 'created_at',
];
export const SENSOR_COLUMNS = COLUMNS.join(', ');

export interface SensorRow {
  id: string;
  zone_id: string;
  code: string;
  kind: FloodSensorKind;
  site: FloodSensorSite;
  secret: string;
  base_cm: number;
  overflow_cm: number;
  rise_cm_10min: number;
  low_battery_pct: number;
  status: 'ACTIVE' | 'RETIRED';
  health: FloodSensorHealth;
  health_reason: FloodFaultReason | null;
  last_seen_at: Date | null;
  last_level_cm: number | null;
  last_level_pct: number | null;
  last_battery: number | null;
  last_rssi: number | null;
  simulated: boolean;
  sim_level_cm: number | null;
  sim_battery: number | null;
  sim_paused: boolean;
  sim_stuck: boolean;
  created_at: Date;
}

/** Rule 1: a level is a percentage of the sensor's calibrated height, from its base (0%) to overflow (100%). */
export function pctOf(sensor: Pick<SensorRow, 'base_cm' | 'overflow_cm'>, levelCm: number): number {
  const pct = ((levelCm - sensor.base_cm) / (sensor.overflow_cm - sensor.base_cm)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
export const cmOf = (sensor: Pick<SensorRow, 'base_cm' | 'overflow_cm'>, pct: number) => Math.round((sensor.base_cm + (pct / 100) * (sensor.overflow_cm - sensor.base_cm)) * 10) / 10;

async function lockSensor(q: Queryable, actor: Actor | null, sensorId: string): Promise<SensorRow & { township_id: string }> {
  const sensor = await one<SensorRow & { township_id: string }>(
    q,
    `SELECT ${COLUMNS.map((c) => `s.${c}`).join(', ')}, z.township_id FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id WHERE s.id = $1 FOR UPDATE OF s`,
    [sensorId],
  );
  if (!sensor) throw notFound('Sensor');
  if (actor) assertTownshipAccess(actor, sensor.township_id);
  return sensor;
}

/** Changes a sensor's health, logs it, and opens a ticket for staff when it becomes faulty. */
export async function setHealth(tx: Queryable, sensor: Pick<SensorRow, 'id' | 'zone_id' | 'code' | 'health' | 'health_reason'>, health: 'OK' | 'FAULTY', reason: FloodFaultReason | null, now: Date) {
  if (sensor.health === health && sensor.health_reason === reason) return;
  const was = sensor.health;
  await tx.query('UPDATE flood_sensors SET health = $2, health_reason = $3 WHERE id = $1', [sensor.id, health, reason]);
  sensor.health = health;
  sensor.health_reason = reason;
  if (health === 'FAULTY') {
    const open = await one(tx, 'SELECT 1 FROM flood_sensor_health WHERE sensor_id = $1 AND ticket_open', [sensor.id]);
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, reason, ticket_open, at) VALUES ($1, 'FAULT', $2, $3, $4)`, [sensor.id, reason, !open, now]);
    if (!open) {
      const staff = await tx.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN flood_zones z ON z.township_id = u.township_id WHERE z.id = $1 AND u.role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND u.status = 'ACTIVE'`,
        [sensor.zone_id],
      );
      await notify(tx, staff.map((u) => u.id), { title: `Sensor ${sensor.code} needs a check`, body: FLOOD_FAULT_LABELS[reason!], link: '/console/banjir' });
    }
  } else if (was === 'FAULTY') {
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, at) VALUES ($1, 'RECOVERED', $2)`, [sensor.id, now]);
  }
}

/** Health after a new reading: a low battery or a value stuck for 20 minutes is a fault; anything else is fine. */
export async function checkReadingHealth(tx: Queryable, sensor: SensorRow, at: Date) {
  if (sensor.last_battery !== null && sensor.last_battery < sensor.low_battery_pct) return setHealth(tx, sensor, 'FAULTY', 'LOW_BATTERY', at);
  // The readings of the last 20 minutes (a minute's grace for the reporting rhythm).
  const recent = await tx.query<{ level_cm: number; created_at: Date }>(
    `SELECT level_cm, created_at FROM flood_readings WHERE sensor_id = $1 AND created_at <= $2 AND created_at > $2::timestamptz - make_interval(secs => $3::double precision) ORDER BY created_at`,
    [sensor.id, at, (STUCK_MS + 60_000) / 1000],
  );
  const stuck =
    recent.length >= STUCK_MIN_READINGS &&
    at.getTime() - recent[0]!.created_at.getTime() >= STUCK_MS - 60_000 &&
    recent.every((r) => r.level_cm === recent[0]!.level_cm);
  if (stuck) return setHealth(tx, sensor, 'FAULTY', 'STUCK', at);
  return setHealth(tx, sensor, 'OK', null, at);
}

/** The scheduled check: a sensor that has said nothing for 5 minutes is faulty (rule 6). */
export async function checkSilentSensors(db: Db, now: Date, townshipId: string | null) {
  const silent = await db.query<{ id: string }>(
    `SELECT s.id FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id
      WHERE s.status = 'ACTIVE' AND ($2::uuid IS NULL OR z.township_id = $2)
        AND coalesce(s.last_seen_at, s.created_at) < $1::timestamptz - make_interval(secs => $3::double precision)
        AND NOT (s.health = 'FAULTY' AND s.health_reason = 'NO_READING')`,
    [now, townshipId, NO_READING_MS / 1000],
  );
  for (const { id } of silent) {
    await db.tx(async (tx) => {
      const sensor = await lockSensor(tx, null, id);
      await setHealth(tx, sensor, 'FAULTY', 'NO_READING', now);
    });
  }
  return silent.length;
}

// --- Registry ------------------------------------------------------------------

export interface SensorInput {
  zoneId: string;
  code: string;
  kind: FloodSensorKind;
  site: FloodSensorSite;
  locationNote?: string;
  baseCm: number;
  overflowCm: number;
  riseCm10min?: number;
  lowBatteryPct?: number;
  simulated: boolean;
}

/** Registers a sensor. Its signing key is returned once, to load into the device; it is never shown again. */
export async function registerSensor(db: Db, actor: Actor, input: SensorInput, now: Date) {
  if (input.overflowCm <= input.baseCm) throw ruleViolation('CALIBRATION_INVALID', 'The overflow height must be above the base height.', { fields: { overflowCm: 'Must be above the base height.' } });
  return db.tx(async (tx) => {
    const zone = await one<{ township_id: string }>(tx, 'SELECT township_id FROM flood_zones WHERE id = $1', [input.zoneId]);
    if (!zone) throw notFound('Zone');
    assertTownshipAccess(actor, zone.township_id);
    const code = input.code.trim().toUpperCase();
    if (await one(tx, 'SELECT 1 FROM flood_sensors WHERE code = $1', [code])) throw conflict('SENSOR_EXISTS', 'A sensor with this code is already registered.');
    const secret = randomBytes(32).toString('hex');
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO flood_sensors (zone_id, code, kind, site, location_note, secret, base_cm, overflow_cm, calibrated_at, rise_cm_10min, low_battery_pct, simulated, sim_level_cm, sim_battery, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $9) RETURNING id`,
      [input.zoneId, code, input.kind, input.site, input.locationNote ?? null, secret, input.baseCm, input.overflowCm, now, input.riseCm10min ?? 15, input.lowBatteryPct ?? 20,
        input.simulated, input.simulated ? input.baseCm + 0.1 * (input.overflowCm - input.baseCm) : null, input.simulated ? 96 : null],
    );
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, note, at, actor_user_id) VALUES ($1, 'REGISTERED', $2, $3, $4)`, [row!.id, input.locationNote ?? null, now, actor.id]);
    await audit(tx, actor.id, 'FLOOD_SENSOR_REGISTERED', 'flood_sensor', row!.id, { code, zoneId: input.zoneId, simulated: input.simulated });
    return { id: row!.id, code, secret };
  });
}

/** Calibrates on site against a known gauge (E.4): the base and overflow heights the percentages are measured on. */
export async function calibrateSensor(db: Db, actor: Actor, sensorId: string, input: { baseCm: number; overflowCm: number; note?: string }, now: Date) {
  if (input.overflowCm <= input.baseCm) throw ruleViolation('CALIBRATION_INVALID', 'The overflow height must be above the base height.', { fields: { overflowCm: 'Must be above the base height.' } });
  return db.tx(async (tx) => {
    const sensor = await lockSensor(tx, actor, sensorId);
    await tx.query('UPDATE flood_sensors SET base_cm = $2, overflow_cm = $3, calibrated_at = $4 WHERE id = $1', [sensor.id, input.baseCm, input.overflowCm, now]);
    const note = input.note ?? `Base ${sensor.base_cm} → ${input.baseCm} cm, overflow ${sensor.overflow_cm} → ${input.overflowCm} cm.`;
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, note, at, actor_user_id) VALUES ($1, 'CALIBRATED', $2, $3, $4)`, [sensor.id, note, now, actor.id]);
    await audit(tx, actor.id, 'FLOOD_SENSOR_CALIBRATED', 'flood_sensor', sensor.id, { from: { baseCm: sensor.base_cm, overflowCm: sensor.overflow_cm }, to: input });
    return { id: sensor.id };
  });
}

/** Rate of rise (rule 5) and the low-battery line (rule 6), set from the site survey. */
export async function setThresholds(db: Db, actor: Actor, sensorId: string, input: { riseCm10min: number; lowBatteryPct: number }, now: Date) {
  return db.tx(async (tx) => {
    const sensor = await lockSensor(tx, actor, sensorId);
    await tx.query('UPDATE flood_sensors SET rise_cm_10min = $2, low_battery_pct = $3 WHERE id = $1', [sensor.id, input.riseCm10min, input.lowBatteryPct]);
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, note, at, actor_user_id) VALUES ($1, 'THRESHOLDS', $2, $3, $4)`, [
      sensor.id, `Rise ${input.riseCm10min} cm in 10 minutes; battery below ${input.lowBatteryPct}%.`, now, actor.id,
    ]);
    await audit(tx, actor.id, 'FLOOD_SENSOR_THRESHOLDS', 'flood_sensor', sensor.id, { from: { riseCm10min: sensor.rise_cm_10min, lowBatteryPct: sensor.low_battery_pct }, to: input });
    return { id: sensor.id };
  });
}

/** Logs a visit or repair, and closes the sensor's open ticket. */
export async function logMaintenance(db: Db, actor: Actor, sensorId: string, input: { note: string }, now: Date) {
  return db.tx(async (tx) => {
    const sensor = await lockSensor(tx, actor, sensorId);
    const closed = await tx.query(`UPDATE flood_sensor_health SET ticket_open = false, resolved_at = $2 WHERE sensor_id = $1 AND ticket_open RETURNING id`, [sensor.id, now]);
    await tx.query(`INSERT INTO flood_sensor_health (sensor_id, kind, note, at, actor_user_id) VALUES ($1, 'MAINTENANCE', $2, $3, $4)`, [sensor.id, input.note, now, actor.id]);
    await audit(tx, actor.id, 'FLOOD_SENSOR_MAINTENANCE', 'flood_sensor', sensor.id, { ticketClosed: closed.length > 0 });
    return { id: sensor.id, ticketClosed: closed.length > 0 };
  });
}

/** The Sensors tab: every sensor with its health, last reading, open ticket, uptime and recent log. Never the key. */
export async function listSensors(db: Db, actor: Actor, now: Date) {
  const sensors = await db.query<Record<string, unknown> & { id: string }>(
    `SELECT s.id, s.zone_id, z.name AS zone_name, s.code, s.kind, s.site, s.location_note, s.base_cm, s.overflow_cm, s.calibrated_at, s.rise_cm_10min, s.low_battery_pct,
            s.status, s.health, s.health_reason, s.last_seen_at, s.last_level_cm, s.last_level_pct, s.last_battery, s.last_rssi,
            s.simulated, s.sim_paused, s.sim_stuck, s.sim_battery,
            (SELECT json_build_object('reason', h.reason, 'at', h.at) FROM flood_sensor_health h WHERE h.sensor_id = s.id AND h.ticket_open) AS ticket,
            ${uptimeSql('s.id', '$2')} AS uptime_pct
       FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id
      WHERE s.status = 'ACTIVE' AND ($1::uuid IS NULL OR z.township_id = $1)
      ORDER BY z.name, s.code`,
    [actor.townshipId, now],
  );
  const logs = sensors.length
    ? await db.query<{ sensor_id: string }>(
        `SELECT * FROM (SELECT h.id, h.sensor_id, h.kind, h.reason, h.note, h.ticket_open, h.at, h.resolved_at, u.full_name AS actor_name,
                               row_number() OVER (PARTITION BY h.sensor_id ORDER BY h.id DESC) AS n
                          FROM flood_sensor_health h LEFT JOIN users u ON u.id = h.actor_user_id WHERE h.sensor_id = ANY($1::uuid[])) x
          WHERE n <= 6 ORDER BY id DESC`,
        [sensors.map((s) => s.id)],
      )
    : [];
  return sensors.map((s) => ({ ...s, log: logs.filter((l) => l.sensor_id === s.id) }));
}

/**
 * Sensor uptime over the last 24 hours (E.3 Insights tile): the share of minutes,
 * since the sensor was registered, in which it sent at least one reading.
 */
export const uptimeSql = (sensorId: string, now: string) => `(
  SELECT CASE WHEN mins <= 0 THEN NULL ELSE round(100.0 * least(seen, mins) / mins)::int END FROM (
    SELECT (SELECT count(DISTINCT date_trunc('minute', r.created_at)) FROM flood_readings r
             WHERE r.sensor_id = ${sensorId} AND r.created_at > ${now}::timestamptz - interval '24 hours' AND r.created_at <= ${now}::timestamptz)::numeric AS seen,
           ceil(extract(epoch FROM ${now}::timestamptz - greatest((SELECT created_at FROM flood_sensors WHERE id = ${sensorId}), ${now}::timestamptz - interval '24 hours')) / 60)::numeric AS mins
  ) u)`;

// --- Prototype simulator ---------------------------------------------------------
//
// A simulated sensor is a row like any other, with its own key. The console moves
// its water level; the agent clock makes it report on its normal rhythm. Every
// reading is signed with the sensor's key and goes through the same ingestion as a
// real device's, so the demo proves the real path (E.3, build order step 5).

const jitter = () => Math.round((Math.random() - 0.5) * 6) / 10; // ±0.3 cm, as a real sensor wobbles

function simReading(sensor: SensorRow, now: Date): SignedReading {
  const base = sensor.sim_level_cm ?? sensor.base_cm;
  const levelCm = sensor.sim_stuck && sensor.last_level_cm !== null ? sensor.last_level_cm : Math.max(0, Math.round((base + jitter()) * 10) / 10);
  const reading = { sensor_id: sensor.id, zone_id: sensor.zone_id, level_cm: levelCm, battery: sensor.sim_battery ?? 95, rssi: -72 - Math.round(Math.random() * 8), ts: now.toISOString() };
  return { ...reading, signature: signReading(sensor.secret, reading) };
}

/** The console's zone slider: every simulated sensor in the zone moves to that level and reports at once. */
export async function simulateZoneLevel(tx: Queryable, zoneId: string, levelPct: number, now: Date): Promise<boolean> {
  const sensors = await tx.query<SensorRow>(`SELECT ${SENSOR_COLUMNS} FROM flood_sensors WHERE zone_id = $1 AND simulated AND status = 'ACTIVE' ORDER BY code FOR UPDATE`, [zoneId]);
  if (sensors.length === 0) return false;
  const readings: SignedReading[] = [];
  for (const sensor of sensors) {
    sensor.sim_level_cm = cmOf(sensor, levelPct);
    await tx.query('UPDATE flood_sensors SET sim_level_cm = $2 WHERE id = $1', [sensor.id, sensor.sim_level_cm]);
    if (!sensor.sim_paused) readings.push(simReading(sensor, now));
  }
  if (readings.length) await storeReadings(tx, readings, now);
  return true;
}

export type SimAction = 'POWER_CUT' | 'POWER_ON' | 'LOW_BATTERY' | 'BATTERY_OK' | 'STUCK' | 'UNSTUCK';

/** Test controls for one simulated sensor: cut its power, drain its battery, or make it repeat one value. */
export async function simulateSensorFault(db: Db, actor: Actor, sensorId: string, action: SimAction, now: Date) {
  return db.tx(async (tx) => {
    const sensor = await lockSensor(tx, actor, sensorId);
    if (!sensor.simulated) throw ruleViolation('NOT_SIMULATED', 'Only a simulated sensor has test controls.');
    const change: Partial<SensorRow> =
      action === 'POWER_CUT' ? { sim_paused: true }
      : action === 'POWER_ON' ? { sim_paused: false }
      : action === 'LOW_BATTERY' ? { sim_battery: 9 }
      : action === 'BATTERY_OK' ? { sim_battery: 96 }
      : action === 'STUCK' ? { sim_stuck: true }
      : { sim_stuck: false };
    Object.assign(sensor, change);
    await tx.query('UPDATE flood_sensors SET sim_paused = $2, sim_battery = $3, sim_stuck = $4 WHERE id = $1', [sensor.id, sensor.sim_paused, sensor.sim_battery, sensor.sim_stuck]);
    await audit(tx, actor.id, 'FLOOD_SENSOR_SIMULATED', 'flood_sensor', sensor.id, { action });
    if (!sensor.sim_paused && action !== 'STUCK') await storeReadings(tx, [simReading(sensor, now)], now);
    return { id: sensor.id, action };
  });
}

/**
 * Simulated sensors report on a real sensor's rhythm (E.1): every 60 seconds, or
 * every 15 seconds above the warning line. Called by the agent clock.
 */
export async function simulatedHeartbeat(db: Db, now: Date, townshipId: string | null) {
  const s = await getSettings(db);
  const due = await db.query<{ id: string }>(
    `SELECT s.id FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id
      WHERE s.simulated AND NOT s.sim_paused AND s.status = 'ACTIVE' AND ($2::uuid IS NULL OR z.township_id = $2)
        AND (s.last_seen_at IS NULL OR s.last_seen_at <= $1::timestamptz - make_interval(secs => CASE WHEN coalesce(s.last_level_pct, 0) >= $3 THEN 15 ELSE 60 END))`,
    [now, townshipId, s.flood_warning_pct],
  );
  for (const { id } of due) {
    await db.tx(async (tx) => {
      const sensor = await one<SensorRow>(tx, `SELECT ${SENSOR_COLUMNS} FROM flood_sensors WHERE id = $1 FOR UPDATE`, [id]);
      if (!sensor || sensor.sim_paused) return;
      await storeReadings(tx, [simReading(sensor, now)], now);
    });
  }
  return due.length;
}
