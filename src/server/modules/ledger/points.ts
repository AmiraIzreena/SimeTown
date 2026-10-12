import { one, type Db, type Queryable } from '../../db/client';
import { ruleViolation } from '../../errors';
import { notify } from '../notifications';
import { getSettings, startOf, type Settings } from '../settings';
import { credit, debit, getAccount, postTxn, systemAccounts, type Entry, type TxnKind } from './ledger';

/** Points operations built on the ledger. Every function here expects to run inside `db.tx`. */

export interface PointsUser {
  id: string;
  homeId: string;
}

export function assertNotPaused(settings: Settings): void {
  if (settings.issuance_paused) {
    throw ruleViolation('PROGRAM_PAUSED', 'Points are paused while the reward float is being checked. Please try again later.');
  }
}

/**
 * How many more points this resident may earn right now (BR6): the smallest of
 * the daily limit per person, the monthly limit per person and the monthly
 * limit per home. Locks the home so two earns for one household cannot race.
 */
export async function earnAllowance(tx: Queryable, user: PointsUser, now: Date, s: Settings): Promise<number> {
  await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [user.homeId]);
  const used = await one<{ day_person: number; month_person: number; month_home: number }>(
    tx,
    `SELECT
       coalesce(sum(l.amount) FILTER (WHERE l.user_id = $1 AND l.earned_at >= ${startOf('day', '$3', '$4')}), 0)::int AS day_person,
       coalesce(sum(l.amount) FILTER (WHERE l.user_id = $1), 0)::int AS month_person,
       coalesce(sum(l.amount), 0)::int AS month_home
     FROM point_lots l JOIN users u ON u.id = l.user_id
     WHERE u.home_id = $2 AND l.source IN ('PURCHASE', 'CAMPAIGN') AND l.earned_at >= ${startOf('month', '$3', '$4')}`,
    [user.id, user.homeId, now, s.timezone],
  );
  return Math.max(
    0,
    Math.min(
      s.points_daily_person - used!.day_person,
      s.points_monthly_person - used!.month_person,
      s.points_monthly_home - used!.month_home,
    ),
  );
}

interface Movement {
  userId: string;
  points: number;
  kind: TxnKind;
  label: string;
  refType?: string;
  refId?: string;
  actorId?: string | null;
  now: Date;
  /** The other side of the entry: where the value comes from, or goes to. Must total `points` plus any fee lines. */
  otherEntries: Entry[];
}

/**
 * Puts points into a resident's wallet and records the batch ("lot") with its
 * funder and expiry date (BR7, BR8). The caller supplies the funding entries,
 * so the money always leaves a prefunded account in the same transaction.
 */
export async function addPoints(
  tx: Queryable,
  m: Movement & { funderAccountId: string; source: 'PURCHASE' | 'CAMPAIGN' | 'ADJUSTMENT' | 'REFUND_RETURN'; settings: Settings },
): Promise<string> {
  const wallet = await getAccount(tx, 'WALLET', { userId: m.userId }, true);
  const txnId = await postTxn(tx, {
    kind: m.kind,
    label: m.label,
    refType: m.refType,
    refId: m.refId,
    actorId: m.actorId,
    at: m.now,
    entries: [credit(wallet.id, m.points), ...m.otherEntries],
  });
  await tx.query(
    `INSERT INTO point_lots (user_id, funder_account_id, txn_id, source, amount, remaining, earned_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $6::timestamptz + make_interval(months => $7))`,
    [m.userId, m.funderAccountId, txnId, m.source, m.points, m.now, m.settings.expiry_max_months],
  );
  // Earning counts as activity for the 12-month rule; a refund or correction does not.
  if (m.source === 'PURCHASE' || m.source === 'CAMPAIGN') {
    await tx.query('UPDATE users SET last_points_activity_at = $2 WHERE id = $1', [m.userId, m.now]);
  }
  return txnId;
}

