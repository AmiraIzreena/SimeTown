import { IN_LOCKER, type ParcelState } from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { completeCollection, createUnlock, dispatch, type CompartmentRow, type StationRow } from './hardware';
import { reportProblem } from '../incidents/triage';
import { getPolicy, householdOf, issueCredential, staffOf, pinFor, qrFor, recordEvent, resolveCredential, tell, transition, userActor, type LockerActor, type ParcelRow } from './core';

/**
 * Collecting from a locker. The household sees its pickup QR code and PIN (worked
 * out on demand, never stored). At the station it either types the PIN or shows
 * the QR at the keypad, or opens the door from the app after scanning the
 * station's own QR code. Only the parcel's own compartment ever opens, and the
 * collection counts only once the door is shut with the compartment empty.
 */

const LIVE_STATES: ParcelState[] = [
  'READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'RELOCATION_IN_PROGRESS', 'RELOCATED_TO_STORAGE', 'COLLECTION_IN_PROGRESS', 'RETURN_PENDING', 'EXCEPTION',
];

/** States in which the household may swap its pickup code for a new one. Not while a door is open. */
const RENEWABLE: ParcelState[] = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING'];
const MAX_CODES_PER_DAY = 5;

export async function myLockerParcels(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<ParcelRow & {
    company: string; station: string; station_code: string; station_location: string; compartment: string | null; adapter: string; has_sensors: boolean;
    overflow_name: string | null; overflow_location: string | null; overflow_hours: string | null; overflow_instructions: string | null; credential_id: string | null;
    keypad_locked: boolean; help_asked: boolean; reported: boolean; referred: boolean;
  }>(
    `SELECT p.*, co.name AS company, s.name AS station, s.code AS station_code, s.location AS station_location, c.label AS compartment, s.adapter,
            (s.has_door_sensor AND s.has_presence_sensor) AS has_sensors,
            o.name AS overflow_name, o.location AS overflow_location, o.hours AS overflow_hours, o.instructions AS overflow_instructions,
            (SELECT k.id FROM pickup_credentials k WHERE k.parcel_id = p.id AND k.status = 'ACTIVE') AS credential_id,
            EXISTS (SELECT 1 FROM incidents i WHERE i.parcel_id = p.id AND i.home_id = p.home_id AND i.user_id IS NOT NULL AND i.status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'REOPENED')) AS reported,
            EXISTS (SELECT 1 FROM courier_referrals r WHERE r.locker_parcel_id = p.id) AS referred,
            l.id IS NOT NULL AS keypad_locked,
            EXISTS (SELECT 1 FROM pickup_lockout_help h WHERE h.lockout_id = l.id AND h.user_id = $4) AS help_asked
       FROM locker_parcels p JOIN courier_companies co ON co.id = p.company_id JOIN locker_stations s ON s.id = p.station_id
       LEFT JOIN locker_compartments c ON c.id = p.compartment_id LEFT JOIN overflow_locations o ON o.id = p.overflow_location_id
       LEFT JOIN pickup_lockouts l ON l.location_id = p.station_id AND l.cleared_at IS NULL
      WHERE p.home_id = $1 AND (p.state = ANY($2::text[]) OR (p.state IN ('COLLECTED', 'RETURNED') AND p.state_changed_at > $3::timestamptz - interval '30 days'))
      ORDER BY (p.state = ANY($2::text[])) DESC, p.state_changed_at DESC LIMIT 50`,
    [resident.homeId, LIVE_STATES, now, actor.id],
  );
  const policy = await getPolicy(db, resident.townshipId, null);
  return {
    policy: { extensionsEnabled: policy.extensions_enabled, extensionHours: policy.extension_hours, maxExtensions: policy.max_extensions, feeEnabled: policy.fee_enabled, feeSen: policy.fee_sen },
    parcels: rows.map((p) => {
      const atCounter = p.state === 'RELOCATED_TO_STORAGE' || p.state === 'RETURN_PENDING';
      return {
        id: p.id,
        company: p.company,
        trackingNo: p.tracking_no,
        size: p.size,
        state: p.state,
        station: { name: p.station, code: p.station_code, location: p.station_location },
        compartment: atCounter ? null : p.compartment,
        counter: atCounter && p.overflow_name ? { name: p.overflow_name, location: p.overflow_location, hours: p.overflow_hours, instructions: p.overflow_instructions } : null,
        readyAt: p.ready_at,
        deadlineAt: p.deadline_at,
        collectedAt: p.collected_at,
        // The credential shows only while it can still be used.
        pin: p.credential_id ? pinFor(p.credential_id) : null,
        qr: p.credential_id ? qrFor(p.credential_id) : null,
        simulated: p.adapter === 'SIMULATED',
        needsConfirmation: !p.has_sensors,
        canRenewCode: Boolean(p.credential_id) && RENEWABLE.includes(p.state),
        // The station keypad is locked after too many wrong codes; the app still opens the door.
        keypad: !atCounter && p.keypad_locked ? { locked: true, staffTold: p.help_asked } : null,
        // A finished parcel can be reported; the reasons it was reported for, while staff look into them.
        canReport: (p.state === 'COLLECTED' || p.state === 'RETURNED') && now.getTime() - new Date(p.state_changed_at).getTime() < 30 * 86_400_000,
        canReportLive: ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'COLLECTION_IN_PROGRESS'].includes(p.state),
        reported: p.reported,
        referred: p.referred,
        canExtend: policy.extensions_enabled && p.extensions < policy.max_extensions && (p.state === 'READY_FOR_COLLECTION' || p.state === 'OVERDUE'),
        extensions: p.extensions,
      };
    }),
  };
}

