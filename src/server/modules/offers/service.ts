import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { credit, debit, getAccount, postTxn, systemAccounts } from '../ledger/ledger';
import { getSettings, startOf, type Settings } from '../settings';

/**
 * Shop Offers and offer-backed points (proposal sections 8 and 9, BR29 and BR30).
 *
 * A shop promises a monthly discount budget for its offer. Residents earn
 * offer-backed points from verified green actions, but never more in a month
 * than the shops of their township have promised: no pledge, no points. A
 * resident spends them on a shop's offer, on that shop's terms, and the offer
 * pauses when the shop's budget for the month is used up.
 *
 * Offer-backed points have no cash behind them. They are kept apart from the
 * double-entry ledger, so they can never touch the reward float. The only
 * money involved is the success fee (10% of a discount used), which is real
 * money and goes through the ledger like the issuance fee.
 */

/** The first day of the current month in the township's time zone, as 'YYYY-MM-DD'. */
export async function currentMonth(q: Queryable, now: Date, tz: string): Promise<string> {
  const row = await one<{ month: string }>(q, `SELECT date_trunc('month', $1::timestamptz AT TIME ZONE $2)::date::text AS month`, [now, tz]);
  return row!.month;
}

/** Makes this month's promise for every live offer in the township. A promise, once made, is fixed for the month. */
export async function ensurePledges(tx: Queryable, townshipId: string, month: string): Promise<void> {
  await tx.query(
    `INSERT INTO offer_pledges (offer_id, month, township_id, budget_sen)
     SELECT o.id, $2::date, m.township_id, o.monthly_budget_sen
       FROM shop_offers o JOIN merchants m ON m.id = o.merchant_id
      WHERE m.township_id = $1 AND o.status = 'ACTIVE' AND m.status = 'ACTIVE'
     ON CONFLICT (offer_id, month) DO NOTHING`,
    [townshipId, month],
  );
}

export interface OfferRule {
  offer_points: number;
  offer_per_quantity: number | null;
}

/** How many offer-backed points one action is worth under its activity rule. */
export const offerPointsFor = (rule: OfferRule, quantity: number) =>
  rule.offer_per_quantity ? rule.offer_points * Math.floor(quantity / rule.offer_per_quantity) : rule.offer_points;

/**
 * Gives offer-backed points for a verified action, up to the smallest of: what
 * the action is worth, what is left of the township's pledges this month
 * (BR29), and the household's monthly limit. The township's month row is
 * locked, so two awards can never both take the last of the pledge. Expects
 * the caller to hold the home lock (recordAction does).
 */
export async function giveOfferPoints(
  tx: Queryable,
  input: { userId: string; homeId: string; townshipId: string; points: number; ref: string; label: string; now: Date; settings: Settings },
): Promise<number> {
  if (input.points <= 0 || input.settings.issuance_paused) return 0;
  const month = await currentMonth(tx, input.now, input.settings.timezone);
  await ensurePledges(tx, input.townshipId, month);
  await tx.query('INSERT INTO offer_months (township_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING', [input.townshipId, month]);
  const issued = await one<{ issued_points: number }>(tx, 'SELECT issued_points FROM offer_months WHERE township_id = $1 AND month = $2 FOR UPDATE', [input.townshipId, month]);
  const pledged = await one<{ total: number }>(tx, 'SELECT coalesce(sum(budget_sen), 0)::int AS total FROM offer_pledges WHERE township_id = $1 AND month = $2', [input.townshipId, month]);
  const home = await one<{ used: number }>(
    tx,
    `SELECT coalesce(sum(l.amount), 0)::int AS used FROM offer_point_lots l JOIN users u ON u.id = l.user_id
      WHERE u.home_id = $1 AND l.source = 'ACTION' AND l.pledge_month = $2`,
    [input.homeId, month],
  );
  const give = Math.max(0, Math.min(input.points, pledged!.total - issued!.issued_points, input.settings.offer_points_monthly_home - home!.used));
  if (give === 0) return 0;
  await tx.query(
    `INSERT INTO offer_point_lots (user_id, township_id, pledge_month, source, label, ref, amount, remaining, earned_at, expires_at)
     VALUES ($1, $2, $3, 'ACTION', $4, $5, $6, $6, $7, $7::timestamptz + make_interval(months => $8))`,
    [input.userId, input.townshipId, month, input.label, input.ref, give, input.now, input.settings.expiry_max_months],
  );
  await tx.query('UPDATE offer_months SET issued_points = issued_points + $3 WHERE township_id = $1 AND month = $2', [input.townshipId, month, give]);
  await tx.query('UPDATE users SET last_points_activity_at = $2 WHERE id = $1', [input.userId, input.now]);
  return give;
}

