import { randomBytes, randomUUID } from 'node:crypto';
import { LOCKER_SIZE_INFO, LOCKER_SIZES, type LockerSize, type ParcelState } from '@/shared/lockers';
import { ADMINS, shortAddress, type HomeAddress } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { getSettings } from '../settings';
import { HOME_ADDRESS_COLUMNS, resolveTownship } from '../townships';
import { createUnlock, dispatch, handleDoor, replayCommand, type CompartmentRow, type StationRow } from './hardware';
import { pickupAtStation } from './collection';
import { unlockKeypad, userActor, type ParcelRow } from './core';
import { parcelNotes } from './overflow';

/**
 * Property management: stations and compartments, the live capacity
 * dashboard, a plain forecast, parcel monitoring and the locker simulator.
 */

// --- Stations ---------------------------------------------------------------------------------

export interface StationInput {
  name: string;
  location: string;
  layout: Partial<Record<LockerSize, number>>;
  adapter: 'SIMULATED' | 'HTTP_GATEWAY';
  gatewayUrl?: string;
  hasDoorSensor: boolean;
  hasPresenceSensor: boolean;
  lat?: number;
  lng?: number;
  /** The precincts whose homes get their own door here. Empty: every home in the township. */
  precincts?: string[];
}

/** A new station with its compartments. A gateway station's device secret is shown once, here. */
export async function createStation(db: Db, actor: Actor, input: StationInput) {
  const total = LOCKER_SIZES.reduce((sum, s) => sum + (input.layout[s] ?? 0), 0);
  if (total < 1 || total > 400) throw ruleViolation('LAYOUT', 'A station needs between 1 and 400 compartments.');
  if (input.adapter === 'HTTP_GATEWAY' && !input.gatewayUrl) throw ruleViolation('GATEWAY_URL', 'Give the gateway address for this station.');
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM locker_stations WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) throw conflict('STATION_EXISTS', 'A station with this name already exists.');
    const secret = randomBytes(32).toString('hex');
    const station = await one<{ id: string; code: string }>(
      tx,
      `INSERT INTO locker_stations (township_id, name, code, location, lat, lng, adapter, gateway_url, device_secret, has_door_sensor, has_presence_sensor, precincts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, code`,
      [townshipId, input.name.trim(), `L${randomCode(7)}`, input.location.trim(), input.lat ?? null, input.lng ?? null, input.adapter, input.gatewayUrl ?? null, secret, input.hasDoorSensor, input.hasPresenceSensor,
        [...new Set((input.precincts ?? []).map((p) => p.trim()).filter(Boolean))]],
    );
    let n = 0;
    for (const size of LOCKER_SIZES) {
      const [w, h, d] = LOCKER_SIZE_INFO[size].mm;
      for (let i = 0; i < (input.layout[size] ?? 0); i++) {
        n++;
        await tx.query('INSERT INTO locker_compartments (station_id, label, size, width_mm, height_mm, depth_mm) VALUES ($1, $2, $3, $4, $5, $6)', [station!.id, `A${String(n).padStart(2, '0')}`, size, w, h, d]);
      }
    }
    await audit(tx, actor.id, 'LOCKER_STATION_ADDED', 'locker_station', station!.id, { name: input.name, compartments: n, adapter: input.adapter });
    return { id: station!.id, code: station!.code, deviceSecret: input.adapter === 'HTTP_GATEWAY' ? secret : null };
  });
}

async function loadStation(q: Queryable, actor: Actor, stationId: string): Promise<StationRow> {
  const s = await one<StationRow>(q, 'SELECT * FROM locker_stations WHERE id = $1', [stationId]);
  if (!s) throw notFound('Station');
  assertTownshipAccess(actor, s.township_id);
  return s;
}

export async function setStationStatus(db: Db, actor: Actor, stationId: string, status: StationRow['status']) {
  const s = await loadStation(db, actor, stationId);
  await db.query('UPDATE locker_stations SET status = $2 WHERE id = $1', [s.id, status]);
  await audit(db, actor.id, 'LOCKER_STATION_STATUS', 'locker_station', s.id, { from: s.status, to: status });
  return { ok: true };
}

