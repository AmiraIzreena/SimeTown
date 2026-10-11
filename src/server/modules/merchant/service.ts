import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { credit, debit, getAccount } from '../ledger/ledger';
import { addPoints, assertNotPaused, earnAllowance, issueFromPool, removePoints } from '../ledger/points';
import { notify } from '../notifications';
import { liveOfferFor, offerAvailability, offerBalance, returnOfferPoints, spendOnOffer } from '../offers/service';
import { getSettings, type Settings } from '../settings';

/** KITA Merchant: give points on a sale, accept points as part-payment, refunds and statements. */

interface SaleRow {
  id: string;
  merchant_id: string;
  user_id: string;
  bill_sen: number;
  redeem_points: number;
  offer_id: string | null;
  offer_points: number;
  offer_title: string | null;
  success_fee_sen: number;
  points_earned: number;
  fee_sen: number;
  earn_note: 'POOL_EMPTY' | 'LIMIT_REACHED' | null;
  status: 'PENDING' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'REFUNDED';
  expires_at: Date | null;
  completed_at: Date | null;
  refunded_at: Date | null;
  refund_shortfall_sen: number | null;
  created_at: Date;
  merchant_name: string;
  member_name: string;
}

const SALE_SELECT = `
  SELECT s.id, s.merchant_id, s.user_id, s.bill_sen, s.redeem_points, s.offer_id, s.offer_points, o.title AS offer_title, s.success_fee_sen,
         s.points_earned, s.fee_sen, s.earn_note, s.status, s.expires_at, s.completed_at, s.refunded_at, s.refund_shortfall_sen, s.created_at,
         m.name AS merchant_name, u.full_name AS member_name
    FROM sales s JOIN merchants m ON m.id = s.merchant_id JOIN users u ON u.id = s.user_id LEFT JOIN shop_offers o ON o.id = s.offer_id`;

