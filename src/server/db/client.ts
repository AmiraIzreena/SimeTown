import type { Pool, PoolClient } from 'pg';
import { getConfig } from '../config';
import { log } from '../logger';

export type Row = Record<string, unknown>;

/** Anything that can run SQL: the database itself, or an open transaction. */
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a script that may contain several statements. Used by migrations only. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one all-or-nothing transaction. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function one<T = Row>(q: Queryable, sql: string, params?: unknown[]): Promise<T | undefined> {
  return (await q.query<T>(sql, params))[0];
}

const INT8 = 20;
const DATE = 1082;
const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock

function pgClientQueryable(client: Pool | PoolClient): Queryable {
  return {
    query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
    exec: async (sql: string) => void (await client.query(sql)),
  };
}

async function createPgDb(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  // Sen amounts fit comfortably in a JS number; dates stay as 'YYYY-MM-DD' strings.
  pg.types.setTypeParser(INT8, Number);
  pg.types.setTypeParser(DATE, (v: string) => v);
  const config = getConfig();
  const pool = new pg.Pool({
    connectionString: url,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: config.dbSsl ? { rejectUnauthorized: true } : undefined,
  });
  pool.on('error', (error) => log.error('Idle database connection failed', error));

  return {
    ...pgClientQueryable(pool),
    async tx(fn) {
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(pgClientQueryable(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const code = (error as { code?: string }).code;
          if (attempt < 3 && code && RETRYABLE.has(code)) continue;
          throw error;
        } finally {
          client.release();
        }
      }
    },
    close: () => pool.end(),
  };
}

/** In-process PostgreSQL (WASM) for tests and zero-install local demos. */
async function createPgliteDb(url: string): Promise<Db> {
  // Resolved at run time so production bundles never include the WASM build.
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleName)) as typeof import('@electric-sql/pglite');
  const target = url.replace(/^pglite:\/\//, '');
  const parsers = { [INT8]: Number, [DATE]: (v: string) => v };
  if (target !== 'memory') (await import('node:fs')).mkdirSync(target, { recursive: true });
  const db = target === 'memory' ? new PGlite({ parsers }) : new PGlite(target, { parsers });
  await db.waitReady;
  return {
    query: async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows,
    exec: async (sql) => void (await db.exec(sql)),
    tx: (fn) =>
      db.transaction((t) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => (await t.query<T>(sql, params)).rows,
          exec: async (sql) => void (await t.exec(sql)),
        }),
      ) as Promise<never>,
    close: () => db.close(),
  };
}

export function createDb(url: string): Promise<Db> {
  return url.startsWith('pglite:') ? createPgliteDb(url) : createPgDb(url);
}

// One connection pool per server process, kept across hot reloads in development.
const globalStore = globalThis as unknown as { __kitaDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalStore.__kitaDb ??= createDb(getConfig().DATABASE_URL);
  return globalStore.__kitaDb;
}
