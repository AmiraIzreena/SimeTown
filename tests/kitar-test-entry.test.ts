import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { readFileSync } from 'node:fs';
import { createMachine, hasDropoffSource, itemText, joinFromScreen, machineScreen, simulateFinish, simulateItem, type ItemRecord } from '@/server/modules/kitar/machine';
import { createKiosk, kitarOverview, recordDropOff } from '@/server/modules/kitar/service';
import { recordTestEntry, testEntryEnabled } from '@/server/modules/kitar/test-entry';
import { createOffer } from '@/server/modules/offers/service';
import type { Material } from '@/shared/domain';
import { T0, freshDb, makeMerchant, makeResident, makeWorld, type World } from './helpers';

/**
 * Kitar test mode (local demos only): a practice entry needs no setting, but is refused unless
 * the database is pglite AND the app runs in development; it is for residents only; and it earns
 * exactly what the same weight earns at a real bin, through the same reward and limit code. It is
 * labelled TEST.
 */

type Lock = { APP_ENV: 'development' | 'staging' | 'production'; DATABASE_URL: string };
const ON: Lock = { APP_ENV: 'development', DATABASE_URL: 'pglite://memory' };
const NOT_PGLITE: Lock = { APP_ENV: 'development', DATABASE_URL: 'postgres://user@db.example/kita' };
const STAGING: Lock = { APP_ENV: 'staging', DATABASE_URL: 'pglite://memory' };
const PRODUCTION: Lock = { APP_ENV: 'production', DATABASE_URL: 'pglite://memory' };

let db: Db;
let handle: (req: Request) => Promise<Response>;

beforeAll(async () => {
  db = await freshDb();
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());

/** A township of its own with one bin that takes any material and, optionally, a shop that has promised a discount budget. */
async function township(opts: { pledgeSen?: number; binMaterial?: Material } = {}) {
  const world = await makeWorld(db);
  await createKiosk(db, world.staff, { name: 'Test Kiosk', location: 'Park' });
  const kiosk = (await one<{ id: string }>(db, 'SELECT id FROM kitar_kiosks WHERE township_id = $1', [world.townshipId]))!.id;
  const { id } = await createMachine(db, world.admin, { name: 'Test Bin', kioskId: kiosk, material: opts.binMaterial ?? null });
  if (opts.pledgeSen) {
    const shop = await makeMerchant(world, 0);
    await createOffer(db, shop, { title: 'RM3 off', discountSen: 300, minSpendSen: 2000, daysMask: 127, startMinute: 0, endMinute: 1440, monthlyBudgetSen: opts.pledgeSen }, T0);
  }
  return { world, machineId: id };
}

/** The same weight at the real bin: scanned, sent item by item and signed as the device would. */
async function atRealBin(world: World, machineId: string, material: Material, weightG: number) {
  const resident = await makeResident(world);
  const screen = await machineScreen(db, world.staff, machineId, T0);
  const { sessionId } = await joinFromScreen(db, resident, { machineId, code: screen.screen.code }, T0);
  const secret = (await one<{ secret: string }>(db, 'SELECT secret FROM kitar_machines WHERE id = $1', [machineId]))!.secret;
  const record: ItemRecord = { machineId, sessionId, seq: 1, material, cameraMaterial: material, barcodeOk: true, weightG, accepted: true, ts: T0.toISOString() };
  const res = await handle(new Request('http://kita.test/api/v1/ingest/kitar/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...record, signature: createHmac('sha256', secret).update(itemText(record)).digest('hex') }),
  }));
  expect(res.status).toBe(200);
  return (await simulateFinish(db, world.staff, machineId, T0)).reward!;
}

const testEntry = (actor: Actor, machineId: string, material: Material, weightG: number, config: Lock = ON) =>
  recordTestEntry(db, actor, { machineId, material, weightG }, T0, config);
