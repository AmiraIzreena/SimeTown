import {
  counterHoursText, counterOpenAt, counterStatus, DELIVERY_PROBLEM_FOR_RESIDENT, DELIVERY_PROBLEM_LABELS, DELIVERY_PROBLEMS, formatHour, LOCKER_SIZES, sizeFor,
  type CourierProblem, type DeliveryProblem, type LockerSize,
} from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { AppError, conflict, notFound, ruleViolation } from '../../errors';
import { nameWords } from '../carriers/matching';
import { notifyProviders } from '../carriers/providers';
import { courierContext, logScan, refusal, shipmentRow, verifyShipment } from '../carriers/verification';
import { getSettings } from '../settings';
import { completeDeposit, createUnlock, dispatch, RESERVATION_MS, type CompartmentRow, type StationRow } from './hardware';
import { custody, getPolicy, guardsOf, householdOf, issueCredential, recordEvent, staffOf, SYSTEM, tell, transition, userActor, type ParcelRow } from './core';
import { courierAccountOf, COURIER_STATIONS_SQL, requireCourierAt, type CourierAccount } from './couriers';
import { raiseIncident } from './incidents';
import { emailParcelAtCounter } from '../email/parcels';

/**
 * Delivering to a locker. The courier scans the label: the courier company's
 * system (simulated in the demo) confirms the shipment and SimeTown matches it
 * to a household, without showing the courier who lives there. Where the
 * company is not connected, the resident's own delivery code is the fallback.
 * Only then does the engine reserve the household's own door (every home has
 * one, in the locker bank serving its precinct), the door is unlocked through
 * the station's adapter, and the deposit is complete only when the station
 * reports the door shut with the parcel inside. A parcel that cannot go into
 * the home's door goes to the guardhouse instead.
 * Each shipment can be deposited once, ever.
 */

/** How many times a courier may have the reserved door opened for one parcel before staff must step in. */
const MAX_DEPOSIT_OPENS = 3;

async function loadStation(q: Queryable, stationId: string): Promise<StationRow> {
  const station = await one<StationRow>(q, 'SELECT * FROM locker_stations WHERE id = $1', [stationId]);
  if (!station) throw notFound('Station');
  return station;
}

export async function stationByCode(db: Db, code: string) {
  const station = await one<{ id: string; name: string; location: string; status: string; adapter: string }>(
    db, 'SELECT id, name, location, status, adapter FROM locker_stations WHERE code = $1', [code.trim().toUpperCase()],
  );
  if (!station) throw notFound('Station');
  return station;
}

/** A verified parcel for a known household, linked to its shipment. Inside the caller's transaction. */
async function createParcel(
  tx: Queryable,
  x: {
    actor: Actor; account: CourierAccount; station: StationRow; trackingNo: string; size: LockerSize; dims: [number, number, number] | null;
    homeId: string | null; recipientUserId: string | null; shipmentId: string; assurance: 'HIGH' | 'MEDIUM' | 'LOW'; how: string;
  },
  now: Date,
) {
  const parcel = await one<{ id: string }>(
    tx,
    `INSERT INTO locker_parcels (township_id, home_id, recipient_user_id, company_id, courier_user_id, tracking_no, size, width_mm, height_mm, depth_mm, station_id, state, state_changed_at, registered_at, shipment_id, assurance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'REGISTERED', $12, $12, $13, $14) RETURNING id`,
    [
      x.station.township_id, x.homeId, x.recipientUserId, x.account.company_id, x.actor.id, x.trackingNo, x.size,
      x.dims?.[0] ?? null, x.dims?.[1] ?? null, x.dims?.[2] ?? null, x.station.id, now, x.shipmentId, x.assurance,
    ],
  );
  await recordEvent(tx, parcel!.id, null, 'REGISTERED', userActor(x.actor.id), `Registered by ${x.account.company} at ${x.station.name}`, now);
  await tx.query('UPDATE courier_shipments SET parcel_id = $2 WHERE id = $1', [x.shipmentId, parcel!.id]);
  if (!x.homeId) return { id: parcel!.id, verified: false };
  await transition(tx, parcel!.id, 'VERIFIED', userActor(x.actor.id), `Recipient verified (${x.how}; ${x.assurance.toLowerCase()} assurance)`, now);
  return { id: parcel!.id, verified: true };
}

/** A unique-index refusal from the database: someone else got there first. */
const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === '23505';

/**
 * The barcode-first delivery: the shipment is checked again (so a stale check
 * can never be used), and only a VERIFIED shipment for a matched household
 * gets a parcel and a door. Two couriers with the same shipment cannot both
 * succeed: the shipment's row is locked, and the database refuses a second
 * live parcel.
 */
