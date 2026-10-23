import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { one, type Db } from '@/server/db/client';
import { runJob } from '@/server/modules/admin/service';
import { bookCollection, cancelCollection, completeCollection, confirmCollection, createCollector, recyclingStats } from '@/server/modules/kitar/collections';
import { addShelfNote, checkParcelCode, guardParcels, handOverParcel, logParcel, myParcels, parcelStats, reportParcelProblem, returnParcel } from '@/server/modules/parcels/service';
import { createReport, getReport, listReports, myLaporReports, reportStats, setMeToo, similarReports, updateReport } from '@/server/modules/reports/service';
import { myRequests } from '@/server/modules/requests/service';
import { searchGuide } from '@/shared/recycling-guide';
import { T0, at, freshDb, makeHome, makeResident, makeWorld, REPORT_PHOTO, type World } from './helpers';

/** The hackathon brief's PEOPLE and PLANET problems, each against the brief's own test. */

let db: Db;
let w: World;
let guard: Actor;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  const row = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('counter@kita.test', 'Counter Staff', 'GUARDHOUSE', $1) RETURNING id`, [w.townshipId]);
  // The guardhouse parcel counter (gate guards no longer handle parcels).
  guard = { ...w.staff, id: row!.id, role: 'GUARDHOUSE', fullName: 'Counter Staff', email: 'counter@kita.test' };
});
afterAll(() => db.close());

const notificationsOf = (userId: string) => db.query<{ title: string; body: string }>('SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id', [userId]);

describe('One reporting channel: live progress and "Me too"', () => {
  it('lets a neighbour follow a report instead of filing another, without XP or the reporter’s words', async () => {
    const reporter = await makeResident(w);
    const neighbour = await makeResident(w);
    const { id } = await createReport(db, reporter, { photo: REPORT_PHOTO, description: 'Street light not working outside the playground', locationText: 'Jalan Satu playground', zoneId: w.zoneId, category: 'LIGHTING' }, T0);

    const similar = await similarReports(db, neighbour, { text: 'The light at the playground is broken', category: 'LIGHTING', zoneId: w.zoneId }, T0);
    expect(similar.map((s) => s.id)).toContain(id);
    expect(JSON.stringify(similar)).not.toContain('outside the playground'); // never anyone's own words
    // A different type in a different place is not offered.
    expect(await similarReports(db, neighbour, { text: 'Pothole near the mosque', category: 'POTHOLE' }, T0)).toEqual([]);

    await expect(setMeToo(db, reporter, id, true, T0)).rejects.toMatchObject({ code: 'OWN_REPORT' });
    expect(await setMeToo(db, neighbour, id, true, T0)).toEqual({ affected: 2, following: true });
    expect(await setMeToo(db, neighbour, id, true, T0)).toEqual({ affected: 2, following: true }); // twice counts once

    const followed = await listReports(db, neighbour, { limit: 10 }, T0);
    expect(followed.items).toHaveLength(1);
    expect(followed.items[0]).toMatchObject({ id, mine: false, description: null, photo_id: null, affected: 2 });
    expect((await getReport(db, reporter, id, T0)).description).toContain('playground');

    // Staff check it, assign it with a target date: both people hear each step.
    await updateReport(db, w.staff, id, { status: 'IN_PROGRESS' }, T0);
    await updateReport(db, w.staff, id, { assignedTo: 'Lighting contractor', targetDate: '2026-11-05' }, at(0.1));
    const view = await getReport(db, neighbour, id, at(0.1));
    expect(view).toMatchObject({ assigned_to: 'Lighting contractor', target_date: '2026-11-05', late: false });
    expect(view.checked_at).not.toBeNull();
    for (const person of [reporter, neighbour]) {
      const titles = (await notificationsOf(person.id)).map((n) => n.title);
      expect(titles).toContain('Your report is being worked on');
      expect(titles).toContain('Lighting contractor will fix it');
    }
    // Only the reporter earns XP; "Me too" never does.
    const xp = await db.query<{ user_id: string }>(`SELECT user_id FROM xp_events WHERE activity = 'LAPOR_REPORT' AND ref = $1`, [id]);
    expect(xp.map((x) => x.user_id)).toEqual([reporter.id]);

    // After the target date, it is late for everyone.
    expect((await getReport(db, neighbour, id, at(5))).late).toBe(true);
    await expect(updateReport(db, w.staff, id, { targetDate: '2026-10-01' }, at(5))).rejects.toMatchObject({ code: 'TARGET_IN_PAST' });

    const stats = await reportStats(db, w.staff, at(5));
    expect(stats).toMatchObject({ late: 1, duplicatesAvoided: 1 });
    expect(stats.medianHoursToCheck).toBe(0);

    await updateReport(db, w.staff, id, { status: 'RESOLVED' }, at(6));
    await expect(setMeToo(db, await makeResident(w), id, true, at(6))).rejects.toMatchObject({ code: 'REPORT_CLOSED' });
    expect((await reportStats(db, w.staff, at(6))).medianDaysToFix).toBe(6);
  });

  it('lists a resident’s Lapor reports as ongoing or finished, by type, mine or followed, searchable, with matching counts', async () => {
    const me = await makeResident(w);
    const neighbour = await makeResident(w);
    const light = await createReport(db, me, { photo: REPORT_PHOTO, description: 'Street light out by the surau', locationText: 'Jalan Dua', category: 'LIGHTING' }, T0);
    const drain = await createReport(db, me, { photo: REPORT_PHOTO, description: 'Drain 50% blocked with leaves', locationText: 'Bus stop', category: 'DRAINAGE' }, T0);
    const theirs = await createReport(db, neighbour, { photo: REPORT_PHOTO, description: 'Pothole at the junction', locationText: 'Jalan Tiga', category: 'POTHOLE' }, T0);
    await setMeToo(db, me, theirs.id, true, T0);
    await updateReport(db, w.staff, drain.id, { status: 'RESOLVED' }, at(1));

    const ongoing = await myLaporReports(db, me, { view: 'ongoing', limit: 10 }, at(1));
    expect(ongoing.items.map((r) => r.id).sort()).toEqual([light.id, theirs.id].sort());
    expect(ongoing.counts).toEqual({ ongoing: 2, finished: 1, mine: 1, following: 1 });
    expect(ongoing.categories).toMatchObject({ LIGHTING: 1, POTHOLE: 1, DRAINAGE: 0 });

    expect((await myLaporReports(db, me, { view: 'finished', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([drain.id]);
    expect((await myLaporReports(db, me, { view: 'ongoing', who: 'following', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([theirs.id]);
    expect((await myLaporReports(db, me, { view: 'ongoing', category: 'LIGHTING', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([light.id]);
    // Search covers the place too, and % is a literal character.
    expect((await myLaporReports(db, me, { view: 'ongoing', q: 'Jalan Dua', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([light.id]);
    expect((await myLaporReports(db, me, { view: 'finished', q: '50%', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([drain.id]);
    expect((await myLaporReports(db, me, { view: 'ongoing', q: '%', limit: 10 }, at(1))).items).toHaveLength(0);
    // Paging: one at a time, nothing repeated.
    const first = await myLaporReports(db, me, { view: 'ongoing', limit: 1 }, at(1));
    const second = await myLaporReports(db, me, { view: 'ongoing', limit: 1, cursor: first.nextCursor! }, at(1));
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(2);
    // A stranger's report never shows.
    expect((await myLaporReports(db, neighbour, { view: 'ongoing', limit: 10 }, at(1))).items.map((r) => r.id)).toEqual([theirs.id]);
  });
});

describe('Secure parcel collection', () => {
  it('hands a parcel over only against its one-time code, and tells the household', async () => {
    const homeId = await makeHome(w, 'Jalan Parcel');
    const owner = await makeResident(w, { homeId });
    const spouse = await makeResident(w, { homeId });
    const logged = await logParcel(db, guard, { homeId, courier: 'Pos Laju', shelf: 'b3', trackingNo: 'en123my' }, T0);
    expect(logged.notified).toBe(2);
    expect(Object.keys(logged).sort()).toEqual(['house', 'id', 'notified']); // the guard never learns the code

    const mine = await myParcels(db, spouse, T0);
    const code = mine.parcels[0]!.code!;
    expect(code).toMatch(/^\d{6}$/);
    expect(mine.parcels[0]).toMatchObject({ shelf: 'B3', trackingNo: 'EN123MY', status: 'WAITING' });
    expect((await notificationsOf(owner.id)).at(-1)!.body).toContain(code);
    expect(JSON.stringify(await guardParcels(db, guard, T0))).not.toContain(code);

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(checkParcelCode(db, guard, wrong)).rejects.toMatchObject({ status: 404 });
    const checked = await checkParcelCode(db, guard, `KITAPARCEL:${code}`);
    expect(checked).toMatchObject({ id: logged.id, shelf: 'B3', courier: 'Pos Laju' });
    await expect(handOverParcel(db, guard, logged.id, { code: wrong }, at(0.1))).rejects.toMatchObject({ code: 'PARCEL_CODE' });
    await handOverParcel(db, guard, logged.id, { code, collectedBy: 'Cik Aminah' }, at(0.1));
    await expect(handOverParcel(db, guard, logged.id, { code }, at(0.2))).rejects.toMatchObject({ code: 'PARCEL_GONE' });
    await expect(checkParcelCode(db, guard, code)).rejects.toMatchObject({ status: 404 }); // used once, then dead
    expect((await notificationsOf(owner.id)).at(-1)).toMatchObject({ title: 'Parcel from Pos Laju collected' });

    // "Not me": queried the same day, counted as a collection error.
    await reportParcelProblem(db, owner, logged.id, 'Nobody at home collected it', at(0.3));
    await expect(reportParcelProblem(db, spouse, logged.id, undefined, at(0.3))).rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
    const stats = await parcelStats(db, w.staff, at(0.4));
    expect(stats).toMatchObject({ collected30d: 1, problems30d: 1, sameDayPct: 100, errorRatePct: 100 });
    expect(stats.medianHoursToCollect).toBeCloseTo(2.4, 1);
  });

  it('follows the guardhouse rules: overdue at 7 days, reminded weekly, a call at 14 days, never sent back by itself', async () => {
    const homeId = await makeHome(w, 'Jalan Reminder');
    const owner = await makeResident(w, { homeId });
    const { id } = await logParcel(db, guard, { homeId, courier: 'Ninja Van', shelf: 'A1', photo: { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) } }, T0);
    const row = () => one<{ status: string; overdue_at: Date | null; last_reminder_at: Date | null; call_requested_at: Date | null }>(db, 'SELECT status, overdue_at, last_reminder_at, call_requested_at FROM parcels WHERE id = $1', [id]);
    expect(await runJob(db, 'parcel-reminders', at(6.9))).toMatchObject({ overdue: 0, reminders: 0 });
    expect(await runJob(db, 'parcel-reminders', at(7))).toMatchObject({ overdue: 1, reminders: 1 });
    expect((await notificationsOf(owner.id)).at(-1)!.title).toBe('Reminder: your parcel from Ninja Van is waiting at the guardhouse');
    expect(await runJob(db, 'parcel-reminders', at(7.2))).toMatchObject({ reminders: 0 }); // once a week
    expect(await runJob(db, 'parcel-reminders', at(14))).toMatchObject({ reminders: 1, calls: 1 });
    expect(await row()).toMatchObject({ status: 'WAITING', overdue_at: at(7), last_reminder_at: at(14), call_requested_at: at(14) });
    expect((await notificationsOf(guard.id)).map((n) => n.title)).toContain('Please call a household about a parcel');
    expect((await notificationsOf(w.staff.id)).map((n) => n.title)).toContain('Please call a household about a parcel');
    // The household sees how long it has waited.
    expect((await myParcels(db, owner, at(14))).parcels.find((p) => p.id === id)).toMatchObject({ days: 14, overdue: true });

    // A note closes the call; sending back needs a reason; every step is in the history.
    await expect(addShelfNote(db, guard, id, '  ', at(14.1))).rejects.toMatchObject({ code: 'NOTE_EMPTY' });
    await addShelfNote(db, guard, id, 'Called: will collect tonight.', at(14.1));
    await expect(returnParcel(db, guard, id, '', at(14.2))).rejects.toMatchObject({ code: 'REASON_NEEDED' });
    const code = (await myParcels(db, owner, at(15))).parcels.find((p) => p.id === id)!.code!;
    expect(await handOverParcel(db, guard, id, { code }, at(15))).toEqual({ ok: true, days: 15 });
    const history = await db.query<{ kind: string; body: string }>('SELECT kind, body FROM guard_parcel_events WHERE parcel_id = $1 ORDER BY at, id', [id]);
    expect(history.map((h) => h.kind)).toEqual(['LOGGED', 'OVERDUE', 'REMINDER', 'REMINDER', 'CALL_REQUESTED', 'NOTE', 'COLLECTED']);
    expect(history.at(-1)!.body).toContain('collected after 15 days, overdue');

    const photo = (await one<{ photo_id: string }>(db, 'SELECT photo_id FROM parcels WHERE id = $1', [id]))!.photo_id;
    await runJob(db, 'cleanup', at(110));
    expect(await one(db, 'SELECT 1 FROM parcels WHERE id = $1', [id])).toBeUndefined();
    expect(await one(db, 'SELECT 1 FROM uploads WHERE id = $1', [photo])).toBeUndefined();
  });

  it('sends a parcel back only when asked, with the reason recorded and the household told', async () => {
    const homeId = await makeHome(w, 'Jalan Return');
    const owner = await makeResident(w, { homeId });
    const { id } = await logParcel(db, guard, { homeId, courier: 'GDex', shelf: 'D1' }, T0);
    await returnParcel(db, guard, id, 'The household asked: wrong item ordered', at(1));
    expect(await one(db, 'SELECT status, returned_reason FROM parcels WHERE id = $1', [id])).toEqual({ status: 'RETURNED', returned_reason: 'The household asked: wrong item ordered' });
    expect((await notificationsOf(owner.id)).at(-1)!.title).toBe('Parcel from GDex returned to the courier');
    expect(await one(db, `SELECT 1 FROM guard_parcel_events WHERE parcel_id = $1 AND kind = 'RETURNED' AND body LIKE '%wrong item%'`, [id])).toBeTruthy();
  });
});

describe('Recycling guide and collections', () => {
  it('answers in English or Malay', () => {
    expect(searchGuide('minyak')[0]!.id).toBe('cooking-oil');
    expect(searchGuide('pizza')[0]).toMatchObject({ verdict: 'NO' });
    expect(searchGuide('kotak')[0]!.material).toBe('PAPER');
    expect(searchGuide('')).toEqual([]);
  });

  it('books a collector who takes the material, confirms at once with a gate pass for the day, and rewards the weighed total', async () => {
    const resident = await makeResident(w);
    const { id: collectorId } = await createCollector(db, w.admin, { name: 'E-Waste Partner', materials: ['E_WASTE', 'PAPER'], days: 'Tue and Sat mornings' });
    await expect(bookCollection(db, resident, { collectorId, materials: ['GLASS'], items: 'Jars', day: '2026-11-04', slot: 'MORNING' }, T0)).rejects.toMatchObject({ code: 'NOT_ACCEPTED' });
    await expect(bookCollection(db, resident, { collectorId, materials: ['E_WASTE'], items: 'Old laptop', day: '2026-11-02', slot: 'MORNING' }, T0)).rejects.toMatchObject({ code: 'COLLECTION_DAY' });
    const { id, status, passCode } = await bookCollection(db, resident, { collectorId, materials: ['E_WASTE'], items: 'Old laptop and cables', day: '2026-11-04', slot: 'MORNING' }, T0);
    expect(status).toBe('CONFIRMED');
    await expect(bookCollection(db, resident, { collectorId, materials: ['PAPER'], items: 'Boxes', day: '2026-11-04', slot: 'AFTERNOON' }, T0)).rejects.toMatchObject({ code: 'ALREADY_BOOKED' });

    // Confirming by hand is only for requests made before bookings confirmed themselves.
    await expect(confirmCollection(db, w.staff, id, T0)).rejects.toMatchObject({ code: 'COLLECTION_NOT_REQUESTED' });
    const pass = await one<{ type: string; valid_from: Date; valid_until: Date; visitor_name: string }>(db, 'SELECT type, valid_from, valid_until, visitor_name FROM visitor_passes WHERE code = $1', [passCode]);
    expect(pass).toMatchObject({ type: 'CONTRACTOR', visitor_name: 'E-Waste Partner (recycling collection)' });
    expect(pass!.valid_from.toISOString()).toBe('2026-11-03T16:00:00.000Z'); // midnight in Kuala Lumpur
    expect(pass!.valid_until.getTime() - pass!.valid_from.getTime()).toBe(86_400_000);

    const done = await completeCollection(db, w.staff, id, 4200, at(2));
    expect(done.reward?.xp).toBeGreaterThan(0);
    const months = (await recyclingStats(db, w.staff, at(2))).months;
    expect(months.at(-1)!.collectionG).toBe(4200);

    // Cancelling a confirmed collection cancels the collector's pass too.
    const second = await bookCollection(db, resident, { collectorId, materials: ['PAPER'], items: 'Boxes', day: '2026-11-07', slot: 'MORNING' }, at(2));
    await cancelCollection(db, resident, second.id, at(2));
    expect((await one<{ status: string }>(db, 'SELECT status FROM visitor_passes WHERE code = $1', [second.passCode]))!.status).toBe('CANCELLED');
  });
});

describe('My requests', () => {
  it('shows a household everything it is waiting on, in one list', async () => {
    const homeId = await makeHome(w, 'Jalan Inbox');
    const resident = await makeResident(w, { homeId });
    await createReport(db, resident, { photo: REPORT_PHOTO, description: 'Blocked drain by the bus stop', locationText: 'Bus stop', category: 'DRAINAGE' }, T0);
    await logParcel(db, guard, { homeId, courier: 'DHL', shelf: 'C2' }, T0);
    const r = await myRequests(db, resident, T0);
    expect(r.open).toBe(2);
    expect(r.items.map((i) => i.kind).sort()).toEqual(['PARCEL', 'REPORT']);
    expect(r.items.find((i) => i.kind === 'REPORT')).toMatchObject({ step: 'RECEIVED', mine: true });
    expect(JSON.stringify(r)).not.toMatch(/"code"/); // parcel codes stay on the Parcels screen
  });

  it('shows every report step and collections exactly as the database holds them', async () => {
    const homeId = await makeHome(w, 'Jalan Steps');
    const resident = await makeResident(w, { homeId });
    const report = (description: string) => createReport(db, resident, { photo: REPORT_PHOTO, description, locationText: 'Jalan Steps', category: 'OTHER' }, T0);
    await report('Received and not yet checked');
    const checked = await report('Checked by staff only');
    await updateReport(db, w.staff, checked.id, { status: 'IN_PROGRESS' }, T0);
    const late = await report('Assigned, then past its date');
    await updateReport(db, w.staff, late.id, { status: 'IN_PROGRESS', assignedTo: 'Signage contractor', targetDate: '2026-11-03' }, T0);
    const fixed = await report('Fixed already');
    await updateReport(db, w.staff, fixed.id, { status: 'RESOLVED' }, T0);
    const closed = await report('Not for township maintenance');
    await updateReport(db, w.staff, closed.id, { status: 'REJECTED' }, T0);

    const { id: collectorId } = await createCollector(db, w.admin, { name: 'Steps Collector', materials: ['PAPER'], days: 'Fridays' });
    await bookCollection(db, resident, { collectorId, materials: ['PAPER'], items: 'Boxes', day: '2026-11-06', slot: 'MORNING' }, T0);

    const r = await myRequests(db, resident, at(3));
    const steps = r.items.filter((i) => i.kind === 'REPORT').map((i) => [i.step, i.open, i.late]);
    expect(steps).toEqual(expect.arrayContaining([['RECEIVED', true, false], ['CHECKED', true, false], ['ASSIGNED', true, true], ['FIXED', false, false], ['CLOSED', false, false]]));
    expect(r.items.find((i) => i.kind === 'COLLECTION')).toMatchObject({ status: 'CONFIRMED', collector: 'Steps Collector' });
    // The count of open requests is the same as the tables say.
    const fromTables = await one<{ n: number }>(
      db,
      `SELECT (SELECT count(*) FROM reports WHERE reporter_id = $1 AND status IN ('NEW', 'IN_PROGRESS'))
            + (SELECT count(*) FROM recycling_collections WHERE home_id = $2 AND status IN ('REQUESTED', 'CONFIRMED'))
            + (SELECT count(*) FROM parcels WHERE home_id = $2 AND status = 'WAITING') AS n`,
      [resident.id, homeId],
    );
    expect(r.open).toBe(Number(fromTables!.n));
    expect(r.open).toBe(4);
  });
});
