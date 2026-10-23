import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { demoGateScan, demoMoveToToday } from '@/server/modules/kitar/collection-demo';
import { COUNT_UP_TO_G, bookCollection, createCollector, myCollections, reportCollectionWeight } from '@/server/modules/kitar/collections';
import { T0, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * The home-collection demo helper (local demos only): locked like Kitar test mode,
 * for a resident's own confirmed collection, and simulating only the date and the
 * gate scan. Everything after it is the real flow. T0 is Monday 2 November 2026.
 */

type Lock = { APP_ENV: 'development' | 'staging' | 'production'; DATABASE_URL: string };
const ON: Lock = { APP_ENV: 'development', DATABASE_URL: 'pglite://memory' };
const NOT_PGLITE: Lock = { APP_ENV: 'development', DATABASE_URL: 'postgres://user@db.example/kita' };
const STAGING: Lock = { APP_ENV: 'staging', DATABASE_URL: 'pglite://memory' };
const PRODUCTION: Lock = { APP_ENV: 'production', DATABASE_URL: 'pglite://memory' };

let db: Db;
let w: World;
let collectorId: string;
let handle: (req: Request) => Promise<Response>;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  await db.query(`INSERT INTO users (email, full_name, role, township_id) VALUES ('demo-gate@kita.test', 'Gate Guard', 'GUARD', $1)`, [w.townshipId]);
  collectorId = (await createCollector(db, w.admin, { name: 'Demo Lorry', materials: ['PAPER'], days: 'Daily' })).id;
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());

const book = async (resident?: Actor, day = '2026-11-05') => {
  const who = resident ?? (await makeResident(w));
  return { resident: who, ...(await bookCollection(db, who, { collectorId, materials: ['PAPER'], items: 'Boxes', day, slot: 'MORNING' }, T0)) };
};
const row = (id: string) =>
  one<{ day: string; status: string; valid_from: Date; scans: number }>(
    db,
    `SELECT x.day::text AS day, x.status, p.valid_from, (SELECT count(*)::int FROM visitor_entries e WHERE e.pass_id = x.pass_id) AS scans
       FROM recycling_collections x JOIN visitor_passes p ON p.id = x.pass_id WHERE x.id = $1`,
    [id],
  );
