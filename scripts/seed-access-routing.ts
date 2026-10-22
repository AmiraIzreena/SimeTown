import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { getAccessPolicy, saveAccessPolicy } from '../src/server/modules/akses/config';
import { rerouteWaiting, reportIssue } from '../src/server/modules/akses/incidents';
import { createPlace, setPlaceParty } from '../src/server/modules/akses/places';

/**
 * Demo of Akses+ routing, so each path can be seen in the console with real records:
 *   1. Sent to the default team: a ramp nobody is recorded as running, reported this morning, went straight to
 *      township operations as the default team, marked so its owner gets recorded.
 *   2. Re-routed automatically: a bus-stop ramp reported before anyone owned it waited in To do; once an admin
 *      recorded its team, the waiting report sent itself.
 * Everything goes through the app's own services (reports, routing, notifications, audit), so every count,
 * timeline and notification matches the database. Safe to run again: it does nothing once its places exist.
 */

const DOMAIN = 'demo.kita.test';
const HOUR = 3_600_000;
const DEFAULT_PLACE = 'Elmina Gardens playground ramp';
const REROUTE_PLACE = 'Jalan Metafasa bus stop ramp';

async function actorByLogin(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedAccessRoutingDemo(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const [admin, staff, zainab, meiling] = await Promise.all(['admin', 'staff', 'zainab', 'meiling'].map((l) => actorByLogin(db, l)));
  if (!admin || !staff || !zainab || !meiling || !admin.townshipId) return log('Akses+ routing demo: demo accounts missing; skipped.');
  const townshipId = admin.townshipId;
  if (await one(db, 'SELECT 1 FROM access_places WHERE township_id = $1 AND name = $2', [townshipId, DEFAULT_PLACE])) return log('Akses+ routing demo: already there.');
  const ops = await one<{ id: string; name: string }>(db, `SELECT id, name FROM access_parties WHERE township_id = $1 AND kind = 'TOWNSHIP_OPERATIONS' AND active ORDER BY created_at LIMIT 1`, [townshipId]);
  if (!ops) return log('Akses+ routing demo: no township operations team; skipped.');
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  const policy = await getAccessPolicy(db, townshipId);

  // 2. Re-routed automatically. Reported while no default team was set, so it waited in To do (and the admins
  //    were told); an admin then recorded the ramp's team and the waiting report went there by itself.
  if (policy.defaultPartyId) await saveAccessPolicy(db, admin, { defaultPartyId: null }, ago(4));
  const busStop = await createPlace(db, staff, { name: REROUTE_PLACE, kind: 'RAMP', location: 'Bus stop on Jalan Metafasa U16/171, Elmina Valley 1', partyId: null }, ago(30));
  const waited = await reportIssue(db, meiling, busStop.id, { category: 'OBSTRUCTION', description: 'Delivery motorcycles parked across the ramp at the bus stop. A wheelchair cannot get up to the stop.', idempotencyKey: `demo-reroute-${busStop.id}` }, ago(3));
  await setPlaceParty(db, admin, busStop.id, ops.id);
  await rerouteWaiting(db, townshipId, ago(2.5));

  // 1. Sent to the default team. With township operations as the default team, a report at a place nobody
  //    runs goes there at once; nothing waits for an admin.
  await saveAccessPolicy(db, admin, { defaultPartyId: policy.defaultPartyId ?? ops.id }, ago(2));
  const playground = await createPlace(db, staff, { name: DEFAULT_PLACE, kind: 'RAMP', location: 'Elmina Gardens playground, beside the surau car park', partyId: null }, ago(30));
  const fallback = await reportIssue(db, zainab, playground.id, { category: 'DAMAGED', description: 'The ramp edge is broken at the bottom; wheelchair wheels catch on the cracked kerb.', idempotencyKey: `demo-default-${playground.id}` }, ago(1.5));

  // Notifications are stamped when written; give these the moments the reports and routing really happened,
  // so each inbox matches the incident timeline.
  const stamp = (at: Date, titleLike: string) => db.query('UPDATE notifications SET created_at = $1 WHERE title LIKE $2', [at, titleLike]);
  await stamp(ago(3), `Accessibility escalation:%(${waited.reference})%`);
  await stamp(ago(3), `Report received: ${waited.reference}`);
  await stamp(ago(2.5), `New accessibility issue:%(${waited.reference})%`);
  await stamp(ago(1.5), `New accessibility issue:%(${fallback.reference})%`);
  await stamp(ago(1.5), `Report received: ${fallback.reference}`);

  log(`Akses+ routing demo: "${REROUTE_PLACE}" re-routed itself once its team was recorded; "${DEFAULT_PLACE}" went to ${ops.name} as the default team.`);
}
