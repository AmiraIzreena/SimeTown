import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ParcelState } from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import { conflict, notFound, unauthorized } from '../../errors';
import { log } from '../../logger';
import { notifyProviders } from '../carriers/providers';
import { getSettings } from '../settings';
import {
  custody, DEVICE, getPolicy, householdOf, issueCredential, staffOf, SYSTEM, tell, transition, spendCredential, type LockerActor, type ParcelRow,
} from './core';
import { raiseIncident } from './incidents';

/**
 * The hardware layer. Business logic never talks to a locker directly: it
 * writes an unlock command, the station's adapter delivers it, and the station
 * answers with an acknowledgement and door events. Real stations answer through
 * the signed device API; the simulator answers through exactly the same
 * functions, so a demo exercises the same rules as a real locker.
 *
 * Nothing here claims a vendor integration. HTTP_GATEWAY is SimeTown's own small
 * contract (documented in docs/DEPLOYMENT.md): a vendor's controller, an MQTT
 * bridge or a site gateway translates it to the hardware's protocol.
 */

export interface StationRow {
  id: string;
  township_id: string;
  name: string;
  code: string;
  location: string;
  adapter: 'SIMULATED' | 'HTTP_GATEWAY';
  gateway_url: string | null;
  device_secret: string;
  has_door_sensor: boolean;
  has_presence_sensor: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
}

export interface CompartmentRow {
  id: string;
  station_id: string;
  label: string;
  size: string;
  state: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'FAULTY' | 'DISABLED';
  door: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  item_present: boolean | null;
  fault: string | null;
  sim_fail_next: boolean;
  parcel_id: string | null;
}

export interface CommandRow {
  id: string;
  station_id: string;
  compartment_id: string;
  parcel_id: string | null;
  purpose: 'DEPOSIT' | 'COLLECT' | 'RELOCATE' | 'MAINTENANCE' | 'EXCEPTION';
  status: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'TIMED_OUT';
  idempotency_key: string;
  requested_by: string | null;
  created_at: Date;
  expires_at: Date;
  executed_at: Date | null;
  error: string | null;
}

/** How long a station has to acknowledge an unlock before it is treated as failed. */
export const COMMAND_TIMEOUT_MS = 30_000;
/** How long a courier has to open the reserved door before the compartment is freed again. */
export const RESERVATION_MS = 5 * 60_000;
const DEVICE_MESSAGE_MAX_AGE_MS = 5 * 60_000;

// --- Adapters -------------------------------------------------------------------------------

