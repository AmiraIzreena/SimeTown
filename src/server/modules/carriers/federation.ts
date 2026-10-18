import { createHash, createHmac, randomBytes, timingSafeEqual, type JsonWebKey } from 'node:crypto';
import { LEGAL } from '@/shared/legal';
import { one, type Db } from '../../db/client';
import { ACTOR_COLUMNS, COURIER_SESSION_HOURS, createSession, hashToken, toActor } from '../../auth/session';
import type { Actor } from '../../auth/actor';
import { forbidden, notFound, ruleViolation, unauthorized } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { companyEvent } from './companies';
import { verifyJwtSignature, type JwtClaims } from './jwt';
import { SIM_CLIENT_ID, simDiscovery, simJwks, simRedirectUri, simToken } from './sim-idp';
import { recordCourierLogin } from './team';
import type { CompanyRow } from './types';

/**
 * Couriers signing in through their own company (OpenID Connect, authorisation
 * code flow with PKCE). SimeTown checks the company's signed ID token (issuer,
 * audience, expiry, nonce, signature), that the company is approved here, and
 * that the courier is not suspended, then starts a short session. A courier
 * seen for the first time gets an account automatically: the company vouches
 * for them, not a township admin.
 *
 * With idp_mode = SIMULATED the company is the built-in demo provider, called
 * in process; with OIDC it is the company's real provider, reached over HTTPS
 * with credentials from the environment. Nothing else differs.
 */

const STATE_TTL_MS = 10 * 60_000;
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

