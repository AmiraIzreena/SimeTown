import { createHash, generateKeyPairSync, randomBytes, type JsonWebKey } from 'node:crypto';
import { one, type Db } from '../../db/client';
import { verifyPassword } from '../../auth/password';
import { getConfig } from '../../config';
import { hashToken } from '../../auth/session';
import { notFound, ruleViolation, unauthorized } from '../../errors';
import { signJwt } from './jwt';
import type { CompanyRow } from './types';

/**
 * A simulated courier company's identity system, for the demo only: the sign-in
 * page a company like J&T would host, its staff directory and its signing key.
 * It speaks standard OpenID Connect (authorisation code with PKCE), so
 * SimeTown's side is exactly what a real company's sign-in would use. It is
 * labelled as simulated wherever it appears and refuses to run in production.
 */

export const SIM_CLIENT_ID = 'simetown-lockers';
/** The one-time code the simulated authenticator app always shows. A real provider sends its own. */
export const SIM_OTP = '246810';
const CODE_TTL_MS = 2 * 60_000;
const TOKEN_TTL_S = 300;

function assertDemo() {
  if (getConfig().APP_ENV === 'production') throw notFound('Simulated sign-in');
}

const issuerOf = (code: string) => `${getConfig().appOrigin}/api/v1/sim-idp/${code}`;
export const simRedirectUri = () => `${getConfig().appOrigin}/api/v1/auth/courier-sso/callback`;

