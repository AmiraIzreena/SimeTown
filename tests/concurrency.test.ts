import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/server/db/client';
import { createSale, decideSale } from '@/server/modules/merchant/service';
import { recordAction } from '@/server/modules/rewards';
import { T0, balanceOf, expectFloatBalanced, freshDb, makeCampaign, makeMerchant, makeResident, makeWorld, sell, walletOf, type World } from './helpers';

/**
 * The same rules under simultaneous requests. These are most meaningful
 * against a real PostgreSQL server (set TEST_DATABASE_URL), where requests
 * truly overlap; in-process PostgreSQL runs them one after another.
 */

let db: Db;
let w: World;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

const settled = async <T>(tasks: Promise<T>[]) => {
  const results = await Promise.allSettled(tasks);
  return { ok: results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<T>).value), failed: results.filter((r) => r.status === 'rejected') };
};

describe('simultaneous requests', () => {
  it('cannot spend the same points twice', async () => {
    const funder = await makeMerchant(w, 100_000);
    const shopA = await makeMerchant(w);
    const shopB = await makeMerchant(w);
    const resident = await makeResident(w);
    await sell(w, funder, resident, 50_000); // 500 points

    const ask = (shop: typeof shopA) => createSale(db, shop, { memberCode: resident.memberCode!, billSen: 2_000, redeemPoints: 300, idempotencyKey: randomUUID() }, T0);
    const [a, b] = await Promise.all([ask(shopA), ask(shopB)]); // each alone is affordable
    const { ok, failed } = await settled([decideSale(db, resident, a.id, true, T0), decideSale(db, resident, b.id, true, T0)]);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(await walletOf(db, resident)).toBe(200);
    expect((await balanceOf(db, 'MERCHANT_PAYABLE', { merchantId: shopA.merchantId })) + (await balanceOf(db, 'MERCHANT_PAYABLE', { merchantId: shopB.merchantId }))).toBe(300);
    await expectFloatBalanced(db);
  });

  it('cannot give more points than a shop has funded', async () => {
    const shop = await makeMerchant(w, 30); // covers one RM20 sale (20 points + 3 sen fee), not two
    const residents = await Promise.all(Array.from({ length: 6 }, () => makeResident(w)));
    const sales = await Promise.all(residents.map((r) => sell(w, shop, r, 2_000)));

    expect(sales.filter((s) => s.pointsEarned === 20)).toHaveLength(1);
    expect(sales.filter((s) => s.earnNote === 'POOL_EMPTY')).toHaveLength(5);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(7);
    await expectFloatBalanced(db);
  });

  it('cannot overdraw a campaign pool', async () => {
    const id = await makeCampaign(w, { activity: 'JIRAN_HELP', budgetSen: 900, rewardPoints: 300, poolBps: 10_000, feeBps: 0, costsBps: 0 }); // three rewards
    const residents = await Promise.all(Array.from({ length: 8 }, () => makeResident(w)));
    const rewards = await Promise.all(
      residents.map((r) => db.tx((tx) => recordAction(tx, { user: { id: r.id, homeId: r.homeId!, townshipId: r.townshipId! }, activity: 'JIRAN_HELP', ref: randomUUID(), now: T0 }))),
    );
    expect(rewards.filter((r) => r.points === 300)).toHaveLength(3);
    expect(rewards.every((r) => r.xp === 40)).toBe(true); // XP is never limited by the pool
    expect(await balanceOf(db, 'FUNDER_POOL', { campaignId: id })).toBe(0);
    await expectFloatBalanced(db);
  });

  it('records a double-submitted sale once', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    const input = { memberCode: resident.memberCode!, billSen: 3_000, redeemPoints: 0, idempotencyKey: randomUUID() };
    await settled(Array.from({ length: 4 }, () => createSale(db, shop, input, T0)));
    expect(await walletOf(db, resident)).toBe(30);
  });

  it('holds the household limit when two members earn at once', async () => {
    const shop = await makeMerchant(w, 10_000_000);
    const a = await makeResident(w);
    const b = await makeResident(w, { homeId: a.homeId! });
    await db.query('UPDATE program_settings SET points_monthly_home = 1500');
    await Promise.all([sell(w, shop, a, 100_000), sell(w, shop, b, 100_000)]); // 1,000 points each wanted
    expect((await walletOf(db, a)) + (await walletOf(db, b))).toBe(1_500);
    await db.query('UPDATE program_settings SET points_monthly_home = 40000');
  });
});
