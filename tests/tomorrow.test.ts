import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { one, type Db } from '@/server/db/client';
import { runJob } from '@/server/modules/admin/service';
import { bookCollection, cancelCollection, completeCollection, confirmCollection, createCollector, recyclingStats } from '@/server/modules/kitar/collections';
import { checkParcelCode, guardParcels, handOverParcel, logParcel, myParcels, parcelStats, reportParcelProblem } from '@/server/modules/parcels/service';
import { edgingTrial, updateTrialTest, DEFAULT_TEST_PLAN } from '@/server/modules/planet/edging';
import { compareMaterials, explainComparison, saveShortlist, listShortlists } from '@/server/modules/planet/materials';
import { createSolarSite, solarSites, updateSolarSite } from '@/server/modules/planet/solar';
import { createReport, getReport, listReports, reportStats, setMeToo, similarReports, updateReport } from '@/server/modules/reports/service';
import { myRequests } from '@/server/modules/requests/service';
import { searchGuide } from '@/shared/recycling-guide';
import { T0, at, freshDb, makeHome, makeResident, makeWorld, type World } from './helpers';

/** The hackathon brief's PEOPLE and PLANET problems, each against the brief's own test. */

let db: Db;
let w: World;
let guard: Actor;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  const row = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('gate@kita.test', 'Gate Guard', 'GUARD', $1) RETURNING id`, [w.townshipId]);
  guard = { ...w.staff, id: row!.id, role: 'GUARD', fullName: 'Gate Guard', email: 'gate@kita.test' };
});
afterAll(() => db.close());

const notificationsOf = (userId: string) => db.query<{ title: string; body: string }>('SELECT title, body FROM notifications WHERE user_id = $1 ORDER BY id', [userId]);

describe('One reporting channel: live progress and "Me too"', () => {
  it('lets a neighbour follow a report instead of filing another, without XP or the reporter’s words', async () => {
    const reporter = await makeResident(w);
    const neighbour = await makeResident(w);
    const { id } = await createReport(db, reporter, { description: 'Street light not working outside the playground', locationText: 'Jalan Satu playground', zoneId: w.zoneId, category: 'LIGHTING' }, T0);

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

  it('reminds once after three days, and deletes old parcels with their photos', async () => {
    const homeId = await makeHome(w, 'Jalan Reminder');
    const owner = await makeResident(w, { homeId });
    const { id } = await logParcel(db, guard, { homeId, courier: 'Ninja Van', shelf: 'A1', photo: { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) } }, T0);
    expect(await runJob(db, 'parcel-reminders', at(2))).toMatchObject({ remindersSent: 0 });
    expect(await runJob(db, 'parcel-reminders', at(3.5))).toMatchObject({ remindersSent: 1 });
    expect(await runJob(db, 'parcel-reminders', at(4))).toMatchObject({ remindersSent: 0 });
    expect((await notificationsOf(owner.id)).at(-1)!.title).toBe('Your parcel from Ninja Van is still waiting');

    const code = (await myParcels(db, owner, at(4))).parcels.find((p) => p.id === id)!.code!;
    await handOverParcel(db, guard, id, { code }, at(4));
    const photo = (await one<{ photo_id: string }>(db, 'SELECT photo_id FROM parcels WHERE id = $1', [id]))!.photo_id;
    await runJob(db, 'cleanup', at(100));
    expect(await one(db, 'SELECT 1 FROM parcels WHERE id = $1', [id])).toBeUndefined();
    expect(await one(db, 'SELECT 1 FROM uploads WHERE id = $1', [photo])).toBeUndefined();
  });
});

describe('Recycling guide and collections', () => {
  it('answers in English or Malay', () => {
    expect(searchGuide('minyak')[0]!.id).toBe('cooking-oil');
    expect(searchGuide('pizza')[0]).toMatchObject({ verdict: 'NO' });
    expect(searchGuide('kotak')[0]!.material).toBe('PAPER');
    expect(searchGuide('')).toEqual([]);
  });

  it('books a collector who takes the material, gives them a gate pass for the day, and rewards the weighed total', async () => {
    const resident = await makeResident(w);
    const { id: collectorId } = await createCollector(db, w.admin, { name: 'E-Waste Partner', materials: ['E_WASTE', 'PAPER'], days: 'Tue and Sat mornings' });
    await expect(bookCollection(db, resident, { collectorId, materials: ['GLASS'], items: 'Jars', day: '2026-11-04', slot: 'MORNING' }, T0)).rejects.toMatchObject({ code: 'NOT_ACCEPTED' });
    await expect(bookCollection(db, resident, { collectorId, materials: ['E_WASTE'], items: 'Old laptop', day: '2026-11-02', slot: 'MORNING' }, T0)).rejects.toMatchObject({ code: 'COLLECTION_DAY' });
    const { id } = await bookCollection(db, resident, { collectorId, materials: ['E_WASTE'], items: 'Old laptop and cables', day: '2026-11-04', slot: 'MORNING' }, T0);
    await expect(bookCollection(db, resident, { collectorId, materials: ['PAPER'], items: 'Boxes', day: '2026-11-04', slot: 'AFTERNOON' }, T0)).rejects.toMatchObject({ code: 'ALREADY_BOOKED' });

    const { passCode } = await confirmCollection(db, w.staff, id, T0);
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
    const confirmed = await confirmCollection(db, w.staff, second.id, at(2));
    await cancelCollection(db, resident, second.id, at(2));
    expect((await one<{ status: string }>(db, 'SELECT status FROM visitor_passes WHERE code = $1', [confirmed.passCode]))!.status).toBe('CANCELLED');
  });
});

describe('Solar opportunity mapper', () => {
  it('ranks by output, demand and readiness, flags what is missing, and compares with an expert', async () => {
    const big = await createSolarSite(db, w.admin, { name: 'Community hall roof', kind: 'ROOFTOP', zoneId: w.zoneId, usableM2: 900, orientation: 'FLAT', shading: 'LOW', roofAgeYears: 5, structuralChecked: true, expertRank: 1 });
    await createSolarSite(db, w.admin, { name: 'Car park C', kind: 'CAR_PARK', usableM2: 1200, orientation: 'FLAT', expertRank: 2 });
    await createSolarSite(db, w.admin, { name: 'Guardhouse roof', kind: 'ROOFTOP', usableM2: 40, orientation: 'E', shading: 'HIGH', expertRank: 3 });
    const data = await solarSites(db, w.staff);
    expect(data.sites[0]!.id).toBe(big.id); // ready and checked beats bigger but unchecked
    const carPark = data.sites.find((s) => s.name === 'Car park C')!;
    expect(carPark.annualKwh).toBe(Math.round(1200 * 0.15 * 1200 * 0.85));
    expect(carPark.flags).toEqual(expect.arrayContaining(['Shading survey needed', 'Canopy structure and foundations need an engineering check']));
    expect(data.sites.find((s) => s.name === 'Guardhouse roof')!.flags).toEqual(expect.arrayContaining(['Roof age unknown', 'Small site: may not justify a separate study']));
    expect(data.sites.at(-1)!.name).toBe('Guardhouse roof'); // too small to climb on readiness
    expect(data.agreement).toEqual({ compared: 2, inBoth: 2 });
    await updateSolarSite(db, w.admin, big.id, { expertRank: 9 });
    expect((await solarSites(db, w.staff)).sites.find((s) => s.id === big.id)!.expert_rank).toBe(9);
  });
});

describe('Material comparison and the edging trial', () => {
  it('checks each requirement, flags missing evidence and never invents data', async () => {
    const r = compareMaterials('LANDSCAPE_EDGING', { costRm: 40, lifeYears: 15, uvStable: true });
    const plastic = r.rows.find((x) => x.id === 'edging-plastic')!;
    expect(plastic.checks.find((c) => c.key === 'uvStable')!.verdict).toBe('NO_DATA');
    expect(plastic.missingEvidence).toEqual(expect.arrayContaining(['No Environmental Product Declaration', 'Recycled content claimed without a certificate']));
    const timber = r.rows.find((x) => x.id === 'edging-timber')!;
    expect(timber.checks.find((c) => c.key === 'lifeYears')!.verdict).toBe('FAILS');
    expect(r.rows[0]!.id).toBe('edging-steel'); // meets all, lowest carbon of those that do
    expect(r.rows[0]!.carbonVsBaselinePct).toBe(-25);

    const explained = await explainComparison('LANDSCAPE_EDGING', { costRm: 40, lifeYears: 15, uvStable: true });
    expect(explained.source).toBe('RULES'); // no AI service in tests
    expect(explained.summary).toContain('Galvanised steel edging meets every requirement');
    expect(explained.summary).toContain('sample values');

    await expect(saveShortlist(db, w.staff, { use: 'LANDSCAPE_EDGING', requirements: {}, materialIds: ['paver-clay'], secondsTaken: 60 }, T0)).rejects.toMatchObject({ status: 404 });
    await saveShortlist(db, w.staff, { use: 'LANDSCAPE_EDGING', requirements: { costRm: 40 }, materialIds: ['edging-steel', 'edging-plastic'], secondsTaken: 240 }, T0);
    expect(await listShortlists(db)).toMatchObject({ medianSeconds: 240 });
  });

  it('sets up the test plan once and records results for both strips', async () => {
    const first = await edgingTrial(db, w.staff);
    expect(first.tests).toHaveLength(DEFAULT_TEST_PLAN.length);
    expect((await edgingTrial(db, w.staff)).tests).toHaveLength(DEFAULT_TEST_PLAN.length);
    await updateTrialTest(db, w.staff, first.tests[0]!.id, { status: 'PASSED', resultRecycled: 'No sharp edges', resultConventional: 'One chipped corner' }, T0);
    const after = await edgingTrial(db, w.staff);
    expect(after.counts.PASSED).toBe(1);
    expect(after.tests[0]).toMatchObject({ result_recycled: 'No sharp edges', result_conventional: 'One chipped corner' });
  });
});

describe('My requests', () => {
  it('shows a household everything it is waiting on, in one list', async () => {
    const homeId = await makeHome(w, 'Jalan Inbox');
    const resident = await makeResident(w, { homeId });
    await createReport(db, resident, { description: 'Blocked drain by the bus stop', locationText: 'Bus stop', category: 'DRAINAGE' }, T0);
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
    const report = (description: string) => createReport(db, resident, { description, locationText: 'Jalan Steps', category: 'OTHER' }, T0);
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
    const booked = await bookCollection(db, resident, { collectorId, materials: ['PAPER'], items: 'Boxes', day: '2026-11-06', slot: 'MORNING' }, T0);
    await confirmCollection(db, w.staff, booked.id, T0);

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
