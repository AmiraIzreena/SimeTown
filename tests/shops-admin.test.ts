import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import type { Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { recordMerchantDeposit } from '@/server/modules/ledger/finance';
import { applyAsMerchant } from '@/server/modules/merchant/admin';
import { setMerchantKind } from '@/server/modules/home-services/service';
import { T0, freshDb, makeMerchant, makeWorld, type World } from './helpers';

/**
 * The Shops console's reads: search, offer-type filter and sort on the list,
 * headline totals that agree with the list, and a detail view kept to the
 * admin's own township.
 */

const ORIGIN = 'http://kita.test';
let db: Db;
let w: World;
let other: World;
let handle: (req: Request) => Promise<Response>;

async function get(path: string, as: Actor) {
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { headers: { cookie: `kita_session=${await createSession(db, as.id, T0)}` } }));
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let pendingId: string;
let servicesShop: Actor;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  other = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
  const kafe = await makeMerchant(w, 50_000);
  await db.query(`UPDATE merchants SET name = 'Kafe 100% Halal', category = 'Food' WHERE id = $1`, [kafe.merchantId]);
  servicesShop = await makeMerchant(w, 12_000);
  await db.query(`UPDATE merchants SET name = 'Elmina Plumbing', category = 'Home repairs' WHERE id = $1`, [servicesShop.merchantId]);
  await setMerchantKind(db, w.admin, servicesShop.merchantId!, 'SERVICES');
  const applied = await applyAsMerchant(db, {
    townshipId: w.townshipId, businessName: 'Bengkel Basikal', registrationNo: 'REG-PEND-1', category: 'Bicycle repair', addressLine: '1 Jalan Satu',
    postcode: '40160', city: 'Shah Alam', state: 'Selangor', contactName: 'Ali', email: 'ali@bengkel.test', phone: '+60123456789', password: 'shop-password-1',
  }, T0);
  pendingId = applied.merchantId;
  await makeMerchant(other, 99_000); // another township: never visible here
});

afterAll(async () => {
  await db.close();
});

describe('shops list', () => {
  it('keeps the plain list for other screens, needs action first', async () => {
    const r = await get('/admin/merchants', w.admin);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data).toHaveLength(3);
    expect(r.body.data[0].status).toBe('PENDING');
  });

  it('searches name, registration and category, case-insensitively, with % and _ as literal characters', async () => {
    expect((await get('/admin/merchants?q=kafe', w.admin)).body.data.map((m: { name: string }) => m.name)).toEqual(['Kafe 100% Halal']);
    expect((await get('/admin/merchants?q=reg-pend', w.admin)).body.data).toHaveLength(1);
    expect((await get('/admin/merchants?q=REPAIRS', w.admin)).body.data).toHaveLength(1);
    expect((await get(`/admin/merchants?q=${encodeURIComponent('100%')}`, w.admin)).body.data).toHaveLength(1);
    expect((await get(`/admin/merchants?q=${encodeURIComponent('%')}`, w.admin)).body.data).toHaveLength(1);
    expect((await get(`/admin/merchants?q=${encodeURIComponent('_')}`, w.admin)).body.data).toHaveLength(0);
    expect((await get(`/admin/merchants?q=${encodeURIComponent("'; DROP TABLE merchants; --")}`, w.admin)).body.data).toHaveLength(0);
  });

  it('filters by what a business offers and sorts by money', async () => {
    expect((await get('/admin/merchants?kind=SERVICES', w.admin)).body.data.map((m: { name: string }) => m.name)).toEqual(['Elmina Plumbing']);
    const byPool = (await get('/admin/merchants?sort=POOL', w.admin)).body.data.map((m: { pool_sen: number }) => Number(m.pool_sen));
    expect(byPool).toEqual([...byPool].sort((a, b) => b - a));
  });

  it('refuses bad input and non-admins', async () => {
    expect((await get('/admin/merchants?sort=DROP', w.admin)).status).toBe(400);
    expect((await get('/admin/merchants?kind=ANY', w.admin)).status).toBe(400);
    expect((await get(`/admin/merchants?q=${'x'.repeat(61)}`, w.admin)).status).toBe(400);
    expect((await get('/admin/merchants', w.staff)).status).toBe(403);
    expect((await get('/admin/merchant-summary', w.staff)).status).toBe(403);
  });
});

describe('totals and detail', () => {
  it('summary totals match the list, from the same ledger accounts', async () => {
    const list = (await get('/admin/merchants', w.admin)).body.data as { status: string; pool_sen: string | number; owed_sen: string | number }[];
    const s = (await get('/admin/merchant-summary', w.admin)).body.data;
    expect(s.pending).toBe(list.filter((m) => m.status === 'PENDING').length);
    expect(s.active).toBe(list.filter((m) => m.status === 'ACTIVE').length);
    expect(Number(s.pool_sen)).toBe(list.reduce((sum, m) => sum + Number(m.pool_sen), 0));
    expect(Number(s.owed_sen)).toBe(list.reduce((sum, m) => sum + Number(m.owed_sen), 0));
    expect(Number(s.pool_sen)).toBe(62_000);
  });

  it('shows contacts and deposits, and only within the admin’s township', async () => {
    await recordMerchantDeposit(db, w.admin, servicesShop.merchantId!, { amountSen: 3_000, bankRef: 'TRF-DETAIL-1' }, T0);
    const d = await get(`/admin/merchants/${servicesShop.merchantId}`, w.admin);
    expect(d.status).toBe(200);
    expect(Number(d.body.data.merchant.pool_sen)).toBe(15_000);
    expect(d.body.data.deposits[0]).toMatchObject({ bank_ref: 'TRF-DETAIL-1' });
    expect(d.body.data.depositTotals.count).toBe(2);
    expect(d.body.data.merchant.township_id).toBeUndefined();
    const pending = await get(`/admin/merchants/${pendingId}`, w.admin);
    expect(pending.body.data.contacts[0]).toMatchObject({ full_name: 'Ali', email: 'ali@bengkel.test' });
    expect((await get(`/admin/merchants/${pendingId}`, other.admin)).status).toBe(403);
    expect((await get('/admin/merchants/not-a-uuid', w.admin)).status).toBe(404);
  });
});
