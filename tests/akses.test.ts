import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { one, type Db } from '@/server/db/client';
import { runAccessChecks } from '@/server/modules/akses/automation';
import { createParty, saveRule, updateParty } from '@/server/modules/akses/config';
import { accessHistoryIntact, acknowledgeIncident, assignParty, confirmFix, disputeResolved, overrideIncident, reportIssue, submitResolution, verifyResolution } from '@/server/modules/akses/incidents';
import { deliverDispatches, handlePartyEvent, MAX_ATTEMPTS } from '@/server/modules/akses/integrations';
import { createPlace, inspectPlace, listPlaces, followPlace, suggestPlace, archivePlace } from '@/server/modules/akses/places';
import { accessOverview, myAccessReports, partyWork } from '@/server/modules/akses/queries';
import { isLikelyDuplicate, pickRule, resolveParty, verificationOutcome, DEFAULT_ACCESS_POLICY } from '@/shared/akses';
import { createSession } from '@/server/auth/session';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { T0, at, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * Akses+ accessibility management: reports grouped and routed by rules to the
 * organisation that runs the facility, availability kept apart from
 * verification, fixes verified independently, and reminders, escalations and
 * deliveries that run on their own and survive being repeated.
 */

let db: Db;
let w: World;
let other: World;
let guard: Actor;
let aisyah: Actor;
let ben: Actor;
let chong: Actor;
let ops: { id: string };
let security: { id: string };
let lifts: { id: string };
const HOUR = 3_600_000;
const photo = { mime: 'image/png' as const, bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]) };
const key = () => randomUUID();
const incident = (reference: string) => one<{ id: string; status: string; party_id: string | null; priority: string; confirmed_at: Date | null; report_count: number; reporter_count: number; exception_reason: string | null }>(
  db, 'SELECT id, status, party_id, priority, confirmed_at, report_count, reporter_count, exception_reason FROM access_incidents WHERE reference = $1', [reference],
);
const place = (id: string) => one<{ verification: string; availability: string; archived_at: Date | null }>(db, 'SELECT verification, availability, archived_at FROM access_places WHERE id = $1', [id]);
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(db, sql, params))!.n;
const notes = (userId: string, like: string) => count('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title LIKE $2', [userId, like]);
const asGuard = () => ({ kind: 'USER' as const, actor: guard });
const asStaff = () => ({ kind: 'USER' as const, actor: w.staff });

