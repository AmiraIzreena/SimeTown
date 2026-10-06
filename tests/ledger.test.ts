import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/server/db/client';
import { one } from '@/server/db/client';
import { campaignReport } from '@/server/modules/campaigns/service';
import { decideAdjustment, recordCommunityDeposit, requestAdjustment, runFloatCheck, runSettlement } from '@/server/modules/ledger/finance';
import { credit, debit, postTxn, systemAccounts } from '@/server/modules/ledger/ledger';
import { expirePoints, sendExpiryReminders } from '@/server/modules/ledger/points';
import { createSale, decideSale, listStatements, maxRedeemable, refundSale } from '@/server/modules/merchant/service';
import { recordAction } from '@/server/modules/rewards';
import { getSettings } from '@/server/modules/settings';
import {
  T0, at, balanceOf, closeCampaign, expectFloatBalanced, freshDb, makeCampaign, makeHome, makeMerchant, makeResident,
  makeSponsorUser, makeWorld, sell, sellWithPoints, walletOf, type World,
} from './helpers';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

const rewardUser = (a: { id: string; homeId: string | null; townshipId: string | null }) => ({ id: a.id, homeId: a.homeId!, townshipId: a.townshipId! });

describe('the ledger itself', () => {
  it('rejects a transaction that does not balance, in code and in the database', async () => {
    const sys = await systemAccounts(db);
    await expect(
      db.tx((tx) => postTxn(tx, { kind: 'DEPOSIT', label: 'bad', at: T0, entries: [debit(sys.TRUST_BANK, 100), credit(sys.COMMUNITY_POOL, 90)] })),
    ).rejects.toThrow(/does not balance/);

    // Bypass the application check: the deferred database trigger still refuses at commit.
    await expect(
      db.tx(async (tx) => {
        const txn = await one<{ id: string }>(tx, `INSERT INTO ledger_txns (kind, label, created_at) VALUES ('DEPOSIT', 'bad', $1) RETURNING id`, [T0]);
        await tx.query('INSERT INTO ledger_entries (txn_id, account_id, amount) VALUES ($1, $2, 100), ($1, $3, -90)', [txn!.id, sys.TRUST_BANK, sys.COMMUNITY_POOL]);
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it('is append-only: entries cannot be edited or deleted', async () => {
    const shop = await makeMerchant(w, 10_000);
    await expect(db.query('UPDATE ledger_entries SET amount = amount + 1')).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM ledger_txns')).rejects.toThrow(/append-only/);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(10_000);
  });

  it('never lets an account go below zero', async () => {
    const sys = await systemAccounts(db);
    const before = await balanceOf(db, 'COMMUNITY_POOL');
    await expect(
      db.tx((tx) => postTxn(tx, { kind: 'DEPOSIT', label: 'overdraw', at: T0, entries: [debit(sys.COMMUNITY_POOL, before + 1), credit(sys.TRUST_BANK, before + 1)] })),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});

describe('earning at a shop', () => {
  it('gives 1 point per RM1 and charges the shop the points plus a 15% fee (BR8, BR14: example 1)', async () => {
    const shop = await makeMerchant(w, 10_000);
    const aisyah = await makeResident(w);
    const sale = await sell(w, shop, aisyah, 2_000);

    expect(sale).toMatchObject({ status: 'COMPLETED', pointsEarned: 20, feeSen: 3, earnNote: null });
    expect(await walletOf(db, aisyah)).toBe(20);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(10_000 - 23);
    await expectFloatBalanced(db);
  });

  it('gives no points when the shop has not paid into its pool: no pool, no points (BR4, BR8)', async () => {
    const shop = await makeMerchant(w, 10); // 10 sen cannot cover 20 points + fee
    const resident = await makeResident(w);
    const sale = await sell(w, shop, resident, 2_000);

    expect(sale).toMatchObject({ status: 'COMPLETED', pointsEarned: 0, feeSen: 0, earnNote: 'POOL_EMPTY' });
    expect(await walletOf(db, resident)).toBe(0);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(10);
  });

  it('only serves verified residents of the township (BR1)', async () => {
    const shop = await makeMerchant(w, 10_000);
    const pending = await makeResident(w, { status: 'PENDING' });
    await expect(sell(w, shop, pending, 2_000)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const elsewhere = await makeWorld(db);
    const outsider = await makeResident(elsewhere);
    await expect(sell(w, shop, outsider, 2_000)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records a retried request only once', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    const input = { memberCode: resident.memberCode!, billSen: 5_000, redeemPoints: 0, idempotencyKey: randomUUID() };
    const first = await createSale(db, shop, input, T0);
    const second = await createSale(db, shop, input, T0);
    expect(second.id).toBe(first.id);
    expect(await walletOf(db, resident)).toBe(50);
  });

  it('applies the daily limit per person and the monthly limit per home (BR6)', async () => {
    const s = await getSettings(db);
    const shop = await makeMerchant(w, 10_000_000);
    const homeId = await makeHome(w);
    const a = await makeResident(w, { homeId });
    const b = await makeResident(w, { homeId });

    // One huge bill hits the daily limit for that person.
    const capped = await sell(w, shop, a, (s.points_daily_person + 500) * 100);
    expect(capped).toMatchObject({ pointsEarned: s.points_daily_person, earnNote: 'LIMIT_REACHED' });
    expect((await sell(w, shop, a, 1_000)).pointsEarned).toBe(0);
    // The next day the daily limit has reset.
    expect((await sell(w, shop, a, 1_000, at(1))).pointsEarned).toBe(10);

    // Fill the home's monthly limit between two people, a day at a time.
    let day = 2;
    while ((await walletOf(db, a)) + (await walletOf(db, b)) < s.points_monthly_home) {
      await sell(w, shop, day % 2 ? a : b, s.points_daily_person * 100, at(day++));
    }
    expect((await walletOf(db, a)) + (await walletOf(db, b))).toBe(s.points_monthly_home);
    expect(await sell(w, shop, b, 1_000, at(day))).toMatchObject({ pointsEarned: 0, earnNote: 'LIMIT_REACHED' });
    await expectFloatBalanced(db);
  });
});

describe('spending points', () => {
  it('needs at least 100 points, in whole ringgit, and at most 30% of the bill (BR12)', async () => {
    const s = await getSettings(db);
    expect(maxRedeemable(2_000, s)).toBe(600);
    expect(maxRedeemable(1_999, s)).toBe(500); // 30% is 599 sen; whole ringgit only

    const shop = await makeMerchant(w, 100_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 150_000); // 1,500 points
    const attempt = (billSen: number, redeemPoints: number) =>
      createSale(db, shop, { memberCode: resident.memberCode!, billSen, redeemPoints, idempotencyKey: randomUUID() }, T0);

    await expect(attempt(2_000, 50)).rejects.toMatchObject({ code: 'REDEEM_MIN' });
    await expect(attempt(2_000, 250)).rejects.toMatchObject({ code: 'REDEEM_STEP' });
    await expect(attempt(2_000, 700)).rejects.toMatchObject({ code: 'REDEEM_CAP' });
    await expect(attempt(1_000_000, 5_000)).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
  });

  it('moves nothing until the resident confirms on their own phone, and only they can (BR12)', async () => {
    const shop = await makeMerchant(w, 100_000);
    const aisyah = await makeResident(w);
    const stranger = await makeResident(w);
    await sell(w, shop, aisyah, 50_000);

    const pending = await createSale(db, shop, { memberCode: aisyah.memberCode!, billSen: 2_000, redeemPoints: 300, idempotencyKey: randomUUID() }, T0);
    expect(pending.status).toBe('PENDING');
    expect(await walletOf(db, aisyah)).toBe(500);

    await expect(decideSale(db, stranger, pending.id, true, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const declined = await decideSale(db, aisyah, pending.id, false, T0);
    expect(declined.status).toBe('DECLINED');
    expect(await walletOf(db, aisyah)).toBe(500);
    await expect(decideSale(db, aisyah, pending.id, true, T0)).rejects.toMatchObject({ code: 'SALE_NOT_PENDING' });
  });

  it('expires a request the resident does not answer in time', async () => {
    const shop = await makeMerchant(w, 100_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 50_000);
    const pending = await createSale(db, shop, { memberCode: resident.memberCode!, billSen: 2_000, redeemPoints: 300, idempotencyKey: randomUUID() }, T0);
    const late = await decideSale(db, resident, pending.id, true, new Date(T0.getTime() + 6 * 60_000));
    expect(late.status).toBe('EXPIRED');
    expect(await walletOf(db, resident)).toBe(500);
  });

  it('pays the accepting shop 100%, charges it nothing, and gives no points on the part paid with points (BR12, BR13: example 2)', async () => {
    const kafe = await makeMerchant(w, 100_000);
    const kedai = await makeMerchant(w, 100_000);
    const aisyah = await makeResident(w);
    await sell(w, kafe, aisyah, 30_000); // 300 points, funded by the café
    const kedaiPoolBefore = await balanceOf(db, 'FUNDER_POOL', { merchantId: kedai.merchantId });

    const sale = await sellWithPoints(w, kedai, aisyah, 2_000, 300);

    expect(sale).toMatchObject({ status: 'COMPLETED', redeemPoints: 300, cashSen: 1_700, pointsEarned: 17, feeSen: 3 });
    expect(await walletOf(db, aisyah)).toBe(17);
    expect(await balanceOf(db, 'MERCHANT_PAYABLE', { merchantId: kedai.merchantId })).toBe(300);
    // The grocer paid only for the 17 new points and their fee, nothing for accepting 300.
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: kedai.merchantId })).toBe(kedaiPoolBefore - 17 - 3);
    await expectFloatBalanced(db);
  });

  it('settles every shop in full each week and shows it on the statement (BR13)', async () => {
    const kafe = await makeMerchant(w, 100_000);
    const kedai = await makeMerchant(w, 0); // accepts points without funding any
    const resident = await makeResident(w);
    await sell(w, kafe, resident, 100_000);
    await sellWithPoints(w, kedai, resident, 2_000, 600);

    const trustBefore = await balanceOf(db, 'TRUST_BANK');
    const run = await runSettlement(db, w.admin.id, at(5));
    expect(run.totalSen).toBeGreaterThanOrEqual(600);
    expect(await balanceOf(db, 'MERCHANT_PAYABLE', { merchantId: kedai.merchantId })).toBe(0);
    expect(await balanceOf(db, 'TRUST_BANK')).toBe(trustBefore - run.totalSen);

    const statement = await listStatements(db, kedai);
    expect(statement.dueThisWeekSen).toBe(0);
    expect(statement.statements[0]).toMatchObject({ amount_sen: 600, sales: 1 });
    // Running it again the same day pays nothing twice.
    expect((await runSettlement(db, w.admin.id, at(5))).totalSen).toBe(0);
    await expectFloatBalanced(db);
  });
});

describe('refunds (BR15)', () => {
  it('takes back points earned on the purchase', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    const sale = await sell(w, shop, resident, 2_000);
    const poolAfterSale = await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId });

    const refund = await refundSale(db, shop, sale.id, T0);
    expect(refund).toMatchObject({ pointsTakenBack: 20, pointsReturned: 0, cashRefundSen: 2_000 });
    expect(await walletOf(db, resident)).toBe(0);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(poolAfterSale + 20);
    await expect(refundSale(db, shop, sale.id, T0)).rejects.toMatchObject({ code: 'SALE_NOT_REFUNDABLE' });
    await expectFloatBalanced(db);
  });

  it('returns spent points as points, never cash, even after the shop was paid', async () => {
    const kafe = await makeMerchant(w, 100_000);
    const kedai = await makeMerchant(w, 50_000);
    const resident = await makeResident(w);
    await sell(w, kafe, resident, 30_000);
    const sale = await sellWithPoints(w, kedai, resident, 2_000, 300);
    await runSettlement(db, w.admin.id, at(6)); // the float has already paid the grocer its RM3

    const refund = await refundSale(db, kedai, sale.id, at(7));
    expect(refund).toMatchObject({ pointsReturned: 300, pointsTakenBack: 17, cashRefundSen: 1_700 });
    expect(await walletOf(db, resident)).toBe(300);
    await expectFloatBalanced(db);
  });

  it('reports a shortfall when earned points were already spent elsewhere', async () => {
    const kafe = await makeMerchant(w, 100_000);
    const kedai = await makeMerchant(w, 0);
    const resident = await makeResident(w);
    const big = await sell(w, kafe, resident, 30_000); // 300 points
    await sellWithPoints(w, kedai, resident, 2_000, 300); // all spent at the grocer; none earned (empty pool)

    const refund = await refundSale(db, kafe, big.id, T0);
    expect(refund).toMatchObject({ pointsTakenBack: 0, cashRefundSen: 30_000 - 300 });
    expect(refund.sale.refundShortfallSen).toBe(300);
    await expectFloatBalanced(db);
  });

  it('cannot be done by another shop', async () => {
    const shop = await makeMerchant(w, 10_000);
    const other = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    const sale = await sell(w, shop, resident, 2_000);
    await expect(refundSale(db, other, sale.id, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('sponsored campaigns', () => {
  it('splits the budget, awards from the pool, stops at the per-person limit and refunds the rest (BR4, BR8, BR10: example 3 at 1/100 scale)', async () => {
    const operatingBefore = await balanceOf(db, 'OPERATING_BANK');
    const id = await makeCampaign(w, { budgetSen: 20_000, rewardPoints: 300, perPersonCap: 1 }); // RM200 → pool RM120
    expect(await balanceOf(db, 'FUNDER_POOL', { campaignId: id })).toBe(12_000);
    expect((await balanceOf(db, 'OPERATING_BANK')) - operatingBefore).toBe(5_000 + 3_000);

    const residents = await Promise.all(Array.from({ length: 25 }, () => makeResident(w)));
    for (const r of residents) {
      const reward = await db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'KITAR_DROPOFF', ref: randomUUID(), now: T0 }));
      expect(reward).toMatchObject({ xp: 20, points: 300, fundedBy: ['Sime Darby Property'] });
    }
    // A second drop-off earns XP again but no second reward: one per person.
    const again = await db.tx((tx) => recordAction(tx, { user: rewardUser(residents[0]!), activity: 'KITAR_DROPOFF', ref: randomUUID(), now: T0 }));
    expect(again).toMatchObject({ xp: 20, points: 0 });

    expect(await balanceOf(db, 'FUNDER_POOL', { campaignId: id })).toBe(12_000 - 7_500);
    const closed = await closeCampaign(db, w.admin, id, at(31));
    expect(closed.refundSen).toBe(4_500);
    expect(await balanceOf(db, 'FUNDER_POOL', { campaignId: id })).toBe(0);
    await expectFloatBalanced(db);
  });

  it('stops giving points the moment the pool runs out (BR4)', async () => {
    const id = await makeCampaign(w, { activity: 'JIRAN_HELP', budgetSen: 1_000, rewardPoints: 300, poolBps: 10_000, feeBps: 0, costsBps: 0 }); // pool = 1,000: three rewards
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await makeResident(w);
      results.push((await db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'JIRAN_HELP', ref: randomUUID(), now: T0 }))).points);
    }
    expect(results).toEqual([300, 300, 300, 0, 0]);
    expect(await balanceOf(db, 'FUNDER_POOL', { campaignId: id })).toBe(100);
  });

  it('gives nothing before the campaign is funded or outside its dates', async () => {
    await makeCampaign(w, { activity: 'KONGSI_SHARE' }, false); // never funded
    await makeCampaign(w, { activity: 'KONGSI_SHARE', startsAt: at(10), endsAt: at(20) }); // not started
    const r = await makeResident(w);
    const reward = await db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'KONGSI_SHARE', ref: randomUUID(), now: T0 }));
    expect(reward).toMatchObject({ xp: 30, points: 0 });
  });

  it('rewards a milestone such as "recycle 5 kg" each time the total passes it', async () => {
    await makeCampaign(w, { activity: 'GERAK_LOOP', goalMetric: 'QUANTITY', goalTarget: 5_000, rewardPoints: 200, perPersonCap: 2 });
    const r = await makeResident(w);
    const walk = (metres: number, day: number) =>
      db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'GERAK_LOOP', ref: randomUUID(), quantity: metres, now: at(day) }));
    expect((await walk(3_000, 0)).points).toBe(0);
    expect((await walk(3_000, 1)).points).toBe(200); // 6 km: first milestone
    expect((await walk(3_000, 2)).points).toBe(0); // 9 km
    expect((await walk(3_000, 3)).points).toBe(200); // 12 km: second milestone
    expect((await walk(9_000, 4)).points).toBe(0); // capped at two rewards
  });

  it('shows a sponsor only its own campaigns, and no numbers for a small group (BR16)', async () => {
    const sponsor = await makeSponsorUser(w);
    const rival = await makeSponsorUser(w);
    const id = await makeCampaign(w, { sponsorId: sponsor.sponsorId, activity: 'JIRAN_EVENT', rewardPoints: 100 });
    const r = await makeResident(w);
    await db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'JIRAN_EVENT', ref: randomUUID(), now: T0 }));

    await expect(campaignReport(db, rival, id, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const own = await campaignReport(db, sponsor, id, T0);
    expect(own).toMatchObject({ suppressed: true, results: null });
    const staffView = await campaignReport(db, w.staff, id, T0);
    expect(staffView.results).toMatchObject({ participants: 1, pointsIssued: 100 });
  });
});

