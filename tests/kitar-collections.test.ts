import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { runJob } from '@/server/modules/admin/service';
import {
  AUTO_ACCEPT_MAX_G, bookCollection, collectionExceptions, collectionsForStaff, collectorDaySheet, createCollector, listCollectorsForStaff, myCollections,
  reportCollectionWeight, reportCollectorCame, reviewCollection, setCollectorActive,
} from '@/server/modules/kitar/collections';
import { createKiosk } from '@/server/modules/kitar/service';
import { scanPass } from '@/server/modules/tamu/service';
import { T0, at, freshDb, makeHome, makeResident, makeWorld, type World } from './helpers';

/**
 * Booked collections run themselves: confirmed at booking, weighed by the
 * household after a gate scan, closed by the nightly job. Staff see exceptions only.
 * T0 is Monday 2 November 2026, noon in Kuala Lumpur.
 */

let db: Db;
let w: World;
let guard: Actor;
let collectorId: string;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  const row = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('gate@kitar.test', 'Gate Guard', 'GUARD', $1) RETURNING id`, [w.townshipId]);
  guard = { ...w.staff, id: row!.id, role: 'GUARD', fullName: 'Gate Guard', email: 'gate@kitar.test' };
  collectorId = (await createCollector(db, w.admin, { name: 'Green Lorry', materials: ['E_WASTE', 'PAPER', 'ALUMINIUM'], days: 'Weekdays' })).id;
});
afterAll(() => db.close());

const titlesOf = async (userId: string) => (await db.query<{ title: string }>('SELECT title FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).map((n) => n.title);
const bodiesOf = async (userId: string) => (await db.query<{ body: string }>('SELECT body FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).map((n) => n.body);
const collection = (id: string) =>
  one<{ status: string; weight_g: number | null; reported_weight_g: number | null; review_reason: string | null; reviewed_at: Date | null; limit_hit: string | null }>(
    db, 'SELECT status, weight_g, reported_weight_g, review_reason, reviewed_at, limit_hit FROM recycling_collections WHERE id = $1', [id],
  );
const xpEventsFor = async (id: string) => Number((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM xp_events WHERE ref = $1`, [`collection:${id}`]))!.n);

/** A fresh household with a collection booked for Tuesday 3 November. */
async function booked(day = '2026-11-03', resident?: Actor) {
  const who = resident ?? (await makeResident(w));
  const b = await bookCollection(db, who, { collectorId, materials: ['E_WASTE'], items: 'Old cables', day, slot: 'MORNING' }, T0);
  return { resident: who, ...b };
}

describe('Booking', () => {
  it('confirms at once, makes the gate pass in the same step, and tells only the household', async () => {
    const before = await titlesOf(w.staff.id);
    const { resident, id, status, passCode } = await booked();
    expect(status).toBe('CONFIRMED');
    const pass = await one<{ type: string; status: string }>(db, 'SELECT p.type, p.status FROM visitor_passes p JOIN recycling_collections x ON x.pass_id = p.id WHERE x.id = $1', [id]);
    expect(pass).toEqual({ type: 'CONTRACTOR', status: 'ACTIVE' });
    expect(await titlesOf(resident.id)).toContain('Collection booked');
    expect((await bodiesOf(resident.id)).some((b) => b.includes(passCode))).toBe(true);
    // No more "new request" notice to every staff member.
    expect(await titlesOf(w.staff.id)).toEqual(before);
  });
});