export function simDiscovery(code: string) {
  const issuer = issuerOf(code);
  return {
    issuer,
    authorization_endpoint: `${getConfig().appOrigin}/sim-idp/${code}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  };
}

async function simulatedCompany(db: Db, code: string): Promise<CompanyRow> {
  assertDemo();
  const c = await one<CompanyRow>(db, `SELECT * FROM courier_companies WHERE code = $1 AND idp_mode = 'SIMULATED'`, [code.toUpperCase()]);
  if (!c) throw notFound('Simulated sign-in');
  return c;
}

/** The simulated provider's signing key, made on first use. */
export async function simKey(db: Db, companyId: string): Promise<{ kid: string; privatePem: string; jwk: JsonWebKey & { kid: string } }> {
  const existing = await one<{ kid: string; private_pem: string; public_jwk: JsonWebKey }>(db, 'SELECT kid, private_pem, public_jwk FROM sim_idp_keys WHERE company_id = $1', [companyId]);
  if (existing) return { kid: existing.kid, privatePem: existing.private_pem, jwk: { ...existing.public_jwk, kid: existing.kid } };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('hex');
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid, use: 'sig', alg: 'RS256' };
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  await db.query('INSERT INTO sim_idp_keys (company_id, kid, private_pem, public_jwk, created_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (company_id) DO NOTHING', [companyId, kid, privatePem, JSON.stringify(jwk)]);
  return simKey(db, companyId);
}

export async function simJwks(db: Db, code: string) {
  const company = await simulatedCompany(db, code);
  return { keys: [(await simKey(db, company.id)).jwk] };
}

/** What the simulated sign-in page shows: the company and, for the demo, its staff list to pick from. */
export async function simSignInPage(db: Db, code: string) {
  const company = await simulatedCompany(db, code);
  const staff = await db.query<{ employee_ref: string; full_name: string; active: boolean }>(
    'SELECT employee_ref, full_name, active FROM sim_directory WHERE company_id = $1 ORDER BY full_name', [company.id],
  );
  return { company: company.name, code: company.code, requireMfa: company.require_mfa, otpHint: SIM_OTP, staff };
}

export interface AuthorizeInput {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  employeeRef: string;
  password: string;
  otp?: string;
}

/** The simulated company checks its own employee and, if all is well, sends them back to SimeTown with a one-time code. */
export async function simAuthorize(db: Db, code: string, input: AuthorizeInput, now: Date) {
  const company = await simulatedCompany(db, code);
  if (company.sim_outage) throw ruleViolation('IDP_DOWN', 'The simulated company sign-in is switched to "down".');
  if (input.clientId !== SIM_CLIENT_ID || input.redirectUri !== simRedirectUri()) throw ruleViolation('BAD_CLIENT', 'This sign-in request did not come from SimeTown.');
  if (input.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw ruleViolation('PKCE', 'The sign-in request is missing its PKCE challenge.');
  const person = await one<{ employee_ref: string; password_hash: string; active: boolean }>(
    db, 'SELECT employee_ref, password_hash, active FROM sim_directory WHERE company_id = $1 AND employee_ref = $2', [company.id, input.employeeRef.trim().toUpperCase()],
  );
  if (!person || !(await verifyPassword(input.password, person.password_hash))) throw unauthorized('The staff number or password is not correct.');
  // A company's own sign-in refuses staff who no longer work there, or who it has suspended.
  if (!person.active) throw ruleViolation('ACCESS_DENIED', 'Your company has suspended this account.');
  const amr = ['pwd'];
  if (input.otp) {
    if (input.otp !== SIM_OTP) throw unauthorized('The one-time code is not correct.');
    amr.push('otp', 'mfa');
  } else if (company.require_mfa) {
    throw ruleViolation('MFA_REQUIRED', 'Enter the one-time code from your authenticator.');
  }
  const authCode = randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO sim_idp_codes (code_hash, company_id, employee_ref, client_id, redirect_uri, nonce, code_challenge, amr, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [hashToken(authCode), company.id, person.employee_ref, input.clientId, input.redirectUri, input.nonce, input.codeChallenge, amr, new Date(now.getTime() + CODE_TTL_MS)],
  );
  const url = new URL(input.redirectUri);
  url.searchParams.set('code', authCode);
  url.searchParams.set('state', input.state);
  return { redirect: url.toString() };
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** The token endpoint: the code is exchanged once, with the PKCE verifier, for a signed ID token. */
export async function simToken(db: Db, code: string, input: { code: string; codeVerifier: string; clientId: string; redirectUri: string }, now: Date) {
  const company = await simulatedCompany(db, code);
  const grant = await one<{ employee_ref: string; client_id: string; redirect_uri: string; nonce: string; code_challenge: string; amr: string[]; expires_at: Date }>(
    db,
    `UPDATE sim_idp_codes SET used_at = $3 WHERE code_hash = $1 AND company_id = $2 AND used_at IS NULL RETURNING employee_ref, client_id, redirect_uri, nonce, code_challenge, amr, expires_at`,
    [hashToken(input.code), company.id, now],
  );
  if (!grant || grant.expires_at < now) throw unauthorized('The sign-in code is not valid or has expired.');
  if (grant.client_id !== input.clientId || grant.redirect_uri !== input.redirectUri) throw unauthorized('The sign-in code was issued to someone else.');
  if (s256(input.codeVerifier) !== grant.code_challenge) throw unauthorized('The PKCE verifier does not match.');
  const person = (await one<{ employee_ref: string; full_name: string; email: string; active: boolean }>(
    db, 'SELECT employee_ref, full_name, email, active FROM sim_directory WHERE company_id = $1 AND employee_ref = $2', [company.id, grant.employee_ref],
  ))!;
  if (!person.active) throw unauthorized('Your company has suspended this account.');
  const key = await simKey(db, company.id);
  const iat = Math.floor(now.getTime() / 1000);
  const idToken = signJwt(
    { iss: issuerOf(company.code!), aud: input.clientId, sub: person.employee_ref, iat, exp: iat + TOKEN_TTL_S, nonce: grant.nonce, email: person.email, name: person.full_name, amr: grant.amr },
    key.privatePem,
    key.kid,
  );
  return { id_token: idToken, token_type: 'Bearer', expires_in: TOKEN_TTL_S };
}