/**
 * Gives points from a prefunded pool, charging the service fee to the same
 * pool (BR14). The fee is real money, so it also moves from the trust account
 * to SimeTown's operating account. Throws POOL_EMPTY if the pool cannot cover it.
 */
export async function issueFromPool(
  tx: Queryable,
  p: Omit<Movement, 'kind' | 'otherEntries'> & { poolAccountId: string; feeSen: number; source: 'PURCHASE' | 'CAMPAIGN'; settings: Settings },
): Promise<string> {
  const pool = await one<{ balance: number }>(tx, 'SELECT balance FROM ledger_accounts WHERE id = $1 FOR UPDATE', [p.poolAccountId]);
  if (!pool || pool.balance < p.points + p.feeSen) {
    throw ruleViolation('POOL_EMPTY', 'The reward pool cannot cover these points.');
  }
  const sys = await systemAccounts(tx);
  const feeEntries = p.feeSen
    ? [credit(sys.REVENUE_ISSUANCE_FEE, p.feeSen), debit(sys.OPERATING_BANK, p.feeSen), credit(sys.TRUST_BANK, p.feeSen)]
    : [];
  return addPoints(tx, {
    ...p,
    kind: 'ISSUE',
    funderAccountId: p.poolAccountId,
    otherEntries: [debit(p.poolAccountId, p.points + p.feeSen), ...feeEntries],
  });
}

/** Uses up a resident's batches, oldest expiry first, optionally starting with the batch from one transaction. */
async function consumeLots(tx: Queryable, userId: string, points: number, spentAtShop: boolean, preferTxnId?: string): Promise<void> {
  const lots = await tx.query<{ id: string; remaining: number }>(
    `SELECT id, remaining FROM point_lots WHERE user_id = $1 AND remaining > 0
      ORDER BY (txn_id IS NOT DISTINCT FROM $2::uuid) DESC, expires_at, earned_at, id FOR UPDATE`,
    [userId, preferTxnId ?? null],
  );
  let left = points;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    await tx.query('UPDATE point_lots SET remaining = remaining - $2, redeemed = redeemed + $3 WHERE id = $1', [
      lot.id,
      take,
      spentAtShop ? take : 0,
    ]);
    left -= take;
  }
  if (left > 0) throw new Error(`Point lots for user ${userId} are ${left} short of the wallet balance`);
}

/** Takes points out of a wallet. Throws INSUFFICIENT_POINTS if the resident does not hold enough. */
export async function removePoints(
  tx: Queryable,
  m: Movement & { preferTxnId?: string; countsAsActivity?: boolean },
): Promise<string> {
  const wallet = await getAccount(tx, 'WALLET', { userId: m.userId }, true);
  if (wallet.balance < m.points) throw ruleViolation('INSUFFICIENT_POINTS', 'There are not enough points for this.');
  await consumeLots(tx, m.userId, m.points, m.kind === 'REDEEM', m.preferTxnId);
  if (m.countsAsActivity) {
    await tx.query('UPDATE users SET last_points_activity_at = $2 WHERE id = $1', [m.userId, m.now]);
  }
  return postTxn(tx, {
    kind: m.kind,
    label: m.label,
    refType: m.refType,
    refId: m.refId,
    actorId: m.actorId,
    at: m.now,
    entries: [debit(wallet.id, m.points), ...m.otherEntries],
  });
}

/**
 * Expires one resident's open batches that match `where`. The value goes back
 * to the funder's pool, or to the community pool if that campaign has closed.
 * It never becomes SimeTown income (BR10).
 */