/** Unlock a station keypad that locked itself after too many wrong codes, once staff are satisfied it is safe. */
export async function unlockStationKeypad(db: Db, actor: Actor, stationId: string, now: Date) {
  const s = await loadStation(db, actor, stationId);
  await db.tx((tx) => unlockKeypad(tx, s.township_id, s.id, actor.id, now));
  await audit(db, actor.id, 'LOCKER_KEYPAD_UNLOCKED', 'locker_station', s.id);
  return { ok: true };
}

/** A new device secret for a gateway station; the old one stops working at once. Admins only. */
export async function rotateDeviceSecret(db: Db, actor: Actor, stationId: string) {
  if (!ADMINS.includes(actor.role)) throw forbidden();
  const s = await loadStation(db, actor, stationId);
  const secret = randomBytes(32).toString('hex');
  await db.query('UPDATE locker_stations SET device_secret = $2 WHERE id = $1', [s.id, secret]);
  await audit(db, actor.id, 'LOCKER_SECRET_ROTATED', 'locker_station', s.id);
  return { deviceSecret: secret };
}

/** Take a compartment out of use, bring it back, or clear a fault once it has been inspected. */
export async function setCompartment(db: Db, actor: Actor, compartmentId: string, action: 'DISABLE' | 'ENABLE' | 'CLEAR_FAULT', now: Date) {
  return db.tx(async (tx) => {
    const c = await one<CompartmentRow & { township_id: string }>(
      tx, 'SELECT c.*, s.township_id FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id WHERE c.id = $1 FOR UPDATE OF c', [compartmentId],
    );
    if (!c) throw notFound('Compartment');
    assertTownshipAccess(actor, c.township_id);
    let next: CompartmentRow['state'] = c.state;
    if (action === 'DISABLE') {
      if (c.parcel_id) throw conflict('COMPARTMENT_IN_USE', 'A parcel is in this door. The household collects it first, or ask for staff access under Emergency door access.');
      next = 'DISABLED';
    } else if (action === 'ENABLE') {
      if (c.state !== 'DISABLED') throw conflict('COMPARTMENT_STATE', 'This compartment is not disabled.');
      next = 'AVAILABLE';
    } else {
      next = c.parcel_id ? 'OCCUPIED' : 'AVAILABLE';
    }
    await tx.query('UPDATE locker_compartments SET state = $2, fault = NULL, sim_fail_next = false, updated_at = $3 WHERE id = $1', [c.id, next, now]);
    await audit(tx, actor.id, `COMPARTMENT_${action}`, 'locker_compartment', c.id, { from: c.state, to: next });
    return { state: next };
  });
}

/**
 * Opens an empty compartment for maintenance. Admins only, never one holding a
 * parcel (that needs an approved staff access request), and always logged.
 */
export async function maintenanceUnlock(db: Db, actor: Actor, compartmentId: string, reason: string, idempotencyKey: string, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can open a compartment for maintenance.');
  const commandId = await db.tx(async (tx) => {
    const c = await one<CompartmentRow & { township_id: string }>(tx, 'SELECT c.*, s.township_id FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id WHERE c.id = $1 FOR UPDATE OF c', [compartmentId]);
    if (!c) throw notFound('Compartment');
    assertTownshipAccess(actor, c.township_id);
    if (c.parcel_id) throw conflict('COMPARTMENT_IN_USE', 'A parcel is in this door. Ask for staff access under Emergency door access instead.');
    const command = await createUnlock(tx, { stationId: c.station_id, compartmentId: c.id, parcelId: null, purpose: 'MAINTENANCE', requestedBy: actor.id, idempotencyKey }, now);
    await audit(tx, actor.id, 'MAINTENANCE_UNLOCK', 'locker_compartment', c.id, { reason });
    return command.id;
  });
  const command = await dispatch(db, commandId, now);
  return { status: command.status, error: command.error };
}

// --- Private doors ----------------------------------------------------------------------------

