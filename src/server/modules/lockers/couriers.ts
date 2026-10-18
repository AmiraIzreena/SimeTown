import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { hashPassword } from '../../auth/password';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';

/**
 * Couriers. A township admin approves courier companies and the stations each
 * may use; an approved company then manages its own couriers (its managers
 * invite and suspend them, or they sign in through the company's own identity
 * system). Couriers of companies without that arrangement still apply and are
 * approved one by one (the fallback). Every courier action checks, on the
 * server, that the account, its company and the company's agreement are all
 * in force and that the station is allowed: a QR code on a locker, or a
 * barcode on a parcel, grants nothing by itself.
 */

export async function listCompanies(db: Db, all = false) {
  return db.query(`SELECT id, name, active, code, auth_method, provider_mode FROM courier_companies WHERE $1::boolean OR active ORDER BY name`, [all]);
}

/**
 * A company whose couriers are approved one by one (the fallback), authorised
 * at once in the admin's township (every township, for HQ). Companies that
 * manage their own couriers are onboarded with their details instead.
 */
export async function createCompany(db: Db, actor: Actor, name: string) {
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM courier_companies WHERE lower(name) = lower($1)', [name.trim()])) throw conflict('COMPANY_EXISTS', 'This courier company is already listed.');
    const row = await one<{ id: string }>(tx, 'INSERT INTO courier_companies (name) VALUES ($1) RETURNING id', [name.trim()]);
    await tx.query(
      `INSERT INTO courier_company_townships (company_id, township_id, status, verified_note, approved_by, approved_at)
       SELECT $1, t.id, 'ACTIVE', 'Couriers approved one by one', $2, now() FROM townships t WHERE $3::uuid IS NULL OR t.id = $3`,
      [row!.id, actor.id, actor.role === 'HQ_ADMIN' ? null : actor.townshipId],
    );
    await audit(tx, actor.id, 'COURIER_COMPANY_ADDED', 'courier_company', row!.id, { name: name.trim() });
    return { id: row!.id };
  });
}

export async function setCompanyActive(db: Db, actor: Actor, id: string, active: boolean) {
  const rows = await db.query('UPDATE courier_companies SET active = $2 WHERE id = $1 RETURNING id', [id, active]);
  if (rows.length === 0) throw notFound('Courier company');
  await audit(db, actor.id, active ? 'COURIER_COMPANY_RESUMED' : 'COURIER_COMPANY_PAUSED', 'courier_company', id);
  return { ok: true };
}

export interface CourierApplication {
  townshipId: string;
  companyId: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

/** A courier asks for an account. It can sign in at once but do nothing until an admin approves it. */
export async function applyAsCourier(db: Db, input: CourierApplication, now: Date) {
  const passwordHash = await hashPassword(input.password);
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email])) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    const company = await one<{ auth_method: string }>(tx, 'SELECT auth_method FROM courier_companies WHERE id = $1 AND active', [input.companyId]);
    if (!company) throw notFound('Courier company');
    // A company that manages its own couriers is the one to vouch for them: nobody can sign up as one of its couriers.
    if (company.auth_method === 'COMPANY_MANAGED') throw ruleViolation('ASK_YOUR_COMPANY', 'This company adds its own couriers. Ask your manager for an invitation.');
    if (company.auth_method === 'FEDERATED') throw ruleViolation('USE_COMPANY_SIGN_IN', 'Couriers of this company sign in with the company’s own sign-in. Choose “Sign in with your courier company”.');
    if (!(await one(tx, 'SELECT 1 FROM townships WHERE id = $1', [input.townshipId]))) throw notFound('Township');
    const user = await one<{ id: string }>(
      tx,
      `INSERT INTO users (email, password_hash, full_name, phone, role, township_id) VALUES ($1, $2, $3, $4, 'COURIER', $5) RETURNING id`,
      [input.email.trim(), passwordHash, input.fullName.trim(), input.phone, input.townshipId],
    );
    await tx.query('INSERT INTO courier_accounts (user_id, company_id, township_id, applied_at) VALUES ($1, $2, $3, $4)', [user!.id, input.companyId, input.townshipId, now]);
    await audit(tx, user!.id, 'COURIER_APPLIED', 'courier_account', user!.id);
    const admins = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE'`, [input.townshipId]);
    await notify(tx, admins.map((a) => a.id), { title: 'A courier asked for locker access', body: `${input.fullName.trim()} applied for a courier account.`, link: '/console/lockers' });
    return { id: user!.id, status: 'PENDING' as const };
  });
}

