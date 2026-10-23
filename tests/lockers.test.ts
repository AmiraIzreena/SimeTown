import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { createStation, lockerForecast, lockerOverview, releaseDoor, simulateClose, simulatorEvent, stationDoors, unlockStationKeypad } from '@/server/modules/lockers/admin';
import { completeSessionItem, decideAccessSession, listAccessSessions, openSessionItem, requestAccessSession } from '@/server/modules/lockers/access-sessions';
import { askToUnlockKeypad, extendDeadline, myLockerParcels, openFromApp, pickupAtStation, renewPickupCode } from '@/server/modules/lockers/collection';
import { DEFAULT_POLICY, DEVICE, transition } from '@/server/modules/lockers/core';
import { applyAsCourier, approveCourier, createCompany, revokeCourier } from '@/server/modules/lockers/couriers';
import { chooseCounter, failDelivery, moveToStation, receiveAtCounter, registerParcel, reportDeliveryProblem, reserveAndOpen } from '@/server/modules/lockers/delivery';
import { deviceMessageText, reconcile, sign, type DeviceMessage } from '@/server/modules/lockers/hardware';
import {
  addParcelNote, checkCounterCode, completeReturn, createOverflow, getTownshipPolicy, handOverAtCounter, keepAtCounter, listCounterDeliveries, listOverflow, listStoredParcels,
  parcelNotes, runExpiry, saveTownshipPolicy, setOverflowActive, startReturn, updateOverflow,
} from '@/server/modules/lockers/overflow';
import { checkGuardhouseCode, guardhouseOverview, guardhouseParcel, guardhouseRegister } from '@/server/modules/parcels/guardhouse';
import { logParcel, myParcels, runShelfRules } from '@/server/modules/parcels/service';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { T0, at, freshDb, makeHome, makeResident, makeWorld, type World } from './helpers';

/**
 * Smart parcel lockers: every home has its own door in the locker bank serving its precinct; a parcel that cannot
 * go into it waits at the guardhouse, which keeps opening hours. Nothing is ever sent back by
 * itself and no fees are charged. Plus the rules that keep doors and codes safe.
 */

let db: Db;
let w: World;
let companyId: string;
let courier: Actor;
let guard: Actor;
let stationA: { id: string; code: string };
let stationB: { id: string; code: string };
let counterId: string;
const H = 3_600_000;
const key = () => randomUUID();
const hours = (h: number, from = T0) => new Date(from.getTime() + h * H);

