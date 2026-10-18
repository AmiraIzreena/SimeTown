import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { runIncidentChecks } from '@/server/modules/incidents/checks';
import { verifySupportChannel } from '@/server/modules/incidents/courier-support';
import {
  addIncidentNote, assignIncident, claimIncident, historyIntact, reopenIncident, replyToIncident, requestEscalation, requestInfo, resolveIncident, setIncidentStatus, updateResident,
} from '@/server/modules/incidents/engine';
import { addMinutes, DEFAULT_INCIDENT_POLICY } from '@/server/modules/incidents/policy';
import { incidentBoard, incidentDetail, myReports } from '@/server/modules/incidents/queries';
import { reportProblem, submitCourierTicket } from '@/server/modules/incidents/triage';
import { createStation, simulateClose } from '@/server/modules/lockers/admin';
import { myLockerParcels, pickupAtStation } from '@/server/modules/lockers/collection';
import { DEVICE } from '@/server/modules/lockers/core';
import { applyAsCourier, approveCourier, createCompany } from '@/server/modules/lockers/couriers';
import { registerParcel, reserveAndOpen } from '@/server/modules/lockers/delivery';
import { raiseIncident } from '@/server/modules/lockers/incidents';
import { handOverParcel, logParcel, myParcels, reportParcelProblem } from '@/server/modules/parcels/service';
import { T0, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * The central incident system: courier-first routing, one owner per case,
 * deadlines and escalation that run on their own, resident updates, reopening,
 * and the guarantees that resolving a case never touches a locker or a parcel.
 */

let db: Db;
let w: World;
let other: World;
let station: { id: string; code: string };
let courier: Actor;
let companyId: string;
let aisyah: Actor;
let guard: Actor;
const MIN = 60_000;
const key = () => randomUUID();
const actorOf = async (id: string) => toActor((await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1`, [id]))!);
const caseOf = (reference: string) => one<{ id: string; status: string; owner_id: string | null; priority: string; module: string; parcel_id: string | null; escalated_at: Date | null }>(
  db, 'SELECT id, status, owner_id, priority, module, parcel_id, escalated_at FROM incidents WHERE reference = $1', [reference],
);
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(db, sql, params))!.n;
const notifications = (userId: string, like: string) => count(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title LIKE $2`, [userId, like]);

async function lockerParcel(resident: Actor, at = T0) {
  const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: `JT${randomUUID().slice(0, 10).replace(/-/g, '')}`, size: 'S', recipient: { memberCode: resident.memberCode! } }, at);
  const opened = await reserveAndOpen(db, courier, reg.id, key(), at);
  if (opened.kind !== 'OPENING') throw new Error('no door');
  await simulateClose(db, courier, reg.id, true, at);
  return reg.id;
}

async function collected(resident: Actor) {
  const id = await lockerParcel(resident);
  const pin = (await myLockerParcels(db, resident, T0)).parcels.find((p) => p.id === id)!.pin!;
  await pickupAtStation(db, station.id, pin, DEVICE, key(), T0);
  await simulateClose(db, resident, id, false, T0);
  return id;
}

