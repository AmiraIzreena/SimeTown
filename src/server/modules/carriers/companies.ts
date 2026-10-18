import { ADMINS } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { issueInvite } from '../identity/service';
import { notify } from '../notifications';
import { resolveTownship } from '../townships';

/**
 * Courier companies, approved once per township. A township admin checks who
 * the company is (its registration, a signed agreement), approves it for
 * chosen stations until its agreement ends, and adds the people the company
 * has named as its representatives. From then on the company looks after its
 * own couriers. Nobody becomes a representative by claiming to be one: only
 * an admin can add them.
 */

export async function companyEvent(q: Queryable, companyId: string, townshipId: string | null, action: string, actorId: string | null, note: string | null, now: Date, webhookEventId?: string) {
  const rows = await q.query(
    `INSERT INTO courier_company_events (company_id, township_id, action, actor_id, note, webhook_event_id, at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (company_id, webhook_event_id) WHERE webhook_event_id IS NOT NULL DO NOTHING RETURNING id`,
    [companyId, townshipId, action, actorId, note, webhookEventId ?? null, now],
  );
  return rows.length > 0;
}

function requireAdmin(actor: Actor) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only a township admin can change courier companies.');
}

export async function listCourierCompanies(db: Db, actor: Actor, now: Date) {
  const townshipId = await resolveTownship(db, actor);
  return db.query(
    `SELECT c.id, c.name, c.code, c.active, c.auth_method, c.provider_mode, c.provider_url, c.provider_secret_env, c.can_confirm_assignment, c.tracking_pattern,
            c.idp_mode, c.idp_issuer, c.idp_client_id, c.idp_client_secret_env, c.webhook_secret_env, c.require_mfa, c.sim_outage,
            c.support_name, c.support_url, c.support_phone, c.support_verified_at,
            c.provider_checked_at, c.provider_ok, c.provider_error, c.provider_latency_ms,
            t.status, t.verified_note, t.agreement_ref, t.agreement_until::text AS agreement_until, t.min_assurance, t.allow_fallback, t.status_reason, t.approved_at,
            (t.agreement_until < ($2::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS agreement_expired,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                        FROM courier_company_stations cs JOIN locker_stations s ON s.id = cs.station_id WHERE cs.company_id = c.id AND s.township_id = $1), '[]') AS stations,
            coalesce((SELECT json_agg(json_build_object('userId', a.user_id, 'fullName', u.full_name, 'email', u.email, 'status', a.status) ORDER BY u.full_name)
                        FROM courier_accounts a JOIN users u ON u.id = a.user_id WHERE a.company_id = c.id AND a.township_id = $1 AND a.kind = 'MANAGER'), '[]') AS managers,
            (SELECT count(*)::int FROM courier_accounts a WHERE a.company_id = c.id AND a.township_id = $1 AND a.kind = 'COURIER' AND a.status = 'ACTIVE') AS couriers_active,
            (SELECT count(*)::int FROM courier_accounts a WHERE a.company_id = c.id AND a.township_id = $1 AND a.kind = 'COURIER' AND a.status <> 'ACTIVE') AS couriers_inactive,
            (SELECT count(*)::int FROM locker_parcels p WHERE p.company_id = c.id AND p.township_id = $1 AND p.registered_at > $2::timestamptz - interval '30 days') AS deliveries_30d,
            coalesce((SELECT json_agg(e ORDER BY e.at DESC) FROM (
                SELECT ev.action, ev.note, ev.at, u.full_name AS actor FROM courier_company_events ev LEFT JOIN users u ON u.id = ev.actor_id
                 WHERE ev.company_id = c.id AND (ev.township_id = $1 OR ev.township_id IS NULL) ORDER BY ev.at DESC LIMIT 6) e), '[]') AS history
       FROM courier_companies c LEFT JOIN courier_company_townships t ON t.company_id = c.id AND t.township_id = $1
      ORDER BY (t.status = 'PENDING') DESC NULLS LAST, c.name`,
    [townshipId, now],
  );
}

export interface IntegrationInput {
  authMethod: 'MANUAL' | 'COMPANY_MANAGED' | 'FEDERATED';
  providerMode: 'NONE' | 'SIMULATED' | 'GATEWAY';
  providerUrl?: string | null;
  providerSecretEnv?: string | null;
  canConfirmAssignment?: boolean;
  trackingPattern?: string | null;
  idpMode?: 'SIMULATED' | 'OIDC' | null;
  idpIssuer?: string | null;
  idpClientId?: string | null;
  idpClientSecretEnv?: string | null;
  webhookSecretEnv?: string | null;
  requireMfa?: boolean;
}