export async function offerBalance(q: Queryable, userId: string): Promise<number> {
  return (await one<{ n: number }>(q, 'SELECT coalesce(sum(remaining), 0)::int AS n FROM offer_point_lots WHERE user_id = $1 AND remaining > 0', [userId]))!.n;
}

// --- Offers as a shop sees them --------------------------------------------------

export interface OfferRow {
  id: string;
  merchant_id: string;
  merchant_name: string;
  township_id: string;
  title: string;
  discount_sen: number;
  min_spend_sen: number;
  days_mask: number;
  start_minute: number;
  end_minute: number;
  monthly_budget_sen: number;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  created_at: Date;
  /** This month's promise and how much of it has been used. */
  pledge_budget_sen: number | null;
  pledge_used_sen: number;
  /** Whether the day and time are inside the offer's window right now. */
  in_window: boolean;
}

const OFFER_SELECT = `
  SELECT o.id, o.merchant_id, m.name AS merchant_name, m.township_id, o.title, o.discount_sen, o.min_spend_sen, o.days_mask,
         o.start_minute, o.end_minute, o.monthly_budget_sen, o.status, o.created_at,
         p.budget_sen AS pledge_budget_sen, coalesce(p.used_sen, 0)::int AS pledge_used_sen,
         ((o.days_mask & (1 << (extract(isodow FROM $1::timestamptz AT TIME ZONE $2)::int - 1))) <> 0
           AND (extract(hour FROM $1::timestamptz AT TIME ZONE $2) * 60 + extract(minute FROM $1::timestamptz AT TIME ZONE $2))
               BETWEEN o.start_minute AND o.end_minute - 1) AS in_window
    FROM shop_offers o
    JOIN merchants m ON m.id = o.merchant_id
    LEFT JOIN offer_pledges p ON p.offer_id = o.id AND p.month = date_trunc('month', $1::timestamptz AT TIME ZONE $2)::date`;

/** Whether a resident can use this offer right now, and if not, why not. */
export function offerAvailability(o: OfferRow): { usable: boolean; reason: 'PAUSED' | 'ENDED' | 'BUDGET_USED' | 'OUTSIDE_HOURS' | null } {
  if (o.status !== 'ACTIVE') return { usable: false, reason: o.status === 'PAUSED' ? 'PAUSED' : 'ENDED' };
  const budget = o.pledge_budget_sen ?? o.monthly_budget_sen;
  if (o.pledge_used_sen + o.discount_sen > budget) return { usable: false, reason: 'BUDGET_USED' };
  if (!o.in_window) return { usable: false, reason: 'OUTSIDE_HOURS' };
  return { usable: true, reason: null };
}

const offerView = (o: OfferRow) => ({
  id: o.id,
  merchantId: o.merchant_id,
  merchantName: o.merchant_name,
  title: o.title,
  discountSen: o.discount_sen,
  pointsCost: o.discount_sen,
  minSpendSen: o.min_spend_sen,
  daysMask: o.days_mask,
  startMinute: o.start_minute,
  endMinute: o.end_minute,
  monthlyBudgetSen: o.monthly_budget_sen,
  status: o.status,
  usedThisMonthSen: o.pledge_used_sen,
  budgetThisMonthSen: o.pledge_budget_sen ?? (o.status === 'ACTIVE' ? o.monthly_budget_sen : 0),
  ...offerAvailability(o),
  createdAt: o.created_at,
});
export type OfferView = ReturnType<typeof offerView>;

export async function loadOffer(q: Queryable, where: string, params: unknown[], now: Date, tz: string, lock = false): Promise<OfferRow | undefined> {
  return one<OfferRow>(q, `${OFFER_SELECT} WHERE ${where} ${lock ? 'FOR UPDATE OF o' : ''}`, [now, tz, ...params]);
}

/** The shop's live offer, if it has one. */
export async function liveOfferFor(q: Queryable, merchantId: string, now: Date, tz: string): Promise<OfferRow | undefined> {
  return loadOffer(q, `o.merchant_id = $3 AND o.status = 'ACTIVE'`, [merchantId], now, tz);
}

