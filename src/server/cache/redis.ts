import { getConfig } from '../config';
import { log } from '../logger';

/**
 * Optional Redis, reached through Upstash's REST API with plain `fetch` (no
 * driver, no open connections, so it suits serverless hosts). Nothing depends
 * on it: rate limits fall back to PostgreSQL and the session cache is skipped
 * whenever Redis is not configured, slow or failing. Money, the ledger,
 * Insights and jobs never use it.
 */

export type RedisCommand = (string | number)[];

export interface RedisClient {
  /** Runs the commands in order and returns each result. Rejects if any of them fails. */
  pipeline(commands: RedisCommand[]): Promise<unknown[]>;
}

/** Above this a request is abandoned and PostgreSQL answers instead. */
const TIMEOUT_MS = 1_000;
/** After a failure Redis is left alone for this long, so an outage does not add a timeout to every request. */
const PAUSE_MS = 30_000;

export function upstashClient(url: string, token: string, timeoutMs = TIMEOUT_MS): RedisClient {
  const endpoint = `${url.replace(/\/+$/, '')}/pipeline`;
  return {
    async pipeline(commands) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands.map((command) => command.map(String))),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Redis answered HTTP ${response.status}`);
      const replies = (await response.json()) as unknown;
      if (!Array.isArray(replies) || replies.length !== commands.length) throw new Error('Redis sent an unexpected reply');
      return replies.map((reply: { result?: unknown; error?: string }) => {
        if (reply?.error) throw new Error(`Redis refused a command: ${reply.error}`);
        return reply?.result ?? null;
      });
    },
  };
}

// Kept across hot reloads in development, like the database pool.
const state = globalThis as unknown as { __kitaRedis?: { client: RedisClient | null; pausedUntil: number; override?: RedisClient | null } };

function current() {
  if (!state.__kitaRedis) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = getConfig();
    state.__kitaRedis = { client: url && token ? upstashClient(url, token) : null, pausedUntil: 0 };
  }
  return state.__kitaRedis;
}

/** Tests swap in a fake client (or `null` for "not configured"); `undefined` restores the configured one. */
export function setRedisForTests(client: RedisClient | null | undefined): void {
  const s = current();
  s.override = client;
  s.pausedUntil = 0;
}

/** True when Redis is configured, whether or not it is reachable right now. */
export function redisConfigured(): boolean {
  const s = current();
  return (s.override === undefined ? s.client : s.override) !== null;
}

/** Leaves Redis alone for `ms` (at least the usual pause). */
export function pauseRedis(ms = PAUSE_MS): void {
  const s = current();
  s.pausedUntil = Math.max(s.pausedUntil, Date.now() + Math.max(ms, PAUSE_MS));
}

/**
 * Runs commands against Redis. Returns null when Redis is not configured,
 * paused after a recent failure, or fails now, so the caller uses its fallback.
 */
export async function redis(commands: RedisCommand[], purpose: string, options: { evenIfPaused?: boolean } = {}): Promise<unknown[] | null> {
  const s = current();
  const client = s.override === undefined ? s.client : s.override;
  if (!client || (!options.evenIfPaused && Date.now() < s.pausedUntil)) return null;
  try {
    return await client.pipeline(commands);
  } catch (error) {
    pauseRedis();
    log.warn('Redis unavailable; using PostgreSQL', { purpose, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Every key carries the app environment, so staging and production can never read each other's entries. */
export const redisKey = (...parts: (string | number)[]) => ['kita', getConfig().APP_ENV, ...parts].join(':');
