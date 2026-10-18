import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { issueInvite } from '../identity/service';
import { courierAccountOf } from '../lockers/couriers';
import { raiseIncident } from '../lockers/incidents';
import { notify } from '../notifications';
import { companyEvent } from './companies';

/**
 * A courier company looking after its own couriers. Its managers (named by the
 * company and added by a township admin) invite couriers, suspend them, and
 * reconfirm them from time to time; the township never approves them one by
 * one. A courier who signs in through the company's own identity system is
 * added automatically on first sign-in, and the company's managers can still
 * suspend them here at once.
 */

/** How long a company-managed courier stays confirmed before their company must reconfirm them. */
export const RECONFIRM_DAYS = 90;

interface Manager {
  user_id: string;
  company_id: string;
  township_id: string;
  company: string;
  auth_method: 'MANUAL' | 'COMPANY_MANAGED' | 'FEDERATED';
}

async function requireManager(q: Queryable, actor: Actor): Promise<Manager> {
  const account = await courierAccountOf(q, actor);
  if (account.kind !== 'MANAGER' || account.status !== 'ACTIVE') throw forbidden('Only your company’s managers can do this.');
  const m = await one<Manager & { status: string }>(
    q,
    `SELECT a.user_id, a.company_id, a.township_id, c.name AS company, c.auth_method, t.status
       FROM courier_accounts a JOIN courier_companies c ON c.id = a.company_id
       JOIN courier_company_townships t ON t.company_id = a.company_id AND t.township_id = a.township_id
      WHERE a.user_id = $1`,
    [actor.id],
  );
  if (!m || m.status !== 'ACTIVE') throw forbidden('Your company is not authorised here at the moment.');
  return m;
}

export async function teamOverview(db: Db, actor: Actor, now: Date) {
  const m = await requireManager(db, actor);
  const company = await one(
    db,
    `SELECT c.name, c.code, c.auth_method, c.provider_mode, t.agreement_until::text AS agreement_until, t.min_assurance,
            coalesce((SELECT json_agg(s.name ORDER BY s.name) FROM courier_company_stations cs JOIN locker_stations s ON s.id = cs.station_id WHERE cs.company_id = c.id AND s.township_id = t.township_id), '[]') AS stations
       FROM courier_companies c JOIN courier_company_townships t ON t.company_id = c.id AND t.township_id = $2 WHERE c.id = $1`,
    [m.company_id, m.township_id],
  );
  const couriers = await db.query(
    `SELECT a.user_id, u.full_name, u.email, a.employee_ref, a.status, a.managed_by, a.last_verified_at,
            (a.last_verified_at < $3::timestamptz - make_interval(days => $4)) AS needs_reconfirming,
            (SELECT max(l.at) FROM courier_logins l WHERE l.user_id = a.user_id) AS last_sign_in,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.courier_user_id = a.user_id AND p.registered_at > $3::timestamptz - interval '30 days') AS deliveries_30d,
            (SELECT count(*)::int FROM courier_scans s WHERE s.courier_user_id = a.user_id AND s.outcome IN ('ALREADY_DEPOSITED', 'NOT_FOUND') AND s.at > $3::timestamptz - interval '30 days') AS refused_scans_30d
       FROM courier_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.company_id = $1 AND a.township_id = $2 AND a.kind = 'COURIER'
      ORDER BY (a.status = 'ACTIVE') DESC, u.full_name`,
    [m.company_id, m.township_id, now, RECONFIRM_DAYS - 14],
  );
  return { company, couriers, reconfirmDays: RECONFIRM_DAYS };
}