function checkIntegration(i: IntegrationInput) {
  if (i.trackingPattern) {
    try {
      new RegExp(i.trackingPattern);
    } catch {
      throw ruleViolation('PATTERN', 'The tracking number pattern is not a valid regular expression.');
    }
  }
  if (i.providerMode === 'GATEWAY' && (!i.providerUrl?.startsWith('https://') || !i.providerSecretEnv)) {
    throw ruleViolation('GATEWAY_SETTINGS', 'A connected provider needs an https address and the name of the environment variable that holds its secret.');
  }
  if (i.authMethod === 'FEDERATED' && !i.idpMode) throw ruleViolation('IDP_SETTINGS', 'Choose how this company’s couriers sign in.');
  if (i.idpMode === 'OIDC' && (!i.idpIssuer?.startsWith('https://') || !i.idpClientId || !i.idpClientSecretEnv)) {
    throw ruleViolation('IDP_SETTINGS', 'OpenID Connect needs the issuer (https), the client id and the name of the environment variable holding the client secret.');
  }
}

/** Start onboarding a company in this township. It can do nothing until an admin approves it. */
export async function onboardCompany(db: Db, actor: Actor, input: IntegrationInput & { name: string; code: string }, now: Date) {
  requireAdmin(actor);
  checkIntegration(input);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    const code = input.code.trim().toUpperCase();
    if (await one(tx, 'SELECT 1 FROM courier_companies WHERE lower(name) = lower($1) OR code = $2', [input.name.trim(), code])) {
      throw conflict('COMPANY_EXISTS', 'A courier company with this name or code is already listed.');
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO courier_companies (name, code, auth_method, provider_mode, provider_url, provider_secret_env, can_confirm_assignment, tracking_pattern,
                                      idp_mode, idp_issuer, idp_client_id, idp_client_secret_env, webhook_secret_env, require_mfa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [
        input.name.trim(), code, input.authMethod, input.providerMode, input.providerUrl ?? null, input.providerSecretEnv ?? null, input.canConfirmAssignment ?? false,
        input.trackingPattern ?? null, input.idpMode ?? null, input.idpIssuer ?? null, input.idpClientId ?? null, input.idpClientSecretEnv ?? null,
        input.webhookSecretEnv ?? null, input.requireMfa ?? false,
      ],
    );
    await tx.query(`INSERT INTO courier_company_townships (company_id, township_id, status) VALUES ($1, $2, 'PENDING')`, [row!.id, townshipId]);
    await companyEvent(tx, row!.id, townshipId, 'ONBOARDING_STARTED', actor.id, null, now);
    await audit(tx, actor.id, 'COURIER_COMPANY_ONBOARDED', 'courier_company', row!.id, { name: input.name, authMethod: input.authMethod, providerMode: input.providerMode });
    return { id: row!.id };
  });
}

/** How a company's couriers sign in and how its shipments are checked. Applies wherever the company works. */
export async function updateIntegration(db: Db, actor: Actor, companyId: string, input: IntegrationInput, now: Date) {
  requireAdmin(actor);
  checkIntegration(input);
  return db.tx(async (tx) => {
    const rows = await tx.query(
      `UPDATE courier_companies SET auth_method = $2, provider_mode = $3, provider_url = $4, provider_secret_env = $5, can_confirm_assignment = $6, tracking_pattern = $7,
              idp_mode = $8, idp_issuer = $9, idp_client_id = $10, idp_client_secret_env = $11, webhook_secret_env = $12, require_mfa = $13
        WHERE id = $1 RETURNING id`,
      [
        companyId, input.authMethod, input.providerMode, input.providerUrl ?? null, input.providerSecretEnv ?? null, input.canConfirmAssignment ?? false, input.trackingPattern ?? null,
        input.idpMode ?? null, input.idpIssuer ?? null, input.idpClientId ?? null, input.idpClientSecretEnv ?? null, input.webhookSecretEnv ?? null, input.requireMfa ?? false,
      ],
    );
    if (rows.length === 0) throw notFound('Courier company');
    await companyEvent(tx, companyId, actor.townshipId, 'INTEGRATION_CHANGED', actor.id, `${input.authMethod} sign-in, ${input.providerMode} shipment checks`, now);
    await audit(tx, actor.id, 'COURIER_INTEGRATION_CHANGED', 'courier_company', companyId, { ...input });
    return { ok: true };
  });
}