export async function expireLotsForUser(
  tx: Queryable,
  userId: string,
  where: { all: true } | { lotIds: string[] },
  now: Date,
  label: string,
): Promise<number> {
  const wallet = await getAccount(tx, 'WALLET', { userId }, true);
  const lots = await tx.query<{ id: string; remaining: number; funder_account_id: string; funder_open: boolean }>(
    `SELECT l.id, l.remaining, l.funder_account_id,
            (a.kind = 'FUNDER_POOL' AND (a.campaign_id IS NULL OR c.status <> 'CLOSED')) AS funder_open
       FROM point_lots l
       JOIN ledger_accounts a ON a.id = l.funder_account_id
       LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE l.user_id = $1 AND l.remaining > 0 AND ($2::uuid[] IS NULL OR l.id = ANY($2::uuid[]))
      FOR UPDATE OF l`,
    [userId, 'all' in where ? null : where.lotIds],
  );
  if (lots.length === 0) return 0;

  const communityPool = (await systemAccounts(tx)).COMMUNITY_POOL;
  const byDestination = new Map<string, number>();
  for (const lot of lots) {
    const destination = lot.funder_open ? lot.funder_account_id : communityPool;
    byDestination.set(destination, (byDestination.get(destination) ?? 0) + lot.remaining);
  }
  const total = lots.reduce((sum, lot) => sum + lot.remaining, 0);
  await tx.query('UPDATE point_lots SET remaining = 0 WHERE id = ANY($1::uuid[])', [lots.map((l) => l.id)]);
  await postTxn(tx, {
    kind: 'EXPIRE',
    label,
    at: now,
    entries: [debit(wallet.id, total), ...[...byDestination].map(([accountId, amount]) => credit(accountId, amount))],
  });
  return total;
}

/**
 * Daily job (BR7). A batch expires 24 months after it was earned, or when the
 * account has neither earned nor redeemed for 12 months, whichever is first.
 */
export async function expirePoints(db: Db, now: Date): Promise<{ users: number; points: number }> {
  const s = await getSettings(db);
  const due = await db.query<{ user_id: string; lot_ids: string[] }>(
    `SELECT l.user_id, array_agg(l.id) AS lot_ids
       FROM point_lots l JOIN users u ON u.id = l.user_id
      WHERE l.remaining > 0
        AND (l.expires_at <= $1
             OR coalesce(u.last_points_activity_at, l.earned_at) + make_interval(months => $2) <= $1)
      GROUP BY l.user_id`,
    [now, s.expiry_inactive_months],
  );
  let points = 0;
  for (const row of due) {
    points += await db.tx(async (tx) => {
      const expired = await expireLotsForUser(tx, row.user_id, { lotIds: row.lot_ids }, now, 'Expired points');
      if (expired > 0) {
        await notify(tx, [row.user_id], {
          title: `${expired} points have expired`,
          body: 'Points expire after 12 months without earning or spending, or 24 months after they were earned.',
          link: '/app/wallet',
        });
      }
      return expired;
    });
  }
  return { users: due.length, points };
}

/** Daily job: remind residents 60 and 14 days before points expire (BR7). Each reminder is sent once. */
export async function sendExpiryReminders(db: Db, now: Date): Promise<number> {
  const s = await getSettings(db);
  const rows = await db.query<{ user_id: string; days: number; points: number; on_date: string }>(
    `WITH due AS (
       SELECT l.user_id, l.remaining,
              LEAST(l.expires_at, coalesce(u.last_points_activity_at, l.earned_at) + make_interval(months => $2)) AS expires
         FROM point_lots l JOIN users u ON u.id = l.user_id
        WHERE l.remaining > 0 AND u.status = 'ACTIVE'
     )
     SELECT user_id, w.days, sum(remaining)::int AS points, min(expires)::date::text AS on_date
       FROM due CROSS JOIN (VALUES (60, 14), (14, 0)) AS w(days, after)
      WHERE expires > $1::timestamptz + make_interval(days => w.after)
        AND expires <= $1::timestamptz + make_interval(days => w.days)
      GROUP BY user_id, w.days`,
    [now, s.expiry_inactive_months],
  );
  let sent = 0;
  for (const row of rows) {
    sent += await notify(db, [row.user_id], {
      title: `${row.points} points expire within ${row.days} days`,
      body: `Use them at any member shop before ${row.on_date}, or they will expire.`,
      link: '/app/wallet',
      dedupeKey: `expiry:${row.user_id}:${row.days}:${row.on_date}`,
    });
  }
  return sent;
}
