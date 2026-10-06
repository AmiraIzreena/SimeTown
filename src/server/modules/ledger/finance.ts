import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { credit, debit, getAccount, lockAccountById, postTxn, systemAccounts } from './ledger';
import { addPoints, removePoints } from './points';

/** Money in, money out, and the controls around the float. Admin-only operations. */

/** A shop pays money into its reward pool. Recorded when the transfer is seen in the trust account. */
export async function recordMerchantDeposit(
  db: Db,
  actor: Actor,
  merchantId: string,
  input: { amountSen: number; bankRef: string },
  now: Date,
) {
  return db.tx(async (tx) => {
    const merchant = await one<{ name: string; status: string; township_id: string }>(
      tx,
      'SELECT name, status, township_id FROM merchants WHERE id = $1',
      [merchantId],
    );
    if (!merchant) throw notFound('Shop');
    assertTownshipAccess(actor, merchant.township_id);
    if (merchant.status !== 'ACTIVE') throw ruleViolation('MERCHANT_NOT_ACTIVE', 'Approve the shop before recording money for it.');
    if (await one(tx, 'SELECT 1 FROM deposits WHERE bank_ref = $1', [input.bankRef])) {
      throw conflict('DUPLICATE_BANK_REF', 'A deposit with this bank reference is already recorded.');
    }
    const sys = await systemAccounts(tx);
    const pool = await getAccount(tx, 'FUNDER_POOL', { merchantId }, true);
    const txnId = await postTxn(tx, {
      kind: 'DEPOSIT',
      label: `Reward pool top-up · ${merchant.name}`,
      refType: 'merchant',
      refId: merchantId,
      actorId: actor.id,
      at: now,
      entries: [debit(sys.TRUST_BANK, input.amountSen), credit(pool.id, input.amountSen)],
    });
    await tx.query(
      'INSERT INTO deposits (merchant_id, amount_sen, bank_ref, txn_id, recorded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [merchantId, input.amountSen, input.bankRef, txnId, actor.id, now],
    );
    await audit(tx, actor.id, 'DEPOSIT_RECORDED', 'merchant', merchantId, input);
    return { poolSen: pool.balance + input.amountSen };
  });
}

/** Sime Darby Property pays into the community pool, which funds corrections and community rewards. */
export async function recordCommunityDeposit(db: Db, actor: Actor, input: { amountSen: number; bankRef: string }, now: Date) {
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM deposits WHERE bank_ref = $1', [input.bankRef])) {
      throw conflict('DUPLICATE_BANK_REF', 'A deposit with this bank reference is already recorded.');
    }
    const sys = await systemAccounts(tx);
    const txnId = await postTxn(tx, {
      kind: 'DEPOSIT',
      label: 'Community pool top-up · Sime Darby Property',
      actorId: actor.id,
      at: now,
      entries: [debit(sys.TRUST_BANK, input.amountSen), credit(sys.COMMUNITY_POOL, input.amountSen)],
    });
    await tx.query('INSERT INTO deposits (amount_sen, bank_ref, txn_id, recorded_by, created_at) VALUES ($1, $2, $3, $4, $5)', [
      input.amountSen,
      input.bankRef,
      txnId,
      actor.id,
      now,
    ]);
    await audit(tx, actor.id, 'DEPOSIT_RECORDED', 'community_pool', null, input);
    return { ok: true };
  });
}

/**
 * Weekly job (BR13). Pays every shop 100% of the points it accepted. In the
 * prototype the "payment" is the statement; no bank transfer is sent. A
 * township admin settles their own township's shops; the job and HQ settle all.
 */
export async function runSettlement(db: Db, actorId: string | null, now: Date, townshipId: string | null = null): Promise<{ merchants: number; totalSen: number }> {
  const s = await getSettings(db);
  const due = await db.query<{ merchant_id: string }>(
    `SELECT a.merchant_id FROM ledger_accounts a JOIN merchants m ON m.id = a.merchant_id
      WHERE a.kind = 'MERCHANT_PAYABLE' AND a.balance > 0 AND ($1::uuid IS NULL OR m.township_id = $1)`,
    [townshipId],
  );
  let totalSen = 0;
  for (const { merchant_id } of due) {
    totalSen += await db.tx(async (tx) => {
      const payable = await getAccount(tx, 'MERCHANT_PAYABLE', { merchantId: merchant_id }, true);
      if (payable.balance === 0) return 0;
      const period = await one<{ period_end: string; period_start: string; already: boolean }>(
        tx,
        `WITH today AS (SELECT ($2::timestamptz AT TIME ZONE $3)::date AS d)
         SELECT today.d::text AS period_end,
                coalesce((SELECT max(period_end) + 1 FROM settlements WHERE merchant_id = $1),
                         (SELECT (approved_at AT TIME ZONE $3)::date FROM merchants WHERE id = $1), today.d)::text AS period_start,
                EXISTS (SELECT 1 FROM settlements WHERE merchant_id = $1 AND period_end = today.d) AS already
           FROM today`,
        [merchant_id, now, s.timezone],
      );
      if (period!.already) return 0; // one statement per shop per day keeps reruns harmless
      const name = (await one<{ name: string }>(tx, 'SELECT name FROM merchants WHERE id = $1', [merchant_id]))!.name;
      const txnId = await postTxn(tx, {
        kind: 'SETTLEMENT',
        label: `Weekly payment · ${name}`,
        refType: 'merchant',
        refId: merchant_id,
        actorId,
        at: now,
        entries: [debit(payable.id, payable.balance), credit((await systemAccounts(tx)).TRUST_BANK, payable.balance)],
      });
      await tx.query(
        `INSERT INTO settlements (merchant_id, period_start, period_end, amount_sen, txn_id, created_by, created_at)
         VALUES ($1, LEAST($2::date, $3::date), $3::date, $4, $5, $6, $7)`,
        [merchant_id, period!.period_start, period!.period_end, payable.balance, txnId, actorId, now],
      );
      await audit(tx, actorId, 'SETTLEMENT_PAID', 'merchant', merchant_id, { amountSen: payable.balance });
      return payable.balance;
    });
  }
  return { merchants: due.length, totalSen };
}