/** A station's doors and the home each belongs to. A home claims a free door with its first parcel. */
export async function stationDoors(db: Db, actor: Actor, stationId: string) {
  const s = await loadStation(db, actor, stationId);
  // Named apart: a home's address also has a "state" column (Selangor, Johor…).
  const rows = await db.query<HomeAddress & { id: string; label: string; size: string; door_state: string; fault: string | null; home_id: string | null; tracking_no: string | null }>(
    `SELECT c.id, c.label, c.size, c.state AS door_state, c.fault, c.home_id, p.tracking_no, ${HOME_ADDRESS_COLUMNS}
       FROM locker_compartments c LEFT JOIN homes h ON h.id = c.home_id LEFT JOIN locker_parcels p ON p.id = c.parcel_id
      WHERE c.station_id = $1 ORDER BY c.label`,
    [s.id],
  );
  const homes = await one<{ total: number; with_door: number }>(
    db,
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM locker_compartments c WHERE c.home_id = h.id))::int AS with_door
       FROM homes h WHERE h.township_id = $1 AND (cardinality($2::text[]) = 0 OR h.precinct = ANY($2::text[]))`,
    [s.township_id, s.precincts ?? []],
  );
  return {
    station: { id: s.id, name: s.name, precincts: s.precincts ?? [] },
    homes: { total: homes!.total, withDoor: homes!.with_door, withoutDoor: homes!.total - homes!.with_door },
    doors: rows.map((r) => ({ id: r.id, label: r.label, size: r.size, state: r.door_state, fault: r.fault, trackingNo: r.tracking_no, house: r.home_id ? shortAddress(r) : null })),
  };
}

/** Admins free a door when its household moves out. The next home to need one claims it with its first parcel. */
export async function releaseDoor(db: Db, actor: Actor, compartmentId: string, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can release a door.');
  return db.tx(async (tx) => {
    const c = await one<CompartmentRow & { township_id: string }>(tx, 'SELECT c.*, s.township_id FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id WHERE c.id = $1 FOR UPDATE OF c', [compartmentId]);
    if (!c) throw notFound('Door');
    assertTownshipAccess(actor, c.township_id);
    if (!c.home_id) throw conflict('DOOR_FREE', 'This door does not belong to a home.');
    if (c.parcel_id) throw conflict('COMPARTMENT_IN_USE', 'A parcel is in this door. The household collects it first.');
    await tx.query('UPDATE locker_compartments SET home_id = NULL, updated_at = $2 WHERE id = $1', [c.id, now]);
    await audit(tx, actor.id, 'LOCKER_DOOR_RELEASED', 'locker_compartment', c.id, { home: c.home_id });
    return { ok: true };
  });
}

// --- The capacity dashboard -------------------------------------------------------------------

/**
 * Every station's compartments by state, counted from the compartments
 * themselves so the totals always agree with what is in the lockers, plus what
 * needs doing.
 */
export async function lockerOverview(db: Db, actor: Actor, now: Date) {
  const t = actor.townshipId;
  const [stations, overflow, trend] = await Promise.all([
    db.query<{
      id: string; name: string; code: string; location: string; status: string; adapter: string; last_seen_at: Date | null;
      total: number; available: number; occupied: number; reserved: number; faulty: number; disabled: number;
      waiting_long: number; assigned: number; failed_30d: number; avg_collect_hours: number | null; free_by_size: Record<string, number> | null;
      keypad_locked_at: Date | null; keypad_help: number; wrong_codes_today: number;
    }>(
      `SELECT s.id, s.name, s.code, s.location, s.status, s.adapter, s.last_seen_at,
              count(c.id)::int AS total,
              count(c.id) FILTER (WHERE c.state = 'AVAILABLE')::int AS available,
              count(c.id) FILTER (WHERE c.state = 'OCCUPIED')::int AS occupied,
              count(c.id) FILTER (WHERE c.state = 'RESERVED')::int AS reserved,
              count(c.id) FILTER (WHERE c.state = 'FAULTY')::int AS faulty,
              count(c.id) FILTER (WHERE c.state = 'DISABLED')::int AS disabled,
              (SELECT count(*)::int FROM locker_parcels p WHERE p.station_id = s.id AND p.compartment_id IS NOT NULL AND p.state = 'READY_FOR_COLLECTION' AND p.last_reminder_at IS NOT NULL) AS waiting_long,
              count(c.id) FILTER (WHERE c.home_id IS NOT NULL)::int AS assigned,
              ((SELECT count(*) FROM locker_parcels p WHERE p.station_id = s.id AND p.state = 'DELIVERY_FAILED' AND p.state_changed_at > $2::timestamptz - interval '30 days')
                + (SELECT count(*) FROM locker_commands k WHERE k.station_id = s.id AND k.purpose = 'DEPOSIT' AND k.status IN ('FAILED', 'TIMED_OUT') AND k.created_at > $2::timestamptz - interval '30 days'))::int AS failed_30d,
              (SELECT round(avg(extract(epoch FROM p.collected_at - p.ready_at) / 3600)::numeric, 1)::float FROM locker_parcels p
                WHERE p.station_id = s.id AND p.state = 'COLLECTED' AND p.compartment_id IS NOT NULL AND p.collected_at > $2::timestamptz - interval '30 days') AS avg_collect_hours,
              (SELECT json_object_agg(size, n) FROM (SELECT size, count(*)::int AS n FROM locker_compartments x WHERE x.station_id = s.id AND x.state = 'AVAILABLE' GROUP BY size) z) AS free_by_size,
              (SELECT l.locked_at FROM pickup_lockouts l WHERE l.location_id = s.id AND l.cleared_at IS NULL) AS keypad_locked_at,
              (SELECT count(*)::int FROM pickup_lockout_help h JOIN pickup_lockouts l ON l.id = h.lockout_id WHERE l.location_id = s.id AND l.cleared_at IS NULL) AS keypad_help,
              (SELECT count(*)::int FROM pickup_attempts a WHERE a.location_id = s.id AND NOT a.ok AND a.at > $2::timestamptz - interval '1 day') AS wrong_codes_today
         FROM locker_stations s LEFT JOIN locker_compartments c ON c.station_id = s.id
        WHERE ($1::uuid IS NULL OR s.township_id = $1)
        GROUP BY s.id ORDER BY s.name`,
      [t, now],
    ),
    db.query<{ id: string; name: string; capacity: number; held: number; active: boolean; overdue: number; calls_due: number }>(
      `SELECT o.id, o.name, o.capacity, o.active, (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')) AS held,
              (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state = 'RELOCATED_TO_STORAGE' AND p.overdue_at IS NOT NULL) AS overdue,
              (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state = 'RELOCATED_TO_STORAGE' AND p.call_requested_at IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM locker_parcel_notes n WHERE n.parcel_id = p.id AND n.created_at >= p.call_requested_at)) AS calls_due
         FROM overflow_locations o WHERE ($1::uuid IS NULL OR o.township_id = $1) ORDER BY o.name`,
      [t],
    ),
    db.query<{ day: string; arrivals: number; collections: number }>(
      `WITH days AS (SELECT generate_series(($2::timestamptz AT TIME ZONE $3)::date - 13, ($2::timestamptz AT TIME ZONE $3)::date, interval '1 day')::date AS day)
       SELECT d.day::text AS day,
              (SELECT count(*)::int FROM locker_parcels p WHERE ($1::uuid IS NULL OR p.township_id = $1) AND p.ready_at IS NOT NULL AND (p.ready_at AT TIME ZONE $3)::date = d.day) AS arrivals,
              (SELECT count(*)::int FROM locker_parcels p WHERE ($1::uuid IS NULL OR p.township_id = $1) AND p.collected_at IS NOT NULL AND (p.collected_at AT TIME ZONE $3)::date = d.day) AS collections
         FROM days d ORDER BY d.day`,
      [t, now, (await getSettings(db)).timezone],
    ),
  ]);
  const alerts: { level: 'danger' | 'warning'; text: string }[] = [];
  for (const s of stations) {
    const usable = s.total - s.disabled;
    const used = s.occupied + s.reserved;
    if (s.status !== 'ONLINE') alerts.push({ level: 'danger', text: `${s.name} is ${s.status.toLowerCase()}` });
    if (s.keypad_locked_at) {
      alerts.push({ level: 'danger', text: s.keypad_help ? `${s.name}: keypad locked, and ${s.keypad_help} resident${s.keypad_help === 1 ? '' : 's'} asked for it to be unlocked` : `${s.name}: keypad locked after too many wrong codes` });
    }
    // With private doors a busy bank is normal: what needs someone is a door out of use, or no free door left for a new home.
    if (usable > 0 && used / usable >= 0.95 && s.assigned >= usable) alerts.push({ level: 'warning', text: `${s.name}: no free door left for a new home` });
    if (s.faulty) alerts.push({ level: 'warning', text: `${s.name}: ${s.faulty} door${s.faulty === 1 ? ' needs' : 's need'} checking` });
  }
  for (const o of overflow) {
    if (!o.active) continue;
    if (o.held >= o.capacity) alerts.push({ level: 'danger', text: `${o.name} is full` });
    else if (o.held >= Math.ceil(o.capacity * 0.8)) alerts.push({ level: 'warning', text: `${o.name} is ${Math.round((o.held / o.capacity) * 100)}% full` });
    if (o.calls_due) alerts.push({ level: 'warning', text: `${o.name}: ${o.calls_due} household${o.calls_due === 1 ? '' : 's'} to call about a parcel` });
  }
  // Locker and courier cases from the central incident system: the ones that need someone now.
  const cases = (await one<{ active: number; critical: number; untaken: number; late: number; disputes: number }>(
    db,
    `SELECT count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED'))::int AS active,
            count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED') AND priority = 'CRITICAL')::int AS critical,
            count(*) FILTER (WHERE owner_id IS NULL AND status IN ('OPEN', 'REOPENED') AND assign_due_at < $2)::int AS untaken,
            count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED') AND resolve_due_at < $2)::int AS late,
            count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED') AND kind = 'COLLECTION_DISPUTE')::int AS disputes
       FROM incidents WHERE ($1::uuid IS NULL OR township_id = $1) AND module IN ('LOCKERS', 'COURIERS')`,
    [t, now],
  ))!;
  if (cases.critical) alerts.push({ level: 'danger', text: `${cases.critical} critical locker case${cases.critical === 1 ? '' : 's'} open` });
  if (cases.untaken) alerts.push({ level: 'danger', text: `${cases.untaken} locker case${cases.untaken === 1 ? '' : 's'} nobody took in time` });
  if (cases.late) alerts.push({ level: 'warning', text: `${cases.late} locker case${cases.late === 1 ? '' : 's'} past the resolution deadline` });
  if (cases.disputes) alerts.push({ level: 'warning', text: `${cases.disputes} collection dispute${cases.disputes === 1 ? '' : 's'} open` });
  return {
    stations: stations.map((s) => ({ ...s, utilisationPct: s.total - s.disabled > 0 ? Math.round(((s.occupied + s.reserved) / (s.total - s.disabled)) * 100) : 0 })),
    overflow,
    trend,
    alerts,
    cases,
  };
}

// --- Forecast ---------------------------------------------------------------------------------

/**
 * A plain forecast anyone can check: tomorrow's arrivals are the average for
 * that weekday over the last four weeks (or the overall daily average when
 * there is too little history), collections follow the share of parcels picked
 * up within a day. It says how much history it had, and claims no accuracy.
 */
export async function lockerForecast(db: Db, actor: Actor, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const stations = await db.query<{ id: string; name: string; total: number; usable: number; occupied: number; reserved: number; overdue: number }>(
    `SELECT s.id, s.name, count(c.id)::int AS total, count(c.id) FILTER (WHERE c.state NOT IN ('FAULTY', 'DISABLED'))::int AS usable,
            count(c.id) FILTER (WHERE c.state = 'OCCUPIED')::int AS occupied, count(c.id) FILTER (WHERE c.state = 'RESERVED')::int AS reserved,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.station_id = s.id AND p.state IN ('OVERDUE', 'RELOCATION_PENDING')) AS overdue
       FROM locker_stations s LEFT JOIN locker_compartments c ON c.station_id = s.id WHERE ($1::uuid IS NULL OR s.township_id = $1) GROUP BY s.id ORDER BY s.name`,
    [actor.townshipId],
  );
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(now.getTime() + 86_400_000));
  const tomorrowDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
  // A locker arrival is a parcel that was actually deposited in a compartment.
  const DEPOSITED = `EXISTS (SELECT 1 FROM parcel_events e WHERE e.parcel_id = p.id AND e.to_state = 'DEPOSITED')`;
  const out = [];
  for (const s of stations) {
    const history = await db.query<{ dow: number; n: number }>(
      `SELECT extract(dow FROM p.ready_at AT TIME ZONE $3)::int AS dow, count(*)::int AS n
         FROM locker_parcels p WHERE p.station_id = $1 AND p.ready_at > $2::timestamptz - interval '28 days' AND ${DEPOSITED}
        GROUP BY 1`,
      [s.id, now, tz],
    );
    const first = await one<{ first: Date | null }>(db, `SELECT min(p.ready_at) AS first FROM locker_parcels p WHERE p.station_id = $1 AND ${DEPOSITED}`, [s.id]);
    const daysOfHistory = first?.first ? Math.min(28, Math.max(1, Math.ceil((now.getTime() - first.first.getTime()) / 86_400_000))) : 0;
    const total = history.reduce((sum, h) => sum + h.n, 0);
    const sameDay = history.filter((h) => h.dow === tomorrowDow);
    const weeks = Math.max(1, Math.floor(daysOfHistory / 7));
    const useWeekday = daysOfHistory >= 14 && sameDay.length > 0;
    const arrivals = daysOfHistory === 0 ? 0 : useWeekday ? Math.round(sameDay.reduce((a, h) => a + h.n, 0) / weeks) : Math.round(total / daysOfHistory);
    const pickup = await one<{ within: number; all: number }>(
      db,
      `SELECT count(*) FILTER (WHERE p.collected_at IS NOT NULL AND p.collected_at - p.ready_at <= interval '24 hours')::int AS within, count(*)::int AS "all"
         FROM locker_parcels p WHERE p.station_id = $1 AND p.ready_at < $2::timestamptz - interval '24 hours' AND p.ready_at > $2::timestamptz - interval '30 days' AND ${DEPOSITED}`,
      [s.id, now],
    );
    const p24 = pickup!.all > 0 ? pickup!.within / pickup!.all : 0.6;
    const collections = Math.round(s.occupied * p24);
    const projected = Math.max(0, s.occupied + s.reserved + arrivals - collections);
    const recommendations: string[] = [];
    if (projected > s.usable) recommendations.push(`About ${projected - s.usable} parcels may go to the guardhouse tomorrow, because their homes' doors will be in use: make sure the guardhouse has room.`);
    else if (s.usable > 0 && projected / s.usable >= 0.85) recommendations.push('Most doors will be in use tomorrow: some parcels may go to the guardhouse.');
    if (s.total - s.usable > 0) recommendations.push(`Repair or re-enable ${s.total - s.usable} compartment${s.total - s.usable === 1 ? '' : 's'} out of use.`);
    out.push({
      stationId: s.id,
      station: s.name,
      usable: s.usable,
      occupiedNow: s.occupied + s.reserved,
      expectedArrivals: arrivals,
      expectedCollections: collections,
      projectedOccupied: projected,
      shortage: projected > s.usable,
      pickupWithinDayPct: Math.round(p24 * 100),
      method: daysOfHistory === 0
        ? 'No history yet: nothing to forecast from.'
        : useWeekday
          ? `Average for this weekday over the last ${weeks} week${weeks === 1 ? '' : 's'}; ${Math.round(p24 * 100)}% of parcels are collected within a day.`
          : `Only ${daysOfHistory} day${daysOfHistory === 1 ? '' : 's'} of history: overall daily average used, so treat this as rough.`,
      recommendations,
    });
  }
  return { generatedAt: now, stations: out };
}