const testRows = async (userId: string) => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM kitar_dropoffs WHERE user_id = $1 AND source = 'TEST'`, [userId]))!.n;
const earned = (r: { xp: number; points: number; offerPoints: number; skipped?: string } | null) => ({ xp: r?.xp, points: r?.points, offerPoints: r?.offerPoints, skipped: r?.skipped });

async function post(path: string, as: Actor, body: unknown) {
  const headers = new Headers({ origin: 'http://kita.test', 'content-type': 'application/json', cookie: `kita_session=${await createSession(db, as.id, T0)}` });
  const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as { data?: unknown; error?: { message: string } } };
}

describe('Kitar test mode: the locks', () => {
  it('is available only with a pglite database in development, with no setting', () => {
    expect(testEntryEnabled(ON)).toBe(true);
    expect(testEntryEnabled(NOT_PGLITE)).toBe(false);
    expect(testEntryEnabled(STAGING)).toBe(false);
    expect(testEntryEnabled(PRODUCTION)).toBe(false);
  });

  it('is allowed on pglite in development: the real route saves it, and GET /kitar offers it', async () => {
    // The tests run as the local demo does: APP_ENV=development with a pglite database.
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const resident = await makeResident(world);
    const res = await post('/kitar/test-entry', resident, { machineId, material: 'PAPER', weightG: 1_200 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ test: true, reward: { xp: 20, offerPoints: 12 } });
    expect(await testRows(resident.id)).toBe(1);
    expect((await kitarOverview(db, resident, T0)).testEntry).toEqual({ xp: 20 });
  });

  it('refuses when the database is not pglite, and stores nothing', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const resident = await makeResident(world);
    await expect(testEntry(resident, machineId, 'PAPER', 1_200, NOT_PGLITE)).rejects.toMatchObject({ status: 403, message: 'Test mode is off.' });
    expect(await testRows(resident.id)).toBe(0);
  });

  it('refuses when the app is not in development, and stores nothing', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const resident = await makeResident(world);
    await expect(testEntry(resident, machineId, 'PAPER', 1_200, STAGING)).rejects.toMatchObject({ status: 403, message: 'Test mode is off.' });
    await expect(testEntry(resident, machineId, 'PAPER', 1_200, PRODUCTION)).rejects.toMatchObject({ status: 403, message: 'Test mode is off.' });
    expect(await testRows(resident.id)).toBe(0);
  });

  it('refuses anyone who is not a verified resident, admins included', async () => {
    const { world, machineId } = await township();
    await expect(testEntry(world.admin, machineId, 'PAPER', 1_200)).rejects.toMatchObject({ status: 403 });
    await expect(testEntry(world.staff, machineId, 'PAPER', 1_200)).rejects.toMatchObject({ status: 403 });
    const pending = await makeResident(world, { status: 'PENDING' });
    await expect(testEntry(pending, machineId, 'PAPER', 1_200)).rejects.toMatchObject({ status: 403 });
    // Off, an admin gets the same answer as everyone else: test mode is off.
    await expect(testEntry(world.admin, machineId, 'PAPER', 1_200, PRODUCTION)).rejects.toMatchObject({ message: 'Test mode is off.' });
    expect((await post('/kitar/test-entry', world.admin, { machineId, material: 'PAPER', weightG: 1_200 })).status).toBe(403);
  });

  it('takes a weight more than 0 and up to 20 kg, in whole grams', async () => {
    const { world, machineId } = await township();
    const resident = await makeResident(world);
    for (const weightG of [0, -5, 20_001, 1.5]) await expect(testEntry(resident, machineId, 'PAPER', weightG)).rejects.toMatchObject({ status: 400 });
    expect(await testRows(resident.id)).toBe(0);
    await expect(testEntry(resident, machineId, 'PAPER', 20_000)).resolves.toMatchObject({ test: true, weightG: 20_000 });
  });

  it('keeps the bin’s own material rule', async () => {
    const { world, machineId } = await township({ binMaterial: 'PAPER' });
    const resident = await makeResident(world);
    await expect(testEntry(resident, machineId, 'GLASS', 500)).rejects.toMatchObject({ code: 'WRONG_MATERIAL' });
    await expect(testEntry(resident, machineId, 'PAPER', 500)).resolves.toMatchObject({ test: true });
  });
});

describe('Kitar test mode earns what a real bin earns (same reward and limit code)', () => {
  it('matches a real bin when shops have promised points', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const real = await atRealBin(world, machineId, 'PAPER', 1_200);
    const practice = (await testEntry(await makeResident(world), machineId, 'PAPER', 1_200)).reward;
    expect(earned(practice)).toEqual(earned(real));
    expect(practice).toMatchObject({ xp: 20, offerPoints: 12 }); // 1.2 kg x 10 points per kg, rounded down
  });

  it('matches a real bin when no shop has promised points: XP only', async () => {
    const { world, machineId } = await township();
    // Paper: one real item may weigh up to 2 kg, so the bin accepts the same weight as one item.
    const real = await atRealBin(world, machineId, 'PAPER', 1_500);
    const practice = (await testEntry(await makeResident(world), machineId, 'PAPER', 1_500)).reward;
    expect(earned(practice)).toEqual(earned(real));
    expect(practice).toMatchObject({ xp: 20, offerPoints: 0 });
  });

  it('counts towards the same daily trip limit as a real bin', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const resident = await makeResident(world);
    expect((await testEntry(resident, machineId, 'PAPER', 500)).reward).toMatchObject({ xp: 20 });
    expect((await testEntry(resident, machineId, 'PAPER', 500)).reward).toMatchObject({ xp: 20 });
    const third = (await testEntry(resident, machineId, 'PAPER', 500)).reward;
    expect(third).toMatchObject({ xp: 0, offerPoints: 0, skipped: 'DAILY_LIMIT' });
  });

  it('keeps the home’s monthly points limit, as a real bin does', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    await db.query('UPDATE program_settings SET offer_points_monthly_home = 5');
    try {
      const real = await atRealBin(world, machineId, 'PAPER', 1_200);
      const practice = (await testEntry(await makeResident(world), machineId, 'PAPER', 1_200)).reward;
      expect(earned(practice)).toEqual(earned(real));
      expect(practice).toMatchObject({ xp: 20, offerPoints: 5 }); // worth 12, home limit 5
    } finally {
      await db.query('UPDATE program_settings SET offer_points_monthly_home = 1000'); // back to the default
    }
  });
});

describe('Kitar test mode: every entry is labelled TEST and audited', () => {
  it('stores the drop-off as TEST, writes an audit entry, and leaves real drop-offs LIVE', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    await atRealBin(world, machineId, 'PAPER', 800);
    const resident = await makeResident(world);
    await testEntry(resident, machineId, 'GLASS', 600);

    const rows = await db.query<{ material: string; source: string; session_id: string | null }>('SELECT material, source, session_id FROM kitar_dropoffs WHERE user_id = $1', [resident.id]);
    expect(rows).toEqual([{ material: 'GLASS', source: 'TEST', session_id: null }]);
    const live = await one<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id WHERE k.township_id = $1 AND d.material = 'PAPER' AND d.source = 'LIVE'`,
      [world.townshipId],
    );
    expect(live!.n).toBe(1);

    const logged = await one<{ actor_user_id: string; entity_id: string; detail: { material: string; weightG: number } }>(
      db,
      `SELECT actor_user_id, entity_id, detail FROM audit_log WHERE action = 'KITAR_TEST_ENTRY' AND actor_user_id = $1`,
      [resident.id],
    );
    expect(logged).toMatchObject({ actor_user_id: resident.id, detail: { material: 'GLASS', weightG: 600 } });
    expect(logged!.entity_id).toMatch(/^test:/);
  });
});