export async function listSettlements(db: Db, actor: Actor) {
  return db.query(
    `SELECT st.id, m.name AS merchant_name, st.period_start, st.period_end, st.amount_sen, st.created_at AS paid_at
       FROM settlements st JOIN merchants m ON m.id = st.merchant_id
      WHERE ($1::uuid IS NULL OR m.township_id = $1)
      ORDER BY st.created_at DESC LIMIT 100`,
    [actor.townshipId],
  );
}

export interface FloatPosition {
  trustSen: number;
  walletsSen: number;
  payablesSen: number;
  poolsSen: number;
  communitySen: number;
  lotsSen: number;
}

/** Where the float stands right now, straight from the ledger. */
export async function floatPosition(q: Queryable): Promise<FloatPosition> {
  const row = await one<Record<string, number>>(
    q,
    `SELECT
       coalesce(sum(balance) FILTER (WHERE kind = 'TRUST_BANK'), 0)::bigint AS trust,
       coalesce(sum(balance) FILTER (WHERE kind = 'WALLET'), 0)::bigint AS wallets,
       coalesce(sum(balance) FILTER (WHERE kind = 'MERCHANT_PAYABLE'), 0)::bigint AS payables,
       coalesce(sum(balance) FILTER (WHERE kind = 'FUNDER_POOL'), 0)::bigint AS pools,
       coalesce(sum(balance) FILTER (WHERE kind = 'COMMUNITY_POOL'), 0)::bigint AS community,
       (SELECT coalesce(sum(remaining), 0)::bigint FROM point_lots) AS lots
     FROM ledger_accounts`,
  );
  return {
    trustSen: row!.trust!,
    walletsSen: row!.wallets!,
    payablesSen: row!.payables!,
    poolsSen: row!.pools!,
    communitySen: row!.community!,
    lotsSen: row!.lots!,
  };
}

/**
 * Daily control (BR9). The float must equal, to the sen, everything it owes:
 * points residents hold, money owed to shops, and prefunded pools not yet
 * given out. It also re-adds every ledger entry to prove the stored balances.
 * If anything is off, all point movements pause until an admin has looked.
 */
export async function runFloatCheck(db: Db, actorId: string | null, now: Date, bankStatementSen?: number) {
  return db.tx(async (tx) => {
    const p = await floatPosition(tx);
    const issues: string[] = [];
    const owed = p.walletsSen + p.payablesSen + p.poolsSen + p.communitySen;
    if (p.trustSen !== owed) issues.push(`Float is ${p.trustSen} sen but owes ${owed} sen.`);
    if (p.lotsSen !== p.walletsSen) issues.push(`Point batches total ${p.lotsSen} but wallets total ${p.walletsSen}.`);

    const drift = await one<{ accounts: number; unbalanced: number }>(
      tx,
      `SELECT
         (SELECT count(*)::int FROM ledger_accounts a
           WHERE a.balance <> (SELECT coalesce(sum(CASE a.normal_side WHEN 'D' THEN e.amount ELSE -e.amount END), 0)
                                 FROM ledger_entries e WHERE e.account_id = a.id)) AS accounts,
         (SELECT count(*)::int FROM (SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(amount) <> 0) u) AS unbalanced`,
    );
    if (drift!.accounts > 0) issues.push(`${drift!.accounts} account balance(s) do not match their entries.`);
    if (drift!.unbalanced > 0) issues.push(`${drift!.unbalanced} transaction(s) do not balance.`);
    if (bankStatementSen !== undefined && bankStatementSen !== p.trustSen) {
      issues.push(`Bank statement shows ${bankStatementSen} sen; the ledger shows ${p.trustSen} sen.`);
    }

    const ok = issues.length === 0;
    await tx.query(
      `INSERT INTO float_checks (checked_at, trust_sen, wallets_sen, payables_sen, pools_sen, community_sen, lots_sen, bank_statement_sen, ok, issues, run_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [now, p.trustSen, p.walletsSen, p.payablesSen, p.poolsSen, p.communitySen, p.lotsSen, bankStatementSen ?? null, ok, JSON.stringify(issues), actorId],
    );
    if (!ok) {
      await tx.query('UPDATE program_settings SET issuance_paused = true, updated_at = $1', [now]);
      await audit(tx, actorId, 'FLOAT_CHECK_FAILED', 'float', null, { issues });
      const admins = await tx.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('TOWNSHIP_ADMIN', 'HQ_ADMIN') AND status = 'ACTIVE'`,
      );
      await notify(tx, admins.map((a) => a.id), {
        priority: 'URGENT',
        title: 'Float check failed: points are paused',
        body: issues.join(' '),
        link: '/console/finance',
      });
    }
    return { ok, issues, position: p, checkedAt: now };
  });
}

