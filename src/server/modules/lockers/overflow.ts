import { shortAddress, type HomeAddress } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { createIncident } from '../incidents/engine';
import { getSettings } from '../settings';
import { HOME_ADDRESS_COLUMNS, resolveTownship } from '../townships';
import { createUnlock, dispatch, type CompartmentRow, type StationRow } from './hardware';
import {
  custody, DEFAULT_POLICY, getPolicy, householdOf, inQuietHours, issueCredential, recordEvent, resolveCredential, revokeCredentials, staffOf, SYSTEM, tell,
  transition, spendCredential, userActor, type ParcelRow, type Policy,
} from './core';

/**
 * Deadlines, overflow storage and relocation. Expiry never opens a locker by
 * itself: it sends reminders, then marks the parcel overdue, then creates a
 * relocation task for authorised staff. A relocation is a recorded custody
 * transfer, and the compartment is released only once it is shut and empty.
 */

const fmt = (d: Date, tz: string) => d.toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });

// --- The expiry job --------------------------------------------------------------------------

/**
 * Run every few minutes. Sends each reminder once (never in quiet hours),
 * marks parcels overdue, opens relocation tasks at the deadline, and sends
 * parcels left too long at a counter back to the courier.
 */
export async function runExpiry(db: Db, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const counts = { firstReminders: 0, finalReminders: 0, overdue: 0, relocationTasks: 0, returns: 0 };
  const parcels = await db.query<ParcelRow & { station: string; compartment: string | null }>(
    `SELECT p.*, s.name AS station, c.label AS compartment FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id
       LEFT JOIN locker_compartments c ON c.id = p.compartment_id
      WHERE p.state IN ('READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATED_TO_STORAGE') AND p.deadline_at IS NOT NULL`,
  );
  const policies = new Map<string, Policy>();
  for (const p of parcels) {
    const key = `${p.township_id}:${p.station_id}`;
    if (!policies.has(key)) policies.set(key, await getPolicy(db, p.township_id, p.station_id));
    const policy = policies.get(key)!;
    const deadline = p.deadline_at!.getTime();
    const hoursLeft = (deadline - now.getTime()) / 3_600_000;
    const quiet = inQuietHours(policy, now, tz);
    await db.tx(async (tx) => {
      const live = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [p.id]);
      if (!live || live.state !== p.state) return; // moved on since the list was read
      const people = await householdOf(tx, p.home_id!);
      if (p.state === 'RELOCATED_TO_STORAGE') {
        if (hoursLeft <= 0) {
          await transition(tx, p.id, 'RETURN_PENDING', SYSTEM, 'Not collected from the counter in time', now);
          await tell(tx, await staffOf(tx, p.township_id), { title: 'Parcel to return to the courier', body: `${p.tracking_no} was not collected from the counter in time.`, link: '/console/lockers' }, `return-due:${p.id}`);
          await tell(tx, people, { title: 'Your parcel is going back to the courier', body: 'It was not collected from the parcel counter in time. You can still collect it until the courier takes it back.', link: '/app/parcels' }, `return-due:${p.id}`);
          counts.returns++;
        }
        return;
      }
      const firstAt = deadline - (policy.relocate_after_hours - policy.first_reminder_hours) * 3_600_000;
      const finalAt = deadline - (policy.relocate_after_hours - policy.final_reminder_hours) * 3_600_000;
      if (now.getTime() >= firstAt && p.state === 'READY_FOR_COLLECTION') {
        await transition(tx, p.id, 'OVERDUE', SYSTEM, `Not collected within ${policy.first_reminder_hours} hours`, now);
        counts.overdue++;
      }
      if (now.getTime() >= firstAt && !p.first_reminder_at && !quiet && now.getTime() < finalAt) {
        await tx.query('UPDATE locker_parcels SET first_reminder_at = $2 WHERE id = $1', [p.id, now]);
        await recordEvent(tx, p.id, 'OVERDUE', 'OVERDUE', SYSTEM, `First reminder sent to ${people.length} household member(s)`, now);
        await tell(tx, people, { title: 'Your parcel is still in the locker', body: `${p.station}, door ${p.compartment}. Please collect it by ${fmt(p.deadline_at!, tz)}.`, link: '/app/parcels' }, `locker-reminder-1:${p.id}`);
        counts.firstReminders++;
      }
      if (now.getTime() >= finalAt && !p.final_reminder_at && !quiet && hoursLeft > 0) {
        await tx.query('UPDATE locker_parcels SET final_reminder_at = $2, first_reminder_at = coalesce(first_reminder_at, $2) WHERE id = $1', [p.id, now]);
        await recordEvent(tx, p.id, 'OVERDUE', 'OVERDUE', SYSTEM, `Final reminder sent to ${people.length} household member(s)`, now);
        await tell(tx, people, { priority: 'URGENT', title: 'Last reminder: collect your parcel', body: `${p.station}, door ${p.compartment}. After ${fmt(p.deadline_at!, tz)} it moves to the parcel counter.`, link: '/app/parcels' }, `locker-reminder-2:${p.id}`);
        counts.finalReminders++;
      }
      if (hoursLeft <= 0) {
        const state = (await one<{ state: string }>(tx, 'SELECT state FROM locker_parcels WHERE id = $1', [p.id]))!.state;
        if (state === 'READY_FOR_COLLECTION') await transition(tx, p.id, 'OVERDUE', SYSTEM, 'Deadline passed', now);
        await transition(tx, p.id, 'RELOCATION_PENDING', SYSTEM, 'Collection deadline passed: due to move to overflow storage', now);
        await tx.query('INSERT INTO relocation_tasks (parcel_id, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, now]);
        await tell(tx, await staffOf(tx, p.township_id), { title: 'Parcel to move to the counter', body: `${p.station}, door ${p.compartment}: past its collection deadline.`, link: '/console/lockers' }, `relocation-task:${p.id}`);
        await tell(tx, people, { title: 'Your parcel will move to the parcel counter', body: `It can still be collected from ${p.station} until staff move it. We will tell you where it is.`, link: '/app/parcels' }, `relocation-due:${p.id}`);
        counts.relocationTasks++;
      }
    });
  }
  return counts;
}

