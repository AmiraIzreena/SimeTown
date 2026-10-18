import { LOCKER_SIZES, sizeFor, type LockerSize } from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { AppError, conflict, notFound, ruleViolation } from '../../errors';
import { nameWords } from '../carriers/matching';
import { notifyProviders } from '../carriers/providers';
import { courierContext, logScan, refusal, shipmentRow, verifyShipment } from '../carriers/verification';
import { completeDeposit, createUnlock, dispatch, RESERVATION_MS, type CompartmentRow, type StationRow } from './hardware';
import { custody, getPolicy, householdOf, issueCredential, recordEvent, staffOf, tell, transition, userActor, type ParcelRow } from './core';
import { courierAccountOf, COURIER_STATIONS_SQL, requireCourierAt, type CourierAccount } from './couriers';
import { raiseIncident } from './incidents';

/**
 * Delivering to a locker. The courier scans the label: the courier company's
 * system (simulated in the demo) confirms the shipment and SimeTown matches it
 * to a household, without showing the courier who lives there. Where the
 * company is not connected, the resident's own delivery code is the fallback.
 * Only then does the engine reserve the smallest suitable working compartment,
 * the door is unlocked through the station's adapter, and the deposit is
 * complete only when the station reports the door shut with the parcel inside.
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
      if (!size) throw ruleViolation('TOO_BIG', 'This parcel is too big for any locker. Deliver it to the door or the parcel counter instead.');
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

/** Where else this parcel could go when the station has no suitable door. */
async function alternatives(tx: Queryable, actor: Actor, p: ParcelRow) {
  const stations = await tx.query<{ id: string; name: string; location: string; free: number }>(
    `SELECT s.id, s.name, s.location,
            (SELECT count(*)::int FROM locker_compartments c WHERE c.station_id = s.id AND c.state = 'AVAILABLE' AND array_position(ARRAY['S','M','L','XL'], c.size) >= array_position(ARRAY['S','M','L','XL'], $3)) AS free
       FROM locker_stations s
      WHERE s.id IN (${COURIER_STATIONS_SQL}) AND s.id <> $2 AND s.township_id = $4 AND s.status = 'ONLINE'`,
    [actor.id, p.station_id, p.size, p.township_id],
  );
  const counters = await tx.query<{ id: string; name: string; location: string; hours: string }>(
    `SELECT o.id, o.name, o.location, o.hours FROM overflow_locations o
      WHERE o.township_id = $1 AND o.active AND o.accepts_deliveries
        AND (SELECT count(*) FROM locker_parcels q WHERE q.overflow_location_id = o.id AND q.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING')) < o.capacity`,
    [p.township_id],
  );
  return { stations: stations.filter((s) => s.free > 0), counters };
}

/**
 * Reserves the smallest working compartment that fits, locks it in the
 * database (two couriers can never get the same door), and asks the station to
 * unlock it. When nothing fits, the courier sees the approved alternatives and
 * staff are told the station is full; nothing is rerouted on its own.
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
    if (station.status !== 'ONLINE') throw ruleViolation('STATION_OFFLINE', 'This station is not working right now. Choose another station below or record the delivery as not made.');
    await assertMayOpenAgain(tx, p.id, idempotencyKey);
    const comp = await one<CompartmentRow>(
      tx,
      `SELECT * FROM locker_compartments
        WHERE station_id = $1 AND state = 'AVAILABLE' AND array_position(ARRAY['S','M','L','XL'], size) >= $2
        ORDER BY array_position(ARRAY['S','M','L','XL'], size), label
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [station.id, SIZE_RANK(p.size) + 1],
    );
    if (!comp) {
      await tell(tx, await staffOf(tx, station.township_id), {
        title: `${station.name} has no ${p.size} compartment free`,
        body: 'A courier could not deposit a parcel. Check overdue parcels and relocation tasks.',
        link: '/console/lockers',
      }, `station-full:${station.id}:${now.toISOString().slice(0, 13)}`);
      await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `No ${p.size} compartment free at ${station.name}`, now);
      return { kind: 'FULL' as const, alternatives: await alternatives(tx, actor, p) };
    }
    await tx.query(`UPDATE locker_compartments SET state = 'RESERVED', parcel_id = $2, updated_at = $3 WHERE id = $1`, [comp.id, p.id, now]);
    await tx.query(`INSERT INTO locker_reservations (compartment_id, parcel_id, expires_at, created_at) VALUES ($1, $2, $3, $4)`, [comp.id, p.id, new Date(now.getTime() + RESERVATION_MS), now]);
    await transition(tx, p.id, 'LOCKER_RESERVED', userActor(actor.id), `Door ${comp.label} reserved`, now, { compartment_id: comp.id });
    const command = await createUnlock(tx, { stationId: station.id, compartmentId: comp.id, parcelId: p.id, purpose: 'DEPOSIT', requestedBy: actor.id, idempotencyKey }, now);
    return { kind: 'OPENING' as const, command, compartment: comp.label, size: comp.size };
  });
  if (result.kind === 'FULL') return result;
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

/** The courier takes the parcel to a staffed counter that accepts deliveries; staff receive it there. */
export async function chooseCounter(db: Db, actor: Actor, parcelId: string, locationId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (p.state !== 'VERIFIED') throw conflict('PARCEL_STATE', 'Only a parcel waiting for a locker can go to the counter.');
    const loc = await one<{ id: string; name: string; capacity: number }>(tx, 'SELECT id, name, capacity FROM overflow_locations WHERE id = $1 AND township_id = $2 AND active AND accepts_deliveries FOR UPDATE', [locationId, p.township_id]);
    if (!loc) throw notFound('Counter');
    const committed = await one<{ count: number }>(tx,
      `SELECT ((SELECT count(*)::int FROM locker_parcels q WHERE q.overflow_location_id = $1 AND q.state IN ('VERIFIED', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING')) +
               (SELECT count(*)::int FROM relocation_tasks r WHERE r.destination_id = $1 AND r.status = 'IN_PROGRESS')) AS count`, [loc.id]);
    if (committed!.count >= loc.capacity) throw conflict('OVERFLOW_FULL', `${loc.name} is full. Choose another location.`);
    await tx.query('UPDATE locker_parcels SET overflow_location_id = $2 WHERE id = $1', [p.id, locationId]);
    await recordEvent(tx, p.id, p.state, p.state, userActor(actor.id), `Courier is taking it to ${loc.name}`, now);
    return { ok: true, counter: loc.name };
  });
}