export interface CourierAccount {
  user_id: string;
  company_id: string;
  company: string;
  township_id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  kind: 'COURIER' | 'MANAGER';
  managed_by: 'TOWNSHIP' | 'COMPANY' | 'FEDERATED';
  employee_ref: string | null;
}

/** The signed-in courier's account, whatever its status. */
export async function courierAccountOf(q: Queryable, actor: Actor): Promise<CourierAccount> {
  if (actor.role !== 'COURIER') throw forbidden();
  const row = await one<CourierAccount>(
    q,
    `SELECT a.user_id, a.company_id, c.name AS company, a.township_id, a.status, a.kind, a.managed_by, a.employee_ref
       FROM courier_accounts a JOIN courier_companies c ON c.id = a.company_id WHERE a.user_id = $1`,
    [actor.id],
  );
  if (!row) throw forbidden('This is not a courier account.');
  return row;
}

const STATUS_MESSAGES: Record<Exclude<CourierAccount['status'], 'ACTIVE'>, string> = {
  PENDING: 'Your courier account is waiting for approval.',
  SUSPENDED: 'Your company has suspended your locker access.',
  REVOKED: 'Your courier access has been withdrawn.',
};

/** Why this courier cannot work at all right now, or null when they can. Station access is checked separately. */
export async function courierBlock(q: Queryable, account: CourierAccount, townshipId: string, now: Date): Promise<string | null> {
  if (account.kind === 'MANAGER') return 'Manager accounts look after couriers; they cannot open lockers.';
  if (account.status !== 'ACTIVE') return STATUS_MESSAGES[account.status];
  const company = await one<{ active: boolean; status: string | null; expired: boolean | null }>(
    q,
    `SELECT c.active, t.status, (t.agreement_until < ($3::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS expired
       FROM courier_companies c LEFT JOIN courier_company_townships t ON t.company_id = c.id AND t.township_id = $2
      WHERE c.id = $1`,
    [account.company_id, townshipId, now],
  );
  if (!company?.active || company.status !== 'ACTIVE') return 'Your courier company is not authorised here at the moment.';
  if (company.expired) return 'Your company’s agreement with the township has ended.';
  return null;
}

/** The stations a courier may use ($1 is the courier): their own list when approved one by one, otherwise their company's. */
export const COURIER_STATIONS_SQL = `
  SELECT x.station_id FROM courier_station_access x JOIN courier_accounts a ON a.user_id = x.user_id WHERE a.user_id = $1 AND a.managed_by = 'TOWNSHIP'
  UNION
  SELECT cs.station_id FROM courier_company_stations cs JOIN courier_accounts a ON a.company_id = cs.company_id WHERE a.user_id = $1 AND a.managed_by <> 'TOWNSHIP'`;

/** An active courier of an approved company, allowed at this station. Checked on every courier action. */
export async function requireCourierAt(q: Queryable, actor: Actor, stationId: string, now: Date = new Date()): Promise<CourierAccount> {
  const account = await courierAccountOf(q, actor);
  const station = await one<{ township_id: string }>(q, 'SELECT township_id FROM locker_stations WHERE id = $1', [stationId]);
  if (!station) throw notFound('Station');
  const blocked = await courierBlock(q, account, station.township_id, now);
  if (blocked) throw forbidden(blocked);
  if (!(await one(q, `SELECT 1 FROM (${COURIER_STATIONS_SQL}) z WHERE z.station_id = $2`, [actor.id, stationId]))) {
    throw forbidden('You do not have access to this locker station.');
  }
  return account;
}

export async function listCouriers(db: Db, actor: Actor) {
  return db.query(
    `SELECT a.user_id, u.full_name, u.email, u.phone, c.name AS company, a.status, a.kind, a.managed_by, a.employee_ref, a.last_verified_at, a.applied_at, a.decided_at,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                        FROM locker_stations s WHERE s.id IN (${COURIER_STATIONS_SQL.replaceAll('$1', 'a.user_id')})), '[]') AS stations,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.courier_user_id = a.user_id AND p.registered_at > now() - interval '30 days') AS deliveries_30d
       FROM courier_accounts a JOIN users u ON u.id = a.user_id JOIN courier_companies c ON c.id = a.company_id
      WHERE ($1::uuid IS NULL OR a.township_id = $1)
      ORDER BY (a.status = 'PENDING') DESC, a.applied_at DESC`,
    [actor.townshipId],
  );
}

