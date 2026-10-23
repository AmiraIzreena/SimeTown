import { randomUUID } from 'node:crypto';
import { pauseRedis, redis, redisConfigured, redisKey } from '../cache/redis';
import { getConfig } from '../config';
import { log } from '../logger';
import type { Actor } from './actor';

/**
 * A short-lived Redis copy of "which person does this session token belong
 * to", so most requests skip that database lookup. Only used when Redis is
 * configured; otherwise every request reads PostgreSQL as before.
 *
 * Keys are the SHA-256 hash of the token, never the token itself.
 *
 * Freshness: every entry is tagged with a generation value, and is used only
 * while that value is still current. Any change that can affect a sign-in
 * (signing out, a new password, ending sessions, a role, residency, home or
 * name change) replaces the generation once its transaction commits, which
 * retires every cached entry at once. A lookup reads the entry and the
 * generation together, and a miss stores its result under the generation it
 * read before querying the database, so a request racing with a change can
 * never store the old answer as current. Entries also never outlive their
 * session, and the database is consulted again once `last_seen_at` is due
 * for its update.
 */

export interface CachedSession {
  actor: Actor;
  sessionId: string;
  /** Epoch milliseconds. */
  lastSeenAt: number;
  /** When the person last acted (epoch milliseconds), for the inactivity timeout. */
  lastActiveAt: number;
  expiresAt: number;
}

interface Entry extends CachedSession {
  gen: string;
}

/** Matches the throttle on `sessions.last_seen_at` in `actorFromToken`. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;

const genKey = () => redisKey('session-gen');
const entryKey = (tokenHash: string) => redisKey('session', tokenHash);
const enabled = () => getConfig().SESSION_CACHE_SECONDS > 0;

export type Lookup = { hit: CachedSession } | { hit: null; gen: string | null };

/** Null when the cache is not in use, so the caller neither reads nor stores. */
export async function lookupSession(tokenHash: string, now: Date): Promise<Lookup | null> {
  if (!enabled()) return null;
  const replies = await redis([['MGET', entryKey(tokenHash), genKey()]], 'session cache');
  const values = replies?.[0];
  if (!Array.isArray(values)) return null;
  const [raw, gen] = values as unknown[];
  const current = typeof gen === 'string' ? gen : null;
  const entry = current ? parse(raw) : null;
  const fresh =
    entry !== null &&
    entry.gen === current &&
    entry.expiresAt > now.getTime() &&
    now.getTime() - entry.lastSeenAt <= LAST_SEEN_EVERY_MS;
  if (fresh) return { hit: { actor: entry.actor, sessionId: entry.sessionId, lastSeenAt: entry.lastSeenAt, lastActiveAt: entry.lastActiveAt, expiresAt: entry.expiresAt } };
  return { hit: null, gen: current };
}

/** Stores a database answer under the generation read before that query. */
export async function storeSession(tokenHash: string, gen: string | null, session: CachedSession, now: Date): Promise<void> {
  if (!gen) {
    // The first use, or Redis lost the key: start a generation for the next request rather than guess.
    await redis([['SET', genKey(), randomUUID(), 'NX']], 'session cache');
    return;
  }
  const seconds = Math.min(getConfig().SESSION_CACHE_SECONDS, Math.floor((session.expiresAt - now.getTime()) / 1000));
  if (seconds < 1) return;
  const entry: Entry = { ...session, gen };
  await redis([['SET', entryKey(tokenHash), JSON.stringify(entry), 'EX', seconds]], 'session cache');
}

/**
 * Retires every cached sign-in. Call through `sessionsChanged` so it runs after
 * the change commits. If Redis cannot be told, this instance stops reading
 * the cache until every entry has expired by itself.
 */
export async function invalidateSessionCache(): Promise<void> {
  if (!enabled() || !redisConfigured()) return;
  // Tried even while this instance has paused Redis: other instances may still be reading it.
  const replies = await redis([['SET', genKey(), randomUUID()]], 'session cache invalidation', { evenIfPaused: true });
  if (replies === null) {
    pauseRedis(getConfig().SESSION_CACHE_SECONDS * 1000);
    log.error('Could not clear the session cache; it is skipped here until its entries expire');
  }
}

function parse(raw: unknown): Entry | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as Partial<Entry>;
    const valid =
      typeof value.gen === 'string' &&
      typeof value.sessionId === 'string' &&
      typeof value.lastSeenAt === 'number' &&
      typeof value.lastActiveAt === 'number' &&
      typeof value.expiresAt === 'number' &&
      typeof value.actor?.id === 'string' &&
      typeof value.actor.role === 'string';
    return valid ? (value as Entry) : null;
  } catch {
    return null;
  }
}