// --- Overflow storage locations --------------------------------------------------------------

export async function listOverflow(db: Db, actor: Actor) {
  return db.query(
    `SELECT o.*,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')) AS held,
            ((SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state = 'VERIFIED') +
             (SELECT count(*)::int FROM relocation_tasks t WHERE t.destination_id = o.id AND t.status = 'IN_PROGRESS')) AS incoming
       FROM overflow_locations o WHERE ($1::uuid IS NULL OR o.township_id = $1) ORDER BY o.active DESC, o.name`,
    [actor.townshipId],
  );
}

export interface OverflowInput {
  name: string;
  kind: 'COUNTER' | 'PARCEL_ROOM';
  location: string;
  hours: string;
  instructions: string;
  capacity: number;
  acceptsDeliveries: boolean;
}

export async function createOverflow(db: Db, actor: Actor, input: OverflowInput) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM overflow_locations WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) throw conflict('OVERFLOW_EXISTS', 'A storage place with this name already exists.');
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO overflow_locations (township_id, name, kind, location, hours, instructions, capacity, accepts_deliveries) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [townshipId, input.name.trim(), input.kind, input.location.trim(), input.hours.trim(), input.instructions.trim(), input.capacity, input.acceptsDeliveries],
    );
    await audit(tx, actor.id, 'OVERFLOW_ADDED', 'overflow_location', row!.id, { name: input.name });
    return { id: row!.id };
  });
}