async function openForCollection(tx: Queryable, p: ParcelRow, station: StationRow, actor: LockerActor, idempotencyKey: string, now: Date) {
  if (station.status !== 'ONLINE') throw ruleViolation('STATION_OFFLINE', 'This station is not working right now. The township office has been told.');
  if (!IN_LOCKER.includes(p.state) || !p.compartment_id) {
    if (p.state === 'COLLECTION_IN_PROGRESS') throw conflict('ALREADY_OPENING', 'The door is already open for this parcel.');
    throw conflict('PARCEL_STATE', 'This parcel is not in a locker right now.');
  }
  await transition(tx, p.id, 'COLLECTION_IN_PROGRESS', actor, 'Collection started', now, { resume_state: p.state });
  return createUnlock(tx, { stationId: station.id, compartmentId: p.compartment_id, parcelId: p.id, purpose: 'COLLECT', requestedBy: actor.id, idempotencyKey }, now);
}

/**
 * The resident opens the door from the app, at the station: the station's
 * own code (from its QR poster) must be given, so the door cannot be opened from
 * home by someone holding the phone.
 */
export async function openFromApp(db: Db, actor: Actor, parcelId: string, stationCode: string, idempotencyKey: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const result = await db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 AND home_id = $2 FOR UPDATE', [parcelId, resident.homeId]);
    if (!p) throw notFound('Parcel');
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [p.station_id]))!;
    if (station.code !== stationCode.trim().toUpperCase()) throw ruleViolation('WRONG_STATION', `This parcel is at ${station.name}. Scan the QR code on that station.`);
    const credential = await one(tx, `SELECT 1 FROM pickup_credentials WHERE parcel_id = $1 AND status = 'ACTIVE' AND location_kind = 'LOCKER'`, [p.id]);
    if (!credential) throw conflict('PARCEL_STATE', 'This parcel is not in a locker right now.');
    const existing = await one<{ id: string; compartment_id: string }>(tx, 'SELECT id, compartment_id FROM locker_commands WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing) return { commandId: existing.id, compartment: (await one<{ label: string }>(tx, 'SELECT label FROM locker_compartments WHERE id = $1', [existing.compartment_id]))!.label };
    const command = await openForCollection(tx, p, station, userActor(actor.id), idempotencyKey, now);
    const comp = (await one<{ label: string }>(tx, 'SELECT label FROM locker_compartments WHERE id = $1', [p.compartment_id]))!;
    return { commandId: command.id, compartment: comp.label };
  });
  const command = await dispatch(db, result.commandId, now);
  return { compartment: result.compartment, command: { id: command.id, status: command.status, error: command.error } };
}

/**
 * The station's keypad or scanner: a PIN or pickup QR typed or shown at the
 * locker. Called by a real station through the signed device API, or by the
 * simulator. Wrong codes are counted and slowed down.
 */