async function makeCourier(stations: string[], approve = true): Promise<Actor> {
  const email = `courier-${randomUUID().slice(0, 8)}@kita.test`;
  const { id } = await applyAsCourier(db, { townshipId: w.townshipId, companyId, fullName: 'Ali Courier', email, phone: '+60123456789', password: 'courier-password-1' }, T0);
  if (approve) await approveCourier(db, w.admin, id, stations, T0);
  return toActor((await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1`, [id]))!);
}

const tracking = () => `JT${randomUUID().slice(0, 10).replace(/-/g, '')}`.toUpperCase();
const register = (resident: Actor, station = stationA, now = T0, size: 'S' | 'M' | 'L' = 'S', by = courier) =>
  registerParcel(db, by, { stationId: station.id, trackingNo: tracking(), size, recipient: { memberCode: resident.memberCode! } }, now);

/** A parcel into the home's own door, shut with the parcel inside. */
async function deposit(resident: Actor, station = stationA, now = T0, size: 'S' | 'M' = 'S') {
  const reg = await register(resident, station, now, size);
  const opened = await reserveAndOpen(db, courier, reg.id, key(), now);
  if (opened.kind !== 'OPENING') throw new Error(`No door: ${opened.problem}`);
  await simulateClose(db, courier, reg.id, true, now);
  return { id: reg.id, compartment: opened.compartment };
}

/** The household collects from the door with the app, at the station. */
async function collect(resident: Actor, parcelId: string, station = stationA, now = T0) {
  await openFromApp(db, resident, parcelId, station.code, key(), now);
  await simulateClose(db, resident, parcelId, false, now);
}

/** A second parcel while the home's door is full: the courier takes it to the counter and the guard receives it. */
async function toCounter(resident: Actor, location = counterId, now = T0) {
  const door = await one<{ state: string }>(db, 'SELECT state FROM locker_compartments WHERE home_id = $1', [resident.homeId]);
  if (!door || door.state === 'AVAILABLE') await deposit(resident, stationA, now);
  const reg = await register(resident, stationA, now);
  const result = await reserveAndOpen(db, courier, reg.id, key(), now);
  if (result.kind !== 'NO_DOOR') throw new Error('Expected the door to be full');
  await chooseCounter(db, courier, reg.id, location, now);
  await receiveAtCounter(db, guard, reg.id, now);
  return reg.id;
}

const parcel = (id: string) => one<{
  state: string; compartment_id: string | null; overflow_location_id: string | null; tracking_no: string; deadline_at: Date | null;
  delivery_problem: string | null; last_reminder_at: Date | null; overdue_at: Date | null; call_requested_at: Date | null;
}>(db, 'SELECT state, compartment_id, overflow_location_id, tracking_no, deadline_at, delivery_problem, last_reminder_at, overdue_at, call_requested_at FROM locker_parcels WHERE id = $1', [id]);
const doorOf = (homeId: string) => one<{ id: string; label: string; size: string; state: string; parcel_id: string | null; fault: string | null; station_id: string }>(
  db, 'SELECT id, label, size, state, parcel_id, fault, station_id FROM locker_compartments WHERE home_id = $1', [homeId],
);
const lastTitle = async (userId: string) => (await one<{ title: string }>(db, 'SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]))?.title;
const titlesOf = async (userId: string) => (await db.query<{ title: string }>('SELECT title FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).map((n) => n.title);
const pinOf = async (resident: Actor, id: string, now = T0) => (await myLockerParcels(db, resident, now)).parcels.find((p) => p.id === id)!;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  companyId = (await createCompany(db, w.hq, 'J&T Express')).id;
  // No precincts set: in these tests each bank serves every home.
  stationA = await createStation(db, w.admin, { name: 'Locker A', location: 'Beside the main guardhouse', layout: { S: 40, M: 4 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  stationB = await createStation(db, w.admin, { name: 'Locker B', location: 'Community hall', layout: { S: 6 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  counterId = (await createOverflow(db, w.admin, {
    name: 'Main guardhouse', kind: 'COUNTER', location: 'Main guardhouse, Elmina', openFromHour: 8, openToHour: 22, instructions: 'Show your pickup code and your IC.', capacity: 100, acceptsDeliveries: true,
  })).id;
  courier = await makeCourier([stationA.id, stationB.id]);
  guard = toActor((await one<Parameters<typeof toActor>[0]>(
    db, `INSERT INTO users AS u (email, full_name, role, township_id) VALUES ($1, 'Guard Rahman', 'GUARDHOUSE', $2) RETURNING ${ACTOR_COLUMNS}`, [`guard-${randomUUID().slice(0, 8)}@kita.test`, w.townshipId],
  ))!);
});
afterAll(() => db.close());

describe('Scenario A: a delivery into the home’s own door', () => {
  it('gives the home its own door with its first parcel, confirms only when shut with the parcel inside, and keeps the door for the home', async () => {
    const resident = await makeResident(w);
    const reg = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'JT0001112223', size: 'S', recipient: { memberCode: resident.memberCode! } }, T0);
    expect(reg).toMatchObject({ verified: true, state: 'VERIFIED' });
    const opened = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(opened).toMatchObject({ kind: 'OPENING', size: 'S', command: { status: 'ACKED' } });
    if (opened.kind !== 'OPENING') throw new Error('expected a door');
    expect(await doorOf(resident.homeId!)).toMatchObject({ label: opened.compartment, station_id: stationA.id });
    expect((await parcel(reg.id))!.state).toBe('DEPOSIT_IN_PROGRESS');

    // Closing the door on an empty compartment is not a delivery.
    await simulateClose(db, courier, reg.id, false, T0);
    expect((await parcel(reg.id))!.state).toBe('LOCKER_RESERVED');
    await reserveAndOpen(db, courier, reg.id, key(), T0);
    await simulateClose(db, courier, reg.id, true, T0);
    expect((await parcel(reg.id))!).toMatchObject({ state: 'READY_FOR_COLLECTION', deadline_at: null }); // a home's own door has no deadline

    const mine = await pinOf(resident, reg.id);
    expect(mine.pin).toMatch(/^\d{6}$/);
    expect(mine.qr).toMatch(/^SIMELOCKER:/);
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM pickup_credentials WHERE parcel_id = $1 AND pin_lookup LIKE '%' || $2 || '%'`, [reg.id, mine.pin]))!.n).toBe(0); // never stored
    expect(await lastTitle(resident.id)).toBe('Your parcel from J&T Express is in your locker');
    expect((await myLockerParcels(db, resident, T0)).door).toMatchObject({ label: opened.compartment, station: 'Locker A' });

    // Collect with the PIN at the keypad: only this door opens, and only shutting it empty completes it.
    const pickup = await pickupAtStation(db, stationA.id, mine.pin!, DEVICE, key(), at(0.1));
    expect(pickup.compartment).toBe(opened.compartment);
    await simulateClose(db, resident, reg.id, true, at(0.1));
    expect((await parcel(reg.id))!.state).toBe('READY_FOR_COLLECTION'); // still inside
    await pickupAtStation(db, stationA.id, mine.qr!, DEVICE, key(), at(0.11));
    await simulateClose(db, resident, reg.id, false, at(0.12));
    expect((await parcel(reg.id))!.state).toBe('COLLECTED');
    // The door is empty again, and still the home's.
    expect(await doorOf(resident.homeId!)).toMatchObject({ label: opened.compartment, state: 'AVAILABLE', parcel_id: null });
    // The credential is spent.
    await expect(pickupAtStation(db, stationA.id, mine.pin!, DEVICE, key(), at(0.2))).rejects.toMatchObject({ code: 'PICKUP_CODE' });

    // The home's next parcel, even for someone else in the home, goes into the same door.
    const housemate = await makeResident(w, { homeId: resident.homeId! });
    const next = await deposit(housemate, stationA, at(0.3));
    expect(next.compartment).toBe(opened.compartment);
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

