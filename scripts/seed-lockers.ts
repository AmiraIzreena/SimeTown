import { randomUUID } from 'node:crypto';
import { LEGAL } from '../src/shared/legal';
import { LOCKER_SIZE_INFO } from '../src/shared/lockers';
import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { createStation, simulateClose } from '../src/server/modules/lockers/admin';
import { myLockerParcels, pickupAtStation } from '../src/server/modules/lockers/collection';
import { DEVICE } from '../src/server/modules/lockers/core';
import { approveCourier, createCompany } from '../src/server/modules/lockers/couriers';
import { chooseCounter, failDelivery, receiveAtCounter, registerParcel, reserveAndOpen } from '../src/server/modules/lockers/delivery';
import { addParcelNote, createOverflow, handOverAtCounter, runExpiry } from '../src/server/modules/lockers/overflow';
import { addShelfNote, handOverParcel, logParcel, returnParcel, runShelfRules } from '../src/server/modules/parcels/service';
import { randomCode } from '../src/server/modules/identity/service';
import { createAccount } from '../src/server/modules/ledger/ledger';

/**
 * Demo data for the smart lockers and the guardhouse: courier companies, demo couriers, a locker bank beside each
 * precinct's guardhouse with one private door per home, the Main guardhouse, three weeks of deliveries and
 * collections (so the dashboard and forecast have history), and a showcase of parcels in every state. Everything is made through the real services. Safe to run again: the history is added
 * once, and the doors are brought into line with the homes every time. Names and parcels are invented; no
 * courier company's own systems are involved.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
/** Kuala Lumpur is UTC+8 all year. */
const MYT = 8 * HOUR;

/** One locker bank beside each precinct's guardhouse. */
const BANKS = [
  { name: 'Elmina Valley Locker A', location: 'Beside the Elmina Valley main guardhouse', precincts: ['Elmina Valley 1', 'Elmina Valley 2', 'Elmina Valley 3'], lat: 3.17594, lng: 101.51005 },
  { name: 'Elmina Gardens Locker B', location: 'Beside the Elmina Gardens guardhouse', precincts: ['Elmina Gardens'] },
  { name: 'Elmina West Locker C', location: 'Beside the Elmina West guardhouse', precincts: ['Elmina West'] },
];

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

/**
 * Brings the locker banks into line with the homes: a bank for every precinct that has homes, exactly one door
 * per home (at least medium), each home holding its door. A home whose parcel already sits in a door keeps that
 * door. Spare doors that were never used are removed; used ones are taken out of use, so no record is lost.
 * Couriers who could use the first bank may use a new one too.
 */
