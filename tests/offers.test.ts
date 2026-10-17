import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { one, type Db } from '@/server/db/client';
import { recordMerchantDeposit, runSettlement } from '@/server/modules/ledger/finance';
import { createSale, decideSale, refundSale } from '@/server/modules/merchant/service';
import { createOffer, offerBalance, setOfferStatus } from '@/server/modules/offers/service';
import { recordAction, rewardUserById } from '@/server/modules/rewards';
import { T0, at, balanceOf, expectFloatBalanced, freshDb, makeMerchant, makeResident, makeWorld, type World } from './helpers';

/** Shop Offers and offer-backed points: BR29 (no pledge, no points) and BR30 (the shop's own terms and cap). */

let db: Db;
let w: World;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

let refs = 0;
/** A machine-verified recycling drop worth `grams`, which earns 10 offer points per 100 g. */
async function recycle(resident: Actor, grams: number, now: Date = T0) {
  const user = (await rewardUserById(db, resident.id))!;
  return db.tx((tx) => recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: `test-${++refs}`, quantity: grams, now, offerEligible: true }));
}

const offerInput = { title: 'RM3 off tea', discountSen: 300, minSpendSen: 2000, daysMask: 127, startMinute: 0, endMinute: 1440, monthlyBudgetSen: 600 };

async function sellWithOffer(shop: Actor, member: Actor, billSen: number, now: Date = T0) {
  const pending = await createSale(db, shop, { memberCode: member.memberCode!, billSen, redeemPoints: 0, useOffer: true, idempotencyKey: randomUUID() }, now);
  return decideSale(db, member, pending.id, true, now);
}

describe('offer-backed points (BR29)', () => {
  it('gives no offer-backed points when no shop has pledged anything', async () => {
    const resident = await makeResident(w);
    const reward = await recycle(resident, 600);
    expect(reward).toMatchObject({ xp: 20, offerPoints: 0 });
    expect(await offerBalance(db, resident.id)).toBe(0);
  });

  it('gives points only up to what shops pledged this month, and never touches the float', async () => {
    const shop = await makeMerchant(w, 50_000);
    await createOffer(db, shop, offerInput, T0);
    const [a, b, c] = [await makeResident(w), await makeResident(w), await makeResident(w)];

    expect((await recycle(a, 600)).offerPoints).toBe(60); // the proposal's example: 0.6 kg, +60 points
    expect((await recycle(b, 5_000)).offerPoints).toBe(500);
    // The pledge was RM6 (600 points) and 560 are given: only 40 are left for anyone this month.
    expect((await recycle(c, 3_000)).offerPoints).toBe(40);
    expect((await recycle(c, 3_000, at(0.01))).offerPoints).toBe(0);

    const month = await one<{ issued_points: number }>(db, 'SELECT issued_points FROM offer_months WHERE township_id = $1', [w.townshipId]);
    expect(month!.issued_points).toBe(600);
    await expectFloatBalanced(db);
  });

  it('keeps each home within its monthly limit of offer-backed points', async () => {
    const shop = await makeMerchant(w, 0);
    await db.query(`UPDATE shop_offers SET status = 'ENDED' WHERE status = 'ACTIVE'`);
    await createOffer(db, shop, { ...offerInput, monthlyBudgetSen: 100_000 }, T0);
    const resident = await makeResident(w);
    expect((await recycle(resident, 5_000)).offerPoints).toBe(500);
    expect((await recycle(resident, 7_000, at(0.02))).offerPoints).toBe(500); // worth 700; 1000 a month per home by default
    expect(await offerBalance(db, resident.id)).toBe(1_000);
  });

  it('gives nothing for an action that was not verified strongly enough', async () => {
    const resident = await makeResident(w);
    const user = (await rewardUserById(db, resident.id))!;
    const reward = await db.tx((tx) => recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: 'typed-weight', quantity: 2_000, now: T0 }));
    expect(reward.offerPoints).toBe(0);
  });
});