// --- Parcel monitoring ------------------------------------------------------------------------

export async function listLockerParcels(db: Db, actor: Actor, filter: { state?: ParcelState[]; stationId?: string; q?: string }) {
  return db.query(
    `SELECT p.id, p.tracking_no, p.size, p.state, p.registered_at, p.ready_at, p.deadline_at, p.collected_at, p.failure_reason,
            s.name AS station, c.label AS compartment, co.name AS company, o.name AS counter
       FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id JOIN courier_companies co ON co.id = p.company_id
       LEFT JOIN locker_compartments c ON c.id = p.compartment_id LEFT JOIN overflow_locations o ON o.id = p.overflow_location_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1) AND ($2::text[] IS NULL OR p.state = ANY($2)) AND ($3::uuid IS NULL OR p.station_id = $3)
        AND ($4::text IS NULL OR p.tracking_no ILIKE '%' || $4 || '%')
      ORDER BY p.state_changed_at DESC LIMIT 200`,
    [actor.townshipId, filter.state?.length ? filter.state : null, filter.stationId ?? null, filter.q?.trim() || null],
  );
}

/** One parcel's whole story: every state change, every custody transfer, every door command. */
export async function lockerParcelDetail(db: Db, actor: Actor, parcelId: string) {
  const p = await one<ParcelRow & { station: string; compartment: string | null; company: string }>(
    db,
    `SELECT p.*, s.name AS station, c.label AS compartment, co.name AS company FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id
       JOIN courier_companies co ON co.id = p.company_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id WHERE p.id = $1`,
    [parcelId],
  );
  if (!p) throw notFound('Parcel');
  assertTownshipAccess(actor, p.township_id);
  const [events, custody, commands] = await Promise.all([
    db.query(`SELECT e.from_state, e.to_state, e.actor_kind, e.reason, e.at, u.full_name AS actor FROM parcel_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.parcel_id = $1 ORDER BY e.id`, [parcelId]),
    db.query(`SELECT t.from_kind, t.from_ref, t.to_kind, t.to_ref, t.note, t.at, u.full_name AS actor FROM custody_transfers t LEFT JOIN users u ON u.id = t.actor_id WHERE t.parcel_id = $1 ORDER BY t.id`, [parcelId]),
    db.query(`SELECT k.purpose, k.status, k.error, k.created_at, k.acked_at, c.label AS compartment FROM locker_commands k JOIN locker_compartments c ON c.id = k.compartment_id WHERE k.parcel_id = $1 ORDER BY k.created_at`, [parcelId]),
  ]);
  return { parcel: p, events, custody, commands, notes: await parcelNotes(db, actor, parcelId) };
}

