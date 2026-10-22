import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { createCampaign, fundCampaign } from '../src/server/modules/campaigns/service';

/**
 * Demo Gerak challenges of both kinds, so the difference can be tried by hand:
 *   - Green Mobility Challenge (from the main seed): kilometres on the township loops, part-loops count;
 *   - Loop Finisher Challenge (added here): whole loops only, every checkpoint on the same day.
 * Created and funded through the app's own services, as staff would in the Campaigns console, so the
 * ledger stays balanced. Safe to run again: it adds only what is missing.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;
export const LOOP_FINISHER_TITLE = 'Loop Finisher Challenge';
const GREEN_MOBILITY_TITLE = 'Green Mobility Challenge';
const GREEN_MOBILITY_TEXT = 'Walk or cycle 10 km on the township loops this month and earn 200 points. Part-loops count: every bit you walk on a loop path adds up.';

async function actorByLogin(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedGerakChallenges(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const [staff, admin] = await Promise.all([actorByLogin(db, 'staff'), actorByLogin(db, 'admin')]);
  if (!staff || !admin) return log('Gerak challenges: demo staff or admin missing; skipped.');

  // The original demo text predates part-loops; say plainly what this challenge counts.
  const updated = await db.query(
    `UPDATE campaigns SET description = $3 WHERE township_id = $1 AND title = $2 AND description <> $3 RETURNING id`,
    [staff.townshipId, GREEN_MOBILITY_TITLE, GREEN_MOBILITY_TEXT],
  );
  if (updated.length) log('Gerak challenges: Green Mobility now says part-loops count.');

  if (await one(db, 'SELECT 1 FROM campaigns WHERE township_id = $1 AND title = $2', [staff.townshipId, LOOP_FINISHER_TITLE])) {
    return log('Gerak challenges: Loop Finisher already there.');
  }
  const startsAt = new Date(now.getTime() - 2 * DAY);
  const { id } = await createCampaign(db, staff, {
    sponsorId: null,
    title: LOOP_FINISHER_TITLE,
    description: 'Finish 3 whole township loops this month and earn 150 points. A loop counts only when every one of its checkpoints is ticked on the same day.',
    activity: 'GERAK_LOOP',
    goalMetric: 'COUNT',
    goalTarget: 3,
    rewardPoints: 150,
    perPersonCap: 1,
    budgetSen: 30_000,
    poolBps: 10_000,
    feeBps: 0,
    costsBps: 0,
    startsAt,
    endsAt: new Date(now.getTime() + 21 * DAY),
  });
  await fundCampaign(db, admin, id, 'DEMO-SDP-GERAK-LOOPS', startsAt);
  log('Gerak challenges: added the Loop Finisher Challenge (whole loops only).');
}
