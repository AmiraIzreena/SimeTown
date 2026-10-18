import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { bookCollection, completeCollection, confirmCollection, createCollector } from '../src/server/modules/kitar/collections';
import { handOverParcel, logParcel, myParcels } from '../src/server/modules/parcels/service';
import { edgingTrial, updateTrialTest } from '../src/server/modules/planet/edging';
import { saveShortlist } from '../src/server/modules/planet/materials';
import { createSolarSite } from '../src/server/modules/planet/solar';
import { createReport, setMeToo, updateReport } from '../src/server/modules/reports/service';

/**
 * Demo data for the hackathon brief's PEOPLE and PLANET features: report
 * progress and "Me too", parcels at the guardhouse, recycling collections,
 * solar sites, a material shortlist and the edging trial. Safe to run again: it
 * does nothing once the demo recycling collectors exist. People, businesses
 * and figures are invented; the site areas and ranks are demo values.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

/** A date as the township writes it ("2026-11-02"), in Malaysia time. */
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);

export async function seedTomorrow(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const township = await one<{ id: string }>(db, `SELECT id FROM townships WHERE name IN ('City of Elmina (demo data)', 'Taman KITA (demo township)', 'Taman SimeTown (demo township)') LIMIT 1`);
  if (!township) return log('No demo township found; the brief features need the main seed first.');
  if (await one(db, 'SELECT 1 FROM recycling_collectors WHERE township_id = $1 LIMIT 1', [township.id])) return log('Brief features: demo data already there.');
  const people = await Promise.all(['aisyah', 'daniel', 'priya', 'hafiz', 'meiling', 'zainab', 'staff', 'admin', 'guard'].map((login) => actorByEmail(db, login)));
  const [aisyah, daniel, priya, hafiz, meiling, zainab, staff, admin, guard] = people;
  if (!aisyah || !daniel || !priya || !hafiz || !meiling || !zainab || !staff || !admin || !guard) return log('Some demo accounts are missing; the brief features were not seeded.');
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);

  // --- Lapor: who is fixing it, by when, and who else it affects ------------------------
  const drain = await one<{ id: string; created_at: Date }>(db, `SELECT id, created_at FROM reports WHERE township_id = $1 AND description LIKE 'Longkang tersumbat%' LIMIT 1`, [township.id]);
  if (drain) {
    await updateReport(db, staff, drain.id, { assignedTo: 'Drainage contractor', targetDate: dayOf(new Date(now.getTime() + 2 * DAY)) }, ago(1));
    for (const person of [daniel, priya]) await setMeToo(db, person, drain.id, true, ago(1)).catch(() => undefined);
  }
  const pothole = await one<{ id: string }>(db, `SELECT id FROM reports WHERE township_id = $1 AND description LIKE 'Pothole on the bend%' LIMIT 1`, [township.id]);
  if (pothole) {
    // Checked and given a date that has now passed, so it shows as late.
    await updateReport(db, staff, pothole.id, { status: 'IN_PROGRESS', assignedTo: 'Road maintenance team', targetDate: dayOf(ago(1)) }, ago(1));
    for (const person of [hafiz, meiling, zainab]) await setMeToo(db, person, pothole.id, true, ago(0, 20)).catch(() => undefined);
  }

  // --- Parcels at the guardhouse ----------------------------------------------------------
  const parcel = (home: Actor, courier: string, shelf: string, at: Date, trackingNo?: string) => logParcel(db, guard, { homeId: home.homeId!, courier, shelf, trackingNo }, at);
  await parcel(aisyah, 'J&T Express', 'B1', ago(4), 'JT6420019931');
  await parcel(aisyah, 'Shopee Express', 'A2', ago(0, 3), 'SPXMY042211');
  for (const [home, courier, shelf, days, hours] of [
    [aisyah, 'Pos Laju', 'C4', 1, 26],
    [daniel, 'Ninja Van', 'A1', 2, 5],
    [priya, 'DHL', 'B3', 3, 3],
    [hafiz, 'Shopee Express', 'A3', 5, 30],
  ] as const) {
    const logged = await parcel(home, courier, shelf, ago(days + 1));
    const code = (await myParcels(db, home, ago(days))).parcels.find((p) => p.id === logged.id)!.code!;
    await handOverParcel(db, guard, logged.id, { code }, new Date(ago(days + 1).getTime() + hours * 3_600_000));
  }
  await parcel(meiling, 'GDex', 'C1', ago(1, 2));

  // --- Recycling collections ----------------------------------------------------------------
  const eWaste = await createCollector(db, admin, { name: 'Kitar Plus Recyclers', phone: '+60355550101', materials: ['E_WASTE', 'PAPER', 'ALUMINIUM'], days: 'Tue and Sat mornings', notes: 'Demo partner' });
  await createCollector(db, admin, { name: 'Minyak Hijau Collectors', phone: '+60355550102', materials: ['COOKING_OIL', 'TEXTILE'], days: 'Every Thursday', notes: 'Demo partner' });
  const past = await bookCollection(db, daniel, { collectorId: eWaste.id, materials: ['E_WASTE'], items: 'Old desktop computer and a printer', day: dayOf(ago(6)), slot: 'MORNING' }, ago(9));
  await confirmCollection(db, staff, past.id, ago(8));
  await completeCollection(db, staff, past.id, 14_500, ago(6));
  await bookCollection(db, aisyah, { collectorId: eWaste.id, materials: ['E_WASTE', 'PAPER'], items: 'Two boxes of old cables and a broken kettle', day: dayOf(new Date(now.getTime() + 3 * DAY)), slot: 'MORNING' }, now);

  // --- Solar sites (demo areas and an engineer's demo ranking) --------------------------------
  const zone = async (name: string) => (await one<{ id: string }>(db, 'SELECT id FROM flood_zones WHERE township_id = $1 AND name = $2', [township.id, name]))?.id ?? null;
  const sites = [
    { name: 'Community hall roof', kind: 'ROOFTOP', zone: 'Elmina Valley 1 & 2', usableM2: 650, orientation: 'FLAT', shading: 'LOW', roofAgeYears: 6, structuralChecked: true, expertRank: 1 },
    { name: 'Central Park north car park', kind: 'CAR_PARK', zone: 'Elmina Valley 3, 4 & 5', usableM2: 1800, orientation: 'FLAT', shading: 'LOW', roofAgeYears: null, structuralChecked: false, expertRank: 2 },
    { name: 'Sales gallery roof', kind: 'ROOFTOP', zone: 'Elmina West', usableM2: 900, orientation: 'FLAT', shading: null, roofAgeYears: null, structuralChecked: false, expertRank: 3 },
    { name: 'Surau Elmina Gardens roof', kind: 'ROOFTOP', zone: 'Elmina Gardens', usableM2: 280, orientation: 'SW', shading: 'MEDIUM', roofAgeYears: 18, structuralChecked: false, expertRank: 4 },
    { name: 'Guardhouse roof', kind: 'ROOFTOP', zone: 'Elmina Valley 1 & 2', usableM2: 35, orientation: 'E', shading: 'HIGH', roofAgeYears: 10, structuralChecked: true, expertRank: 5 },
  ] as const;
  for (const s of sites) {
    await createSolarSite(db, admin, { ...s, zoneId: await zone(s.zone), notes: 'Demo values' });
  }

  // --- Material shortlist and the edging trial -------------------------------------------------
  await saveShortlist(db, staff, { use: 'LANDSCAPE_EDGING', requirements: { costRm: 40, lifeYears: 15, uvStable: true }, materialIds: ['edging-steel', 'edging-plastic'], secondsTaken: 260, note: 'Ask both suppliers for EPDs; plastic edging pending the trial.' }, ago(2));
  const trial = await edgingTrial(db, staff);
  const [sharp, trip, , dims] = trial.tests;
  if (sharp) await updateTrialTest(db, staff, sharp.id, { status: 'PASSED', resultRecycled: 'No sharp edges after cutting to length.', resultConventional: 'Two chipped corners after laying.' }, ago(5));
  if (trip) await updateTrialTest(db, staff, trip.id, { status: 'PASSED', resultRecycled: '8 to 12 mm above the path.', resultConventional: '10 to 15 mm above the path.' }, ago(5));
  if (dims) await updateTrialTest(db, staff, dims.id, { status: 'RUNNING' }, ago(1));

  log('Brief features: report progress, parcels, recycling collections, solar sites and the edging trial added.');
}

