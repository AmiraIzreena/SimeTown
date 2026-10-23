import { counterHoursText, counterStatus, daysBetween, DELIVERY_PROBLEM_LABELS, formatHour, type DeliveryProblem } from '@/shared/lockers';
import { ADMINS, shortAddress, type HomeAddress } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { HOME_ADDRESS_COLUMNS, resolveTownship } from '../townships';
import {
  custody, DEFAULT_POLICY, getPolicy, guardhouseOf, householdOf, inQuietHours, issueCredential, recordEvent, resolveCredential, revokeCredentials, staffOf, SYSTEM, tell,
  transition, spendCredential, userActor, WEEK_MS, type ParcelRow, type Policy,
} from './core';
import { warnIfNearlyFull } from './delivery';
import { emailCounterReminder } from '../email/parcels';

/**
 * The guardhouse, and what happens to parcels that wait.
 *
 * Every home has its own locker door, so a parcel in it blocks nobody and is never moved: the household gets a
 * gentle reminder after two days, then one a week. A parcel that could not go into the door waits at the parcel
 * counter, which keeps opening hours. It is never sent back by itself: after the collection period it is overdue,
 * the household is reminded once a week, the guard is asked to call, and the days it waited stay in its record.
 * No fees are charged.
 */

const DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// --- The reminder job ------------------------------------------------------------------------

/**
 * Run every few minutes. Each reminder goes out once (never in quiet hours); a parcel at the counter becomes
 * overdue once, and the guard is asked to call once. Safe to run again at any time.
 */