export async function ensurePrivateDoors(db: Db, now: Date, log: (line: string) => void) {
  const admin = await actorByEmail(db, 'admin');
  if (!admin?.townshipId) return;
  const township = admin.townshipId;
  // Demo databases from before the real Elmina addresses call the six demo flats "Residensi KITA, Block A,
  // Precinct Melur" (RK-A-01-01…). Give them the address a fresh seed uses, so Elmina West has its homes.
  const moved = await db.query(
    `UPDATE homes h SET unit_code = 'HM-' || substring(h.unit_code FROM 4), precinct = 'Elmina West', street = 'Jalan Casuarina U17/56',
            building = 'Pangsapuri Harmoni Elmina, Block A',
            zone_id = coalesce((SELECT z.id FROM flood_zones z WHERE z.township_id = $1 AND z.name = 'Elmina West'), h.zone_id)
      WHERE h.township_id = $1 AND h.precinct = 'Precinct Melur' AND h.unit_code LIKE 'RK-A-%'
        AND NOT EXISTS (SELECT 1 FROM homes x WHERE x.township_id = $1 AND x.unit_code = 'HM-' || substring(h.unit_code FROM 4))
      RETURNING h.id`,
    [township],
  );
  if (moved.length) log(`Homes: ${moved.length} demo flats moved to their current address in Elmina West.`);
  let firstStation: string | null = null;
  for (const bank of BANKS) {
    const homes = await db.query<{ id: string }>('SELECT id FROM homes WHERE township_id = $1 AND precinct = ANY($2::text[]) ORDER BY precinct, unit_code', [township, bank.precincts]);
    if (homes.length === 0) continue;
    let station = await one<{ id: string }>(db, 'SELECT id FROM locker_stations WHERE township_id = $1 AND name = $2', [township, bank.name]);
    if (!station) {
      station = await createStation(db, admin, {
        name: bank.name, location: bank.location, layout: { M: homes.length }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true,
        lat: bank.lat, lng: bank.lng, precincts: bank.precincts,
      });
      if (firstStation) {
        // Whoever could use the first bank may use this one too.
        await db.query(`INSERT INTO courier_station_access (user_id, station_id, granted_by, granted_at) SELECT user_id, $2, $3, $4 FROM courier_station_access WHERE station_id = $1 ON CONFLICT DO NOTHING`, [firstStation, station.id, admin.id, now]);
        await db.query(`INSERT INTO courier_company_stations (company_id, station_id, granted_by, granted_at) SELECT company_id, $2, $3, $4 FROM courier_company_stations WHERE station_id = $1 ON CONFLICT DO NOTHING`, [firstStation, station.id, admin.id, now]);
      }
    } else {
      await db.query(`UPDATE locker_stations SET precincts = $2, location = $3 WHERE id = $1`, [station.id, bank.precincts, bank.location]);
    }
    firstStation ??= station.id;

    // A door holding a parcel goes to that parcel's home, if the home has none yet. A home with parcels in
    // several doors (from the shared lockers) takes one of them; the others stay until collected.
    await db.query(
      `UPDATE locker_compartments c SET home_id = pick.home_id
         FROM (SELECT DISTINCT ON (p.home_id) d.id, p.home_id
                 FROM locker_compartments d JOIN locker_parcels p ON p.id = d.parcel_id
                WHERE d.station_id = $1 AND d.home_id IS NULL AND p.home_id = ANY($2::uuid[])
                  AND NOT EXISTS (SELECT 1 FROM locker_compartments x WHERE x.home_id = p.home_id)
                ORDER BY p.home_id, d.label) pick
        WHERE c.id = pick.id`,
      [station.id, homes.map((h) => h.id)],
    );
    // Every other home without a door takes the next free one, adding doors when there are too few.
    const without = await db.query<{ id: string }>(
      `SELECT h.id FROM homes h WHERE h.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM locker_compartments c WHERE c.home_id = h.id) ORDER BY h.precinct, h.unit_code`,
      [homes.map((h) => h.id)],
    );
    for (const home of without) {
      let door = await one<{ id: string }>(db, `SELECT id FROM locker_compartments WHERE station_id = $1 AND home_id IS NULL AND parcel_id IS NULL AND state = 'AVAILABLE' ORDER BY label LIMIT 1`, [station.id]);
      if (!door) {
        const last = await one<{ n: number }>(db, `SELECT coalesce(max(substring(label FROM '[0-9]+')::int), 0) AS n FROM locker_compartments WHERE station_id = $1`, [station.id]);
        const [w, h, d] = LOCKER_SIZE_INFO.M.mm;
        door = await one<{ id: string }>(db, `INSERT INTO locker_compartments (station_id, label, size, width_mm, height_mm, depth_mm) VALUES ($1, $2, 'M', $3, $4, $5) RETURNING id`, [station.id, `A${String(last!.n + 1).padStart(2, '0')}`, w, h, d]);
      }
      await db.query('UPDATE locker_compartments SET home_id = $2 WHERE id = $1', [door!.id, home.id]);
    }
    // Spare doors: removed when never used, otherwise taken out of use.
    await db.query(
      `DELETE FROM locker_compartments c WHERE c.station_id = $1 AND c.home_id IS NULL AND c.parcel_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM locker_commands k WHERE k.compartment_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM locker_reservations r WHERE r.compartment_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM locker_parcels p WHERE p.compartment_id = c.id)`,
      [station.id],
    );
    await db.query(`UPDATE locker_compartments SET state = 'DISABLED', fault = 'Spare door: not assigned to a home' WHERE station_id = $1 AND home_id IS NULL AND parcel_id IS NULL AND state = 'AVAILABLE'`, [station.id]);
  }
  log('Smart lockers: every home has its own locker door.');
}