describe('Shop Offers at the counter (BR30)', () => {
  let shop: Actor;
  let resident: Actor;

  beforeAll(async () => {
    await db.query(`UPDATE shop_offers SET status = 'ENDED' WHERE status = 'ACTIVE'`);
    shop = await makeMerchant(w, 50_000);
    await createOffer(db, shop, offerInput, T0); // budget RM6: two uses of RM3
    resident = await makeResident(w);
    await db.query(
      `INSERT INTO offer_point_lots (user_id, township_id, pledge_month, source, label, amount, remaining, earned_at, expires_at)
       VALUES ($1, $2, '2026-11-01', 'ACTION', 'test', 1000, 1000, $3, $3::timestamptz + interval '24 months')`,
      [resident.id, w.townshipId, T0],
    );
  });

  it('uses the offer on the shop’s terms, charges a 10% success fee and gives points only on the cash part', async () => {
    const poolBefore = await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId });
    const sale = await sellWithOffer(shop, resident, 2_200); // proposal example 4: RM22 bill, RM3 off, pays RM19
    expect(sale).toMatchObject({ status: 'COMPLETED', offerPoints: 300, cashSen: 1_900, successFeeSen: 30, pointsEarned: 19 });
    expect(await offerBalance(db, resident.id)).toBe(700);
    // From the pool: 19 points + 3 sen issuance fee, and the 30 sen success fee.
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(poolBefore - 19 - 3 - 30);
    expect(await balanceOf(db, 'REVENUE_SUCCESS_FEE')).toBeGreaterThanOrEqual(30);
    await expectFloatBalanced(db);
  });

  it('refuses a bill below the minimum spend, and an offer outside its hours', async () => {
    await expect(createSale(db, shop, { memberCode: resident.memberCode!, billSen: 1_500, redeemPoints: 0, useOffer: true, idempotencyKey: randomUUID() }, T0)).rejects.toMatchObject({
      code: 'OFFER_MIN_SPEND',
    });
    const other = await makeMerchant(w, 10_000);
    await createOffer(db, other, { ...offerInput, startMinute: 18 * 60, endMinute: 22 * 60 }, T0); // T0 is noon in Kuala Lumpur
    await expect(createSale(db, other, { memberCode: resident.memberCode!, billSen: 3_000, redeemPoints: 0, useOffer: true, idempotencyKey: randomUUID() }, T0)).rejects.toMatchObject({
      code: 'OFFER_OUTSIDE_HOURS',
    });
  });

  it('pauses the offer once the shop’s monthly budget is used up', async () => {
    await sellWithOffer(shop, resident, 2_500);
    await expect(createSale(db, shop, { memberCode: resident.memberCode!, billSen: 2_500, redeemPoints: 0, useOffer: true, idempotencyKey: randomUUID() }, T0)).rejects.toMatchObject({
      code: 'OFFER_BUDGET_USED',
    });
    // Next month the shop's promise starts again.
    const nextMonth = new Date('2026-12-03T04:00:00Z');
    expect((await sellWithOffer(shop, resident, 2_500, nextMonth)).status).toBe('COMPLETED');
    await expectFloatBalanced(db);
  });

  it('returns offer points as offer points on a refund, and frees the shop’s budget again', async () => {
    const sales = await db.query<{ id: string }>(`SELECT id FROM sales WHERE merchant_id = $1 AND offer_id IS NOT NULL AND status = 'COMPLETED' AND completed_at < '2026-12-01' ORDER BY created_at LIMIT 1`, [shop.merchantId]);
    const before = await offerBalance(db, resident.id);
    const refund = await refundSale(db, shop, sales[0]!.id, T0);
    expect(refund.pointsReturned).toBe(300);
    expect(await offerBalance(db, resident.id)).toBe(before + 300);
    const pledge = await one<{ used_sen: number }>(db, `SELECT used_sen FROM offer_pledges p JOIN shop_offers o ON o.id = p.offer_id WHERE o.merchant_id = $1 AND p.month = '2026-11-01'`, [shop.merchantId]);
    expect(pledge!.used_sen).toBe(300);
    await expectFloatBalanced(db);
  });

  it('carries a success fee the shop cannot pay yet, and collects it at the next top-up', async () => {
    const poor = await makeMerchant(w, 0);
    await createOffer(db, poor, offerInput, T0);
    const sale = await sellWithOffer(poor, resident, 2_000);
    expect(sale).toMatchObject({ status: 'COMPLETED', successFeeSen: 30, pointsEarned: 0, earnNote: 'POOL_EMPTY' });
    const due = await one<{ status: string }>(db, 'SELECT status FROM offer_fees WHERE sale_id = $1', [sale.id]);
    expect(due!.status).toBe('DUE');

    const result = await recordMerchantDeposit(db, w.admin, poor.merchantId!, { amountSen: 1_000, bankRef: `TOPUP-${randomUUID()}` }, at(1));
    expect(result).toMatchObject({ feesCollectedSen: 30, poolSen: 970 });
    expect((await one<{ status: string }>(db, 'SELECT status FROM offer_fees WHERE sale_id = $1', [sale.id]))!.status).toBe('PAID');
    await runSettlement(db, null, at(2));
    await expectFloatBalanced(db);
  });

  it('lets only the shop that owns an offer change it', async () => {
    const other = await makeMerchant(w, 0);
    const offer = await one<{ id: string }>(db, `SELECT id FROM shop_offers WHERE merchant_id = $1 AND status = 'ACTIVE'`, [shop.merchantId]);
    await expect(setOfferStatus(db, other, offer!.id, 'ENDED', T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await setOfferStatus(db, shop, offer!.id, 'PAUSED', T0)).status).toBe('PAUSED');
    await expect(createSale(db, shop, { memberCode: resident.memberCode!, billSen: 2_500, redeemPoints: 0, useOffer: true, idempotencyKey: randomUUID() }, T0)).rejects.toMatchObject({
      code: 'NO_OFFER',
    });
  });
});