const titlesOf = async (userId: string) => (await db.query<{ title: string }>('SELECT title FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).map((n) => n.title);
const demoAudits = async (id: string) => (await db.query<{ detail: { step: string } }>(`SELECT detail FROM audit_log WHERE action = 'KITAR_DEMO_COLLECTION' AND entity_id = $1 ORDER BY created_at`, [id])).map((a) => a.detail.step);

describe('Demo helper on a local demo (pglite, development)', () => {
  it('moves a collection to today, scans the pass through the real gate, then the normal weight step credits it', async () => {
    const { resident, id } = await book();
    // Before the move, the real gate refuses: the pass is for Thursday.
    await expect(demoGateScan(db, resident, id, T0, ON)).rejects.toMatchObject({ code: 'PASS_NOT_YET' });

    expect(await demoMoveToToday(db, resident, id, T0, ON)).toEqual({ day: '2026-11-02' });
    const moved = await row(id);
    expect(moved).toMatchObject({ day: '2026-11-02', status: 'CONFIRMED', scans: 0 });
    expect(moved!.valid_from.toISOString()).toBe('2026-11-01T16:00:00.000Z'); // midnight in Kuala Lumpur

    expect(await demoGateScan(db, resident, id, T0, ON)).toEqual({ scanned: true });
    expect((await row(id))!.scans).toBe(1);
    expect(await titlesOf(resident.id)).toEqual(expect.arrayContaining(['Demo Lorry (recycling collection) arrived at 12:00 pm', 'How much did they take?']));
    await expect(demoGateScan(db, resident, id, T0, ON)).rejects.toMatchObject({ code: 'ALREADY_SCANNED' });

    // From here it is the real flow: the 20 kg rule, BR6 and the usual notices.
    const result = await reportCollectionWeight(db, resident, id, 5_000, T0);
    expect(result.status).toBe('COLLECTED');
    expect(await titlesOf(resident.id)).toContain('Collection recorded');
    expect(await demoAudits(id)).toEqual(['MOVE_TO_TODAY', 'GATE_SCAN']);
  });

  it('settles a big weight after the demo gate scan, counted up to the material’s maximum', async () => {
    const { resident, id } = await book();
    await demoMoveToToday(db, resident, id, T0, ON);
    await demoGateScan(db, resident, id, T0, ON);
    expect((await reportCollectionWeight(db, resident, id, COUNT_UP_TO_G.PAPER + 5000, T0)).status).toBe('COLLECTED');
    const x = await one<{ weight_g: number; reported_weight_g: number }>(db, 'SELECT weight_g, reported_weight_g FROM recycling_collections WHERE id = $1', [id]);
    expect(x).toEqual({ weight_g: COUNT_UP_TO_G.PAPER, reported_weight_g: COUNT_UP_TO_G.PAPER + 5000 });
    // A closed collection cannot be touched by the demo.
    await expect(demoMoveToToday(db, resident, id, T0, ON)).rejects.toMatchObject({ code: 'COLLECTION_CLOSED' });
  });

  it('keeps one open collection per home per day', async () => {
    const resident = await makeResident(w);
    const first = await book(resident, '2026-11-05');
    const second = await book(resident, '2026-11-06');
    await demoMoveToToday(db, resident, first.id, T0, ON);
    await expect(demoMoveToToday(db, resident, second.id, T0, ON)).rejects.toMatchObject({ code: 'ALREADY_BOOKED' });
  });

  it('offers the demo steps on the card only while they apply', async () => {
    const { resident, id } = await book();
    const card = async () => (await myCollections(db, resident, T0)).find((x) => x.id === id)!;
    // The suite runs on pglite in development unless TEST_DATABASE_URL points at a real server.
    const local = process.env.DATABASE_URL!.startsWith('pglite://');
    expect(await card()).toMatchObject({ demo: local, is_today: false });
    await demoMoveToToday(db, resident, id, T0, ON);
    expect(await card()).toMatchObject({ is_today: true });
    await demoGateScan(db, resident, id, T0, ON);
    expect(await card()).toMatchObject({ demo: false, can_report: true, gate_scanned: true });
  });
});

describe('Demo helper: the locks', () => {
  it('is refused when the database is not pglite, or the app is not in development, and changes nothing', async () => {
    const { resident, id } = await book();
    for (const lock of [NOT_PGLITE, STAGING, PRODUCTION]) {
      await expect(demoMoveToToday(db, resident, id, T0, lock)).rejects.toMatchObject({ status: 403, message: 'Demo mode is off.' });
      await expect(demoGateScan(db, resident, id, T0, lock)).rejects.toMatchObject({ status: 403, message: 'Demo mode is off.' });
    }
    expect(await row(id)).toMatchObject({ day: '2026-11-05', scans: 0 });
    expect(await demoAudits(id)).toEqual([]);
    // Off, staff get the same answer as everyone else.
    await expect(demoMoveToToday(db, w.admin, id, T0, PRODUCTION)).rejects.toMatchObject({ message: 'Demo mode is off.' });
  });

  it("refuses another household's collection, and anyone who is not a resident", async () => {
    const { id } = await book();
    const neighbour = await makeResident(w);
    await expect(demoMoveToToday(db, neighbour, id, T0, ON)).rejects.toMatchObject({ status: 404 });
    await expect(demoGateScan(db, neighbour, id, T0, ON)).rejects.toMatchObject({ status: 404 });
    await expect(demoMoveToToday(db, w.staff, id, T0, ON)).rejects.toMatchObject({ status: 403 });
    expect(await row(id)).toMatchObject({ day: '2026-11-05', scans: 0 });
  });

  it('the real route follows the active database lock', async () => {
    const { resident, id } = await book();
    const headers = new Headers({ origin: 'http://kita.test', 'content-type': 'application/json', cookie: `kita_session=${await createSession(db, resident.id, T0)}` });
    const res = await handle(new Request(`http://kita.test/api/v1/kitar/collections/${id}/demo/today`, { method: 'POST', headers, body: '{}' }));
    if (process.env.DATABASE_URL!.startsWith('pglite://')) {
      expect(res.status).toBe(200);
      expect((await row(id))!.day).toBe('2026-11-02');
    } else {
      expect(res.status).toBe(403);
      expect((await row(id))!.day).toBe('2026-11-05');
    }
  });
});