export async function runExpiry(db: Db, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const counts = { doorReminders: 0, overdue: 0, counterReminders: 0, calls: 0 };
  const parcels = await db.query<ParcelRow & { station: string; compartment: string | null }>(
    `SELECT p.*, s.name AS station, c.label AS compartment
       FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id
      WHERE p.home_id IS NOT NULL AND p.ready_at IS NOT NULL
        AND ((p.state = 'READY_FOR_COLLECTION' AND p.compartment_id IS NOT NULL) OR p.state = 'RELOCATED_TO_STORAGE')`,
  );
  const policies = new Map<string, Policy>();
  for (const p of parcels) {
    const key = `${p.township_id}:${p.station_id}`;
    if (!policies.has(key)) policies.set(key, await getPolicy(db, p.township_id, p.station_id));
    const policy = policies.get(key)!;
    const quiet = inQuietHours(policy, now, tz);
    await db.tx(async (tx) => {
      const live = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [p.id]);
      if (!live || live.state !== p.state || !live.ready_at) return; // moved on since the list was read
      const days = daysBetween(live.ready_at, now);
      const link = `/app/parcels?tab=${live.state === 'READY_FOR_COLLECTION' ? 'lockers' : 'guardhouse'}&parcel=${p.id}`;

      if (live.state === 'READY_FOR_COLLECTION') {
        // In the home's own door: a gentle reminder after a while, then once a week. No deadline, nothing moves.
        const due = live.last_reminder_at ? live.last_reminder_at.getTime() + WEEK_MS : live.ready_at.getTime() + policy.door_reminder_hours * 3_600_000;
        if (now.getTime() < due || quiet) return;
        const people = await householdOf(tx, p.home_id!);
        await tx.query('UPDATE locker_parcels SET last_reminder_at = $2 WHERE id = $1', [p.id, now]);
        await recordEvent(tx, p.id, live.state, live.state, SYSTEM, `Reminder sent to ${people.length} household member(s): in the door for ${plural(days, 'day')}`, now);
        await tell(tx, people, {
          title: 'A parcel is waiting in your locker',
          body: `Door ${p.compartment}, ${p.station}. It has been there for ${plural(days, 'day')}. The locker is open 24 hours.`,
          link,
        }, `door-reminder:${p.id}:${now.toISOString().slice(0, 10)}`);
        counts.doorReminders++;
        return;
      }

      // At the guardhouse.
      const counter = await one<{ name: string; location: string; open_from_hour: number; open_to_hour: number }>(tx, 'SELECT name, location, open_from_hour, open_to_hour FROM overflow_locations WHERE id = $1', [live.overflow_location_id]);
      const where = counter ? counter.name : 'the guardhouse';
      const waited = plural(days, 'day');
      let overdueAt = live.overdue_at;
      if (!overdueAt && live.deadline_at && now.getTime() >= live.deadline_at.getTime()) {
        overdueAt = now;
        await tx.query('UPDATE locker_parcels SET overdue_at = $2 WHERE id = $1', [p.id, now]);
        await recordEvent(tx, p.id, live.state, live.state, SYSTEM, `Overdue: not collected within ${plural(policy.overflow_collect_days, 'day')} at ${where}`, now);
        counts.overdue++;
      }
      if (overdueAt && !quiet) {
        const due = live.last_reminder_at && live.last_reminder_at.getTime() >= overdueAt.getTime() ? live.last_reminder_at.getTime() + WEEK_MS : overdueAt.getTime();
        if (now.getTime() >= due) {
          const people = await householdOf(tx, p.home_id!);
          await tx.query('UPDATE locker_parcels SET last_reminder_at = $2 WHERE id = $1', [p.id, now]);
          await recordEvent(tx, p.id, live.state, live.state, SYSTEM, `Weekly reminder sent to ${people.length} household member(s): uncollected for ${plural(days, 'day')}`, now);
          await tell(tx, people, {
            title: 'Reminder: your parcel is waiting at the guardhouse',
            // Written out in full, so each form has its own Malay template.
            body: !counter
              ? `It has been at the guardhouse for ${waited}. Please collect it when you can.`
              : counter.open_from_hour <= 0 && counter.open_to_hour >= 24
                ? `It has been at ${counter.name} for ${waited}. It is open 24 hours. Please collect it when you can.`
                : `It has been at ${counter.name} for ${waited}. It is open ${formatHour(counter.open_from_hour)} to ${formatHour(counter.open_to_hour)}. Please collect it when you can.`,
            link,
          }, `counter-reminder:${p.id}:${now.toISOString().slice(0, 10)}`);
          await emailCounterReminder(tx, people, {
            id: p.id, trackingNo: p.tracking_no, counter: counter?.name ?? null, location: counter?.location ?? null,
            openFrom: counter?.open_from_hour ?? null, openTo: counter?.open_to_hour ?? null, readyAt: live.ready_at, days, now,
          });
          counts.counterReminders++;
        }
      }
      if (!live.call_requested_at && now.getTime() >= live.ready_at.getTime() + policy.counter_call_after_days * DAY) {
        await tx.query('UPDATE locker_parcels SET call_requested_at = $2 WHERE id = $1', [p.id, now]);
        await recordEvent(tx, p.id, live.state, live.state, SYSTEM, `The guard was asked to call the household: uncollected for ${plural(days, 'day')}`, now);
        const call = {
          title: 'Please call a household about a parcel',
          body: counter
            ? `${p.tracking_no} has been at ${counter.name} for ${waited}. Call the household, then add a note to the parcel.`
            : `${p.tracking_no} has been at the guardhouse for ${waited}. Call the household, then add a note to the parcel.`,
        };
        await tell(tx, await guardhouseOf(tx, p.township_id), { ...call, link: '/guardhouse' }, `counter-call:${p.id}`);
        await tell(tx, await staffOf(tx, p.township_id), { ...call, link: '/console/operations?tab=guardhouse' }, `counter-call:${p.id}`);
        counts.calls++;
      }
    });
  }
  return counts;
}

// --- Guardhouses ----------------------------------------------------------------------------------

export interface CounterRow {
  id: string;
  name: string;
  kind: 'COUNTER' | 'PARCEL_ROOM';
  location: string;
  hours: string;
  instructions: string;
  capacity: number;
  accepts_deliveries: boolean;
  active: boolean;
  open_from_hour: number;
  open_to_hour: number;
  held: number;
  incoming: number;
}

/** The township's guardhouses, how full each is, and whether each is open now. */
export async function listOverflow(db: Db, actor: Actor, now = new Date()) {
  const tz = (await getSettings(db)).timezone;
  const rows = await db.query<CounterRow>(
    `SELECT o.*,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')) AS held,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state = 'VERIFIED') AS incoming
       FROM overflow_locations o WHERE ($1::uuid IS NULL OR o.township_id = $1) ORDER BY o.active DESC, o.name`,
    [actor.townshipId],
  );
  return rows.map((o) => {
    const status = counterStatus(o.open_from_hour, o.open_to_hour, now, tz);
    return { ...o, hours: counterHoursText(o.open_from_hour, o.open_to_hour), open: status.open, status: status.text };
  });
}