// --- Local databases without migrations 015 and 016 ------------------------------------------

/** A township on database `d`, with a bin that takes any material and a shop that has promised points. */
async function setupOn(d: Db) {
  const world = await makeWorld(d);
  await createKiosk(d, world.staff, { name: 'Old Kiosk', location: 'Hall' });
  const kiosk = (await one<{ id: string; code: string }>(d, 'SELECT id, code FROM kitar_kiosks WHERE township_id = $1', [world.townshipId]))!;
  const { id: machineId } = await createMachine(d, world.admin, { name: 'Old Bin', kioskId: kiosk.id });
  const shop = await makeMerchant(world, 0);
  await createOffer(d, shop, { title: 'RM3 off', discountSen: 300, minSpendSen: 2000, daysMask: 127, startMinute: 0, endMinute: 1440, monthlyBudgetSen: 100_000 }, T0);
  return { world, machineId, kioskCode: kiosk.code };
}

describe('Kitar test mode with the TEST column (migration 016 applied)', () => {
  it('labels the row TEST and lists its id in the audit entry', async () => {
    expect(await hasDropoffSource(db)).toBe(true);
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const resident = await makeResident(world);
    await testEntry(resident, machineId, 'PAPER', 900);
    const row = (await one<{ id: string; source: string }>(db, 'SELECT id, source FROM kitar_dropoffs WHERE user_id = $1', [resident.id]))!;
    expect(row.source).toBe('TEST');
    const logged = (await one<{ detail: { dropoffIds: string[]; labelled: boolean } }>(db, `SELECT detail FROM audit_log WHERE action = 'KITAR_TEST_ENTRY' AND actor_user_id = $1`, [resident.id]))!;
    expect(logged.detail).toMatchObject({ dropoffIds: [row.id], labelled: true });
    expect((await kitarOverview(db, resident, T0)).recent).toMatchObject([{ id: row.id, test: true }]);
  });
});