export async function setOverflowActive(db: Db, actor: Actor, id: string, active: boolean) {
  return db.tx(async (tx) => {
    const location = await one<{ township_id: string; name: string; active: boolean }>(tx, 'SELECT township_id, name, active FROM overflow_locations WHERE id = $1 FOR UPDATE', [id]);
    if (!location) throw notFound('Storage place');
    assertTownshipAccess(actor, location.township_id);
    if (!active) {
      const committed = await one<{ count: number }>(tx,
        `SELECT ((SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = $1 AND p.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')) +
                 (SELECT count(*)::int FROM relocation_tasks r WHERE r.destination_id = $1 AND r.status = 'IN_PROGRESS')) AS count`, [id]);
      if (committed!.count > 0) throw conflict('STORAGE_IN_USE', `${location.name} still has stored or incoming parcels. Clear them before closing the location.`);
    }
    if (location.active !== active) {
      await tx.query('UPDATE overflow_locations SET active = $2 WHERE id = $1', [id, active]);
      await audit(tx, actor.id, active ? 'OVERFLOW_REOPENED' : 'OVERFLOW_CLOSED', 'overflow_location', id, { name: location.name });
    }
    return { ok: true };
  });
}

// --- Relocation ------------------------------------------------------------------------------

export async function listRelocations(db: Db, actor: Actor) {
  return db.query(
    `WITH selected_tasks AS (
       SELECT t.id FROM relocation_tasks t JOIN locker_parcels p ON p.id = t.parcel_id
        WHERE ($1::uuid IS NULL OR p.township_id = $1) AND t.status IN ('OPEN', 'IN_PROGRESS')
       UNION ALL
       (SELECT t.id FROM relocation_tasks t JOIN locker_parcels p ON p.id = t.parcel_id
         WHERE ($1::uuid IS NULL OR p.township_id = $1) AND t.status NOT IN ('OPEN', 'IN_PROGRESS')
         ORDER BY t.completed_at DESC NULLS LAST, t.created_at DESC LIMIT 50)
     )
     SELECT t.id, t.status, t.created_at, t.started_at, t.completed_at, t.failure_reason, t.tracking_verified,
            p.id AS parcel_id, p.tracking_no, p.state, p.deadline_at, p.station_id, s.name AS station, s.adapter, (s.has_door_sensor AND s.has_presence_sensor) AS has_sensors,
            coalesce(c.label, (SELECT rc.label FROM locker_commands k JOIN locker_compartments rc ON rc.id = k.compartment_id
                               WHERE k.parcel_id = p.id AND k.purpose = 'RELOCATE' AND (t.started_at IS NULL OR k.created_at >= t.started_at)
                               ORDER BY k.created_at DESC LIMIT 1)) AS compartment,
            co.name AS company,
            o.name AS destination, u.full_name AS assigned, i.reference AS case_reference
       FROM selected_tasks selected JOIN relocation_tasks t ON t.id = selected.id
       JOIN locker_parcels p ON p.id = t.parcel_id JOIN locker_stations s ON s.id = p.station_id
       JOIN courier_companies co ON co.id = p.company_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id
       LEFT JOIN overflow_locations o ON o.id = t.destination_id LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN incidents i ON i.dedupe_key = 'relocation:' || t.id::text
      ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END,
               CASE WHEN t.status IN ('OPEN', 'IN_PROGRESS') THEN t.created_at END ASC,
               t.completed_at DESC NULLS LAST, t.created_at DESC`,
    [actor.townshipId],
  );
}

async function loadTask(tx: Queryable, actor: Actor, taskId: string) {
  const t = await one<{ id: string; parcel_id: string; status: string; destination_id: string | null; tracking_verified: boolean; township_id: string }>(
    tx,
    `SELECT t.id, t.parcel_id, t.status, t.destination_id, t.tracking_verified, p.township_id
       FROM relocation_tasks t JOIN locker_parcels p ON p.id = t.parcel_id WHERE t.id = $1 FOR UPDATE OF t`,
    [taskId],
  );
  if (!t) throw notFound('Relocation task');
  assertTownshipAccess(actor, t.township_id);
  return t;
}

