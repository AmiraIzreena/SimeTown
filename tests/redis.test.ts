import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { actorFromToken, createSession, destroySession, hashToken } from '@/server/auth/session';
import { invalidateSessionCache, lookupSession, storeSession } from '@/server/auth/session-cache';
import { setRedisForTests, upstashClient, type RedisClient, type RedisCommand } from '@/server/cache/redis';
import { parseConfig } from '@/server/config';
import { afterCommit, type Db, type Queryable } from '@/server/db/client';
import { AppError } from '@/server/errors';
import { routes } from '@/server/http/api';
import { enforceRateLimit } from '@/server/http/rate-limit';
import { createRouter } from '@/server/http/router';
import { changePassword, updateProfile, verifyResident } from '@/server/modules/identity/service';
import { hashPassword } from '@/server/auth/password';
import { T0, freshDb, makeResident, makeWorld, type World } from './helpers';

/**
 * Optional Redis: rate limits and the session cache. Everything must behave
 * the same with no Redis, a working Redis, and a Redis that fails.
 */

/** An in-memory stand-in for the handful of commands the app sends. */
class FakeRedis implements RedisClient {
  store = new Map<string, { value: string; expiresAt: number | null }>();
  batches: RedisCommand[][] = [];
  down = false;

  async pipeline(commands: RedisCommand[]) {
    this.batches.push(commands);
    if (this.down) throw new Error('connection refused');
    return commands.map((command) => this.run(command.map(String)));
  }

  private get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) return null;
    return entry.value;
  }

  private run([name, ...args]: string[]): unknown {
    switch (name!.toUpperCase()) {
      case 'GET':
        return this.get(args[0]!);
      case 'MGET':
        return args.map((key) => this.get(key));
      case 'SET': {
        const [key, value, ...options] = args as [string, string, ...string[]];
        let ttl: number | null = null;
        let onlyIfNew = false;
        for (let i = 0; i < options.length; i++) {
          const option = options[i]!.toUpperCase();
          if (option === 'EX') ttl = Number(options[++i]);
          else if (option === 'NX') onlyIfNew = true;
          else throw new Error(`unsupported SET option ${option}`);
        }
        if (onlyIfNew && this.get(key) !== null) return null;
        this.store.set(key, { value, expiresAt: ttl === null ? null : Date.now() + ttl * 1000 });
        return 'OK';
      }
      case 'INCR': {
        const key = args[0]!;
        const count = Number(this.get(key) ?? 0) + 1;
        this.store.set(key, { value: String(count), expiresAt: this.store.get(key)?.expiresAt ?? null });
        return count;
      }
      default:
        throw new Error(`unsupported command ${name}`);
    }
  }

  keys = () => [...this.store.keys()];
  commandCount = () => this.batches.reduce((sum, batch) => sum + batch.length, 0);
}

/** Counts the queries a lookup sends, to tell a cache hit from a database read. */
function counting(db: Db): Queryable & { count: number } {
  const q = {
    count: 0,
    query: <T>(sql: string, params?: unknown[]) => {
      q.count++;
      return db.query<T>(sql, params);
    },
    exec: (sql: string) => db.exec(sql),
  };
  return q;
}

let db: Db;
let w: World;
let fake: FakeRedis;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());
afterEach(() => setRedisForTests(undefined));

function useFake(): FakeRedis {
  fake = new FakeRedis();
  setRedisForTests(fake);
  return fake;
}

/** Signs in, then makes the cache usable: the first lookup only starts a generation, the second stores the entry. */
async function cachedSession(actor: Actor, now = T0): Promise<string> {
  const token = await createSession(db, actor.id, now);
  await actorFromToken(db, token, now);
  await actorFromToken(db, token, now);
  return token;
}

const retryAfterOf = async (promise: Promise<void>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  return ((error as AppError).details as { retryAfterSec: number }).retryAfterSec;
};

