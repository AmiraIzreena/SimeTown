import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@/shared/domain';
import { idleMinutesFor, MAX_SESSION_HOURS } from '@/shared/session';
import { getConfig } from '../config';
import { afterCommit, one, type Queryable } from '../db/client';
import type { Actor } from './actor';
import { invalidateSessionCache, LAST_SEEN_EVERY_MS, lookupSession, storeSession } from './session-cache';

/**
 * Server-side sessions. The browser holds a random token in an HttpOnly
 * cookie; the database holds only its SHA-256 hash, so a database leak does
 * not hand out working sessions. Signing out or changing a password deletes
 * the rows and clears the optional Redis session cache, which ends the
 * session at once.
 *
 * A sign-in lasts at most MAX_SESSION_HOURS (12; SESSION_TTL_HOURS can only
 * shorten it) and ends after a time without activity that depends on the
 * role (shared/session.ts). Activity is a person acting, recorded by
 * markActive, never a screen refreshing itself.
 */

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** `__Host-` makes browsers refuse the cookie unless it is Secure, host-only and Path=/. */
export const sessionCookieName = () => (getConfig().secureCookies ? '__Host-kita_session' : 'kita_session');

/** The longest a sign-in may last: SESSION_TTL_HOURS, but never more than MAX_SESSION_HOURS. */
export const sessionHours = () => Math.min(getConfig().SESSION_TTL_HOURS, MAX_SESSION_HOURS);

export function sessionCookie(token: string | null): string {
  const { secureCookies } = getConfig();
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? sessionHours() * 3600 : 0}`];
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

/** Courier sessions are short: a stolen phone or login stops working within a shift, and federated couriers sign in through their company again. */
export const COURIER_SESSION_HOURS = 12;

export async function createSession(q: Queryable, userId: string, now: Date, ttlHours = sessionHours()): Promise<string> {
  const token = newToken();
  await q.query(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, last_active_at, expires_at)
     VALUES ($1, $2, $3, $3, $3, $3::timestamptz + make_interval(hours => $4))`,
    [hashToken(token), userId, now, Math.min(ttlHours, MAX_SESSION_HOURS)],
  );
  return token;
}

export async function destroySession(q: Queryable, token: string): Promise<void> {
  await q.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  await sessionsChanged(q);
}

/**
 * Call after anything that ends sessions or changes what `actorFromToken`
 * returns (role, status, residency, home, township, shop, sponsor, name,
 * email, member code, password). Clears the Redis session cache once `q`
 * commits; does nothing when Redis is not configured.
 */
export const sessionsChanged = (q: Queryable) => afterCommit(q, invalidateSessionCache);

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

/**
 * Resolves a cookie token to the signed-in person, or null. Role and status
 * are re-read from the database on every request, or served from the Redis
 * session cache, which every change to them clears (see `sessionsChanged`).
 */
/** True when the person has been away longer than their role allows. */
const idleTooLong = (role: Role, lastActiveAt: number, now: Date) => {
  const minutes = idleMinutesFor(role);
  return minutes !== null && now.getTime() - lastActiveAt > minutes * 60_000;
};

export async function actorFromToken(q: Queryable, token: string | null, now: Date): Promise<Actor | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const cached = await lookupSession(tokenHash, now);
  // A cached copy that looks idle may be behind the database (activity is recorded there): ask the database.
  if (cached?.hit && !idleTooLong(cached.hit.actor.role, cached.hit.lastActiveAt, now)) return cached.hit.actor;

  const row = await one<ActorRow & { session_id: string; last_seen_at: Date; last_active_at: Date; expires_at: Date }>(
    q,
    `SELECT ${ACTOR_COLUMNS}, s.id AS session_id, s.last_seen_at, s.last_active_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'ACTIVE'`,
    [tokenHash, now],
  );
  if (!row) return null;
  if (idleTooLong(row.role, row.last_active_at.getTime(), now)) {
    // Signed out for inactivity: the sign-in is gone, not just refused.
    await q.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
    return null;
  }
  let lastSeenAt = row.last_seen_at.getTime();
  if (now.getTime() - lastSeenAt > LAST_SEEN_EVERY_MS) {
    await q.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [row.session_id, now]);
    lastSeenAt = now.getTime();
  }
  const actor = toActor(row);
  // Stored only after a cache miss: a copy that looked idle is retired by markActive, which records activity.
  if (cached && !cached.hit) {
    await storeSession(tokenHash, cached.gen, { actor, sessionId: row.session_id, lastSeenAt, lastActiveAt: row.last_active_at.getTime(), expiresAt: row.expires_at.getTime() }, now);
  }
  return actor;
}

/** What the browser needs to warn before a timeout: the role's inactivity limit, the last activity and the hard end. */
export async function sessionState(q: Queryable, token: string | null, now: Date) {
  if (!token) return null;
  const row = await one<{ role: Role; last_active_at: Date; expires_at: Date }>(
    q,
    'SELECT u.role, s.last_active_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
    [hashToken(token), now],
  );
  if (!row) return null;
  return { idleMinutes: idleMinutesFor(row.role), lastActiveAt: row.last_active_at, expiresAt: row.expires_at, now };
}

/** The person acted (a tap, a key, a scroll, or Stay signed in): the inactivity clock starts again. */
export async function markActive(q: Queryable, token: string | null, now: Date) {
  if (!token) return null;
  await q.query('UPDATE sessions SET last_active_at = $2 WHERE token_hash = $1 AND expires_at > $2', [hashToken(token), now]);
  // No need to clear the session cache: a cached copy only ever looks more idle than the database, and then the
  // database is asked (actorFromToken).
  return sessionState(q, token, now);
}