export interface LockerAdapter {
  /** Delivers an unlock command. Resolving means the station received it, not that the door opened. */
  send(db: Db, station: StationRow, compartment: CompartmentRow, command: CommandRow, now: Date): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * The authorisation an unlock command carries: a signature, with the station's
 * own secret, over exactly one command for one compartment and purpose until
 * one moment. The controller checks it, refuses it after it expires, and
 * carries out each command id once; the secret never reaches a browser.
 */
export const unlockAuthorisation = (secret: string, c: Pick<CommandRow, 'id' | 'station_id' | 'parcel_id' | 'purpose' | 'expires_at'>, compartmentLabel: string) =>
  sign(secret, ['UNLOCK', c.id, c.station_id, compartmentLabel, c.purpose, c.parcel_id ?? '', c.expires_at.toISOString()].join('|'));

/**
 * The simulated controller: what a real locker controller must do with an
 * unlock command. Kept inside the simulator, so the trust boundary stays
 * explicit: in production this runs on the station, not on SimeTown's server.
 */
export async function simulatedControllerAccepts(
  db: Db, station: StationRow, compartment: CompartmentRow, command: CommandRow, authorisation: string, now: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expected = unlockAuthorisation(station.device_secret, command, compartment.label);
  if (!/^[0-9a-f]{64}$/.test(authorisation) || !timingSafeEqual(Buffer.from(authorisation, 'hex'), Buffer.from(expected, 'hex'))) return { ok: false, error: 'The controller refused the command: its authorisation is not valid.' };
  if (now.getTime() > command.expires_at.getTime()) return { ok: false, error: 'The controller refused the command: its authorisation has expired.' };
  const first = await db.query(`UPDATE locker_commands SET executed_at = $2 WHERE id = $1 AND executed_at IS NULL RETURNING id`, [command.id, now]);
  if (first.length === 0) return { ok: false, error: 'The controller refused the command: it was already carried out once.' };
  return { ok: true };
}

/** The built-in simulator: answers at once, as a station would, through the same device handlers. */
const simulatedAdapter: LockerAdapter = {
  async send(db, station, compartment, command, now) {
    if (station.status !== 'ONLINE') return { ok: false, error: 'The station is offline.' };
    const verdict = await simulatedControllerAccepts(db, station, compartment, command, unlockAuthorisation(station.device_secret, command, compartment.label), now);
    if (!verdict.ok) {
      await rejectedByController(db, station, compartment, command, verdict.error, now);
      return { ok: true };
    }
    const jam = compartment.sim_fail_next || compartment.state === 'FAULTY';
    if (compartment.sim_fail_next) await db.query('UPDATE locker_compartments SET sim_fail_next = false WHERE id = $1', [compartment.id]);
    await handleAck(db, station.id, command.id, !jam, jam ? 'The door did not open (simulated jam).' : null, now, 'SIMULATOR', `sim-ack-${command.id}`);
    return { ok: true };
  },
};

/** A command the controller would not carry out: it fails, and staff see an incident. The door stays shut. */
async function rejectedByController(db: Db, station: StationRow, compartment: CompartmentRow, command: CommandRow, error: string, now: Date) {
  await raiseIncident(db, {
    townshipId: station.township_id, kind: 'COMMAND_REJECTED', severity: 'HIGH', stationId: station.id, parcelId: command.parcel_id,
    summary: `${station.name}, door ${compartment.label}: ${error}`, details: { commandId: command.id, purpose: command.purpose }, dedupeKey: `rejected:${command.id}:${now.getTime()}`,
  }, now);
  // The door stayed shut, so nothing is faulty: the command simply failed and whatever it was for goes back a step.
  await db.tx(async (tx) => {
    const c = await one<CommandRow>(tx, 'SELECT * FROM locker_commands WHERE id = $1 FOR UPDATE', [command.id]);
    if (c && (c.status === 'PENDING' || c.status === 'SENT')) {
      await tx.query(`UPDATE locker_commands SET status = 'FAILED', error = $2, acked_at = $3 WHERE id = $1`, [c.id, error, now]);
      await commandFailed(tx, c, error, false, now);
    }
  });
}

/** Simulator only: send an already used command to the controller again, as an attacker replaying it would. */
export async function replayCommand(db: Db, stationId: string, commandId: string, now: Date) {
  const command = await one<CommandRow>(db, 'SELECT * FROM locker_commands WHERE id = $1 AND station_id = $2', [commandId, stationId]);
  if (!command) throw notFound('Command');
  if (!command.executed_at) throw conflict('NOT_CARRIED_OUT', 'Only a command the controller has already carried out can be replayed.');
  const station = (await one<StationRow>(db, 'SELECT * FROM locker_stations WHERE id = $1', [stationId]))!;
  if (station.adapter !== 'SIMULATED') throw notFound('Station');
  const compartment = (await one<CompartmentRow>(db, 'SELECT * FROM locker_compartments WHERE id = $1', [command.compartment_id]))!;
  const verdict = await simulatedControllerAccepts(db, station, compartment, command, unlockAuthorisation(station.device_secret, command, compartment.label), now);
  if (!verdict.ok) await rejectedByController(db, station, compartment, command, verdict.error, now);
  return verdict.ok ? { opened: true } : { opened: false, error: verdict.error };
}

/** SimeTown's HTTP gateway contract: a signed POST to the station's gateway, answered later through the device API. */
const httpGatewayAdapter: LockerAdapter = {
  async send(_db, station, compartment, command) {
    if (!station.gateway_url) return { ok: false, error: 'No gateway address is set for this station.' };
    const body = JSON.stringify({
      commandId: command.id, stationId: station.id, compartment: compartment.label, action: 'UNLOCK', purpose: command.purpose, parcelId: command.parcel_id,
      expiresAt: command.expires_at.toISOString(), authorisation: unlockAuthorisation(station.device_secret, command, compartment.label),
    });
    const ts = new Date().toISOString();
    try {
      const response = await fetch(`${station.gateway_url.replace(/\/$/, '')}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-simetown-timestamp': ts, 'x-simetown-signature': sign(station.device_secret, `${ts}.${body}`) },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok ? { ok: true } : { ok: false, error: `The gateway answered ${response.status}.` };
    } catch (error) {
      return { ok: false, error: `The gateway could not be reached: ${String(error)}` };
    }
  },
};

const ADAPTERS: Record<StationRow['adapter'], LockerAdapter> = { SIMULATED: simulatedAdapter, HTTP_GATEWAY: httpGatewayAdapter };

export const sign = (key: string, text: string) => createHmac('sha256', key).update(text).digest('hex');

// --- Commands -------------------------------------------------------------------------------

/**
 * Records an unlock command. Called inside the caller's transaction; the
 * command is delivered with dispatch() once that transaction has committed. The
 * same idempotency key always returns the same command, so a repeated tap or a
 * retried request never opens a door twice.
 */
export async function createUnlock(
  tx: Queryable,
  input: { stationId: string; compartmentId: string; parcelId: string | null; purpose: CommandRow['purpose']; requestedBy: string | null; idempotencyKey: string },
  now: Date,
): Promise<CommandRow> {
  const existing = await one<CommandRow>(tx, 'SELECT * FROM locker_commands WHERE idempotency_key = $1', [input.idempotencyKey]);
  if (existing) {
    if (existing.compartment_id !== input.compartmentId || existing.purpose !== input.purpose) throw conflict('IDEMPOTENCY_KEY', 'This request key was already used for something else.');
    return existing;
  }
  const open = await one(tx, `SELECT 1 FROM locker_commands WHERE compartment_id = $1 AND status IN ('PENDING', 'SENT')`, [input.compartmentId]);
  if (open) throw conflict('COMMAND_IN_FLIGHT', 'This door is already being opened. Please wait a moment.');
  return (await one<CommandRow>(
    tx,
    `INSERT INTO locker_commands (station_id, compartment_id, parcel_id, purpose, idempotency_key, requested_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [input.stationId, input.compartmentId, input.parcelId, input.purpose, input.idempotencyKey, input.requestedBy, now, new Date(now.getTime() + COMMAND_TIMEOUT_MS)],
  ))!;
}

/** Sends a recorded command to its station. A command that cannot be delivered fails straight away, and is reconciled. */
export async function dispatch(db: Db, commandId: string, now: Date): Promise<CommandRow> {
  const loaded = await db.tx(async (tx) => {
    const command = await one<CommandRow>(tx, 'SELECT * FROM locker_commands WHERE id = $1 FOR UPDATE', [commandId]);
    if (!command) throw notFound('Command');
    if (command.status !== 'PENDING') return null; // already sent, or already answered
    await tx.query(`UPDATE locker_commands SET status = 'SENT', sent_at = $2 WHERE id = $1`, [commandId, now]);
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [command.station_id]))!;
    const compartment = (await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1', [command.compartment_id]))!;
    return { command: { ...command, status: 'SENT' as const }, station, compartment };
  });
  if (loaded) {
    const sent = await ADAPTERS[loaded.station.adapter].send(db, loaded.station, loaded.compartment, loaded.command, now);
    if (!sent.ok) {
      log.warn('Locker command could not be delivered', { commandId, station: loaded.station.id, error: sent.error });
      await db.tx(async (tx) => {
        const c = await one<CommandRow>(tx, 'SELECT * FROM locker_commands WHERE id = $1 FOR UPDATE', [commandId]);
        if (c && (c.status === 'PENDING' || c.status === 'SENT')) {
          await tx.query(`UPDATE locker_commands SET status = 'FAILED', error = $2, acked_at = $3 WHERE id = $1`, [commandId, sent.error, now]);
          if (loaded.station.adapter === 'SIMULATED' || /offline|reached/i.test(sent.error)) {
            await tx.query(`UPDATE locker_stations SET status = 'OFFLINE' WHERE id = $1 AND status = 'ONLINE'`, [loaded.station.id]);
          }
          await commandFailed(tx, c, sent.error, false, now);
        }
      });
    }
  }
  return (await one<CommandRow>(db, 'SELECT * FROM locker_commands WHERE id = $1', [commandId]))!;
}

/** The station says whether the door opened. Repeated answers change nothing. */
export async function handleAck(db: Db, stationId: string, commandId: string, ok: boolean, error: string | null, now: Date, source: 'DEVICE' | 'SIMULATOR', eventId: string) {
  return db.tx(async (tx) => {
    if (!(await storeDeviceEvent(tx, stationId, eventId, 'ACK', { commandId, ok, error }, source, now))) return { duplicate: true };
    const c = await one<CommandRow>(tx, 'SELECT * FROM locker_commands WHERE id = $1 AND station_id = $2 FOR UPDATE', [commandId, stationId]);
    if (!c) throw notFound('Command');
    if (c.status !== 'PENDING' && c.status !== 'SENT') return { duplicate: true };
    await tx.query('UPDATE locker_stations SET last_seen_at = $2 WHERE id = $1', [stationId, now]);
    // An acknowledgement after the command expired is not accepted: the controller should have refused it.
    if (ok && now.getTime() > c.expires_at.getTime()) {
      const late = 'The station acknowledged the command after it had expired.';
      await tx.query(`UPDATE locker_commands SET status = 'TIMED_OUT', error = $2, acked_at = $3 WHERE id = $1`, [commandId, late, now]);
      await commandFailed(tx, c, late, false, now);
      const station = (await one<{ township_id: string; name: string }>(tx, 'SELECT township_id, name FROM locker_stations WHERE id = $1', [stationId]))!;
      await raiseIncident(tx, { townshipId: station.township_id, kind: 'COMMAND_REJECTED', severity: 'HIGH', stationId, parcelId: c.parcel_id, summary: `${station.name}: ${late} Check whether the door opened.`, dedupeKey: `late-ack:${c.id}` }, now);
      return { ok: false, late: true };
    }
    if (!ok) {
      await tx.query(`UPDATE locker_commands SET status = 'FAILED', error = $2, acked_at = $3 WHERE id = $1`, [commandId, error ?? 'The door did not open.', now]);
      await commandFailed(tx, c, error ?? 'The door did not open.', true, now);
      return { ok: false };
    }
    await tx.query(`UPDATE locker_commands SET status = 'ACKED', acked_at = $2 WHERE id = $1`, [commandId, now]);
    await tx.query(`UPDATE locker_compartments SET door = 'OPEN', updated_at = $2 WHERE id = $1`, [c.compartment_id, now]);
    if (c.purpose === 'DEPOSIT' && c.parcel_id) {
      await transition(tx, c.parcel_id, 'DEPOSIT_IN_PROGRESS', DEVICE, 'The station opened the door for the courier', now);
    }
    return { ok: true };
  });
}

/**
 * What an unanswered or refused command leaves behind, put right so the
 * records match the locker: a deposit frees its reservation and marks the door
 * for inspection; a collection or relocation goes back to waiting. Nothing is
 * ever confirmed as delivered or collected because of a failed command.
 */
async function commandFailed(tx: Queryable, c: CommandRow, reason: string, doorFault: boolean, now: Date) {
  const compartment = await one<CompartmentRow & { township_id: string; station_name: string }>(
    tx,
    `SELECT c.*, s.township_id, s.name AS station_name FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id WHERE c.id = $1 FOR UPDATE OF c`,
    [c.compartment_id],
  );
  if (!compartment) return;
  if (c.purpose === 'DEPOSIT' && c.parcel_id) {
    await tx.query(`UPDATE locker_reservations SET status = 'RELEASED', released_reason = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [c.parcel_id, reason]);
    await tx.query(
      `UPDATE locker_compartments SET state = $2, parcel_id = NULL, fault = $3, door = 'UNKNOWN', updated_at = $4 WHERE id = $1`,
      [compartment.id, doorFault ? 'FAULTY' : 'AVAILABLE', doorFault ? reason : null, now],
    );
    const p = await one<{ state: ParcelState }>(tx, 'SELECT state FROM locker_parcels WHERE id = $1', [c.parcel_id]);
    if (p && (p.state === 'LOCKER_RESERVED' || p.state === 'DEPOSIT_IN_PROGRESS')) {
      await transition(tx, c.parcel_id, 'VERIFIED', SYSTEM, `Deposit stopped: ${reason}`, now, { compartment_id: null });
    }
  } else if (c.purpose === 'COLLECT' && c.parcel_id) {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1', [c.parcel_id]);
    if (p?.state === 'COLLECTION_IN_PROGRESS') {
      await transition(tx, p.id, p.resume_state ?? 'READY_FOR_COLLECTION', SYSTEM, `Door did not open for collection: ${reason}`, now, { resume_state: null });
    }
    await tx.query('UPDATE locker_compartments SET fault = $2, updated_at = $3 WHERE id = $1', [compartment.id, reason, now]);
  } else if (c.purpose === 'RELOCATE' && c.parcel_id) {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1', [c.parcel_id]);
    if (p?.state === 'RELOCATION_IN_PROGRESS') {
      await transition(tx, p.id, 'RELOCATION_PENDING', SYSTEM, `Door did not open for relocation: ${reason}`, now);
      await tx.query(`UPDATE relocation_tasks SET status = 'OPEN', failure_reason = $2, started_at = NULL WHERE parcel_id = $1 AND status = 'IN_PROGRESS'`, [p.id, reason]);
    }
    await tx.query('UPDATE locker_compartments SET fault = $2, updated_at = $3 WHERE id = $1', [compartment.id, reason, now]);
  }
  await tell(tx, await staffOf(tx, compartment.township_id), {
    priority: 'URGENT',
    title: `Locker door problem at ${compartment.station_name}`,
    body: `Door ${compartment.label}: ${reason}`,
    link: '/console/lockers',
  }, `locker-fault:${c.id}`);
  await raiseIncident(tx, {
    townshipId: compartment.township_id, kind: 'UNLOCK_FAILED', severity: 'MEDIUM', stationId: compartment.station_id, parcelId: c.parcel_id,
    summary: `${compartment.station_name}, door ${compartment.label}: ${reason}`, details: { commandId: c.id, purpose: c.purpose }, dedupeKey: `unlock-failed:${c.id}`,
  }, now);
}

/** Stores a device message once. A replayed message (same event id) is ignored. */
async function storeDeviceEvent(tx: Queryable, stationId: string, eventId: string, type: string, payload: unknown, source: 'DEVICE' | 'SIMULATOR', now: Date): Promise<boolean> {
  const rows = await tx.query(
    `INSERT INTO locker_device_events (station_id, event_id, type, payload, source, received_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (station_id, event_id) DO NOTHING RETURNING id`,
    [stationId, eventId, type, JSON.stringify(payload), source, now],
  );
  return rows.length > 0;
}

// --- Door events ----------------------------------------------------------------------------

/**
 * A door opened or closed, with whether something is inside. Closing is what
 * completes a deposit or a collection: a door shut on an empty compartment is
 * never a delivery, and a door shut with the parcel still inside is never a
 * collection.
 */
export async function handleDoor(
  db: Db,
  input: { stationId: string; compartmentId: string; door: 'OPEN' | 'CLOSED'; itemPresent: boolean | null; source: 'DEVICE' | 'SIMULATOR'; eventId: string; actor?: LockerActor },
  now: Date,
) {
  const result = await handleDoorEvent(db, input, now);
  // Once committed, the courier company hears that its shipment is in a locker (retried later by the job if it is down).
  if (result.outcome === 'DEPOSITED') await notifyProviders(db, now);
  return result;
}

async function handleDoorEvent(
  db: Db,
  input: { stationId: string; compartmentId: string; door: 'OPEN' | 'CLOSED'; itemPresent: boolean | null; source: 'DEVICE' | 'SIMULATOR'; eventId: string; actor?: LockerActor },
  now: Date,
) {
  return db.tx(async (tx) => {
    if (!(await storeDeviceEvent(tx, input.stationId, input.eventId, 'DOOR', input, input.source, now))) return { outcome: 'DUPLICATE' as const };
    const comp = await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1 AND station_id = $2 FOR UPDATE', [input.compartmentId, input.stationId]);
    if (!comp) throw notFound('Compartment');
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [input.stationId]))!;
    await tx.query('UPDATE locker_stations SET last_seen_at = $2 WHERE id = $1', [station.id, now]);
    await tx.query('UPDATE locker_compartments SET door = $2, item_present = $3, updated_at = $4 WHERE id = $1', [comp.id, input.door, input.itemPresent, now]);
    const actor = input.actor ?? DEVICE;

    if (input.door === 'OPEN') {
      // A door that opens with no unlock just sent may have been forced.
      const expected = await one(tx, `SELECT 1 FROM locker_commands WHERE compartment_id = $1 AND status = 'ACKED' AND acked_at > $2::timestamptz - interval '10 minutes'`, [comp.id, now]);
      if (!expected) {
        await tell(tx, await staffOf(tx, station.township_id), { priority: 'URGENT', title: `Door ${comp.label} opened without an unlock`, body: `${station.name}: check the locker.`, link: '/console/lockers' }, `door-forced:${input.eventId}`);
        await raiseIncident(tx, {
          townshipId: station.township_id, kind: 'DOOR_FORCED', severity: 'HIGH', stationId: station.id, parcelId: comp.parcel_id,
          summary: `${station.name}: door ${comp.label} opened without an unlock${comp.parcel_id ? ' while a parcel was inside' : ''}. It may have been forced.`,
          dedupeKey: `door-forced:${input.eventId}`,
        }, now);
        return { outcome: 'UNEXPECTED_OPEN' as const };
      }
      return { outcome: 'OPENED' as const };
    }
    if (!comp.parcel_id) return { outcome: 'CLOSED' as const };
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1', [comp.parcel_id]))!;
    if (p.state === 'DEPOSIT_IN_PROGRESS') {
      if (input.itemPresent === false) {
        await transition(tx, p.id, 'LOCKER_RESERVED', actor, 'The door was closed with nothing inside', now);
        return { outcome: 'CLOSED_EMPTY' as const };
      }
      if (input.itemPresent === null && station.has_presence_sensor) return { outcome: 'CLOSED' as const };
      if (input.itemPresent === true) await completeDeposit(tx, p, comp, station, actor, now);
      return { outcome: input.itemPresent ? ('DEPOSITED' as const) : ('CLOSED' as const) };
    }
    if (p.state === 'EXCEPTION') {
      // Staff took the parcel out under an approved exception: the compartment is free once it is shut and empty.
      const opened = await one<{ id: string }>(tx, `SELECT id FROM locker_commands WHERE parcel_id = $1 AND purpose = 'EXCEPTION' AND status = 'ACKED' ORDER BY created_at DESC LIMIT 1`, [p.id]);
      if (opened && input.itemPresent === false) {
        await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, item_present = false, door = 'CLOSED', updated_at = $2 WHERE id = $1`, [comp.id, now]);
        await tx.query('UPDATE locker_parcels SET compartment_id = NULL WHERE id = $1', [p.id]);
        await tx.query(`UPDATE locker_exception_requests SET status = 'DONE' WHERE command_id = $1 AND status = 'APPROVED'`, [opened.id]);
        return { outcome: 'TAKEN_OUT' as const };
      }
      return { outcome: 'CLOSED' as const };
    }
    if (p.state === 'COLLECTION_IN_PROGRESS') {
      if (input.itemPresent === true) {
        await transition(tx, p.id, p.resume_state ?? 'READY_FOR_COLLECTION', actor, 'The door was closed with the parcel still inside', now, { resume_state: null });
        return { outcome: 'STILL_INSIDE' as const };
      }
      if (input.itemPresent === false) {
        await completeCollection(tx, p, comp, actor, now, 'Collected from the locker');
        return { outcome: 'COLLECTED' as const };
      }
    }
    return { outcome: 'CLOSED' as const };
  });
}

