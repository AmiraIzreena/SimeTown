import { createHash } from 'node:crypto';
import { redis, redisKey } from '../cache/redis';
import type { Queryable } from '../db/client';
import { tooManyRequests } from '../errors';

/**
 * Fixed-window counters, shared by every instance. Redis counts when it is
 * configured and answering; otherwise (or the moment it fails) the
 * `rate_limits` table does. Both use the same windows, so the limit and the
 * Retry-After header are the same either way. A switch mid-window starts that
 * window's count afresh in the other store, which errs towards allowing a few
 * extra requests, never towards refusing honest ones.
 */
export async function enforceRateLimit(db: Queryable, key: string, limit: number, windowSec: number, now: Date): Promise<void> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const count = (await countInRedis(key, windowStart, windowSec)) ?? (await countInPostgres(db, key, windowStart));
  if (count > limit) {
    throw tooManyRequests(Math.ceil((windowStart.getTime() + windowSec * 1000 - now.getTime()) / 1000));
  }
}

async function countInRedis(key: string, windowStart: Date, windowSec: number): Promise<number | null> {
  // Keys can hold an email address or an IP: Redis only ever sees a hash of them.
  const k = redisKey('rl', createHash('sha256').update(key).digest('hex'), windowStart.getTime());
  // The first request of a window creates the counter with its expiry; the key names its window, so a longer life is harmless.
  const replies = await redis([['SET', k, 0, 'EX', windowSec, 'NX'], ['INCR', k]], 'rate limit');
  const count = replies?.[1];
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null;
}

async function countInPostgres(db: Queryable, key: string, windowStart: Date): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start) VALUES ($1, $2)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`,
    [key, windowStart],
  );
  return rows[0]!.count;
}