async function township(reason: 'DOOR_WONT_OPEN' | 'PARCEL_TRAPPED', resident = aisyah) {
  const id = await lockerParcel(resident);
  const r = await reportProblem(db, resident, { context: 'LOCKER_WAITING', reason, lockerParcelId: id }, T0);
  if (r.route !== 'TOWNSHIP') throw new Error(`expected a case, got ${r.route}`);
  return { parcelId: id, reference: r.incident.reference };
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  other = await makeWorld(db);
  station = await createStation(db, w.admin, { name: 'Case Locker', location: 'Gate', layout: { S: 12 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  companyId = (await createCompany(db, w.admin, 'J&T Express')).id;
  const applied = await applyAsCourier(db, { townshipId: w.townshipId, companyId, fullName: 'Faizal', email: 'faizal@cases.test', phone: '+60123456789', password: 'courier-password-1' }, T0);
  await approveCourier(db, w.admin, applied.id, [station.id], T0);
  courier = await actorOf(applied.id);
  aisyah = await makeResident(w);
  const g = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('gate@cases.test', 'Gate Guard', 'GUARD', $1) RETURNING id`, [w.townshipId]);
  guard = { ...w.staff, id: g!.id, role: 'GUARD', fullName: 'Gate Guard', email: 'gate@cases.test' };
});
afterAll(() => db.close());

describe('Courier-first routing', () => {
  it('sends a courier problem to the courier company: no township case, no staff alert', async () => {
    const id = await collected(aisyah);
    const casesBefore = await count('SELECT count(*)::int AS n FROM incidents');
    const r = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'DAMAGED', lockerParcelId: id }, T0);
    expect(r).toMatchObject({ route: 'COURIER', guidance: { company: { name: 'J&T Express', identifiedBy: 'DELIVERY_RECORD' }, support: null, canSubmitTicket: false } });
    expect(await count('SELECT count(*)::int AS n FROM incidents')).toBe(casesBefore);
    expect(await notifications(w.staff.id, '%case%')).toBe(0);
    // The support channel appears only once the township has verified it; nothing is guessed.
    await verifySupportChannel(db, w.admin.id, companyId, { name: 'J&T Express customer service', url: 'https://support.example/jnt' }, T0);
    const again = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'DAMAGED', lockerParcelId: id }, T0);
    expect(again).toMatchObject({ route: 'COURIER', guidance: { support: { verified: true, url: 'https://support.example/jnt' } } });
    expect(await count('SELECT count(*)::int AS n FROM courier_referrals WHERE user_id = $1', [aisyah.id])).toBe(1);
  });

  it('never guesses a courier: an unknown one is chosen by the resident', async () => {
    const r = await reportProblem(db, aisyah, { context: 'NOT_ARRIVED', reason: 'DELAYED', trackingNo: 'JT630000000001' }, T0);
    expect(r.route).toBe('CHOOSE_COURIER');
    const chosen = await reportProblem(db, aisyah, { context: 'NOT_ARRIVED', reason: 'DELAYED', trackingNo: 'JT630000000001', companyId }, T0);
    expect(chosen).toMatchObject({ route: 'COURIER', guidance: { company: { identifiedBy: 'RESIDENT' }, trackingNo: 'JT630000000001' } });
    // A guardhouse parcel's courier counts only when the guard's entry is exactly a known company.
    const homeId = aisyah.homeId!;
    const logged = await logParcel(db, guard, { homeId, courier: 'Some Local Courier', shelf: 'A1', trackingNo: 'LC1234567' }, T0);
    const code = (await myParcels(db, aisyah, T0)).parcels.find((p) => p.id === logged.id)!.code!;
    await handOverParcel(db, guard, logged.id, { code }, T0);
    expect((await reportProblem(db, aisyah, { context: 'GUARD_DONE', reason: 'DAMAGED', guardParcelId: logged.id }, T0)).route).toBe('CHOOSE_COURIER');
    // Already here: the township's records answer before anyone is bothered.
    const parcelId = await lockerParcel(aisyah);
    const tracking = (await one<{ tracking_no: string }>(db, 'SELECT tracking_no FROM locker_parcels WHERE id = $1', [parcelId]))!.tracking_no;
    expect(await reportProblem(db, aisyah, { context: 'NOT_ARRIVED', reason: 'MARKED_DELIVERED', trackingNo: tracking }, T0)).toMatchObject({ route: 'FOUND' });
  });

  it('files locker and gate problems for the township, and checks the records first for a collection dispute', async () => {
    const { reference, parcelId } = await township('DOOR_WONT_OPEN');
    expect(await caseOf(reference)).toMatchObject({ status: 'OPEN', priority: 'HIGH', module: 'LOCKERS', parcel_id: parcelId, owner_id: null });
    expect(await notifications(w.staff.id, 'Urgent case:%')).toBeGreaterThanOrEqual(1);
    expect(await notifications(aisyah.id, 'Report received:%')).toBeGreaterThanOrEqual(1);
    // The same report twice is the same case.
    const dup = await reportProblem(db, aisyah, { context: 'LOCKER_WAITING', reason: 'DOOR_WONT_OPEN', lockerParcelId: parcelId }, T0);
    expect(dup).toMatchObject({ route: 'TOWNSHIP', incident: { reference, created: false } });
    // A collection dispute shows what the locker recorded and asks before opening a case.
    const done = await collected(aisyah);
    const ask = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'NOT_COLLECTED', lockerParcelId: done }, T0);
    expect(ask.route).toBe('CONFIRM');
    expect(ask.route === 'CONFIRM' && ask.evidence.join(' ')).toMatch(/PIN or QR code at the locker’s keypad/);
    const filed = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'NOT_COLLECTED', lockerParcelId: done, confirm: true }, T0);
    expect(filed).toMatchObject({ route: 'TOWNSHIP' });
    const gate = await reportProblem(db, aisyah, { context: 'GATE', reason: 'COURIER_DENIED' }, T0);
    expect(gate.route === 'TOWNSHIP' && (await caseOf(gate.incident.reference))!.module).toBe('GUARDHOUSE');
    // Not sure goes to the triage queue, never to a guess.
    await expect(reportProblem(db, aisyah, { context: 'GATE', reason: 'NOT_SURE' }, T0)).rejects.toMatchObject({ code: 'SAY_WHAT' });
    const unsure = await reportProblem(db, aisyah, { context: 'GATE', reason: 'NOT_SURE', note: 'Something odd at the barrier' }, T0);
    expect(unsure.route).toBe('TOWNSHIP');
    // The guardhouse's own "not me" report becomes a case too.
    const logged = await logParcel(db, guard, { homeId: aisyah.homeId!, courier: 'Pos Laju', shelf: 'B2' }, T0);
    const code = (await myParcels(db, aisyah, T0)).parcels.find((p) => p.id === logged.id)!.code!;
    await handOverParcel(db, guard, logged.id, { code }, T0);
    await reportParcelProblem(db, aisyah, logged.id, 'Not us', T0);
    expect(await count(`SELECT count(*)::int AS n FROM incidents WHERE guard_parcel_id = $1 AND module = 'PARCELS'`, [logged.id])).toBe(1);
    const dispute = (await one<{ id: string }>(db, 'SELECT id FROM incidents WHERE guard_parcel_id = $1', [logged.id]))!;
    const filter = { modules: ['PARCELS'] as const, status: 'ALL' as const, disputedHandovers30d: true };
    const disputedBoard = (at: Date, actor = w.staff) => incidentBoard(db, actor, { ...filter, modules: [...filter.modules] }, at);
    expect((await disputedBoard(T0)).incidents.map((row) => row.id)).toEqual([dispute.id]);
    expect((await disputedBoard(T0, other.staff)).incidents).toEqual([]);
    await claimIncident(db, w.staff, dispute.id, T0);
    await resolveIncident(db, w.staff, dispute.id, { category: 'NO_FAULT_FOUND', outcome: 'A household member confirmed collection.', actionsTaken: 'Checked the handover record with the household.' }, T0);
    expect((await disputedBoard(T0)).incidents.map((row) => row.id)).toEqual([dispute.id]);
    expect((await disputedBoard(new Date(T0.getTime() + 30 * 86_400_000))).incidents).toEqual([]);
  });
});

describe('Ownership, investigation and outcome', () => {
  it('lets only one of two staff take a case, keeps notes internal, and tells the resident the outcome', async () => {
    const { reference, parcelId } = await township('PARCEL_TRAPPED');
    const c = (await caseOf(reference))!;
    const results = await Promise.allSettled([claimIncident(db, w.staff, c.id, T0), claimIncident(db, w.admin, c.id, T0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const owner = (await caseOf(reference))!.owner_id === w.staff.id ? w.staff : w.admin;
    const notOwner = owner === w.staff ? w.admin2 : w.staff;
    if (notOwner === w.staff) await expect(setIncidentStatus(db, w.staff, c.id, { status: 'INVESTIGATING' }, T0)).rejects.toMatchObject({ status: 403 });
    await setIncidentStatus(db, owner, c.id, { status: 'INVESTIGATING' }, T0);
    await addIncidentNote(db, owner, c.id, 'Door A03 jammed on the hinge side; ticket raised with the locker vendor.', T0);
    await requestInfo(db, owner, c.id, 'Is the parcel still visible behind the door?', T0);
    expect((await caseOf(reference))!.status).toBe('AWAITING_EXTERNAL_PARTY');
    await replyToIncident(db, aisyah, reference, 'Yes, I can see it through the gap.', T0);
    expect((await caseOf(reference))!.status).toBe('INVESTIGATING');
    await updateResident(db, owner, c.id, 'A technician is on the way.', T0);
    // An illegal move is refused.
    await expect(setIncidentStatus(db, owner, c.id, { status: 'INVESTIGATING' }, T0)).rejects.toMatchObject({ code: 'CASE_STATE' });
    const before = await one(db, `SELECT state, compartment_id FROM locker_parcels WHERE id = $1`, [parcelId]);
    const commands = await count('SELECT count(*)::int AS n FROM locker_commands');
    const credentials = await count(`SELECT count(*)::int AS n FROM pickup_credentials WHERE parcel_id = $1 AND status = 'ACTIVE'`, [parcelId]);
    await resolveIncident(db, owner, c.id, { category: 'FIXED', outcome: 'The door was repaired. Your PIN works again.', actionsTaken: 'Vendor replaced the latch.' }, T0);
    // Resolving records an outcome only: the parcel, the doors and the codes are untouched.
    expect(await one(db, `SELECT state, compartment_id FROM locker_parcels WHERE id = $1`, [parcelId])).toEqual(before);
    expect(await count('SELECT count(*)::int AS n FROM locker_commands')).toBe(commands);
    expect(await count(`SELECT count(*)::int AS n FROM pickup_credentials WHERE parcel_id = $1 AND status = 'ACTIVE'`, [parcelId])).toBe(credentials);
    // The resident sees the outcome and the updates, never the internal note.
    const mine = (await myReports(db, aisyah, T0)).reports.find((r) => r.reference === reference)!;
    expect(mine).toMatchObject({ status: 'RESOLVED', outcome: 'The door was repaired. Your PIN works again.', canReopen: true });
    expect(JSON.stringify(mine)).not.toContain('hinge side');
    expect(JSON.stringify(mine)).toContain('A technician is on the way.');
    expect(await notifications(aisyah.id, `Report ${reference}:%`)).toBe(1);
    expect(await historyIntact(db, c.id)).toBe(true);
  });

  it('reassigns with a reason, keeps the history, and tells the new owner', async () => {
    const { reference } = await township('DOOR_WONT_OPEN');
    const c = (await caseOf(reference))!;
    await claimIncident(db, w.staff, c.id, T0);
    await expect(assignIncident(db, w.staff, c.id, { ownerId: w.admin2.id, reason: 'Away' }, T0)).rejects.toMatchObject({ status: 403 });
    await expect(assignIncident(db, w.admin, c.id, { ownerId: w.admin2.id }, T0)).rejects.toMatchObject({ code: 'REASON_NEEDED' });
    await assignIncident(db, w.admin, c.id, { ownerId: w.admin2.id, reason: 'Ravi is on leave' }, T0);
    expect((await caseOf(reference))!.owner_id).toBe(w.admin2.id);
    const detail = await incidentDetail(db, w.admin, reference);
    expect(detail.events.some((e) => (e as { kind: string; body: string }).kind === 'REASSIGNED' && (e as { body: string }).body.includes('Ravi is on leave'))).toBe(true);
    expect(await notifications(w.admin2.id, 'Case for you:%')).toBe(1);
    // Other townships' staff cannot see it.
    await expect(incidentDetail(db, other.staff, reference)).rejects.toMatchObject({ status: 404 });
    await expect(claimIncident(db, other.staff, c.id, T0)).rejects.toMatchObject({ status: 404 });
  });

  it('reopens a disputed outcome within the window, back to its owner, with the admins told once', async () => {
    const { reference } = await township('DOOR_WONT_OPEN');
    const c = (await caseOf(reference))!;
    await claimIncident(db, w.staff, c.id, T0);
    await resolveIncident(db, w.staff, c.id, { category: 'NO_FAULT_FOUND', outcome: 'We tested the door and it opened.', actionsTaken: 'Tested twice.' }, T0);
    await reopenIncident(db, aisyah, reference, 'It still does not open with my PIN.', new Date(T0.getTime() + 60 * MIN));
    expect(await caseOf(reference)).toMatchObject({ status: 'REOPENED', owner_id: w.staff.id });
    expect(await count(`SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1 AND reason = 'DISPUTED'`, [c.id])).toBe(1);
    expect(await notifications(w.admin.id, `Escalated:%${reference}%`)).toBe(1);
    await setIncidentStatus(db, w.staff, c.id, { status: 'INVESTIGATING' }, T0);
    await resolveIncident(db, w.staff, c.id, { category: 'FIXED', outcome: 'The keypad was replaced.', actionsTaken: 'Keypad swapped.' }, T0);
    const history = (await incidentDetail(db, w.admin, reference)).events.map((e) => (e as { kind: string }).kind);
    expect(history.filter((k) => k === 'RESOLVED').length).toBeGreaterThanOrEqual(4); // both outcomes kept, staff and resident copies
    await expect(reopenIncident(db, aisyah, reference, 'Again', new Date(T0.getTime() + 9 * 86_400_000))).rejects.toMatchObject({ code: 'TOO_LATE' });
    // The history cannot be rewritten.
    await expect(db.query(`UPDATE incident_events SET body = 'changed' WHERE incident_id = $1`, [c.id])).rejects.toThrow();
  });
});

describe('Deadlines and escalation', () => {
  it('escalates a critical case nobody took, once, and never removes an owner', async () => {
    const r = await raiseIncident(db, { townshipId: w.townshipId, kind: 'DOOR_FORCED', severity: 'HIGH', summary: 'Door B04 opened without an unlock.', stationId: station.id, dedupeKey: `forced:${key()}` }, T0);
    const c = (await one<{ reference: string; priority: string; assign_due_at: Date }>(db, 'SELECT reference, priority, assign_due_at FROM incidents WHERE id = $1', [r.id]))!;
    expect(c.priority).toBe('CRITICAL');
    expect(c.assign_due_at.getTime() - T0.getTime()).toBe(15 * MIN);
    // Critical cases go to the admins at once; the missed assignment deadline escalates again, once only.
    expect(await count(`SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1`, [r.id])).toBe(1);
    const later = new Date(T0.getTime() + 20 * MIN);
    await runIncidentChecks(db, later);
    await runIncidentChecks(db, later);
    await runIncidentChecks(db, new Date(later.getTime() + MIN));
    expect(await count(`SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1 AND reason = 'UNASSIGNED'`, [r.id])).toBe(1);
    expect(await notifications(w.admin.id, `Escalated:%${c.reference}%`)).toBe(2); // critical, then unassigned
    // Past the resolution deadline, with an owner: escalated, and the owner keeps it.
    await claimIncident(db, w.staff, r.id, later);
    await runIncidentChecks(db, new Date(T0.getTime() + 5 * 60 * MIN));
    expect(await count(`SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1 AND reason = 'OVERDUE'`, [r.id])).toBe(1);
    expect((await one<{ owner_id: string }>(db, 'SELECT owner_id FROM incidents WHERE id = $1', [r.id]))!.owner_id).toBe(w.staff.id);
    await requestEscalation(db, w.staff, r.id, 'Needs the vendor and the police.', later);
    expect(await count(`SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1 AND reason = 'STAFF_REQUEST'`, [r.id])).toBe(1);
  });

  it('counts working hours for normal cases and closes resolved cases only after the dispute window', async () => {
    // Friday 5 pm in Kuala Lumpur plus 4 working hours is Monday 12 noon.
    const friday5pm = new Date('2026-11-06T09:00:00Z');
    expect(addMinutes(friday5pm, 4 * 60, { working: true }, DEFAULT_INCIDENT_POLICY, 'Asia/Kuala_Lumpur').toISOString()).toBe('2026-11-09T04:00:00.000Z');
    expect(addMinutes(friday5pm, 4 * 60, { working: true }, { ...DEFAULT_INCIDENT_POLICY, holidays: ['2026-11-09'] }, 'Asia/Kuala_Lumpur').toISOString()).toBe('2026-11-10T04:00:00.000Z');
    const { reference } = await township('DOOR_WONT_OPEN');
    const c = (await caseOf(reference))!;
    await claimIncident(db, w.staff, c.id, T0);
    await resolveIncident(db, w.staff, c.id, { category: 'FIXED', outcome: 'Fixed.', actionsTaken: 'Reset.' }, T0);
    await runIncidentChecks(db, new Date(T0.getTime() + 3 * 86_400_000));
    expect((await caseOf(reference))!.status).toBe('RESOLVED');
    await runIncidentChecks(db, new Date(T0.getTime() + 8 * 86_400_000));
    expect((await caseOf(reference))!.status).toBe('CLOSED');
  });
});

describe('The board', () => {
  it('counts township cases only, not courier referrals, and filters them', async () => {
    const board = await incidentBoard(db, w.admin, {}, T0);
    expect(board.metrics.open).toBeGreaterThan(0);
    expect(board.metrics.courierReferrals30d).toBeGreaterThanOrEqual(1);
    const lockers = await incidentBoard(db, w.admin, { module: 'LOCKERS', owner: 'UNASSIGNED' }, T0);
    expect(lockers.incidents.every((i) => (i as { module: string; owner_id: string | null }).module === 'LOCKERS' && (i as { owner_id: string | null }).owner_id === null)).toBe(true);
    expect((await incidentBoard(db, other.admin, {}, T0)).metrics.open).toBe(0);
  });

  it('files a simulated courier ticket only for a simulated company, labelled as such', async () => {
    const id = await collected(aisyah);
    const r = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'WRONG_CONTENTS', lockerParcelId: id }, T0);
    if (r.route !== 'COURIER') throw new Error('expected a referral');
    await expect(submitCourierTicket(db, aisyah, r.guidance.referralId, T0)).rejects.toMatchObject({ code: 'NO_TICKETS' });
    await db.query(`UPDATE courier_companies SET provider_mode = 'SIMULATED', code = 'JNT' WHERE id = $1`, [companyId]);
    expect(await submitCourierTicket(db, aisyah, r.guidance.referralId, T0)).toMatchObject({ ticketRef: expect.stringMatching(/^SIM-JNT-/), simulated: true });
  });
});