describe('Kitar test mode without the TEST column (migration 016 not applied)', () => {
  let old: Db;
  beforeAll(async () => {
    old = await freshDb();
    await old.exec('ALTER TABLE kitar_dropoffs DROP COLUMN source'); // as on a local database that never ran 016
  });
  afterAll(() => old.close());

  it('notices the column is missing without an error', async () => {
    expect(await hasDropoffSource(old)).toBe(false);
  });

  it('still saves a practice entry through the same credit step, and the audit entry marks it', async () => {
    const { world, machineId } = await setupOn(old);
    const resident = await makeResident(world);
    const { reward } = await recordTestEntry(old, resident, { machineId, material: 'PAPER', weightG: 1_200 }, T0, ON);
    expect(reward).toMatchObject({ xp: 20, offerPoints: 12 });
    const rows = await old.query<{ id: string; material: string; weight_g: number }>('SELECT id, material, weight_g FROM kitar_dropoffs WHERE user_id = $1', [resident.id]);
    expect(rows).toEqual([{ id: expect.any(String), material: 'PAPER', weight_g: 1_200 }]);
    const logged = (await one<{ entity_id: string; detail: { dropoffIds: string[]; labelled: boolean } }>(
      old,
      `SELECT entity_id, detail FROM audit_log WHERE action = 'KITAR_TEST_ENTRY' AND actor_user_id = $1`,
      [resident.id],
    ))!;
    expect(logged.detail).toMatchObject({ dropoffIds: [rows[0]!.id], labelled: false });
    expect(logged.entity_id).toMatch(/^test:/);
  });

  it('marks only the practice entry as a test entry in recent recycling, from the audit log', async () => {
    const { world, machineId, kioskCode } = await setupOn(old);
    const resident = await makeResident(world);
    await recordDropOff(old, resident, { kioskCode, material: 'GLASS', weightG: 700 }, T0); // a real (typed) drop-off
    await recordTestEntry(old, resident, { machineId, material: 'PAPER', weightG: 500 }, T0, ON);
    const recent = (await kitarOverview(old, resident, T0)).recent as { material: string; test: boolean }[];
    expect(recent.map((r) => [r.material, r.test]).sort()).toEqual([['GLASS', false], ['PAPER', true]]);
  });

  it('leaves real bin sessions working as before', async () => {
    const { world, machineId } = await setupOn(old);
    const resident = await makeResident(world);
    const screen = await machineScreen(old, world.staff, machineId, T0);
    await joinFromScreen(old, resident, { machineId, code: screen.screen.code }, T0);
    await simulateItem(old, world.staff, machineId, { material: 'PAPER', outcome: 'ACCEPT' }, T0);
    const done = await simulateFinish(old, world.staff, machineId, T0);
    expect(done.reward).toMatchObject({ xp: 20 });
    expect((await kitarOverview(old, resident, T0)).recent).toMatchObject([{ material: 'PAPER', test: false }]);
  });
});