/** Adds one of the company's own couriers. They get a link to set a password; no township approval is needed. */
export async function inviteCourier(db: Db, actor: Actor, input: { fullName: string; email: string; phone?: string | null; employeeRef: string }, now: Date) {
  const m = await requireManager(db, actor);
  if (m.auth_method === 'FEDERATED') throw ruleViolation('USE_COMPANY_SIGN_IN', 'Your couriers sign in with your company’s own sign-in, so there is nobody to invite here.');
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email.trim()])) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    const ref = input.employeeRef.trim().toUpperCase();
    if (await one(tx, 'SELECT 1 FROM courier_accounts WHERE company_id = $1 AND employee_ref = $2', [m.company_id, ref])) throw conflict('EMPLOYEE_EXISTS', 'A courier with this staff number already has an account.');
    const user = await one<{ id: string }>(
      tx, `INSERT INTO users (email, full_name, phone, role, township_id) VALUES ($1, $2, $3, 'COURIER', $4) RETURNING id`, [input.email.trim(), input.fullName.trim(), input.phone ?? null, m.township_id],
    );
    await tx.query(
      `INSERT INTO courier_accounts (user_id, company_id, township_id, status, kind, managed_by, employee_ref, applied_at, decided_by, decided_at, invited_by, last_verified_at)
       VALUES ($1, $2, $3, 'ACTIVE', 'COURIER', 'COMPANY', $4, $5, $6, $5, $6, $5)`,
      [user!.id, m.company_id, m.township_id, ref, now, actor.id],
    );
    await companyEvent(tx, m.company_id, m.township_id, 'COURIER_ADDED', actor.id, `${input.fullName.trim()} (${ref})`, now);
    await audit(tx, actor.id, 'COURIER_INVITED_BY_COMPANY', 'user', user!.id, { companyId: m.company_id, employeeRef: ref });
    return { id: user!.id, inviteToken: await issueInvite(tx, user!.id, actor.id, now) };
  });
}

async function loadMember(tx: Queryable, m: Manager, userId: string) {
  const a = await one<{ status: string; full_name: string; managed_by: string }>(
    tx,
    `SELECT a.status, a.managed_by, u.full_name FROM courier_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1 AND a.company_id = $2 AND a.township_id = $3 AND a.kind = 'COURIER' FOR UPDATE OF a`,
    [userId, m.company_id, m.township_id],
  );
  if (!a || a.managed_by === 'TOWNSHIP') throw notFound('Courier');
  return a;
}

