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
      `INSERT INTO merchants (township_id, name, registration_no, category, address_line, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.townshipId, input.businessName.trim(), input.registrationNo.trim().toUpperCase(), input.category, input.addressLine, input.postcode, input.city, input.state],
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

export async function listMerchantsForAdmin(db: Db, actor: Actor) {
  return db.query(
    `SELECT m.id, m.name, m.registration_no, m.category, m.status, m.plan, m.created_at, m.approved_at,
            concat_ws(', ', m.address_line, concat_ws(' ', m.postcode, m.city), m.state) AS address,
            coalesce(p.balance, 0) AS pool_sen, coalesce(o.balance, 0) AS owed_sen
       FROM merchants m
       LEFT JOIN ledger_accounts p ON p.merchant_id = m.id AND p.kind = 'FUNDER_POOL'
       LEFT JOIN ledger_accounts o ON o.merchant_id = m.id AND o.kind = 'MERCHANT_PAYABLE'
      WHERE ($1::uuid IS NULL OR m.township_id = $1)
      ORDER BY (m.status = 'PENDING') DESC, m.name`,
    [actor.townshipId],
  );
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
