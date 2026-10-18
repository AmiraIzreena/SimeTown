import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { createStation, lockerForecast, lockerOverview, simulateClose, simulatorEvent, unlockStationKeypad } from '@/server/modules/lockers/admin';
import { completeSessionItem, decideAccessSession, listAccessSessions, openSessionItem, requestAccessSession } from '@/server/modules/lockers/access-sessions';
import { askToUnlockKeypad, extendDeadline, myLockerParcels, openFromApp, pickupAtStation, renewPickupCode } from '@/server/modules/lockers/collection';
import { DEVICE, transition } from '@/server/modules/lockers/core';
import { applyAsCourier, approveCourier, createCompany, revokeCourier } from '@/server/modules/lockers/couriers';
import { chooseCounter, failDelivery, moveToStation, receiveAtCounter, registerParcel, reserveAndOpen } from '@/server/modules/lockers/delivery';
import { deviceMessageText, reconcile, sign, type DeviceMessage } from '@/server/modules/lockers/hardware';
import {
  checkCounterCode, completeRelocation, createOverflow, failRelocation, handOverAtCounter, listCounterDeliveries, listOverflow, listRelocations, listStoredParcels, runExpiry, saveTownshipPolicy, setOverflowActive, startRelocation, verifyRelocatedParcel,
} from '@/server/modules/lockers/overflow';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { T0, at, freshDb, makeResident, makeWorld, type World } from './helpers';

/** Smart parcel lockers: the brief's four scenarios, and the rules that keep doors and codes safe. */

let db: Db;
let w: World;
let companyId: string;
let courier: Actor;
let stationA: { id: string; code: string };
let stationB: { id: string; code: string };
let counterId: string;
const H = 3_600_000;
const key = () => randomUUID();

