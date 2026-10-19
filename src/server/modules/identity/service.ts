import { randomInt } from 'node:crypto';
import { formatAddress, isCompleteAddress, type HomeAddress, type Role } from '@/shared/domain';
import { LEGAL } from '@/shared/legal';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { hashPassword, verifyPassword } from '../../auth/password';
import { ACTOR_COLUMNS, COURIER_SESSION_HOURS, createSession, hashToken, newToken, sessionsChanged, toActor } from '../../auth/session';
import { conflict, forbidden, notFound, ruleViolation, unauthorized } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { createAccount } from '../ledger/ledger';
import { expireLotsForUser } from '../ledger/points';
import { notify } from '../notifications';
import { HOME_ADDRESS_COLUMNS, resolveTownship } from '../townships';

/** SimeTown ID: one account per person, tied to a home, a shop or a sponsor. */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes such as 0/O or 1/I
export function randomCode(length: number): string {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

async function assertEmailFree(q: Queryable, email: string): Promise<void> {
  if (await one(q, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])) {
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  /** Already in international form (see zPhone). */
  phone: string;
  townshipId: string;
  /** Chosen from the township's address book, so it always matches the property record. */
  homeId: string;
  occupancy: 'OWNER' | 'TENANT';
}

/** A home of this township with a full postal address, or a clear error. */
async function addressableHome(q: Queryable, townshipId: string, homeId: string): Promise<{ id: string }> {
  const home = await one<{ id: string }>(
    q,
    `SELECT id FROM homes WHERE id = $1 AND township_id = $2 AND house_no IS NOT NULL AND postcode IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL`,
    [homeId, townshipId],
  );
  if (!home) throw ruleViolation('ADDRESS_NOT_FOUND', 'Choose your address from the list for your township.', { fields: { homeId: 'Choose your address from the list.' } });
  return home;
}

/**
 * A new resident starts as PENDING: they can look around, but cannot earn or spend until their home is
 * confirmed (BR1). Name, email, phone, address and acceptance of the Terms and Privacy Notice are all required.
 */
export async function registerResident(db: Db, input: RegisterInput, now: Date): Promise<{ token: string; actor: Actor }> {
  const passwordHash = await hashPassword(input.password);
  return db.tx(async (tx) => {
    await assertEmailFree(tx, input.email);
    const home = await addressableHome(tx, input.townshipId, input.homeId);
    const row = await one<Parameters<typeof toActor>[0]>(
      tx,
      `INSERT INTO users AS u (email, password_hash, full_name, phone, role, township_id, home_id, occupancy, residency_status, member_code, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, $4, 'RESIDENT', $5, $6, $7, 'PENDING', $8, $9, $10) RETURNING ${ACTOR_COLUMNS}`,
      [input.email.trim(), passwordHash, input.fullName.trim(), input.phone, input.townshipId, home.id, input.occupancy, randomCode(8), LEGAL.version, now],
    );
    await createAccount(tx, 'WALLET', { userId: row!.id });
    await audit(tx, row!.id, 'RESIDENT_REGISTERED', 'user', row!.id, { termsVersion: LEGAL.version });
    return { token: await createSession(tx, row!.id, now), actor: toActor(row!) };
  });
}

export async function login(db: Db, input: { email: string; password: string }, now: Date): Promise<{ token: string; actor: Actor }> {
  const row = await one<Parameters<typeof toActor>[0] & { password_hash: string | null }>(
    db,
    `SELECT ${ACTOR_COLUMNS}, u.password_hash FROM users u WHERE lower(u.email) = lower($1) AND u.status = 'ACTIVE'`,
    [input.email.trim()],
  );
  // One message for every failure, so the form cannot be used to find out who has an account.
  if (!(await verifyPassword(input.password, row?.password_hash ?? null)) || !row) {
    throw unauthorized('The email or password is not correct.');
  }
  return { token: await createSession(db, row.id, now, row.role === 'COURIER' ? COURIER_SESSION_HOURS : undefined), actor: toActor(row) };
}

export async function changePassword(db: Db, actor: Actor, input: { current: string; next: string }, now: Date): Promise<string> {
  const row = await one<{ password_hash: string | null }>(db, 'SELECT password_hash FROM users WHERE id = $1', [actor.id]);
  if (!(await verifyPassword(input.current, row?.password_hash ?? null))) {
    throw ruleViolation('WRONG_PASSWORD', 'Your current password is not correct.');
  }
  const passwordHash = await hashPassword(input.next);
  return db.tx(async (tx) => {
    await tx.query('UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1', [actor.id, passwordHash, now]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [actor.id]); // signs out every device
    await sessionsChanged(tx);
    await audit(tx, actor.id, 'PASSWORD_CHANGED', 'user', actor.id);
    return createSession(tx, actor.id, now);
  });
}

export async function updateProfile(db: Db, actor: Actor, input: { fullName: string; phone: string }, now: Date) {
  await db.query('UPDATE users SET full_name = $2, phone = $3, updated_at = $4 WHERE id = $1', [actor.id, input.fullName.trim(), input.phone, now]);
  await sessionsChanged(db);
  return { ok: true };
}

/** Details everyone must have before using SimeTown fully. Each one tells the screens what to ask for. */
export type MissingDetail = 'phone' | 'address' | 'shopAddress' | 'terms';

export async function profile(db: Db, actor: Actor) {
  const row = await one<
    HomeAddress & {
      phone: string | null;
      township: string | null;
      occupancy: 'OWNER' | 'TENANT' | null;
      terms_version: string | null;
      terms_accepted_at: Date | null;
      has_home: boolean;
      language: 'en' | 'ms';
      shop_address_line: string | null;
      shop_postcode: string | null;
      shop_city: string | null;
      shop_state: string | null;
    }
  >(
    db,
    `SELECT u.phone, t.name AS township, u.occupancy, u.terms_version, u.terms_accepted_at, u.language, (h.id IS NOT NULL) AS has_home, ${HOME_ADDRESS_COLUMNS},
            m.address_line AS shop_address_line, m.postcode AS shop_postcode, m.city AS shop_city, m.state AS shop_state
       FROM users u
       LEFT JOIN homes h ON h.id = u.home_id
       LEFT JOIN townships t ON t.id = u.township_id
       LEFT JOIN merchants m ON m.id = u.merchant_id
      WHERE u.id = $1`,
    [actor.id],
  );
  const r = row!;
  const home = r.has_home ? r : null;
  const shop = actor.role === 'MERCHANT' ? { addressLine: r.shop_address_line, postcode: r.shop_postcode, city: r.shop_city, state: r.shop_state } : null;
  // Data minimisation (PDPA): a home address only for residents, a business address only for shops.
  const missing: MissingDetail[] = [];
  if (!r.phone) missing.push('phone');
  if (actor.role === 'RESIDENT' && !(home && isCompleteAddress(home))) missing.push('address');
  if (shop && !(shop.addressLine && shop.postcode && shop.city && shop.state)) missing.push('shopAddress');
  if (r.terms_version !== LEGAL.version) missing.push('terms');
  return {
    ...actor,
    phone: r.phone,
    language: r.language,
    township: r.township,
    occupancy: r.occupancy,
    home: home && {
      propertyType: home.property_type,
      houseNo: home.house_no,
      building: home.building,
      street: home.street,
      precinct: home.precinct,
      postcode: home.postcode,
      city: home.city,
      state: home.state,
      address: formatAddress(home),
    },
    shop,
    terms: { version: r.terms_version, acceptedAt: r.terms_accepted_at, current: LEGAL.version },
    missing,
  };
}

/** English or Bahasa Malaysia, remembered for the person across devices. */
export async function setLanguage(db: Db, actor: Actor, language: 'en' | 'ms') {
  await db.query('UPDATE users SET language = $2 WHERE id = $1', [actor.id, language]);
  return { language };
}

/** Records that the person read and accepted the Terms of Use and Privacy Notice now in force. */
export async function acceptTerms(db: Db, actor: Actor, version: string, now: Date) {
  if (version !== LEGAL.version) throw conflict('TERMS_CHANGED', 'The Terms have been updated since you opened them. Please read them again.');
  await db.query('UPDATE users SET terms_version = $2, terms_accepted_at = $3 WHERE id = $1', [actor.id, version, now]);
  await audit(db, actor.id, 'TERMS_ACCEPTED', 'user', actor.id, { version });
  return { ok: true };
}

/**
 * A resident sets or corrects their address, for example after moving within the township.
 * A different home must be confirmed again, by staff or by the owner, before earning resumes (BR1).
 */
export async function changeHome(db: Db, actor: Actor, input: { homeId: string; occupancy: 'OWNER' | 'TENANT' }, now: Date) {
  if (actor.role !== 'RESIDENT' || !actor.townshipId) throw forbidden();
  return db.tx(async (tx) => {
    const home = await addressableHome(tx, actor.townshipId!, input.homeId);
    const current = await one<{ occupancy: string | null }>(tx, 'SELECT occupancy FROM users WHERE id = $1 FOR UPDATE', [actor.id]);
    if (home.id === actor.homeId && current?.occupancy === input.occupancy) return { residencyStatus: actor.residencyStatus };
    await tx.query(
      `UPDATE users SET home_id = $2, occupancy = $3, residency_status = 'PENDING', verified_by = NULL, verified_at = NULL, updated_at = $4 WHERE id = $1`,
      [actor.id, home.id, input.occupancy, now],
    );
    await sessionsChanged(tx);
    await audit(tx, actor.id, 'HOME_CHANGED', 'user', actor.id, { from: actor.homeId, to: home.id, occupancy: input.occupancy });
    return { residencyStatus: 'PENDING' as const };
  });
}

// --- Invitations: how shop, sponsor and staff accounts get a password -------

const INVITE_DAYS = 7;

export async function issueInvite(tx: Queryable, userId: string, createdBy: string, now: Date): Promise<string> {
  const token = newToken();
  await tx.query('DELETE FROM user_invites WHERE user_id = $1', [userId]);
  await tx.query(
    `INSERT INTO user_invites (token_hash, user_id, expires_at, created_by) VALUES ($1, $2, $3::timestamptz + make_interval(days => $4), $5)`,
    [hashToken(token), userId, now, INVITE_DAYS, createdBy],
  );
  return token;
}

/** Which roles each admin level may create and manage. Residents always register themselves. */
const CAN_CREATE: Partial<Record<Role, Role[]>> = {
  // Sponsors are not tied to one township, so only HQ manages their logins.
  TOWNSHIP_ADMIN: ['TOWNSHIP_STAFF', 'GUARD', 'MERCHANT'],
  HQ_ADMIN: ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN', 'GUARD', 'MERCHANT', 'SPONSOR'],
};
const ADMIN_ROLES: readonly Role[] = ['TOWNSHIP_ADMIN', 'HQ_ADMIN'];

type Manager = Pick<Actor, 'role' | 'townshipId'>;

/** May this admin issue a set-password link for this account? Residents belong to their township's admins. */
function canManage(admin: Manager, user: { role: Role; township_id: string | null }): boolean {
  if (user.role !== 'RESIDENT' && !CAN_CREATE[admin.role]?.includes(user.role)) return false;
  return admin.role === 'HQ_ADMIN' || (user.township_id !== null && user.township_id === admin.townshipId);
}

/** Tells every other admin who could approve a request that one is waiting. */
async function notifyApprovers(tx: Queryable, requesterId: string, target: { role: Role; township_id: string | null } | null, what: string): Promise<void> {
  const admins = await tx.query<{ id: string; role: Role; township_id: string | null }>(
    `SELECT id, role, township_id FROM users WHERE role IN ('TOWNSHIP_ADMIN', 'HQ_ADMIN') AND status = 'ACTIVE' AND id <> $1`,
    [requesterId],
  );
  const approvers = admins.filter((a) => (target ? canManage({ role: a.role, townshipId: a.township_id }, target) : a.role === 'HQ_ADMIN'));
  await notify(tx, approvers.map((a) => a.id), { title: 'An account request needs your approval', body: what, link: '/console/people' });
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  role: Role;
  townshipId?: string;
  merchantId?: string;
  sponsorId?: string;
}

export type InviteResult = { inviteToken: string } | { requestId: string; pending: true };

/**
 * Creates an account without a password and returns a one-time link token for
 * the person to set one. An admin account is only requested here: a second HQ
 * admin approves it, so nobody can give themselves a second identity (BR22).
 */
export async function createUser(db: Db, actor: Actor, input: CreateUserInput, now: Date): Promise<InviteResult & { id?: string }> {
  if (!CAN_CREATE[actor.role]?.includes(input.role)) throw forbidden('You cannot create an account with this role.');
  return db.tx(async (tx) => {
    await assertEmailFree(tx, input.email);
    if (ADMIN_ROLES.includes(input.role)) {
      const townshipId = input.role === 'TOWNSHIP_ADMIN' ? await resolveTownship(tx, actor, input.townshipId) : null;
      const request = await one<{ id: string }>(
        tx,
        `INSERT INTO account_requests (kind, email, full_name, role, township_id, requested_by, created_at)
         VALUES ('NEW_ADMIN', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.email.trim(), input.fullName.trim(), input.role, townshipId, actor.id, now],
      );
      await audit(tx, actor.id, 'ADMIN_ACCOUNT_REQUESTED', 'account_request', request!.id, { role: input.role });
      await notifyApprovers(tx, actor.id, null, `${actor.fullName} asked to create an admin account for ${input.fullName.trim()}.`);
      return { requestId: request!.id, pending: true as const };
    }
    let townshipId: string | null = null;
    let merchantId: string | null = null;
    let sponsorId: string | null = null;
    if (input.role === 'MERCHANT') {
      const merchant = await one<{ id: string; township_id: string }>(tx, 'SELECT id, township_id FROM merchants WHERE id = $1', [input.merchantId]);
      if (!merchant) throw notFound('Shop');
      assertTownshipAccess(actor, merchant.township_id);
      [merchantId, townshipId] = [merchant.id, merchant.township_id];
    } else if (input.role === 'SPONSOR') {
      if (!(await one(tx, 'SELECT 1 FROM sponsors WHERE id = $1', [input.sponsorId]))) throw notFound('Sponsor');
      sponsorId = input.sponsorId!;
    } else if (input.role !== 'HQ_ADMIN') {
      townshipId = await resolveTownship(tx, actor, input.townshipId);
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO users (email, full_name, role, township_id, merchant_id, sponsor_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.email.trim(), input.fullName.trim(), input.role, townshipId, merchantId, sponsorId],
    );
    await audit(tx, actor.id, 'USER_CREATED', 'user', row!.id, { role: input.role });
    return { id: row!.id, inviteToken: await issueInvite(tx, row!.id, actor.id, now) };
  });
}

/**
 * A fresh set-password link, also the way an admin helps someone who has forgotten their password.
 * A first link for an account nobody uses yet goes out at once. A new password for an account
 * someone already uses, or for any admin, needs a second admin: otherwise one admin could quietly
 * take that account over.
 */
export async function reinvite(db: Db, actor: Actor, userId: string, now: Date): Promise<InviteResult> {
  return db.tx(async (tx) => {
    const user = await one<{ role: Role; township_id: string | null; full_name: string; has_password: boolean }>(
      tx,
      `SELECT role, township_id, full_name, password_hash IS NOT NULL AS has_password FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    if (!user) throw notFound('User');
    if (!canManage(actor, user)) throw forbidden();
    if (userId === actor.id) throw ruleViolation('OWN_ACCOUNT', 'Change your own password from your account page.');

    if (user.has_password || ADMIN_ROLES.includes(user.role)) {
      const request = await one<{ id: string }>(
        tx,
        `INSERT INTO account_requests (kind, user_id, requested_by, created_at) VALUES ('PASSWORD_RESET', $1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [userId, actor.id, now],
      );
      if (!request) throw conflict('REQUEST_PENDING', 'A new link for this account is already waiting for approval.');
      await audit(tx, actor.id, 'PASSWORD_RESET_REQUESTED', 'account_request', request.id);
      await notifyApprovers(tx, actor.id, user, `${actor.fullName} asked for a new set-password link for ${user.full_name}.`);
      return { requestId: request.id, pending: true as const };
    }
    await audit(tx, actor.id, 'INVITE_ISSUED', 'user', userId);
    return { inviteToken: await issueInvite(tx, userId, actor.id, now) };
  });
}

interface AccountRequestRow {
  id: string;
  kind: 'NEW_ADMIN' | 'PASSWORD_RESET';
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  role: Role | null;
  township_id: string | null;
  status: string;
  requested_by: string;
  user_name: string | null;
  user_email: string | null;
  user_role: Role | null;
  user_township_id: string | null;
  user_status: string | null;
}

const REQUEST_SELECT = `
  SELECT r.id, r.kind, r.user_id, r.email, r.full_name, r.role, r.township_id, r.status, r.requested_by, r.created_at,
         t.full_name AS user_name, t.email AS user_email, t.role AS user_role, t.township_id AS user_township_id, t.status AS user_status,
         q.full_name AS requested_by_name
    FROM account_requests r LEFT JOIN users t ON t.id = r.user_id JOIN users q ON q.id = r.requested_by`;

/** Whether this admin may decide the request, leaving aside who asked for it. */
const canDecide = (actor: Actor, r: AccountRequestRow) =>
  r.kind === 'NEW_ADMIN' ? actor.role === 'HQ_ADMIN' : canManage(actor, { role: r.user_role!, township_id: r.user_township_id });

/** Requests waiting for a second admin: the ones this admin made, and the ones they may decide. */
export async function listAccountRequests(db: Db, actor: Actor) {
  const rows = await db.query<AccountRequestRow & { created_at: Date; requested_by_name: string }>(`${REQUEST_SELECT} WHERE r.status = 'PENDING' ORDER BY r.created_at`);
  return rows
    .filter((r) => r.requested_by === actor.id || canDecide(actor, r))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.kind === 'NEW_ADMIN' ? r.full_name : r.user_name,
      email: r.kind === 'NEW_ADMIN' ? r.email : r.user_email,
      role: r.kind === 'NEW_ADMIN' ? r.role : r.user_role,
      requestedBy: r.requested_by_name,
      mine: r.requested_by === actor.id,
      createdAt: r.created_at,
    }));
}

/** A second admin approves or rejects. Only the approver receives the set-password link. */
export async function decideAccountRequest(db: Db, actor: Actor, id: string, approve: boolean, now: Date) {
  return db.tx(async (tx) => {
    const r = await one<AccountRequestRow>(tx, `${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    if (!r || !canDecide(actor, r)) throw notFound('Request');
    if (r.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
    if (r.requested_by === actor.id) throw forbidden('A second admin must decide this request.');
    await tx.query('UPDATE account_requests SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1', [id, approve ? 'APPROVED' : 'REJECTED', actor.id, now]);
    await audit(tx, actor.id, approve ? 'ACCOUNT_REQUEST_APPROVED' : 'ACCOUNT_REQUEST_REJECTED', 'account_request', id, { kind: r.kind });
    if (!approve) return { status: 'REJECTED' as const };

    if (r.kind === 'NEW_ADMIN') {
      await assertEmailFree(tx, r.email!);
      const user = await one<{ id: string }>(tx, 'INSERT INTO users (email, full_name, role, township_id) VALUES ($1, $2, $3, $4) RETURNING id', [
        r.email,
        r.full_name,
        r.role,
        r.township_id,
      ]);
      await tx.query('UPDATE account_requests SET user_id = $2 WHERE id = $1', [id, user!.id]);
      await audit(tx, actor.id, 'USER_CREATED', 'user', user!.id, { role: r.role });
      return { status: 'APPROVED' as const, userId: user!.id, inviteToken: await issueInvite(tx, user!.id, actor.id, now) };
    }

    if (r.user_status !== 'ACTIVE') throw ruleViolation('ACCOUNT_INACTIVE', 'This account is no longer active.');
    // If someone else asked for this, the real owner sees it the next time they open the app.
    await notify(tx, [r.user_id!], {
      priority: 'URGENT',
      title: 'A new set-password link was issued for your account',
      body: 'If you did not ask for this, contact the township office straight away.',
    });
    await audit(tx, actor.id, 'INVITE_ISSUED', 'user', r.user_id);
    return { status: 'APPROVED' as const, userId: r.user_id!, inviteToken: await issueInvite(tx, r.user_id!, actor.id, now) };
  });
}

export async function acceptInvite(db: Db, input: { token: string; password: string }, now: Date): Promise<{ token: string; actor: Actor }> {
  const passwordHash = await hashPassword(input.password);
  return db.tx(async (tx) => {
    const invite = await one<{ user_id: string }>(
      tx,
      'SELECT user_id FROM user_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE',
      [hashToken(input.token), now],
    );
    if (!invite) throw ruleViolation('INVITE_INVALID', 'This link has expired or was already used. Ask your admin for a new one.');
    await tx.query('UPDATE user_invites SET used_at = $2 WHERE token_hash = $1', [hashToken(input.token), now]);
    // Setting a password through the link also means accepting the Terms and Privacy Notice on the form.
    await tx.query('UPDATE users SET password_hash = $2, terms_version = $4, terms_accepted_at = $3, updated_at = $3 WHERE id = $1', [
      invite.user_id,
      passwordHash,
      now,
      LEGAL.version,
    ]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [invite.user_id]);
    await sessionsChanged(tx);
    const row = await one<Parameters<typeof toActor>[0]>(tx, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1 AND u.status = 'ACTIVE'`, [invite.user_id]);
    if (!row) throw ruleViolation('INVITE_INVALID', 'This account is no longer active.');
    await audit(tx, row.id, 'INVITE_ACCEPTED', 'user', row.id);
    return { token: await createSession(tx, row.id, now, row.role === 'COURIER' ? COURIER_SESSION_HOURS : undefined), actor: toActor(row) };
  });
}

export async function listAccounts(db: Db, actor: Actor) {
  return db.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.created_at, (u.password_hash IS NOT NULL) AS active,
            m.name AS merchant_name, s.name AS sponsor_name
       FROM users u LEFT JOIN merchants m ON m.id = u.merchant_id LEFT JOIN sponsors s ON s.id = u.sponsor_id
      WHERE u.role <> 'RESIDENT' AND u.status <> 'DELETED'
        AND ($1::uuid IS NULL OR u.township_id = $1)
      ORDER BY u.role, u.full_name LIMIT 500`,
    [actor.townshipId],
  );
}

// --- Confirming homes (BR1) -------------------------------------------------

export async function listResidents(db: Db, actor: Actor, filter: { status: string } & PageQuery) {
  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  // Staff check the address and the property-record reference (unit_code) against SDP's records.
  const rows = await db.query<HomeAddress & { id: string; created_at: Date; unit_code: string }>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.occupancy, u.residency_status, u.member_code, u.created_at, h.unit_code, ${HOME_ADDRESS_COLUMNS}
       FROM users u JOIN homes h ON h.id = u.home_id
      WHERE u.role = 'RESIDENT' AND u.status = 'ACTIVE' AND u.residency_status = $1
        AND ($2::uuid IS NULL OR u.township_id = $2)
        AND ($3::timestamptz IS NULL OR (u.created_at, u.id) < ($3::timestamptz, $4::uuid))
      ORDER BY u.created_at DESC, u.id DESC LIMIT $5`,
    [filter.status, actor.townshipId, after, afterId, filter.limit + 1],
  );
  const page = toPage(rows, filter.limit, (r) => [r.created_at, r.id]);
  return { ...page, items: page.items.map((r) => ({ ...r, address: formatAddress(r) })) };
}

async function decideResidency(tx: Queryable, deciderId: string, userId: string, approve: boolean, now: Date): Promise<void> {
  await tx.query('UPDATE users SET residency_status = $2, verified_by = $3, verified_at = $4, updated_at = $4 WHERE id = $1', [
    userId,
    approve ? 'VERIFIED' : 'REJECTED',
    deciderId,
    now,
  ]);
  await sessionsChanged(tx);
  await audit(tx, deciderId, approve ? 'RESIDENT_VERIFIED' : 'RESIDENT_REJECTED', 'user', userId);
  await notify(tx, [userId], {
    title: approve ? 'Your home is confirmed' : 'We could not confirm your home',
    body: approve ? 'You can now earn Impact XP and SimeTown Points.' : 'Please contact the township office.',
    link: '/app',
  });
}

/** Township staff confirm a resident against the property record. */
export async function verifyResident(db: Db, actor: Actor, userId: string, approve: boolean, now: Date) {
  return db.tx(async (tx) => {
    const user = await one<{ township_id: string; residency_status: string }>(
      tx,
      `SELECT township_id, residency_status FROM users WHERE id = $1 AND role = 'RESIDENT' AND status = 'ACTIVE' FOR UPDATE`,
      [userId],
    );
    if (!user) throw notFound('Resident');
    assertTownshipAccess(actor, user.township_id);
    if (user.residency_status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This resident has already been reviewed.');
    await decideResidency(tx, actor.id, userId, approve, now);
    return { ok: true };
  });
}

const isVerifiedOwner = async (q: Queryable, actor: Actor) =>
  actor.residencyStatus === 'VERIFIED' &&
  Boolean(await one(q, `SELECT 1 FROM users WHERE id = $1 AND occupancy = 'OWNER'`, [actor.id]));

/** Tenants waiting for this owner to confirm them. */
export async function householdRequests(db: Db, actor: Actor) {
  if (!(await isVerifiedOwner(db, actor))) return [];
  return db.query(
    `SELECT id, full_name, created_at FROM users
      WHERE home_id = $1 AND occupancy = 'TENANT' AND residency_status = 'PENDING' AND status = 'ACTIVE' ORDER BY created_at`,
    [actor.homeId],
  );
}

/** A verified owner confirms a tenant of their own home, and only their own home. */
export async function decideTenant(db: Db, actor: Actor, tenantId: string, approve: boolean, now: Date) {
  return db.tx(async (tx) => {
    if (!(await isVerifiedOwner(tx, actor))) throw forbidden('Only a confirmed owner can do this.');
    const tenant = await one(
      tx,
      `SELECT 1 FROM users WHERE id = $1 AND home_id = $2 AND occupancy = 'TENANT' AND residency_status = 'PENDING' AND status = 'ACTIVE' FOR UPDATE`,
      [tenantId, actor.homeId],
    );
    if (!tenant) throw notFound('Request');
    await decideResidency(tx, actor.id, tenantId, approve, now);
    return { ok: true };
  });
}

// --- Personal data rights (BR18) ---------------------------------------------

/** Everything SimeTown holds about the signed-in person, as one JSON document. */
export async function exportMyData(db: Db, actor: Actor) {
  const id = actor.id;
  const [account, points, xp, sales, posts, responses, reports, dropoffs, checkins, readings, solar, notifications] = await Promise.all([
    profile(db, actor),
    db.query(
      `SELECT t.created_at, t.kind, t.label, -e.amount AS points
         FROM ledger_entries e JOIN ledger_txns t ON t.id = e.txn_id JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.user_id = $1 AND a.kind = 'WALLET' ORDER BY e.id`,
      [id],
    ),
    db.query('SELECT created_at, activity, xp, quantity FROM xp_events WHERE user_id = $1 ORDER BY id', [id]),
    db.query(
      `SELECT s.created_at, m.name AS shop, s.bill_sen, s.redeem_points, s.points_earned, s.status
         FROM sales s JOIN merchants m ON m.id = s.merchant_id WHERE s.user_id = $1 ORDER BY s.created_at`,
      [id],
    ),
    db.query('SELECT created_at, type, title, body, location, status FROM posts WHERE author_id = $1 ORDER BY created_at', [id]),
    db.query(
      `SELECT r.created_at, p.title, r.status FROM post_responses r JOIN posts p ON p.id = r.post_id WHERE r.user_id = $1 ORDER BY r.created_at`,
      [id],
    ),
    db.query('SELECT created_at, category, urgency, description, location_text, status FROM reports WHERE reporter_id = $1 ORDER BY created_at', [id]),
    db.query('SELECT created_at, material, weight_g FROM kitar_dropoffs WHERE user_id = $1 ORDER BY created_at', [id]),
    db.query(
      `SELECT c.created_at, cp.name AS checkpoint FROM gerak_checkins c JOIN gerak_checkpoints cp ON cp.id = c.checkpoint_id
        WHERE c.user_id = $1 ORDER BY c.created_at`,
      [id],
    ),
    db.query('SELECT month, electricity_kwh, water_litres FROM jimat_readings WHERE entered_by = $1 ORDER BY month', [id]),
    db.query('SELECT consent_at, note FROM solar_leads WHERE user_id = $1', [id]),
    db.query('SELECT created_at, title, body FROM notifications WHERE user_id = $1 ORDER BY id', [id]),
  ]);
  // Third-edition features: every table that holds something about this person.
  const [offerPoints, visitorPasses, access, carers, activities, bills, recycling, sightings, garden, gardenApplications, assistant, assistantQuestions] = await Promise.all([
    db.query('SELECT earned_at, label, amount, remaining, redeemed, expires_at FROM offer_point_lots WHERE user_id = $1 ORDER BY earned_at', [id]),
    db.query('SELECT created_at, type, visitor_name, vehicle_no, valid_from, valid_until, status FROM visitor_passes WHERE host_user_id = $1 ORDER BY created_at', [id]),
    db.query('SELECT needs, simple_mode, read_aloud, flash_alerts, priority_help, priority_note, consent_at FROM access_profiles WHERE user_id = $1', [id]),
    db.query(
      `SELECT c.created_at, c.status, CASE WHEN c.resident_id = $1 THEN 'my carer' ELSE 'I care for' END AS relation, u.full_name
         FROM carer_links c JOIN users u ON u.id = CASE WHEN c.resident_id = $1 THEN c.carer_id ELSE c.resident_id END
        WHERE c.resident_id = $1 OR c.carer_id = $1 ORDER BY c.created_at`,
      [id],
    ),
    db.query('SELECT started_at, finished_at, mode, status, distance_m, valid_m, active_s, route FROM gerak_activities WHERE user_id = $1 ORDER BY started_at', [id]),
    db.query(`SELECT created_at, kind, status, usage, amount_sen, period_month FROM jimat_bills WHERE user_id = $1 ORDER BY created_at`, [id]),
    db.query('SELECT started_at, mode, status, accepted_count, rejected_count, accepted_g FROM kitar_sessions WHERE user_id = $1 OR claimed_by = $1 ORDER BY started_at', [id]),
    db.query('SELECT created_at, kind, species, location, note, status FROM wildlife_sightings WHERE user_id = $1 ORDER BY created_at', [id]),
    db.query(`SELECT r.day, g.name AS garden, r.done_at FROM garden_roster r JOIN gardens g ON g.id = r.garden_id WHERE r.user_id = $1 ORDER BY r.day`, [id]),
    db.query(
      `SELECT a.created_at, g.name AS garden, a.status, p.plot_no, a.decided_at FROM garden_applications a JOIN gardens g ON g.id = a.garden_id
         LEFT JOIN garden_plots p ON p.id = a.plot_id WHERE a.user_id = $1 ORDER BY a.created_at`,
      [id],
    ),
    db.query(
      `SELECT c.title, c.created_at, m.role, m.content, m.link_href, m.created_at AS message_at
         FROM assistant_conversations c JOIN assistant_messages m ON m.conversation_id = c.id WHERE c.user_id = $1 ORDER BY c.created_at, m.id`,
      [id],
    ),
    db.query('SELECT created_at, question, status, answer, answered_at FROM assistant_handoffs WHERE user_id = $1 ORDER BY created_at', [id]),
  ]);
  await audit(db, id, 'DATA_EXPORTED', 'user', id);
  return {
    exportedAt: new Date().toISOString(), account, points, xp, sales, posts, responses, reports, dropoffs, checkins, readings, solar, notifications,
    offerPoints, visitorPasses, access, carers, activities, bills, recycling, sightings, garden, gardenApplications, assistant, assistantQuestions,
  };
}

/**
 * Deletes the account. Personal details are wiped; the row and the ledger
 * history stay, anonymised, because financial records must remain complete.
 * Any points left are released back to whoever funded them.
 */
export async function deleteAccount(db: Db, actor: Actor, password: string, now: Date) {
  const row = await one<{ password_hash: string | null }>(db, 'SELECT password_hash FROM users WHERE id = $1', [actor.id]);
  if (!(await verifyPassword(password, row?.password_hash ?? null))) {
    throw ruleViolation('WRONG_PASSWORD', 'Your password is not correct.');
  }
  return db.tx(async (tx) => {
    const id = actor.id;
    if (actor.role === 'RESIDENT') {
      await tx.query(`UPDATE sales SET status = 'DECLINED' WHERE user_id = $1 AND status = 'PENDING'`, [id]);
      await expireLotsForUser(tx, id, { all: true }, now, 'Account closed');
    }
    await tx.query(`UPDATE posts SET status = 'REMOVED', title = '[removed]', body = '[removed]', location = NULL WHERE author_id = $1`, [id]);
    await tx.query('DELETE FROM post_responses WHERE user_id = $1', [id]);
    await tx.query(`UPDATE reports SET photo_id = NULL, description = '[removed at the reporter''s request]' WHERE reporter_id = $1`, [id]);
    await tx.query(`UPDATE wildlife_sightings SET photo_id = NULL, note = NULL WHERE user_id = $1`, [id]);
    await tx.query('DELETE FROM uploads WHERE owner_id = $1', [id]);
    // Third-edition features: access needs, carers, visitors, routes, bills, offer points, gardens.
    await tx.query('DELETE FROM access_profiles WHERE user_id = $1', [id]);
    await tx.query(`UPDATE carer_links SET status = 'REVOKED', revoked_at = $2 WHERE (resident_id = $1 OR carer_id = $1) AND status <> 'REVOKED'`, [id, now]);
    await tx.query(`UPDATE visitor_passes SET status = 'CANCELLED', visitor_name = '[removed]', vehicle_no = NULL WHERE host_user_id = $1`, [id]);
    await tx.query(
      `UPDATE gerak_activities SET route = '[]', route_deleted_at = $2, status = CASE WHEN status = 'ACTIVE' THEN 'ABANDONED' ELSE status END WHERE user_id = $1`,
      [id, now],
    );
    await tx.query(`DELETE FROM jimat_bills WHERE user_id = $1 AND status <> 'CONFIRMED'`, [id]);
    await tx.query('UPDATE offer_point_lots SET remaining = 0 WHERE user_id = $1 AND remaining > 0', [id]);
    await tx.query(`UPDATE kitar_sessions SET status = 'EXPIRED', closed_at = $2 WHERE user_id = $1 AND status = 'OPEN'`, [id, now]);
    await tx.query('UPDATE garden_plots SET holder_home_id = NULL, holder_user_id = NULL, booked_until = NULL WHERE holder_user_id = $1', [id]);
    await tx.query('DELETE FROM garden_roster WHERE user_id = $1 AND done_at IS NULL', [id]);
    await tx.query(`UPDATE garden_applications SET status = 'WITHDRAWN', decided_at = $2 WHERE user_id = $1 AND status = 'WAITING'`, [id, now]);
    await tx.query('DELETE FROM assistant_handoffs WHERE user_id = $1', [id]);
    await tx.query('DELETE FROM assistant_conversations WHERE user_id = $1', [id]);
    await tx.query('DELETE FROM solar_leads WHERE user_id = $1', [id]);
    await tx.query('DELETE FROM notifications WHERE user_id = $1', [id]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await sessionsChanged(tx);
    await tx.query('DELETE FROM user_invites WHERE user_id = $1', [id]);
    await tx.query(
      `UPDATE users SET status = 'DELETED', email = 'deleted-' || id || '@invalid', full_name = 'Deleted user', phone = NULL,
              password_hash = NULL, member_code = CASE WHEN member_code IS NULL THEN NULL ELSE $2 END, updated_at = $3
        WHERE id = $1`,
      [id, `X${randomCode(11)}`, now],
    );
    await audit(tx, null, 'ACCOUNT_DELETED', 'user', id);
    return { ok: true };
  });
}