const pgCount = async (key: string) =>
  (await db.query<{ count: number }>('SELECT coalesce(sum(count), 0)::int AS count FROM rate_limits WHERE key = $1', [key]))[0]!.count;

describe('rate limits', () => {
  it('count in PostgreSQL when Redis is not configured', async () => {
    setRedisForTests(null);
    for (let i = 0; i < 3; i++) await enforceRateLimit(db, 'no-redis', 3, 60, T0);
    expect(await pgCount('no-redis')).toBe(3);
    expect(await retryAfterOf(enforceRateLimit(db, 'no-redis', 3, 60, new Date(T0.getTime() + 15_000)))).toBe(45);
  });

  it('count in Redis when it is configured, with the same window and Retry-After, and leave PostgreSQL alone', async () => {
    useFake();
    for (let i = 0; i < 3; i++) await enforceRateLimit(db, 'with-redis', 3, 60, T0);
    expect(await retryAfterOf(enforceRateLimit(db, 'with-redis', 3, 60, new Date(T0.getTime() + 15_000)))).toBe(45);
    expect(await pgCount('with-redis')).toBe(0);
    // The next window starts afresh.
    await enforceRateLimit(db, 'with-redis', 3, 60, new Date(T0.getTime() + 60_000));
  });

  it('never put the raw key (an email or IP address) in Redis, and give every counter an expiry', async () => {
    const redis = useFake();
    await enforceRateLimit(db, 'login person@kita.test', 5, 900, T0);
    expect(redis.keys().join(' ')).not.toContain('person@kita.test');
    expect([...redis.store.values()].every((entry) => entry.expiresAt !== null)).toBe(true);
  });

  it('fall back to PostgreSQL when Redis fails, then leave Redis alone for a while', async () => {
    const redis = useFake();
    redis.down = true;
    await enforceRateLimit(db, 'redis-down', 1, 60, T0);
    expect(await retryAfterOf(enforceRateLimit(db, 'redis-down', 1, 60, T0))).toBe(60);
    expect(await pgCount('redis-down')).toBe(2);
    expect(redis.batches).toHaveLength(1); // paused after the first failure: no timeout on every request
  });

  it('refuse through the router with 429 and Retry-After when Redis is counting', async () => {
    useFake();
    const handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await handle(
        new Request('http://kita.test/api/v1/auth/login', {
          method: 'POST',
          headers: { origin: 'http://kita.test', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.200' },
          body: JSON.stringify({ email: 'nobody@kita.test', password: `wrong-guess-${i}` }),
        }),
      );
      statuses.push(res.status);
      retryAfter = res.headers.get('retry-after');
    }
    expect(statuses.at(-1)).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});

describe('session cache', () => {
  it('is not used without Redis: every lookup reads the database', async () => {
    setRedisForTests(null);
    const resident = await makeResident(w);
    const token = await createSession(db, resident.id, T0);
    const q = counting(db);
    expect((await actorFromToken(q, token, T0))?.id).toBe(resident.id);
    expect((await actorFromToken(q, token, T0))?.id).toBe(resident.id);
    expect(q.count).toBe(2);
  });

  it('answers repeat lookups from Redis, keyed by the token hash, never the token', async () => {
    const redis = useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    const q = counting(db);
    expect(await actorFromToken(q, token, T0)).toEqual(resident);
    expect(q.count).toBe(0);
    const everything = [...redis.store.entries()].map(([k, v]) => k + v.value).join(' ');
    expect(everything).not.toContain(token);
    expect(redis.keys()).toContain(`kita:development:session:${hashToken(token)}`);
  });

  it('never caches past the end of the session, and refuses an expired session', async () => {
    const redis = useFake();
    const resident = await makeResident(w);
    const ending = new Date(T0.getTime() + 2000 * 3_600_000 - 30_000); // 30 seconds before the session ends
    const token = await createSession(db, resident.id, T0);
    await actorFromToken(db, token, ending);
    await actorFromToken(db, token, ending);
    const entry = redis.store.get(`kita:development:session:${hashToken(token)}`)!;
    expect(entry.expiresAt! - Date.now()).toBeLessThanOrEqual(30_000);
    expect(await actorFromToken(db, token, new Date(T0.getTime() + 2000 * 3_600_000 + 1))).toBeNull();
  });

  it('still updates last_seen_at: a stale entry sends the lookup back to the database', async () => {
    useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    const later = new Date(T0.getTime() + 6 * 60_000);
    const q = counting(db);
    await actorFromToken(q, token, later);
    expect(q.count).toBe(2); // the lookup and the last_seen_at update
    const row = await db.query<{ last_seen_at: Date }>('SELECT last_seen_at FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    expect(row[0]!.last_seen_at.getTime()).toBe(later.getTime());
  });

  it('ends a session at once on sign-out', async () => {
    useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    await destroySession(db, token);
    expect(await actorFromToken(db, token, T0)).toBeNull();
  });

  it('ends every old session at once when the password changes', async () => {
    useFake();
    const resident = await makeResident(w);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [resident.id, await hashPassword('old-password-123')]);
    const token = await cachedSession(resident);
    const fresh = await changePassword(db, resident, { current: 'old-password-123', next: 'new-password-456' }, T0);
    expect(await actorFromToken(db, token, T0)).toBeNull();
    expect((await actorFromToken(db, fresh, T0))?.id).toBe(resident.id);
  });

  it('shows a residency decision and a name change on the very next request', async () => {
    useFake();
    const resident = await makeResident(w, { status: 'PENDING' });
    const token = await cachedSession(resident);
    await verifyResident(db, w.admin, resident.id, true, T0);
    expect((await actorFromToken(db, token, T0))?.residencyStatus).toBe('VERIFIED');
    await actorFromToken(db, token, T0); // cached again
    await updateProfile(db, resident, { fullName: 'New Name', phone: '+60123456789' }, T0);
    expect((await actorFromToken(db, token, T0))?.fullName).toBe('New Name');
  });

  it('cannot store an old answer as current when a change lands between the read and the store', async () => {
    useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    const tokenHash = hashToken(token);
    await invalidateSessionCache();
    const miss = await lookupSession(tokenHash, T0);
    expect(miss?.hit).toBeNull();
    const genBefore = miss && !miss.hit ? miss.gen : null;
    // ...the database is read here with the old values, and then a change commits:
    await invalidateSessionCache();
    const stale = { ...resident, role: 'HQ_ADMIN' as const };
    await storeSession(tokenHash, genBefore, { actor: stale, sessionId: 'x', lastSeenAt: T0.getTime(), expiresAt: T0.getTime() + 3_600_000 }, T0);
    expect((await lookupSession(tokenHash, T0))?.hit).toBeNull();
    expect((await actorFromToken(db, token, T0))?.role).toBe('RESIDENT');
  });

  it('reads the database when Redis fails, and stops trusting the cache if it cannot be cleared', async () => {
    const redis = useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    redis.down = true;
    expect((await actorFromToken(db, token, T0))?.id).toBe(resident.id);
    // A change is made while Redis is down, so the old entry is still marked current there.
    await db.query('UPDATE users SET full_name = $2 WHERE id = $1', [resident.id, 'Changed While Down']);
    await invalidateSessionCache();
    redis.down = false;
    // Redis is back, but this instance keeps reading the database until that entry has expired.
    expect((await actorFromToken(db, token, T0))?.fullName).toBe('Changed While Down');
  });

  it('ignores an entry it cannot read', async () => {
    const redis = useFake();
    const resident = await makeResident(w);
    const token = await cachedSession(resident);
    const key = `kita:development:session:${hashToken(token)}`;
    redis.store.set(key, { value: '{"actor":', expiresAt: null });
    expect((await actorFromToken(db, token, T0))?.id).toBe(resident.id);
  });
});

describe('afterCommit', () => {
  it('runs after a transaction commits, and never after a rollback', async () => {
    const ran: string[] = [];
    await db.tx(async (tx) => {
      await afterCommit(tx, async () => void ran.push('committed'));
      expect(ran).toEqual([]);
    });
    await db
      .tx(async (tx) => {
        await afterCommit(tx, async () => void ran.push('rolled back'));
        throw new Error('stop');
      })
      .catch(() => undefined);
    await afterCommit(db, async () => void ran.push('no transaction'));
    expect(ran).toEqual(['committed', 'no transaction']);
  });
});

describe('Upstash REST client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends one pipeline request with the token and string arguments', async () => {
    const fetchMock = vi.fn(async () => Response.json([{ result: 'OK' }, { result: 2 }]));
    vi.stubGlobal('fetch', fetchMock);
    const client = upstashClient('https://example.upstash.io/', 'secret-token-0123456789');
    expect(await client.pipeline([['SET', 'k', 0, 'EX', 60, 'NX'], ['INCR', 'k']])).toEqual(['OK', 2]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.upstash.io/pipeline');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token-0123456789');
    expect(JSON.parse(init.body as string)).toEqual([['SET', 'k', '0', 'EX', '60', 'NX'], ['INCR', 'k']]);
  });

  it('fails on a refused command, an HTTP error or a malformed reply', async () => {
    const client = upstashClient('https://example.upstash.io', 'secret-token-0123456789');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ error: 'WRONGTYPE' }])));
    await expect(client.pipeline([['INCR', 'k']])).rejects.toThrow(/WRONGTYPE/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(client.pipeline([['INCR', 'k']])).rejects.toThrow(/401/);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: 1 })));
    await expect(client.pipeline([['INCR', 'k']])).rejects.toThrow(/unexpected/);
  });

  it('gives up after its timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
      ),
    );
    await expect(upstashClient('https://example.upstash.io', 'secret-token-0123456789', 20).pipeline([['GET', 'k']])).rejects.toThrow();
  });
});

