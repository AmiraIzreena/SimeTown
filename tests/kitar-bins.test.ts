import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { claimGuestSession, createMachine, itemText, itemVerdict, joinFromScreen, machineScreen, myMachineSession, simulateFinish, simulateItem, simulateStart, type ItemRecord } from '@/server/modules/kitar/machine';
import { offerWorthAt } from '@/server/modules/kitar/rates';
import { createKiosk, recordDropOff } from '@/server/modules/kitar/service';
import { createOffer, offerBalance } from '@/server/modules/offers/service';
import { recordAction, rewardUserById } from '@/server/modules/rewards';
import { translateMessage } from '@/lib/i18n-core';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';
import { T0, at, freshDb, makeMerchant, makeResident, makeWorld, type World } from './helpers';

/** Kitar bins: rates per material (migration 014), and a bin that takes one material only (BR23). */

let db: Db;
let w: World;
let kioskId: string;
const clock = { now: T0 };
let handle: (req: Request) => Promise<Response>;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  await createKiosk(db, w.staff, { name: 'Kiosk Bins', location: 'Beside the surau' });
  kioskId = (await one<{ id: string }>(db, `SELECT id FROM kitar_kiosks WHERE name = 'Kiosk Bins'`))!.id;
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => clock.now }).handle;
});
afterAll(() => db.close());

async function call(method: string, path: string, opts: { as?: Actor; body?: unknown } = {}) {
  const headers = new Headers({ origin: 'http://kita.test' });
  if (opts.as) headers.set('cookie', `kita_session=${await createSession(db, opts.as.id, clock.now)}`);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { data?: any; error?: any }) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: json.data, error: json.error };
}

/** A resident starts a session at the bin by scanning its screen. */
async function join(machineId: string, now = T0) {
  const resident = await makeResident(w);
  const screen = await machineScreen(db, w.staff, machineId, now);
  const joined = await joinFromScreen(db, resident, { machineId, code: screen.screen.code }, now);
  return { resident, joined };
}

