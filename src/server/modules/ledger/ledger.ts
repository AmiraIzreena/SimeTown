import { one, type Queryable } from '../../db/client';
import { AppError } from '../../errors';

/**
 * The double-entry core. Every movement of value in SimeTown goes through
 * `postTxn`. The database itself rejects a transaction that does not balance
 * or that would push any account below zero (see 001_init.sql).
 */

export type SystemAccountKind =
  | 'TRUST_BANK'
  | 'OPERATING_BANK'
  | 'COMMUNITY_POOL'
  | 'REVENUE_ISSUANCE_FEE'
  | 'REVENUE_CAMPAIGN_FEE'
  | 'REVENUE_CAMPAIGN_COSTS'
  | 'REVENUE_SUCCESS_FEE'
  | 'REVENUE_SPONSOR_TIER';
export type OwnedAccountKind = 'FUNDER_POOL' | 'WALLET' | 'MERCHANT_PAYABLE';
type Owner = { merchantId: string } | { campaignId: string } | { userId: string };

export type TxnKind =
  | 'DEPOSIT'
  | 'ISSUE'
  | 'REDEEM'
  | 'REFUND_CLAWBACK'
  | 'REFUND_RETURN'
  | 'EXPIRE'
  | 'SETTLEMENT'
  | 'CAMPAIGN_FUND'
  | 'CAMPAIGN_REFUND'
  | 'ADJUSTMENT'
  | 'OFFER_FEE'
  | 'SPONSOR_TIER';

export interface Entry {
  accountId: string;
  /** Positive = debit, negative = credit. */
  amount: number;
}
export const debit = (accountId: string, amount: number): Entry => ({ accountId, amount });
export const credit = (accountId: string, amount: number): Entry => ({ accountId, amount: -amount });

export interface Account {
  id: string;
  balance: number;
}

const NORMAL_SIDE: Record<OwnedAccountKind, 'C'> = { FUNDER_POOL: 'C', WALLET: 'C', MERCHANT_PAYABLE: 'C' };

function ownerColumns(owner: Owner): [string | null, string | null, string | null] {
  return [
    'merchantId' in owner ? owner.merchantId : null,
    'campaignId' in owner ? owner.campaignId : null,
    'userId' in owner ? owner.userId : null,
  ];
}

/** Created once, when the shop, campaign or resident is created. */
export async function createAccount(q: Queryable, kind: OwnedAccountKind, owner: Owner): Promise<string> {
  const row = await one<{ id: string }>(
    q,
    `INSERT INTO ledger_accounts (kind, normal_side, merchant_id, campaign_id, user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [kind, NORMAL_SIDE[kind], ...ownerColumns(owner)],
  );
  return row!.id;
}

/** Reads an account. With `lock`, the row stays locked until the transaction ends. */
export async function getAccount(q: Queryable, kind: OwnedAccountKind, owner: Owner, lock = false): Promise<Account> {
  const account = await one<Account>(
    q,
    `SELECT id, balance FROM ledger_accounts
      WHERE kind = $1 AND merchant_id IS NOT DISTINCT FROM $2
        AND campaign_id IS NOT DISTINCT FROM $3 AND user_id IS NOT DISTINCT FROM $4
      ${lock ? 'FOR UPDATE' : ''}`,
    [kind, ...ownerColumns(owner)],
  );
  if (!account) throw new Error(`Ledger account ${kind} is missing for ${JSON.stringify(owner)}`);
  return account;
}

export async function lockAccountById(q: Queryable, id: string): Promise<Account> {
  const account = await one<Account>(q, 'SELECT id, balance FROM ledger_accounts WHERE id = $1 FOR UPDATE', [id]);
  if (!account) throw new Error(`Ledger account ${id} is missing`);
  return account;
}

export async function systemAccounts(q: Queryable): Promise<Record<SystemAccountKind, string>> {
  const rows = await q.query<{ kind: SystemAccountKind; id: string }>(
    'SELECT kind, id FROM ledger_accounts WHERE merchant_id IS NULL AND campaign_id IS NULL AND user_id IS NULL',
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.id])) as Record<SystemAccountKind, string>;
}

export interface TxnInput {
  kind: TxnKind;
  label: string;
  refType?: string;
  refId?: string;
  actorId?: string | null;
  at: Date;
  entries: Entry[];
}

/** Records one balanced transaction. Must be called inside `db.tx`. */
export async function postTxn(tx: Queryable, input: TxnInput): Promise<string> {
  const entries = input.entries.filter((e) => e.amount !== 0);
  if (entries.length < 2) throw new Error('A ledger transaction needs at least two entries');
  if (entries.some((e) => !Number.isSafeInteger(e.amount))) throw new Error('Ledger amounts must be whole sen');
  if (entries.reduce((sum, e) => sum + e.amount, 0) !== 0) throw new Error('Ledger transaction does not balance');

  const txn = await one<{ id: string }>(
    tx,
    `INSERT INTO ledger_txns (kind, label, ref_type, ref_id, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.kind, input.label, input.refType ?? null, input.refId ?? null, input.actorId ?? null, input.at],
  );
  const values = entries.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
  try {
    await tx.query(
      `INSERT INTO ledger_entries (txn_id, account_id, amount) VALUES ${values}`,
      [txn!.id, ...entries.flatMap((e) => [e.accountId, e.amount])],
    );
  } catch (error) {
    // Services check balances first, so this is the safety net for races and bugs.
    if ((error as { code?: string }).code === '23514') {
      throw new AppError(422, 'INSUFFICIENT_FUNDS', 'There is not enough balance to complete this.');
    }
    throw error;
  }
  return txn!.id;
}
