import type { MerchantKind } from '@/shared/domain';
import { LEGAL } from '@/shared/legal';
import { one, type Db } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { hashPassword } from '../../auth/password';
import { conflict, notFound } from '../../errors';
import { audit } from '../audit';
import { createAccount } from '../ledger/ledger';
import { notify } from '../notifications';

/** Joining and approving shops (BR3). */

export interface MerchantApplication {
  townshipId: string;
  businessName: string;
  registrationNo: string;
  category: string;
  /** A shop, home services, or both. Shops are the default. */
  kind?: MerchantKind;
  addressLine: string;
  postcode: string;
  city: string;
  state: string;
  contactName: string;
  email: string;
  /** Already in international form (see zPhone). */
  phone: string;
  password: string;
}

/**
 * A shop applies with its business address and a contact person's name, email and phone, and
 * accepts the Terms and Privacy Notice. It stays PENDING, and cannot give or accept points,
 * until an admin approves it.
 */
export async function applyAsMerchant(db: Db, input: MerchantApplication, now: Date) {
  const passwordHash = await hashPassword(input.password);
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email])) {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    }
    if (await one(tx, 'SELECT 1 FROM merchants WHERE upper(registration_no) = upper($1)', [input.registrationNo.trim()])) {
      throw conflict('REGISTRATION_TAKEN', 'A shop with this business registration number has already applied.');
    }
    if (!(await one(tx, 'SELECT 1 FROM townships WHERE id = $1', [input.townshipId]))) throw notFound('Township');
    const merchant = await one<{ id: string }>(
      tx,
      `INSERT INTO merchants (township_id, name, registration_no, category, address_line, postcode, city, state, offers_retail, offers_services)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        input.townshipId, input.businessName.trim(), input.registrationNo.trim().toUpperCase(), input.category, input.addressLine, input.postcode, input.city, input.state,
        (input.kind ?? 'RETAIL') !== 'SERVICES', (input.kind ?? 'RETAIL') !== 'RETAIL',
      ],
    );
    const user = await one<{ id: string }>(
      tx,
      `INSERT INTO users (email, password_hash, full_name, phone, role, township_id, merchant_id, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, $4, 'MERCHANT', $5, $6, $7, $8) RETURNING id`,
      [input.email.trim(), passwordHash, input.contactName.trim(), input.phone, input.townshipId, merchant!.id, LEGAL.version, now],
    );
    await audit(tx, user!.id, 'MERCHANT_APPLIED', 'merchant', merchant!.id, { registrationNo: input.registrationNo });
    return { merchantId: merchant!.id, userId: user!.id };
  });
}

export const MERCHANT_SORTS = ['ACTION', 'NAME', 'POOL', 'OWED', 'NEWEST'] as const;
export interface MerchantFilter {
  /** Matches the business name, registration number or category. */
  q?: string;
  kind?: MerchantKind;
  sort?: (typeof MERCHANT_SORTS)[number];
}

/** A search term as a literal: % and _ typed by the admin are matched as themselves, not as wildcards. */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const ORDER_BY: Record<NonNullable<MerchantFilter['sort']>, string> = {
  ACTION: `(m.status = 'PENDING') DESC, (EXISTS (SELECT 1 FROM service_trade_requests r WHERE r.merchant_id = m.id AND r.status = 'PENDING')) DESC, (m.status = 'SUSPENDED') DESC, lower(m.name)`,
  NAME: 'lower(m.name)',
  POOL: 'pool_sen DESC, lower(m.name)',
  OWED: 'owed_sen DESC, lower(m.name)',
  NEWEST: 'm.created_at DESC, lower(m.name)',
};

/**
 * Every business in the admin's township (all of them for HQ), with its reward
 * pool and what the township owes it, read from the same ledger accounts the
 * money moves through. Filters are optional; without them the list is as before.
 */
export async function listMerchantsForAdmin(db: Db, actor: Actor, filter: MerchantFilter = {}) {
  const q = filter.q?.trim() || null;
  const kind = filter.kind ?? null;
  return db.query(
    `SELECT m.id, m.name, m.registration_no, m.category, m.status, m.plan, m.created_at, m.approved_at, m.offers_retail, m.offers_services,
            (SELECT count(*)::int FROM service_trade_requests r WHERE r.merchant_id = m.id AND r.status = 'PENDING') AS trade_requests,
            concat_ws(', ', m.address_line, concat_ws(' ', m.postcode, m.city), m.state) AS address,
            coalesce(p.balance, 0) AS pool_sen, coalesce(o.balance, 0) AS owed_sen
       FROM merchants m
       LEFT JOIN ledger_accounts p ON p.merchant_id = m.id AND p.kind = 'FUNDER_POOL'
       LEFT JOIN ledger_accounts o ON o.merchant_id = m.id AND o.kind = 'MERCHANT_PAYABLE'
      WHERE ($1::uuid IS NULL OR m.township_id = $1)
        AND ($2::text IS NULL OR m.name ILIKE $2 ESCAPE '\\' OR m.registration_no ILIKE $2 ESCAPE '\\' OR m.category ILIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL
          OR ($3 = 'RETAIL' AND m.offers_retail AND NOT m.offers_services)
          OR ($3 = 'SERVICES' AND m.offers_services AND NOT m.offers_retail)
          OR ($3 = 'BOTH' AND m.offers_retail AND m.offers_services))
      ORDER BY ${ORDER_BY[filter.sort ?? 'ACTION'] ?? ORDER_BY.ACTION}`,
    [actor.townshipId, q ? likeTerm(q) : null, kind],
  );
}

/** Headline numbers for the console, from the ledger, independent of any filter. */
export async function merchantSummary(db: Db, actor: Actor, now: Date) {
  return (await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE m.status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE m.status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE m.status = 'SUSPENDED')::int AS suspended,
            coalesce(sum(p.balance), 0)::bigint AS pool_sen,
            coalesce(sum(o.balance), 0)::bigint AS owed_sen,
            count(*) FILTER (WHERE m.status = 'ACTIVE' AND coalesce(p.balance, 0) = 0)::int AS active_unfunded,
            (SELECT coalesce(sum(d.amount_sen), 0)::bigint FROM deposits d JOIN merchants dm ON dm.id = d.merchant_id
              WHERE ($1::uuid IS NULL OR dm.township_id = $1) AND d.created_at > $2::timestamptz - interval '30 days') AS deposits_30d_sen
       FROM merchants m
       LEFT JOIN ledger_accounts p ON p.merchant_id = m.id AND p.kind = 'FUNDER_POOL'
       LEFT JOIN ledger_accounts o ON o.merchant_id = m.id AND o.kind = 'MERCHANT_PAYABLE'
      WHERE ($1::uuid IS NULL OR m.township_id = $1)`,
    [actor.townshipId, now],
  ))!;
}