describe('The household types the weight', () => {
  it('asks after the gate scan, then credits up to the limit straight away: XP and campaign points only, never offer points (BR23)', async () => {
    const { resident, id, passCode } = await booked();
    // Before the day, there is nothing to weigh yet.
    await expect(reportCollectionWeight(db, resident, id, 5000, T0)).rejects.toMatchObject({ code: 'COLLECTION_NOT_YET' });
    await scanPass(db, guard, passCode, at(1));
    expect(await titlesOf(resident.id)).toContain('How much did they take?');
    const mine = (await myCollections(db, resident, at(1))).find((x) => x.id === id)!;
    expect(mine).toMatchObject({ gate_scanned: true, can_report: true, in_review: false });

    const result = await reportCollectionWeight(db, resident, id, AUTO_ACCEPT_MAX_G, at(1));
    expect(result.status).toBe('COLLECTED');
    expect(result.reward).toMatchObject({ offerPoints: 0 });
    expect(result.reward!.xp).toBeGreaterThan(0);
    expect(await collection(id)).toMatchObject({ status: 'COLLECTED', weight_g: AUTO_ACCEPT_MAX_G, review_reason: null });
    expect(await titlesOf(resident.id)).toContain('Collection recorded');
    await expect(reportCollectionWeight(db, resident, id, 1000, at(1))).rejects.toMatchObject({ code: 'COLLECTION_CLOSED' });
  });

  it('holds a weight sent with no gate scan, credits nothing, and tells staff', async () => {
    const { resident, id } = await booked();
    const result = await reportCollectionWeight(db, resident, id, 3000, at(1));
    expect(result).toEqual({ status: 'IN_REVIEW', reason: 'NO_GATE_SCAN' });
    expect(await collection(id)).toMatchObject({ status: 'CONFIRMED', weight_g: null, reported_weight_g: 3000, review_reason: 'NO_GATE_SCAN' });
    expect(await xpEventsFor(id)).toBe(0);
    expect(await titlesOf(resident.id)).toContain('Collection under review');
    expect(await titlesOf(w.staff.id)).toContain('Collection weight to check');
    await expect(reportCollectionWeight(db, resident, id, 3000, at(1))).rejects.toMatchObject({ code: 'WEIGHT_ALREADY_SENT' });
  });

  it('holds a weight over the limit; staff accept a corrected weight through the same credit step', async () => {
    const { resident, id, passCode } = await booked();
    await scanPass(db, guard, passCode, at(1));
    expect(await reportCollectionWeight(db, resident, id, AUTO_ACCEPT_MAX_G + 1, at(1))).toEqual({ status: 'IN_REVIEW', reason: 'OVER_LIMIT' });
    expect(await xpEventsFor(id)).toBe(0);
    const queue = await collectionExceptions(db, w.staff, at(1));
    expect(queue.reviews.find((r) => r.id === id)).toMatchObject({ review_reason: 'OVER_LIMIT', gate_scanned: true, reported_weight_g: AUTO_ACCEPT_MAX_G + 1 });

    const done = await reviewCollection(db, w.staff, id, { decision: 'ACCEPT', weightG: 15_000 }, at(1));
    expect(done.reward).toMatchObject({ offerPoints: 0 });
    expect(await collection(id)).toMatchObject({ status: 'COLLECTED', weight_g: 15_000 });
    expect((await collection(id))!.reviewed_at).not.toBeNull();
    expect(await xpEventsFor(id)).toBe(1);
    expect(await titlesOf(resident.id)).toContain('Collection review complete');
    expect((await collectionExceptions(db, w.staff, at(1))).reviews.some((r) => r.id === id)).toBe(false);
    await expect(reviewCollection(db, w.staff, id, { decision: 'REJECT' }, at(1))).rejects.toMatchObject({ code: 'NO_OPEN_REVIEW' });
  });

  it('keeps the daily limit (BR6) and records the limit hit', async () => {
    const resident = await makeResident(w);
    const ids: string[] = [];
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      const b = await booked(day, resident);
      await scanPass(db, guard, b.passCode, new Date(`${day}T04:00:00Z`));
      ids.push(b.id);
    }
    // All three weighed on the Thursday: the KITAR_DROPOFF rule allows two a day per person.
    const thursday = new Date('2026-11-05T05:00:00Z');
    for (const id of ids) await reportCollectionWeight(db, resident, id, 1000, thursday);
    expect(await xpEventsFor(ids[2]!)).toBe(0);
    expect(await collection(ids[2]!)).toMatchObject({ status: 'COLLECTED', weight_g: 1000, limit_hit: 'DAILY_LIMIT' });
    expect((await bodiesOf(resident.id)).some((b) => b.includes('reached its recycling reward limit'))).toBe(true);
  });
});