/** Authorised staff start a relocation: the destination must have room, and only this parcel's door opens. */
export async function startRelocation(db: Db, actor: Actor, taskId: string, destinationId: string, idempotencyKey: string, now: Date) {
  const result = await db.tx(async (tx) => {
    const t = await loadTask(tx, actor, taskId);
    if (t.status !== 'OPEN') throw conflict('TASK_STATE', 'This task is not waiting to start.');
    const dest = await one<{ id: string; capacity: number; name: string }>(
      tx, 'SELECT id, capacity, name FROM overflow_locations WHERE id = $1 AND township_id = $2 AND active FOR UPDATE', [destinationId, t.township_id],
    );
    if (!dest) throw notFound('Storage place');
    const committed = await one<{ count: number }>(tx,
      `SELECT ((SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = $1 AND p.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')) +
               (SELECT count(*)::int FROM relocation_tasks r WHERE r.destination_id = $1 AND r.status = 'IN_PROGRESS')) AS count`, [dest.id]);
    if (committed!.count >= dest.capacity) throw conflict('OVERFLOW_FULL', `${dest.name} is full. Choose another storage place.`);
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [t.parcel_id]))!;
    if (!p.compartment_id) throw conflict('PARCEL_STATE', 'This parcel is not in a locker.');
    await transition(tx, p.id, 'RELOCATION_IN_PROGRESS', userActor(actor.id), `Relocation to ${dest.name} started`, now);
    await tx.query(`UPDATE relocation_tasks SET status = 'IN_PROGRESS', assigned_to = $2, started_at = $3, destination_id = $4, failure_reason = NULL, tracking_verified = false WHERE id = $1`, [t.id, actor.id, now, dest.id]);
    const command = await createUnlock(tx, { stationId: p.station_id, compartmentId: p.compartment_id, parcelId: p.id, purpose: 'RELOCATE', requestedBy: actor.id, idempotencyKey }, now);
    await audit(tx, actor.id, 'RELOCATION_STARTED', 'relocation_task', t.id, { destination: dest.id });
    return { commandId: command.id };
  });
  const command = await dispatch(db, result.commandId, now);
  return { command: { id: command.id, status: command.status, error: command.error } };
}

/** Staff scan the parcel they took out. It must be the right one before anything else happens. */
export async function verifyRelocatedParcel(db: Db, actor: Actor, taskId: string, trackingNo: string, now: Date) {
  return db.tx(async (tx) => {
    const t = await loadTask(tx, actor, taskId);
    if (t.status !== 'IN_PROGRESS') throw conflict('TASK_STATE', 'Start the relocation first.');
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1', [t.parcel_id]))!;
    if (p.tracking_no.toUpperCase() !== trackingNo.trim().toUpperCase()) {
      await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), 'A different parcel was scanned during relocation', now);
      throw ruleViolation('TRACKING_MISMATCH', 'This is not the parcel for this task. Put it back and check the door number.');
    }
    await tx.query('UPDATE relocation_tasks SET tracking_verified = true WHERE id = $1', [t.id]);
    return { ok: true };
  });
}

/**
 * The parcel is in its storage place. The compartment is released only when
 * the station reports it shut and empty (or, without sensors, staff confirm
 * it). The household's old code stops working and a new one is issued for the
 * counter, with where to go and when it is open.
 */
