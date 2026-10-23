import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { claimIncident, requestInfo, resolveIncident, setIncidentStatus } from '../src/server/modules/incidents/engine';
import { reportProblem } from '../src/server/modules/incidents/triage';
import { notifyLoopDone } from '../src/server/modules/gerak/service';
import { notify } from '../src/server/modules/notifications';
import { acknowledgeSos, raiseSos, scanPatrolPoint } from '../src/server/modules/tamu/service';
import type { NotificationCategory } from '../src/shared/notifications';

/**
 * Demo data so every page and tab can be tried by hand: the Lapor tabs for parcel, gate, Kitar and Gerak reports
 * in each state (new, being investigated, waiting for the resident's answer, finished with an outcome), a
 * screenshot on a Kitar report, notifications in every category for every role (Kitar and Gerak included, some
 * read and some unread), guard patrol scans and a handled SOS. Everything goes through the app's own services.
 * Safe to run again: it does nothing once its marker notification exists.
 */

const DOMAIN = 'demo.kita.test';
const MARKER = 'showcase:v1';
const MIN = 60_000;

async function actorByLogin(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedShowcase(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  if (await one(db, 'SELECT 1 FROM notifications WHERE dedupe_key LIKE $1', [`${MARKER}:marker%`])) return log('Showcase: demo data already there.');
  const logins = ['aisyah', 'daniel', 'staff', 'admin', 'hq', 'kafe', 'plumber', 'bengkel', 'courier', 'guard', 'guardhouse', 'sponsor'] as const;
  const people = Object.fromEntries(await Promise.all(logins.map(async (l) => [l, await actorByLogin(db, l)] as const))) as Record<(typeof logins)[number], Actor | undefined>;
  const { aisyah, daniel, staff, admin } = people;
  if (!aisyah || !daniel || !staff || !admin) return log('Showcase: demo accounts missing; skipped.');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN);

  // --- Lapor → Parcel, Gate, Kitar and Gerak reports, in every state ------------------------------
  const screenshot = await readFile(path.join(process.cwd(), 'scripts', 'assets', 'demo-screenshot.png'));
  const file = async (actor: Actor, report: Parameters<typeof reportProblem>[2], at: Date) => {
    const r = await reportProblem(db, actor, report, at);
    if (r.route !== 'TOWNSHIP') throw new Error(`Showcase: expected a township case for ${report.context}/${report.reason}`);
    return (await one<{ id: string }>(db, 'SELECT id FROM incidents WHERE reference = $1', [r.incident.reference]))!.id;
  };

  // Aisyah: one of each state, across the four tabs.
  await file(aisyah, { context: 'GATE', reason: 'VISITOR_REFUSED', note: 'My sister had a pass for 3 pm but was asked to wait outside for 20 minutes.' }, ago(90));
  const kitarAsk = await file(aisyah, {
    context: 'KITAR', reason: 'WEIGHT_WRONG', note: 'I put in a full bag of bottles but the scale showed 0.0 kg and I got no XP.',
    photo: { mime: 'image/png', bytes: new Uint8Array(screenshot) },
  }, ago(300));
  await claimIncident(db, staff, kitarAsk, ago(280));
  await requestInfo(db, staff, kitarAsk, 'Thank you for the photo. Which kiosk was it, and roughly what time? We will check the scale log.', ago(270));
  const gerakLook = await file(aisyah, { context: 'GERAK', reason: 'CHECKPOINT', note: 'Checkpoint 3 on the Valley lake loop did not tick, even after I scanned the poster.' }, ago(600));
  await claimIncident(db, staff, gerakLook, ago(590));
  await setIncidentStatus(db, staff, gerakLook, { status: 'INVESTIGATING', note: 'Checking the poster code against the loop.' }, ago(580));
  const gerakDone = await file(aisyah, { context: 'GERAK', reason: 'ROUTE_PROBLEM', note: 'A fallen branch blocks the path near the playground on the Gardens loop.' }, ago(60 * 26));
  await claimIncident(db, staff, gerakDone, ago(60 * 25));
  await resolveIncident(db, staff, gerakDone, { category: 'FIXED', outcome: 'The landscape team cleared the branch this morning. The path is open again.', actionsTaken: 'Landscape contractor cleared the fallen branch.' }, ago(60 * 20));
  const kitarFull = await file(aisyah, { context: 'KITAR', reason: 'BIN_FULL', note: 'The paper bin at the Valley kiosk is overflowing.' }, ago(60 * 30));
  await claimIncident(db, staff, kitarFull, ago(60 * 29));
  await resolveIncident(db, staff, kitarFull, { category: 'FIXED', outcome: 'The bin was emptied and the collector now comes twice a week.', actionsTaken: 'Extra collection scheduled.' }, ago(60 * 28));

  // A guardhouse parcel problem, when Aisyah has a parcel waiting on the shelf.
  const shelf = await one<{ id: string }>(db, `SELECT id FROM parcels WHERE home_id = $1 AND status = 'WAITING' ORDER BY logged_at DESC LIMIT 1`, [aisyah.homeId]);
  if (shelf) await file(aisyah, { context: 'GUARD_WAITING', reason: 'GUARD_REFUSED', guardParcelId: shelf.id, note: 'I showed my code at 6 pm but the guard could not find the parcel.' }, ago(45));

  // Daniel: a finished gate report and a new Gerak one.
  const gateDone = await file(daniel, { context: 'GATE', reason: 'COURIER_DENIED', note: 'My Shopee rider was turned away at the main gate this afternoon.' }, ago(60 * 50));
  await claimIncident(db, staff, gateDone, ago(60 * 49));
  await resolveIncident(db, staff, gateDone, { category: 'OTHER', outcome: 'We reminded the guard team that delivery riders with a tracking number may enter. Sorry for the trouble.', actionsTaken: 'Briefed the gate team.' }, ago(60 * 48));
  await file(daniel, { context: 'GERAK', reason: 'MAP_WRONG', note: 'The map puts the Gardens loop start on the wrong side of the lake.' }, ago(30));
  log('Showcase: parcel, gate, Kitar and Gerak reports in every state (one waiting for the resident, with a screenshot).');

  // --- Notifications in every category, for every role -----------------------------------------
  type N = { title: string; body: string; link: string; category: NotificationCategory; read?: boolean };
  const send = async (who: Actor | undefined, key: string, items: N[]) => {
    if (!who) return;
    for (const [i, n] of items.entries()) {
      await notify(db, [who.id], { title: n.title, body: n.body, link: n.link, category: n.category, dedupeKey: `${MARKER}:${key}:${i}${n.read ? ':read' : ''}` });
    }
  };
  for (const [who, key] of [[aisyah, 'aisyah'], [daniel, 'daniel']] as const) {
    await send(who, key, [
      { title: 'Kitar drop-off weighed', body: '1.6 kg of glass at Valley Central kiosk. You earned 16 Impact XP and 8 points.', link: '/app/kitar', category: 'RECYCLING' },
      { title: 'Collection booked for Saturday', body: 'The recycling collector comes to your home on Saturday morning. Leave your bags by the gate.', link: '/app/kitar', category: 'RECYCLING', read: true },
      { title: 'Someone offered to help', body: 'A neighbour offered to help with your Komuniti post "Borrow a ladder". Open it to accept.', link: '/app/komuniti', category: 'COMMUNITY' },
      { title: 'New sharing post near you', body: 'A neighbour in your area is giving away baby clothes on Komuniti.', link: '/app/komuniti', category: 'COMMUNITY', read: true },
      { title: 'Points earned at Kafe Seri Pagi', body: 'You earned 12 points on a RM12.00 sale. 100 points are worth RM1 at any township shop.', link: '/app/wallet', category: 'REWARDS' },
      { title: 'You reached Level 3', body: 'Your Impact XP grew from recycling and walking. Keep it up.', link: '/app/wallet', category: 'REWARDS', read: true },
    ]);
  }
  // Gerak: "loop completed", through the same function the app uses.
  const loops = await db.query<{ id: string; name: string }>(`SELECT id, name FROM gerak_loops WHERE township_id = $1 AND active ORDER BY name LIMIT 2`, [aisyah.townshipId]);
  for (const [i, loop] of loops.entries()) {
    await notifyLoopDone(db, aisyah.id, loop.name, 25 + i * 5, `${MARKER}:${loop.id}`);
    await notifyLoopDone(db, daniel.id, loop.name, 25, `${MARKER}:${loop.id}`);
  }
  await send(daniel, 'daniel-gerak', [{ title: 'Your weekly Gerak summary', body: 'You moved 6.2 km on township loops this week. Two loops completed.', link: '/app/gerak', category: 'GERAK', read: true }]);

  // The township office, shops, courier, guard and sponsor.
  for (const [who, key] of [[staff, 'staff'], [admin, 'admin'], [people.hq, 'hq']] as const) {
    await send(who, key, [
      { title: 'New Kitar report: weight or points wrong', body: 'A resident sent a screenshot of a kiosk scale showing 0.0 kg.', link: '/console/reports?tab=cases', category: 'REPORTS' },
      { title: 'Valley Central kiosk bin is full', body: 'Residents are sent to the next kiosk until it is emptied.', link: '/console/recycling', category: 'RECYCLING' },
      { title: 'A Komuniti post was flagged', body: 'Two residents flagged a post for review.', link: '/console/komuniti', category: 'COMMUNITY', read: true },
      { title: 'Weekly settlement paid', body: 'The float paid shops for the points they accepted this week.', link: '/console/finance', category: 'REWARDS', read: true },
    ]);
  }
  await send(people.kafe, 'kafe', [
    { title: 'Statement ready', body: 'This week the float paid you RM24.50 for the points you accepted.', link: '/merchant/statements', category: 'REWARDS' },
    { title: 'Your Shop Offer was used 3 times', body: 'Residents used your offer this week. The success fee is taken at your next top-up.', link: '/merchant/sales', category: 'REWARDS', read: true },
  ]);
  await send(people.plumber, 'plumber', [
    { title: 'New booking request', body: 'A resident needs help with a leaking pipe. Accept or decline the request.', link: '/merchant/bookings', category: 'SERVICES' },
    { title: 'Job confirmed', body: 'The resident confirmed the job is done and left a 5-star review.', link: '/merchant/bookings', category: 'SERVICES', read: true },
  ]);
  await send(people.bengkel, 'bengkel', [{ title: 'Your application is being checked', body: 'The township office is checking your business registration. You will be told when it is approved.', link: '/merchant/account', category: 'ACCOUNT' }]);
  await send(people.courier, 'courier', [{ title: 'Locker door A04 reserved', body: 'Your shipment for Elmina Valley Locker A is ready to drop.', link: '/courier', category: 'PARCELS' }]);
  await send(people.guardhouse, 'guardhouse', [{ title: 'Two parcels waiting on the shelf', body: 'Residents have been told. Check the codes when they collect.', link: '/guardhouse', category: 'PARCELS' }]);
  await send(people.sponsor, 'sponsor', [{ title: 'Your campaign is live', body: 'Residents can now earn rewards from your challenge. You see grouped results only.', link: '/sponsor', category: 'ACCOUNT' }]);
  await db.query(`UPDATE notifications SET read_at = $1 WHERE dedupe_key LIKE $2 AND read_at IS NULL`, [now, `${MARKER}:%:read:%`]);
  log('Showcase: notifications in every category (Kitar and Gerak included) for residents, staff, shops, courier, guard and sponsor.');

  // --- The guard: patrol rounds and an SOS that was handled ------------------------------------
  if (people.guard) {
    const points = await db.query<{ code: string }>(`SELECT code FROM patrol_points WHERE township_id = $1 ORDER BY name LIMIT 3`, [people.guard.townshipId]);
    for (const [i, p] of points.entries()) await scanPatrolPoint(db, people.guard, p.code, ago(120 - i * 25));
    const sos = await raiseSos(db, daniel, ago(200));
    if ('id' in sos && sos.id) {
      await acknowledgeSos(db, people.guard, sos.id, false, ago(198));
      await acknowledgeSos(db, people.guard, sos.id, true, ago(185));
    }
    log('Showcase: guard patrol scans and an SOS that was answered and closed.');
  }

  // The marker: also tells the township admin that the demo data is ready.
  await notify(db, [admin.id], { title: 'Demo data ready', body: 'Every page has sample data to try. See docs/DEMO_TESTING.md for the accounts.', link: '/console', category: 'ACCOUNT', dedupeKey: `${MARKER}:marker` });
}
