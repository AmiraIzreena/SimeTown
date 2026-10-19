import './env';
import { readFile } from 'node:fs/promises';
import { getDb } from '../src/server/db/client';

/** Apply this additive migration without applying unrelated pending feature migrations. */
async function main() {
  const db = await getDb();
  const name = '023_notification_center.sql';
  try {
    await db.tx(async (tx) => {
      await tx.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      if ((await tx.query('SELECT id FROM schema_migrations WHERE id = $1', [name])).length) {
        console.log('Notification migration already applied.');
        return;
      }
      await tx.exec(await readFile(`src/server/db/migrations/${name}`, 'utf8'));
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [name]);
      console.log(`Applied: ${name}`);
    });
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