/**
 * One demo account with every kind of request and every step a report goes
 * through, so "My requests" can be shown in full: Daniel Tan (daniel@…).
 * Everything is made through the app's own services, so it is exactly what the
 * database holds. Safe to run again: it does nothing once Daniel's first
 * showcase report exists.
 */
export async function seedRequestShowcase(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const [daniel, staff, guard] = await Promise.all(['daniel', 'staff', 'guard'].map((login) => actorByEmail(db, login)));
  if (!daniel || !staff || !guard) return log('My requests showcase: demo accounts missing; skipped.');
  const FIRST = 'Broken swing seat at the playground';
  if (await one(db, 'SELECT 1 FROM reports WHERE reporter_id = $1 AND description = $2', [daniel.id, FIRST])) return log('My requests showcase: already there.');
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);
  const zone = (await one<{ zone_id: string | null }>(db, 'SELECT zone_id FROM homes WHERE id = $1', [daniel.homeId]))?.zone_id ?? undefined;

  // Reports, one at each step: received, checked, assigned and late, fixed, closed.
  // (The blocked drain he follows with "Me too" is already assigned with a future date.)
  await createReport(db, daniel, { description: FIRST, locationText: 'Playground, Jalan Metafasa U16/171', zoneId: zone, category: 'SAFETY' }, ago(0, 2));

  const checked = await createReport(db, daniel, { description: 'Overgrown grass hiding the kerb on the corner', locationText: 'Corner of Jalan Metafasa U16/171', zoneId: zone, category: 'OTHER' }, ago(2));
  await updateReport(db, staff, checked.id, { status: 'IN_PROGRESS', staffNote: 'Seen by the team. Grass cutting will be booked this week.' }, ago(1, 20));

  const late = await createReport(db, daniel, { description: 'Street sign knocked over at the junction', locationText: 'Junction of Persiaran Metafasa and Jalan Metafasa U16/171', zoneId: zone, category: 'SAFETY' }, ago(6));
  await updateReport(db, staff, late.id, { status: 'IN_PROGRESS', assignedTo: 'Signage contractor', targetDate: dayOf(ago(2)), staffNote: 'The contractor will put the sign back up.' }, ago(5));

  const fixed = await createReport(db, daniel, { description: 'Loose drain cover outside No. 5', locationText: 'Outside No. 5, Jalan Metafasa U16/171', zoneId: zone, category: 'DRAINAGE' }, ago(8));
  await updateReport(db, staff, fixed.id, { status: 'IN_PROGRESS', assignedTo: 'Drainage contractor', targetDate: dayOf(ago(4)) }, ago(7));
  await updateReport(db, staff, fixed.id, { status: 'RESOLVED', staffNote: 'Cover replaced and fixed in place.' }, ago(4, 2));

  const closed = await createReport(db, daniel, { description: 'Cars parked on the road outside my gate every night', locationText: 'Outside No. 2, Jalan Metafasa U16/171', zoneId: zone, category: 'OTHER' }, ago(5));
  await updateReport(db, staff, closed.id, { status: 'REJECTED', staffNote: 'Parking on a public road is enforced by the local council (MBSA), not township maintenance. Please contact them.' }, ago(4));

  // A parcel waiting at the guardhouse.
  await logParcel(db, guard, { homeId: daniel.homeId!, courier: 'J&T Express', shelf: 'B4', trackingNo: 'JT7781200456' }, ago(0, 5));

  // Two recycling collections: one waiting for the collector, one confirmed (its gate pass is made).
  const collector = async (name: string) => (await one<{ id: string }>(db, 'SELECT id FROM recycling_collectors WHERE name = $1', [name]))?.id;
  const oil = await collector('Minyak Hijau Collectors');
  const paper = await collector('Kitar Plus Recyclers');
  if (oil) await bookCollection(db, daniel, { collectorId: oil, materials: ['COOKING_OIL'], items: 'Two bottles of used cooking oil', day: dayOf(new Date(now.getTime() + 2 * DAY)), slot: 'AFTERNOON' }, now);
  if (paper) {
    const booked = await bookCollection(db, daniel, { collectorId: paper, materials: ['PAPER'], items: 'A stack of old newspapers and boxes', day: dayOf(new Date(now.getTime() + 5 * DAY)), slot: 'MORNING' }, now);
    await confirmCollection(db, staff, booked.id, now);
  }

  log('My requests showcase: Daniel Tan has every kind of request and every report step.');
}