/** The parcel is in and the door is shut: the household is told and gets its pickup credential. */
export async function completeDeposit(tx: Queryable, p: ParcelRow, comp: CompartmentRow, station: StationRow, actor: LockerActor, now: Date) {
  const policy = await getPolicy(tx, station.township_id, station.id);
  await transition(tx, p.id, 'DEPOSITED', actor, `Deposited in door ${comp.label}`, now);
  const deadline = new Date(now.getTime() + policy.relocate_after_hours * 3_600_000);
  await transition(tx, p.id, 'READY_FOR_COLLECTION', SYSTEM, 'Ready to collect', now, { ready_at: now, deadline_at: deadline });
  await tx.query(`UPDATE locker_compartments SET state = 'OCCUPIED', item_present = true, door = 'CLOSED', fault = NULL, updated_at = $2 WHERE id = $1`, [comp.id, now]);
  await tx.query(`UPDATE locker_reservations SET status = 'CONSUMED' WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id]);
  // The shipment is now deposited, for good: the same label can never open a door again.
  await tx.query('UPDATE courier_shipments SET deposited_at = coalesce(deposited_at, $1), parcel_id = $2 WHERE id = (SELECT shipment_id FROM locker_parcels WHERE id = $2)', [now, p.id]);
  await custody(tx, p.id, { kind: 'COURIER', ref: p.courier_user_id }, { kind: 'LOCKER', ref: `${station.name} ${comp.label}` }, actor.id, now);
  await issueCredential(tx, p.id, 'LOCKER', station.id, now);
  const company = await one<{ name: string }>(tx, 'SELECT name FROM courier_companies WHERE id = $1', [p.company_id]);
  const tz = (await getSettings(tx)).timezone;
  const by = deadline.toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });
  await tell(tx, await householdOf(tx, p.home_id!), {
    title: `Parcel from ${company!.name} in ${station.name}`,
    body: `Door ${comp.label}. Collect by ${by}: open Parcels in SimeTown for your QR code and PIN.`,
    link: `/app/parcels?tab=lockers&parcel=${p.id}`,
  }, `locker-ready:${p.id}`);
}

/** The parcel is out and the door is shut: the compartment is free again and the credential is spent. */
export async function completeCollection(tx: Queryable, p: ParcelRow, comp: CompartmentRow, actor: LockerActor, now: Date, reason: string) {
  await transition(tx, p.id, 'COLLECTED', actor, reason, now, { collected_at: now, resume_state: null });
  await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, item_present = false, door = 'CLOSED', updated_at = $2 WHERE id = $1`, [comp.id, now]);
  await spendCredential(tx, p.id, now);
  await custody(tx, p.id, { kind: 'LOCKER', ref: comp.label }, { kind: 'RESIDENT', ref: p.home_id }, actor.id, now);
  await tx.query(`UPDATE relocation_tasks SET status = 'CANCELLED', failure_reason = 'Collected by the household' WHERE parcel_id = $1 AND status = 'OPEN'`, [p.id]);
  await tell(tx, await householdOf(tx, p.home_id!), { title: 'Parcel collected', body: `Collected from door ${comp.label}. Not you? Tell the township office.`, link: `/app/parcels?tab=lockers&parcel=${p.id}` }, `locker-collected:${p.id}`);
}