export interface OverflowInput {
  name: string;
  kind: 'COUNTER' | 'PARCEL_ROOM';
  location: string;
  openFromHour: number;
  openToHour: number;
  instructions: string;
  capacity: number;
  acceptsDeliveries: boolean;
}

const checkHours = (from: number, to: number) => {
  if (!(from >= 0 && from < to && to <= 24)) throw ruleViolation('HOURS', 'The counter must open before it closes.', { fields: { openToHour: 'Choose a closing time after the opening time.' } });
};

export async function createOverflow(db: Db, actor: Actor, input: OverflowInput) {
  checkHours(input.openFromHour, input.openToHour);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM overflow_locations WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) throw conflict('OVERFLOW_EXISTS', 'A guardhouse with this name already exists.');
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO overflow_locations (township_id, name, kind, location, hours, instructions, capacity, accepts_deliveries, open_from_hour, open_to_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [townshipId, input.name.trim(), input.kind, input.location.trim(), counterHoursText(input.openFromHour, input.openToHour), input.instructions.trim(), input.capacity, input.acceptsDeliveries, input.openFromHour, input.openToHour],
    );
    await audit(tx, actor.id, 'OVERFLOW_ADDED', 'overflow_location', row!.id, { name: input.name });
    return { id: row!.id };
  });
}

/** Admins change a counter's opening hours, room or instructions. */
export async function updateOverflow(db: Db, actor: Actor, id: string, input: { openFromHour: number; openToHour: number; capacity: number; instructions: string }) {
  checkHours(input.openFromHour, input.openToHour);
  return db.tx(async (tx) => {
    const location = await one<{ township_id: string; capacity: number }>(tx, 'SELECT township_id, capacity FROM overflow_locations WHERE id = $1 FOR UPDATE', [id]);
    if (!location) throw notFound('Guardhouse');
    assertTownshipAccess(actor, location.township_id);
    const held = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM locker_parcels WHERE overflow_location_id = $1 AND state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')`, [id]);
    if (input.capacity < held!.n) throw ruleViolation('CAPACITY_TOO_LOW', `${held!.n} parcels are there now. Choose at least ${held!.n} places.`, { fields: { capacity: `At least ${held!.n}.` } });
    await tx.query(
      'UPDATE overflow_locations SET open_from_hour = $2, open_to_hour = $3, hours = $4, capacity = $5, instructions = $6 WHERE id = $1',
      [id, input.openFromHour, input.openToHour, counterHoursText(input.openFromHour, input.openToHour), input.capacity, input.instructions.trim()],
    );
    await audit(tx, actor.id, 'OVERFLOW_UPDATED', 'overflow_location', id, { ...input });
    return { ok: true };
  });
}

export async function setOverflowActive(db: Db, actor: Actor, id: string, active: boolean) {
  return db.tx(async (tx) => {
    const location = await one<{ township_id: string; name: string; active: boolean }>(tx, 'SELECT township_id, name, active FROM overflow_locations WHERE id = $1 FOR UPDATE', [id]);
    if (!location) throw notFound('Guardhouse');
    assertTownshipAccess(actor, location.township_id);
    if (!active) {
      const committed = await one<{ count: number }>(tx,
        `SELECT count(*)::int AS count FROM locker_parcels p WHERE p.overflow_location_id = $1 AND p.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')`, [id]);
      if (committed!.count > 0) throw conflict('STORAGE_IN_USE', `${location.name} still has parcels waiting or on their way. Hand them over before closing it.`);
    }
    if (location.active !== active) {
      await tx.query('UPDATE overflow_locations SET active = $2 WHERE id = $1', [id, active]);
      await audit(tx, actor.id, active ? 'OVERFLOW_REOPENED' : 'OVERFLOW_CLOSED', 'overflow_location', id, { name: location.name });
    }
    return { ok: true };
  });
}

/** Parcels a courier is bringing to a counter because they could not go into the home's door. */
export async function listCounterDeliveries(db: Db, actor: Actor) {
  const rows = await db.query<{ id: string; tracking_no: string; company: string; location_id: string; counter: string; registered_at: Date; delivery_problem: string | null; delivery_problem_note: string | null }>(
    `SELECT p.id, p.tracking_no, co.name AS company, o.id AS location_id, o.name AS counter, p.registered_at, p.delivery_problem, p.delivery_problem_note
       FROM locker_parcels p
       JOIN courier_companies co ON co.id = p.company_id
       JOIN overflow_locations o ON o.id = p.overflow_location_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1) AND p.state = 'VERIFIED'
      ORDER BY p.registered_at ASC`,
    [actor.townshipId],
  );
  return rows.map((r) => ({ ...r, reason: r.delivery_problem ? DELIVERY_PROBLEM_LABELS[r.delivery_problem as DeliveryProblem] ?? null : null }));
}

