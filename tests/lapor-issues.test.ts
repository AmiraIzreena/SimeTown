import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { type Db } from '@/server/db/client';
import { cleanWording } from '@/server/modules/reports/issue-core';
import { attentionIssues, findIssueMatch, getIssue, getIssuePhoto, setIssueMeToo, similarIssues, townshipIssues, updateIssue } from '@/server/modules/reports/issues';
import { createReport, getReport, myLaporReports } from '@/server/modules/reports/service';
import { checkReportText, hasRudeWords, looksLikeJunk } from '@/server/modules/reports/text-check';
import { T0, at, freshDb, makeResident, makeWorld, type World, REPORT_PHOTO } from './helpers';

/** Lapor issues: the same problem grouped, public only once enough residents are affected, and Needs attention. */

let db: Db;
let w: World;
beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  await db.query('UPDATE program_settings SET issue_public_threshold = 3');
});
afterAll(() => db.close());

const residents = (n: number) => Promise.all(Array.from({ length: n }, () => makeResident(w)));
const notificationsOf = (userId: string) => db.query<{ title: string; link: string | null }>('SELECT title, link FROM notifications WHERE user_id = $1 ORDER BY id', [userId]);

describe('What residents may type', () => {
  it('refuses keyboard mash and rude words, but not real reports or addresses full of numbers', () => {
    for (const junk of ['asdfghjkl', 'aaaaaaa', '!!!!! ???', '12345 678', 'sdfg wxcvb qwerty']) expect(looksLikeJunk(junk)).toBe(true);
    for (const fine of ['Street light not working outside the playground', 'Lampu jalan rosak depan surau', 'Longkang tersumbat, air bertakung']) expect(looksLikeJunk(fine)).toBe(false);
    for (const place of ['U16/171 No 4', 'B-12-3A', 'Jalan Metafasa U16/1N']) expect(looksLikeJunk(place, 'place')).toBe(false);
    expect(checkReportText({ description: 'This is shit, fix it', locationText: 'Jalan Satu' })).toEqual({ description: expect.stringContaining('rude') });
    expect(checkReportText({ description: 'Bodoh punya jalan, lubang besar', locationText: 'Jalan Satu' })).toEqual({ description: expect.stringContaining('rude') });
    expect(checkReportText({ description: 'Wild boar (babi hutan) near the bins at night', locationText: 'Jalan Satu' })).toBeNull();
    expect(checkReportText({ description: 'Pothole on the bend', locationText: 'zzzzzz' })).toEqual({ locationText: expect.any(String) });
  });

  it('also refuses rude short forms and disguised spellings, but not the ordinary words around them', () => {
    for (const rude of ['fk this road', 'wtf lampu ni', 'jalan sh1t', 'f*ck the drain', 'f.u.c.k', 'fuuuuck!', 'b0doh punya kontraktor', 'bgst', 'pkm lubang ni', '$hit everywhere', 'haram jadah betul']) {
      expect(hasRudeWords(rude), rude).toBe(true);
    }
    for (const fine of ['Shuttle stop sign fell over', 'Residential lane lights out', 'Pukul 3 pagi bunyi bising', 'Fikir dulu sebelum potong pokok', 'Block B-12-3A, U16/1N', 'Social hall roof leaking', 'Dickson Road kerb broken', 'Assistance needed at the ramp']) {
      expect(hasRudeWords(fine), fine).toBe(false);
    }
  });

  it('turns a junk report away before anything is saved', async () => {
    const r = await makeResident(w);
    await expect(createReport(db, r, { photo: REPORT_PHOTO, description: 'qwertyuiop', locationText: 'Jalan Satu' }, T0)).rejects.toMatchObject({ status: 400, details: { fields: { description: expect.any(String) } } });
    await expect(findIssueMatch(db, r, { description: 'Lampu rosak', locationText: '!!!' }, T0)).rejects.toMatchObject({ status: 400 });
  });

  it('keeps model-written titles free of phone numbers, emails and rude words', () => {
    const ok = cleanWording({ title: 'Street lights out on Jalan Dua', titleMs: 'Lampu jalan padam di Jalan Dua', summary: 'Call 012-345 6789 or a@b.com about it.', summaryMs: 'Beberapa lampu jalan padam.' });
    expect(ok?.summary).not.toMatch(/\d{3}|@/);
    expect(cleanWording({ title: 'This shit road', titleMs: 'Jalan rosak', summary: 'Road damaged.', summaryMs: 'Jalan rosak.' })).toBeNull();
  });
});