export async function listOffersForMerchant(db: Db, actor: Actor, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const rows = await db.query<OfferRow>(`${OFFER_SELECT} WHERE o.merchant_id = $3 ORDER BY (o.status = 'ACTIVE') DESC, o.created_at DESC LIMIT 50`, [now, tz, actor.merchantId]);
  const month = await one<{ offers_used: number; discount_sen: number; fees_sen: number; fees_due_sen: number }>(
    db,
    `SELECT count(*)::int AS offers_used, coalesce(sum(s.offer_points), 0)::int AS discount_sen, coalesce(sum(s.success_fee_sen), 0)::int AS fees_sen,
            (SELECT coalesce(sum(amount_sen), 0)::int FROM offer_fees WHERE merchant_id = $1 AND status = 'DUE') AS fees_due_sen
       FROM sales s WHERE s.merchant_id = $1 AND s.offer_id IS NOT NULL AND s.status = 'COMPLETED' AND s.completed_at >= ${startOf('month', '$2', '$3')}`,
    [actor.merchantId, now, tz],
  );
  return { offers: rows.map(offerView), thisMonth: month };
}

export interface OfferInput {
  title: string;
  discountSen: number;
  minSpendSen: number;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  monthlyBudgetSen: number;
}

/** A shop sets its own terms and monthly cap (BR30). Its promise for this month is made at once. */
export async function createOffer(db: Db, actor: Actor, input: OfferInput, now: Date) {
  if (input.endMinute <= input.startMinute) throw ruleViolation('OFFER_HOURS', 'The offer must end after it starts.');
  if (input.monthlyBudgetSen < input.discountSen) throw ruleViolation('OFFER_BUDGET', 'The monthly budget must cover at least one discount.');
  if (input.minSpendSen > 0 && input.minSpendSen <= input.discountSen) throw ruleViolation('OFFER_MIN_SPEND', 'The minimum spend must be more than the discount.');
  return db.tx(async (tx) => {
    const merchant = await one<{ status: string; township_id: string }>(tx, 'SELECT status, township_id FROM merchants WHERE id = $1 FOR UPDATE', [actor.merchantId]);
    if (merchant?.status !== 'ACTIVE') throw forbidden('This shop has not been approved yet.');
    if (await one(tx, `SELECT 1 FROM shop_offers WHERE merchant_id = $1 AND status = 'ACTIVE'`, [actor.merchantId])) {
      throw conflict('OFFER_EXISTS', 'Your shop already has a live offer. Pause or end it first.');
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO shop_offers (merchant_id, title, discount_sen, min_spend_sen, days_mask, start_minute, end_minute, monthly_budget_sen, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [actor.merchantId, input.title, input.discountSen, input.minSpendSen, input.daysMask, input.startMinute, input.endMinute, input.monthlyBudgetSen, actor.id, now],
    );
    await ensurePledges(tx, merchant.township_id, await currentMonth(tx, now, (await getSettings(tx)).timezone));
    await audit(tx, actor.id, 'OFFER_CREATED', 'shop_offer', row!.id, { ...input });
    return { id: row!.id };
  });
}

/**
 * Pause, resume or end an offer. This month's promise stands even when paused:
 * residents may already have earned points against it.
 */
export async function setOfferStatus(db: Db, actor: Actor, offerId: string, status: 'ACTIVE' | 'PAUSED' | 'ENDED', now: Date) {
  return db.tx(async (tx) => {
    const offer = await one<{ status: string; township_id: string }>(
      tx,
      `SELECT o.status, m.township_id FROM shop_offers o JOIN merchants m ON m.id = o.merchant_id WHERE o.id = $1 AND o.merchant_id = $2 FOR UPDATE OF o`,
      [offerId, actor.merchantId],
    );
    if (!offer) throw notFound('Offer');
    if (offer.status === 'ENDED') throw conflict('OFFER_ENDED', 'This offer has ended. Create a new one instead.');
    if (status === 'ACTIVE' && (await one(tx, `SELECT 1 FROM shop_offers WHERE merchant_id = $1 AND status = 'ACTIVE' AND id <> $2`, [actor.merchantId, offerId]))) {
      throw conflict('OFFER_EXISTS', 'Your shop already has a live offer.');
    }
    await tx.query('UPDATE shop_offers SET status = $2 WHERE id = $1', [offerId, status]);
    if (status === 'ACTIVE') await ensurePledges(tx, offer.township_id, await currentMonth(tx, now, (await getSettings(tx)).timezone));
    await audit(tx, actor.id, 'OFFER_STATUS', 'shop_offer', offerId, { from: offer.status, to: status });
    return { status };
  });
}

/** Live offers in the resident's township, with whether each can be used right now. */
export async function listLiveOffers(db: Db, townshipId: string, now: Date) {
  const tz = (await getSettings(db)).timezone;
  const rows = await db.query<OfferRow>(`${OFFER_SELECT} WHERE m.township_id = $3 AND m.status = 'ACTIVE' AND o.status = 'ACTIVE' ORDER BY m.name`, [now, tz, townshipId]);
  return rows.map(offerView);
}

/** The township's pledges this month against what has been given, for residents and staff. */
export async function pledgeSummary(q: Queryable, townshipId: string | null, now: Date, tz: string) {
  const row = await one<{ month: string; pledged: number; issued: number; used: number; shops: number }>(
    q,
    `WITH m AS (SELECT date_trunc('month', $2::timestamptz AT TIME ZONE $3)::date AS month)
     SELECT m.month::text AS month,
            (SELECT coalesce(sum(budget_sen), 0)::int FROM offer_pledges p WHERE p.month = m.month AND ($1::uuid IS NULL OR p.township_id = $1)) AS pledged,
            (SELECT coalesce(sum(used_sen), 0)::int FROM offer_pledges p WHERE p.month = m.month AND ($1::uuid IS NULL OR p.township_id = $1)) AS used,
            (SELECT coalesce(sum(issued_points), 0)::int FROM offer_months o WHERE o.month = m.month AND ($1::uuid IS NULL OR o.township_id = $1)) AS issued,
            (SELECT count(*)::int FROM offer_pledges p WHERE p.month = m.month AND ($1::uuid IS NULL OR p.township_id = $1)) AS shops
       FROM m`,
    [townshipId, now, tz],
  );
  return row!;
}

// --- Using an offer at the counter ------------------------------------------------

/**
 * Takes the offer's points from the resident, oldest expiry first, and counts the
 * discount against the shop's promise for this month. Refused if the promise
 * would be passed: the offer has paused (BR30).
 */
export async function spendOnOffer(
  tx: Queryable,
  input: { saleId: string; offerId: string; merchantId: string; userId: string; points: number; billSen: number; now: Date; settings: Settings },
): Promise<{ successFeeSen: number }> {
  const s = input.settings;
  const offer = await loadOffer(tx, 'o.id = $3 AND o.merchant_id = $4', [input.offerId, input.merchantId], input.now, s.timezone, true);
  if (!offer) throw notFound('Offer');
  if (offer.discount_sen !== input.points) throw conflict('OFFER_CHANGED', 'This offer has changed. Please start the sale again.');
  if (input.billSen <= offer.discount_sen || input.billSen < offer.min_spend_sen) {
    throw ruleViolation('OFFER_MIN_SPEND', 'This bill does not meet the offer’s minimum spend.');
  }
  const month = await currentMonth(tx, input.now, s.timezone);
  await ensurePledges(tx, offer.township_id, month);
  const pledge = await one<{ budget_sen: number; used_sen: number }>(tx, 'SELECT budget_sen, used_sen FROM offer_pledges WHERE offer_id = $1 AND month = $2 FOR UPDATE', [offer.id, month]);
  const availability = offerAvailability({ ...offer, pledge_budget_sen: pledge?.budget_sen ?? null, pledge_used_sen: pledge?.used_sen ?? 0 });
  if (!pledge || !availability.usable) {
    const why = availability.reason === 'BUDGET_USED' ? 'The shop’s offer budget for this month is used up.' : availability.reason === 'OUTSIDE_HOURS' ? 'This offer is not available at this time.' : 'This offer is not available right now.';
    throw ruleViolation(`OFFER_${availability.reason ?? 'UNAVAILABLE'}`, why);
  }

  const lots = await tx.query<{ id: string; remaining: number }>(
    'SELECT id, remaining FROM offer_point_lots WHERE user_id = $1 AND remaining > 0 ORDER BY expires_at, earned_at, id FOR UPDATE',
    [input.userId],
  );
  if (lots.reduce((sum, l) => sum + l.remaining, 0) < input.points) {
    throw ruleViolation('INSUFFICIENT_OFFER_POINTS', 'There are not enough offer-backed points for this offer.');
  }
  let left = input.points;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    await tx.query('UPDATE offer_point_lots SET remaining = remaining - $2, redeemed = redeemed + $2 WHERE id = $1', [lot.id, take]);
    left -= take;
  }
  await tx.query('UPDATE offer_pledges SET used_sen = used_sen + $3 WHERE offer_id = $1 AND month = $2', [offer.id, month, input.points]);
  await tx.query('UPDATE users SET last_points_activity_at = $2 WHERE id = $1', [input.userId, input.now]);

  const fee = Math.round((offer.discount_sen * s.offer_success_fee_bps) / 10_000);
  if (fee > 0) {
    await tx.query('INSERT INTO offer_fees (sale_id, merchant_id, amount_sen, created_at) VALUES ($1, $2, $3, $4)', [input.saleId, input.merchantId, fee, input.now]);
    await collectDueOfferFees(tx, input.merchantId, input.now);
  }
  return { successFeeSen: fee };
}