export async function stationCommands(db: Db, actor: Actor, stationId: string) {
  await loadStation(db, actor, stationId);
  const [commands, events] = await Promise.all([
    db.query(`SELECT k.id, k.purpose, k.status, k.error, k.created_at, k.acked_at, c.label AS compartment, u.full_name AS requested_by
                FROM locker_commands k JOIN locker_compartments c ON c.id = k.compartment_id LEFT JOIN users u ON u.id = k.requested_by
               WHERE k.station_id = $1 ORDER BY k.created_at DESC LIMIT 50`, [stationId]),
    db.query(`SELECT type, source, payload, received_at FROM locker_device_events WHERE station_id = $1 ORDER BY id DESC LIMIT 50`, [stationId]),
  ]);
  return { commands, events };
}

// --- The simulator ----------------------------------------------------------------------------

async function simulatedStation(q: Queryable, actor: Actor | null, stationId: string): Promise<StationRow> {
  const s = await one<StationRow>(q, 'SELECT * FROM locker_stations WHERE id = $1', [stationId]);
  if (!s) throw notFound('Station');
  if (actor && actor.role !== 'HQ_ADMIN' && actor.townshipId !== s.township_id) throw notFound('Station');
  if (s.adapter !== 'SIMULATED') throw ruleViolation('NOT_SIMULATED', 'This is a real station: the simulator only drives simulated ones.');
  return s;
}