async function discover(company: CompanyRow): Promise<Discovery> {
  if (company.idp_mode === 'SIMULATED') return simDiscovery(company.code!);
  const d = await fetchJson<Discovery>(`${company.idp_issuer!.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (d.issuer !== company.idp_issuer) throw new Error('The provider’s discovery document names a different issuer.');
  return d;
}

const clientIdOf = (company: CompanyRow) => (company.idp_mode === 'SIMULATED' ? SIM_CLIENT_ID : company.idp_client_id!);

/** The companies a courier can sign in through, for the sign-in page. Public: names only. */
export async function federatedCompanies(db: Db) {
  return db.query(
    `SELECT c.name, c.code, c.idp_mode = 'SIMULATED' AS simulated FROM courier_companies c
      WHERE c.auth_method = 'FEDERATED' AND c.active AND EXISTS (SELECT 1 FROM courier_company_townships t WHERE t.company_id = c.id AND t.status = 'ACTIVE')
      ORDER BY c.name`,
  );
}

const safeReturn = (path: string | undefined) => (path && /^\/courier(\/|\?|$)/.test(path) ? path : '/courier');

/** Starts a sign-in: remembers state, nonce and the PKCE verifier, and returns where to send the courier. */
export async function startCourierSso(db: Db, companyCode: string, returnTo: string | undefined, now: Date) {
  const company = await one<CompanyRow>(db, `SELECT * FROM courier_companies WHERE code = $1 AND auth_method = 'FEDERATED' AND active`, [companyCode.toUpperCase()]);
  if (!company) throw notFound('Courier company');
  const discovery = await discover(company);
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO courier_login_states (state_hash, company_id, nonce, code_verifier, return_to, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [hashToken(state), company.id, nonce, verifier, safeReturn(returnTo), now, new Date(now.getTime() + STATE_TTL_MS)],
  );
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientIdOf(company));
  url.searchParams.set('redirect_uri', simRedirectUri());
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', s256(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString() };
}

/** Checks everything about an ID token that the signature does not. */
export function checkClaims(claims: JwtClaims, expected: { issuer: string; clientId: string; nonce: string; requireMfa: boolean }, now: Date) {
  const t = Math.floor(now.getTime() / 1000);
  if (claims.iss !== expected.issuer) throw unauthorized('The sign-in came from an unexpected issuer.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) throw unauthorized('The sign-in was meant for another application.');
  if (typeof claims.exp !== 'number' || claims.exp < t - 30) throw unauthorized('The sign-in has expired. Please try again.');
  if (typeof claims.iat !== 'number' || claims.iat > t + 60) throw unauthorized('The sign-in is dated in the future.');
  if (!claims.nonce || claims.nonce !== expected.nonce) throw unauthorized('The sign-in does not belong to this request.');
  if (!claims.sub || typeof claims.sub !== 'string' || claims.sub.length > 120) throw unauthorized('The sign-in did not say who you are.');
  if (expected.requireMfa && !(claims.amr ?? []).some((m) => m === 'mfa' || m === 'otp' || m === 'hwk')) {
    throw forbidden('Your company requires a second sign-in step (for example, a one-time code).');
  }
}

/**
 * The company sends the courier back here with a code. Exchanges it, checks
 * the token, finds or creates the courier, and signs them in for one shift.
 */
export async function completeCourierSso(db: Db, input: { state: string; code: string; ip: string; userAgent: string | null }, now: Date): Promise<{ token: string; actor: Actor; returnTo: string }> {
  const pending = await one<{ company_id: string; nonce: string; code_verifier: string; return_to: string; expires_at: Date }>(
    db, 'UPDATE courier_login_states SET used_at = $2 WHERE state_hash = $1 AND used_at IS NULL RETURNING company_id, nonce, code_verifier, return_to, expires_at', [hashToken(input.state), now],
  );
  if (!pending || pending.expires_at < now) throw unauthorized('This sign-in link has expired or was already used. Please start again.');
  const company = (await one<CompanyRow>(db, 'SELECT * FROM courier_companies WHERE id = $1', [pending.company_id]))!;
  const discovery = await discover(company);
  const clientId = clientIdOf(company);

  let idToken: string;
  let keys: (JsonWebKey & { kid?: string })[];
  if (company.idp_mode === 'SIMULATED') {
    idToken = (await simToken(db, company.code!, { code: input.code, codeVerifier: pending.code_verifier, clientId, redirectUri: simRedirectUri() }, now)).id_token;
    keys = (await simJwks(db, company.code!)).keys;
  } else {
    const secret = company.idp_client_secret_env ? process.env[company.idp_client_secret_env] : undefined;
    if (!secret) throw ruleViolation('IDP_NOT_CONFIGURED', 'This company’s sign-in is not set up yet.');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: simRedirectUri(), client_id: clientId, client_secret: secret, code_verifier: pending.code_verifier });
    idToken = (await fetchJson<{ id_token: string }>(discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })).id_token;
    keys = (await fetchJson<{ keys: (JsonWebKey & { kid?: string })[] }>(discovery.jwks_uri)).keys;
  }
  let claims: JwtClaims;
  try {
    claims = verifyJwtSignature(idToken, keys);
  } catch (error) {
    throw unauthorized(`The sign-in could not be verified: ${error instanceof Error ? error.message : 'invalid token'}`);
  }
  checkClaims(claims, { issuer: discovery.issuer, clientId, nonce: pending.nonce, requireMfa: company.require_mfa }, now);

  const result = await db.tx(async (tx) => {
    const approval = await one<{ township_id: string }>(
      tx, `SELECT township_id FROM courier_company_townships WHERE company_id = $1 AND status = 'ACTIVE' ORDER BY approved_at LIMIT 1`, [company.id],
    );
    if (!approval) throw forbidden(`${company.name} is not authorised at any township at the moment.`);
    let account = await one<{ user_id: string; status: string }>(tx, 'SELECT user_id, status FROM courier_accounts WHERE company_id = $1 AND employee_ref = $2 FOR UPDATE', [company.id, claims.sub]);
    if (!account) {
      // First sign-in: the company vouches for this person, so their account is made now, with only what the token carries.
      const email = typeof claims.email === 'string' && claims.email.includes('@') ? claims.email : `${claims.sub.toLowerCase()}@${(company.code ?? 'courier').toLowerCase()}.couriers.invalid`;
      if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])) throw forbidden('An account with this email already exists. Ask the township office to link it.');
      const user = await one<{ id: string }>(
        tx,
        `INSERT INTO users (email, full_name, role, township_id, terms_version, terms_accepted_at) VALUES ($1, $2, 'COURIER', $3, $4, $5) RETURNING id`,
        [email, typeof claims.name === 'string' ? claims.name.slice(0, 120) : claims.sub, approval.township_id, LEGAL.version, now],
      );
      await tx.query(
        `INSERT INTO courier_accounts (user_id, company_id, township_id, status, kind, managed_by, employee_ref, applied_at, decided_at, last_verified_at)
         VALUES ($1, $2, $3, 'ACTIVE', 'COURIER', 'FEDERATED', $4, $5, $5, $5)`,
        [user!.id, company.id, approval.township_id, claims.sub, now],
      );
      await companyEvent(tx, company.id, approval.township_id, 'COURIER_ADDED', null, `First sign-in through the company: ${claims.sub}`, now);
      await audit(tx, user!.id, 'COURIER_FEDERATED_FIRST_SIGN_IN', 'user', user!.id, { companyId: company.id, subject: claims.sub });
      account = { user_id: user!.id, status: 'ACTIVE' };
    }
    if (account.status !== 'ACTIVE') throw forbidden(account.status === 'SUSPENDED' ? 'Your company has suspended your locker access.' : 'Your courier access has been withdrawn.');
    await tx.query('UPDATE courier_accounts SET last_verified_at = $2 WHERE user_id = $1', [account.user_id, now]);
    const row = (await one<Parameters<typeof toActor>[0]>(tx, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1 AND u.status = 'ACTIVE'`, [account.user_id]))!;
    return { token: await createSession(tx, account.user_id, now, COURIER_SESSION_HOURS), actor: toActor(row) };
  });
  await recordCourierLogin(db, result.actor.id, 'FEDERATED', input.ip, input.userAgent, now);
  return { ...result, returnTo: pending.return_to };
}