export async function seedLockers(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  if (await one(db, 'SELECT 1 FROM courier_companies LIMIT 1')) {
    // An existing database: bring the doors into line, and add the showcase once.
    await ensurePrivateDoors(db, now, log);
    return seedParcelShowcase(db, input);
  }
  const people = await Promise.all(['aisyah', 'daniel', 'priya', 'hafiz', 'meiling', 'siti', 'arjun', 'karyan', 'zainab', 'staff', 'admin', 'guard'].map((l) => actorByEmail(db, l)));
  if (people.slice(0, 11).some((p) => !p)) return log('Smart lockers: demo accounts missing; skipped.');
  type Eleven = [Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  const [aisyah, daniel, priya, hafiz, meiling, siti, arjun, karyan, zainab, , admin] = people as Eleven;
  const residents = [aisyah, daniel, priya, hafiz, meiling, siti, arjun, karyan, zainab];

  // --- Companies, locker banks, the guardhouse ------------------------------------------------
  const companies: Record<string, string> = {};
  for (const name of ['J&T Express', 'Shopee Express', 'Pos Laju', 'Ninja Van', 'DHL']) companies[name] = (await createCompany(db, admin, name)).id;
  await ensurePrivateDoors(db, now, () => undefined);
  const stations = await db.query<{ id: string; name: string; precincts: string[] }>('SELECT id, name, precincts FROM locker_stations WHERE township_id = $1 ORDER BY name', [admin.townshipId]);
  await createOverflow(db, admin, {
    name: 'Main guardhouse', kind: 'COUNTER', location: 'Elmina Valley main guardhouse', openFromHour: 8, openToHour: 22,
    instructions: 'Show your pickup code and your IC or passport to the guard on duty.', capacity: 100, acceptsDeliveries: true,
  });

  // --- Couriers ---------------------------------------------------------------------------------
  const courierUser = async (login: string, name: string, company: string) => {
    const user = await one<{ id: string }>(
      db,
      `INSERT INTO users (email, password_hash, full_name, phone, role, township_id, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, '+60123450000', 'COURIER', $4, $5, $6) RETURNING id`,
      [`${login}@${DOMAIN}`, input.passwordHash, name, admin.townshipId, LEGAL.version, now],
    );
    await db.query('INSERT INTO courier_accounts (user_id, company_id, township_id, applied_at) VALUES ($1, $2, $3, $4)', [user!.id, companies[company], admin.townshipId, new Date(now.getTime() - 30 * DAY)]);
    return user!.id;
  };
  const courierId = await courierUser('courier', 'Faizal Rahman', 'J&T Express');
  await approveCourier(db, admin, courierId, stations.map((s) => s.id), new Date(now.getTime() - 29 * DAY));
  await courierUser('courier2', 'Ahmad Zaki', 'Ninja Van'); // still waiting for approval
  const courier = (await actorByEmail(db, 'courier'))!;

  // Each resident's own bank: the one serving their precinct.
  const stationOf = async (resident: Actor) => {
    const home = await one<{ precinct: string | null }>(db, 'SELECT precinct FROM homes WHERE id = $1', [resident.homeId]);
    return stations.find((s) => home?.precinct && s.precincts.includes(home.precinct)) ?? stations[0]!;
  };
  const startOfToday = Math.floor((now.getTime() + MYT) / DAY) * DAY - MYT;
  const tracking = () => `JT${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

  /** A parcel into the resident's own door, shut with it inside. */
  const deliver = async (resident: Actor, when: Date, size: 'S' | 'M' = 'S') => {
    const station = await stationOf(resident);
    const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: tracking(), size, recipient: { memberCode: resident.memberCode! } }, when);
    if (!reg.verified) return null;
    const opened = await reserveAndOpen(db, courier, reg.id, randomUUID(), when);
    if (opened.kind !== 'OPENING') {
      // The home's door was in use: the courier keeps it for the next round, as on a real day.
      await failDelivery(db, courier, reg.id, 'The home’s door already held a parcel', when, 'DOOR_FULL');
      return null;
    }
    await simulateClose(db, courier, reg.id, true, new Date(when.getTime() + 2 * MIN));
    return { id: reg.id, station };
  };
  const collect = async (resident: Actor, delivered: { id: string; station: { id: string } }, when: Date) => {
    const pin = (await myLockerParcels(db, resident, when)).parcels.find((p) => p.id === delivered.id)?.pin;
    if (!pin) return;
    await pickupAtStation(db, delivered.station.id, pin, DEVICE, randomUUID(), when);
    await simulateClose(db, resident, delivered.id, false, new Date(when.getTime() + MIN));
  };
  // --- Three weeks of history --------------------------------------------------------------------
  let seed = 7;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let day = 21; day >= 2; day--) {
    const weekend = [0, 6].includes(new Date(startOfToday - day * DAY + MYT).getUTCDay());
    const count = (weekend ? 2 : 4) + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const resident = residents[Math.floor(random() * residents.length)]!;
      const when = new Date(startOfToday - day * DAY + 10 * HOUR + i * 47 * MIN);
      const delivered = await deliver(resident, when, random() < 0.75 ? 'S' : 'M');
      if (delivered) await collect(resident, delivered, new Date(when.getTime() + (3 + random() * 20) * HOUR));
    }
  }

  log(`Smart lockers: 5 courier companies, ${stations.length} locker banks with a private door for every home, the Main guardhouse, a courier (courier@${DOMAIN}) and three weeks of parcels.`);
  await seedParcelShowcase(db, input);
}

// --- The showcase: every state the parcel rules produce, added once (also to an existing database) ----------

/**
 * Parcels in every state the guardhouse and locker rules produce, so each screen has something real to show:
 * locker parcels in doors and at the guardhouse (overdue, a call due, a note, collected late, kept for the next
 * round), parcels a courier left with the guard (overdue, a call due, a note, collected late, sent back on request,
 * waiting), and Elmina West's Locker C in use. Made through the real services, with a Pos Laju courier whose
 * company is not connected to SimeTown (so no shipment check is needed). Added once: it is skipped when its
 * parcels are already there.
 */
async function seedParcelShowcase(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  // Added in two parts, each once: Locker C's own parcels, and everything else. A database that got the showcase
  // before it had Elmina West homes still gets Locker C's part.
  const mainThere = Boolean(await one(db, `SELECT 1 FROM locker_parcels WHERE tracking_no LIKE 'PLSHOW%' UNION ALL SELECT 1 FROM parcels WHERE tracking_no LIKE 'SHOW%' LIMIT 1`));
  const westThere = async () => {
    const station = await one<{ id: string }>(db, `SELECT id FROM locker_stations WHERE 'Elmina West' = ANY(precincts) LIMIT 1`);
    return !station || Boolean(await one(db, 'SELECT 1 FROM locker_parcels WHERE station_id = $1 LIMIT 1', [station.id]));
  };
  if (mainThere && (await westThere())) return log('Parcels: showcase already there.');
  const admin = await actorByEmail(db, 'admin');
  const staff = await actorByEmail(db, 'staff');
  if (!admin?.townshipId || !staff) return log('Parcels: demo accounts missing; showcase skipped.');
  const guard = (await actorByEmail(db, 'guard')) ?? staff;
  const people = await Promise.all(['aisyah', 'daniel', 'priya', 'hafiz', 'meiling', 'siti', 'arjun', 'karyan', 'zainab'].map((l) => actorByEmail(db, l)));
  if (people.some((p) => !p)) return log('Parcels: demo residents missing; showcase skipped.');
  type Nine = [Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  const [aisyah, daniel, priya, hafiz, meiling, siti, arjun, karyan, zainab] = people as Nine;

  // Elmina West: two verified households, so Locker C has residents.
  const westResident = async (login: string, name: string, unit: string) => {
    const existing = await actorByEmail(db, login);
    if (existing) return existing;
    const home = await one<{ id: string }>(db, 'SELECT id FROM homes WHERE township_id = $1 AND unit_code = $2', [admin.townshipId, unit]);
    if (!home) return undefined;
    const row = await one<Parameters<typeof toActor>[0]>(
      db,
      `INSERT INTO users AS u (email, password_hash, full_name, role, phone, township_id, home_id, occupancy, residency_status, member_code, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, 'RESIDENT', $4, $5, $6, 'OWNER', 'VERIFIED', $7, $8, $9) RETURNING ${ACTOR_COLUMNS}`,
      [`${login}@${DOMAIN}`, input.passwordHash, name, `+60123${String(100000 + Math.floor(Math.random() * 899999)).slice(0, 6)}`, admin.townshipId, home.id, randomCode(8), LEGAL.version, now],
    );
    const actor = toActor(row!);
    await createAccount(db, 'WALLET', { userId: actor.id });
    return actor;
  };
  const izzah = await westResident('izzah', 'Nurul Izzah Kamal', 'HM-A-01-01');
  const rajesh = await westResident('rajesh', 'Rajesh Pillai', 'HM-A-02-02');
  await ensurePrivateDoors(db, now, () => undefined);
  const addWest = !(await westThere());
  if (mainThere && !addWest) return log('Parcels: showcase already there.');

  // The guardhouse and a Pos Laju courier who may use every locker bank.
  let counter = await one<{ id: string }>(db, `SELECT id FROM overflow_locations WHERE township_id = $1 AND active ORDER BY name LIMIT 1`, [admin.townshipId]);
  counter ??= await createOverflow(db, admin, {
    name: 'Main guardhouse', kind: 'COUNTER', location: 'Elmina Valley main guardhouse', openFromHour: 8, openToHour: 22,
    instructions: 'Show your pickup code and your IC or passport to the guard on duty.', capacity: 100, acceptsDeliveries: true,
  });
  const stations = await db.query<{ id: string; precincts: string[] }>('SELECT id, precincts FROM locker_stations WHERE township_id = $1 ORDER BY name', [admin.townshipId]);
  let posLaju = await one<{ id: string }>(db, `SELECT id FROM courier_companies WHERE name = 'Pos Laju'`);
  posLaju ??= await createCompany(db, admin, 'Pos Laju');
  let courier = await actorByEmail(db, 'poslaju');
  if (!courier) {
    const user = await one<{ id: string }>(
      db,
      `INSERT INTO users (email, password_hash, full_name, phone, role, township_id, terms_version, terms_accepted_at)
       VALUES ($1, $2, 'Rahim Osman', '+60123450099', 'COURIER', $3, $4, $5) RETURNING id`,
      [`poslaju@${DOMAIN}`, input.passwordHash, admin.townshipId, LEGAL.version, now],
    );
    await db.query('INSERT INTO courier_accounts (user_id, company_id, township_id, applied_at) VALUES ($1, $2, $3, $4)', [user!.id, posLaju.id, admin.townshipId, new Date(now.getTime() - 40 * DAY)]);
    await approveCourier(db, admin, user!.id, stations.map((s) => s.id), new Date(now.getTime() - 40 * DAY));
    courier = (await actorByEmail(db, 'poslaju'))!;
  }

  const startOfToday = Math.floor((now.getTime() + MYT) / DAY) * DAY - MYT;
  const at = (daysAgo: number, hour: number, minute = 0) => {
    let t = startOfToday - daysAgo * DAY + hour * HOUR + minute * MIN;
    if (t > now.getTime() - 5 * MIN) t -= DAY;
    return new Date(t);
  };
  let serial = 0;
  const tracking = () => `${mainThere ? 'PLWEST' : 'PLSHOW'}${String(++serial).padStart(4, '0')}`;
  const stationOf = async (resident: Actor) => {
    const home = await one<{ precinct: string | null }>(db, 'SELECT precinct FROM homes WHERE id = $1', [resident.homeId]);
    return stations.find((s) => home?.precinct && s.precincts.includes(home.precinct)) ?? stations[0]!;
  };
  const doorFree = async (resident: Actor) => Boolean(await one(db, `SELECT 1 FROM locker_compartments WHERE home_id = $1 AND state = 'AVAILABLE' AND parcel_id IS NULL`, [resident.homeId]));
  /** A parcel into the resident's own door, when the door is free. */
  const deliver = async (resident: Actor, when: Date, size: 'S' | 'M' = 'M') => {
    if (!(await doorFree(resident))) return null;
    const station = await stationOf(resident);
    const reg = await registerParcel(db, courier!, { stationId: station.id, trackingNo: tracking(), size, recipient: { memberCode: resident.memberCode! } }, when);
    if (!reg.verified) return null;
    const opened = await reserveAndOpen(db, courier!, reg.id, randomUUID(), when);
    if (opened.kind !== 'OPENING') return null;
    await simulateClose(db, courier!, reg.id, true, new Date(when.getTime() + 2 * MIN));
    return { id: reg.id, station };
  };
  const collect = async (resident: Actor, delivered: { id: string; station: { id: string } }, when: Date) => {
    const pin = (await myLockerParcels(db, resident, when)).parcels.find((p) => p.id === delivered.id)?.pin;
    if (!pin) return;
    await pickupAtStation(db, delivered.station.id, pin, DEVICE, randomUUID(), when);
    await simulateClose(db, resident, delivered.id, false, new Date(when.getTime() + MIN));
  };
  /** A box too big for the home's door: the courier hands it to the guard at the guardhouse. */
  const toGuardhouse = async (resident: Actor, when: Date) => {
    const station = await stationOf(resident);
    const reg = await registerParcel(db, courier!, { stationId: station.id, trackingNo: tracking(), size: 'XL', recipient: { memberCode: resident.memberCode! } }, when);
    if (!reg.verified) return null;
    const opened = await reserveAndOpen(db, courier!, reg.id, randomUUID(), when);
    if (opened.kind !== 'NO_DOOR') return null;
    await chooseCounter(db, courier!, reg.id, counter!.id, when);
    await receiveAtCounter(db, guard, reg.id, new Date(when.getTime() + 10 * MIN));
    return reg.id;
  };

  // Locker C in use over the last two weeks, so its figures are real.
  if (addWest) {
    for (const [i, resident] of [izzah, rajesh, izzah, rajesh, izzah].entries()) {
      if (!resident) continue;
      const when = at(14 - i * 3, 11);
      const delivered = await deliver(resident, when);
      if (delivered) await collect(resident, delivered, new Date(when.getTime() + (6 + i * 4) * HOUR));
    }
  }

  // Locker parcels kept at the guardhouse.
  if (!mainThere) {
    const lateOne = await toGuardhouse(aisyah, at(40, 12)); // collected late last month: in her late-collections record
    if (lateOne) {
      await runExpiry(db, at(33, 14));
      const pin = (await myLockerParcels(db, aisyah, at(31, 18))).parcels.find((p) => p.id === lateOne)?.pin;
      if (pin) await handOverAtCounter(db, guard, counter.id, pin, true, at(31, 18));
    }
    await toGuardhouse(hafiz, at(15, 12)); // over two weeks: overdue, reminded weekly, and a call is due
    await runExpiry(db, at(8, 10));
    const daniels = await toGuardhouse(daniel, at(9, 14)); // nine days: overdue, with a note
    await runExpiry(db, at(2, 10));
    if (daniels) await addParcelNote(db, staff, daniels, 'Called the household: they will collect it this weekend.', at(1, 15));
  }
  if (addWest && rajesh) await toGuardhouse(rajesh, at(3, 16)); // from Locker C, three days at the guardhouse

  // Locker parcels in homes' own doors.
  if (!mainThere) {
    await deliver(arjun, at(3, 10)); // three days: a gentle reminder
    await runExpiry(db, at(1, 12));
  }
  if (addWest && izzah) await deliver(izzah, new Date(now.getTime() - 6 * HOUR));
  if (mainThere) {
    await runExpiry(db, now);
    await runShelfRules(db, now);
    return log('Parcels: Locker C showcase added (Nurul Izzah and Rajesh in Elmina West, with a parcel at the guardhouse).');
  }
  await deliver(meiling, new Date(now.getTime() - 5 * HOUR));
  await deliver(zainab, new Date(now.getTime() - 3 * HOUR));
  await deliver(aisyah, new Date(now.getTime() - 40 * MIN));
  await toGuardhouse(aisyah, at(0, 11)); // too big for her door, at the guardhouse today
  // A box too big for Siti's door arrived after the guardhouse closed: the courier keeps it for the next round.
  const lateNight = at(1, 22, 40);
  const big = await registerParcel(db, courier, { stationId: (await stationOf(siti)).id, trackingNo: tracking(), size: 'XL', recipient: { memberCode: siti.memberCode! } }, lateNight);
  if (big.verified) {
    await reserveAndOpen(db, courier, big.id, randomUUID(), lateNight);
    await failDelivery(db, courier, big.id, 'Too big for the home’s door, and the guardhouse was closed', lateNight, 'COUNTER_CLOSED');
  }

  // Parcels couriers left straight with the guard, with their histories.
  const shelf = async (resident: Actor, courierName: string, place: string, trackingNo: string, when: Date) =>
    (await logParcel(db, guard, { homeId: resident.homeId!, courier: courierName, shelf: place, trackingNo }, when)).id;
  const codeOf = async (id: string) => (await one<{ code: string }>(db, 'SELECT code FROM parcels WHERE id = $1', [id]))!.code;
  const hafizShelf = await shelf(hafiz, 'DHL', 'A3', 'SHOW0001', at(25, 10)); // collected after 11 days, overdue
  await runShelfRules(db, at(18, 10));
  await handOverParcel(db, guard, hafizShelf, { code: await codeOf(hafizShelf) }, at(14, 11));
  const sitiShelf = await shelf(siti, 'GDex', 'D1', 'SHOW0002', at(12, 14)); // overdue, then sent back on request
  await runShelfRules(db, at(5, 10));
  await returnParcel(db, guard, sitiShelf, 'The household asked: wrong item ordered, and the seller arranged a pickup', at(3, 16));
  await shelf(priya, 'Shopee Express', 'C2', 'SHOW0003', at(16, 15)); // over two weeks: a call is due
  const karyanShelf = await shelf(karyan, 'Pos Laju', 'B1', 'SHOW0004', at(9, 11)); // overdue, with a note
  await runShelfRules(db, at(2, 10));
  await addShelfNote(db, guard, karyanShelf, 'Called: will collect on Saturday.', at(1, 16));
  const zainabShelf = await shelf(zainab, 'City-Link', 'A2', 'SHOW0005', at(5, 12)); // collected the same day
  await handOverParcel(db, guard, zainabShelf, { code: await codeOf(zainabShelf), collectedBy: 'Yusof (husband)' }, at(5, 18));
  await shelf(arjun, 'Ninja Van', 'A1', 'SHOW0006', at(2, 17));
  await shelf(meiling, 'Lalamove', 'B2', 'SHOW0007', at(0, 9));
  if (izzah) await shelf(izzah, 'Shopee Express', 'C4', 'SHOW0008', at(1, 10));

  await runExpiry(db, now);
  await runShelfRules(db, now);
  log('Parcels: showcase added (Locker C in use, guardhouse parcels with their histories: overdue, calls due, notes, late collections, a return on request).');
}