export async function simulatorView(db: Db, actor: Actor, stationId: string) {
  const station = await simulatedStation(db, actor, stationId);
  const compartments = await db.query(
    `SELECT c.id, c.label, c.size, c.state, c.door, c.item_present, c.fault, c.sim_fail_next, p.tracking_no, p.state AS parcel_state,
            (SELECT k.purpose FROM locker_commands k WHERE k.compartment_id = c.id AND k.status = 'ACKED' ORDER BY k.acked_at DESC LIMIT 1) AS last_unlock
       FROM locker_compartments c LEFT JOIN locker_parcels p ON p.id = c.parcel_id WHERE c.station_id = $1 ORDER BY c.label`,
    [station.id],
  );
  // Commands the simulated controller has carried out: the simulator can try to replay one, as an attacker would.
  const executed = await db.query(
    `SELECT k.id, k.purpose, k.executed_at, c.label AS compartment FROM locker_commands k JOIN locker_compartments c ON c.id = k.compartment_id
      WHERE k.station_id = $1 AND k.executed_at IS NOT NULL ORDER BY k.executed_at DESC LIMIT 5`,
    [station.id],
  );
  return { station: { id: station.id, name: station.name, code: station.code, status: station.status, location: station.location }, compartments, executed };
}

export type SimulatorEvent =
  | { type: 'DOOR'; compartmentId: string; door: 'OPEN' | 'CLOSED'; itemPresent: boolean }
  | { type: 'FAIL_NEXT'; compartmentId: string; on: boolean }
  | { type: 'FAULT'; compartmentId: string; on: boolean }
  | { type: 'STATION'; status: 'ONLINE' | 'OFFLINE' }
  | { type: 'KEYPAD'; credential: string }
  | { type: 'REPLAY'; commandId: string };

