import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { bookCollection, createCollector, listCollectors } from '@/server/modules/kitar/collections';
import { BOOK_AHEAD_DAYS, describeSchedule, formatSchedule, openSlots, parseSchedule, weekdayOf, worksOn } from '@/shared/collector-schedule';
import { T0, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * Collector schedules are read by the system: stored in the days column in a fixed
 * line, listed and enforced by day and time. Older free text still works, as
 * "any day and time". T0 is Monday 2 November 2026: the 3rd is a Tuesday, the 7th a Saturday.
 */

let db: Db;
let w: World;
let weekdayMornings: string;
let oldText: string;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  weekdayMornings = (await createCollector(db, w.admin, { name: 'Weekday Mornings', materials: ['PAPER'], schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], time: 'MORNING' } })).id;
  // Added before schedules were read: the words say weekends, but nothing can be read from them.
  oldText = (await createCollector(db, w.admin, { name: 'Old Text Co', materials: ['PAPER'], days: 'Saturday-Sunday' })).id;
});
afterAll(() => db.close());

const book = async (collectorId: string, day: string, slot: 'MORNING' | 'AFTERNOON', who?: Actor) =>
  bookCollection(db, who ?? (await makeResident(w)), { collectorId, materials: ['PAPER'], items: 'Boxes', day, slot }, T0);

describe('The stored schedule', () => {
  it('is one fixed line that reads back, and older text reads as unknown', () => {
    const line = formatSchedule({ days: ['WED', 'MON'], time: 'BOTH' });
    expect(line).toBe('schedule:v1 days=MON,WED time=BOTH');
    expect(parseSchedule(line)).toEqual({ days: ['MON', 'WED'], time: 'BOTH' });
    expect(parseSchedule('Tue and Sat mornings')).toBeNull();
    expect(weekdayOf('2026-11-03')).toBe('TUE');
    expect(weekdayOf('2026-11-08')).toBe('SUN');
  });

  it('is shown in plain words, or as the old text', () => {
    expect(describeSchedule(formatSchedule({ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], time: 'MORNING' }))).toEqual({ days: ['Weekdays'], time: 'Morning' });
    expect(describeSchedule(formatSchedule({ days: ['MON', 'WED'], time: 'BOTH' }))).toEqual({ days: ['Mon', 'Wed'], time: 'Both' });
    expect(describeSchedule('Saturday-Sunday')).toEqual({ legacy: 'Saturday-Sunday' });
    expect(worksOn('Saturday-Sunday', '2026-11-03', 'AFTERNOON')).toBe(true);
  });

  it('lists only the days and times the collector comes, for the booking form', () => {
    expect(openSlots(formatSchedule({ days: ['TUE', 'SAT'], time: 'MORNING' }), '2026-11-02', 7)).toEqual([
      { day: '2026-11-03', slot: 'MORNING' },
      { day: '2026-11-07', slot: 'MORNING' },
    ]);
    expect(openSlots(formatSchedule({ days: ['THU'], time: 'BOTH' }), '2026-11-02', 14)).toEqual([
      { day: '2026-11-05', slot: 'MORNING' }, { day: '2026-11-05', slot: 'AFTERNOON' },
      { day: '2026-11-12', slot: 'MORNING' }, { day: '2026-11-12', slot: 'AFTERNOON' },
    ]);
    // Crosses the month end, and every slot it offers is one booking accepts.
    const slots = openSlots(formatSchedule({ days: ['MON'], time: 'AFTERNOON' }), '2026-11-25', BOOK_AHEAD_DAYS)!;
    expect(slots[0]).toEqual({ day: '2026-11-30', slot: 'AFTERNOON' });
    for (const s of slots) expect(worksOn(formatSchedule({ days: ['MON'], time: 'AFTERNOON' }), s.day, s.slot)).toBe(true);
    expect(openSlots('Tue and Sat mornings', '2026-11-02', 7)).toBeNull();
  });
});

describe('Booking follows the schedule', () => {
  it('accepts a working day and time', async () => {
    expect((await book(weekdayMornings, '2026-11-03', 'MORNING')).status).toBe('CONFIRMED');
  });

  it('refuses another day', async () => {
    await expect(book(weekdayMornings, '2026-11-07', 'MORNING')).rejects.toMatchObject({
      code: 'COLLECTOR_NOT_AVAILABLE', message: 'Weekday Mornings does not collect on that day or time. Choose another day or time.',
    });
  });

  it('refuses another time', async () => {
    await expect(book(weekdayMornings, '2026-11-03', 'AFTERNOON')).rejects.toMatchObject({ code: 'COLLECTOR_NOT_AVAILABLE' });
  });

  it('still books a collector with an old free-text schedule, any day and time', async () => {
    expect((await book(oldText, '2026-11-03', 'AFTERNOON')).status).toBe('CONFIRMED');
  });
});

describe("The resident's list", () => {
  it('shows only collectors who work on the chosen day and time', async () => {
    const resident = await makeResident(w);
    const names = async (day: string, slot: 'MORNING' | 'AFTERNOON') => (await listCollectors(db, resident, { day, slot })).map((c) => c.name);
    expect(await names('2026-11-03', 'MORNING')).toEqual(['Old Text Co', 'Weekday Mornings']);
    expect(await names('2026-11-03', 'AFTERNOON')).toEqual(['Old Text Co']);
    expect(await names('2026-11-07', 'MORNING')).toEqual(['Old Text Co']);
    // With no day and time, everyone active, as before.
    expect((await listCollectors(db, resident)).length).toBe(2);
  });
});

describe('Adding a collector through the console route', () => {
  const handle = (req: Request) => createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle(req);
  async function post(body: unknown) {
    const headers = new Headers({ origin: 'http://kita.test', 'content-type': 'application/json', cookie: `kita_session=${await createSession(db, w.admin.id, T0)}` });
    return (await handle(new Request('http://kita.test/api/v1/admin/kitar/collectors', { method: 'POST', headers, body: JSON.stringify(body) }))).status;
  }

  it('stores the chosen days and time, and needs at least one day', async () => {
    expect(await post({ name: 'Weekend Van', materials: ['PAPER'], schedule: { days: ['SAT', 'SUN'], time: 'AFTERNOON' } })).toBe(200);
    expect((await one<{ days: string }>(db, `SELECT days FROM recycling_collectors WHERE name = 'Weekend Van'`))!.days).toBe('schedule:v1 days=SAT,SUN time=AFTERNOON');
    expect(await post({ name: 'No Days', materials: ['PAPER'], schedule: { days: [], time: 'BOTH' } })).toBe(400);
    expect(await post({ name: 'Free Text', materials: ['PAPER'], days: 'Whenever' })).toBe(400);
  });
});