describe('The nightly recycling job', () => {
  it('reminds the day before, marks unscanned past collections missed, closes scanned unweighed ones after 2 days, and is safe to run twice', async () => {
    const reminded = await booked('2026-11-03');
    const unscanned = await booked('2026-11-03');
    const unweighed = await booked('2026-11-03');
    const held = await booked('2026-11-03');
    await runJob(db, 'recycling', T0);
    expect(await titlesOf(reminded.resident.id)).toContain('Collection tomorrow');

    await scanPass(db, guard, unweighed.passCode, at(1));
    await reportCollectionWeight(db, held.resident, held.id, 2000, at(1)); // no gate scan: waits for staff

    // Wednesday night: Tuesday is past.
    const wed = at(2);
    await runJob(db, 'recycling', wed);
    expect((await collection(unscanned.id))!.status).toBe('MISSED');
    expect((await one<{ status: string }>(db, 'SELECT status FROM visitor_passes WHERE code = $1', [unscanned.passCode]))!.status).toBe('CANCELLED');
    expect(await titlesOf(unscanned.resident.id)).toContain('Collection missed');
    expect((await collection(unweighed.id))!.status).toBe('CONFIRMED'); // still time to weigh
    expect(await collection(held.id)).toMatchObject({ status: 'CONFIRMED', review_reason: 'NO_GATE_SCAN' }); // never touched

    // Thursday: two days after, closed with no weight and no points.
    await runJob(db, 'recycling', at(3));
    expect(await collection(unweighed.id)).toMatchObject({ status: 'COLLECTED', weight_g: null });
    expect(await xpEventsFor(unweighed.id)).toBe(0);
    expect(await collection(held.id)).toMatchObject({ status: 'CONFIRMED', review_reason: 'NO_GATE_SCAN' });

    const notices = (await titlesOf(unscanned.resident.id)).length;
    await runJob(db, 'recycling', at(3));
    expect((await titlesOf(unscanned.resident.id)).length).toBe(notices);
  });
});

describe('A missed collection the household disputes', () => {
  it('goes to staff; closing it without points keeps it missed; too late after 7 days', async () => {
    const a = await booked('2026-11-03');
    const late = await booked('2026-11-03');
    await runJob(db, 'recycling', at(2));
    expect((await myCollections(db, a.resident, at(2))).find((x) => x.id === a.id)).toMatchObject({ status: 'MISSED', can_dispute: true });

    await reportCollectorCame(db, a.resident, a.id, at(2));
    expect(await collection(a.id)).toMatchObject({ status: 'MISSED', review_reason: 'COLLECTOR_CAME' });
    expect(await titlesOf(w.staff.id)).toContain('Missed collection disputed');
    await expect(reportCollectorCame(db, a.resident, a.id, at(2))).rejects.toMatchObject({ code: 'ALREADY_REPORTED' });
    // Accepting needs a weight: the household did not send one.
    await expect(reviewCollection(db, w.staff, a.id, { decision: 'ACCEPT' }, at(2))).rejects.toMatchObject({ code: 'WEIGHT_NEEDED' });
    await reviewCollection(db, w.staff, a.id, { decision: 'REJECT' }, at(2));
    expect((await collection(a.id))!.status).toBe('MISSED');
    expect(await xpEventsFor(a.id)).toBe(0);

    await expect(reportCollectorCame(db, late.resident, late.id, at(10))).rejects.toMatchObject({ code: 'DISPUTE_CLOSED' });
  });
});

describe('Flags for staff and HQ', () => {
  it('flags a home with 3 large weights in 30 days, once, to the township and to HQ', async () => {
    const homeId = await makeHome(w, 'Jalan Berat');
    const resident = await makeResident(w, { homeId });
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      const b = await booked(day, resident);
      await scanPass(db, guard, b.passCode, new Date(`${day}T04:00:00Z`));
      await reportCollectionWeight(db, resident, b.id, 40_000, new Date(`${day}T05:00:00Z`));
    }
    const hqBefore = (await titlesOf(w.hq.id)).filter((t) => t === 'Home to check: recycling').length;
    await runJob(db, 'recycling', new Date('2026-11-05T14:00:00Z'));
    await runJob(db, 'recycling', new Date('2026-11-05T15:00:00Z'));
    expect((await titlesOf(w.hq.id)).filter((t) => t === 'Home to check: recycling').length).toBe(hqBefore + 1);
    expect(await titlesOf(w.admin.id)).toContain('Home to check: recycling');
    const queue = await collectionExceptions(db, w.hq, new Date('2026-11-05T15:00:00Z'));
    expect(queue.homes.find((h) => h.home_id === homeId)).toMatchObject({ events: 3 });
  });

  it('flags a collector with 3 misses in 30 days without pausing them', async () => {
    const { id: flaky } = await createCollector(db, w.admin, { name: 'Flaky Van', materials: ['PAPER'], days: 'Mondays' });
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      await bookCollection(db, await makeResident(w), { collectorId: flaky, materials: ['PAPER'], items: 'Boxes', day, slot: 'AFTERNOON' }, T0);
    }
    await runJob(db, 'recycling', at(4));
    expect(await titlesOf(w.hq.id)).toContain('Collector to check');
    expect((await collectionExceptions(db, w.staff, at(4))).collectors.find((c) => c.collector_id === flaky)).toMatchObject({ events: 3 });
    expect((await one<{ active: boolean }>(db, 'SELECT active FROM recycling_collectors WHERE id = $1', [flaky]))!.active).toBe(true);
  });
});