describe('configuration', () => {
  const BASE = { APP_URL: 'https://kita.example', DATABASE_URL: 'postgres://u:p@db/kita', APP_ENV: 'production', TRUST_PROXY: 'cloudflare' };

  it('needs the Redis URL and token together, over https when hosted', () => {
    expect(parseConfig(BASE).UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(() => parseConfig({ ...BASE, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(() => parseConfig({ ...BASE, UPSTASH_REDIS_REST_TOKEN: 'secret-token-0123456789' })).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(() => parseConfig({ ...BASE, UPSTASH_REDIS_REST_URL: 'http://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'secret-token-0123456789' })).toThrow(/https/);
    const config = parseConfig({ ...BASE, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'secret-token-0123456789' });
    expect(config.SESSION_CACHE_SECONDS).toBe(60);
  });
});

describe('every change to sign-in data clears the session cache', () => {
  // Statements that end sessions or change a column `actorFromToken` returns.
  const SENSITIVE = /DELETE FROM sessions WHERE (user_id|token_hash)|UPDATE users SET [^'`]*\b(status|role|email|full_name|township_id|home_id|merchant_id|sponsor_id|residency_status|member_code|password_hash)\b/;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });

  it('calls sessionsChanged in the same function as each such statement', () => {
    const missing: string[] = [];
    const isFunctionStart = (line: string) => /^(export )?(async )?function |^export const \w+ = (async )?\(/.test(line);
    for (const file of files('src/server')) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!SENSITIVE.test(line)) return;
        let start = i;
        while (start > 0 && !isFunctionStart(lines[start]!)) start--;
        let end = i + 1;
        while (end < lines.length && !isFunctionStart(lines[end]!)) end++;
        if (!/sessionsChanged\(|invalidateSessionCache\(/.test(lines.slice(start, end).join('\n'))) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