/**
 * The company's own system says a courier was suspended, reactivated or has
 * left. Signed with the company's webhook secret, and each message is applied
 * once. The simulated company's directory uses the same function directly.
 */
export async function applyDirectoryChange(db: Db, company: Pick<CompanyRow, 'id' | 'name'>, input: { employeeRef: string; active: boolean | 'REMOVED'; eventId: string }, now: Date) {
  return db.tx(async (tx) => {
    const account = await one<{ user_id: string; township_id: string; status: string }>(
      tx, 'SELECT user_id, township_id, status FROM courier_accounts WHERE company_id = $1 AND employee_ref = $2 FOR UPDATE', [company.id, input.employeeRef.trim().toUpperCase()],
    );
    const action = input.active === 'REMOVED' ? 'COURIER_REVOKED' : input.active ? 'COURIER_ACTIVE' : 'COURIER_SUSPENDED';
    if (!(await companyEvent(tx, company.id, account?.township_id ?? null, action, null, `From ${company.name}’s own system: ${input.employeeRef}`, now, input.eventId))) return { duplicate: true };
    if (!account || account.status === 'REVOKED') return { ok: true, known: Boolean(account) };
    const status = input.active === 'REMOVED' ? 'REVOKED' : input.active ? 'ACTIVE' : 'SUSPENDED';
    await tx.query(`UPDATE courier_accounts SET status = $2, decided_at = $3, note = $4, last_verified_at = CASE WHEN $2 = 'ACTIVE' THEN $3 ELSE last_verified_at END WHERE user_id = $1`, [
      account.user_id, status, now, `Changed by ${company.name}’s own system`,
    ]);
    if (status !== 'ACTIVE') await tx.query('DELETE FROM sessions WHERE user_id = $1', [account.user_id]);
    if (status !== 'REVOKED') {
      await notify(tx, [account.user_id], { title: status === 'ACTIVE' ? 'Your locker access is active' : 'Your locker access is suspended', body: `${company.name} changed your access to the township’s lockers.`, link: '/courier' });
    }
    return { ok: true, known: true };
  });
}

/** The text a company signs for a directory message: every field in a fixed order. */
export const directoryMessageText = (m: { eventId: string; employeeRef: string; status: string; ts: string }) => [m.eventId, m.employeeRef, m.status, m.ts].join('|');

export function verifyWebhook(secret: string, message: { eventId: string; employeeRef: string; status: string; ts: string }, signature: string, now: Date) {
  const age = Math.abs(now.getTime() - Date.parse(message.ts));
  if (!Number.isFinite(age) || age > 5 * 60_000) throw unauthorized('The message is too old.');
  const expected = createHmac('sha256', secret).update(directoryMessageText(message)).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw unauthorized('The message is not signed correctly.');
}