async function makeCourier(stations: string[], approve = true): Promise<Actor> {
  const email = `courier-${randomUUID().slice(0, 8)}@kita.test`;
  const { id } = await applyAsCourier(db, { townshipId: w.townshipId, companyId, fullName: 'Ali Courier', email, phone: '+60123456789', password: 'courier-password-1' }, T0);
  if (approve) await approveCourier(db, w.admin, id, stations, T0);
  return toActor((await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1`, [id]))!);
}

async function deposit(resident: Actor, station = stationA, now = T0, size: 'S' | 'M' = 'S') {
  const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: `JT${randomUUID().slice(0, 10).replace(/-/g, '')}`, size, recipient: { memberCode: resident.memberCode! } }, now);
  const opened = await reserveAndOpen(db, courier, reg.id, key(), now);
  if (opened.kind !== 'OPENING') throw new Error('No compartment');
  await simulateClose(db, courier, reg.id, true, now);
  return { id: reg.id, compartment: opened.compartment };
}

const parcel = (id: string) => one<{ state: string; compartment_id: string | null; overflow_location_id: string | null; tracking_no: string }>(db, 'SELECT state, compartment_id, overflow_location_id, tracking_no FROM locker_parcels WHERE id = $1', [id]);
const pinOf = async (resident: Actor, id: string) => (await myLockerParcels(db, resident, T0)).parcels.find((p) => p.id === id)!;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  companyId = (await createCompany(db, w.hq, 'J&T Express')).id;
  stationA = await createStation(db, w.admin, { name: 'Locker A', location: 'Main gate', layout: { S: 3, M: 1 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  stationB = await createStation(db, w.admin, { name: 'Locker B', location: 'Community hall', layout: { S: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  counterId = (await createOverflow(db, w.admin, { name: 'Township office counter', kind: 'COUNTER', location: 'Township office', hours: 'Mon to Sat, 9am to 6pm', instructions: 'Bring your pickup code and ID.', capacity: 50, acceptsDeliveries: true })).id;
  courier = await makeCourier([stationA.id, stationB.id]);
});
afterAll(() => db.close());

describe('Scenario A: a successful delivery and collection', () => {
  it('assigns a door, confirms the deposit only when shut with the parcel inside, and frees it after collection', async () => {
    const resident = await makeResident(w);
    const reg = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'JT0001112223', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0);
    expect(reg).toMatchObject({ verified: true, state: 'VERIFIED' });
    const opened = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(opened).toMatchObject({ kind: 'OPENING', size: 'S', command: { status: 'ACKED' } });
    expect((await parcel(reg.id))!.state).toBe('DEPOSIT_IN_PROGRESS');

    // Closing the door on an empty compartment is not a delivery.
    await simulateClose(db, courier, reg.id, false, T0);
    expect((await parcel(reg.id))!.state).toBe('LOCKER_RESERVED');
    await reserveAndOpen(db, courier, reg.id, key(), T0);
    await simulateClose(db, courier, reg.id, true, T0);
    expect((await parcel(reg.id))!.state).toBe('READY_FOR_COLLECTION');

    const mine = await pinOf(resident, reg.id);
    expect(mine.pin).toMatch(/^\d{6}$/);
    expect(mine.qr).toMatch(/^SIMELOCKER:/);
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM pickup_credentials WHERE parcel_id = $1 AND pin_lookup LIKE '%' || $2 || '%'`, [reg.id, mine.pin]))!.n).toBe(0); // never stored
    expect((await one<{ title: string }>(db, 'SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]))!.title).toBe('Parcel from J&T Express in Locker A');

    // Collect with the PIN at the keypad: only this door opens, and only shutting it empty completes it.
    const pickup = await pickupAtStation(db, stationA.id, mine.pin!, DEVICE, key(), at(0.1));
    expect(pickup.compartment).toBe(opened.kind === 'OPENING' ? opened.compartment : '');
    await simulateClose(db, resident, reg.id, true, at(0.1));
    expect((await parcel(reg.id))!.state).toBe('READY_FOR_COLLECTION'); // still inside
    await pickupAtStation(db, stationA.id, mine.qr!, DEVICE, key(), at(0.11));
    await simulateClose(db, resident, reg.id, false, at(0.12));
    expect((await parcel(reg.id))!.state).toBe('COLLECTED');
    const comp = await one<{ state: string; parcel_id: string | null }>(db, `SELECT c.state, c.parcel_id FROM locker_compartments c WHERE c.station_id = $1 AND c.label = $2`, [stationA.id, pickup.compartment]);
    expect(comp).toEqual({ state: 'AVAILABLE', parcel_id: null });
    // The credential is spent.
    await expect(pickupAtStation(db, stationA.id, mine.pin!, DEVICE, key(), at(0.2))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
  });

  it('opens from the app only at the right station, and never from the wrong one', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident);
    await expect(openFromApp(db, resident, id, stationB.code, key(), T0)).rejects.toMatchObject({ code: 'WRONG_STATION' });
    const other = await makeResident(w);
    await expect(openFromApp(db, other, id, stationA.code, key(), T0)).rejects.toMatchObject({ status: 404 });
    const opened = await openFromApp(db, resident, id, stationA.code, key(), T0);
    expect(opened.command.status).toBe('ACKED');
    await simulateClose(db, resident, id, false, T0);
    expect((await parcel(id))!.state).toBe('COLLECTED');
  });
});