export interface ApprovalInput {
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  reason?: string;
  verifiedNote?: string;
  agreementRef?: string;
  agreementUntil?: string | null;
  minAssurance?: 'HIGH' | 'MEDIUM';
  allowFallback?: boolean;
}

/** Ends every session of the company's people in this township: a suspension takes effect at once, even mid-shift. */
async function endCompanySessions(q: Queryable, companyId: string, townshipId: string) {
  await q.query('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM courier_accounts WHERE company_id = $1 AND township_id = $2)', [companyId, townshipId]);
}

/** Approve, suspend (an emergency stop) or revoke a company in this township, and set its agreement and assurance terms. */
export async function decideCompany(db: Db, actor: Actor, companyId: string, input: ApprovalInput, now: Date) {
  requireAdmin(actor);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    const current = await one<{ status: string; verified_note: string | null }>(
      tx, 'SELECT status, verified_note FROM courier_company_townships WHERE company_id = $1 AND township_id = $2 FOR UPDATE', [companyId, townshipId],
    );
    if (!current) throw notFound('Courier company');
    const verifiedNote = input.verifiedNote?.trim() || current.verified_note;
    if (input.status === 'ACTIVE' && !verifiedNote) throw ruleViolation('VERIFY_FIRST', 'Record how the company’s identity was checked before approving it.');
    if (input.status !== 'ACTIVE' && !input.reason?.trim()) throw ruleViolation('REASON_NEEDED', 'Say why.');
    if (current.status === 'REVOKED' && input.status !== 'REVOKED') throw ruleViolation('REVOKED', 'A revoked company is onboarded again from the start.');
    await tx.query(
      `UPDATE courier_company_townships
          SET status = $3, status_reason = $4, verified_note = $5, agreement_ref = coalesce($6, agreement_ref), agreement_until = CASE WHEN $7::boolean THEN $8::date ELSE agreement_until END,
              min_assurance = coalesce($9, min_assurance), allow_fallback = coalesce($10, allow_fallback),
              approved_by = CASE WHEN $3 = 'ACTIVE' THEN $11 ELSE approved_by END, approved_at = CASE WHEN $3 = 'ACTIVE' THEN $12 ELSE approved_at END, updated_at = $12
        WHERE company_id = $1 AND township_id = $2`,
      [
        companyId, townshipId, input.status, input.reason?.trim() || null, verifiedNote, input.agreementRef?.trim() || null, input.agreementUntil !== undefined, input.agreementUntil ?? null,
        input.minAssurance ?? null, input.allowFallback ?? null, actor.id, now,
      ],
    );
    if (input.status !== 'ACTIVE') await endCompanySessions(tx, companyId, townshipId);
    const action = input.status === 'ACTIVE' ? (current.status === 'ACTIVE' ? 'TERMS_CHANGED' : 'APPROVED') : input.status;
    await companyEvent(tx, companyId, townshipId, action, actor.id, input.reason?.trim() || null, now);
    await audit(tx, actor.id, `COURIER_COMPANY_${action}`, 'courier_company', companyId, { ...input });
    const people = await tx.query<{ user_id: string }>(`SELECT user_id FROM courier_accounts WHERE company_id = $1 AND township_id = $2 AND status = 'ACTIVE'`, [companyId, townshipId]);
    if (input.status !== 'ACTIVE' && people.length > 0) {
      await notify(tx, people.map((p) => p.user_id), { title: 'Locker access paused', body: 'Your company’s access to the township’s lockers has been suspended. Ask your company for details.', link: '/courier' });
    }
    return { ok: true };
  });
}

