import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { LEGAL } from '../src/shared/legal';
import { one, type Db } from '../src/server/db/client';
import { runIncidentChecks } from '../src/server/modules/incidents/checks';
import { verifySupportChannel } from '../src/server/modules/incidents/courier-support';
import { addIncidentNote, claimIncident, requestInfo, resolveIncident, setIncidentStatus } from '../src/server/modules/incidents/engine';
import { reportProblem } from '../src/server/modules/incidents/triage';
import { raiseIncident } from '../src/server/modules/lockers/incidents';

/**
 * Demo data for the township's incident system, ready for the five demo
 * scenarios: a late delivery that belongs to the courier (A), a locker that
 * will not open (B, done live), a critical case nobody took that has escalated
 * (C), a collection dispute (D) and a case to reassign (E). People and parcels
 * are the demo's; the courier companies are simulated. Safe to run again: it
 * does nothing once the second staff member exists.
 */

const DOMAIN = 'demo.kita.test';
const MIN = 60_000;
const HOUR = 60 * MIN;

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedIncidents(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  if (await actorByEmail(db, 'staff2')) return log('Incidents: demo data already there.');
  const people = await Promise.all(['aisyah', 'daniel', 'hafiz', 'zainab', 'staff', 'admin'].map((l) => actorByEmail(db, l)));
  if (people.some((p) => !p)) return log('Incidents: demo accounts missing; skipped.');
  const [aisyah, daniel, hafiz, zainab, ravi, nurul] = people as [Actor, Actor, Actor, Actor, Actor, Actor];
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // A second member of the township office, so a case can move from one person to another.
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, township_id, terms_version, terms_accepted_at) VALUES ($1, $2, 'Mei Chen', '+60123450200', 'TOWNSHIP_STAFF', $3, $4, $5)`,
    [`staff2@${DOMAIN}`, input.passwordHash, ravi.townshipId, LEGAL.version, now],
  );

  // The simulated courier companies' support channels, as an admin would record them once checked.
  for (const code of ['JNT', 'NJV', 'SPX']) {
    const c = await one<{ id: string; name: string }>(db, `SELECT id, name FROM courier_companies WHERE code = $1 AND provider_mode = 'SIMULATED'`, [code]);
    if (c) await verifySupportChannel(db, nurul.id, c.id, { name: `${c.name} customer service (simulated)` }, ago(20 * 24 * HOUR));
  }

  // Scenario A: a J&T parcel for Aisyah that is still on its way. Reporting it late sends her to J&T, not to the township.
  const jnt = await one<{ id: string }>(db, `SELECT id FROM courier_companies WHERE code = 'JNT'`);
  const aisyahAddress = await one<{ address_line: string; postcode: string | null; recipient_phone: string | null }>(db, `SELECT address_line, postcode, recipient_phone FROM sim_shipments WHERE tracking_no = 'JTSIM10000001'`);
  if (jnt && aisyahAddress) {
    await db.query(
      `INSERT INTO sim_shipments (company_id, tracking_no, status, recipient_name, recipient_phone, address_line, postcode, assigned_courier_ref, demo_case)
       VALUES ($1, 'JTSIM10000002', 'IN_TRANSIT', 'Aisyah Rahman', $2, $3, $4, 'JT-1001', $5) ON CONFLICT DO NOTHING`,
      [jnt.id, aisyahAddress.recipient_phone, aisyahAddress.address_line, aisyahAddress.postcode,
        'Incident scenario A: still on its way. If Aisyah reports it late, SimeTown asks J&T (simulated), confirms it is hers, and sends her to J&T’s support: no township case.'],
    );
  }

  // Scenario C: a door forced open at Locker A, critical, that nobody took: escalated to the admins.
  const stationA = await one<{ id: string; name: string }>(db, `SELECT id, name FROM locker_stations WHERE township_id = $1 AND name LIKE '%Locker A%'`, [ravi.townshipId]);
  if (stationA) {
    await raiseIncident(db, {
      townshipId: ravi.townshipId!, kind: 'DOOR_FORCED', severity: 'HIGH', stationId: stationA.id,
      summary: `${stationA.name}: door B02 opened without an unlock. It may have been forced.`, dedupeKey: 'demo:door-forced', details: { demo: true },
    }, ago(25 * MIN));
  }

  // Scenario E: Daniel's locker door would not open; Ravi took it and is investigating. Nurul can move it to Mei Chen.
  const danielParcel = await one<{ id: string }>(db, `SELECT id FROM locker_parcels WHERE home_id = $1 AND state IN ('READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING') ORDER BY ready_at LIMIT 1`, [daniel.homeId]);
  if (danielParcel) {
    const r = await reportProblem(db, daniel, { context: 'LOCKER_WAITING', reason: 'DOOR_WONT_OPEN', lockerParcelId: danielParcel.id, note: 'The keypad beeps but the door stays shut.' }, ago(3 * HOUR));
    if (r.route === 'TOWNSHIP') {
      const c = (await one<{ id: string }>(db, 'SELECT id FROM incidents WHERE reference = $1', [r.incident.reference]))!;
      await claimIncident(db, ravi, c.id, ago(2.5 * HOUR));
      await setIncidentStatus(db, ravi, c.id, { status: 'INVESTIGATING' }, ago(2.4 * HOUR));
      await addIncidentNote(db, ravi, c.id, 'Station log shows the unlock was acknowledged but no door-open event. Asked the locker vendor to check the latch on this door.', ago(2.3 * HOUR));
    }
  }

  // Scenario D, already handled once: a collection dispute Ravi checked and explained.
  const disputed = await one<{ id: string }>(db, `SELECT id FROM locker_parcels WHERE home_id = $1 AND state = 'COLLECTED' ORDER BY collected_at DESC OFFSET 1 LIMIT 1`, [aisyah.homeId]);
  if (disputed) {
    const r = await reportProblem(db, aisyah, { context: 'LOCKER_DONE', reason: 'NOT_COLLECTED', lockerParcelId: disputed.id, confirm: true }, ago(30 * HOUR));
    if (r.route === 'TOWNSHIP') {
      const c = (await one<{ id: string }>(db, 'SELECT id FROM incidents WHERE reference = $1', [r.incident.reference]))!;
      await claimIncident(db, ravi, c.id, ago(29 * HOUR));
      await requestInfo(db, ravi, c.id, 'Does anyone else in your home have the SimeTown app or your pickup code?', ago(28 * HOUR));
      await db.query(`UPDATE incidents SET status = 'INVESTIGATING', awaiting = NULL WHERE id = $1`, [c.id]);
      await resolveIncident(db, ravi, c.id, {
        category: 'RECORDS_CONFIRMED',
        outcome: 'We checked the locker’s records: the door was opened with your home’s PIN at the keypad, and shut empty a minute later. If nobody in your home used the PIN, get a new code for your next parcel and reopen this report.',
        actionsTaken: 'Checked the door command, the keypad event and the presence sensor; no forced-door or tamper event.', internalNote: 'Keypad event matches the household PIN. No other anomaly.',
      }, ago(26 * HOUR));
    }
  }

  // A courier problem that went to the courier company, and a gate problem waiting in the queue.
  const hafizParcel = await one<{ id: string }>(db, `SELECT id FROM locker_parcels WHERE home_id = $1 AND state = 'COLLECTED' ORDER BY collected_at DESC LIMIT 1`, [hafiz.homeId]);
  if (hafizParcel) await reportProblem(db, hafiz, { context: 'LOCKER_DONE', reason: 'DAMAGED', lockerParcelId: hafizParcel.id }, ago(6 * HOUR));
  await reportProblem(db, zainab, { context: 'GATE', reason: 'VISITOR_REFUSED', note: 'My sister had the pass on her phone but was told to wait outside for 20 minutes.' }, ago(2 * 24 * HOUR));

  // What the scheduler would have done by now: escalate what nobody took in time.
  await runIncidentChecks(db, now);
  log('Incidents: a critical locker case escalated, a case for Ravi to hand over, a checked collection dispute, a courier referral and a gate report; staff2@ (Mei Chen) added.');
}