/** Staff at a counter receive a parcel from a courier. Only now is it delivered. */
export async function receiveAtCounter(db: Db, actor: Actor, parcelId: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p || (actor.role !== 'HQ_ADMIN' && p.township_id !== actor.townshipId)) throw notFound('Parcel');
    if (p.state !== 'VERIFIED' || !p.overflow_location_id) throw conflict('PARCEL_STATE', 'This parcel is not on its way to the counter.');
    const loc = await one<{ id: string; name: string; location: string; hours: string }>(tx, 'SELECT id, name, location, hours FROM overflow_locations WHERE id = $1 AND active FOR UPDATE', [p.overflow_location_id]);
    if (!loc) throw conflict('STORAGE_CLOSED', 'This storage location is closed. Reopen it before receiving the parcel.');
    const policy = await getPolicy(tx, p.township_id, null);
    const deadline = new Date(now.getTime() + policy.overflow_collect_days * 86_400_000);
    await transition(tx, p.id, 'RELOCATED_TO_STORAGE', userActor(actor.id), `Received from the courier at ${loc.name}`, now, { relocated_at: now, ready_at: now, deadline_at: deadline });
    await custody(tx, p.id, { kind: 'COURIER', ref: p.courier_user_id }, { kind: 'OVERFLOW', ref: loc.name }, actor.id, now, 'Lockers full; handed to staff');
    await issueCredential(tx, p.id, 'OVERFLOW', loc.id, now);
    await tell(tx, await householdOf(tx, p.home_id!), { title: `Parcel waiting at ${loc.name}`, body: `${loc.location}. Open ${loc.hours}. Show your pickup code from Parcels in SimeTown.`, link: '/app/parcels' }, `counter-ready:${p.id}`);
    return { ok: true };
  });
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

/** The courier records that the delivery could not be made. The parcel goes back with them. */
export async function failDelivery(db: Db, actor: Actor, parcelId: string, reason: string, now: Date) {
  return db.tx(async (tx) => {
    const p = await ownParcel(tx, actor, parcelId, now);
    if (!['REGISTERED', 'VERIFIED', 'LOCKER_RESERVED'].includes(p.state)) throw conflict('PARCEL_STATE', 'This parcel is already in a locker.');
    if (p.compartment_id) {
      await tx.query(`UPDATE locker_reservations SET status = 'RELEASED', released_reason = 'Delivery not made' WHERE parcel_id = $1 AND status = 'ACTIVE'`, [p.id]);
      await tx.query(`UPDATE locker_compartments SET state = 'AVAILABLE', parcel_id = NULL, updated_at = $2 WHERE id = $1 AND parcel_id = $3`, [p.compartment_id, now, p.id]);
    }
    await transition(tx, p.id, 'DELIVERY_FAILED', userActor(actor.id), `Delivery not made: ${reason}`, now, { failure_reason: reason, compartment_id: null });
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