export async function pickupAtStation(db: Db, stationId: string, credentialText: string, actor: LockerActor, idempotencyKey: string, now: Date) {
  if (!(await one(db, 'SELECT 1 FROM locker_stations WHERE id = $1', [stationId]))) throw notFound('Station');
  const cred = await resolveCredential(db, stationId, credentialText, now, { unattended: true });
  if (cred.location_kind !== 'LOCKER') throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
  const result = await db.tx(async (tx) => {
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [stationId]))!;
    if (!(await one(tx, `SELECT 1 FROM pickup_credentials WHERE id = $1 AND status = 'ACTIVE'`, [cred.id]))) throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [cred.parcel_id]))!;
    if (p.station_id !== station.id) throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
    const command = await openForCollection(tx, p, station, actor, idempotencyKey, now);
    const comp = (await one<{ label: string }>(tx, 'SELECT label FROM locker_compartments WHERE id = $1', [p.compartment_id]))!;
    return { commandId: command.id, compartment: comp.label, parcelId: p.id };
  });
  const command = await dispatch(db, result.commandId, now);
  return { compartment: result.compartment, parcelId: result.parcelId, command: { id: command.id, status: command.status, error: command.error } };
}

/** For stations without sensors: the resident confirms they have the parcel and the door is shut. */
export async function confirmCollected(db: Db, actor: Actor, parcelId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 AND home_id = $2 FOR UPDATE', [parcelId, resident.homeId]);
    if (!p) throw notFound('Parcel');
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [p.station_id]))!;
    if (station.has_door_sensor && station.has_presence_sensor) throw ruleViolation('SENSORS_DECIDE', 'This station confirms collections itself when the door is shut.');
    if (p.state !== 'COLLECTION_IN_PROGRESS' || !p.compartment_id) throw conflict('PARCEL_STATE', 'Open the door first.');
    const opened = await one(tx, `SELECT 1 FROM locker_commands WHERE parcel_id = $1 AND purpose = 'COLLECT' AND status = 'ACKED'`, [p.id]);
    if (!opened) throw conflict('NOT_OPENED', 'The door has not opened yet.');
    const comp = (await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1 FOR UPDATE', [p.compartment_id]))!;
    await completeCollection(tx, p, comp, userActor(actor.id), now, 'The resident confirmed they collected it');
    return { ok: true };
  });
}

/**
 * More time to collect, only when management has switched extensions on. A
 * fee, if one is set, must be agreed first; it is recorded, never charged here,
 * and never stops the parcel being collected.
 */
