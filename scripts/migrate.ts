import './env';
import { getDb } from '../src/server/db/client';
import { migrate } from '../src/server/db/migrate';

async function main() {
  const db = await getDb();
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