describe('Kitar rates per material (migration 014)', () => {
  it('starts with the agreed rates, aluminium and tins at 20 points per kg, and marks the unconfirmed ones', async () => {
    const rows = await db.query<{ material: string; points_per_kg: number; placeholder: boolean }>(
      'SELECT material, points_per_kg, placeholder FROM kitar_material_rates ORDER BY material',
    );
    expect(Object.fromEntries(rows.map((r) => [r.material, r.points_per_kg]))).toEqual({
      ALUMINIUM: 20, COOKING_OIL: 20, E_WASTE: 20, GLASS: 10, PAPER: 10, PLASTIC_OTHER: 10, PLASTIC_PET: 10, TEXTILE: 5,
    });
    expect(rows.filter((r) => r.placeholder).map((r) => r.material).sort()).toEqual(['COOKING_OIL', 'E_WASTE', 'GLASS']);
    expect(rows.map((r) => r.material).sort()).toEqual([...MATERIALS].sort());
  });

  it('refuses a rate outside 0 to 1,000 points per kg, and an unknown material', async () => {
    await expect(db.query(`UPDATE kitar_material_rates SET points_per_kg = 1001 WHERE material = 'PAPER'`)).rejects.toThrow();
    await expect(db.query(`UPDATE kitar_material_rates SET points_per_kg = -1 WHERE material = 'PAPER'`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO kitar_material_rates (material, points_per_kg) VALUES ('METAL', 20)`)).rejects.toThrow();
    expect((await one<{ n: number }>(db, `SELECT points_per_kg AS n FROM kitar_material_rates WHERE material = 'PAPER'`))!.n).toBe(10);
  });

  it('leaves the old Kitar rule in activity_rules as it was', async () => {
    const rule = await one<{ offer_points: number; offer_per_quantity: number }>(db, `SELECT offer_points, offer_per_quantity FROM activity_rules WHERE activity = 'KITAR_DROPOFF'`);
    expect(rule).toEqual({ offer_points: 10, offer_per_quantity: 100 });
  });
});

describe('A bin takes one material (BR23)', () => {
  it('gives an existing machine no material, so it still takes any material', async () => {
    const { id } = await createMachine(db, w.admin, { name: 'Any Bin', kioskId });
    expect((await one<{ material: string | null }>(db, 'SELECT material FROM kitar_machines WHERE id = $1', [id]))!.material).toBeNull();

    await join(id);
    expect((await simulateItem(db, w.staff, id, { material: 'PAPER', outcome: 'ACCEPT' }, T0)).accepted).toBe(true);
    expect((await simulateItem(db, w.staff, id, { material: 'ALUMINIUM', outcome: 'ACCEPT' }, T0)).accepted).toBe(true);
    expect(await simulateFinish(db, w.staff, id, T0)).toMatchObject({ acceptedCount: 2, rejectedCount: 0 });
  });

  it('counts its own material, refuses any other with a reason, and still closes with a matching summary', async () => {
    const { id } = await createMachine(db, w.admin, { name: 'Paper Bin', kioskId, material: 'PAPER' });
    const { resident, joined } = await join(id);
    expect(joined.material).toBe('PAPER'); // the page can preselect it

    expect((await simulateItem(db, w.staff, id, { material: 'PAPER', outcome: 'ACCEPT' }, T0)).accepted).toBe(true);
    const wrong = await simulateItem(db, w.staff, id, { material: 'ALUMINIUM', outcome: 'ACCEPT' }, T0);
    expect(wrong).toMatchObject({ accepted: false, reason: 'This bin is for Paper and cardboard only.' });

    const live = await myMachineSession(db, resident, T0);
    expect(live).toMatchObject({ material: 'PAPER', acceptedCount: 1, rejectedCount: 1 });

    const done = await simulateFinish(db, w.staff, id, T0);
    expect(done).toMatchObject({ acceptedCount: 1, rejectedCount: 1 });
    const drops = await db.query<{ material: string }>('SELECT material FROM kitar_dropoffs WHERE session_id = $1', [done.sessionId]);
    expect(drops.map((d) => d.material)).toEqual(['PAPER']);
  });

  it('refuses another material sent by the device itself, with a valid signature', async () => {
    const { id } = await createMachine(db, w.admin, { name: 'Oil Bin', kioskId, material: 'COOKING_OIL' });
    const { joined } = await join(id);
    const secret = (await one<{ secret: string }>(db, 'SELECT secret FROM kitar_machines WHERE id = $1', [id]))!.secret;
    const send = async (record: ItemRecord) => {
      const res = await handle(
        new Request('http://kita.test/api/v1/ingest/kitar/items', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...record, signature: createHmac('sha256', secret).update(itemText(record)).digest('hex') }),
        }),
      );
      return { status: res.status, data: ((await res.json()) as { data: { accepted: boolean; reason: string | null } }).data };
    };
    const base = { machineId: id, sessionId: joined.sessionId, barcodeOk: true, accepted: true, ts: T0.toISOString() };
    const glass = await send({ ...base, seq: 1, material: 'GLASS', cameraMaterial: 'GLASS', weightG: 300 });
    expect(glass).toEqual({ status: 200, data: expect.objectContaining({ accepted: false, reason: 'This bin is for Used cooking oil only.' }) });
    const oil = await send({ ...base, seq: 2, material: 'COOKING_OIL', cameraMaterial: 'COOKING_OIL', weightG: 900 });
    expect(oil).toEqual({ status: 200, data: expect.objectContaining({ accepted: true, reason: null }) });
    await simulateFinish(db, w.staff, id, T0);
  });

  it('checks the material after "not taken", and before camera, barcode and weight', () => {
    const item = { material: 'GLASS' as const, cameraMaterial: 'PAPER' as const, barcodeOk: false, weightG: 1, accepted: true };
    expect(itemVerdict({ ...item, accepted: false }, 'PAPER').reason).toBe('The bin did not take this item.');
    expect(itemVerdict(item, 'PAPER').reason).toBe('This bin is for Paper and cardboard only.');
    expect(itemVerdict(item, null).reason).toBe('This item is not the material this bin takes.');
    expect(itemVerdict({ material: 'GLASS', cameraMaterial: 'GLASS', barcodeOk: true, weightG: 300, accepted: true }, 'GLASS')).toEqual({ accepted: true, reason: null });
  });

  it('lets only admins set a bin’s material, refuses an unknown one, and logs it', async () => {
    const body = { name: 'Glass Bin', kioskId, material: 'GLASS' };
    expect((await call('POST', '/admin/kitar/machines', { as: w.staff, body })).status).toBe(403);
    expect((await call('POST', '/admin/kitar/machines', { as: w.admin, body: { ...body, material: 'METAL' } })).status).toBe(400);

    const made = await call('POST', '/admin/kitar/machines', { as: w.admin, body });
    expect(made.status).toBe(200);
    expect((await one<{ material: string }>(db, 'SELECT material FROM kitar_machines WHERE id = $1', [made.data.id]))!.material).toBe('GLASS');
    const logged = await one<{ detail: { material: string } }>(db, `SELECT detail FROM audit_log WHERE action = 'MACHINE_CREATED' AND entity_id = $1`, [made.data.id]);
    expect(logged!.detail.material).toBe('GLASS');

    await expect(db.query(`UPDATE kitar_machines SET material = 'METAL' WHERE id = $1`, [made.data.id])).rejects.toThrow();
  });

  it('shows residents and staff each bin’s material', async () => {
    const resident = await makeResident(w);
    const kitar = await call('GET', '/kitar', { as: resident });
    expect(kitar.data.machines).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Paper Bin', material: 'PAPER' }),
      expect.objectContaining({ name: 'Any Bin', material: null }),
    ]));
    const staff = await call('GET', '/admin/kitar/machines', { as: w.staff });
    expect(staff.data).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Glass Bin', material: 'GLASS' })]));
  });
});

describe('Malay for the bin’s reason', () => {
  it('translates the reason for every material', () => {
    for (const m of MATERIALS) {
      const reason = itemVerdict({ material: m === 'PAPER' ? 'GLASS' : 'PAPER', cameraMaterial: null, barcodeOk: true, weightG: 100, accepted: true }, m).reason!;
      expect(reason).toBe(`This bin is for ${MATERIAL_INFO[m].label} only.`);
      const ms = translateMessage('ms', reason);
      expect(ms).toMatch(/^Tong ini untuk .+ sahaja\.$/);
      expect(ms).not.toContain(MATERIAL_INFO[m].label); // the material is in Malay too
    }
    expect(translateMessage('ms', 'This bin is for Paper and cardboard only.')).toBe('Tong ini untuk Kertas dan kadbod sahaja.');
  });
});

describe('Points per kg at each material’s rate (BR23, BR29)', () => {
  /** A township of its own, with a bin that takes any material and, optionally, a shop that has promised a discount budget. */
  async function township(opts: { pledgeSen?: number } = {}) {
    const world = await makeWorld(db);
    await createKiosk(db, world.staff, { name: 'Rates Kiosk', location: 'Park' });
    const kiosk = (await one<{ id: string }>(db, 'SELECT id FROM kitar_kiosks WHERE township_id = $1', [world.townshipId]))!.id;
    const { id } = await createMachine(db, world.admin, { name: 'Rates Bin', kioskId: kiosk });
    if (opts.pledgeSen) {
      const shop = await makeMerchant(world, 0);
      await createOffer(db, shop, { title: 'RM3 off', discountSen: 300, minSpendSen: 2000, daysMask: 127, startMinute: 0, endMinute: 1440, monthlyBudgetSen: opts.pledgeSen }, T0);
    }
    return { world, machineId: id };
  }

  /** A resident recycles these items (material, grams each) at the bin, sent and signed as the device would. */
  async function recycle(world: World, machineId: string, items: [Material, number][], now = T0) {
    const resident = await makeResident(world);
    const screen = await machineScreen(db, world.staff, machineId, now);
    const { sessionId } = await joinFromScreen(db, resident, { machineId, code: screen.screen.code }, now);
    const secret = (await one<{ secret: string }>(db, 'SELECT secret FROM kitar_machines WHERE id = $1', [machineId]))!.secret;
    for (const [i, [material, weightG]] of items.entries()) {
      const record: ItemRecord = { machineId, sessionId, seq: i + 1, material, cameraMaterial: material, barcodeOk: true, weightG, accepted: true, ts: now.toISOString() };
      const res = await handle(
        new Request('http://kita.test/api/v1/ingest/kitar/items', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...record, signature: createHmac('sha256', secret).update(itemText(record)).digest('hex') }),
        }),
      );
      expect(((await res.json()) as { data: { accepted: boolean } }).data.accepted).toBe(true);
    }
    const done = await simulateFinish(db, world.staff, machineId, now);
    return { resident, reward: done.reward! };
  }

  const setRate = (material: Material, pointsPerKg: number) => db.query('UPDATE kitar_material_rates SET points_per_kg = $2 WHERE material = $1', [material, pointsPerKg]);

  it('works out each material on its own and rounds down, never on the total', () => {
    const rates = new Map<Material, number>([['PLASTIC_PET', 10], ['PLASTIC_OTHER', 10]]);
    expect(offerWorthAt(rates, [{ material: 'PLASTIC_PET', grams: 450 }, { material: 'PLASTIC_OTHER', grams: 450 }])).toBe(8); // not 9
    expect(offerWorthAt(rates, [{ material: 'GLASS', grams: 5_000 }])).toBe(0); // no rate, no points
    expect(offerWorthAt(rates, [])).toBe(0);
  });

  it('gives 450 g of PET and 450 g of other plastic 8 points, not 9', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const { resident, reward } = await recycle(world, machineId, [['PLASTIC_PET', 100], ['PLASTIC_PET', 100], ['PLASTIC_PET', 100], ['PLASTIC_PET', 100], ['PLASTIC_PET', 50], ['PLASTIC_OTHER', 400], ['PLASTIC_OTHER', 50]]);
    expect(reward).toMatchObject({ xp: 20, offerPoints: 8, points: 0 });
    expect(await offerBalance(db, resident.id)).toBe(8);
  });

  it('gives paper and aluminium and tins their own rates: 3.9 kg of paper (39) and 150 g of cans (3) earn 42', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const { reward } = await recycle(world, machineId, [['PAPER', 1_950], ['PAPER', 1_950], ['ALUMINIUM', 50], ['ALUMINIUM', 50], ['ALUMINIUM', 50]]);
    expect(reward).toMatchObject({ xp: 20, offerPoints: 42 });
  });

  it('gives XP only for a material whose rate is 0', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    await setRate('TEXTILE', 0);
    try {
      const { reward } = await recycle(world, machineId, [['TEXTILE', 1_000]]);
      expect(reward).toMatchObject({ xp: 20, offerPoints: 0, points: 0 });
    } finally {
      await setRate('TEXTILE', 5);
    }
  });

  it('gives XP only, with no error, for a material with no rate row', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    await db.query(`DELETE FROM kitar_material_rates WHERE material = 'GLASS'`);
    try {
      const { reward } = await recycle(world, machineId, [['GLASS', 500], ['PAPER', 1_000]]);
      expect(reward).toMatchObject({ xp: 20, offerPoints: 10 }); // the paper still counts
    } finally {
      await db.query(`INSERT INTO kitar_material_rates (material, points_per_kg, placeholder) VALUES ('GLASS', 10, true)`);
    }
  });

  it('uses a changed rate from the next session, and leaves points already given alone', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    const first = await recycle(world, machineId, [['PAPER', 1_000]]);
    expect(first.reward.offerPoints).toBe(10);
    await setRate('PAPER', 30);
    try {
      const second = await recycle(world, machineId, [['PAPER', 1_000]]);
      expect(second.reward.offerPoints).toBe(30);
      expect(await offerBalance(db, first.resident.id)).toBe(10);
    } finally {
      await setRate('PAPER', 10);
    }
  });

  it('still keeps to the home’s monthly limit and to what shops promised', async () => {
    const promised = await township({ pledgeSen: 100_000 });
    await db.query('UPDATE program_settings SET offer_points_monthly_home = 30');
    try {
      const { reward } = await recycle(promised.world, promised.machineId, [['PAPER', 1_950], ['PAPER', 1_950], ['ALUMINIUM', 50], ['ALUMINIUM', 50], ['ALUMINIUM', 50]]);
      expect(reward).toMatchObject({ xp: 20, offerPoints: 30 }); // worth 42, home limit 30
    } finally {
      await db.query('UPDATE program_settings SET offer_points_monthly_home = 1000'); // back to the default
    }

    const noShops = await township();
    const { reward } = await recycle(noShops.world, noShops.machineId, [['PAPER', 1_950]]);
    expect(reward).toMatchObject({ xp: 20, offerPoints: 0 }); // no promise, no points (BR29)
  });

  it('gives a claimed guest session XP only, whatever the rates', async () => {
    const { world, machineId } = await township({ pledgeSen: 100_000 });
    await simulateStart(db, world.staff, machineId, { mode: 'GUEST' }, T0);
    await simulateItem(db, world.staff, machineId, { material: 'ALUMINIUM', outcome: 'ACCEPT' }, T0);
    const done = await simulateFinish(db, world.staff, machineId, T0);
    const claimed = await claimGuestSession(db, await makeResident(world), done.claimCode!, at(1));
    expect(claimed.reward).toMatchObject({ xp: 20, points: 0, offerPoints: 0 });
  });
});

describe('Setting the material on an existing bin', () => {
  async function bin(name: string) {
    return (await createMachine(db, w.admin, { name, kioskId })).id;
  }

  it('lets only admins set it, refuses an unknown material, and logs from and to', async () => {
    const id = await bin('Later Bin');
    const path = `/admin/kitar/machines/${id}/material`;
    expect((await call('POST', path, { as: w.staff, body: { material: 'PAPER' } })).status).toBe(403);
    expect((await call('POST', path, { as: w.admin, body: { material: 'METAL' } })).status).toBe(400);
    expect((await call('POST', path, { as: w.admin, body: {} })).status).toBe(400);

    const set = await call('POST', path, { as: w.admin, body: { material: 'PAPER' } });
    expect(set).toMatchObject({ status: 200, data: { material: 'PAPER' } });
    expect((await one<{ material: string }>(db, 'SELECT material FROM kitar_machines WHERE id = $1', [id]))!.material).toBe('PAPER');

    const log = await db.query<{ detail: { from: string | null; to: string | null } }>(`SELECT detail FROM audit_log WHERE action = 'MACHINE_MATERIAL' AND entity_id = $1 ORDER BY id`, [id]);
    expect(log.map((l) => l.detail)).toEqual([{ from: null, to: 'PAPER' }]);
  });

  it('clears the material with null, so the bin takes any material again, and logs it', async () => {
    const id = await bin('Clear Bin');
    const path = `/admin/kitar/machines/${id}/material`;
    await call('POST', path, { as: w.admin, body: { material: 'GLASS' } });
    expect(await call('POST', path, { as: w.hq, body: { material: null } })).toMatchObject({ status: 200, data: { material: null } });
    expect((await one<{ material: string | null }>(db, 'SELECT material FROM kitar_machines WHERE id = $1', [id]))!.material).toBeNull();
    const log = await db.query<{ detail: unknown }>(`SELECT detail FROM audit_log WHERE action = 'MACHINE_MATERIAL' AND entity_id = $1 ORDER BY id`, [id]);
    expect(log.map((l) => l.detail)).toEqual([{ from: null, to: 'GLASS' }, { from: 'GLASS', to: null }]);
  });

  it('refuses an admin of another township', async () => {
    const id = await bin('Own Bin');
    const other = await makeWorld(db);
    expect((await call('POST', `/admin/kitar/machines/${id}/material`, { as: other.admin, body: { material: 'PAPER' } })).status).toBe(403);
    expect((await one<{ material: string | null }>(db, 'SELECT material FROM kitar_machines WHERE id = $1', [id]))!.material).toBeNull();
  });

  it('refuses a change while someone is recycling at the bin, and allows it once they finish', async () => {
    const id = await bin('Busy Bin');
    const path = `/admin/kitar/machines/${id}/material`;
    await join(id);
    const busy = await call('POST', path, { as: w.admin, body: { material: 'PAPER' } });
    expect(busy.status).toBe(409);
    expect(busy.error.code).toBe('MACHINE_BUSY');
    await simulateFinish(db, w.staff, id, T0);
    expect((await call('POST', path, { as: w.admin, body: { material: 'PAPER' } })).status).toBe(200);
  });
});

describe('GET /kitar: rates, kg per material, limits and the points status', () => {
  /** A township of its own with a typed kiosk, and a resident who can record there. */
  async function township() {
    const world = await makeWorld(db);
    await createKiosk(db, world.staff, { name: 'Overview Kiosk', location: 'Hall' });
    const kiosk = (await one<{ id: string; code: string }>(db, 'SELECT id, code FROM kitar_kiosks WHERE township_id = $1', [world.townshipId]))!;
    return { world, kiosk };
  }
  const typed = (resident: Actor, kioskCode: string, material: Material, weightG: number, now = T0) => recordDropOff(db, resident, { kioskCode, material, weightG }, now);
  const overview = async (resident: Actor, now = T0) => {
    clock.now = now;
    try {
      const res = await call('GET', '/kitar', { as: resident });
      expect(res.status).toBe(200);
      return res.data;
    } finally {
      clock.now = T0;
    }
  };
  const promise = async (world: World, budgetSen: number, now = T0) => {
    const shop = await makeMerchant(world, 0);
    await createOffer(db, shop, { title: 'RM3 off', discountSen: 300, minSpendSen: 2000, daysMask: 127, startMinute: 0, endMinute: 1440, monthlyBudgetSen: budgetSen }, now);
  };
  const earnOfferPoints = async (resident: Actor, grams: number) => {
    const user = (await rewardUserById(db, resident.id))!;
    return db.tx((tx) => recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: `overview-${grams}-${resident.id}`, quantity: grams, now: T0, offerEligible: true }));
  };

  it('keeps every field it had, and only adds the new ones', async () => {
    const { world } = await township();
    const data = await overview(await makeResident(world));
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['monthGrams', 'allGrams', 'dropOffs', 'street', 'streetMonthGrams', 'recent', 'kiosks', 'machines', 'photoCheck']));
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['rates', 'monthGramsByMaterial', 'limits', 'points']));
    expect(data.rates).toHaveLength(8);
    expect(data.rates).toEqual(expect.arrayContaining([
      { material: 'ALUMINIUM', pointsPerKg: 20, placeholder: false },
      { material: 'GLASS', pointsPerKg: 10, placeholder: true },
    ]));
  });

  it('gives each bin its kiosk id and name, next to the fields it already had', async () => {
    const { world, kiosk } = await township();
    await createMachine(db, world.admin, { name: 'Kiosk Bin', kioskId: kiosk.id, material: 'PAPER' });
    const data = await overview(await makeResident(world));
    expect(data.machines).toEqual([{ id: expect.any(String), name: 'Kiosk Bin', status: 'ONLINE', material: 'PAPER', location: 'Hall', kiosk_id: kiosk.id, kiosk: 'Overview Kiosk' }]);
  });

  it('adds up this month’s kg for each material, and leaves out last month', async () => {
    const { world, kiosk } = await township();
    const resident = await makeResident(world);
    await typed(resident, kiosk.code, 'PAPER', 500, at(-30));
    await typed(resident, kiosk.code, 'PAPER', 500);
    await typed(resident, kiosk.code, 'PLASTIC_PET', 250, at(0.01));
    expect((await overview(resident, at(0.02))).monthGramsByMaterial).toEqual({ PAPER: 500, PLASTIC_PET: 250 });
  });

  it('counts trips exactly as recordAction allows them: per person per day, and per home per month', async () => {
    const { world, kiosk } = await township();
    const first = await makeResident(world);
    const home = await one<{ id: string }>(db, 'SELECT home_id AS id FROM users WHERE id = $1', [first.id]);
    const [a, b] = [await makeResident(world, { homeId: home!.id }), await makeResident(world, { homeId: home!.id })];
    await db.query(`UPDATE activity_rules SET monthly_cap_home = 3 WHERE activity = 'KITAR_DROPOFF'`);
    try {
      await typed(a, kiosk.code, 'PAPER', 100);
      await typed(a, kiosk.code, 'PAPER', 100);
      expect((await overview(a)).limits).toMatchObject({ tripsToday: 2, tripsPerDay: 2, homeTripsMonth: 2, homeTripsPerMonth: 3 });
      // The screen says a's day is used up, and recordAction agrees.
      await expect(typed(a, kiosk.code, 'PAPER', 100)).rejects.toMatchObject({ code: 'DAILY_LIMIT' });

      await typed(b, kiosk.code, 'PAPER', 100);
      expect((await overview(b)).limits).toMatchObject({ tripsToday: 1, homeTripsMonth: 3, homeTripsPerMonth: 3 });
      // The screen says the home's month is used up, and recordAction agrees, even on a new day.
      await expect(typed(b, kiosk.code, 'PAPER', 100, at(1))).rejects.toMatchObject({ code: 'MONTHLY_LIMIT' });
      expect((await overview(a, at(1))).limits).toMatchObject({ tripsToday: 0, homeTripsMonth: 3 });
    } finally {
      await db.query(`UPDATE activity_rules SET monthly_cap_home = 60 WHERE activity = 'KITAR_DROPOFF'`);
    }
  });

  it('says NO_PROMISES with no shop offer, ON once a shop has a live offer, and NO_PROMISES again when it is used up', async () => {
    const { world } = await township();
    const resident = await makeResident(world);
    expect((await overview(resident)).points).toEqual({ status: 'NO_PROMISES' });
    // Made last month, so this month's promise does not exist yet: the first award makes it. It still counts.
    await promise(world, 300, at(-30));
    expect(await one(db, `SELECT 1 FROM offer_pledges WHERE township_id = $1 AND month = '2026-11-01'`, [world.townshipId])).toBeUndefined();
    expect((await overview(resident)).points).toEqual({ status: 'ON' });
    expect((await earnOfferPoints(resident, 5_000)).offerPoints).toBe(300); // the whole promise
    expect((await overview(await makeResident(world))).points).toEqual({ status: 'NO_PROMISES' });
  });

  it('says HOME_LIMIT once the home has its monthly points, and shows the points used', async () => {
    const { world } = await township();
    await promise(world, 100_000);
    const resident = await makeResident(world);
    await db.query('UPDATE program_settings SET offer_points_monthly_home = 10');
    try {
      expect((await earnOfferPoints(resident, 1_000)).offerPoints).toBe(10);
      const data = await overview(resident);
      expect(data.points).toEqual({ status: 'HOME_LIMIT' });
      expect(data.limits).toMatchObject({ homePointsMonth: 10, homePointsMax: 10 });
    } finally {
      await db.query('UPDATE program_settings SET offer_points_monthly_home = 1000'); // back to the default
    }
    expect((await overview(resident)).points).toEqual({ status: 'ON' });
  });

  it('says PROGRAMME_PAUSED while points are paused after a failed float check, before any other reason', async () => {
    const { world } = await township();
    const resident = await makeResident(world); // no shop offer either
    await db.query('UPDATE program_settings SET issuance_paused = true');
    try {
      expect((await overview(resident)).points).toEqual({ status: 'PROGRAMME_PAUSED' });
    } finally {
      await db.query('UPDATE program_settings SET issuance_paused = false');
    }
  });

  it('sends only the reason, never the shops’ amounts', async () => {
    const { world } = await township();
    await promise(world, 12_345);
    const data = await overview(await makeResident(world));
    expect(Object.keys(data.points)).toEqual(['status']);
    expect(JSON.stringify(data)).not.toMatch(/12345|123\.45|pledge|promised|issued/i);
  });

  it('keeps the overview usable when migration 014 has not been applied', async () => {
    const bare = await freshDb();
    try {
      const world = await makeWorld(bare);
      await createKiosk(bare, world.staff, { name: 'Old Kiosk', location: 'Hall' });
      const kiosk = (await one<{ id: string }>(bare, `SELECT id FROM kitar_kiosks WHERE name = 'Old Kiosk'`))!;
      await createMachine(bare, world.admin, { name: 'Old Bin', kioskId: kiosk.id });
      await bare.exec('DROP TABLE kitar_material_rates; ALTER TABLE kitar_machines DROP COLUMN material');
      const resident = await makeResident(world);
      const router = createRouter(routes, { prefix: '/api/v1', db: async () => bare, now: () => T0 });
      const res = await router.handle(
        new Request('http://kita.test/api/v1/kitar', { headers: { origin: 'http://kita.test', cookie: `kita_session=${await createSession(bare, resident.id, T0)}` } }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { rates: unknown[]; machines: unknown[] } };
      expect(body.data.rates).toEqual([]);
      expect(body.data.machines).toEqual([
        { id: expect.any(String), name: 'Old Bin', status: 'ONLINE', material: null, location: 'Hall', kiosk_id: kiosk.id, kiosk: 'Old Kiosk' },
      ]);
    } finally {
      await bare.close();
    }
  });
});
