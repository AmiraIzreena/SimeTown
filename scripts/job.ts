import './env';
import { getDb } from '../src/server/db/client';
import { JOBS, runJob, type JobName } from '../src/server/modules/admin/service';

/** Usage: npm run job -- <name>. The same jobs are available over HTTP for schedulers. */
async function main() {
  const name = process.argv[2] as JobName;
  if (!JOBS.includes(name)) {
    console.error(`Choose a job: ${JOBS.join(', ')}`);
    process.exit(1);
  }
  const db = await getDb();
  console.log(JSON.stringify(await runJob(db, name, new Date()), null, 2));
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