/**
 * Parcels at a counter, oldest first, with how long each has waited, whether it is overdue, whether the guard
 * has been asked to call (and then the household's phone number, for that call only) and the latest note.
 */
export async function listStoredParcels(db: Db, actor: Actor, now = new Date()) {
  const rows = await db.query<HomeAddress & {
    id: string; tracking_no: string; company: string; recipient: string | null; parcel_state: 'RELOCATED_TO_STORAGE' | 'RETURN_PENDING';
    ready_at: Date | null; relocated_at: Date | null; deadline_at: Date | null; overdue_at: Date | null; call_requested_at: Date | null;
    delivery_problem: string | null; location_id: string; location: string; location_active: boolean; phone: string | null;
    notes: number; last_note: string | null; last_note_at: Date | null;
  }>(
    `SELECT p.id, p.tracking_no, p.state AS parcel_state, p.ready_at, p.relocated_at, p.deadline_at, p.overdue_at, p.call_requested_at, p.delivery_problem,
            co.name AS company, u.full_name AS recipient, u.phone,
            o.id AS location_id, o.name AS location, o.active AS location_active,
            (SELECT count(*)::int FROM locker_parcel_notes n WHERE n.parcel_id = p.id) AS notes,
            (SELECT n.body FROM locker_parcel_notes n WHERE n.parcel_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS last_note,
            (SELECT n.created_at FROM locker_parcel_notes n WHERE n.parcel_id = p.id ORDER BY n.created_at DESC LIMIT 1) AS last_note_at,
            ${HOME_ADDRESS_COLUMNS}
       FROM locker_parcels p
       JOIN overflow_locations o ON o.id = p.overflow_location_id
       JOIN courier_companies co ON co.id = p.company_id
       JOIN homes h ON h.id = p.home_id
       LEFT JOIN users u ON u.id = p.recipient_user_id
      WHERE ($1::uuid IS NULL OR p.township_id = $1)
        AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')
      ORDER BY p.ready_at ASC NULLS LAST`,
    [actor.townshipId],
  );
  return rows.map((row) => {
    // A call is due once the guard was asked and nobody has noted anything since.
    const callDue = Boolean(row.call_requested_at && (!row.last_note_at || row.last_note_at < row.call_requested_at));
    return {
      id: row.id,
      tracking_no: row.tracking_no,
      company: row.company,
      recipient: row.recipient,
      state: row.parcel_state,
      ready_at: row.ready_at,
      relocated_at: row.relocated_at,
      deadline_at: row.deadline_at,
      days: row.ready_at ? daysBetween(row.ready_at, now) : 0,
      overdue: Boolean(row.overdue_at || (row.deadline_at && row.deadline_at.getTime() <= now.getTime())),
      call_due: callDue,
      // The household's number only when the guard has been asked to call, and only for that.
      phone: callDue ? row.phone : null,
      reason: row.delivery_problem ? DELIVERY_PROBLEM_LABELS[row.delivery_problem as DeliveryProblem] ?? null : null,
      notes: row.notes,
      last_note: row.last_note,
      location_id: row.location_id,
      location: row.location,
      location_active: row.location_active,
      house: shortAddress(row),
    };
  });
}

// --- Notes on a parcel ---------------------------------------------------------------------------