export async function deliverShipment(db: Db, actor: Actor, input: { stationId: string; code: string; size?: LockerSize; idempotencyKey: string }, now: Date) {
  const v = await verifyShipment(db, actor, input, now);
  if (v.resumeParcelId) return { kind: 'RESUME' as const, parcelId: v.resumeParcelId };
  if (v.state !== 'VERIFIED' || !v._home || !v.shipmentId) throw refusal(v);
  const size = v.size ?? input.size;
  if (!size) throw ruleViolation('SIZE_NEEDED', 'Choose the parcel size first.');
  const home = v._home;
  let parcelId: string;
  try {
    parcelId = await db.tx(async (tx) => {
      const account = await requireCourierAt(tx, actor, input.stationId, now);
      const station = await loadStation(tx, input.stationId);
      if (station.status !== 'ONLINE') throw ruleViolation('STATION_OFFLINE', 'This station is not working right now. Try another station or record the delivery as not made.');
      const row = await shipmentRow(tx, account.company_id, station.township_id, v.trackingNo, now, true);
      if (row.deposited_at) throw new AppError(409, 'ALREADY_DEPOSITED', 'This shipment has already been delivered to a locker. Nothing was opened, and the attempt was recorded.');
      const p = await createParcel(tx, {
        actor, account, station, trackingNo: v.trackingNo, size, dims: home.shipment.parcel.dimensionsMm, homeId: home.homeId, recipientUserId: home.recipientUserId,
        shipmentId: row.id, assurance: v.assurance ?? 'MEDIUM', how: v.match?.evidence.join(', ') || 'courier company',
      }, now);
      return p.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, 'NOT_ELIGIBLE', 'Another courier is already delivering this shipment. Nothing was opened.');
    throw error;
  }
  const opened = await reserveAndOpen(db, actor, parcelId, input.idempotencyKey, now);
  return { ...opened, parcelId };
}

export interface ParcelInput {
  stationId: string;
  trackingNo: string;
  size?: LockerSize;
  dimensionsMm?: [number, number, number];
  /** Either the resident's SimeTown member code, or the address and the name printed on the label. */
  recipient: { memberCode: string } | { homeId: string; name: string };
}

/**
 * The fallback: the courier identifies the household themselves, with the
 * resident's SimeTown delivery code, or the address and the name on the label.
 * Allowed when the courier company is not connected to SimeTown, or (if the
 * township allows it) when its system did not answer a moment ago; the parcel
 * is recorded with low assurance. The home must be in the station's township,
 * someone verified must live there, and the courier learns only "verified" or
 * "not verified", never who lives at an address.
 */
export async function registerParcel(db: Db, actor: Actor, input: ParcelInput, now: Date) {
  const tracking = input.trackingNo.trim().toUpperCase();
  const { station: where, company, approval } = await courierContext(db, actor, input.stationId, tracking, now);
  const scan = (outcome: string, reason: string | null, shipmentId: string | null) =>
    logScan(db, { townshipId: where.township_id, companyId: company.id, courierId: actor.id, stationId: where.id, shipmentId, trackingNo: tracking, outcome, reason }, now);
  if (company.provider_mode !== 'NONE') {
    // A connected company's shipments are checked with the company. Only when its system was just down may the courier fall back.
    const down = await one(db, `SELECT 1 FROM courier_scans WHERE courier_user_id = $1 AND tracking_no = $2 AND outcome = 'PROVIDER_UNAVAILABLE' AND at > $3::timestamptz - interval '15 minutes'`, [actor.id, tracking, now]);
    if (!down || !approval.allow_fallback) throw ruleViolation('SCAN_FIRST', 'Scan the label: your courier company checks this shipment with SimeTown.');
    if (!('memberCode' in input.recipient)) throw ruleViolation('DELIVERY_CODE_ONLY', 'While your company’s system is down, only the resident’s SimeTown delivery code can be used.');
  }
  try {
    const result = await db.tx(async (tx) => {
      const account = await requireCourierAt(tx, actor, input.stationId, now);
      const station = await loadStation(tx, input.stationId);
      if (station.status !== 'ONLINE') throw ruleViolation('STATION_OFFLINE', 'This station is not working right now. Try another station or record the delivery as not made.');
      const size = input.size ?? (input.dimensionsMm ? sizeFor(input.dimensionsMm) : null);
      if (!size) throw ruleViolation('TOO_BIG', 'This parcel is too big for any locker. Take it to the guardhouse instead.');
      const shipment = await shipmentRow(tx, account.company_id, station.township_id, tracking, now, true);
      if (shipment.deposited_at) throw new AppError(409, 'ALREADY_DEPOSITED', 'This shipment has already been delivered to a locker. Nothing was opened, and the attempt was recorded.');
      if (await one(tx, `SELECT 1 FROM locker_parcels WHERE company_id = $1 AND upper(tracking_no) = $2 AND state NOT IN ('COLLECTED', 'RETURNED', 'DELIVERY_FAILED')`, [account.company_id, tracking])) {
        throw conflict('DUPLICATE_PARCEL', 'This tracking number is already registered and on its way.');
      }

      let home: { id: string; recipient: string } | null = null;
      if ('memberCode' in input.recipient) {
        const r = await one<{ id: string; home_id: string }>(
          tx,
          `SELECT id, home_id FROM users WHERE member_code = $1 AND township_id = $2 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
          [input.recipient.memberCode.trim().toUpperCase(), station.township_id],
        );
        if (r) home = { id: r.home_id, recipient: r.id };
      } else {
        const label = nameWords(input.recipient.name);
        const people = await tx.query<{ id: string; full_name: string }>(
          `SELECT u.id, u.full_name FROM users u JOIN homes h ON h.id = u.home_id
            WHERE u.home_id = $1 AND h.township_id = $2 AND u.role = 'RESIDENT' AND u.residency_status = 'VERIFIED' AND u.status = 'ACTIVE'`,
          [input.recipient.homeId, station.township_id],
        );
        const match = people.find((p) => [...nameWords(p.full_name)].some((w) => label.has(w)));
        if (match) home = { id: input.recipient.homeId, recipient: match.id };
      }
      const method = 'memberCode' in input.recipient ? 'DELIVERY_CODE' : 'LABEL_ADDRESS_NAME';
      await tx.query(
        `UPDATE courier_shipments SET verification = $2, reason = $3, assurance = 'LOW', match_method = $4, match_evidence = $5, home_id = $6, recipient_user_id = $7, size = $8, last_checked_at = $9 WHERE id = $1`,
        [
          shipment.id, home ? (company.provider_mode === 'NONE' ? 'UNVERIFIED' : 'PROVIDER_UNAVAILABLE') : 'RECIPIENT_MISMATCH', home ? null : 'NOT_VERIFIED_BY_COURIER',
          method, JSON.stringify(home ? [method === 'DELIVERY_CODE' ? 'SimeTown delivery code' : 'address', ...(method === 'LABEL_ADDRESS_NAME' ? ['name'] : [])] : []),
          home?.id ?? null, home?.recipient ?? null, size, now,
        ],
      );
      const p = await createParcel(tx, {
        actor, account, station, trackingNo: tracking, size, dims: input.dimensionsMm ?? null, homeId: home?.id ?? null, recipientUserId: home?.recipient ?? null,
        shipmentId: shipment.id, assurance: 'LOW', how: method === 'DELIVERY_CODE' ? 'the resident’s delivery code' : 'the address and the name on the label',
      }, now);
      if (!p.verified) {
        await transition(tx, p.id, 'DELIVERY_FAILED', userActor(actor.id), 'Recipient not verified at this address', now, { failure_reason: 'RECIPIENT_NOT_VERIFIED' });
        return { id: p.id, state: 'DELIVERY_FAILED' as const, verified: false, size, shipmentId: shipment.id };
      }
      return { id: p.id, state: 'VERIFIED' as const, verified: true, size, shipmentId: shipment.id };
    });
    await scan(result.verified ? 'VERIFIED' : 'RECIPIENT_MISMATCH', result.verified ? 'FALLBACK' : 'NOT_VERIFIED_BY_COURIER', result.shipmentId);
    return { id: result.id, state: result.state, verified: result.verified, size: result.size };
  } catch (error) {
    if (error instanceof AppError && error.code === 'ALREADY_DEPOSITED') {
      const s = await one<{ id: string }>(db, 'SELECT id FROM courier_shipments WHERE company_id = $1 AND tracking_no = $2', [company.id, tracking]);
      await scan('ALREADY_DEPOSITED', 'FALLBACK', s?.id ?? null);
      await raiseIncident(db, {
        townshipId: where.township_id, kind: 'BARCODE_REPLAY', severity: 'HIGH', stationId: where.id, shipmentId: s?.id ?? null, companyId: company.id, userId: actor.id,
        summary: `${tracking} was entered again after it had been deposited. No door was opened.`, dedupeKey: `replay:${s?.id ?? tracking}`,
      }, now);
    } else if (error instanceof AppError) {
      await scan(error.code, 'FALLBACK', null);
    }
    if (isUniqueViolation(error)) throw conflict('DUPLICATE_PARCEL', 'This tracking number is already registered and on its way.');
    throw error;
  }
}

async function ownParcel(tx: Queryable, actor: Actor, parcelId: string, now: Date): Promise<ParcelRow> {
  const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
  if (!p || p.courier_user_id !== actor.id) throw notFound('Parcel');
  await requireCourierAt(tx, actor, p.station_id, now);
  return p;
}

/** A courier may have the reserved door opened only a few times for one parcel; after that, staff take over. */
async function assertMayOpenAgain(tx: Queryable, parcelId: string, idempotencyKey: string) {
  const opens = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM locker_commands WHERE parcel_id = $1 AND purpose = 'DEPOSIT' AND idempotency_key <> $2`, [parcelId, idempotencyKey]);
  if (opens!.n >= MAX_DEPOSIT_OPENS) throw ruleViolation('TOO_MANY_OPENS', 'The door has been opened several times for this parcel. Record the delivery as not made, or ask the township office.');
}

const SIZE_RANK = (s: string) => LOCKER_SIZES.indexOf(s as LockerSize);

/** A guardhouse a courier can take the parcel to, with whether it is open right now. */
export interface CounterOption {
  id: string;
  name: string;
  location: string;
  hours: string;
  open: boolean;
  status: string;
}

/** Counters that take couriers' parcels and still have room, open ones first. */
export async function countersFor(tx: Queryable, townshipId: string, now: Date): Promise<CounterOption[]> {
  const rows = await tx.query<{ id: string; name: string; location: string; hours: string; open_from_hour: number; open_to_hour: number }>(
    `SELECT o.id, o.name, o.location, o.hours, o.open_from_hour, o.open_to_hour FROM overflow_locations o
      WHERE o.township_id = $1 AND o.active AND o.accepts_deliveries
        AND (SELECT count(*) FROM locker_parcels q WHERE q.overflow_location_id = o.id AND q.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')) < o.capacity
      ORDER BY o.name`,
    [townshipId],
  );
  const tz = (await getSettings(tx)).timezone;
  return rows
    .map((o) => {
      const status = counterStatus(o.open_from_hour, o.open_to_hour, now, tz);
      return { id: o.id, name: o.name, location: o.location, hours: counterHoursText(o.open_from_hour, o.open_to_hour), open: status.open, status: status.text };
    })
    .sort((a, b) => Number(b.open) - Number(a.open));
}

type DoorFinding =
  | { kind: 'DOOR'; comp: CompartmentRow }
  | { kind: 'PROBLEM'; problem: DeliveryProblem; otherStation?: { id: string; name: string; location: string; allowed: boolean } };

/**
 * The home's own door at this locker bank. A home that has none yet claims the smallest free, unclaimed door that
 * fits, at the bank serving its precinct, and keeps it: nobody has to map homes to doors by hand. Two couriers can
 * never claim the same door (the row is locked), and a home can never hold two (a unique index).
 */
async function homeDoor(tx: Queryable, actor: Actor, p: ParcelRow, station: StationRow & { precincts: string[] }, now: Date): Promise<DoorFinding> {
  const own = await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE home_id = $1 FOR UPDATE', [p.home_id]);
  if (own && own.station_id !== station.id) {
    const where = (await one<{ id: string; name: string; location: string }>(tx, 'SELECT id, name, location FROM locker_stations WHERE id = $1', [own.station_id]))!;
    const allowed = Boolean(await one(tx, `SELECT 1 FROM locker_stations s WHERE s.id = $2 AND s.id IN (${COURIER_STATIONS_SQL})`, [actor.id, where.id]));
    return { kind: 'PROBLEM', problem: 'OTHER_STATION', otherStation: { ...where, allowed } };
  }
  if (own) {
    if (own.state === 'OCCUPIED' || own.state === 'RESERVED') return { kind: 'PROBLEM', problem: 'DOOR_FULL' };
    if (own.state !== 'AVAILABLE') return { kind: 'PROBLEM', problem: 'DOOR_DAMAGED' };
    if (SIZE_RANK(own.size) < SIZE_RANK(p.size)) return { kind: 'PROBLEM', problem: 'TOO_BIG' };
    return { kind: 'DOOR', comp: own };
  }
  // No door yet: only at the bank that serves the home's precinct (a bank with no precincts set serves every home).
  const home = await one<{ precinct: string | null }>(tx, 'SELECT precinct FROM homes WHERE id = $1', [p.home_id]);
  const serves = station.precincts.length === 0 || (home?.precinct != null && station.precincts.includes(home.precinct));
  if (!serves) {
    const right = await one<{ id: string; name: string; location: string }>(
      tx,
      `SELECT id, name, location FROM locker_stations
        WHERE township_id = $1 AND ($2 = ANY(precincts) OR cardinality(precincts) = 0)
        ORDER BY ($2 = ANY(precincts)) DESC, name LIMIT 1`,
      [p.township_id, home?.precinct ?? ''],
    );
    if (!right) return { kind: 'PROBLEM', problem: 'NO_DOOR' };
    const allowed = Boolean(await one(tx, `SELECT 1 FROM locker_stations s WHERE s.id = $2 AND s.id IN (${COURIER_STATIONS_SQL})`, [actor.id, right.id]));
    return { kind: 'PROBLEM', problem: 'OTHER_STATION', otherStation: { ...right, allowed } };
  }
  const free = await one<CompartmentRow>(
    tx,
    `SELECT * FROM locker_compartments
      WHERE station_id = $1 AND home_id IS NULL AND state = 'AVAILABLE' AND array_position(ARRAY['S','M','L','XL'], size) >= $2
      ORDER BY array_position(ARRAY['S','M','L','XL'], size), label
      LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [station.id, SIZE_RANK(p.size) + 1],
  );
  if (!free) {
    await tell(tx, await staffOf(tx, station.township_id), {
      title: `${station.name} has no free door for a new home`,
      body: 'A home without a locker door had a parcel. Release doors of homes that moved out, or add doors.',
      link: '/console/operations?tab=manage&view=stations',
    }, `no-free-door:${station.id}:${now.toISOString().slice(0, 13)}`);
    return { kind: 'PROBLEM', problem: 'NO_DOOR' };
  }
  await tx.query('UPDATE locker_compartments SET home_id = $2, updated_at = $3 WHERE id = $1', [free.id, p.home_id, now]);
  await recordEvent(tx, p.id, p.state, p.state, SYSTEM, `Door ${free.label} at ${station.name} now belongs to this home`, now);
  return { kind: 'DOOR', comp: { ...free, home_id: p.home_id } };
}

/**
 * Opens the home's own door for the courier: reserved in the database (two couriers can never get the same
 * door), then unlocked through the station. When the parcel cannot go into it (too big, the door already holds a
 * parcel, the door is out of use, or the home's door is at another bank), the courier is told why and where to
 * take it instead: the guardhouse while it is open. Nothing is rerouted on its own.
 */
export async function reserveAndOpen(db: Db, actor: Actor, parcelId: string, idempotencyKey: string, now: Date) {
  const result = await db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    const station = await loadStation(tx, p.station_id);
    if (p.state === 'LOCKER_RESERVED' && p.compartment_id) {
      // Retry on the same reserved door (for example after it was closed empty), a few times at most.
      await assertMayOpenAgain(tx, p.id, idempotencyKey);
      const command = await createUnlock(tx, { stationId: station.id, compartmentId: p.compartment_id, parcelId: p.id, purpose: 'DEPOSIT', requestedBy: actor.id, idempotencyKey }, now);
      await tx.query(`UPDATE locker_reservations SET expires_at = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id, new Date(now.getTime() + RESERVATION_MS)]);
      const comp = (await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1', [p.compartment_id]))!;
      return { kind: 'OPENING' as const, command, compartment: comp.label, size: comp.size };
    }
    // A deposited parcel is never reopened through the courier's flow: only staff, through an approved exception.
    if (p.state !== 'VERIFIED') throw conflict('PARCEL_STATE', 'This parcel is not waiting for a locker.');
    if (station.status !== 'ONLINE') throw ruleViolation('STATION_OFFLINE', 'This station is not working right now. Take the parcel to the guardhouse, or record the delivery as not made.');
    if (!p.home_id) throw conflict('PARCEL_STATE', 'This parcel has no verified household.');
    await assertMayOpenAgain(tx, p.id, idempotencyKey);
    const found = await homeDoor(tx, actor, p, station, now);
    if (found.kind === 'PROBLEM') {
      await tx.query('UPDATE locker_parcels SET delivery_problem = $2, delivery_problem_note = NULL WHERE id = $1', [p.id, found.problem]);
      await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Not into the home’s door: ${DELIVERY_PROBLEM_LABELS[found.problem].toLowerCase()}`, now);
      return { kind: 'NO_DOOR' as const, problem: found.problem, otherStation: found.otherStation ?? null, counters: await countersFor(tx, p.township_id, now) };
    }
    const comp = found.comp;
    await tx.query(`UPDATE locker_compartments SET state = 'RESERVED', parcel_id = $2, updated_at = $3 WHERE id = $1`, [comp.id, p.id, now]);
    await tx.query(`INSERT INTO locker_reservations (compartment_id, parcel_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`, [comp.id, p.id, new Date(now.getTime() + RESERVATION_MS), now]);
    await transition(tx, p.id, 'LOCKER_RESERVED', userActor(actor.id), `Door ${comp.label} reserved`, now, { compartment_id: comp.id });
    const command = await createUnlock(tx, { stationId: station.id, compartmentId: comp.id, parcelId: p.id, purpose: 'DEPOSIT', requestedBy: actor.id, idempotencyKey }, now);
    return { kind: 'OPENING' as const, command, compartment: comp.label, size: comp.size };
  });
  if (result.kind === 'NO_DOOR') return result;
  const command = await dispatch(db, result.command.id, now);
  return { kind: 'OPENING' as const, compartment: result.compartment, size: result.size, command: { id: command.id, status: command.status, error: command.error } };
}

/** The courier chooses another station they may use. Nothing moves until they choose. */
export async function moveToStation(db: Db, actor: Actor, parcelId: string, stationId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (p.state !== 'VERIFIED') throw conflict('PARCEL_STATE', 'Only a parcel waiting for a locker can change station.');
    await requireCourierAt(tx, actor, stationId);
    const station = await loadStation(tx, stationId);
    if (station.township_id !== p.township_id) throw notFound('Station');
    await tx.query('UPDATE locker_parcels SET station_id = $2 WHERE id = $1', [p.id, stationId]);
    await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Courier chose ${station.name} instead`, now);
    return { ok: true, station: station.name };
  });
}

/**
 * The courier takes the parcel to the guardhouse; the guard or staff receive it there. Only while the
 * counter is open: after hours the courier keeps the parcel and brings it on the next round.
 */
export async function chooseCounter(db: Db, actor: Actor, parcelId: string, locationId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (p.state !== 'VERIFIED') throw conflict('PARCEL_STATE', 'Only a parcel waiting for a locker can go to the counter.');
    const loc = await one<{ id: string; name: string; capacity: number; open_from_hour: number; open_to_hour: number }>(
      tx, 'SELECT id, name, capacity, open_from_hour, open_to_hour FROM overflow_locations WHERE id = $1 AND township_id = $2 AND active AND accepts_deliveries FOR UPDATE', [locationId, p.township_id],
    );
    if (!loc) throw notFound('Counter');
    const tz = (await getSettings(tx)).timezone;
    if (!counterOpenAt(loc.open_from_hour, loc.open_to_hour, now, tz)) {
      throw conflict('COUNTER_CLOSED', `${loc.name} is closed now. It opens at ${formatHour(loc.open_from_hour)}. Keep the parcel and bring it on your next round.`);
    }
    const committed = await one<{ count: number }>(tx,
      `SELECT count(*)::int AS count FROM locker_parcels q WHERE q.overflow_location_id = $1 AND q.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')`, [loc.id]);
    if (committed!.count >= loc.capacity) throw conflict('OVERFLOW_FULL', `${loc.name} is full. Keep the parcel and record the delivery as not made.`);
    await tx.query('UPDATE locker_parcels SET overflow_location_id = $2 WHERE id = $1', [p.id, locationId]);
    await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Courier is taking it to ${loc.name}`, now);
    return { ok: true, counter: loc.name };
  });
}

/**
 * The courier says why the parcel could not go into the home's door, picked from a short list or in their own
 * words. The reserved door is freed (or taken out of use when the courier found it damaged or not empty, and
 * staff are told), and the courier is shown where to take the parcel.
 */
export async function reportDeliveryProblem(db: Db, actor: Actor, parcelId: string, input: { reason: CourierProblem; note?: string }, now: Date) {
  const note = input.note?.trim() || null;
  if (input.reason === 'OTHER' && !note) throw ruleViolation('NOTE_NEEDED', 'Say what happened.', { fields: { note: 'Say what happened.' } });
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (!['VERIFIED', 'LOCKER_RESERVED', 'DEPOSIT_IN_PROGRESS'].includes(p.state)) throw conflict('PARCEL_STATE', 'This parcel is already in a locker.');
    const words = `${DELIVERY_PROBLEM_LABELS[input.reason]}${note ? `: ${note}` : ''}`;
    if (p.compartment_id) {
      const comp = (await one<CompartmentRow & { station_name: string }>(
        tx, 'SELECT c.*, s.name AS station_name FROM locker_compartments c JOIN locker_stations s ON s.id = c.station_id WHERE c.id = $1 FOR UPDATE OF c', [p.compartment_id],
      ))!;
      // A door the courier found damaged, or with something already inside, is kept out of use until staff look.
      const inspect = input.reason === 'DOOR_DAMAGED' || input.reason === 'DOOR_FULL';
      await tx.query(`UPDATE locker_reservations SET status = 'RELEASED', released_reason = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id, words.slice(0, 200)]);
      await tx.query(
        `UPDATE locker_compartments SET state = $3, parcel_id = NULL, fault = $4, updated_at = $5 WHERE id = $1 AND parcel_id = $2`,
        [comp.id, p.id, inspect ? 'FAULTY' : 'AVAILABLE', inspect ? `Courier: ${words}`.slice(0, 200) : null, now],
      );
      if (p.state !== 'VERIFIED') await transition(tx, p.id, 'VERIFIED', userActor(actor.id), `Door ${comp.label} not used: ${words}`, now, { compartment_id: null });
      if (inspect) {
        await tell(tx, await staffOf(tx, p.township_id), {
          title: `Check door ${comp.label} at ${comp.station_name}`, body: `A courier reported: ${words}.`, link: '/console/operations?tab=manage&view=stations',
        }, `door-check:${comp.id}:${now.toISOString().slice(0, 13)}`);
      }
    } else {
      await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Not into the home’s door: ${words}`, now);
    }
    await tx.query('UPDATE locker_parcels SET delivery_problem = $2, delivery_problem_note = $3 WHERE id = $1', [p.id, input.reason, note]);
    return { problem: input.reason, counters: await countersFor(tx, p.township_id, now) };
  });
}

/** Staff at a counter receive a parcel from a courier. Only now is it delivered, and the household is told why it is there. */
export async function receiveAtCounter(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p || (actor.role !== 'HQ_ADMIN' && p.township_id !== actor.townshipId)) throw notFound('Parcel');
    if (p.state !== 'VERIFIED' || !p.overflow_location_id) throw conflict('PARCEL_STATE', 'This parcel is not on its way to the counter.');
    const loc = await one<{ id: string; name: string; location: string; open_from_hour: number; open_to_hour: number; instructions: string }>(
      tx, 'SELECT id, name, location, open_from_hour, open_to_hour, instructions FROM overflow_locations WHERE id = $1 AND active FOR UPDATE', [p.overflow_location_id],
    );
    if (!loc) throw conflict('STORAGE_CLOSED', 'This guardhouse no longer takes parcels. Reopen it under Manage before receiving the parcel.');
    const policy = await getPolicy(tx, p.township_id, null);
    const deadline = new Date(now.getTime() + policy.overflow_collect_days * 86_400_000);
    await transition(tx, p.id, 'RELOCATED_TO_STORAGE', userActor(actor.id), `Received from the courier at ${loc.name}`, now, { relocated_at: now, ready_at: now, deadline_at: deadline });
    await custody(tx, p.id, { kind: 'COURIER', ref: p.courier_user_id }, { kind: 'OVERFLOW', ref: loc.name }, actor.id, now, 'Could not go into the home’s door; handed to the guard');
    await issueCredential(tx, p.id, 'OVERFLOW', loc.id, now);
    const reason = p.delivery_problem && (DELIVERY_PROBLEMS as readonly string[]).includes(p.delivery_problem) ? DELIVERY_PROBLEM_FOR_RESIDENT[p.delivery_problem as DeliveryProblem] : null;
    const why = reason ? `${reason} ` : '';
    const household = await householdOf(tx, p.home_id!);
    await tell(tx, household, {
      title: `Your parcel is at ${loc.name}`,
      // Written out in full, so each form has its own Malay template.
      body: loc.open_from_hour <= 0 && loc.open_to_hour >= 24
        ? `${why}Collect it at ${loc.location}, open 24 hours. ${loc.instructions}`
        : `${why}Collect it at ${loc.location}, open ${formatHour(loc.open_from_hour)} to ${formatHour(loc.open_to_hour)}. ${loc.instructions}`,
      link: `/app/parcels?tab=guardhouse&parcel=${p.id}`,
    }, `counter-ready:${p.id}`);
    const company = await one<{ name: string }>(tx, 'SELECT name FROM courier_companies WHERE id = $1', [p.company_id]);
    await emailParcelAtCounter(tx, household, {
      id: p.id, company: company?.name ?? 'the courier', counter: loc.name, location: loc.location, openFrom: loc.open_from_hour, openTo: loc.open_to_hour,
      instructions: loc.instructions, reason, overdueAfterDays: policy.overflow_collect_days, at: now,
    });
    await warnIfNearlyFull(tx, loc.id, now);
    return { ok: true };
  });
}

/** One message to staff and guards the day the guardhouse reaches 80% of its room. */
export async function warnIfNearlyFull(tx: Queryable, locationId: string, now: Date) {
  const o = await one<{ name: string; township_id: string; capacity: number; held: number }>(
    tx,
    `SELECT o.name, o.township_id, o.capacity,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.overflow_location_id = o.id AND p.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')) AS held
       FROM overflow_locations o WHERE o.id = $1`,
    [locationId],
  );
  if (!o || o.held < Math.ceil(o.capacity * 0.8)) return;
  const people = [...(await staffOf(tx, o.township_id)), ...(await guardsOf(tx, o.township_id))];
  await tell(tx, people, {
    priority: o.held >= o.capacity ? 'URGENT' : 'NORMAL',
    title: o.held >= o.capacity ? `${o.name} is full` : `${o.name} is nearly full`,
    body: `${o.held} of ${o.capacity} places are in use. Call the households with the oldest parcels.`,
    link: '/console/operations?tab=guardhouse',
  }, `counter-full:${locationId}:${o.held >= o.capacity ? 'full' : 'nearly'}:${now.toISOString().slice(0, 10)}`);
}

/** For stations without door or presence sensors: the courier confirms the parcel is in and the door is shut. */
export async function confirmDeposit(db: Db, actor: Actor, parcelId: string, now: Date) {
  const result = await confirmDepositTx(db, actor, parcelId, now);
  await notifyProviders(db, now);
  return result;
}

async function confirmDepositTx(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    const station = await loadStation(tx, p.station_id);
    if (station.has_door_sensor && station.has_presence_sensor) throw ruleViolation('SENSORS_DECIDE', 'This station confirms deposits itself when the door is shut.');
    if (p.state !== 'DEPOSIT_IN_PROGRESS' || !p.compartment_id) throw conflict('PARCEL_STATE', 'The door has not been opened for this parcel yet.');
    const comp = (await one<CompartmentRow>(tx, 'SELECT * FROM locker_compartments WHERE id = $1 FOR UPDATE', [p.compartment_id]))!;
    await completeDeposit(tx, p, comp, station, userActor(actor.id), now);
    return { ok: true };
  });
}

/**
 * The courier records that the delivery could not be made today: the parcel stays with them, for their next
 * round (for example, the guardhouse was closed). The household is told it is coming later, and why.
 */
export async function failDelivery(db: Db, actor: Actor, parcelId: string, reason: string, now: Date, problem?: DeliveryProblem) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (!['REGISTERED', 'VERIFIED', 'LOCKER_RESERVED'].includes(p.state)) throw conflict('PARCEL_STATE', 'This parcel is already in a locker.');
    if (p.compartment_id) {
      await tx.query(`UPDATE locker_reservations SET status = 'RELEASED', released_reason = 'Delivery not made' WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id]);
      await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, updated_at = $2 WHERE id = $1 AND parcel_id = $3`, [p.compartment_id, now, p.id]);
    }
    await transition(tx, p.id, 'DELIVERY_FAILED', userActor(actor.id), `Delivery not made: ${reason}`, now, {
      failure_reason: reason, compartment_id: null, ...(problem ? { delivery_problem: problem } : {}),
    });
    if (p.home_id) {
      const known = (problem ?? p.delivery_problem) as DeliveryProblem | null;
      const why = known && (DELIVERY_PROBLEMS as readonly string[]).includes(known) ? `${DELIVERY_PROBLEM_FOR_RESIDENT[known]} ` : '';
      const company = await one<{ name: string }>(tx, 'SELECT name FROM courier_companies WHERE id = $1', [p.company_id]);
      await tell(tx, await householdOf(tx, p.home_id), {
        title: `Your ${company?.name ?? 'courier'} parcel was not delivered today`,
        body: `${why}The courier kept it and will bring it on their next round. Tracking ${p.tracking_no}.`,
        link: '/app/parcels?tab=lockers',
      }, `not-delivered:${p.id}`);
    }
    return { ok: true };
  });
}

/** Where a delivery stands, for the courier's screen to follow. Settles a command that has run out of time. */
export async function deliveryStatus(db: Db, actor: Actor, parcelId: string) {
  const p = await one<ParcelRow & { station: string; compartment: string | null; has_sensors: boolean; adapter: string }>(
    db,
    `SELECT p.*, s.name AS station, c.label AS compartment, (s.has_door_sensor AND s.has_presence_sensor) AS has_sensors, s.adapter
       FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id
      WHERE p.id = $1 AND p.courier_user_id = $2`,
    [parcelId, actor.id],
  );
  if (!p) throw notFound('Parcel');
  const command = await one<{ id: string; status: string; error: string | null }>(
    db, `SELECT id, status, error FROM locker_commands WHERE parcel_id = $1 AND purpose = 'DEPOSIT' ORDER BY created_at DESC LIMIT 1`, [parcelId],
  );
  return {
    id: p.id, state: p.state, trackingNo: p.tracking_no, size: p.size, station: p.station, compartment: p.compartment,
    hasSensors: p.has_sensors, simulated: p.adapter === 'SIMULATED', failureReason: p.failure_reason, command: command ?? null,
  };
}

export async function courierHistory(db: Db, actor: Actor) {
  await courierAccountOf(db, actor);
  return db.query(
    `SELECT p.id, p.tracking_no, p.size, p.state, p.registered_at, p.failure_reason, s.name AS station, c.label AS compartment
       FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id
      WHERE p.courier_user_id = $1 ORDER BY p.registered_at DESC LIMIT 50`,
    [actor.id],
  );
}