/**
 * Collects success fees a shop owes: from its reward pool first, then from what
 * the float owes it this week. A fee neither can cover waits, and is collected
 * at the next top-up or settlement. Each fee moves real money from the trust
 * account to SimeTown's operating account, so the float stays matched (BR9).
 */
export async function collectDueOfferFees(tx: Queryable, merchantId: string, now: Date): Promise<number> {
  const due = await tx.query<{ sale_id: string; amount_sen: number }>(
    `SELECT sale_id, amount_sen FROM offer_fees WHERE merchant_id = $1 AND status = 'DUE' ORDER BY created_at, sale_id FOR UPDATE`,
    [merchantId],
  );
  if (due.length === 0) return 0;
  const pool = await getAccount(tx, 'FUNDER_POOL', { merchantId }, true);
  const payable = await getAccount(tx, 'MERCHANT_PAYABLE', { merchantId }, true);
  const name = (await one<{ name: string }>(tx, 'SELECT name FROM merchants WHERE id = $1', [merchantId]))!.name;
  const sys = await systemAccounts(tx);
  let poolLeft = pool.balance;
  let payableLeft = payable.balance;
  let collected = 0;
  for (const fee of due) {
    const source = poolLeft >= fee.amount_sen ? pool.id : payableLeft >= fee.amount_sen ? payable.id : null;
    if (!source) break;
    const txnId = await postTxn(tx, {
      kind: 'OFFER_FEE',
      label: `Shop Offer success fee · ${name}`,
      refType: 'sale',
      refId: fee.sale_id,
      at: now,
      entries: [debit(source, fee.amount_sen), credit(sys.REVENUE_SUCCESS_FEE, fee.amount_sen), debit(sys.OPERATING_BANK, fee.amount_sen), credit(sys.TRUST_BANK, fee.amount_sen)],
    });
    await tx.query(`UPDATE offer_fees SET status = 'PAID', txn_id = $2, paid_at = $3 WHERE sale_id = $1`, [fee.sale_id, txnId, now]);
    if (source === pool.id) poolLeft -= fee.amount_sen;
    else payableLeft -= fee.amount_sen;
    collected += fee.amount_sen;
  }
  return collected;
}