// --- Reconciliation -------------------------------------------------------------------------

/**
 * Puts right whatever a silent station or an abandoned delivery left behind:
 * commands nobody answered, and reservations a courier never used. Safe to run
 * at any time and any number of times.
 */
export async function reconcile(db: Db, now: Date): Promise<{ commandsTimedOut: number; reservationsReleased: number; doorsLeftOpen: number }> {
  const result = await db.tx(async (tx) => {
    const late = await tx.query<CommandRow>(
      `SELECT * FROM locker_commands WHERE status IN ('PENDING', 'SENT') AND expires_at < $1 FOR UPDATE`,
      [now],
    );
    for (const c of late) {
      await tx.query(`UPDATE locker_commands SET status = 'TIMED_OUT', error = 'The station did not answer in time.', acked_at = $2 WHERE id = $1`, [c.id, now]);
      await commandFailed(tx, c, 'The station did not answer in time.', false, now);
    }
    const stale = await tx.query<{ id: string; parcel_id: string; compartment_id: string }>(
      `SELECT r.id, r.parcel_id, r.compartment_id FROM locker_reservations r JOIN locker_parcels p ON p.id = r.parcel_id
        WHERE r.status = 'ACTIVE' AND r.expires_at < $1 AND p.state = 'LOCKER_RESERVED' FOR UPDATE OF r`,
      [now],
    );
    for (const r of stale) {
      await tx.query(`UPDATE locker_reservations SET status = 'RELEASED', released_reason = 'Not used in time' WHERE id = $1`, [r.id]);
      await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, updated_at = $2 WHERE id = $1 AND parcel_id = $3`, [r.compartment_id, now, r.parcel_id]);
      await transition(tx, r.parcel_id, 'VERIFIED', SYSTEM, 'The reserved door was not used in time', now, { compartment_id: null });
    }
    return { commandsTimedOut: late.length, reservationsReleased: stale.length };
  });
  // A door the station still reports open after a few minutes: someone should look. Never marks anything empty or collected.
  const open = await db.query<{ id: string; label: string; station_id: string; parcel_id: string | null; updated_at: Date; township_id: string; station: string }>(
    `SELECT c.id, c.label, c.station_id, c.parcel_id, c.updated_at, s.township_id, s.name AS station
       FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id
      WHERE c.door = 'OPEN' AND c.updated_at < $1::timestamptz - make_interval(mins => $2)`,
    [now, DOOR_LEFT_OPEN_MIN],
  );
  for (const c of open) {
    await raiseIncident(db, {
      townshipId: c.township_id, kind: 'DOOR_LEFT_OPEN', severity: 'HIGH', stationId: c.station_id, parcelId: c.parcel_id,
      summary: `${c.station}: door ${c.label} has been open for more than ${DOOR_LEFT_OPEN_MIN} minutes.`, dedupeKey: `left-open:${c.id}:${c.updated_at.toISOString()}`,
    }, now);
  }
  return { ...result, doorsLeftOpen: open.length };
}

/** How long a door may stay open before staff are told. */
const DOOR_LEFT_OPEN_MIN = 5;

// --- Signed device messages -----------------------------------------------------------------

export interface DeviceMessage {
  stationId: string;
  eventId: string;
  type: 'ACK' | 'DOOR' | 'HEARTBEAT' | 'PICKUP';
  commandId?: string;
  ok?: boolean;
  error?: string;
  compartment?: string;
  door?: 'OPEN' | 'CLOSED';
  itemPresent?: boolean | null;
  credential?: string;
  ts: string;
}

/** The text a station signs: every field in a fixed order, so nothing can be added or changed in transit. */
export const deviceMessageText = (m: DeviceMessage) =>
  [m.stationId, m.eventId, m.type, m.commandId ?? '', m.ok ?? '', m.error ?? '', m.compartment ?? '', m.door ?? '', m.itemPresent ?? '', m.credential ?? '', m.ts].join('|');

/** Checks a station's signature and that the message is fresh. Returns the station. */
export async function verifyDevice(q: Queryable, m: DeviceMessage, signature: string, now: Date): Promise<StationRow> {
  const station = await one<StationRow>(q, 'SELECT * FROM locker_stations WHERE id = $1', [m.stationId]);
  const expected = station ? sign(station.device_secret, deviceMessageText(m)) : sign(randomUUID(), 'x');
  const okSig = /^[0-9a-f]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  if (!station || !okSig || station.adapter !== 'HTTP_GATEWAY') throw unauthorized('The station message is not signed correctly.');
  const age = Math.abs(now.getTime() - Date.parse(m.ts));
  if (!Number.isFinite(age) || age > DEVICE_MESSAGE_MAX_AGE_MS) throw unauthorized('The station message is too old.');
  return station;
}

export async function heartbeat(db: Db, station: StationRow, eventId: string, now: Date) {
  return db.tx(async (tx) => {
    if (!(await storeDeviceEvent(tx, station.id, eventId, 'HEARTBEAT', {}, 'DEVICE', now))) return { duplicate: true };
    await tx.query(`UPDATE locker_stations SET last_seen_at = $2, status = CASE WHEN status = 'OFFLINE' THEN 'ONLINE' ELSE status END WHERE id = $1`, [station.id, now]);
    return { ok: true };
  });
}