/** One business for the review panel: its record, contact people, money and recent deposits. */
export async function merchantDetail(db: Db, actor: Actor, merchantId: string) {
  const m = await one<{ township_id: string }>(
    db,
    `SELECT m.id, m.township_id, m.name, m.registration_no, m.category, m.status, m.plan, m.created_at, m.approved_at, m.offers_retail, m.offers_services, m.service_trades,
            concat_ws(', ', m.address_line, concat_ws(' ', m.postcode, m.city), m.state) AS address,
            coalesce(p.balance, 0) AS pool_sen, coalesce(o.balance, 0) AS owed_sen,
            (SELECT count(*)::int FROM shop_offers s WHERE s.merchant_id = m.id AND s.status = 'ACTIVE') AS live_offers
       FROM merchants m
       LEFT JOIN ledger_accounts p ON p.merchant_id = m.id AND p.kind = 'FUNDER_POOL'
       LEFT JOIN ledger_accounts o ON o.merchant_id = m.id AND o.kind = 'MERCHANT_PAYABLE'
      WHERE m.id = $1`,
    [merchantId],
  );
  if (!m) throw notFound('Shop');
  assertTownshipAccess(actor, m.township_id);
  const [contacts, deposits, totals, tradeRequests] = await Promise.all([
    db.query(`SELECT full_name, email, phone, status FROM users WHERE merchant_id = $1 ORDER BY created_at`, [merchantId]),
    db.query(
      `SELECT d.amount_sen, d.bank_ref, d.created_at, u.full_name AS recorded_by FROM deposits d LEFT JOIN users u ON u.id = d.recorded_by
        WHERE d.merchant_id = $1 ORDER BY d.created_at DESC LIMIT 10`, [merchantId],
    ),
    one<{ count: number; total_sen: number }>(db, 'SELECT count(*)::int AS count, coalesce(sum(amount_sen), 0)::bigint AS total_sen FROM deposits WHERE merchant_id = $1', [merchantId]),
    // Licensed work the company asked for, waiting for staff to check.
    db.query(`SELECT id, category, note, created_at FROM service_trade_requests WHERE merchant_id = $1 AND status = 'PENDING' ORDER BY created_at`, [merchantId]),
  ]);
  // The township id is only for the access check; it is not part of what the screen shows.
  const merchant: Record<string, unknown> = { ...m };
  delete merchant.township_id;
  return { merchant, contacts, deposits, depositTotals: totals, tradeRequests };
}

/** Approve, suspend or restore a shop. Its ledger accounts are opened on first approval. */
export async function setMerchantStatus(db: Db, actor: Actor, merchantId: string, status: 'ACTIVE' | 'SUSPENDED', now: Date) {
  return db.tx(async (tx) => {
    const merchant = await one<{ township_id: string; status: string; name: string }>(
      tx,
      'SELECT township_id, status, name FROM merchants WHERE id = $1 FOR UPDATE',
      [merchantId],
    );
    if (!merchant) throw notFound('Shop');
    assertTownshipAccess(actor, merchant.township_id);
    if (merchant.status === status) return { status };
    if (status === 'SUSPENDED' && merchant.status === 'PENDING') throw conflict('NOT_APPROVED', 'This shop has not been approved yet.');

    const firstApproval = merchant.status === 'PENDING';
    if (firstApproval) {
      await createAccount(tx, 'FUNDER_POOL', { merchantId });
      await createAccount(tx, 'MERCHANT_PAYABLE', { merchantId });
    }
    await tx.query('UPDATE merchants SET status = $2, approved_at = coalesce(approved_at, $3) WHERE id = $1', [merchantId, status, now]);
    await audit(tx, actor.id, status === 'ACTIVE' ? 'MERCHANT_APPROVED' : 'MERCHANT_SUSPENDED', 'merchant', merchantId);
    if (firstApproval) {
      const staff = await tx.query<{ id: string }>(`SELECT id FROM users WHERE merchant_id = $1 AND status = 'ACTIVE'`, [merchantId]);
      await notify(tx, staff.map((s) => s.id), {
        title: `${merchant.name} is approved`,
        body: 'Pay into your reward pool to start giving points. You can accept points straight away.',
        link: '/merchant',
      });
    }
    return { status };
  });
}