export async function completeRelocation(db: Db, actor: Actor, taskId: string, emptyConfirmed: boolean, now: Date) {
  return db.tx(async (tx) => {
    const t = await loadTask(tx, actor, taskId);
    if (t.status !== 'IN_PROGRESS') throw conflict('TASK_STATE', 'This relocation is not in progress.');
    if (!t.tracking_verified) throw ruleViolation('NOT_VERIFIED', 'Scan the parcel’s tracking code first.');
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [t.parcel_id]))!;
    const comp = (await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1 FOR UPDATE', [p.compartment_id]))!;
    const station = (await one<StationRow>(tx, 'SELECT * FROM locker_stations WHERE id = $1', [p.station_id]))!;
    const opened = await one(tx, `SELECT 1 FROM locker_commands WHERE parcel_id = $1 AND purpose = 'RELOCATE' AND status = 'ACKED' AND created_at >= (SELECT started_at FROM relocation_tasks WHERE id = $2)`, [p.id, t.id]);
    if (!opened) throw conflict('NOT_OPENED', 'The locker door has not opened for this task yet.');
    if (station.has_door_sensor && station.has_presence_sensor) {
      if (comp.door !== 'CLOSED' || comp.item_present !== false) throw ruleViolation('NOT_EMPTY_YET', 'Close the empty door first. The station has not reported it shut and empty yet.');
    } else if (!emptyConfirmed) {
      throw ruleViolation('CONFIRM_EMPTY', 'Confirm the compartment is empty and the door is shut.');
    }
    const dest = (await one<{ id: string; name: string; location: string; hours: string; instructions: string }>(tx, 'SELECT id, name, location, hours, instructions FROM overflow_locations WHERE id = $1', [t.destination_id]))!;
    const policy = await getPolicy(tx, p.township_id, null);
    const deadline = new Date(now.getTime() + policy.overflow_collect_days * 86_400_000);
    await transition(tx, p.id, 'RELOCATED_TO_STORAGE', userActor(actor.id), `Moved to ${dest.name}`, now, { overflow_location_id: dest.id, relocated_at: now, deadline_at: deadline, compartment_id: null });
    await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, item_present = false, fault = NULL, updated_at = $2 WHERE id = $1`, [comp.id, now]);
    await custody(tx, p.id, { kind: 'LOCKER', ref: `${station.name} ${comp.label}` }, { kind: 'STAFF', ref: actor.id }, actor.id, now, 'Taken out of the locker for relocation; tracking code checked');
    await custody(tx, p.id, { kind: 'STAFF', ref: actor.id }, { kind: 'OVERFLOW', ref: dest.name }, actor.id, now, 'Placed in overflow storage');
    await revokeCredentials(tx, p.id, now);
    await issueCredential(tx, p.id, 'OVERFLOW', dest.id, now);
    await tx.query(`UPDATE relocation_tasks SET status = 'DONE', completed_at = $2 WHERE id = $1`, [t.id, now]);
    await audit(tx, actor.id, 'RELOCATION_DONE', 'relocation_task', t.id, { destination: dest.id });
    const tz = (await getSettings(tx)).timezone;
    await tell(tx, await householdOf(tx, p.home_id!), {
      title: `Your parcel is now at ${dest.name}`,
      body: `${dest.location}. Open ${dest.hours}. ${dest.instructions} Collect by ${fmt(deadline, tz)}. Your pickup code has changed: see Parcels.`,
      link: '/app/parcels',
    }, `relocated:${p.id}`);
    return { ok: true };
  });
}

/**
 * Something went wrong mid-relocation: the parcel was missing, damaged, or
 * could not be moved. The parcel is held as an exception for management, the
 * compartment is kept out of use for inspection, and nothing is lost from the record.
 */
export async function failRelocation(db: Db, actor: Actor, taskId: string, reason: 'MISSING' | 'DAMAGED' | 'OTHER', note: string, now: Date) {
  return db.tx(async (tx) => {
    const t = await loadTask(tx, actor, taskId);
    if (t.status !== 'IN_PROGRESS' && t.status !== 'OPEN') throw conflict('TASK_STATE', 'This task is already closed.');
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [t.parcel_id]))!;
    const words = { MISSING: 'Parcel missing from the locker', DAMAGED: 'Parcel damaged', OTHER: 'Relocation problem' }[reason];
    await transition(tx, p.id, 'EXCEPTION', userActor(actor.id), `${words}: ${note}`, now, { exception_note: `${words}: ${note}` });
    await tx.query(`UPDATE relocation_tasks SET status = 'FAILED', failure_reason = $2, completed_at = $3 WHERE id = $1`, [t.id, `${words}: ${note}`, now]);
    if (p.compartment_id) await tx.query(`UPDATE locker_compartments SET state = 'FAULTY', fault = $2, updated_at = $3 WHERE id = $1`, [p.compartment_id, `Inspect: ${words.toLowerCase()}`, now]);
    await audit(tx, actor.id, 'RELOCATION_FAILED', 'relocation_task', t.id, { reason, note });
    const incident = await createIncident(tx, {
      townshipId: p.township_id,
      module: 'LOCKERS',
      category: 'RELOCATION_PROBLEM',
      responsibility: 'TOWNSHIP',
      priority: 'HIGH',
      summary: `${words} during relocation of ${p.tracking_no}`,
      description: note,
      details: { relocationTaskId: t.id, reason, reportedBy: actor.id },
      stationId: p.station_id,
      parcelId: p.id,
      companyId: p.company_id,
      homeId: p.home_id,
      dedupeKey: `relocation:${t.id}`,
    }, now);
    return { ok: true, incident };
  });
}

/** Parcels a courier has explicitly committed to deliver to a storage counter. */
export async function listCounterDeliveries(db: Db, actor: Actor) {
  return db.query(
    `SELECT p.id, p.tracking_no, co.name AS company, o.id AS location_id, o.name AS counter, p.registered_at
       FROM locker_parcels p
       JOIN courier_companies co ON co.id = p.company_id
       JOIN overflow_locations o ON o.id = p.overflow_location_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1) AND p.state = 'VERIFIED'
      ORDER BY p.registered_at ASC`,
    [actor.townshipId],
  );
}

/**
 * Parcels physically held at a storage location. This is the operational
 * source of truth for the collection screen; location totals alone are not
 * enough for staff to find and account for individual parcels.
 */
export async function listStoredParcels(db: Db, actor: Actor) {
  const rows = await db.query<HomeAddress & {
    id: string;
    tracking_no: string;
    company: string;
    recipient: string | null;
    parcel_state: 'RELOCATED_TO_STORAGE' | 'RETURN_PENDING';
    relocated_at: Date | null;
    deadline_at: Date | null;
    location_id: string;
    location: string;
    location_active: boolean;
  }>(
    `SELECT p.id, p.tracking_no, p.state AS parcel_state, p.relocated_at, p.deadline_at,
            co.name AS company, u.full_name AS recipient,
            o.id AS location_id, o.name AS location, o.active AS location_active,
            ${HOME_ADDRESS_COLUMNS}
       FROM locker_parcels p
       JOIN overflow_locations o ON o.id = p.overflow_location_id
       JOIN courier_companies co ON co.id = p.company_id
       JOIN homes h ON h.id = p.home_id
       LEFT JOIN users u ON u.id = p.recipient_user_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1)
        AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')
      ORDER BY CASE p.state WHEN 'RETURN_PENDING' THEN 0 ELSE 1 END,
               p.deadline_at ASC NULLS LAST, p.relocated_at ASC NULLS LAST`,
    [actor.townshipId],
  );
  return rows.map((row) => ({
    id: row.id,
    tracking_no: row.tracking_no,
    company: row.company,
    recipient: row.recipient,
    state: row.parcel_state,
    relocated_at: row.relocated_at,
    deadline_at: row.deadline_at,
    location_id: row.location_id,
    location: row.location,
    location_active: row.location_active,
    house: shortAddress(row),
  }));
}

// --- Counter collection and returns ---------------------------------------------------------

/** Staff at a counter check the code a resident shows, and see who the parcel is for to check their ID. */
export async function checkCounterCode(db: Db, actor: Actor, locationId: string, credential: string, now: Date) {
  const loc = await one<{ township_id: string }>(db, 'SELECT township_id FROM overflow_locations WHERE id = $1', [locationId]);
  if (!loc) throw notFound('Storage place');
  assertTownshipAccess(actor, loc.township_id);
  const cred = await resolveCredential(db, locationId, credential, now);
  // Named apart: a home's address also has a "state" column (Selangor, Johor…).
  const p = await one<HomeAddress & { id: string; tracking_no: string; parcel_state: string; recipient: string | null; company: string }>(
    db,
    `SELECT p.id, p.tracking_no, p.state AS parcel_state, ${HOME_ADDRESS_COLUMNS}, u.full_name AS recipient, co.name AS company
       FROM locker_parcels p JOIN homes h ON h.id = p.home_id JOIN courier_companies co ON co.id = p.company_id LEFT JOIN users u ON u.id = p.recipient_user_id
      WHERE p.id = $1`,
    [cred.parcel_id],
  );
  if (!p || !['RELOCATED_TO_STORAGE', 'RETURN_PENDING'].includes(p.parcel_state)) throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
  return { parcelId: p.id, trackingNo: p.tracking_no, company: p.company, house: shortAddress(p), recipient: p.recipient };
}

/** Staff hand the parcel over after checking the code and the person's ID. The code then stops working. */
export async function handOverAtCounter(db: Db, actor: Actor, locationId: string, credential: string, idChecked: boolean, now: Date) {
  if (!idChecked) throw ruleViolation('ID_NOT_CHECKED', 'Check the person’s ID before handing the parcel over.');
  const checked = await checkCounterCode(db, actor, locationId, credential, now);
  return db.tx(async (tx) => {
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [checked.parcelId]))!;
    const loc = (await one<{ name: string }>(tx, 'SELECT name FROM overflow_locations WHERE id = $1', [locationId]))!;
    await transition(tx, p.id, 'COLLECTED', userActor(actor.id), `Handed over at ${loc.name}; ID checked`, now, { collected_at: now });
    await spendCredential(tx, p.id, now);
    await custody(tx, p.id, { kind: 'OVERFLOW', ref: loc.name }, { kind: 'RESIDENT', ref: p.home_id }, actor.id, now, 'Pickup code and ID checked by staff');
    await tell(tx, await householdOf(tx, p.home_id!), { title: 'Parcel collected', body: `Handed over at ${loc.name}. Not you? Tell the township office.`, link: '/app/parcels' }, `counter-collected:${p.id}`);
    return { ok: true };
  });
}

/** Staff send a parcel back: marked now, and returned once the courier has taken it. */
export async function startReturn(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    if (p.state !== 'RELOCATED_TO_STORAGE' && p.state !== 'EXCEPTION') throw conflict('PARCEL_STATE', 'Only a parcel at the counter can be sent back.');
    await transition(tx, p.id, 'RETURN_PENDING', userActor(actor.id), 'Staff marked it to go back to the courier', now);
    return { ok: true };
  });
}

export async function completeReturn(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    await transition(tx, p.id, 'RETURNED', userActor(actor.id), 'Taken back by the courier', now);
    await revokeCredentials(tx, p.id, now);
    await custody(tx, p.id, { kind: 'OVERFLOW', ref: p.overflow_location_id }, { kind: 'COURIER', ref: p.company_id }, actor.id, now, 'Returned to the courier');
    if (p.home_id) await tell(tx, await householdOf(tx, p.home_id), { title: 'Parcel returned to the courier', body: `${p.tracking_no} went back to the courier. Contact them to arrange delivery again.`, link: '/app/parcels' }, `returned:${p.id}`);
    return { ok: true };
  });
}

/** Management settles a parcel held as an exception, with a note for the record. */
export async function resolveException(db: Db, actor: Actor, parcelId: string, outcome: 'RELOCATED_TO_STORAGE' | 'RETURN_PENDING' | 'COLLECTED', note: string, overflowId: string | undefined, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    if (p.state !== 'EXCEPTION') throw conflict('PARCEL_STATE', 'This parcel is not held as an exception.');
    if (outcome === 'RELOCATED_TO_STORAGE') {
      const dest = await one<{ id: string; name: string }>(tx, 'SELECT id, name FROM overflow_locations WHERE id = $1 AND township_id = $2', [overflowId, p.township_id]);
      if (!dest) throw notFound('Storage place');
      const policy = await getPolicy(tx, p.township_id, null);
      await transition(tx, p.id, outcome, userActor(actor.id), `Resolved: ${note}`, now, { overflow_location_id: dest.id, relocated_at: now, deadline_at: new Date(now.getTime() + policy.overflow_collect_days * 86_400_000), compartment_id: null });
      await issueCredential(tx, p.id, 'OVERFLOW', dest.id, now);
      await tell(tx, await householdOf(tx, p.home_id!), { title: `Your parcel is at ${dest.name}`, body: 'Your pickup code has changed: see Parcels.', link: '/app/parcels' }, `resolved:${p.id}`);
    } else {
      await transition(tx, p.id, outcome, userActor(actor.id), `Resolved: ${note}`, now, outcome === 'COLLECTED' ? { collected_at: now } : {});
      if (outcome === 'COLLECTED') await spendCredential(tx, p.id, now);
    }
    await audit(tx, actor.id, 'PARCEL_EXCEPTION_RESOLVED', 'locker_parcel', p.id, { outcome, note });
    return { ok: true };
  });
}

// --- Policy ---------------------------------------------------------------------------------

export async function getTownshipPolicy(db: Db, actor: Actor) {
  const townshipId = await resolveTownship(db, actor);
  return { ...(await getPolicy(db, townshipId, null)), defaults: DEFAULT_POLICY };
}

export async function saveTownshipPolicy(db: Db, actor: Actor, input: Policy, now: Date) {
  if (input.fee_enabled && !input.fee_sen) throw ruleViolation('FEE_AMOUNT', 'Set the fee amount, or switch the fee off.');
  if (!(input.first_reminder_hours < input.final_reminder_hours && input.final_reminder_hours < input.relocate_after_hours)) {
    throw ruleViolation('POLICY_ORDER', 'The first reminder must come before the last reminder, and both before the deadline.');
  }
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    await tx.query(
      `INSERT INTO collection_policies (township_id, first_reminder_hours, final_reminder_hours, relocate_after_hours, overflow_collect_days, quiet_from_hour, quiet_to_hour,
                                        extensions_enabled, extension_hours, max_extensions, fee_enabled, fee_sen, updated_at, exceptions_need_second_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (township_id) WHERE station_id IS NULL DO UPDATE SET
         first_reminder_hours = EXCLUDED.first_reminder_hours, final_reminder_hours = EXCLUDED.final_reminder_hours, relocate_after_hours = EXCLUDED.relocate_after_hours,
         overflow_collect_days = EXCLUDED.overflow_collect_days, quiet_from_hour = EXCLUDED.quiet_from_hour, quiet_to_hour = EXCLUDED.quiet_to_hour,
         extensions_enabled = EXCLUDED.extensions_enabled, extension_hours = EXCLUDED.extension_hours, max_extensions = EXCLUDED.max_extensions,
         fee_enabled = EXCLUDED.fee_enabled, fee_sen = EXCLUDED.fee_sen, updated_at = EXCLUDED.updated_at,
         exceptions_need_second_approval = EXCLUDED.exceptions_need_second_approval`,
      [townshipId, input.first_reminder_hours, input.final_reminder_hours, input.relocate_after_hours, input.overflow_collect_days, input.quiet_from_hour, input.quiet_to_hour,
        input.extensions_enabled, input.extension_hours, input.max_extensions, input.fee_enabled, input.fee_enabled ? input.fee_sen : null, now, input.exceptions_need_second_approval],
    );
    await audit(tx, actor.id, 'LOCKER_POLICY_SAVED', 'collection_policy', townshipId, { ...input });
    return { ok: true };
  });
}