describe('The home’s monthly limit with and without migration 015', () => {
  const migration015 = readFileSync('src/server/db/migrations/015_home_offer_points_1000.sql', 'utf8');
  /** A database as it was before 015: the default and the value are 800 (migration 004). */
  async function before015() {
    const d = await freshDb();
    await d.exec('ALTER TABLE program_settings ALTER COLUMN offer_points_monthly_home SET DEFAULT 800; UPDATE program_settings SET offer_points_monthly_home = 800;');
    await d.exec(`DELETE FROM audit_log WHERE action = 'SETTINGS_CHANGED'`);
    return d;
  }

  it('with 015: the limit is 1,000, and the change is in the audit log', async () => {
    const value = await one<{ v: number }>(db, 'SELECT offer_points_monthly_home AS v FROM program_settings');
    expect(value!.v).toBe(1_000);
    const logged = await one<{ detail: unknown }>(db, `SELECT detail FROM audit_log WHERE action = 'SETTINGS_CHANGED' AND detail ->> 'source' = '015_home_offer_points_1000.sql'`);
    expect(logged!.detail).toMatchObject({ offer_points_monthly_home: { from: 800, to: 1000 } });
  });

  it('without 015: the app keeps the 800 it has, shows it, and caps points at it', async () => {
    const d = await before015();
    try {
      const { world, machineId } = await setupOn(d);
      const resident = await makeResident(world);
      expect((await kitarOverview(d, resident, T0)).limits).toMatchObject({ homePointsMax: 800 });
      // 15 kg of aluminium is worth 300 points: 300, 300, then the last 200 to reach 800, then nothing.
      const days = [0, 1, 2, 3].map((n) => new Date(T0.getTime() + n * 86_400_000));
      const given: number[] = [];
      for (const day of days) given.push((await recordTestEntry(d, resident, { machineId, material: 'ALUMINIUM', weightG: 15_000 }, day, ON)).reward?.offerPoints ?? 0);
      expect(given).toEqual([300, 300, 200, 0]);
      expect((await kitarOverview(d, resident, days[3]!)).limits).toMatchObject({ homePointsMonth: 800, homePointsMax: 800 });
    } finally {
      await d.close();
    }
  });

  it('applying 015 later moves 800 to 1,000 with an audit entry, and leaves a value chosen by hand alone', async () => {
    const d = await before015();
    try {
      await d.exec(migration015);
      expect((await one<{ v: number }>(d, 'SELECT offer_points_monthly_home AS v FROM program_settings'))!.v).toBe(1_000);
      expect((await one<{ n: number }>(d, `SELECT count(*)::int AS n FROM audit_log WHERE action = 'SETTINGS_CHANGED'`))!.n).toBe(1);

      await d.exec('ALTER TABLE program_settings ALTER COLUMN offer_points_monthly_home SET DEFAULT 800; UPDATE program_settings SET offer_points_monthly_home = 1200;');
      await d.exec(migration015);
      expect((await one<{ v: number }>(d, 'SELECT offer_points_monthly_home AS v FROM program_settings'))!.v).toBe(1_200);
    } finally {
      await d.close();
    }
  });
});