/** The simulator plays the station: doors, sensors, faults, going offline and the keypad, through the real handlers. */
export async function simulatorEvent(db: Db, actor: Actor, stationId: string, e: SimulatorEvent, now: Date) {
  const station = await simulatedStation(db, actor, stationId);
  const compartment = async (id: string) => {
    const c = await one<CompartmentRow>(db, 'SELECT * FROM locker_compartments WHERE id = $1 AND station_id = $2', [id, station.id]);
    if (!c) throw notFound('Compartment');
    return c;
  };
  switch (e.type) {
    case 'DOOR':
      await compartment(e.compartmentId);
      return handleDoor(db, { stationId: station.id, compartmentId: e.compartmentId, door: e.door, itemPresent: e.itemPresent, source: 'SIMULATOR', eventId: `sim-${randomUUID()}`, actor: userActor(actor.id) }, now);
    case 'FAIL_NEXT':
      await compartment(e.compartmentId);
      await db.query('UPDATE locker_compartments SET sim_fail_next = $2 WHERE id = $1', [e.compartmentId, e.on]);
      return { ok: true };
    case 'FAULT': {
      const c = await compartment(e.compartmentId);
      if (e.on && c.state !== 'AVAILABLE') throw conflict('COMPARTMENT_STATE', 'Only an empty, available compartment can be made faulty in the simulator.');
      await db.query(`UPDATE locker_compartments SET state = $2, fault = $3, updated_at = $4 WHERE id = $1`, [c.id, e.on ? 'FAULTY' : c.parcel_id ? 'OCCUPIED' : 'AVAILABLE', e.on ? 'Simulated fault' : null, now]);
      return { ok: true };
    }
    case 'STATION':
      await db.query('UPDATE locker_stations SET status = $2, last_seen_at = $3 WHERE id = $1', [station.id, e.status, now]);
      await audit(db, actor.id, 'SIMULATOR_STATION', 'locker_station', station.id, { status: e.status });
      return { ok: true };
    case 'KEYPAD':
      return pickupAtStation(db, station.id, e.credential, userActor(actor.id), `sim-keypad-${randomUUID()}`, now);
    case 'REPLAY':
      // An attacker resending a captured unlock command: the controller must refuse it.
      return replayCommand(db, station.id, e.commandId, now);
  }
}