/** The stations the company's couriers may use in this township. */
export async function setCompanyStations(db: Db, actor: Actor, companyId: string, stationIds: string[], now: Date) {
  requireAdmin(actor);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (!(await one(tx, 'SELECT 1 FROM courier_company_townships WHERE company_id = $1 AND township_id = $2', [companyId, townshipId]))) throw notFound('Courier company');
    const ok = await tx.query<{ id: string; name: string }>('SELECT id, name FROM locker_stations WHERE id = ANY($1::uuid[]) AND township_id = $2', [stationIds, townshipId]);
    if (ok.length !== new Set(stationIds).size) throw notFound('Station');
    await tx.query('DELETE FROM courier_company_stations WHERE company_id = $1 AND station_id IN (SELECT id FROM locker_stations WHERE township_id = $2)', [companyId, townshipId]);
    for (const s of ok) await tx.query('INSERT INTO courier_company_stations (company_id, station_id, granted_by, granted_at) VALUES ($1, $2, $3, $4)', [companyId, s.id, actor.id, now]);
    await companyEvent(tx, companyId, townshipId, 'STATIONS_CHANGED', actor.id, ok.map((s) => s.name).join(', ') || 'none', now);
    await audit(tx, actor.id, 'COURIER_COMPANY_STATIONS', 'courier_company', companyId, { stations: ok.map((s) => s.id) });
    return { ok: true };
  });
}

/**
 * Adds a person the company has named as its representative: they manage the
 * company's couriers here, and cannot open lockers themselves. Returns a
 * one-time link for them to set a password.
 */
export async function inviteRepresentative(db: Db, actor: Actor, companyId: string, input: { fullName: string; email: string; phone?: string | null }, now: Date) {
  requireAdmin(actor);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    const approval = await one<{ status: string; auth_method: string; name: string }>(
      tx, 'SELECT t.status, c.auth_method, c.name FROM courier_company_townships t JOIN courier_companies c ON c.id = t.company_id WHERE t.company_id = $1 AND t.township_id = $2', [companyId, townshipId],
    );
    if (!approval) throw notFound('Courier company');
    if (approval.status !== 'ACTIVE') throw ruleViolation('APPROVE_FIRST', 'Approve the company before adding its representatives.');
    if (approval.auth_method === 'MANUAL') throw ruleViolation('MANUAL_COMPANY', 'This company’s couriers are approved one by one; it has no representatives here.');
    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.email.trim()])) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    const user = await one<{ id: string }>(
      tx, `INSERT INTO users (email, full_name, phone, role, township_id) VALUES ($1, $2, $3, 'COURIER', $4) RETURNING id`, [input.email.trim(), input.fullName.trim(), input.phone ?? null, townshipId],
    );
    await tx.query(
      `INSERT INTO courier_accounts (user_id, company_id, township_id, status, kind, managed_by, applied_at, decided_by, decided_at, invited_by, last_verified_at)
       VALUES ($1, $2, $3, 'ACTIVE', 'MANAGER', 'COMPANY', $4, $5, $4, $5, $4)`,
      [user!.id, companyId, townshipId, now, actor.id],
    );
    await companyEvent(tx, companyId, townshipId, 'REPRESENTATIVE_ADDED', actor.id, input.fullName.trim(), now);
    await audit(tx, actor.id, 'COURIER_REPRESENTATIVE_ADDED', 'user', user!.id, { companyId });
    return { id: user!.id, inviteToken: await issueInvite(tx, user!.id, actor.id, now) };
  });
}

export async function removeRepresentative(db: Db, actor: Actor, companyId: string, userId: string, now: Date) {
  requireAdmin(actor);
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    const rows = await tx.query<{ user_id: string }>(
      `UPDATE courier_accounts SET status = 'REVOKED', decided_by = $4, decided_at = $5 WHERE user_id = $1 AND company_id = $2 AND township_id = $3 AND kind = 'MANAGER' RETURNING user_id`,
      [userId, companyId, townshipId, actor.id, now],
    );
    if (rows.length === 0) throw notFound('Representative');
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await companyEvent(tx, companyId, townshipId, 'REPRESENTATIVE_REMOVED', actor.id, null, now);
    await audit(tx, actor.id, 'COURIER_REPRESENTATIVE_REMOVED', 'user', userId, { companyId });
    return { ok: true };
  });
}

/** Simulated providers only: pretend the company's system is down, to show the fallback and the outage alerts. */
export async function setSimulatedOutage(db: Db, actor: Actor, companyId: string, down: boolean, now: Date) {
  requireAdmin(actor);
  const rows = await db.query(`UPDATE courier_companies SET sim_outage = $2 WHERE id = $1 AND (provider_mode = 'SIMULATED' OR idp_mode = 'SIMULATED') RETURNING id`, [companyId, down]);
  if (rows.length === 0) throw notFound('Simulated courier company');
  await companyEvent(db, companyId, actor.townshipId, down ? 'SIMULATED_OUTAGE_ON' : 'SIMULATED_OUTAGE_OFF', actor.id, null, now);
  return { ok: true };
}
