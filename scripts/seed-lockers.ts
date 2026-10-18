import { randomUUID } from 'node:crypto';
import { LEGAL } from '../src/shared/legal';
import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { createStation, simulateClose } from '../src/server/modules/lockers/admin';
import { myLockerParcels, pickupAtStation } from '../src/server/modules/lockers/collection';
import { DEVICE } from '../src/server/modules/lockers/core';
import { approveCourier, createCompany } from '../src/server/modules/lockers/couriers';
import { failDelivery, registerParcel, reserveAndOpen } from '../src/server/modules/lockers/delivery';
import { completeRelocation, createOverflow, runExpiry, startRelocation, verifyRelocatedParcel } from '../src/server/modules/lockers/overflow';

/**
 * Demo data for the smart lockers: courier companies, a demo courier, two
 * simulated stations, two counters, three weeks of deliveries and collections
 * (so the dashboard and forecast have history), and live parcels in every
 * interesting state. Everything is made through the real services. Safe to run
 * again: it does nothing once the courier companies exist. Names and parcels
 * are invented; no courier company's own systems are involved.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;
const MIN = 60_000;

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedLockers(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  if (await one(db, 'SELECT 1 FROM courier_companies LIMIT 1')) return log('Smart lockers: demo data already there.');
  const people = await Promise.all(['aisyah', 'daniel', 'priya', 'hafiz', 'meiling', 'siti', 'arjun', 'karyan', 'zainab', 'staff', 'admin'].map((l) => actorByEmail(db, l)));
  if (people.some((p) => !p)) return log('Smart lockers: demo accounts missing; skipped.');
  type Eleven = [Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  const [aisyah, daniel, priya, hafiz, meiling, siti, arjun, karyan, zainab, staff, admin] = people as Eleven;
  const residents = [aisyah, daniel, priya, hafiz, meiling, siti, arjun, karyan, zainab];

  // --- Companies, stations, counters ----------------------------------------------------------
  const companies: Record<string, string> = {};
  for (const name of ['J&T Express', 'Shopee Express', 'Pos Laju', 'Ninja Van', 'DHL']) companies[name] = (await createCompany(db, admin, name)).id;
  const a = await createStation(db, admin, { name: 'Elmina Valley Locker A', location: 'Beside the Elmina Valley main guardhouse', layout: { S: 10, M: 8, L: 4, XL: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true, lat: 3.17594, lng: 101.51005 });
  const b = await createStation(db, admin, { name: 'Elmina Gardens Locker B', location: 'Elmina Gardens community hall entrance', layout: { S: 6, M: 4, L: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  const counter = await createOverflow(db, admin, { name: 'Township office parcel counter', kind: 'COUNTER', location: 'Township management office, ground floor', hours: 'Mon to Sat, 9am to 6pm', instructions: 'Show your pickup code and your IC or passport.', capacity: 60, acceptsDeliveries: true });
  await createOverflow(db, admin, { name: 'Main guardhouse counter', kind: 'COUNTER', location: 'Elmina Valley main guardhouse', hours: 'Every day, 24 hours', instructions: 'Show your pickup code and your IC or passport to the guard on duty.', capacity: 30, acceptsDeliveries: false });

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
  await approveCourier(db, admin, courierId, [a.id, b.id], new Date(now.getTime() - 29 * DAY));
  await courierUser('courier2', 'Ahmad Zaki', 'Ninja Van'); // still waiting for approval
  const courier = (await actorByEmail(db, 'courier'))!;

  // --- Three weeks of history --------------------------------------------------------------------
  const deliver = async (resident: Actor, station: { id: string }, at: Date, size: 'S' | 'M' | 'L' = 'S') => {
    const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: `JT${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`, size, recipient: { memberCode: resident.memberCode! } }, at);
    const opened = await reserveAndOpen(db, courier, reg.id, randomUUID(), at);
    if (opened.kind !== 'OPENING') return null;
    await simulateClose(db, courier, reg.id, true, new Date(at.getTime() + 2 * MIN));
    return reg.id;
  };
  const collect = async (resident: Actor, station: { id: string }, parcelId: string, at: Date) => {
    const pin = (await myLockerParcels(db, resident, at)).parcels.find((p) => p.id === parcelId)?.pin;
    if (!pin) return;
    await pickupAtStation(db, station.id, pin, DEVICE, randomUUID(), at);
    await simulateClose(db, resident, parcelId, false, new Date(at.getTime() + MIN));
  };
  let seed = 7;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let day = 21; day >= 2; day--) {
    const dayStart = new Date(Math.floor(now.getTime() / DAY) * DAY - day * DAY + 2 * 3_600_000); // 10am in Kuala Lumpur
    const weekend = [0, 6].includes(new Date(dayStart.getTime() + 8 * 3_600_000).getUTCDay());
    const count = (weekend ? 2 : 4) + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const resident = residents[Math.floor(random() * residents.length)]!;
      const station = random() < 0.7 ? a : b;
      const at = new Date(dayStart.getTime() + i * 47 * MIN);
      const id = await deliver(resident, station, at, random() < 0.75 ? 'S' : 'M');
      if (id) await collect(resident, station, id, new Date(at.getTime() + (3 + random() * 20) * 3_600_000));
    }
  }

  // --- Live parcels in every interesting state ----------------------------------------------------
  // Hafiz: not collected in time, so moved to the township office counter two days ago.
  const late = await deliver(hafiz, a, new Date(now.getTime() - 4.5 * DAY), 'M');
  if (late) {
    const due = new Date(now.getTime() - 2.4 * DAY);
    await runExpiry(db, due);
    const task = await one<{ id: string }>(db, `SELECT id FROM relocation_tasks WHERE parcel_id = $1 AND status = 'OPEN'`, [late]);
    if (task) {
      await startRelocation(db, staff, task.id, counter.id, randomUUID(), due);
      const tracking = (await one<{ tracking_no: string }>(db, 'SELECT tracking_no FROM locker_parcels WHERE id = $1', [late]))!.tracking_no;
      await verifyRelocatedParcel(db, staff, task.id, tracking, due);
      await simulateClose(db, staff, late, false, due);
      await completeRelocation(db, staff, task.id, false, due);
    }
  }
  // Priya: past its deadline: a relocation task waits for staff.
  await deliver(priya, a, new Date(now.getTime() - 50 * 3_600_000), 'S');
  // Daniel: overdue, reminded.
  await deliver(daniel, a, new Date(now.getTime() - 30 * 3_600_000), 'S');
  // Mei Ling and Zainab: ready to collect.
  await deliver(meiling, b, new Date(now.getTime() - 5 * 3_600_000), 'S');
  await deliver(zainab, a, new Date(now.getTime() - 3 * 3_600_000), 'L');
  // Aisyah: just arrived.
  await deliver(aisyah, a, new Date(now.getTime() - 40 * MIN), 'S');
  await runExpiry(db, now);
  // A delivery the courier could not make.
  const failed = await registerParcel(db, courier, { stationId: b.id, trackingNo: `JT${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`, size: 'XL', recipient: { memberCode: siti.memberCode! } }, new Date(now.getTime() - 6 * 3_600_000));
  if (failed.verified) await failDelivery(db, courier, failed.id, 'Too big for this station; taken back for doorstep delivery', new Date(now.getTime() - 6 * 3_600_000));

  log(`Smart lockers: 5 courier companies, 2 simulated stations, 2 counters, a courier (courier@${DOMAIN}) and three weeks of parcels.`);
}