export async function extendDeadline(db: Db, actor: Actor, parcelId: string, agreeFee: boolean, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 AND home_id = $2 FOR UPDATE', [parcelId, resident.homeId]);
    if (!p) throw notFound('Parcel');
    const policy = await getPolicy(tx, p.township_id, p.station_id);
    if (!policy.extensions_enabled) throw ruleViolation('NO_EXTENSIONS', 'More time is not offered at this station.');
    if (p.extensions >= policy.max_extensions) throw ruleViolation('EXTENSION_USED', 'This parcel has already had its extra time.');
    if (p.state !== 'READY_FOR_COLLECTION' && p.state !== 'OVERDUE') throw conflict('PARCEL_STATE', 'Extra time is only for a parcel still in its locker.');
    if (policy.fee_enabled && !agreeFee) throw ruleViolation('FEE_NOT_AGREED', 'Please agree to the storage fee first.');
    const deadline = new Date((p.deadline_at ?? now).getTime() + policy.extension_hours * 3_600_000);
    await tx.query(
      'UPDATE locker_parcels SET extensions = extensions + 1, deadline_at = $2, fee_agreed_at = CASE WHEN $3::boolean THEN $4 ELSE fee_agreed_at END WHERE id = $1',
      [p.id, deadline, policy.fee_enabled, now],
    );
    await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Collection time extended by ${policy.extension_hours} hours${policy.fee_enabled ? ' (storage fee agreed; not charged by SimeTown)' : ''}`, now);
    return { deadlineAt: deadline };
  });
}

/**
 * A fresh PIN and QR code for a parcel, when the household thinks its code was
 * seen or shared. The old one stops working at once; the rest of the household
 * is told, so nobody is left holding a dead code.
 */
export async function renewPickupCode(db: Db, actor: Actor, parcelId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 AND home_id = $2 FOR UPDATE', [parcelId, resident.homeId]);
    if (!p) throw notFound('Parcel');
    if (p.state === 'COLLECTION_IN_PROGRESS') throw conflict('PARCEL_STATE', 'The door is open for this parcel. Wait until it is shut.');
    const current = await one<{ location_kind: 'LOCKER' | 'OVERFLOW'; location_id: string }>(
      tx, `SELECT location_kind, location_id FROM pickup_credentials WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id],
    );
    if (!current || !RENEWABLE.includes(p.state)) throw conflict('PARCEL_STATE', 'This parcel has no pickup code to replace right now.');
    const issued = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM pickup_credentials WHERE parcel_id = $1 AND issued_at > $2::timestamptz - interval '1 day'`, [p.id, now]);
    if (issued!.n >= MAX_CODES_PER_DAY) throw ruleViolation('TOO_MANY_CODES', 'This parcel has had several new codes today. Please ask the township office.');
    const id = await issueCredential(tx, p.id, current.location_kind, current.location_id, now);
    await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), 'New pickup code issued at the resident’s request; the old one no longer works', now);
    const others = (await householdOf(tx, p.home_id!)).filter((u) => u !== actor.id);
    await tell(tx, others, {
      title: 'New pickup code',
      body: 'Someone in your home asked for a new pickup code for a locker parcel. The old code no longer works. Open Parcels to see the new one.',
      link: `/app/parcels?tab=lockers&parcel=${id}`,
    }, `pickup-code:${id}`);
    return { ok: true };
  });
}

/**
 * A resident at a station whose keypad has locked itself asks staff to unlock
 * it. Staff are told once per resident per lockout; the resident can still
 * open their own door from the app meanwhile.
 */
export async function askToUnlockKeypad(db: Db, actor: Actor, parcelId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const p = await one<{ station_id: string; township_id: string; station: string; location: string }>(
      tx,
      `SELECT p.station_id, p.township_id, s.name AS station, s.location FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id WHERE p.id = $1 AND p.home_id = $2`,
      [parcelId, resident.homeId],
    );
    if (!p) throw notFound('Parcel');
    const lockout = await one<{ id: string }>(tx, 'SELECT id FROM pickup_lockouts WHERE location_id = $1 AND cleared_at IS NULL', [p.station_id]);
    if (!lockout) throw conflict('KEYPAD_NOT_LOCKED', 'The keypad at this station is working again.');
    const first = await one(tx, 'INSERT INTO pickup_lockout_help (lockout_id, user_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [lockout.id, actor.id, now]);
    if (first) {
      await tell(tx, await staffOf(tx, p.township_id), {
        title: 'A resident is waiting at a locked keypad',
        body: `${p.station} (${p.location}): a resident asked for the keypad to be unlocked. They can still open their door from the app. Unlock it under Smart lockers once the station is checked.`,
        link: '/console/lockers',
        priority: 'URGENT',
      }, `keypad-help:${lockout.id}:${actor.id}`);
    }
    return { told: true, alreadyAsked: !first };
  });
}

/** What a household could report about a parcel through the older endpoint; the same reasons the central report form offers. */
export const PARCEL_REPORT_REASONS = ['NOT_COLLECTED', 'DAMAGED', 'WRONG_CONTENTS', 'NOT_OURS', 'OTHER'] as const;
export type ParcelReportReason = (typeof PARCEL_REPORT_REASONS)[number];

/**
 * The older "report this parcel" endpoint, kept working: it goes through the
 * central report, so courier problems go to the courier company and township
 * problems become cases. The resident has already said what went wrong, so a
 * collection dispute is filed without asking again.
 */
export async function reportParcel(db: Db, actor: Actor, parcelId: string, input: { reason: ParcelReportReason; note?: string }, now: Date) {
  return reportProblem(db, actor, {
    context: 'LOCKER_DONE', reason: input.reason === 'OTHER' ? 'NOT_SURE' : input.reason, lockerParcelId: parcelId, note: input.note, confirm: true,
  }, now);
}