export async function floatOverview(db: Db) {
  const [position, checks, settings] = await Promise.all([
    floatPosition(db),
    db.query(
      `SELECT id, checked_at, trust_sen, wallets_sen, payables_sen, pools_sen, community_sen, bank_statement_sen, ok, issues
         FROM float_checks ORDER BY id DESC LIMIT 14`,
    ),
    getSettings(db),
  ]);
  return { position, checks, paused: settings.issuance_paused };
}

// --- Manual corrections (BR22) ---------------------------------------------

export async function requestAdjustment(
  db: Db,
  actor: Actor,
  input: { memberCode: string; points: number; reason: string },
  now: Date,
) {
  return db.tx(async (tx) => {
    const user = await one<{ id: string; township_id: string }>(
      tx,
      `SELECT id, township_id FROM users WHERE member_code = $1 AND role = 'RESIDENT' AND status = 'ACTIVE'`,
      [input.memberCode.trim().toUpperCase()],
    );
    if (!user) throw notFound('Member');
    assertTownshipAccess(actor, user.township_id);
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO adjustments (user_id, points, reason, requested_by, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.id, input.points, input.reason, actor.id, now],
    );
    await audit(tx, actor.id, 'ADJUSTMENT_REQUESTED', 'adjustment', row!.id, { points: input.points, reason: input.reason });
    return { id: row!.id };
  });
}

/** A second admin approves or rejects. The requester can never decide their own request. */
export async function decideAdjustment(db: Db, actor: Actor, id: string, approve: boolean, now: Date) {
  return db.tx(async (tx) => {
    const adj = await one<{ id: string; user_id: string; points: number; status: string; requested_by: string; township_id: string }>(
      tx,
      `SELECT a.id, a.user_id, a.points, a.status, a.requested_by, u.township_id
         FROM adjustments a JOIN users u ON u.id = a.user_id WHERE a.id = $1 FOR UPDATE OF a`,
      [id],
    );
    if (!adj) throw notFound('Adjustment');
    assertTownshipAccess(actor, adj.township_id);
    if (adj.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
    if (adj.requested_by === actor.id) throw forbidden('A second admin must decide this request.');

    let txnId: string | null = null;
    if (approve) {
      // Corrections are funded from, and returned to, the community pool, so even they obey "no pool, no points".
      const pool = await lockAccountById(tx, (await systemAccounts(tx)).COMMUNITY_POOL);
      const common = { userId: adj.user_id, kind: 'ADJUSTMENT' as const, label: 'Correction by township admin', refType: 'adjustment', refId: adj.id, actorId: actor.id, now };
      if (adj.points > 0) {
        if (pool.balance < adj.points) throw ruleViolation('POOL_EMPTY', 'The community pool cannot cover this correction.');
        txnId = await addPoints(tx, {
          ...common,
          points: adj.points,
          source: 'ADJUSTMENT',
          funderAccountId: pool.id,
          settings: await getSettings(tx),
          otherEntries: [debit(pool.id, adj.points)],
        });
      } else {
        txnId = await removePoints(tx, { ...common, points: -adj.points, otherEntries: [credit(pool.id, -adj.points)] });
      }
    }
    await tx.query('UPDATE adjustments SET status = $2, decided_by = $3, decided_at = $4, txn_id = $5 WHERE id = $1', [
      id,
      approve ? 'APPROVED' : 'REJECTED',
      actor.id,
      now,
      txnId,
    ]);
    await audit(tx, actor.id, approve ? 'ADJUSTMENT_APPROVED' : 'ADJUSTMENT_REJECTED', 'adjustment', id, { points: adj.points });
    return { id, status: approve ? 'APPROVED' : 'REJECTED' };
  });
}

export async function listAdjustments(db: Db, actor: Actor) {
  return db.query(
    `SELECT a.id, a.points, a.reason, a.status, a.created_at, a.decided_at, a.requested_by,
            u.full_name AS member_name, u.member_code, r.full_name AS requested_by_name, d.full_name AS decided_by_name
       FROM adjustments a
       JOIN users u ON u.id = a.user_id
       JOIN users r ON r.id = a.requested_by
       LEFT JOIN users d ON d.id = a.decided_by
      WHERE ($1::uuid IS NULL OR u.township_id = $1)
      ORDER BY a.created_at DESC LIMIT 100`,
    [actor.townshipId],
  );
}