/**
 * In the simulator, the person at the door closes it: the courier after
 * putting the parcel in, the resident after taking it out, staff after an
 * approved access. Only the person whose action opened that door may do this.
 */
export async function simulateClose(db: Db, actor: Actor, parcelId: string, itemPresent: boolean, now: Date) {
  const p = await one<ParcelRow>(db, 'SELECT * FROM locker_parcels WHERE id = $1', [parcelId]);
  if (!p || !p.compartment_id) throw notFound('Parcel');
  await simulatedStation(db, null, p.station_id);
  const allowed =
    (p.state === 'DEPOSIT_IN_PROGRESS' && p.courier_user_id === actor.id) ||
    (p.state === 'COLLECTION_IN_PROGRESS' && actor.homeId !== null && actor.homeId === p.home_id) ||
    (p.state === 'EXCEPTION' && Boolean(
      await one(db, `SELECT 1 FROM locker_exception_requests WHERE parcel_id = $1 AND status = 'APPROVED' AND (requested_by = $2 OR decided_by = $2)`, [p.id, actor.id]) ||
      await one(db, `SELECT 1 FROM locker_access_session_items item
        JOIN locker_access_sessions session ON session.id = item.session_id
        WHERE item.parcel_id = $1 AND item.status IN ('OPENED', 'COMPLETED')
          AND session.status IN ('ACTIVE', 'COMPLETED') AND session.requested_by = $2`, [p.id, actor.id]),
    ));
  if (!allowed) throw notFound('Parcel');
  return handleDoor(db, { stationId: p.station_id, compartmentId: p.compartment_id, door: 'CLOSED', itemPresent, source: 'SIMULATOR', eventId: `sim-${randomUUID()}`, actor: userActor(actor.id) }, now);
}