describe('Grouping reports into issues', () => {
  it('offers the matching open issue, joins it on request, and makes it public at the threshold', async () => {
    const [a, b, c, d] = (await residents(4)) as [Actor, Actor, Actor, Actor];
    const first = await createReport(db, a, { photo: REPORT_PHOTO, description: 'Street light not working outside the playground', locationText: 'Jalan Lima playground', zoneId: w.zoneId, category: 'LIGHTING' }, T0);
    expect(first.joined).toBe(false);

    // Below the threshold nobody else sees it, but the reporter does.
    expect((await townshipIssues(db, b, { view: 'open', limit: 50 }, T0)).items.map((i) => i.id)).not.toContain(first.issueId);
    const mine = await myLaporReports(db, a, { view: 'ongoing', who: 'mine', limit: 10 }, T0);
    expect(mine.items[0]).toMatchObject({ issue_id: first.issueId, issue_people: 1, issue_threshold: 3 });

    // A second resident writing about the same light is offered that issue; without a model only a strong match counts.
    const match = await findIssueMatch(db, b, { description: 'The light at the playground is broken', locationText: 'Playground, Jalan Lima', zoneId: w.zoneId, category: 'LIGHTING' }, T0);
    expect(match).toMatchObject({ issue: { id: first.issueId, people: 1 }, alreadyYours: false });
    expect(JSON.stringify(match)).not.toContain('outside the playground'); // never anyone's own words
    // A different problem elsewhere is not offered.
    expect(await findIssueMatch(db, b, { description: 'Pothole near the mosque', locationText: 'Masjid road', category: 'POTHOLE' }, T0)).toBeNull();
    // The reporter is told they already reported it.
    expect(await findIssueMatch(db, a, { description: 'Playground light still broken', locationText: 'Jalan Lima playground', category: 'LIGHTING' }, T0)).toMatchObject({ alreadyYours: true });

    const joined = await createReport(db, b, { photo: REPORT_PHOTO, description: 'The light at the playground is broken', locationText: 'Playground, Jalan Lima', issueId: first.issueId }, at(0.1));
    expect(joined).toMatchObject({ joined: true, issueId: first.issueId, category: 'LIGHTING' });
    await expect(createReport(db, b, { photo: REPORT_PHOTO, description: 'Again, the playground light', locationText: 'Jalan Lima', issueId: first.issueId }, at(0.2))).rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
    // Joining does not tell the township office again; reaching the threshold does, once.
    const staffBefore = (await notificationsOf(w.staff.id)).length;
    await setIssueMeToo(db, c, first.issueId, true, at(0.3));
    expect((await getIssue(db, w.staff, first.issueId)).people).toBe(3);
    const staffAfter = await notificationsOf(w.staff.id);
    expect(staffAfter.slice(staffBefore).map((n) => n.link)).toEqual(['/console/reports?tab=attention']);
    await setIssueMeToo(db, d, first.issueId, true, at(0.3));
    expect((await notificationsOf(w.staff.id)).length).toBe(staffAfter.length);

    // Now public: neighbours see it, with no reporter's words, and can follow it from the live "already reported?" check.
    const around = await townshipIssues(db, d, { view: 'open', limit: 50 }, at(0.4));
    const shown = around.items.find((i) => i.id === first.issueId)!;
    expect(shown).toMatchObject({ category: 'LIGHTING', people: 4, reports: 2, following: true, mine: false });
    expect(JSON.stringify(around.items)).not.toContain('playground');
    expect(around.threshold).toBe(3);
    const similar = await similarIssues(db, (await residents(1))[0]!, { text: 'Playground light at Jalan Lima is out', category: 'LIGHTING', zoneId: w.zoneId }, at(0.4));
    expect(similar.map((i) => i.id)).toContain(first.issueId);
    await expect(setIssueMeToo(db, a, first.issueId, true, at(0.4))).rejects.toMatchObject({ code: 'OWN_REPORT' });
    expect(await setIssueMeToo(db, d, first.issueId, false, at(0.5))).toEqual({ affected: 3, following: false });
  });

  it('lists threshold and urgent issues as Needs attention, and one update reaches every report', async () => {
    const [a, b, c] = (await residents(3)) as [Actor, Actor, Actor];
    const issue = await createReport(db, a, { photo: REPORT_PHOTO, description: 'Blocked drain flooding the road after rain', locationText: 'Jalan Enam drain', category: 'DRAINAGE' }, T0);
    await createReport(db, b, { photo: REPORT_PHOTO, description: 'Drain blocked, water on the road', locationText: 'Jalan Enam', issueId: issue.issueId }, T0);
    await setIssueMeToo(db, c, issue.issueId, true, T0);
    const urgent = await createReport(db, a, { photo: REPORT_PHOTO, description: 'Pokok tumbang across the road, live wire on the ground', locationText: 'Jalan Tujuh' }, T0);
    const quiet = await createReport(db, b, { photo: REPORT_PHOTO, description: 'Faded road markings at the junction', locationText: 'Jalan Lapan', category: 'POTHOLE' }, T0);

    const attention = await attentionIssues(db, w.staff, T0);
    const ids = attention.items.map((i) => i.id);
    expect(ids).toContain(issue.issueId);
    expect(ids).toContain(urgent.issueId); // urgent goes straight in
    expect(ids).not.toContain(quiet.issueId);
    expect(ids.indexOf(urgent.issueId)).toBeLessThan(ids.indexOf(issue.issueId)); // urgent first
    expect(attention.items.find((i) => i.id === issue.issueId)!.members.map((m) => m.description)).toHaveLength(2); // staff see the words
    expect(attention.belowThreshold).toBeGreaterThanOrEqual(1);
    // An urgent issue is not public until it reaches the threshold.
    expect((await townshipIssues(db, c, { view: 'open', limit: 50 }, T0)).items.map((i) => i.id)).not.toContain(urgent.issueId);

    await updateIssue(db, w.staff, issue.issueId, { status: 'IN_PROGRESS', assignedTo: 'Drainage team', targetDate: '2026-11-06', title: 'Blocked drain on Jalan Enam', titleMs: 'Longkang tersumbat di Jalan Enam' }, at(0.1));
    const reports = await db.query<{ status: string; assigned_to: string }>('SELECT status, assigned_to FROM reports WHERE issue_id = $1', [issue.issueId]);
    expect(reports).toEqual([{ status: 'IN_PROGRESS', assigned_to: 'Drainage team' }, { status: 'IN_PROGRESS', assigned_to: 'Drainage team' }]);
    expect(await getIssue(db, w.staff, issue.issueId)).toMatchObject({ title: 'Blocked drain on Jalan Enam', title_source: 'STAFF', status: 'IN_PROGRESS' });
    for (const person of [a, b, c]) expect((await notificationsOf(person.id)).map((n) => n.title)).toContain('Your report is being worked on');

    // A report joining an issue in progress is in progress too, with the same team and date.
    const d = (await residents(1))[0] as Actor;
    const added = await createReport(db, d, { photo: REPORT_PHOTO, description: 'Drain on Jalan Enam overflowing', locationText: 'Jalan Enam', issueId: issue.issueId }, at(0.2));
    expect(await getReport(db, d, added.id, at(0.2))).toMatchObject({ status: 'IN_PROGRESS', assigned_to: 'Drainage team', target_date: '2026-11-06' });

    // Closed with no action: it disappears from neighbours' view at once.
    await updateIssue(db, w.staff, issue.issueId, { status: 'REJECTED', staffNote: 'Duplicate of council works.' }, at(0.3));
    const neighbour = (await residents(1))[0]!;
    for (const view of ['open', 'closed'] as const) {
      expect((await townshipIssues(db, neighbour, { view, limit: 50 }, at(0.3))).items.map((i) => i.id)).not.toContain(issue.issueId);
    }
    await expect(updateIssue(db, w.staff, issue.issueId, { status: 'IN_PROGRESS' }, at(0.4))).rejects.toMatchObject({ code: 'REPORT_CLOSED' });
  });
});