describe('Scenario B: the parcel cannot go into the home’s door', () => {
  it('a door that already holds a parcel: the courier is told why, the guard receives it at the counter, and the household learns why', async () => {
    const resident = await makeResident(w);
    await deposit(resident);
    const reg = await register(resident);
    const result = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(result).toMatchObject({ kind: 'NO_DOOR', problem: 'DOOR_FULL' });
    if (result.kind !== 'NO_DOOR') throw new Error('expected NO_DOOR');
    expect(result.counters).toContainEqual(expect.objectContaining({ id: counterId, name: 'Main guardhouse', open: true }));
    expect((await parcel(reg.id))!).toMatchObject({ state: 'VERIFIED', compartment_id: null, delivery_problem: 'DOOR_FULL' }); // nothing moved by itself

    // After 10pm the counter is closed: the courier keeps the parcel for the next round.
    await expect(chooseCounter(db, courier, reg.id, counterId, hours(11))).rejects.toMatchObject({ code: 'COUNTER_CLOSED' });
    expect(await listOverflow(db, w.staff, hours(11))).toContainEqual(expect.objectContaining({ id: counterId, open: false, hours: 'Open daily, 8:00 am – 10:00 pm' }));

    // During opening hours it goes to the counter; it is delivered only when the guard receives it.
    await chooseCounter(db, courier, reg.id, counterId, T0);
    expect((await parcel(reg.id))!.state).toBe('VERIFIED');
    expect(await listCounterDeliveries(db, guard)).toContainEqual(expect.objectContaining({ id: reg.id, location_id: counterId, reason: 'The door already has something inside' }));
    expect(await listOverflow(db, guard, T0)).toContainEqual(expect.objectContaining({ id: counterId, incoming: 1, open: true }));
    await receiveAtCounter(db, guard, reg.id, T0);
    expect((await parcel(reg.id))!).toMatchObject({ state: 'RELOCATED_TO_STORAGE', overflow_location_id: counterId });
    expect((await listCounterDeliveries(db, guard)).some((row) => row.id === reg.id)).toBe(false);

    const told = await one<{ title: string; body: string }>(db, 'SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(told!.title).toBe('Your parcel is at Main guardhouse');
    expect(told!.body).toContain('Your locker door already had a parcel in it.');
    expect(told!.body).toContain('open 8:00 am to 10:00 pm');
    const mine = await pinOf(resident, reg.id);
    expect(mine).toMatchObject({ compartment: null, counter: { name: 'Main guardhouse', open: true }, reason: 'Your locker door already had a parcel in it.', days: 0, overdue: false });
    // A counter with parcels waiting cannot be closed for good.
    await expect(setOverflowActive(db, w.admin, counterId, false)).rejects.toMatchObject({ code: 'STORAGE_IN_USE' });
  });

  it('a parcel too big for the door: after hours the courier keeps it, and the household hears it comes on the next round', async () => {
    const resident = await makeResident(w);
    const first = await deposit(resident); // the home's door is size S
    await collect(resident, first.id);
    const big = await register(resident, stationA, hours(11), 'M');
    expect(await reserveAndOpen(db, courier, big.id, key(), hours(11))).toMatchObject({ kind: 'NO_DOOR', problem: 'TOO_BIG' });
    await failDelivery(db, courier, big.id, 'Parcel counter closed; bringing it on the next round', hours(11), 'COUNTER_CLOSED');
    expect((await parcel(big.id))!).toMatchObject({ state: 'DELIVERY_FAILED', delivery_problem: 'COUNTER_CLOSED' });
    const told = await one<{ title: string; body: string }>(db, 'SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(told!.title).toBe('Your J&T Express parcel was not delivered today');
    expect(told!.body).toContain('The guardhouse was closed.');
  });

  it('a home whose door is at another locker bank is pointed there', async () => {
    const resident = await makeResident(w);
    const first = await deposit(resident, stationA);
    await collect(resident, first.id);
    const reg = await register(resident, stationB);
    const result = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(result).toMatchObject({ kind: 'NO_DOOR', problem: 'OTHER_STATION', otherStation: { id: stationA.id, name: 'Locker A', allowed: true } });
    await moveToStation(db, courier, reg.id, stationA.id, T0);
    expect(await reserveAndOpen(db, courier, reg.id, key(), T0)).toMatchObject({ kind: 'OPENING', compartment: first.compartment });
  });

  it('a bank gives doors only to the homes of its own precincts', async () => {
    const west = await createStation(db, w.admin, { name: 'Elmina West Locker C', location: 'Elmina West guardhouse', layout: { M: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true, precincts: ['Elmina West'] });
    const c = await makeCourier([west.id, stationA.id]);
    const elsewhere = await makeResident(w); // Precinct 1
    const reg = await register(elsewhere, west, T0, 'S', c);
    expect(await reserveAndOpen(db, c, reg.id, key(), T0)).toMatchObject({ kind: 'NO_DOOR', problem: 'OTHER_STATION', otherStation: { allowed: true } });
    expect(await doorOf(elsewhere.homeId!)).toBeUndefined();
    const local = await makeResident(w, { homeId: await makeHome(w, 'Jalan Elmina Barat', 'Elmina West') });
    const ok = await register(local, west, T0, 'S', c);
    expect(await reserveAndOpen(db, c, ok.id, key(), T0)).toMatchObject({ kind: 'OPENING', size: 'M' });
    expect((await stationDoors(db, w.staff, west.id)).homes).toEqual({ total: 1, withDoor: 1, withoutDoor: 0 });
  });

  it('the courier says what went wrong: a damaged door is taken out of use and staff are told; "other" needs words', async () => {
    const resident = await makeResident(w);
    const reg = await register(resident);
    const opened = await reserveAndOpen(db, courier, reg.id, key(), T0);
    if (opened.kind !== 'OPENING') throw new Error('expected a door');
    await expect(reportDeliveryProblem(db, courier, reg.id, { reason: 'OTHER', note: '  ' }, T0)).rejects.toMatchObject({ code: 'NOTE_NEEDED' });
    const reported = await reportDeliveryProblem(db, courier, reg.id, { reason: 'DOOR_DAMAGED', note: 'Hinge is broken' }, T0);
    expect(reported.problem).toBe('DOOR_DAMAGED');
    expect(reported.counters).toContainEqual(expect.objectContaining({ id: counterId }));
    expect((await parcel(reg.id))!).toMatchObject({ state: 'VERIFIED', compartment_id: null, delivery_problem: 'DOOR_DAMAGED' });
    const door = (await doorOf(resident.homeId!))!;
    expect(door).toMatchObject({ label: opened.compartment, state: 'FAULTY', parcel_id: null });
    expect(door.fault).toContain('Hinge is broken');
    expect(await titlesOf(w.staff.id)).toContain(`Check door ${opened.compartment} at Locker A`);
    // The door stays out of use until staff look at it.
    expect(await reserveAndOpen(db, courier, reg.id, key(), T0)).toMatchObject({ kind: 'NO_DOOR', problem: 'DOOR_DAMAGED' });
    // Another courier cannot report on this parcel.
    await expect(reportDeliveryProblem(db, await makeCourier([stationA.id]), reg.id, { reason: 'TOO_BIG' }, T0)).rejects.toMatchObject({ status: 404 });
  });

  it('a bank with no free door tells staff; an admin frees the door of a home that moved out', async () => {
    const tiny = await createStation(db, w.admin, { name: 'Locker T', location: 'Phase 9', layout: { S: 1 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
    const c = await makeCourier([tiny.id]);
    const movedOut = await makeResident(w);
    const newcomer = await makeResident(w);
    const first = await register(movedOut, tiny, T0, 'S', c);
    await reserveAndOpen(db, c, first.id, key(), T0);
    await simulateClose(db, c, first.id, true, T0);
    const second = await register(newcomer, tiny, T0, 'S', c);
    expect(await reserveAndOpen(db, c, second.id, key(), T0)).toMatchObject({ kind: 'NO_DOOR', problem: 'NO_DOOR' });
    expect(await titlesOf(w.staff.id)).toContain('Locker T has no free door for a new home');

    const doors = await stationDoors(db, w.staff, tiny.id);
    expect(doors.doors).toEqual([expect.objectContaining({ label: 'A01', state: 'OCCUPIED', trackingNo: expect.any(String), house: expect.any(String) })]);
    const doorId = doors.doors[0]!.id;
    await expect(releaseDoor(db, w.staff, doorId, T0)).rejects.toMatchObject({ status: 403 });
    await expect(releaseDoor(db, w.admin, doorId, T0)).rejects.toMatchObject({ code: 'COMPARTMENT_IN_USE' });
    await collect(movedOut, first.id, tiny);
    await releaseDoor(db, w.admin, doorId, T0);
    expect(await doorOf(movedOut.homeId!)).toBeUndefined();
    await expect(releaseDoor(db, w.admin, doorId, T0)).rejects.toMatchObject({ code: 'DOOR_FREE' });
    expect(await reserveAndOpen(db, c, second.id, key(), T0)).toMatchObject({ kind: 'OPENING', compartment: 'A01' });
  });
});

describe('Scenario C: parcels that wait', () => {
  it('a parcel in the home’s own door is never overdue: a gentle reminder after two days, then once a week, never in quiet hours', async () => {
    const resident = await makeResident(w);
    const readyAt = hours(12); // midnight in Kuala Lumpur
    const { id } = await deposit(resident, stationA, readyAt);
    await runExpiry(db, hours(47, readyAt));
    expect((await parcel(id))!.last_reminder_at).toBeNull();
    // Two days later it is 00:30 in Kuala Lumpur: the reminder waits for the end of quiet hours (08:00).
    await runExpiry(db, hours(48.5, readyAt));
    expect((await parcel(id))!.last_reminder_at).toBeNull();
    await runExpiry(db, hours(56.5, readyAt));
    expect((await parcel(id))!.last_reminder_at).toEqual(hours(56.5, readyAt));
    const told = await one<{ title: string; body: string }>(db, 'SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(told).toMatchObject({ title: 'A parcel is waiting in your locker' });
    expect(told!.body).toContain('for 2 days');
    // Once only, then a week later.
    await runExpiry(db, hours(60, readyAt));
    await runExpiry(db, hours(56.5 + 7 * 24 - 1, readyAt));
    expect((await parcel(id))!.last_reminder_at).toEqual(hours(56.5, readyAt));
    await runExpiry(db, hours(56.5 + 7 * 24, readyAt));
    expect((await parcel(id))!).toMatchObject({ state: 'READY_FOR_COLLECTION', last_reminder_at: hours(56.5 + 7 * 24, readyAt), overdue_at: null, deadline_at: null });
    // Expiry never opened the door.
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM locker_commands WHERE parcel_id = $1 AND purpose <> 'DEPOSIT'`, [id]))!.n).toBe(0);
  });

  it('a parcel at the counter is overdue after 7 days, reminded weekly, and guardhouse staff asked to call at 14 days; it is never sent back by itself', async () => {
    const resident = await makeResident(w);
    await db.query('UPDATE users SET phone = $2 WHERE id = $1', [resident.id, '+60123334444']);
    const id = await toCounter(resident);

    await runExpiry(db, at(6.9));
    expect((await parcel(id))!.overdue_at).toBeNull();
    await runExpiry(db, at(7));
    expect((await parcel(id))!).toMatchObject({ state: 'RELOCATED_TO_STORAGE', overdue_at: at(7), last_reminder_at: at(7) });
    const reminder = await one<{ title: string; body: string }>(db, 'SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(reminder!.title).toBe('Reminder: your parcel is waiting at the guardhouse');
    expect(reminder!.body).toContain('for 7 days');
    await runExpiry(db, at(7.1));
    await runExpiry(db, at(13.9));
    expect((await parcel(id))!).toMatchObject({ last_reminder_at: at(7), call_requested_at: null });

    await runExpiry(db, at(14));
    expect((await parcel(id))!).toMatchObject({ state: 'RELOCATED_TO_STORAGE', last_reminder_at: at(14), call_requested_at: at(14) });
    expect(await titlesOf(guard.id)).toContain('Please call a household about a parcel');
    expect(await titlesOf(w.staff.id)).toContain('Please call a household about a parcel');
    expect(await listStoredParcels(db, guard, at(14))).toContainEqual(expect.objectContaining({
      id, days: 14, overdue: true, call_due: true, phone: '+60123334444', reason: 'The door already has something inside', recipient: resident.fullName,
    }));
    const callsDue = (await lockerOverview(db, w.staff, at(14))).overflow.find((o) => o.id === counterId)!.calls_due;
    expect(callsDue).toBeGreaterThanOrEqual(1);

    // The guard calls and notes it: the call is done, and the number is hidden again.
    await expect(addParcelNote(db, guard, id, '   ', at(14.1))).rejects.toMatchObject({ code: 'NOTE_EMPTY' });
    await addParcelNote(db, guard, id, 'Called the household: collecting tomorrow evening.', at(14.1));
    expect(await listStoredParcels(db, guard, at(14.1))).toContainEqual(expect.objectContaining({ id, call_due: false, phone: null, notes: 1, last_note: 'Called the household: collecting tomorrow evening.' }));
    expect(await parcelNotes(db, w.staff, id)).toEqual([expect.objectContaining({ body: 'Called the household: collecting tomorrow evening.', author: 'Guard Rahman', author_role: 'GUARDHOUSE' })]);
    expect((await lockerOverview(db, w.staff, at(14.1))).overflow.find((o) => o.id === counterId)!.calls_due).toBe(callsDue - 1);
    // The household sees how long it has waited.
    expect(await pinOf(resident, id, at(14.1))).toMatchObject({ days: 14, overdue: true });

    // Collected at the counter: the code and ID are checked, and the days it waited stay in its record.
    const code = (await pinOf(resident, id, at(15))).pin!;
    expect(await checkCounterCode(db, guard, counterId, code, at(15))).toMatchObject({ recipient: resident.fullName, days: 15, overdue: true });
    await expect(handOverAtCounter(db, guard, counterId, code, false, at(15))).rejects.toMatchObject({ code: 'ID_NOT_CHECKED' });
    expect(await handOverAtCounter(db, guard, counterId, code, true, at(15))).toEqual({ ok: true, days: 15 });
    expect((await parcel(id))!.state).toBe('COLLECTED');
    expect(await one(db, `SELECT 1 FROM parcel_events WHERE parcel_id = $1 AND reason LIKE '%collected after 15 days, overdue%'`, [id])).toBeTruthy();
    expect((await myLockerParcels(db, resident, at(15))).lateCollections).toContainEqual(expect.objectContaining({ id, days: 15, counter: 'Main guardhouse' }));
    expect((await listStoredParcels(db, guard, at(15))).some((row) => row.id === id)).toBe(false);
    const chain = await db.query<{ from_kind: string; to_kind: string }>('SELECT from_kind, to_kind FROM custody_transfers WHERE parcel_id = $1 ORDER BY id', [id]);
    expect(chain.map((c) => `${c.from_kind}>${c.to_kind}`)).toEqual(['COURIER>OVERFLOW', 'OVERFLOW>RESIDENT']);
    // It was never on its way back to the courier.
    expect(await one(db, `SELECT 1 FROM parcel_events WHERE parcel_id = $1 AND to_state = 'RETURN_PENDING'`, [id])).toBeUndefined();
  });

  it('staff send a parcel back only when asked, and can keep it at the counter before the courier comes', async () => {
    const resident = await makeResident(w);
    const id = await toCounter(resident);
    await expect(startReturn(db, w.staff, id, ' ', T0)).rejects.toMatchObject({ code: 'REASON_NEEDED' });
    await startReturn(db, w.staff, id, 'The household asked: wrong item ordered', T0);
    expect((await parcel(id))!.state).toBe('RETURN_PENDING');
    expect(await lastTitle(resident.id)).toBe('Your parcel is going back to the courier');
    await keepAtCounter(db, w.staff, id, T0);
    expect((await parcel(id))!.state).toBe('RELOCATED_TO_STORAGE');
    await expect(keepAtCounter(db, w.staff, id, T0)).rejects.toMatchObject({ code: 'PARCEL_STATE' });
    await startReturn(db, guard, id, 'The courier asked to take it back', T0);
    await completeReturn(db, w.staff, id, T0);
    expect((await parcel(id))!.state).toBe('RETURNED');
    expect(await lastTitle(resident.id)).toBe('Parcel returned to the courier');
  });

  it('keeps opening hours and room: staff and guardhouse staff hear when a counter is full, and a full counter is not offered', async () => {
    await expect(createOverflow(db, w.admin, { name: 'Backwards counter', kind: 'COUNTER', location: 'Gate', openFromHour: 22, openToHour: 8, instructions: 'Bring your code.', capacity: 5, acceptsDeliveries: true }))
      .rejects.toMatchObject({ code: 'HOURS' });
    const small = (await createOverflow(db, w.admin, { name: 'Small counter', kind: 'COUNTER', location: 'Block B', openFromHour: 9, openToHour: 17, instructions: 'Bring your code and IC.', capacity: 2, acceptsDeliveries: true })).id;
    expect(await listOverflow(db, w.staff, T0)).toContainEqual(expect.objectContaining({ id: small, hours: 'Open daily, 9:00 am – 5:00 pm', open: true }));
    expect(await listOverflow(db, w.staff, hours(6))).toContainEqual(expect.objectContaining({ id: small, open: false })); // 6pm
    await updateOverflow(db, w.admin, small, { openFromHour: 8, openToHour: 22, capacity: 2, instructions: 'Bring your code and IC.' });
    expect(await listOverflow(db, w.staff, hours(6))).toContainEqual(expect.objectContaining({ id: small, open: true }));

    await toCounter(await makeResident(w), small);
    expect((await titlesOf(guard.id)).filter((t) => t.includes('Small counter'))).toEqual([]);
    await toCounter(await makeResident(w), small);
    expect(await titlesOf(guard.id)).toContain('Small counter is full');
    expect(await titlesOf(w.staff.id)).toContain('Small counter is full');
    await expect(updateOverflow(db, w.admin, small, { openFromHour: 8, openToHour: 22, capacity: 1, instructions: 'Bring your code and IC.' })).rejects.toMatchObject({ code: 'CAPACITY_TOO_LOW' });

    const resident = await makeResident(w);
    await deposit(resident);
    const reg = await register(resident);
    const result = await reserveAndOpen(db, courier, reg.id, key(), T0);
    if (result.kind !== 'NO_DOOR') throw new Error('expected NO_DOOR');
    expect(result.counters.map((o) => o.id)).not.toContain(small);
    await expect(chooseCounter(db, courier, reg.id, small, T0)).rejects.toMatchObject({ code: 'OVERFLOW_FULL' });
  });
});

describe('The guardhouse register', () => {
  it('lists parcels left with the guard and locker parcels together, searchable and filtered, each with its history', async () => {
    const shelfOwner = await makeResident(w);
    const shelf = await logParcel(db, guard, { homeId: shelfOwner.homeId!, courier: 'Register Express', shelf: 'Z9', trackingNo: 'REGTEST0001' }, T0);
    const lockerOwner = await makeResident(w);
    const lockerId = await toCounter(lockerOwner);
    const lockerTracking = (await parcel(lockerId))!.tracking_no;

    const one_ = await guardhouseRegister(db, w.staff, { q: 'regtest0001', show: 'ALL' }, T0);
    expect(one_).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(one_.items[0]).toMatchObject({ source: 'SHELF', id: shelf.id, courier: 'Register Express', place: 'Z9', status: 'WAITING', days: 0, overdue: false, callDue: false });
    expect(one_.items[0]!.lastAction).toMatchObject({ text: 'Logged at the guardhouse on shelf Z9' });
    expect((await guardhouseRegister(db, w.staff, { courier: 'Register Express', show: 'ALL' }, T0)).items.map((r) => r.id)).toEqual([shelf.id]);
    const locker = await guardhouseRegister(db, w.staff, { q: lockerTracking, source: 'LOCKER', show: 'WAITING' }, T0);
    expect(locker.items).toEqual([expect.objectContaining({ source: 'LOCKER', id: lockerId, place: 'Main guardhouse', recipient: lockerOwner.fullName, reason: 'Your locker door already had a parcel in it.' })]);
    expect((await guardhouseRegister(db, w.staff, { q: lockerTracking, source: 'SHELF', show: 'ALL' }, T0)).total).toBe(0);
    // Searching a household member's name finds their parcel.
    expect((await guardhouseRegister(db, w.staff, { q: shelfOwner.fullName, show: 'ALL' }, T0)).items.map((r) => r.id)).toContain(shelf.id);
    // Arrival dates are township days.
    expect((await guardhouseRegister(db, w.staff, { q: 'REGTEST0001', from: '2026-11-03', show: 'ALL' }, T0)).total).toBe(0);
    expect((await guardhouseRegister(db, w.staff, { q: 'REGTEST0001', from: '2026-11-02', to: '2026-11-02', show: 'ALL' }, T0)).total).toBe(1);

    // Both kinds follow the same rules: overdue after 7 days.
    await runShelfRules(db, at(7));
    await runExpiry(db, at(7));
    const overdue = await guardhouseRegister(db, w.staff, { show: 'OVERDUE' }, at(7));
    expect(overdue.items.map((r) => r.id)).toEqual(expect.arrayContaining([shelf.id, lockerId]));
    expect((await guardhouseOverview(db, w.staff, at(7))).overdue).toBeGreaterThanOrEqual(2);
    const history = await guardhouseParcel(db, w.staff, 'SHELF', shelf.id, at(7));
    expect(history).toMatchObject({ days: 7, overdue: true });
    expect(history.history.map((h) => h.kind)).toEqual(['LOGGED', 'OVERDUE', 'REMINDER']);

    // One code check for either kind of code.
    const shelfCode = (await myParcels(db, shelfOwner, at(7))).parcels.find((p) => p.id === shelf.id)!.code!;
    expect((await checkGuardhouseCode(db, guard, `KITAPARCEL:${shelfCode}`, at(7))).matches).toEqual([expect.objectContaining({ source: 'SHELF', id: shelf.id, days: 7 })]);
    const pin = (await pinOf(lockerOwner, lockerId, at(7))).pin!;
    expect((await checkGuardhouseCode(db, guard, pin, at(7))).matches).toContainEqual(expect.objectContaining({ source: 'LOCKER', parcelId: lockerId, overdue: true }));
    await expect(checkGuardhouseCode(db, guard, 'SIMELOCKER:nothing-here', at(7))).rejects.toMatchObject({ code: 'PICKUP_CODE' });

    // Another township sees none of it.
    const outsider = await makeWorld(db);
    expect((await guardhouseRegister(db, outsider.staff, { q: 'REGTEST0001', show: 'ALL' }, at(7))).total).toBe(0);
    await expect(guardhouseParcel(db, outsider.staff, 'SHELF', shelf.id, at(7))).rejects.toMatchObject({ status: 404 });
  });
});

describe('Scenario D: hardware failure', () => {
  it('a jammed door frees the reservation, flags the door and never confirms a delivery', async () => {
    const resident = await makeResident(w);
    const comp = (await one<{ id: string }>(db, `SELECT id FROM locker_compartments WHERE station_id = $1 AND size = 'M' AND home_id IS NULL AND state = 'AVAILABLE' ORDER BY label LIMIT 1`, [stationA.id]))!;
    await db.query('UPDATE locker_compartments SET home_id = $2 WHERE id = $1', [comp.id, resident.homeId]); // the home's door, set up in advance
    await simulatorEvent(db, w.staff, stationA.id, { type: 'FAIL_NEXT', compartmentId: comp.id, on: true }, T0);
    const reg = await registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'JTJAM0000001', size: 'M', recipient: { memberCode: resident.memberCode! } }, T0);
    const opened = await reserveAndOpen(db, courier, reg.id, key(), T0);
    expect(opened).toMatchObject({ kind: 'OPENING', command: { status: 'FAILED' } });
    expect((await parcel(reg.id))!).toMatchObject({ state: 'VERIFIED', compartment_id: null });
    expect((await one<{ state: string }>(db, 'SELECT state FROM locker_compartments WHERE id = $1', [comp.id]))!.state).toBe('FAULTY');
    expect((await myLockerParcels(db, resident, T0)).parcels).toHaveLength(0);
  });

  it('a door opened without an unlock alerts staff, the guards and the household at once', async () => {
    const resident = await makeResident(w);
    await deposit(resident);
    const door = (await doorOf(resident.homeId!))!;
    const later = new Date(T0.getTime() + 20 * 60_000);
    expect(await simulatorEvent(db, w.staff, stationA.id, { type: 'DOOR', compartmentId: door.id, door: 'OPEN', itemPresent: true }, later)).toMatchObject({ outcome: 'UNEXPECTED_OPEN' });
    const alert = await one<{ title: string; priority: string }>(db, 'SELECT title, priority FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(alert).toEqual({ title: 'Security alert: your locker door was opened without a code', priority: 'URGENT' });
    expect(await titlesOf(guard.id)).toContain(`Door ${door.label} opened without an unlock`);
    expect(await titlesOf(w.staff.id)).toContain(`Door ${door.label} opened without an unlock`);
    await simulatorEvent(db, w.staff, stationA.id, { type: 'DOOR', compartmentId: door.id, door: 'CLOSED', itemPresent: true }, later);
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

  it('never locks a staffed counter, where the guard checks ID anyway', async () => {
    const counter = await createOverflow(db, w.admin, { name: 'Guardhouse counter', kind: 'COUNTER', location: 'Main gate', openFromHour: 0, openToHour: 24, instructions: 'Bring your code and ID.', capacity: 10, acceptsDeliveries: false });
    for (const m of [0, 20, 40, 60]) {
      for (let i = 0; i < 10; i++) {
        await expect(checkCounterCode(db, guard, counter.id, String(300000 + m * 100 + i), new Date(T0.getTime() + m * 60_000))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
      }
    }
    await expect(checkCounterCode(db, guard, counter.id, '399999', new Date(T0.getTime() + 80 * 60_000))).rejects.toMatchObject({ code: 'PICKUP_CODE' });
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
    expect(await lastTitle(housemate.id)).toBe('New pickup code');
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
    // Staff notes stay inside the township.
    const outsider = await makeWorld(db);
    await expect(addParcelNote(db, outsider.staff, id, 'Not my township', T0)).rejects.toMatchObject({ status: 403 });
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

describe('Policy, dashboard and forecast', () => {
  it('charges no fees and sets no deadline on a home’s own door; only admins change the reminder timings', async () => {
    const resident = await makeResident(w);
    const { id } = await deposit(resident, stationA);
    await expect(extendDeadline(db, resident, id, true, T0)).rejects.toMatchObject({ code: 'NO_DEADLINE' });
    await expect(saveTownshipPolicy(db, w.staff, DEFAULT_POLICY, T0)).rejects.toMatchObject({ status: 403 });
    await expect(saveTownshipPolicy(db, w.admin, { ...DEFAULT_POLICY, counter_call_after_days: 7 }, T0)).rejects.toMatchObject({ code: 'POLICY_ORDER' });
    // Fees and extensions stay off whatever is sent.
    await saveTownshipPolicy(db, w.admin, { ...DEFAULT_POLICY, fee_enabled: true, fee_sen: 200, extensions_enabled: true, door_reminder_hours: 72 }, T0);
    expect(await getTownshipPolicy(db, w.admin)).toMatchObject({ fee_enabled: false, fee_sen: null, extensions_enabled: false, door_reminder_hours: 72, counter_call_after_days: 14 });
    expect((await myLockerParcels(db, resident, T0)).policy).toEqual({ overdueAfterDays: 7, doorReminderHours: 72, callAfterDays: 14 });
    await saveTownshipPolicy(db, w.admin, DEFAULT_POLICY, T0);
    // Collection is never blocked.
    await pickupAtStation(db, stationA.id, (await pinOf(resident, id)).pin!, DEVICE, key(), T0);
  });

  it('counts the dashboard from the compartments themselves, and explains its forecast', async () => {
    const overview = await lockerOverview(db, w.staff, T0);
    for (const s of overview.stations) {
      const real = await one<{ total: number; occupied: number; available: number; assigned: number }>(
        db,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'OCCUPIED')::int AS occupied, count(*) FILTER (WHERE state = 'AVAILABLE')::int AS available,
                count(*) FILTER (WHERE home_id IS NOT NULL)::int AS assigned
           FROM locker_compartments WHERE station_id = $1`,
        [s.id],
      );
      expect({ total: s.total, occupied: s.occupied, available: s.available, assigned: s.assigned }).toEqual(real);
      expect(s.available + s.occupied + s.reserved + s.faulty + s.disabled).toBe(s.total);
    }
    const forecast = await lockerForecast(db, w.staff, T0);
    expect(forecast.stations.length).toBeGreaterThan(0);
    for (const f of forecast.stations) expect(f.method.length).toBeGreaterThan(10);
  });
});
