import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@/shared/domain';
import { getConfig } from '../config';
import { one, type Queryable } from '../db/client';
import type { Actor } from './actor';

/**
 * Server-side sessions. The browser holds a random token in an HttpOnly
 * cookie; the database holds only its SHA-256 hash, so a database leak does
 * not hand out working sessions. Signing out or changing a password deletes
 * the rows, which ends the session at once.
 */

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** `__Host-` makes browsers refuse the cookie unless it is Secure, host-only and Path=/. */
export const sessionCookieName = () => (getConfig().secureCookies ? '__Host-kita_session' : 'kita_session');

export function sessionCookie(token: string | null): string {
  const { secureCookies, SESSION_TTL_HOURS } = getConfig();
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_TTL_HOURS * 3600 : 0}`];
  if (secureCookies) attributes.push('Secure');
  return `${sessionCookieName()}=${token ?? ''}; ${attributes.join('; ')}`;
}

export function readSessionToken(cookieHeader: string | null): string | null {
  const name = sessionCookieName();
  for (const part of (cookieHeader ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

export async function createSession(q: Queryable, userId: string, now: Date): Promise<string> {
  const token = newToken();
  await q.query(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $3, $3::timestamptz + make_interval(hours => $4))`,
    [hashToken(token), userId, now, getConfig().SESSION_TTL_HOURS],
  );
  return token;
}

export async function destroySession(q: Queryable, token: string): Promise<void> {
  await q.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

interface ActorRow {
  id: string;
  role: Role;
  email: string;
  full_name: string;
  township_id: string | null;
  home_id: string | null;
  merchant_id: string | null;
  sponsor_id: string | null;
  residency_status: Actor['residencyStatus'];
  member_code: string | null;
}

export const ACTOR_COLUMNS =
  'u.id, u.role, u.email, u.full_name, u.township_id, u.home_id, u.merchant_id, u.sponsor_id, u.residency_status, u.member_code';

export const toActor = (r: ActorRow): Actor => ({
  id: r.id,
  role: r.role,
  email: r.email,
  fullName: r.full_name,
  townshipId: r.township_id,
  homeId: r.home_id,
  merchantId: r.merchant_id,
  sponsorId: r.sponsor_id,
  residencyStatus: r.residency_status,
  memberCode: r.member_code,
});

/** Resolves a cookie token to the signed-in person, or null. Role and status are re-read on every request. */
export async function actorFromToken(q: Queryable, token: string | null, now: Date): Promise<Actor | null> {
  if (!token) return null;
  const row = await one<ActorRow & { session_id: string; last_seen_at: Date }>(
    q,
    `SELECT ${ACTOR_COLUMNS}, s.id AS session_id, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'ACTIVE'`,
    [hashToken(token), now],
  );
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() > 5 * 60_000) {
    await q.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [row.session_id, now]);
  }
  return toActor(row);
}