/** Staff and guards add a note to a parcel's record, for example after calling the household. */
export async function addParcelNote(db: Db, actor: Actor, parcelId: string, body: string, now: Date) {
  const text = body.trim();
  if (!text) throw ruleViolation('NOTE_EMPTY', 'Write the note first.', { fields: { body: 'Write the note first.' } });
  return db.tx(async (tx) => {
    const p = await one<{ township_id: string }>(tx, 'SELECT township_id FROM locker_parcels WHERE id = $1', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    const row = await one<{ id: string }>(tx, 'INSERT INTO locker_parcel_notes (parcel_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [parcelId, actor.id, text, now]);
    await audit(tx, actor.id, 'LOCKER_PARCEL_NOTE', 'locker_parcel', parcelId);
    return { id: row!.id };
  });
}

export async function parcelNotes(q: Queryable, actor: Actor, parcelId: string) {
  const p = await one<{ township_id: string }>(q, 'SELECT township_id FROM locker_parcels WHERE id = $1', [parcelId]);
  if (!p) throw notFound('Parcel');
  assertTownshipAccess(actor, p.township_id);
  return q.query<{ id: string; body: string; created_at: Date; author: string | null; author_role: string | null }>(
    `SELECT n.id, n.body, n.created_at, u.full_name AS author, u.role AS author_role
       FROM locker_parcel_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.parcel_id = $1 ORDER BY n.created_at DESC`,
    [parcelId],
  );
}

// --- Counter collection and returns ---------------------------------------------------------

/** Staff at a counter check the code a resident shows, and see who the parcel is for to check their ID. */
export async function checkCounterCode(db: Db, actor: Actor, locationId: string, credential: string, now: Date) {
  const loc = await one<{ township_id: string }>(db, 'SELECT township_id FROM overflow_locations WHERE id = $1', [locationId]);
  if (!loc) throw notFound('Guardhouse');
  assertTownshipAccess(actor, loc.township_id);
  const cred = await resolveCredential(db, locationId, credential, now);
  // Named apart: a home's address also has a "state" column (Selangor, Johor…).
  const p = await one<HomeAddress & { id: string; tracking_no: string; parcel_state: string; recipient: string | null; company: string; ready_at: Date | null; overdue_at: Date | null }>(
    db,
    `SELECT p.id, p.tracking_no, p.state AS parcel_state, p.ready_at, p.overdue_at, ${HOME_ADDRESS_COLUMNS}, u.full_name AS recipient, co.name AS company
       FROM locker_parcels p JOIN homes h ON h.id = p.home_id JOIN courier_companies co ON co.id = p.company_id LEFT JOIN users u ON u.id = p.recipient_user_id
      WHERE p.id = $1`,
    [cred.parcel_id],
  );
  if (!p || !['RELOCATED_TO_STORAGE', 'RETURN_PENDING'].includes(p.parcel_state)) throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
  return {
    parcelId: p.id, trackingNo: p.tracking_no, company: p.company, house: shortAddress(p), recipient: p.recipient,
    days: p.ready_at ? daysBetween(p.ready_at, now) : 0, overdue: Boolean(p.overdue_at),
  };
}

/** Staff hand the parcel over after checking the code and the person's ID. The code then stops working, and the days it waited stay in its record. */
export async function handOverAtCounter(db: Db, actor: Actor, locationId: string, credential: string, idChecked: boolean, now: Date) {
  if (!idChecked) throw ruleViolation('ID_NOT_CHECKED', 'Check the person’s ID before handing the parcel over.');
  const checked = await checkCounterCode(db, actor, locationId, credential, now);
  return db.tx(async (tx) => {
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [checked.parcelId]))!;
    const loc = (await one<{ name: string }>(tx, 'SELECT name FROM overflow_locations WHERE id = $1', [locationId]))!;
    const days = p.ready_at ? daysBetween(p.ready_at, now) : 0;
    const waited = `collected after ${plural(days, 'day')}${p.overdue_at ? ', overdue' : ''}`;
    await transition(tx, p.id, 'COLLECTED', userActor(actor.id), `Handed over at ${loc.name}; ID checked; ${waited}`, now, { collected_at: now });
    await spendCredential(tx, p.id, now);
    await custody(tx, p.id, { kind: 'OVERFLOW', ref: loc.name }, { kind: 'RESIDENT', ref: p.home_id }, actor.id, now, 'Pickup code and ID checked');
    await tell(tx, await householdOf(tx, p.home_id!), { title: 'Parcel collected', body: `Handed over at ${loc.name}. Not you? Tell the township office.`, link: `/app/parcels?tab=guardhouse&parcel=${p.id}` }, `counter-collected:${p.id}`);
    return { ok: true, days };
  });
}