async function loadAccount(tx: Queryable, actor: Actor, userId: string) {
  const a = await one<{ township_id: string; status: string; full_name: string; managed_by: string }>(
    tx, 'SELECT a.township_id, a.status, a.managed_by, u.full_name FROM courier_accounts a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1 FOR UPDATE OF a', [userId],
  );
  if (!a) throw notFound('Courier');
  assertTownshipAccess(actor, a.township_id);
  return a;
}

/** Approve (or re-approve) a courier for a set of stations. Only the listed stations are allowed afterwards. */
export async function approveCourier(db: Db, actor: Actor, userId: string, stationIds: string[], now: Date) {
  return db.tx(async (tx) => {
    const a = await loadAccount(tx, actor, userId);
    if (a.managed_by !== 'TOWNSHIP') throw ruleViolation('COMPANY_MANAGED', 'This courier’s company manages its own couriers. Change the company’s stations instead.');
    if (stationIds.length === 0) throw ruleViolation('NO_STATIONS', 'Choose at least one station.');
    const ok = await tx.query<{ id: string }>('SELECT id FROM locker_stations WHERE id = ANY($1::uuid[]) AND township_id = $2', [stationIds, a.township_id]);
    if (ok.length !== new Set(stationIds).size) throw notFound('Station');
    await tx.query(`UPDATE courier_accounts SET status = 'ACTIVE', decided_by = $2, decided_at = $3 WHERE user_id = $1`, [userId, actor.id, now]);
    await tx.query('DELETE FROM courier_station_access WHERE user_id = $1', [userId]);
    for (const s of ok) await tx.query('INSERT INTO courier_station_access (user_id, station_id, granted_by, granted_at) VALUES ($1, $2, $3, $4)', [userId, s.id, actor.id, now]);
    await audit(tx, actor.id, 'COURIER_APPROVED', 'courier_account', userId, { stations: ok.map((s) => s.id) });
    await notify(tx, [userId], { title: 'Your locker access is approved', body: `You can deliver to ${ok.length} locker station${ok.length === 1 ? '' : 's'}.`, link: '/courier' });
    return { ok: true };
  });
}

/** Withdraw a courier's access at once, whoever manages them (an emergency stop). Their sessions end at once. */
export async function revokeCourier(db: Db, actor: Actor, userId: string, note: string | undefined, now: Date) {
  return db.tx(async (tx) => {
    await loadAccount(tx, actor, userId);
    await tx.query(`UPDATE courier_accounts SET status = 'REVOKED', decided_by = $2, decided_at = $3, note = $4 WHERE user_id = $1`, [userId, actor.id, now, note?.trim() || null]);
    await tx.query('DELETE FROM courier_station_access WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await audit(tx, actor.id, 'COURIER_REVOKED', 'courier_account', userId, { note });
    return { ok: true };
  });
}

/** The stations this courier may use, with free compartments by size, and how their company checks shipments. */
export async function courierHome(db: Db, actor: Actor, now: Date = new Date()) {
  const account = await courierAccountOf(db, actor);
  const blocked = await courierBlock(db, account, account.township_id, now);
  const company = (await one<{ provider_mode: string }>(db, 'SELECT provider_mode FROM courier_companies WHERE id = $1', [account.company_id]))!;
  const stations = blocked
    ? []
    : await db.query(
        `SELECT s.id, s.name, s.code, s.location, s.status, s.adapter,
                (SELECT json_object_agg(size, n) FROM (SELECT size, count(*)::int AS n FROM locker_compartments c WHERE c.station_id = s.id AND c.state = 'AVAILABLE' GROUP BY size) z) AS free
           FROM locker_stations s WHERE s.id IN (${COURIER_STATIONS_SQL}) ORDER BY s.name`,
        [actor.id],
      );
  return {
    account: {
      company: account.company, status: account.status, kind: account.kind, managedBy: account.managed_by, blocked,
      // How a parcel is checked: through the company's system (simulated in the demo), or not at all.
      verification: company.provider_mode as 'NONE' | 'SIMULATED' | 'GATEWAY',
    },
    stations,
  };
}
