import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './client';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

/** Numbered .sql files, applied once each, in order, each in its own transaction. */
export async function listMigrations(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

/** Migrations that were renumbered after release: old file name → new file name. */
const RENAMED: Record<string, string> = {
  '028_kitar_collection_automation.sql': '029_kitar_collection_automation.sql',
};

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  // A database that ran a migration under its old name keeps it as applied.
  for (const [from, to] of Object.entries(RENAMED)) {
    await db.query('UPDATE schema_migrations SET id = $2 WHERE id = $1', [from, to]);
  }
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  const applied: string[] = [];
  for (const file of await listMigrations()) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