/** Staff send a parcel back, only when the household or the courier asks: marked now, returned once the courier has taken it. */
export async function startReturn(db: Db, actor: Actor, parcelId: string, reason: string, now: Date) {
  const why = reason.trim();
  if (why.length < 3) throw ruleViolation('REASON_NEEDED', 'Say who asked for it to go back, and why.', { fields: { reason: 'Say who asked for it to go back, and why.' } });
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    if (p.state !== 'RELOCATED_TO_STORAGE' && p.state !== 'EXCEPTION') throw conflict('PARCEL_STATE', 'Only a parcel at the counter can be sent back.');
    await transition(tx, p.id, 'RETURN_PENDING', userActor(actor.id), `Marked to go back to the courier: ${why}`.slice(0, 300), now);
    if (p.home_id) await tell(tx, await householdOf(tx, p.home_id), { title: 'Your parcel is going back to the courier', body: `${p.tracking_no} is waiting for the courier to take it back. You can still collect it until then.`, link: `/app/parcels?tab=guardhouse&parcel=${p.id}` }, `return-started:${p.id}:${now.getTime()}`);
    return { ok: true };
  });
}

/** Staff change their mind before the courier came: the parcel stays at the counter. */
export async function keepAtCounter(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    if (p.state !== 'RETURN_PENDING' || !p.overflow_location_id) throw conflict('PARCEL_STATE', 'Only a parcel waiting to go back can stay at the counter.');
    await transition(tx, p.id, 'RELOCATED_TO_STORAGE', userActor(actor.id), 'Kept at the guardhouse: not going back to the courier', now);
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
    if (p.home_id) await tell(tx, await householdOf(tx, p.home_id), { title: 'Parcel returned to the courier', body: `${p.tracking_no} went back to the courier. Contact them to arrange delivery again.`, link: `/app/parcels?tab=guardhouse&parcel=${p.id}` }, `returned:${p.id}`);
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
      if (!dest) throw notFound('Guardhouse');
      const policy = await getPolicy(tx, p.township_id, null);
      await transition(tx, p.id, outcome, userActor(actor.id), `Resolved: ${note}`, now, { overflow_location_id: dest.id, relocated_at: now, ready_at: p.ready_at ?? now, deadline_at: new Date(now.getTime() + policy.overflow_collect_days * DAY), compartment_id: null });
      await issueCredential(tx, p.id, 'OVERFLOW', dest.id, now);
      await tell(tx, await householdOf(tx, p.home_id!), { title: `Your parcel is at ${dest.name}`, body: 'Your pickup code has changed: see Parcels.', link: `/app/parcels?tab=guardhouse&parcel=${p.id}` }, `resolved:${p.id}`);
      await warnIfNearlyFull(tx, dest.id, now);
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

/**
 * Admins set the reminder timings. No fees: the fee and extension settings stay off whatever is sent (a
 * late-collection charge is a planned feature only).
 */
export async function saveTownshipPolicy(db: Db, actor: Actor, input: Policy, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden();
  if (input.counter_call_after_days <= input.overflow_collect_days) {
    throw ruleViolation('POLICY_ORDER', 'Ask the guard to call only after the parcel is overdue.', { fields: { counter_call_after_days: 'Choose more days than the collection period.' } });
  }
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    await tx.query(
      `INSERT INTO collection_policies (township_id, first_reminder_hours, final_reminder_hours, relocate_after_hours, overflow_collect_days, quiet_from_hour, quiet_to_hour,
                                        extensions_enabled, extension_hours, max_extensions, fee_enabled, fee_sen, updated_at, exceptions_need_second_approval,
                                        door_reminder_hours, counter_call_after_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, false, NULL, $10, $11, $12, $13)
       ON CONFLICT (township_id) WHERE station_id IS NULL DO UPDATE SET
         overflow_collect_days = EXCLUDED.overflow_collect_days, quiet_from_hour = EXCLUDED.quiet_from_hour, quiet_to_hour = EXCLUDED.quiet_to_hour,
         extensions_enabled = false, fee_enabled = false, fee_sen = NULL, updated_at = EXCLUDED.updated_at,
         exceptions_need_second_approval = EXCLUDED.exceptions_need_second_approval,
         door_reminder_hours = EXCLUDED.door_reminder_hours, counter_call_after_days = EXCLUDED.counter_call_after_days`,
      [townshipId, input.first_reminder_hours, input.final_reminder_hours, input.relocate_after_hours, input.overflow_collect_days, input.quiet_from_hour, input.quiet_to_hour,
        input.extension_hours, input.max_extensions, now, input.exceptions_need_second_approval, input.door_reminder_hours, input.counter_call_after_days],
    );
    await audit(tx, actor.id, 'LOCKER_POLICY_SAVED', 'collection_policy', townshipId, { ...input, fee_enabled: false, extensions_enabled: false });
    return { ok: true };
  });
}