async function newPlace(kind: 'RAMP' | 'LIFT' | 'OKU_PARKING' | 'STEP_FREE_ROUTE' = 'RAMP', partyId: string | null = ops.id) {
  return (await createPlace(db, w.staff, { name: `Place ${randomUUID().slice(0, 8)}`, kind, location: 'Somewhere in the township', partyId }, T0)).id;
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  other = await makeWorld(db);
  const g = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('guard@akses.test', 'Gate Guard', 'GUARD', $1) RETURNING id`, [w.townshipId]);
  guard = { ...w.staff, id: g!.id, role: 'GUARD', fullName: 'Gate Guard', email: 'guard@akses.test' };
  ops = await createParty(db, w.admin, { name: 'Township Operations', kind: 'TOWNSHIP_OPERATIONS', integration: 'IN_APP' });
  security = await createParty(db, w.admin, { name: 'Security', kind: 'SECURITY', integration: 'IN_APP' });
  lifts = await createParty(db, w.admin, { name: 'LiftCare (simulated)', kind: 'MAINTENANCE_CONTRACTOR', integration: 'SIMULATED' });
  await updateParty(db, w.admin, ops.id, { addMember: w.staff.id });
  await updateParty(db, w.admin, security.id, { addMember: guard.id });
  aisyah = await makeResident(w);
  ben = await makeResident(w);
  chong = await makeResident(w);
});

afterAll(async () => {
  await db.close();
});

describe('rules (pure)', () => {
  it('picks the most specific rule and never guesses a party', () => {
    expect(pickRule([], 'OUT_OF_SERVICE', 'LIFT').priority).toBe('HIGH');
    expect(pickRule([], 'OUT_OF_SERVICE', 'ACCESSIBLE_TOILET').priority).toBe('NORMAL');
    const kindRule = pickRule([], 'PARKING_OBSTRUCTION', 'RAMP');
    expect(resolveParty(kindRule, null, [{ id: 'a', kind: 'SECURITY', active: true }])).toEqual({ partyId: 'a' });
    expect(resolveParty(kindRule, null, [{ id: 'a', kind: 'SECURITY', active: true }, { id: 'b', kind: 'SECURITY', active: true }])).toHaveProperty('exception');
    expect(resolveParty(pickRule([], 'DAMAGED', 'RAMP'), null, [])).toHaveProperty('exception');
  });

  it('never verifies a fix on a photo alone', () => {
    const p = DEFAULT_ACCESS_POLICY;
    expect(verificationOutcome({ priority: 'NORMAL', clear: 0, stillBlocked: 0, telemetry: false }, p)).toBe('PENDING');
    expect(verificationOutcome({ priority: 'NORMAL', clear: 1, stillBlocked: 0, telemetry: false }, p)).toBe('RESOLVED');
    expect(verificationOutcome({ priority: 'HIGH', clear: 1, stillBlocked: 0, telemetry: false }, p)).toBe('PENDING');
    expect(verificationOutcome({ priority: 'HIGH', clear: 5, stillBlocked: 1, telemetry: true }, p)).toBe('DISPUTED');
  });

  it('spots likely duplicate places', () => {
    expect(isLikelyDuplicate({ name: 'Surau Elmina ramp', kind: 'RAMP', location: 'Surau entrance' }, { name: 'Ramp at Surau Elmina', kind: 'RAMP', location: 'Front' })).toBe(true);
    expect(isLikelyDuplicate({ name: 'Surau Elmina ramp', kind: 'RAMP', location: 'x' }, { name: 'Surau Elmina ramp', kind: 'LIFT', location: 'x' })).toBe(false);
    expect(isLikelyDuplicate({ name: 'Clinic ramp', kind: 'RAMP', location: 'Klinik side' }, { name: 'Hall toilet', kind: 'RAMP', location: 'Community hall' })).toBe(false);
  });
});

describe('the workflow', () => {
  it('1, 3, 4: a blocked ramp is triaged and routed to whoever runs it, and the resident is told', async () => {
    const ramp = await newPlace('RAMP');
    await followPlace(db, chong, ramp, true, T0);
    const r = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', description: 'Bins across the ramp', photo, idempotencyKey: key() }, T0);
    expect(r.outcome).toBe('CREATED');
    const i = (await incident(r.reference))!;
    expect(i).toMatchObject({ status: 'ASSIGNED', party_id: ops.id, priority: 'NORMAL' });
    // Reported, not confirmed. The ramp stays verified.
    expect(await place(ramp)).toMatchObject({ verification: 'VERIFIED', availability: 'REPORTED_BLOCKED' });
    expect(await notes(aisyah.id, `Report received: ${r.reference}`)).toBe(1);
    expect(await notes(w.staff.id, 'New accessibility issue:%')).toBeGreaterThanOrEqual(1);
    expect(await notes(chong.id, 'Reported blocked:%')).toBe(1);
    // No admin approved anything, and none was alerted for a routine report.
    expect(await notes(w.admin.id, 'Accessibility escalation:%')).toBe(0);
    const events = await db.query<{ kind: string }>('SELECT kind FROM access_incident_events WHERE incident_id = $1 ORDER BY id', [i.id]);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['REPORTED', 'STATUS', 'ASSIGNED']));
  });

  it('3: a parking obstruction goes to security, a lift outage to the contractor, and an unknown owner to the exception queue', async () => {
    const bays = await newPlace('OKU_PARKING');
    const parking = await reportIssue(db, aisyah, bays, { category: 'PARKING_OBSTRUCTION', idempotencyKey: key() }, T0);
    expect((await incident(parking.reference))!.party_id).toBe(security.id);
    expect((await partyWork(db, guard)).incidents.map((x) => (x as { reference: string }).reference)).toContain(parking.reference);

    const lift = await newPlace('LIFT', lifts.id);
    const out = await reportIssue(db, aisyah, lift, { category: 'OUT_OF_SERVICE', idempotencyKey: key() }, T0);
    expect(await incident(out.reference)).toMatchObject({ party_id: lifts.id, priority: 'HIGH', status: 'ASSIGNED' });
    expect(await count(`SELECT count(*)::int AS n FROM access_dispatches d JOIN access_incidents i ON i.id = d.incident_id WHERE i.reference = $1 AND d.status = 'PENDING'`, [out.reference])).toBe(1);
    // The payload never carries the resident's identity.
    const payload = (await one<{ payload: Record<string, unknown> }>(db, 'SELECT payload FROM access_dispatches d JOIN access_incidents i ON i.id = d.incident_id WHERE i.reference = $1', [out.reference]))!.payload;
    expect(JSON.stringify(payload)).not.toContain(aisyah.fullName);

    const orphan = await newPlace('RAMP', null);
    const unrouted = await reportIssue(db, aisyah, orphan, { category: 'DAMAGED', idempotencyKey: key() }, T0);
    expect(await incident(unrouted.reference)).toMatchObject({ status: 'ESCALATED', party_id: null });
    expect((await incident(unrouted.reference))!.exception_reason).toMatch(/No organisation/);
    expect(await notes(w.admin.id, `Accessibility escalation:%${unrouted.reference}%`)).toBe(1);
    const overview = await accessOverview(db, w.admin, T0);
    expect(overview.attention.map((x) => (x as { reference: string }).reference)).toContain(unrouted.reference);
    // An admin picks the party; the exception clears.
    await assignParty(db, w.admin, (await incident(unrouted.reference))!.id, { partyId: ops.id, reason: 'Township maintains this ramp.' }, T0);
    expect(await incident(unrouted.reference)).toMatchObject({ status: 'ASSIGNED', party_id: ops.id, exception_reason: null });
  });

  it('3: a township rule overrides the default', async () => {
    await saveRule(db, w.admin, { category: 'ROUTE_INACCESSIBLE', placeKind: null, target: 'PARTY', partyId: security.id, priority: 'HIGH' }, T0);
    const path = await newPlace('STEP_FREE_ROUTE');
    const r = await reportIssue(db, aisyah, path, { category: 'ROUTE_INACCESSIBLE', idempotencyKey: key() }, T0);
    expect(await incident(r.reference)).toMatchObject({ party_id: security.id, priority: 'HIGH' });
  });

  it('2: duplicate reports are grouped, repeats are not counted, and enough residents confirm the problem', async () => {
    const ramp = await newPlace('RAMP');
    const k = key();
    const first = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: k }, T0);
    expect((await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: k }, T0)).outcome).toBe('ALREADY_RECEIVED');
    expect((await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0)).outcome).toBe('ALREADY_REPORTED');
    expect(await reportIssue(db, ben, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0)).toEqual({ reference: first.reference, outcome: 'LINKED' });
    expect(await incident(first.reference)).toMatchObject({ report_count: 2, reporter_count: 2, confirmed_at: null });
    expect(await count('SELECT count(*)::int AS n FROM access_incidents WHERE place_id = $1', [ramp])).toBe(1);
    // Notified once as the party, not once per report.
    expect(await notes(w.staff.id, `%${first.reference}%`)).toBe(1);
    await reportIssue(db, chong, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0);
    expect((await incident(first.reference))!.confirmed_at).not.toBeNull();
    expect((await place(ramp))!.availability).toBe('CONFIRMED_BLOCKED');
    // A different problem at the same place is its own incident.
    const other = await reportIssue(db, aisyah, ramp, { category: 'DAMAGED', idempotencyKey: key() }, T0);
    expect(other.reference).not.toBe(first.reference);
  });

  it('5, 6: the party submits a fix with evidence; it closes only after an independent confirmation', async () => {
    const ramp = await newPlace('RAMP');
    await followPlace(db, chong, ramp, true, T0);
    const r = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0);
    const id = (await incident(r.reference))!.id;
    await db.tx((tx) => acknowledgeIncident(tx, asStaff(), id, at(0.01)));
    expect(await place(ramp)).toMatchObject({ availability: 'CONFIRMED_BLOCKED', verification: 'VERIFIED' });
    // A photo is required for this kind of problem.
    await expect(db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Bins moved to the bin store' }, at(0.02)))).rejects.toMatchObject({ code: 'PHOTO_NEEDED' });
    await db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Bins moved to the bin store', photo }, at(0.02)));
    expect((await incident(r.reference))!.status).toBe('VERIFICATION_PENDING');
    expect((await place(ramp))!.availability).toBe('RESOLUTION_PENDING');
    expect(await notes(aisyah.id, `Is it clear now? ${r.reference}`)).toBe(1);
    expect(await notes(chong.id, `Is it clear now? ${r.reference}`)).toBe(1);
    // The person who submitted the fix cannot confirm it (and is not a resident anyway); a resident can, once.
    await confirmFix(db, aisyah, r.reference, { answer: 'CLEAR' }, at(0.05));
    await expect(confirmFix(db, aisyah, r.reference, { answer: 'CLEAR' }, at(0.05))).rejects.toMatchObject({ code: 'NOTHING_TO_CONFIRM' });
    expect((await incident(r.reference))!.status).toBe('RESOLVED');
    expect((await place(ramp))!.availability).toBe('AVAILABLE');
    expect(await notes(aisyah.id, `Fixed and verified: ${r.reference}`)).toBe(1);
    expect(await notes(chong.id, 'Available again:%')).toBe(1);
    expect(await accessHistoryIntact(db, id)).toBe(true);
    const mine = await myAccessReports(db, aisyah);
    expect(mine.find((m) => (m as unknown as { reference: string }).reference === r.reference)).toMatchObject({ status: 'RESOLVED' });
  });

  it('6: a trusted system event (lift back in service) verifies a routine fix; a photo-only high-priority fix waits for two', async () => {
    const lift = await newPlace('LIFT', lifts.id);
    const r = await reportIssue(db, aisyah, lift, { category: 'OUT_OF_SERVICE', idempotencyKey: key() }, T0);
    const id = (await incident(r.reference))!.id;
    await handlePartyEvent(db, lifts.id, { eventId: 'evt-1', reference: r.reference, type: 'ACKNOWLEDGED' }, at(0.01));
    await handlePartyEvent(db, lifts.id, { eventId: 'evt-2', reference: r.reference, type: 'RESOLVED', actionTaken: 'Door sensor replaced', telemetry: true }, at(0.02));
    // HIGH priority: telemetry plus one resident.
    expect((await incident(r.reference))!.status).toBe('VERIFICATION_PENDING');
    await confirmFix(db, ben, r.reference, { answer: 'CLEAR' }, at(0.03));
    expect((await incident(r.reference))!.status).toBe('RESOLVED');
    expect(await accessHistoryIntact(db, id)).toBe(true);
  });

  it('7: a resident disputes a claimed fix, and later reopens a resolved one; repeated disputes escalate', async () => {
    const ramp = await newPlace('RAMP');
    const r = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0);
    const id = (await incident(r.reference))!.id;
    await db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Cleared', photo }, at(0.01)));
    await expect(confirmFix(db, ben, r.reference, { answer: 'STILL_BLOCKED' }, at(0.02))).rejects.toMatchObject({ code: 'NOTE_NEEDED' });
    await confirmFix(db, ben, r.reference, { answer: 'STILL_BLOCKED', note: 'Bins are back' }, at(0.02));
    expect((await incident(r.reference))!.status).toBe('IN_PROGRESS');
    expect((await place(ramp))!.availability).not.toBe('AVAILABLE');
    await db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Cleared again', photo }, at(0.03)));
    await confirmFix(db, ben, r.reference, { answer: 'STILL_BLOCKED', note: 'Still there' }, at(0.04));
    expect((await incident(r.reference))!.status).toBe('ESCALATED');
    expect(await notes(w.admin.id, `Accessibility escalation:%${r.reference}%`)).toBe(1);
    // Staff inspect and accept.
    await db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Bin store moved', photo }, at(0.05)));
    await expect(verifyResolution(db, w.staff, id, { accept: true, note: 'Seen clear on site' }, at(0.06))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await verifyResolution(db, w.admin, id, { accept: true, note: 'Seen clear on site' }, at(0.06));
    expect((await incident(r.reference))!.status).toBe('RESOLVED');
    // Back two days later: the reporter reopens it, and it goes back to the same team.
    await disputeResolved(db, aisyah, r.reference, 'Blocked again this morning', at(2));
    expect(await incident(r.reference)).toMatchObject({ status: 'ASSIGNED', party_id: ops.id });
    expect((await place(ramp))!.availability).toBe('REPORTED_BLOCKED');
    await expect(disputeResolved(db, ben, r.reference, 'Not mine to reopen', at(2))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('8: unacknowledged and overdue incidents remind, then escalate, once each', async () => {
    const ramp = await newPlace('RAMP');
    const r = await reportIssue(db, aisyah, ramp, { category: 'DAMAGED', idempotencyKey: key() }, T0); // HIGH: 2 h to acknowledge
    const id = (await incident(r.reference))!.id;
    await runAccessChecks(db, new Date(T0.getTime() + 2.5 * HOUR), w.townshipId);
    expect(await notes(w.staff.id, `Reminder:%${r.reference}%`)).toBe(1);
    expect((await incident(r.reference))!.status).toBe('ASSIGNED');
    await runAccessChecks(db, new Date(T0.getTime() + 4.5 * HOUR), w.townshipId);
    await runAccessChecks(db, new Date(T0.getTime() + 4.6 * HOUR), w.townshipId);
    expect((await incident(r.reference))!.status).toBe('ESCALATED');
    expect(await count(`SELECT count(*)::int AS n FROM access_escalations WHERE incident_id = $1 AND reason = 'NOT_ACKNOWLEDGED' AND level = 'ESCALATION'`, [id])).toBe(1);
    expect(await notes(w.admin.id, `Accessibility escalation:%${r.reference}%`)).toBe(1);
    // The team can still act on an escalated incident.
    await db.tx((tx) => acknowledgeIncident(tx, asStaff(), id, new Date(T0.getTime() + 5 * HOUR)));
    expect((await incident(r.reference))!.status).toBe('IN_PROGRESS');
    // Past its 24 h target: reminded, and escalated a day after.
    await runAccessChecks(db, at(1.1), w.townshipId);
    await runAccessChecks(db, at(2.2), w.townshipId);
    expect(await count(`SELECT count(*)::int AS n FROM access_escalations WHERE incident_id = $1 AND reason = 'OVERDUE'`, [id])).toBe(2);
    expect((await incident(r.reference))!.status).toBe('ESCALATED');
  });

  it('8: a claimed fix nobody confirms goes to a person; it is never accepted by silence', async () => {
    const ramp = await newPlace('RAMP');
    const r = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0);
    const id = (await incident(r.reference))!.id;
    await db.tx((tx) => submitResolution(tx, asStaff(), id, { actionTaken: 'Cleared', photo }, T0));
    await runAccessChecks(db, at(3), w.townshipId);
    expect((await incident(r.reference))!.status).toBe('ESCALATED');
    expect((await place(ramp))!.availability).toBe('RESOLUTION_PENDING');
  });

  it('9: a verified place stays listed and verified without anyone re-confirming it; inspections are reminded when due', async () => {
    const lift = await newPlace('LIFT', ops.id);
    const before = await count(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title LIKE 'Inspection due:%'`, [w.staff.id]);
    await runAccessChecks(db, at(30), w.townshipId);
    expect(await place(lift)).toMatchObject({ verification: 'VERIFIED', availability: 'AVAILABLE' });
    expect((await listPlaces(db, aisyah)).some((p) => (p as { id: string }).id === lift)).toBe(true);
    await runAccessChecks(db, at(91), w.townshipId);
    await runAccessChecks(db, at(92), w.townshipId);
    expect(await count(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title LIKE 'Inspection due:%'`, [w.staff.id])).toBeGreaterThan(before);
    expect((await place(lift))!.verification).toBe('VERIFIED');
    // A verified place is archived, never deleted, and not while a problem is open.
    const r = await reportIssue(db, aisyah, lift, { category: 'OUT_OF_SERVICE', idempotencyKey: key() }, at(92));
    await expect(archivePlace(db, w.admin, lift, 'Lift replaced', at(92))).rejects.toMatchObject({ code: 'OPEN_INCIDENTS' });
    await overrideIncident(db, w.admin, (await incident(r.reference))!.id, { action: 'RESOLVE', reason: 'Duplicate of a contractor ticket' }, at(92));
    await archivePlace(db, w.admin, lift, 'Lift replaced', at(92));
    expect((await place(lift))!.archived_at).not.toBeNull();
    expect(await count('SELECT count(*)::int AS n FROM access_incidents WHERE place_id = $1', [lift])).toBe(1);
  });

  it('10: a suggested place waits for an inspection, and a likely duplicate is flagged', async () => {
    const s = await suggestPlace(db, ben, { name: 'Clinic side ramp', kind: 'RAMP', location: 'Klinik Elmina, side entrance' }, T0);
    expect(s.possibleDuplicate).toBeNull();
    expect(await place(s.id)).toMatchObject({ verification: 'PENDING_VERIFICATION', availability: 'UNKNOWN' });
    const dup = await suggestPlace(db, chong, { name: 'Ramp at clinic side', kind: 'RAMP', location: 'Klinik Elmina side' }, T0);
    expect(dup.possibleDuplicate?.id).toBe(s.id);
    const overview = await accessOverview(db, w.staff, T0);
    expect(overview.suggestions.map((x) => (x as { id: string }).id)).toEqual(expect.arrayContaining([s.id, dup.id]));
    await inspectPlace(db, w.staff, s.id, { outcome: 'VERIFIED', note: 'Gradient checked' }, at(1));
    expect(await place(s.id)).toMatchObject({ verification: 'VERIFIED', availability: 'AVAILABLE' });
    expect(await count(`SELECT count(*)::int AS n FROM access_inspections WHERE place_id = $1`, [s.id])).toBe(1);
  });

  it('11: residents, other teams and other townships cannot move statuses', async () => {
    const ramp = await newPlace('RAMP');
    const r = await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0);
    const id = (await incident(r.reference))!.id;
    await expect(db.tx((tx) => acknowledgeIncident(tx, { kind: 'USER', actor: aisyah }, id, T0))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(db.tx((tx) => acknowledgeIncident(tx, asGuard(), id, T0))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(db.tx((tx) => acknowledgeIncident(tx, { kind: 'USER', actor: other.admin }, id, T0))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(handlePartyEvent(db, lifts.id, { eventId: key(), reference: r.reference, type: 'ACKNOWLEDGED' }, T0)).resolves.toMatchObject({ applied: false });
    await expect(assignParty(db, w.staff, id, { partyId: security.id, reason: 'Trying to move it' }, T0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(overrideIncident(db, w.staff, id, { action: 'RESOLVE', reason: 'Trying to close it' }, T0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inspectPlace(db, aisyah, ramp, { outcome: 'NOT_VERIFIED', note: 'Not accessible' }, T0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reportIssue(db, other.admin, ramp, { category: 'OBSTRUCTION', idempotencyKey: key() }, T0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Invalid moves are refused even for the team.
    await expect(confirmFix(db, ben, r.reference, { answer: 'CLEAR' }, T0)).rejects.toMatchObject({ code: 'NOTHING_TO_CONFIRM' });
    await expect(disputeResolved(db, aisyah, r.reference, 'It is not resolved yet', T0)).rejects.toMatchObject({ code: 'INCIDENT_STATE' });
    await db.tx((tx) => acknowledgeIncident(tx, asStaff(), id, T0));
    await expect(db.tx((tx) => acknowledgeIncident(tx, asStaff(), id, T0))).rejects.toMatchObject({ code: 'INCIDENT_STATE' });
    // History rows cannot be rewritten.
    await expect(db.query(`UPDATE access_incident_events SET body = 'changed' WHERE incident_id = $1`, [id])).rejects.toThrow();
  });

  it('12: failed deliveries retry without touching the incident; repeated events are applied once', async () => {
    const lift = await newPlace('LIFT', lifts.id);
    await updateParty(db, w.admin, lifts.id, { simulateFailures: 2 });
    const r = await reportIssue(db, aisyah, lift, { category: 'OUT_OF_SERVICE', idempotencyKey: key() }, T0);
    const statusBefore = (await incident(r.reference))!.status;
    const dispatch = () => one<{ status: string; attempts: number; next_attempt_at: Date }>(db, `SELECT d.status, d.attempts, d.next_attempt_at FROM access_dispatches d JOIN access_incidents i ON i.id = d.incident_id WHERE i.reference = $1 AND d.kind = 'ASSIGNMENT'`, [r.reference]);
    await deliverDispatches(db, T0);
    expect(await dispatch()).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect((await incident(r.reference))!.status).toBe(statusBefore);
    await deliverDispatches(db, new Date(T0.getTime() + 3 * 60_000));
    await deliverDispatches(db, new Date(T0.getTime() + 20 * 60_000));
    expect(await dispatch()).toMatchObject({ status: 'SENT', attempts: 3 });
    // Repeats of the same event change nothing.
    const first = await handlePartyEvent(db, lifts.id, { eventId: 'same-event', reference: r.reference, type: 'ACKNOWLEDGED' }, at(0.1));
    const again = await handlePartyEvent(db, lifts.id, { eventId: 'same-event', reference: r.reference, type: 'ACKNOWLEDGED' }, at(0.1));
    expect(first).toMatchObject({ applied: true });
    expect(again).toMatchObject({ applied: true, duplicate: true });
    expect(await count(`SELECT count(*)::int AS n FROM access_incident_events e JOIN access_incidents i ON i.id = e.incident_id WHERE i.reference = $1 AND e.kind = 'ACKNOWLEDGED'`, [r.reference])).toBe(1);
    // A system that never answers: escalated after the last attempt.
    await updateParty(db, w.admin, lifts.id, { simulateFailures: 10 });
    const r2 = await reportIssue(db, ben, await newPlace('LIFT', lifts.id), { category: 'OUT_OF_SERVICE', idempotencyKey: key() }, T0);
    for (let n = 0; n < MAX_ATTEMPTS; n++) await deliverDispatches(db, at(n));
    expect((await incident(r2.reference))!.status).toBe('ESCALATED');
    await updateParty(db, w.admin, lifts.id, { simulateFailures: 0 });
    // Running the clock twice raises nothing new.
    const once = await runAccessChecks(db, at(10), w.townshipId);
    const twice = await runAccessChecks(db, at(10), w.townshipId);
    expect(twice).toMatchObject({ reminders: 0, escalations: 0, verificationStalled: 0 });
    expect(once).toBeTruthy();
  });

  it('keeps reporters anonymous to residents and to the team', async () => {
    const ramp = await newPlace('RAMP');
    await reportIssue(db, aisyah, ramp, { category: 'OBSTRUCTION', description: 'Planks on the ramp', idempotencyKey: key() }, T0);
    const listed = (await listPlaces(db, ben)).find((p) => (p as { id: string }).id === ramp)!;
    expect(JSON.stringify(listed)).not.toContain(aisyah.fullName);
    const work = await partyWork(db, w.staff);
    expect(JSON.stringify(work)).not.toContain(aisyah.fullName);
  });
});

describe('over HTTP', () => {
  const ORIGIN = 'http://kita.test';
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  let handle: (req: Request) => Promise<Response>;
  const call = async (method: string, path: string, as: Actor, form?: FormData) => {
    const headers = new Headers({ cookie: `kita_session=${await createSession(db, as.id, T0)}` });
    if (method !== 'GET') headers.set('origin', ORIGIN);
    const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: form }));
    return { status: res.status, body: (await res.json()) as { data?: Record<string, unknown>; error?: { code: string } } };
  };

  beforeAll(() => {
    handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
  });

  it('takes a multipart report with a photo, opens it by reference on the console, and keeps residents out', async () => {
    const ramp = await newPlace('RAMP');
    const form = new FormData();
    form.set('category', 'OBSTRUCTION');
    form.set('idempotencyKey', key());
    form.set('photo', new File([PNG], 'p.png', { type: 'image/png' }));
    const sent = await call('POST', `/access-places/${ramp}/reports`, aisyah, form);
    expect(sent.status).toBe(200);
    const reference = sent.body.data!.reference as string;
    const detail = await call('GET', `/admin/access/incidents/${reference}`, w.staff);
    expect(detail.status).toBe(200);
    expect((detail.body.data!.reports as { photo_id: string | null }[])[0]!.photo_id).toBeTruthy();
    expect((await call('GET', `/admin/access/incidents/${reference}`, aisyah)).status).toBe(403);
    expect((await call('GET', '/admin/access/overview', aisyah)).status).toBe(403);
    const photoId = (detail.body.data!.reports as { photo_id: string }[])[0]!.photo_id;
    // The report photo is the reporter's and staff's, not another resident's.
    const asOther = await handle(new Request(`${ORIGIN}/api/v1/access-photos/${photoId}`, { headers: { cookie: `kita_session=${await createSession(db, ben.id, T0)}` } }));
    expect(asOther.status).toBe(404);
  });
});