/** Suspend, reactivate or remove one of the company's couriers. A suspension ends their sessions at once. */
export async function setTeamMember(db: Db, actor: Actor, userId: string, input: { status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'; note?: string }, now: Date) {
  const m = await requireManager(db, actor);
  return db.tx(async (tx) => {
    const a = await loadMember(tx, m, userId);
    if (a.status === 'REVOKED') throw ruleViolation('REVOKED', 'A removed courier cannot be brought back. Invite them again.');
    await tx.query(
      `UPDATE courier_accounts SET status = $2, decided_by = $3, decided_at = $4, note = $5, last_verified_at = CASE WHEN $2 = 'ACTIVE' THEN $4 ELSE last_verified_at END WHERE user_id = $1`,
      [userId, input.status, actor.id, now, input.note?.trim() || null],
    );
    if (input.status !== 'ACTIVE') await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await companyEvent(tx, m.company_id, m.township_id, `COURIER_${input.status}`, actor.id, `${a.full_name}${input.note ? `: ${input.note.trim()}` : ''}`, now);
    await audit(tx, actor.id, `COURIER_${input.status}_BY_COMPANY`, 'user', userId, { note: input.note });
    if (input.status !== 'REVOKED') {
      await notify(tx, [userId], {
        title: input.status === 'ACTIVE' ? 'Your locker access is active' : 'Your locker access is suspended',
        body: input.status === 'ACTIVE' ? `${m.company} has reactivated your access to the township’s lockers.` : `${m.company} has suspended your access to the township’s lockers.`,
        link: '/courier',
      });
    }
    return { ok: true };
  });
}

/** The company confirms that this courier still works for it. */
export async function reconfirmCourier(db: Db, actor: Actor, userId: string, now: Date) {
  const m = await requireManager(db, actor);
  return db.tx(async (tx) => {
    const a = await loadMember(tx, m, userId);
    if (a.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'Reactivate the courier instead.');
    await tx.query('UPDATE courier_accounts SET last_verified_at = $2 WHERE user_id = $1', [userId, now]);
    await companyEvent(tx, m.company_id, m.township_id, 'COURIER_RECONFIRMED', actor.id, a.full_name, now);
    return { ok: true };
  });
}

/**
 * A courier signed in. Recorded, and many places in a short time (a login
 * shared or stolen) is an incident for staff and the company.
 */
export async function recordCourierLogin(db: Db, userId: string, method: 'PASSWORD' | 'FEDERATED', ip: string, userAgent: string | null, now: Date) {
  await db.query('INSERT INTO courier_logins (user_id, method, ip, user_agent, at) VALUES ($1, $2, $3, $4, $5)', [userId, method, ip, userAgent?.slice(0, 200) ?? null, now]);
  const places = await one<{ n: number }>(db, `SELECT count(DISTINCT ip)::int AS n FROM courier_logins WHERE user_id = $1 AND at > $2::timestamptz - interval '1 hour'`, [userId, now]);
  if (places!.n >= 4) {
    const who = await one<{ township_id: string; company_id: string; full_name: string }>(
      db, 'SELECT a.township_id, a.company_id, u.full_name FROM courier_accounts a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1', [userId],
    );
    if (who) {
      await raiseIncident(db, {
        townshipId: who.township_id, kind: 'SUSPICIOUS_LOGIN', severity: 'HIGH', companyId: who.company_id, userId,
        summary: `${who.full_name} signed in from ${places!.n} different places within an hour. The login may be shared or stolen.`,
        dedupeKey: `logins:${userId}:${now.toISOString().slice(0, 13)}`,
      }, now);
    }
  }
}

/**
 * The daily check: couriers their company has not reconfirmed in time are
 * suspended until it does, agreements about to end are flagged, and an ended
 * agreement ends its couriers' sessions.
 */
export async function revalidateCouriers(db: Db, now: Date) {
  const stale = await db.query<{ user_id: string; company_id: string; township_id: string; full_name: string }>(
    `UPDATE courier_accounts a SET status = 'SUSPENDED', note = 'Not reconfirmed by the company in time', decided_at = $1
       FROM users u WHERE u.id = a.user_id AND a.kind = 'COURIER' AND a.managed_by = 'COMPANY' AND a.status = 'ACTIVE'
        AND a.last_verified_at < $1::timestamptz - make_interval(days => $2)
     RETURNING a.user_id, a.company_id, a.township_id, u.full_name`,
    [now, RECONFIRM_DAYS],
  );
  for (const s of stale) {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [s.user_id]);
    await companyEvent(db, s.company_id, s.township_id, 'COURIER_SUSPENDED', null, `${s.full_name}: not reconfirmed within ${RECONFIRM_DAYS} days`, now);
    const managers = await db.query<{ user_id: string }>(`SELECT user_id FROM courier_accounts WHERE company_id = $1 AND township_id = $2 AND kind = 'MANAGER' AND status = 'ACTIVE'`, [s.company_id, s.township_id]);
    await notify(db, managers.map((x) => x.user_id), { title: 'A courier needs reconfirming', body: `${s.full_name} was paused because nobody reconfirmed them in ${RECONFIRM_DAYS} days.`, link: '/courier/team' });
  }
  const ending = await db.query<{ company_id: string; township_id: string; name: string; agreement_until: string; ended: boolean }>(
    `SELECT t.company_id, t.township_id, c.name, t.agreement_until::text AS agreement_until, (t.agreement_until < ($1::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS ended
       FROM courier_company_townships t JOIN courier_companies c ON c.id = t.company_id
      WHERE t.status = 'ACTIVE' AND t.agreement_until IS NOT NULL AND t.agreement_until < ($1::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 14`,
    [now],
  );
  for (const e of ending) {
    const admins = await db.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE'`, [e.township_id]);
    await notify(db, admins.map((a) => a.id), {
      title: e.ended ? `${e.name}: agreement ended` : `${e.name}: agreement ends soon`,
      body: e.ended ? `Its couriers can no longer use the lockers. Renew the agreement to restore access.` : `The agreement ends on ${e.agreement_until}. Renew it to keep its couriers working.`,
      link: '/console/lockers',
      dedupeKey: `agreement:${e.company_id}:${e.township_id}:${e.agreement_until}:${e.ended ? 'ended' : 'soon'}`,
    });
    if (e.ended && (await companyEvent(db, e.company_id, e.township_id, 'AGREEMENT_ENDED', null, e.agreement_until, now, `agreement-ended:${e.township_id}:${e.agreement_until}`))) {
      await db.query('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM courier_accounts WHERE company_id = $1 AND township_id = $2)', [e.company_id, e.township_id]);
    }
  }
  await db.query(`DELETE FROM courier_login_states WHERE expires_at < $1::timestamptz - interval '1 day'`, [now]);
  return { suspended: stale.length, agreementsFlagged: ending.length };
}