describe('Controlled maintenance access', () => {
  it('uses one second-admin approval, then opens and verifies selected parcels one door at a time', async () => {
    const minute = (value: number) => new Date(T0.getTime() + value * 60_000);
    const station = await createStation(db, w.admin, { name: 'Maintenance Locker', location: 'Service entrance', layout: { S: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
    const maintenanceCourier = await makeCourier([station.id]);
    const firstResident = await makeResident(w);
    const secondResident = await makeResident(w);
    const putInside = async (resident: Actor, trackingNo: string) => {
      const registered = await registerParcel(db, maintenanceCourier, { stationId: station.id, trackingNo, size: 'S', recipient: { memberCode: resident.memberCode! } }, T0);
      await reserveAndOpen(db, maintenanceCourier, registered.id, key(), T0);
      await simulateClose(db, maintenanceCourier, registered.id, true, T0);
      return registered.id;
    };
    const firstId = await putInside(firstResident, 'MAINT000001');
    const secondId = await putInside(secondResident, 'MAINT000002');

    const requested = await requestAccessSession(db, w.admin, {
      stationId: station.id,
      parcelIds: [firstId, secondId],
      reason: 'Both doors need controlled access after a sensor fault.',
    }, minute(1));
    await expect(decideAccessSession(db, w.admin, requested.id, { approve: true }, minute(2))).rejects.toMatchObject({ status: 403 });
    await decideAccessSession(db, w.admin2, requested.id, { approve: true }, minute(2));
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM locker_commands WHERE parcel_id = ANY($1::uuid[]) AND purpose = 'EXCEPTION'`, [[firstId, secondId]]))!.n).toBe(0);

    const session = (await listAccessSessions(db, w.admin, minute(3))).find((row) => row.id === requested.id)!;
    const first = session.items.find((item) => item.parcel_id === firstId)!;
    const second = session.items.find((item) => item.parcel_id === secondId)!;
    await openSessionItem(db, w.admin, requested.id, first.id, key(), minute(4));
    await expect(openSessionItem(db, w.admin, requested.id, second.id, key(), minute(5))).rejects.toMatchObject({ code: 'DOOR_OPEN' });
    await expect(completeSessionItem(db, w.admin, requested.id, first.id, 'WRONG-PARCEL', minute(5))).rejects.toMatchObject({ code: 'WRONG_PARCEL' });
    await completeSessionItem(db, w.admin, requested.id, first.id, 'MAINT000001', minute(6));
    await simulateClose(db, w.admin, firstId, false, minute(7));

    await openSessionItem(db, w.admin, requested.id, second.id, key(), minute(8));
    await completeSessionItem(db, w.admin, requested.id, second.id, 'MAINT000002', minute(9));
    await simulateClose(db, w.admin, secondId, false, minute(10));
    const finished = (await listAccessSessions(db, w.admin, minute(11))).find((row) => row.id === requested.id)!;
    expect(finished.status).toBe('COMPLETED');
    expect(finished.items.every((item) => item.status === 'COMPLETED')).toBe(true);
  });
});

describe('Scenario B: an uncollected parcel is relocated under custody', () => {
  it('reminds, makes a task at the deadline, relocates only after a verified scan and an empty door, and reissues the code', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident, stationA, T0);
    const oldPin = (await pinOf(resident, id)).pin!;

    expect(await runExpiry(db, new Date(T0.getTime() + 2 * H))).toMatchObject({ overdue: 0, firstReminders: 0 });
    // Monday 4am UTC is noon in Kuala Lumpur, outside quiet hours.
    expect(await runExpiry(db, new Date(T0.getTime() + 24.5 * H))).toMatchObject({ overdue: 1, firstReminders: 1 });
    expect(await runExpiry(db, new Date(T0.getTime() + 24.6 * H))).toMatchObject({ firstReminders: 0 }); // once only
    // 36.5 hours later it is 00:30 in Kuala Lumpur: the last reminder waits for the end of quiet hours (08:00).
    expect(await runExpiry(db, new Date(T0.getTime() + 36.5 * H))).toMatchObject({ finalReminders: 0 });
    expect(await runExpiry(db, new Date(T0.getTime() + 44.5 * H))).toMatchObject({ finalReminders: 1 });
    expect((await parcel(id))!.state).toBe('OVERDUE');
    expect(await runExpiry(db, new Date(T0.getTime() + 48.5 * H))).toMatchObject({ relocationTasks: 1 });
    expect((await parcel(id))!.state).toBe('RELOCATION_PENDING');
    // Expiry never opened the door.
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM locker_commands WHERE parcel_id = $1 AND purpose = 'RELOCATE'`, [id]))!.n).toBe(0);

    const task = (await one<{ id: string }>(db, `SELECT id FROM relocation_tasks WHERE parcel_id = $1 AND status = 'OPEN'`, [id]))!;
    const now = new Date(T0.getTime() + 50 * H);
    // A resident without staff rights cannot start it (route roles) and a guard has no relocation route; staff can.
    await startRelocation(db, w.staff, task.id, counterId, key(), now);
    expect((await parcel(id))!.state).toBe('RELOCATION_IN_PROGRESS');
    await expect(verifyRelocatedParcel(db, w.staff, task.id, 'WRONG123456', now)).rejects.toMatchObject({ code: 'TRACKING_MISMATCH' });
    await expect(completeRelocation(db, w.staff, task.id, false, now)).rejects.toMatchObject({ code: 'NOT_VERIFIED' });
    await verifyRelocatedParcel(db, w.staff, task.id, (await parcel(id))!.tracking_no, now);
    await expect(completeRelocation(db, w.staff, task.id, false, now)).rejects.toMatchObject({ code: 'NOT_EMPTY_YET' });
    await simulateClose(db, w.staff, id, false, now);
    await completeRelocation(db, w.staff, task.id, false, now);

    const moved = (await parcel(id))!;
    expect(moved).toMatchObject({ state: 'RELOCATED_TO_STORAGE', compartment_id: null, overflow_location_id: counterId });
    const completedTask = (await listRelocations(db, w.staff)).find((row) => row.id === task.id)!;
    expect(completedTask).toMatchObject({ status: 'DONE', station_id: stationA.id, destination: 'Township office counter' });
    expect(completedTask.compartment).toBeTruthy();
    expect(await listStoredParcels(db, w.staff)).toContainEqual(expect.objectContaining({
      id, state: 'RELOCATED_TO_STORAGE', location_id: counterId, location: 'Township office counter', recipient: resident.fullName,
    }));
    await expect(pickupAtStation(db, stationA.id, oldPin, DEVICE, key(), now)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    const newCode = (await myLockerParcels(db, resident, now)).parcels.find((p) => p.id === id)!;
    expect(newCode.counter?.name).toBe('Township office counter');
    expect(newCode.pin).not.toBe(oldPin);
    const checked = await checkCounterCode(db, w.staff, counterId, newCode.pin!, now);
    expect(checked.recipient).toBe(resident.fullName);
    await expect(handOverAtCounter(db, w.staff, counterId, newCode.pin!, false, now)).rejects.toMatchObject({ code: 'ID_NOT_CHECKED' });
    await handOverAtCounter(db, w.staff, counterId, newCode.pin!, true, now);
    expect((await parcel(id))!.state).toBe('COLLECTED');
    expect((await listStoredParcels(db, w.staff)).some((row) => row.id === id)).toBe(false);
    const chain = await db.query<{ from_kind: string; to_kind: string }>('SELECT from_kind, to_kind FROM custody_transfers WHERE parcel_id = $1 ORDER BY id', [id]);
    expect(chain.map((c) => `${c.from_kind}>${c.to_kind}`)).toEqual(['COURIER>LOCKER', 'LOCKER>STAFF', 'STAFF>OVERFLOW', 'OVERFLOW>RESIDENT']);
  });

  it('holds a missing parcel as an exception and keeps the compartment out of use', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident, stationB, T0);
    await runExpiry(db, new Date(T0.getTime() + 49 * H));
    const task = (await one<{ id: string }>(db, `SELECT id FROM relocation_tasks WHERE parcel_id = $1`, [id]))!;
    await startRelocation(db, w.staff, task.id, counterId, key(), new Date(T0.getTime() + 50 * H));
    await failRelocation(db, w.staff, task.id, 'MISSING', 'Compartment was empty when opened', new Date(T0.getTime() + 50 * H));
    expect((await parcel(id))!.state).toBe('EXCEPTION');
    const comp = await one<{ state: string }>(db, `SELECT state FROM locker_compartments WHERE id = (SELECT compartment_id FROM locker_parcels WHERE id = $1)`, [id]);
    expect(comp!.state).toBe('FAULTY');
    const incident = await one<{ reference: string; module: string; kind: string; priority: string; status: string; parcel_id: string; details: { relocationTaskId: string; reason: string; reportedBy: string } }>(
      db, `SELECT reference, module, kind, priority, status, parcel_id, details FROM incidents WHERE dedupe_key = $1`, [`relocation:${task.id}`],
    );
    expect(incident).toMatchObject({ module: 'LOCKERS', kind: 'RELOCATION_PROBLEM', priority: 'HIGH', status: 'OPEN', parcel_id: id });
    expect(incident!.details).toMatchObject({ relocationTaskId: task.id, reason: 'MISSING', reportedBy: w.staff.id });
    expect((await listRelocations(db, w.staff)).find((row) => row.id === task.id)).toMatchObject({ case_reference: incident!.reference });
    await simulatorEvent(db, w.staff, stationB.id, { type: 'FAULT', compartmentId: (await one<{ compartment_id: string }>(db, 'SELECT compartment_id FROM locker_parcels WHERE id = $1', [id]))!.compartment_id, on: false }, T0).catch(() => undefined);
  });
});