describe("A collector's day list", () => {
  it("lists today's confirmed collections with the gate pass, for this township's staff only", async () => {
    const { id: solo } = await createCollector(db, w.admin, { name: 'Solo Collector', materials: ['ALUMINIUM'], days: 'Tuesdays' });
    const b = await bookCollection(db, await makeResident(w), { collectorId: solo, materials: ['ALUMINIUM'], items: 'Old pots', day: '2026-11-03', slot: 'MORNING' }, T0);
    const sheet = await collectorDaySheet(db, w.staff, solo, at(1));
    expect(sheet).toMatchObject({ collector: 'Solo Collector', day: '2026-11-03' });
    expect(sheet.collections).toHaveLength(1);
    expect(sheet.collections[0]).toMatchObject({ id: b.id, pass_code: b.passCode, items: 'Old pots' });
    expect((await collectorDaySheet(db, w.staff, solo, at(2))).collections).toHaveLength(0);

    const other = await makeWorld(db);
    await expect(collectorDaySheet(db, other.staff, solo, at(1))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Needs attention: confirming old requests, pausing flagged collectors, the summary', () => {
  it('confirms a request left from before bookings confirmed themselves, with its gate pass', async () => {
    const resident = await makeResident(w);
    const row = await one<{ id: string }>(
      db,
      `INSERT INTO recycling_collections (township_id, home_id, user_id, collector_id, materials, items, day, slot, created_at)
       VALUES ($1, $2, $3, $4, ARRAY['PAPER'], 'Old boxes', '2026-11-20', 'MORNING', $5) RETURNING id`,
      [w.townshipId, resident.homeId, resident.id, collectorId, T0],
    );
    const result = await runJob(db, 'recycling', T0);
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    const x = await one<{ status: string; pass_id: string | null }>(db, 'SELECT status, pass_id FROM recycling_collections WHERE id = $1', [row!.id]);
    expect(x!.status).toBe('CONFIRMED');
    expect(x!.pass_id).not.toBeNull();
    expect(await titlesOf(resident.id)).toContain('Collection booked');
  });

  it('drops a collector from the list once staff pause them, and counts what ran by itself', async () => {
    const { id: late } = await createCollector(db, w.admin, { name: 'Late Truck', materials: ['TEXTILE'], days: 'Fridays' });
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      await bookCollection(db, await makeResident(w), { collectorId: late, materials: ['TEXTILE'], items: 'Old clothes', day, slot: 'MORNING' }, T0);
    }
    await runJob(db, 'recycling', at(4));
    const before = await collectionExceptions(db, w.staff, at(4));
    expect(before.collectors.some((c) => c.collector_id === late)).toBe(true);
    expect(before.summary.missed).toBeGreaterThanOrEqual(3);
    expect(before.summary.collected).toBeGreaterThan(before.summary.by_staff); // some were settled with no staff action

    await setCollectorActive(db, w.staff, late, false);
    expect((await collectionExceptions(db, w.staff, at(4))).collectors.some((c) => c.collector_id === late)).toBe(false);
  });
});

describe('SDP HQ across townships', () => {
  it('filters by township, keeps township staff to their own, and adds collectors and kiosks to the township HQ picks', async () => {
    const other = await makeWorld(db);
    // With two townships, HQ must say which one, and now can.
    await expect(createCollector(db, w.hq, { name: 'Nowhere Co', materials: ['PAPER'], days: 'Mondays' })).rejects.toMatchObject({ message: 'Choose a township.' });
    const { id: theirs } = await createCollector(db, w.hq, { name: 'Elsewhere Recyclers', materials: ['PAPER'], days: 'Mondays', townshipId: other.townshipId });
    const kiosk = await createKiosk(db, w.hq, { name: 'Elsewhere Kiosk', location: 'By the hall', townshipId: other.townshipId });
    expect((await one<{ township_id: string }>(db, 'SELECT township_id FROM recycling_collectors WHERE id = $1', [theirs]))!.township_id).toBe(other.townshipId);
    expect((await one<{ township_id: string }>(db, 'SELECT township_id FROM kitar_kiosks WHERE id = $1', [kiosk.id]))!.township_id).toBe(other.townshipId);

    // Every row carries its township; the filter narrows to one.
    const all = (await listCollectorsForStaff(db, w.hq)) as { id: string; township: string }[];
    expect(all.find((c) => c.id === theirs)?.township).toBeTruthy();
    const mine = (await listCollectorsForStaff(db, w.hq, w.townshipId)) as { id: string }[];
    expect(mine.some((c) => c.id === theirs)).toBe(false);
    expect((await collectionsForStaff(db, w.hq, { townshipId: other.townshipId })).length).toBe(0);
    const name = (await one<{ name: string }>(db, 'SELECT name FROM townships WHERE id = $1', [w.townshipId]))!.name;
    const rows = await collectionsForStaff(db, w.hq, { townshipId: w.townshipId });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.township === name)).toBe(true);

    // Township staff cannot look at another township, or add to one.
    await expect(collectionExceptions(db, w.staff, T0, other.townshipId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createCollector(db, w.admin, { name: 'Sneaky', materials: ['PAPER'], days: 'Mondays', townshipId: other.townshipId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Who may set up collectors, kiosks and bins (through the real routes)', () => {
  const handle = (req: Request) => createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle(req);
  async function post(path: string, as: Actor, body: unknown) {
    const headers = new Headers({ origin: 'http://kita.test', 'content-type': 'application/json', cookie: `kita_session=${await createSession(db, as.id, T0)}` });
    const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as { data?: { id?: string }; error?: { message: string } } };
  }
  const collector = (name: string, townshipId?: string) => ({ name, materials: ['PAPER'], schedule: { days: ['MON'], time: 'BOTH' }, ...(townshipId ? { townshipId } : {}) });
  const townshipOfCollector = async (name: string) => (await one<{ township_id: string }>(db, 'SELECT township_id FROM recycling_collectors WHERE name = $1', [name]))?.township_id;

  it('refuses township staff a new collector, with a clear permission error, and adds nothing', async () => {
    const res = await post('/admin/kitar/collectors', w.staff, collector('Staff Collector'));
    expect(res).toMatchObject({ status: 403, body: { error: { message: 'You do not have permission to do this.' } } });
    expect(await townshipOfCollector('Staff Collector')).toBeUndefined();
  });

  it('lets a township admin add one in their own township, and SDP HQ in the township it picks', async () => {
    expect((await post('/admin/kitar/collectors', w.admin, collector('Admin Collector'))).status).toBe(200);
    expect(await townshipOfCollector('Admin Collector')).toBe(w.townshipId);
    expect((await post('/admin/kitar/collectors', w.hq, collector('HQ Collector', w.townshipId))).status).toBe(200);
    expect(await townshipOfCollector('HQ Collector')).toBe(w.townshipId);
  });

  it("refuses another township's admin", async () => {
    const other = await makeWorld(db);
    expect((await post('/admin/kitar/collectors', other.admin, collector('Outsider Collector', w.townshipId))).status).toBe(403);
    expect(await townshipOfCollector('Outsider Collector')).toBeUndefined();
  });

  it('still lets staff pause and resume a collector, and settle the queue', async () => {
    const { id } = await createCollector(db, w.admin, { name: 'Pausable Co', materials: ['PAPER'], days: 'Daily' });
    expect((await post(`/admin/kitar/collectors/${id}/active`, w.staff, { active: false })).status).toBe(200);
    expect((await post(`/admin/kitar/collectors/${id}/active`, w.staff, { active: true })).status).toBe(200);
  });

  it('keeps kiosks and bins as admin set-up too: staff refused, admin allowed', async () => {
    expect((await post('/admin/kitar/kiosks', w.staff, { name: 'Staff Kiosk', location: 'By the gate' })).status).toBe(403);
    const kiosk = await post('/admin/kitar/kiosks', w.admin, { name: 'Admin Kiosk', location: 'By the gate' });
    expect(kiosk.status).toBe(200);
    expect((await post('/admin/kitar/machines', w.staff, { name: 'Staff Bin', kioskId: kiosk.body.data!.id })).status).toBe(403);
    const bin = await post('/admin/kitar/machines', w.admin, { name: 'Admin Bin', kioskId: kiosk.body.data!.id });
    expect(bin.status).toBe(200);
    expect((await post(`/admin/kitar/machines/${bin.body.data!.id}/material`, w.staff, { material: 'PAPER' })).status).toBe(403);
    expect((await post(`/admin/kitar/machines/${bin.body.data!.id}/material`, w.admin, { material: 'PAPER' })).status).toBe(200);
  });
});
