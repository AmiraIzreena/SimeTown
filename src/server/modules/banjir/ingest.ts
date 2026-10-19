import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FloodStatus } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { badRequest, conflict, unauthorized } from '../../errors';
import { getSettings } from '../settings';
import { SIGNAL_FRESH_MS, evaluateZone } from './agent';
import { checkReadingHealth, pctOf, type SensorRow, SENSOR_COLUMNS } from './sensors';

/**
 * Signed sensor readings (proposal Appendix E.1 and E.3, modules/flood/ingest).
 *
 * A sensor signs every reading with its own key, like the recycling machine
 * does. Ingestion checks the signature and the zone, drops a reading it has
 * already stored (a gateway re-sends what it buffered while its link was down),
 * stores it, checks the sensor's health and wakes the agent for that zone.
 *
 *   payload: sensor_id, zone_id, level_cm, battery, rssi, ts, signature
 *   signed text: reading|sensor_id|zone_id|level_cm (one decimal)|battery|rssi|ts
 */

/** A buffered reading may arrive late, but not from the future and not from yesterday. */
const MAX_FUTURE_MS = 2 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;

export interface Reading {
  sensor_id: string;
  zone_id: string;
  level_cm: number;
  battery: number;
  rssi: number;
  ts: string;
}
export interface SignedReading extends Reading {
  signature: string;
}

export const readingText = (r: Reading) => ['reading', r.sensor_id, r.zone_id, r.level_cm.toFixed(1), r.battery, r.rssi, r.ts].join('|');
export const signReading = (secret: string, r: Reading) => createHmac('sha256', secret).update(readingText(r)).digest('hex');

function sameHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export interface StoredReading {
  sensorId: string;
  levelPct: number;
  duplicate: boolean;
  /** How soon the sensor should report again: every 60 seconds, or every 15 above the warning line. */
  nextReportSec: number;
}

/**
 * Stores signed readings inside the caller's transaction. Every record is checked
 * before anything is stored, so one bad signature rejects the whole batch.
 */
export async function storeReadings(tx: Queryable, records: SignedReading[], now: Date) {
  const s = await getSettings(tx);
  const sensors = new Map<string, SensorRow>();
  for (const r of records) {
    let sensor = sensors.get(r.sensor_id);
    if (!sensor) {
      sensor = await one<SensorRow>(tx, `SELECT ${SENSOR_COLUMNS} FROM flood_sensors WHERE id = $1 FOR UPDATE`, [r.sensor_id]);
      if (!sensor) throw unauthorized('This sensor is not registered.');
      sensors.set(r.sensor_id, sensor);
    }
    if (!sameHex(signReading(sensor.secret, r), r.signature.toLowerCase())) throw unauthorized('The sensor reading is not signed correctly.');
    if (sensor.zone_id !== r.zone_id) throw unauthorized('The reading names a different zone from the one the sensor is registered to.');
    if (sensor.status !== 'ACTIVE') throw conflict('SENSOR_RETIRED', 'This sensor has been retired.');
    const at = Date.parse(r.ts);
    if (!Number.isFinite(at)) throw badRequest('The reading time is not valid.');
    if (at > now.getTime() + MAX_FUTURE_MS) throw badRequest('The reading is dated in the future.');
    if (at < now.getTime() - MAX_AGE_MS) throw badRequest('The reading is more than 24 hours old.');
  }

  const stored: StoredReading[] = [];
  const wake = new Set<string>();
  for (const r of [...records].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const sensor = sensors.get(r.sensor_id)!;
    const at = new Date(r.ts);
    const levelCm = Math.round(r.level_cm * 10) / 10;
    const pct = pctOf(sensor, levelCm);
    const row = await one<{ id: number }>(
      tx,
      `INSERT INTO flood_readings (zone_id, level_pct, source, created_at, sensor_id, level_cm, battery, rssi, signature)
       VALUES ($1, $2, 'SENSOR', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sensor_id, created_at) WHERE sensor_id IS NOT NULL DO NOTHING RETURNING id`,
      [sensor.zone_id, pct, at, sensor.id, levelCm, r.battery, r.rssi, r.signature.toLowerCase()],
    );
    const nextReportSec = pct >= s.flood_warning_pct ? 15 : 60;
    if (!row) {
      stored.push({ sensorId: sensor.id, levelPct: pct, duplicate: true, nextReportSec });
      continue;
    }
    // Every reading is a signal, even a late one, so the history and the hysteresis rule see it.
    await tx.query(
      `INSERT INTO flood_signals (zone_id, source, level_pct, detail, created_at, sensor_id, level_cm) VALUES ($1, 'SENSOR', $2, $3::jsonb, $4, $5, $6)`,
      [sensor.zone_id, pct, JSON.stringify({ sensor: sensor.code }), at, sensor.id, levelCm],
    );
    if (!sensor.last_seen_at || at >= sensor.last_seen_at) {
      await tx.query(
        `UPDATE flood_sensors SET last_seen_at = $2, last_level_cm = $3, last_level_pct = $4, last_battery = $5, last_rssi = $6 WHERE id = $1`,
        [sensor.id, at, levelCm, pct, r.battery, r.rssi],
      );
      Object.assign(sensor, { last_seen_at: at, last_level_cm: levelCm, last_level_pct: pct, last_battery: r.battery, last_rssi: r.rssi });
      await checkReadingHealth(tx, sensor, at);
    }
    if (now.getTime() - at.getTime() <= SIGNAL_FRESH_MS) wake.add(sensor.zone_id);
    stored.push({ sensorId: sensor.id, levelPct: pct, duplicate: false, nextReportSec });
  }

  // Event-driven: the agent looks at each zone that has something new (the scheduled run stays as a safety net).
  const zones: { zoneId: string; status: FloodStatus }[] = [];
  for (const zoneId of wake) {
    await evaluateZone(tx, zoneId, now);
    zones.push({ zoneId, status: (await one<{ status: FloodStatus }>(tx, 'SELECT status FROM flood_zones WHERE id = $1', [zoneId]))!.status });
  }
  return { stored: stored.filter((r) => !r.duplicate).length, duplicates: stored.filter((r) => r.duplicate).length, readings: stored, zones };
}

/** POST /flood/readings: one reading, or a gateway's buffered batch. */
export async function ingestReadings(db: Db, records: SignedReading[], now: Date) {
  return db.tx((tx) => storeReadings(tx, records, now));
}