describe('Impact XP', () => {
  it('counts each verified action once and respects the daily limit (BR4, BR6)', async () => {
    const r = await makeResident(w);
    const act = (ref: string) => db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'LAPOR_REPORT', ref, now: T0 }));
    expect((await act('report-1')).xp).toBe(25);
    expect(await act('report-1')).toMatchObject({ xp: 0, skipped: 'ALREADY_COUNTED' });
    await act('report-2');
    await act('report-3');
    expect(await act('report-4')).toMatchObject({ xp: 0, skipped: 'DAILY_LIMIT' });
    const total = await one<{ xp_total: number }>(db, 'SELECT xp_total FROM users WHERE id = $1', [r.id]);
    expect(total!.xp_total).toBe(75);
  });
});

describe('expiry (BR7, BR10)', () => {
  it('expires points after 12 months without activity and returns the value to the funder', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 10_000); // 100 points
    const poolBefore = await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId });
    const revenueBefore = await balanceOf(db, 'REVENUE_ISSUANCE_FEE');

    await expirePoints(db, at(360));
    expect(await walletOf(db, resident)).toBe(100); // not yet

    await expirePoints(db, at(367));
    expect(await walletOf(db, resident)).toBe(0);
    expect(await balanceOf(db, 'FUNDER_POOL', { merchantId: shop.merchantId })).toBe(poolBefore + 100);
    expect(await balanceOf(db, 'REVENUE_ISSUANCE_FEE')).toBe(revenueBefore); // never KITA+ income
    await expectFloatBalanced(db);
  });

  it('keeps points alive while the resident stays active, but never beyond 24 months', async () => {
    const shop = await makeMerchant(w, 100_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 10_000, T0); // 100 points
    await sell(w, shop, resident, 1_000, at(300)); // activity resets the 12-month clock
    await sell(w, shop, resident, 1_000, at(600));

    await expirePoints(db, at(700));
    expect(await walletOf(db, resident)).toBe(120);

    await expirePoints(db, at(732)); // the first batch is now 24 months old
    expect(await walletOf(db, resident)).toBe(20);
  });

  it('sends the value to the community pool when the campaign that funded it has closed', async () => {
    const id = await makeCampaign(w, { activity: 'JIMAT_SAVER', rewardPoints: 300 });
    const r = await makeResident(w);
    await db.tx((tx) => recordAction(tx, { user: rewardUser(r), activity: 'JIMAT_SAVER', ref: '2026-11', now: T0 }));
    await closeCampaign(db, w.admin, id, at(31));
    const communityBefore = await balanceOf(db, 'COMMUNITY_POOL');

    await expirePoints(db, at(400));
    expect(await walletOf(db, r)).toBe(0);
    expect(await balanceOf(db, 'COMMUNITY_POOL')).toBe(communityBefore + 300);
    await expectFloatBalanced(db);
  });

  it('reminds the resident 60 and 14 days before, once each', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    await sell(w, shop, resident, 10_000);
    const count = async () => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title LIKE '%expire within%'`, [resident.id]))!.n;

    await sendExpiryReminders(db, at(200));
    expect(await count()).toBe(0);
    await sendExpiryReminders(db, at(310));
    await sendExpiryReminders(db, at(311));
    expect(await count()).toBe(1);
    await sendExpiryReminders(db, at(355));
    expect(await count()).toBe(2);
  });
});

describe('controls', () => {
  it('passes the daily float check to the sen after everything above (BR9)', async () => {
    const check = await runFloatCheck(db, w.admin.id, T0);
    expect(check.issues).toEqual([]);
    expect(check.ok).toBe(true);
    const p = check.position;
    expect(p.trustSen).toBe(p.walletsSen + p.payablesSen + p.poolsSen + p.communitySen);
  });

  it('needs a second admin for a manual balance change (BR22)', async () => {
    await recordCommunityDeposit(db, w.admin, { amountSen: 5_000, bankRef: 'SDP-COMMUNITY-1' }, T0);
    const resident = await makeResident(w);
    const { id } = await requestAdjustment(db, w.admin, { memberCode: resident.memberCode!, points: 500, reason: 'Kiosk scanner was down on Saturday' }, T0);

    await expect(decideAdjustment(db, w.admin, id, true, T0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await walletOf(db, resident)).toBe(0);

    await decideAdjustment(db, w.admin2, id, true, T0);
    expect(await walletOf(db, resident)).toBe(500);
    await expect(decideAdjustment(db, w.admin2, id, true, T0)).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });

    const logged = await db.query(`SELECT action FROM audit_log WHERE entity_type = 'adjustment' AND entity_id = $1 ORDER BY id`, [id]);
    expect(logged.map((l) => l.action)).toEqual(['ADJUSTMENT_REQUESTED', 'ADJUSTMENT_APPROVED']);
    await expectFloatBalanced(db);
  });

  it('pauses all point movements when the float check fails', async () => {
    const shop = await makeMerchant(w, 10_000);
    const resident = await makeResident(w);
    // The bank statement disagrees with the ledger by one sen.
    const trust = await balanceOf(db, 'TRUST_BANK');
    const check = await runFloatCheck(db, w.admin.id, T0, trust - 1);
    expect(check.ok).toBe(false);
    expect((await getSettings(db)).issuance_paused).toBe(true);
    await expect(sell(w, shop, resident, 2_000)).rejects.toMatchObject({ code: 'PROGRAM_PAUSED' });

    await db.query('UPDATE program_settings SET issuance_paused = false');
    expect((await sell(w, shop, resident, 2_000)).pointsEarned).toBe(20);
  });
});