/** Shops see a first name and an initial, never the resident's full details. */
function shortName(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]}.` : first!;
}

function saleView(row: SaleRow, now: Date) {
  const expired = row.status === 'PENDING' && row.expires_at !== null && row.expires_at <= now;
  return {
    id: row.id,
    merchantName: row.merchant_name,
    memberName: shortName(row.member_name),
    billSen: row.bill_sen,
    redeemPoints: row.redeem_points,
    offerPoints: row.offer_points,
    offerTitle: row.offer_title,
    successFeeSen: row.success_fee_sen,
    cashSen: row.bill_sen - row.redeem_points - row.offer_points,
    pointsEarned: row.points_earned,
    feeSen: row.fee_sen,
    earnNote: row.earn_note,
    status: expired ? ('EXPIRED' as const) : row.status,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    refundedAt: row.refunded_at,
    refundShortfallSen: row.refund_shortfall_sen,
    createdAt: row.created_at,
  };
}
export type SaleView = ReturnType<typeof saleView>;

async function loadSale(q: Queryable, where: string, params: unknown[], lock = false): Promise<SaleRow | undefined> {
  return one<SaleRow>(q, `${SALE_SELECT} WHERE ${where} ${lock ? 'FOR UPDATE OF s' : ''}`, params);
}

/** BR12: from 100 points, in whole ringgit, and never more than 30% of the bill. */
export function maxRedeemable(billSen: number, s: Settings): number {
  const cap = Math.floor((billSen * s.max_redeem_bps) / 10_000);
  return cap - (cap % s.redeem_step_points);
}

function assertRedeemAllowed(billSen: number, points: number, s: Settings): void {
  if (points < s.min_redeem_points) {
    throw ruleViolation('REDEEM_MIN', `The smallest amount you can use is ${s.min_redeem_points} points.`);
  }
  if (points % s.redeem_step_points !== 0) {
    throw ruleViolation('REDEEM_STEP', `Points are used in steps of ${s.redeem_step_points} (whole ringgit).`);
  }
  const max = maxRedeemable(billSen, s);
  if (points > max) {
    throw ruleViolation('REDEEM_CAP', `Points can cover at most ${s.max_redeem_bps / 100}% of a bill: ${max} points here.`, { maxPoints: max });
  }
}

/**
 * Gives points on the part of the bill paid in cash (BR12: none on the part
 * paid with points). The shop's prefunded pool pays the points and the service
 * fee together (BR8, BR14). If the pool cannot cover them, the sale still
 * stands but no points are given: no pool, no points.
 */
async function completeSale(tx: Queryable, sale: SaleRow, homeId: string, s: Settings, now: Date): Promise<void> {
  // No points on the part of the bill paid with points or covered by a Shop Offer (BR12).
  let points = Math.floor((sale.bill_sen - sale.redeem_points - sale.offer_points) / 100) * s.points_per_ringgit;
  let note: SaleRow['earn_note'] = null;
  let fee = 0;
  if (points > 0) {
    const allowance = await earnAllowance(tx, { id: sale.user_id, homeId }, now, s);
    if (allowance < points) {
      points = allowance;
      note = 'LIMIT_REACHED';
    }
  }
  if (points > 0) {
    fee = Math.round((points * s.issuance_fee_bps) / 10_000);
    const pool = await getAccount(tx, 'FUNDER_POOL', { merchantId: sale.merchant_id }, true);
    if (pool.balance < points + fee) {
      points = 0;
      fee = 0;
      note = 'POOL_EMPTY';
    } else {
      await issueFromPool(tx, {
        userId: sale.user_id,
        poolAccountId: pool.id,
        points,
        feeSen: fee,
        source: 'PURCHASE',
        label: `${sale.merchant_name} · funded by the shop`,
        refType: 'sale',
        refId: sale.id,
        now,
        settings: s,
      });
    }
  }
  await tx.query(
    `UPDATE sales SET status = 'COMPLETED', completed_at = $2, points_earned = $3, fee_sen = $4, earn_note = $5 WHERE id = $1`,
    [sale.id, now, points, fee, note],
  );
}

export interface SaleInput {
  memberCode: string;
  billSen: number;
  redeemPoints: number;
  /** Use the shop's live Shop Offer with the resident's offer-backed points. */
  useOffer?: boolean;
  idempotencyKey: string;
}

/**
 * The cashier enters a sale. Without points it completes at once. With points
 * it waits for the resident to confirm on their own phone (BR12).
 */
export async function createSale(db: Db, actor: Actor, input: SaleInput, now: Date): Promise<SaleView> {
  const merchantId = actor.merchantId!;
  return db.tx(async (tx) => {
    const existing = await loadSale(tx, 's.merchant_id = $1 AND s.idempotency_key = $2', [merchantId, input.idempotencyKey]);
    if (existing) return saleView(existing, now);

    const merchant = await one<{ name: string; status: string; township_id: string }>(
      tx,
      'SELECT name, status, township_id FROM merchants WHERE id = $1',
      [merchantId],
    );
    if (merchant?.status !== 'ACTIVE') throw forbidden('This shop has not been approved yet.');
    const s = await getSettings(tx);
    assertNotPaused(s);

    // Only verified residents of this township can earn or spend here (BR1).
    const member = await one<{ id: string; home_id: string }>(
      tx,
      `SELECT id, home_id FROM users
        WHERE member_code = $1 AND township_id = $2 AND role = 'RESIDENT' AND status = 'ACTIVE' AND residency_status = 'VERIFIED'`,
      [input.memberCode.trim().toUpperCase(), merchant.township_id],
    );
    if (!member) throw notFound('Member');

    if (input.redeemPoints > 0) {
      assertRedeemAllowed(input.billSen, input.redeemPoints, s);
      const wallet = await getAccount(tx, 'WALLET', { userId: member.id });
      if (wallet.balance < input.redeemPoints) {
        throw ruleViolation('INSUFFICIENT_POINTS', 'This member does not have that many points.');
      }
    }
    // A Shop Offer is paid with offer-backed points only, on the shop's own terms (BR30).
    let offer: { id: string; points: number; title: string } | null = null;
    if (input.useOffer) {
      const live = await liveOfferFor(tx, merchantId, now, s.timezone);
      if (!live) throw ruleViolation('NO_OFFER', 'This shop has no live offer.');
      const availability = offerAvailability(live);
      if (!availability.usable) {
        throw ruleViolation(
          `OFFER_${availability.reason}`,
          availability.reason === 'BUDGET_USED' ? 'The offer has paused: this month’s budget is used up.' : 'The offer is not available at this time.',
        );
      }
      if (input.billSen <= live.discount_sen || input.billSen < live.min_spend_sen) {
        throw ruleViolation('OFFER_MIN_SPEND', `This offer needs a bill of at least RM${(Math.max(live.min_spend_sen, live.discount_sen + 1) / 100).toFixed(2)}.`);
      }
      if ((await offerBalance(tx, member.id)) < live.discount_sen) {
        throw ruleViolation('INSUFFICIENT_OFFER_POINTS', 'This member does not have enough offer-backed points for the offer.');
      }
      offer = { id: live.id, points: live.discount_sen, title: live.title };
    }
    if (input.redeemPoints + (offer?.points ?? 0) >= input.billSen) {
      throw ruleViolation('REDEEM_CAP', 'Points and the offer together must leave part of the bill to pay.');
    }
    const pending = input.redeemPoints > 0 || offer !== null;
    const inserted = await one<{ id: string }>(
      tx,
      `INSERT INTO sales (merchant_id, user_id, cashier_user_id, idempotency_key, bill_sen, redeem_points, offer_id, offer_points, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $9, $10, 'PENDING', $7::timestamptz + make_interval(mins => $8), $7)
       ON CONFLICT (merchant_id, idempotency_key) DO NOTHING RETURNING id`,
      [merchantId, member.id, actor.id, input.idempotencyKey, input.billSen, input.redeemPoints, now, s.redeem_confirm_minutes, offer?.id ?? null, offer?.points ?? 0],
    );
    if (!inserted) throw conflict('DUPLICATE_REQUEST', 'This sale is already being recorded.');
    const sale = (await loadSale(tx, 's.id = $1', [inserted.id]))!;

    if (pending) {
      const what = [input.redeemPoints > 0 && `${input.redeemPoints} points`, offer && `the offer “${offer.title}”`].filter(Boolean).join(' and ');
      await notify(tx, [member.id], {
        title: `Confirm ${what} at ${merchant.name}`,
        body: 'Open your wallet to confirm or decline.',
        link: '/app/wallet',
      });
    } else {
      await completeSale(tx, sale, member.home_id, s, now);
    }
    return saleView((await loadSale(tx, 's.id = $1', [sale.id]))!, now);
  });
}

/** The resident confirms or declines on their own phone. Only their own pending sales are visible to them. */
export async function decideSale(db: Db, actor: Actor, saleId: string, accept: boolean, now: Date): Promise<SaleView> {
  return db.tx(async (tx) => {
    const sale = await loadSale(tx, 's.id = $1 AND s.user_id = $2', [saleId, actor.id], true);
    if (!sale) throw notFound('Sale');
    if (sale.status !== 'PENDING') throw conflict('SALE_NOT_PENDING', 'This request has already been answered.');

    if (sale.expires_at! <= now || !accept) {
      const status = accept ? 'EXPIRED' : 'DECLINED';
      await tx.query('UPDATE sales SET status = $2 WHERE id = $1', [sale.id, status]);
      return saleView({ ...sale, status }, now);
    }

    const s = await getSettings(tx);
    assertNotPaused(s);
    if (sale.redeem_points > 0) {
      const payable = await getAccount(tx, 'MERCHANT_PAYABLE', { merchantId: sale.merchant_id }, true);
      // The shop is owed 100% of what it accepts; nobody pays a fee here (BR13).
      await removePoints(tx, {
        userId: sale.user_id,
        points: sale.redeem_points,
        kind: 'REDEEM',
        label: `Spent at ${sale.merchant_name}`,
        refType: 'sale',
        refId: sale.id,
        actorId: actor.id,
        now,
        countsAsActivity: true,
        otherEntries: [credit(payable.id, sale.redeem_points)],
      });
    }
    if (sale.offer_id) {
      // The shop gives the discount itself: no money moves through the float, only the success fee (BR30).
      const { successFeeSen } = await spendOnOffer(tx, {
        saleId: sale.id,
        offerId: sale.offer_id,
        merchantId: sale.merchant_id,
        userId: sale.user_id,
        points: sale.offer_points,
        billSen: sale.bill_sen,
        now,
        settings: s,
      });
      await tx.query('UPDATE sales SET success_fee_sen = $2 WHERE id = $1', [sale.id, successFeeSen]);
    }
    await completeSale(tx, sale, actor.homeId!, s, now);
    return saleView((await loadSale(tx, 's.id = $1', [sale.id]))!, now);
  });
}

/**
 * BR15. Points the resident spent come back as points, never cash. Points
 * earned on the sale are taken back; if some were already spent, the shortfall
 * is reported so the shop can deduct it from the cash refund.
 */
export async function refundSale(db: Db, actor: Actor, saleId: string, now: Date) {
  return db.tx(async (tx) => {
    const sale = await loadSale(tx, 's.id = $1 AND s.merchant_id = $2', [saleId, actor.merchantId], true);
    if (!sale) throw notFound('Sale');
    if (sale.status !== 'COMPLETED') throw conflict('SALE_NOT_REFUNDABLE', 'Only a completed sale can be refunded.');
    const s = await getSettings(tx);
    const pool = await getAccount(tx, 'FUNDER_POOL', { merchantId: sale.merchant_id }, true);

    if (sale.redeem_points > 0) {
      // Take the value back from what the float still owes the shop; if that was already paid out, from its pool.
      const payable = await getAccount(tx, 'MERCHANT_PAYABLE', { merchantId: sale.merchant_id }, true);
      const fromPayable = Math.min(payable.balance, sale.redeem_points);
      const fromPool = sale.redeem_points - fromPayable;
      if (fromPool > pool.balance) {
        throw ruleViolation('POOL_EMPTY', 'Top up your reward pool before refunding: the points for this sale were already paid out to you.');
      }
      await addPoints(tx, {
        userId: sale.user_id,
        points: sale.redeem_points,
        kind: 'REFUND_RETURN',
        source: 'REFUND_RETURN',
        funderAccountId: pool.id,
        label: `Refund from ${sale.merchant_name}`,
        refType: 'sale',
        refId: sale.id,
        actorId: actor.id,
        now,
        settings: s,
        otherEntries: [debit(payable.id, fromPayable), debit(pool.id, fromPool)],
      });
    }

    if (sale.offer_id && sale.offer_points > 0) {
      const member = await one<{ township_id: string }>(tx, 'SELECT township_id FROM users WHERE id = $1', [sale.user_id]);
      await returnOfferPoints(tx, {
        saleId: sale.id,
        offerId: sale.offer_id,
        userId: sale.user_id,
        townshipId: member!.township_id,
        points: sale.offer_points,
        completedAt: sale.completed_at!,
        merchantName: sale.merchant_name,
        now,
        settings: s,
      });
    }

    let shortfall = 0;
    if (sale.points_earned > 0) {
      const wallet = await getAccount(tx, 'WALLET', { userId: sale.user_id }, true);
      const clawback = Math.min(wallet.balance, sale.points_earned);
      shortfall = sale.points_earned - clawback;
      if (clawback > 0) {
        const issue = await one<{ id: string }>(
          tx,
          `SELECT id FROM ledger_txns WHERE ref_type = 'sale' AND ref_id = $1 AND kind = 'ISSUE'`,
          [sale.id],
        );
        await removePoints(tx, {
          userId: sale.user_id,
          points: clawback,
          kind: 'REFUND_CLAWBACK',
          label: `Refund at ${sale.merchant_name}`,
          refType: 'sale',
          refId: sale.id,
          actorId: actor.id,
          now,
          preferTxnId: issue?.id,
          otherEntries: [credit(pool.id, clawback)],
        });
      }
    }

    await tx.query(`UPDATE sales SET status = 'REFUNDED', refunded_at = $2, refund_shortfall_sen = $3 WHERE id = $1`, [sale.id, now, shortfall]);
    await audit(tx, actor.id, 'SALE_REFUNDED', 'sale', sale.id, { shortfallSen: shortfall });
    await notify(tx, [sale.user_id], {
      title: `Refund at ${sale.merchant_name}`,
      body:
        sale.redeem_points + sale.offer_points > 0
          ? `${sale.redeem_points + sale.offer_points} points are back in your wallet.`
          : 'The points earned on this purchase were taken back.',
      link: '/app/wallet',
    });
    return {
      sale: saleView((await loadSale(tx, 's.id = $1', [sale.id]))!, now),
      pointsReturned: sale.redeem_points + sale.offer_points,
      pointsTakenBack: sale.points_earned - shortfall,
      // Pay this much back in cash: what was paid in cash, less points that could not be recovered.
      cashRefundSen: sale.bill_sen - sale.redeem_points - sale.offer_points - shortfall,
    };
  });
}

export async function getSale(db: Db, actor: Actor, saleId: string, now: Date): Promise<SaleView> {
  const sale = await loadSale(db, 's.id = $1 AND s.merchant_id = $2', [saleId, actor.merchantId]);
  if (!sale) throw notFound('Sale');
  return saleView(sale, now);
}

export async function listSales(db: Db, actor: Actor, page: PageQuery, now: Date) {
  const [after, afterId] = decodeCursor(page.cursor, 'time');
  const rows = await db.query<SaleRow>(
    `${SALE_SELECT} WHERE s.merchant_id = $1
        AND ($2::timestamptz IS NULL OR (s.created_at, s.id) < ($2::timestamptz, $3::uuid))
      ORDER BY s.created_at DESC, s.id DESC LIMIT $4`,
    [actor.merchantId, after, afterId, page.limit + 1],
  );
  const result = toPage(rows, page.limit, (r) => [r.created_at, r.id]);
  return { items: result.items.map((r) => saleView(r, now)), nextCursor: result.nextCursor };
}

/** Sales waiting for this resident to confirm. */
export async function pendingForResident(q: Queryable, userId: string, now: Date): Promise<SaleView[]> {
  const rows = await q.query<SaleRow>(
    `${SALE_SELECT} WHERE s.user_id = $1 AND s.status = 'PENDING' AND s.expires_at > $2 ORDER BY s.created_at DESC`,
    [userId, now],
  );
  return rows.map((r) => saleView(r, now));
}

export async function merchantSummary(db: Db, actor: Actor, now: Date) {
  const merchant = await one<{ id: string; name: string; status: string; plan: string; category: string; akses_friendly: boolean }>(
    db,
    'SELECT id, name, status, plan, category, akses_friendly FROM merchants WHERE id = $1',
    [actor.merchantId],
  );
  if (!merchant) throw notFound('Shop');
  const s = await getSettings(db);
  // New and returning customers over 30 days: "returning" means they had bought here before the window.
  const [customers, offer, feesDue] = await Promise.all([
    one<{ customers: number; returning: number; offers_used: number }>(
      db,
      `SELECT count(DISTINCT s.user_id)::int AS customers,
              count(DISTINCT s.user_id) FILTER (WHERE EXISTS (
                SELECT 1 FROM sales e WHERE e.merchant_id = s.merchant_id AND e.user_id = s.user_id AND e.status = 'COMPLETED'
                   AND e.completed_at < $2::timestamptz - interval '30 days'))::int AS returning,
              count(*) FILTER (WHERE s.offer_id IS NOT NULL)::int AS offers_used
         FROM sales s WHERE s.merchant_id = $1 AND s.status = 'COMPLETED' AND s.completed_at >= $2::timestamptz - interval '30 days'`,
      [merchant.id, now],
    ),
    liveOfferFor(db, merchant.id, now, s.timezone),
    one<{ sen: number }>(db, `SELECT coalesce(sum(amount_sen), 0)::int AS sen FROM offer_fees WHERE merchant_id = $1 AND status = 'DUE'`, [merchant.id]),
  ]);
  const totals = await one<{ sales: number; bill_sen: number; points_given: number; fees_sen: number; points_accepted: number }>(
    db,
    `SELECT count(*)::int AS sales, coalesce(sum(bill_sen), 0)::int AS bill_sen,
            coalesce(sum(points_earned), 0)::int AS points_given, coalesce(sum(fee_sen), 0)::int AS fees_sen,
            coalesce(sum(redeem_points), 0)::int AS points_accepted
       FROM sales WHERE merchant_id = $1 AND status = 'COMPLETED' AND completed_at >= $2::timestamptz - interval '7 days'`,
    [merchant.id, now],
  );
  // Accounts exist only once the shop has been approved.
  const balances = await db.query<{ kind: string; balance: number }>(
    `SELECT kind, balance FROM ledger_accounts WHERE merchant_id = $1`,
    [merchant.id],
  );
  const balance = (kind: string) => balances.find((b) => b.kind === kind)?.balance ?? 0;
  return {
    merchant,
    poolSen: balance('FUNDER_POOL'),
    owedSen: balance('MERCHANT_PAYABLE'),
    last7Days: {
      sales: totals!.sales,
      billSen: totals!.bill_sen,
      pointsGiven: totals!.points_given,
      feesSen: totals!.fees_sen,
      pointsAccepted: totals!.points_accepted,
    },
    last30Days: { customers: customers!.customers, returning: customers!.returning, newCustomers: customers!.customers - customers!.returning, offersUsed: customers!.offers_used },
    liveOffer: offer
      ? { id: offer.id, title: offer.title, discountSen: offer.discount_sen, minSpendSen: offer.min_spend_sen, ...offerAvailability(offer), usedThisMonthSen: offer.pledge_used_sen, budgetThisMonthSen: offer.pledge_budget_sen ?? offer.monthly_budget_sen }
      : null,
    successFeesDueSen: feesDue!.sen,
    rules: {
      pointsPerRinggit: s.points_per_ringgit,
      feeBps: s.issuance_fee_bps,
      minRedeem: s.min_redeem_points,
      redeemStep: s.redeem_step_points,
      maxRedeemBps: s.max_redeem_bps,
      successFeeBps: s.offer_success_fee_bps,
    },
  };
}

/** A shop says whether it is easy to visit for disabled and elderly residents (shown as the Akses-friendly badge). */
export async function setAksesFriendly(db: Db, actor: Actor, aksesFriendly: boolean) {
  await db.query('UPDATE merchants SET akses_friendly = $2 WHERE id = $1', [actor.merchantId, aksesFriendly]);
  await audit(db, actor.id, 'SHOP_AKSES_FRIENDLY', 'merchant', actor.merchantId, { aksesFriendly });
  return { aksesFriendly };
}

/** Weekly statements: what the float paid the shop, with that week's activity beside it. */
export async function listStatements(db: Db, actor: Actor) {
  const merchantId = actor.merchantId;
  const settled = await db.query(
    `SELECT st.id, st.period_start, st.period_end, st.amount_sen, st.created_at AS paid_at, a.*
       FROM settlements st,
       LATERAL (
         SELECT count(*)::int AS sales, coalesce(sum(s.bill_sen), 0)::int AS bill_sen,
                coalesce(sum(s.points_earned), 0)::int AS points_given, coalesce(sum(s.fee_sen), 0)::int AS fees_sen,
                coalesce(sum(s.offer_points) FILTER (WHERE s.status = 'COMPLETED'), 0)::int AS offer_discounts_sen,
                coalesce(sum(s.success_fee_sen), 0)::int AS success_fees_sen
           FROM sales s
          WHERE s.merchant_id = st.merchant_id AND s.status IN ('COMPLETED', 'REFUNDED')
            AND (s.completed_at AT TIME ZONE $2)::date BETWEEN st.period_start AND st.period_end
       ) a
      WHERE st.merchant_id = $1 ORDER BY st.period_end DESC LIMIT 26`,
    [merchantId, (await getSettings(db)).timezone],
  );
  const owed = await one<{ balance: number }>(
    db,
    `SELECT balance FROM ledger_accounts WHERE merchant_id = $1 AND kind = 'MERCHANT_PAYABLE'`,
    [merchantId],
  );
  const due = await one<{ sen: number }>(db, `SELECT coalesce(sum(amount_sen), 0)::int AS sen FROM offer_fees WHERE merchant_id = $1 AND status = 'DUE'`, [merchantId]);
  return { dueThisWeekSen: owed?.balance ?? 0, successFeesDueSen: due!.sen, statements: settled };
}

/** Shops residents can visit, for the directory, with any live Shop Offer. */
export async function listActiveMerchants(q: Queryable, townshipId: string) {
  return q.query(
    `SELECT m.id, m.name, m.category, m.akses_friendly, concat_ws(', ', m.address_line, concat_ws(' ', m.postcode, m.city)) AS address,
            o.title AS offer_title, o.discount_sen AS offer_discount_sen
       FROM merchants m LEFT JOIN shop_offers o ON o.merchant_id = m.id AND o.status = 'ACTIVE'
      WHERE m.township_id = $1 AND m.status = 'ACTIVE' ORDER BY m.name`,
    [townshipId],
  );
}

/** The shop keeps its own business address up to date. */
export async function updateShopAddress(db: Db, actor: Actor, input: { addressLine: string; postcode: string; city: string; state: string }) {
  await db.query('UPDATE merchants SET address_line = $2, postcode = $3, city = $4, state = $5 WHERE id = $1', [
    actor.merchantId,
    input.addressLine,
    input.postcode,
    input.city,
    input.state,
  ]);
  return { ok: true };
}