describe('Scenario C: the station is full', () => {
  it('offers only approved alternatives, never reroutes by itself, and records a failed delivery honestly', async () => {
    const full = await createStation(db, w.admin, { name: 'Locker C', location: 'Shops', layout: { S: 1 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
    const c2 = await makeCourier([full.id, stationB.id]);
    const r1 = await makeResident(w);
    const r2 = await makeResident(w);
    const first = await registerParcel(db, c2, { stationId: full.id, trackingNo: 'NV1000000001', size: 'S', recipient: { memberCode: r1.memberCode! } }, T0);
    const second = await registerParcel(db, c2, { stationId: full.id, trackingNo: 'NV1000000002', size: 'S', recipient: { memberCode: r2.memberCode! } }, T0);
    // Two couriers' requests for the last door: only one gets it.
    const [a, b] = await Promise.all([reserveAndOpen(db, c2, first.id, key(), T0), reserveAndOpen(db, c2, second.id, key(), T0)]);
    expect([a.kind, b.kind].sort()).toEqual(['FULL', 'OPENING']);
    const waiting = a.kind === 'FULL' ? first.id : second.id;
    const result = a.kind === 'FULL' ? a : b;
    if (result.kind !== 'FULL') throw new Error('expected FULL');
    expect(result.alternatives.stations.map((s) => s.name)).toEqual(['Locker B']);
    expect(result.alternatives.counters.map((s) => s.name)).toEqual(['Township office counter']);
    expect((await parcel(waiting))!.state).toBe('VERIFIED'); // not delivered, not moved
    // A station this courier has no access to cannot be chosen.
    await expect(moveToStation(db, c2, waiting, stationA.id, T0)).rejects.toMatchObject({ status: 403 });
    // The courier takes it to the counter; it is delivered only when staff receive it.
    await chooseCounter(db, c2, waiting, counterId, T0);
    expect((await parcel(waiting))!.state).toBe('VERIFIED');
    expect(await listCounterDeliveries(db, w.staff)).toContainEqual(expect.objectContaining({ id: waiting, location_id: counterId }));
    expect(await listOverflow(db, w.staff)).toContainEqual(expect.objectContaining({ id: counterId, incoming: 1 }));
    await receiveAtCounter(db, w.staff, waiting, T0);
    expect((await parcel(waiting))!.state).toBe('RELOCATED_TO_STORAGE');
    expect((await listCounterDeliveries(db, w.staff)).some((row) => row.id === waiting)).toBe(false);
    expect(await listStoredParcels(db, w.staff)).toContainEqual(expect.objectContaining({ id: waiting, location_id: counterId }));
    await expect(setOverflowActive(db, w.admin, counterId, false)).rejects.toMatchObject({ code: 'STORAGE_IN_USE' });

    const third = await registerParcel(db, c2, { stationId: full.id, trackingNo: 'NV1000000003', size: 'S', recipient: { memberCode: r1.memberCode! } }, T0);
    await failDelivery(db, c2, third.id, 'Lockers full; taken back for redelivery', T0);
    expect((await parcel(third.id))!.state).toBe('DELIVERY_FAILED');
  });
});

describe('Scenario D: hardware failure', () => {
  it('a jammed door frees the reservation, flags the door and never confirms a delivery', async () => {
    const resident = await makeResident(w);
    const comp = await one<{ id: string }>(db, `SELECT id FROM locker_compartments WHERE station_id = $1 AND size = 'M'`, [stationA.id]);
    await simulatorEvent(db, w.staff, stationA.id, { type: 'FAIL_NEXT', compartmentId: comp!.id, on: true }, T0);
    const reg = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'JTJAM0000001', size: 'M', recipient: { memberCode: resident.memberCode! } }, T0);
    const opened = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(opened).toMatchObject({ kind: 'OPENING', command: { status: 'FAILED' } });
    expect((await parcel(reg.id))!).toMatchObject({ state: 'VERIFIED', compartment_id: null });
    expect((await one<{ state: string }>(db, 'SELECT state FROM locker_compartments WHERE id = $1', [comp!.id]))!.state).toBe('FAULTY');
    expect((await myLockerParcels(db, resident, T0)).parcels).toHaveLength(0);
  });

  it('an offline station is refused, and a gateway that never answers times out and is reconciled', async () => {
    const resident = await makeResident(w);
    await simulatorEvent(db, w.staff, stationB.id, { type: 'STATION', status: 'OFFLINE' }, T0);
    await expect(registerParcel(db, courier, { stationId: stationB.id, trackingNo: 'JTOFF0000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0)).rejects.toMatchObject({ code: 'STATION_OFFLINE' });
    await simulatorEvent(db, w.staff, stationB.id, { type: 'STATION', status: 'ONLINE' }, T0);

    const gw = await createStation(db, w.admin, { name: 'Gateway station', location: 'Phase 2', layout: { S: 1 }, adapter: 'HTTP_GATEWAY', gatewayUrl: 'http://gateway.invalid', hasDoorSensor: true, hasPresenceSensor: true });
    const c3 = await makeCourier([gw.id]);
    vi.stubGlobal('fetch', async () => new Response(null, { status: 202 }));
    try {
      const reg = await registerParcel(db, c3, { stationId: gw.id, trackingNo: 'GW0000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0);
      const opened = await reserveAndOpen(db, c3, reg.id, key(), T0);
      expect(opened).toMatchObject({ kind: 'OPENING', command: { status: 'SENT' } });
      expect(await reconcile(db, new Date(T0.getTime() + 10_000))).toMatchObject({ commandsTimedOut: 0 });
      expect(await reconcile(db, new Date(T0.getTime() + 31_000))).toMatchObject({ commandsTimedOut: 1 });
      expect((await parcel(reg.id))!.state).toBe('VERIFIED');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Security and integrity', () => {
  it('only an approved courier with access to the station can register, and duplicates are refused', async () => {
    const resident = await makeResident(w);
    const pending = await makeCourier([], false);
    await expect(registerParcel(db, pending, { stationId: stationA.id, trackingNo: 'PD0000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0)).rejects.toMatchObject({ status: 403 });
    const revoked = await makeCourier([stationA.id]);
    await revokeCourier(db, w.admin, revoked.id, 'Left the company', T0);
    await expect(registerParcel(db, revoked, { stationId: stationA.id, trackingNo: 'RV0000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0)).rejects.toMatchObject({ status: 403 });
    await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'DUP000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0);
    await expect(registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'dup000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0)).rejects.toMatchObject({ code: 'DUPLICATE_PARCEL' });
  });

  it('verifies the recipient by name without revealing who lives there', async () => {
    const resident = await makeResident(w);
    const ok = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'NM0000000001', size: 'S', recipient: { homeId: resident.homeId!, name: 'Resident Tester' } }, T0);
    expect(ok.verified).toBe(true);
    const wrong = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'NM0000000002', size: 'S', recipient: { homeId: resident.homeId!, name: 'Somebody Else' } }, T0);
    expect(wrong).toEqual({ id: wrong.id, state: 'DELIVERY_FAILED', verified: false, size: 'S' });
    expect(JSON.stringify(wrong)).not.toContain(resident.fullName);
  });

  it('slows down PIN guessing at a station', async () => {
    const station = await createStation(db, w.admin, { name: 'Locker G', location: 'Gym', layout: { S: 1 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
    for (let i = 0; i < 10; i++) await expect(pickupAtStation(db, station.id, String(100000 + i), DEVICE, key(), T0)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    await expect(pickupAtStation(db, station.id, '123456', DEVICE, key(), T0)).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('locks a station keypad after a day of wrong codes until staff unlock it, and tells staff', async () => {
    const station = await createStation(db, w.admin, { name: 'Locker K', location: 'Pool', layout: { S: 1 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
    const min = (m: number) => new Date(T0.getTime() + m * 60_000);
    const wrong = (m: number, i: number) => pickupAtStation(db, station.id, String(200000 + m * 100 + i), DEVICE, key(), min(m));
    const staffTitles = async () => db.query<{ title: string; priority: string }>(`SELECT title, priority FROM notifications WHERE user_id = $1 AND body LIKE 'Locker K:%' ORDER BY id`, [w.staff.id]);
    // Three bursts of ten, each in its own 10-minute window: the first two only slow it down and warn staff.
    for (const m of [0, 20]) for (let i = 0; i < 10; i++) await expect(wrong(m, i)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    expect((await staffTitles()).map((n) => n.title)).toEqual(['Many wrong pickup codes', 'Many wrong pickup codes']);
    for (let i = 0; i < 10; i++) await expect(wrong(40, i)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    expect((await staffTitles()).at(-1)).toEqual({ title: 'Locker keypad locked', priority: 'URGENT' });
    // Waiting does not help: it stays locked the next day too.
    await expect(wrong(60 * 30, 0)).rejects.toMatchObject({ code: 'KEYPAD_LOCKED' });
    expect((await lockerOverview(db, w.staff, min(60 * 30))).stations.find((s) => s.id === station.id)!.keypad_locked_at).not.toBeNull();
    // A resident waiting there can ask staff to unlock it: staff hear once per resident, and the app still opens the door.
    const resident = await makeResident(w);
    const kCourier = await makeCourier([station.id]);
    const reg = await registerParcel(db, kCourier, { stationId: station.id, trackingNo: 'KP0000000001', size: 'S', recipient: { memberCode: resident.memberCode! } }, min(60 * 30));
    await reserveAndOpen(db, kCourier, reg.id, key(), min(60 * 30));
    await simulateClose(db, kCourier, reg.id, true, min(60 * 30));
    expect((await myLockerParcels(db, resident, min(60 * 30))).parcels[0]!.keypad).toEqual({ locked: true, staffTold: false });
    await expect(askToUnlockKeypad(db, await makeResident(w), reg.id, min(60 * 30))).rejects.toMatchObject({ status: 404 });
    expect(await askToUnlockKeypad(db, resident, reg.id, min(60 * 30))).toEqual({ told: true, alreadyAsked: false });
    expect(await askToUnlockKeypad(db, resident, reg.id, min(60 * 30))).toEqual({ told: true, alreadyAsked: true });
    const asked = await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'A resident is waiting at a locked keypad'`, [w.staff.id]);
    expect(asked).toHaveLength(1);
    expect((await myLockerParcels(db, resident, min(60 * 30))).parcels[0]!.keypad).toEqual({ locked: true, staffTold: true });
    expect((await lockerOverview(db, w.staff, min(60 * 30))).stations.find((s) => s.id === station.id)!.keypad_help).toBe(1);
    await openFromApp(db, resident, reg.id, station.code, key(), min(60 * 30));
    await simulateClose(db, resident, reg.id, false, min(60 * 30));
    expect((await parcel(reg.id))!.state).toBe('COLLECTED');
    await unlockStationKeypad(db, w.staff, station.id, min(60 * 31));
    await expect(unlockStationKeypad(db, w.staff, station.id, min(60 * 31))).rejects.toMatchObject({ status: 404 });
    // Counting starts again from the unlock.
    await expect(wrong(60 * 31 + 1, 0)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    await expect(askToUnlockKeypad(db, resident, reg.id, min(60 * 31))).rejects.toMatchObject({ code: 'KEYPAD_NOT_LOCKED' });
  });

  it('never locks a staffed counter, where staff check ID anyway', async () => {
    const counter = await createOverflow(db, w.admin, { name: 'Guardhouse counter', kind: 'COUNTER', location: 'Main gate', hours: 'Daily', instructions: 'Bring your code and ID.', capacity: 10, acceptsDeliveries: false });
    for (const m of [0, 20, 40, 60]) {
      for (let i = 0; i < 10; i++) {
        await expect(checkCounterCode(db, w.staff, counter.id, String(300000 + m * 100 + i), new Date(T0.getTime() + m * 60_000))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
      }
    }
    await expect(checkCounterCode(db, w.staff, counter.id, '399999', new Date(T0.getTime() + 80 * 60_000))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
  });

  it('gives the household a new code on request, and the old one stops working at once', async () => {
    const resident = await makeResident(w);
    const housemate = await makeResident(w, { homeId: resident.homeId! });
    const { id } = await deposit(resident, stationA, at(2));
    const before = (await myLockerParcels(db, resident, at(2))).parcels.find((p) => p.id === id)!;
    expect(before.canRenewCode).toBe(true);
    await expect(renewPickupCode(db, await makeResident(w), id, at(2))).rejects.toMatchObject({ status: 404 });
    await renewPickupCode(db, resident, id, at(2));
    const after = (await myLockerParcels(db, resident, at(2))).parcels.find((p) => p.id === id)!;
    expect(after.qr).not.toBe(before.qr);
    await expect(pickupAtStation(db, stationA.id, before.qr!, DEVICE, key(), at(2))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    expect((await one<{ title: string }>(db, 'SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [housemate.id]))!.title).toBe('New pickup code');
    expect(await one(db, `SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'New pickup code'`, [resident.id])).toBeUndefined();
    // Not while the door is open.
    await pickupAtStation(db, stationA.id, after.pin!, DEVICE, key(), at(2));
    await expect(renewPickupCode(db, resident, id, at(2))).rejects.toMatchObject({ code: 'PARCEL_STATE' });
    await simulateClose(db, resident, id, false, at(2));
    expect((await parcel(id))!.state).toBe('COLLECTED');
  });

  it('refuses illegal state moves and lets nobody else close a door', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident, stationA);
    await expect(db.tx((tx) => transition(tx, id, 'COLLECTED', DEVICE, 'skip', T0))).rejects.toMatchObject({ code: 'PARCEL_STATE' });
    const stranger = await makeResident(w);
    await expect(simulateClose(db, stranger, id, false, T0)).rejects.toMatchObject({ status: 404 });
  });

  it('accepts only signed, fresh, unreplayed station messages', async () => {
    const gw = await createStation(db, w.admin, { name: 'Signed station', location: 'Phase 3', layout: { S: 1 }, adapter: 'HTTP_GATEWAY', gatewayUrl: 'http://gateway.invalid', hasDoorSensor: true, hasPresenceSensor: true });
    const handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
    const send = (body: unknown) => handle(new Request('http://kita.test/api/v1/devices/lockers/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const message: DeviceMessage = { stationId: gw.id, eventId: 'heartbeat-0001', type: 'HEARTBEAT', ts: T0.toISOString() };
    const good = sign(gw.deviceSecret!, deviceMessageText(message));
    expect((await send({ ...message, signature: 'a'.repeat(64) })).status).toBe(401);
    expect((await send({ ...message, signature: good })).status).toBe(200);
    expect(await (await send({ ...message, signature: good })).json()).toMatchObject({ data: { duplicate: true } });
    const stale = { ...message, eventId: 'heartbeat-0002', ts: new Date(T0.getTime() - 10 * 60_000).toISOString() };
    expect((await send({ ...stale, signature: sign(gw.deviceSecret!, deviceMessageText(stale)) })).status).toBe(401);
  });
});

describe('Policy, extensions, dashboard and forecast', () => {
  it('extends only when management allows it, with a disclosed fee that is agreed but never charged', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident, stationA);
    await expect(extendDeadline(db, resident, id, false, T0)).rejects.toMatchObject({ code: 'NO_EXTENSIONS' });
    await saveTownshipPolicy(db, w.admin, {
      first_reminder_hours: 24, final_reminder_hours: 36, relocate_after_hours: 48, overflow_collect_days: 7, quiet_from_hour: 22, quiet_to_hour: 8,
      extensions_enabled: true, extension_hours: 24, max_extensions: 1, fee_enabled: true, fee_sen: 200, exceptions_need_second_approval: true,
    }, T0);
    await expect(extendDeadline(db, resident, id, false, T0)).rejects.toMatchObject({ code: 'FEE_NOT_AGREED' });
    const extended = await extendDeadline(db, resident, id, true, T0);
    expect(extended.deadlineAt.getTime() - T0.getTime()).toBe(72 * H);
    await expect(extendDeadline(db, resident, id, true, T0)).rejects.toMatchObject({ code: 'EXTENSION_USED' });
    // Collection is never blocked by the fee.
    const mine = await pinOf(resident, id);
    await pickupAtStation(db, stationA.id, mine.pin!, DEVICE, key(), T0);
  });

  it('counts the dashboard from the compartments themselves, and explains its forecast', async () => {
    const overview = await lockerOverview(db, w.staff, T0);
    for (const s of overview.stations) {
      const real = await one<{ total: number; occupied: number; available: number }>(
        db,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'OCCUPIED')::int AS occupied, count(*) FILTER (WHERE state = 'AVAILABLE')::int AS available FROM locker_compartments WHERE station_id = $1`,
        [s.id],
      );
      expect({ total: s.total, occupied: s.occupied, available: s.available }).toEqual(real);
      expect(s.available + s.occupied + s.reserved + s.faulty + s.disabled).toBe(s.total);
    }
    const forecast = await lockerForecast(db, w.staff, T0);
    expect(forecast.stations.length).toBeGreaterThan(0);
    for (const f of forecast.stations) expect(f.method.length).toBeGreaterThan(10);
  });
});