/**
 * A refund returns offer points as offer points (BR15) and gives the discount
 * back to the shop's promise for the month the sale was made in. The success
 * fee is kept, as the issuance fee is on a refund.
 */
export async function returnOfferPoints(
  tx: Queryable,
  input: { saleId: string; offerId: string; userId: string; townshipId: string; points: number; completedAt: Date; merchantName: string; now: Date; settings: Settings },
): Promise<void> {
  const month = await currentMonth(tx, input.completedAt, input.settings.timezone);
  await tx.query('UPDATE offer_pledges SET used_sen = GREATEST(0, used_sen - $3) WHERE offer_id = $1 AND month = $2', [input.offerId, month, input.points]);
  await tx.query(
    `INSERT INTO offer_point_lots (user_id, township_id, pledge_month, source, label, ref, amount, remaining, earned_at, expires_at)
     VALUES ($1, $2, $3, 'REFUND_RETURN', $4, $5, $6, $6, $7, $7::timestamptz + make_interval(months => $8))`,
    [input.userId, input.townshipId, month, `Refund from ${input.merchantName}`, `sale:${input.saleId}`, input.points, input.now, input.settings.expiry_max_months],
  );
}

/** Daily job: offer-backed points follow the same expiry rule as every point (BR7). Nothing goes back anywhere: no cash stood behind them. */
export async function expireOfferPoints(db: Db, now: Date): Promise<number> {
  const s = await getSettings(db);
  const rows = await db.query<{ n: number }>(
    `WITH due AS (
       UPDATE offer_point_lots l SET remaining = 0
         FROM users u
        WHERE u.id = l.user_id AND l.remaining > 0
          AND (l.expires_at <= $1 OR coalesce(u.last_points_activity_at, l.earned_at) + make_interval(months => $2) <= $1)
       RETURNING l.remaining
     ) SELECT count(*)::int AS n FROM due`,
    [now, s.expiry_inactive_months],
  );
  return rows[0]!.n;
}

/** The resident's offer-backed batches, newest first, each with what stood behind it. */
export async function offerHistory(q: Queryable, userId: string) {
  return q.query(
    `SELECT id, source, label, amount, remaining, redeemed, pledge_month::text AS pledge_month, earned_at, expires_at
       FROM offer_point_lots WHERE user_id = $1 ORDER BY earned_at DESC LIMIT 30`,
    [userId],
  );
}