describe('The photo neighbours see', () => {
  const photo = (marker: number) => ({ mime: 'image/jpeg' as const, bytes: Uint8Array.from([0xff, 0xd8, 0xff, marker]) });
  const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

  it('shows the first report’s photo once the problem is public, and lets staff swap or hide it (logged)', async () => {
    const [a, b, c, outsider] = (await residents(4)) as [Actor, Actor, Actor, Actor];
    const first = await createReport(db, a, { photo: photo(1), description: 'Fallen signboard blocking the pavement', locationText: 'Jalan Sembilan corner', category: 'SAFETY' }, T0);
    const second = await createReport(db, b, { photo: photo(2), description: 'Signboard fell onto the pavement', locationText: 'Corner of Jalan Sembilan', issueId: first.issueId }, at(0.1));

    // Not public yet: no neighbour gets the photo; staff do.
    await expect(getIssuePhoto(db, outsider, first.issueId)).rejects.toMatchObject({ status: 404 });
    expect((await getIssuePhoto(db, w.staff, first.issueId)).status).toBe(200);

    await setIssueMeToo(db, c, first.issueId, true, at(0.2));
    const listed = (await townshipIssues(db, outsider, { view: 'open', limit: 50 }, at(0.3))).items.find((i) => i.id === first.issueId)!;
    expect(listed.photo_version).toBe(first.id.slice(0, 8));
    expect(await bytesOf(await getIssuePhoto(db, outsider, first.issueId))).toEqual(photo(1).bytes);

    // Staff pick the second report's photo, then hide the photo altogether.
    await updateIssue(db, w.staff, first.issueId, { photoReportId: second.id }, at(0.4));
    expect(await bytesOf(await getIssuePhoto(db, outsider, first.issueId))).toEqual(photo(2).bytes);
    await updateIssue(db, w.staff, first.issueId, { photoHidden: true }, at(0.5));
    await expect(getIssuePhoto(db, outsider, first.issueId)).rejects.toMatchObject({ status: 404 });
    expect((await townshipIssues(db, outsider, { view: 'open', limit: 50 }, at(0.5))).items.find((i) => i.id === first.issueId)!.photo_version).toBeNull();
    const logged = await db.query<{ detail: { to: { photoHidden: boolean } } }>(`SELECT detail FROM audit_log WHERE action = 'ISSUE_PHOTO' AND entity_id = $1 ORDER BY id`, [first.issueId]);
    expect(logged.map((l) => l.detail.to.photoHidden)).toEqual([false, true]);

    // Only a report in this problem with a photo can be picked.
    const other = await createReport(db, a, { photo: photo(3), description: 'Broken bench by the pond', locationText: 'Taman Sepuluh pond', category: 'OTHER' }, at(0.6));
    await expect(updateIssue(db, w.staff, first.issueId, { photoReportId: other.id }, at(0.7))).rejects.toMatchObject({ code: 'NO_SUCH_PHOTO' });
  });

  it('refuses a report without a photo', async () => {
    const [a] = (await residents(1)) as [Actor];
    await expect(createReport(db, a, { description: 'Overflowing drain by the shops', locationText: 'Jalan Sebelas' } as Parameters<typeof createReport>[2], T0))
      .rejects.toMatchObject({ status: 400, details: { fields: { photo: expect.stringContaining('photo') } } });
  });
});
