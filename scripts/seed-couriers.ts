import { randomUUID } from 'node:crypto';
import { LEGAL } from '../src/shared/legal';
import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import { decideCompany, inviteRepresentative, setCompanyStations, updateIntegration, type IntegrationInput } from '../src/server/modules/carriers/companies';
import { inviteCourier, setTeamMember } from '../src/server/modules/carriers/team';
import { simulateClose } from '../src/server/modules/lockers/admin';
import { deliverShipment } from '../src/server/modules/lockers/delivery';
import { reconcile } from '../src/server/modules/lockers/hardware';
import { verifyShipment } from '../src/server/modules/carriers/verification';

/**
 * Demo data for the courier platform. J&T Express, Ninja Van and Shopee
 * Express become simulated companies: J&T and Ninja Van manage their own
 * couriers through their managers, Shopee Express signs its couriers in with its
 * own (simulated) sign-in. Each company gets fictional shipments, one for every
 * case the demo shows. Nothing here is connected to, or issued by, a real
 * courier company; tracking numbers carry "SIM" so they cannot be mistaken for
 * real ones. Safe to run again: it does nothing once the companies have codes.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;
const MIN = 60_000;

async function actorByEmail(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [login.includes('@') ? login : `${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

/** The address a resident's home has, written as a shop would print it on a label. */
async function labelAddress(db: Db, homeRef: string) {
  const h = await one<{ house_no: string; street: string; precinct: string; postcode: string; city: string; state: string }>(
    db, 'SELECT house_no, street, precinct, postcode, city, state FROM homes WHERE unit_code = $1', [homeRef],
  );
  return h ? { line: `No. ${h.house_no}, ${h.street}, ${h.precinct}, ${h.postcode} ${h.city}, ${h.state}`, postcode: h.postcode } : null;
}

export async function seedCourierPlatform(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log, passwordHash } = input;
  const addFailedCheckDemo = async () => {
    const courier = await actorByEmail(db, 'courier');
    if (!courier) return false;
    const station = await one<{ id: string }>(
      db,
      `SELECT id FROM locker_stations WHERE township_id = $1 ORDER BY CASE WHEN name LIKE '%Locker A%' THEN 0 ELSE 1 END, name LIMIT 1`,
      [courier.townshipId],
    );
    const alreadyThere = await one(
      db,
      `SELECT 1 FROM courier_scans WHERE township_id = $1 AND tracking_no = 'JTSIM10000008' AND outcome = 'NOT_ELIGIBLE' AND reason = 'ASSIGNED_TO_ANOTHER_COURIER'`,
      [courier.townshipId],
    );
    if (!station || alreadyThere) return Boolean(alreadyThere);
    const result = await verifyShipment(db, courier, { stationId: station.id, code: 'JTSIM10000008' }, new Date(now.getTime() - 90 * MIN));
    return result.state === 'NOT_ELIGIBLE' && result.reason === 'ASSIGNED_TO_ANOTHER_COURIER';
  };
  if (await one(db, `SELECT 1 FROM courier_companies WHERE code = 'JNT'`)) {
    const added = await addFailedCheckDemo();
    return log(added ? 'Courier platform: demo data already there, including a failed parcel check.' : 'Courier platform: demo data already there.');
  }
  const company = async (name: string) => (await one<{ id: string }>(db, 'SELECT id FROM courier_companies WHERE name = $1', [name]))?.id;
  const [jnt, njv, spx, pos, dhl] = await Promise.all(['J&T Express', 'Ninja Van', 'Shopee Express', 'Pos Laju', 'DHL'].map(company));
  const admin = await actorByEmail(db, 'admin');
  const people = await Promise.all(['aisyah', 'daniel', 'priya', 'hafiz', 'meiling', 'zainab', 'courier', 'courier2'].map((l) => actorByEmail(db, l)));
  if (!jnt || !njv || !spx || !admin || people.some((p) => !p)) return log('Courier platform: the smart-locker demo data is missing; skipped.');
  const [aisyah, , , , , zainab, faizal, ahmad] = people as [Actor, Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  const stations = await db.query<{ id: string; name: string }>('SELECT id, name FROM locker_stations WHERE township_id = $1 ORDER BY name', [admin.townshipId]);
  const stationA = stations.find((s) => s.name.includes('Locker A')) ?? stations[0]!;
  const allStations = stations.map((s) => s.id);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // --- Companies: how couriers get access and how shipments are checked -------------------------
  const integration = async (id: string, code: string, i: IntegrationInput) => {
    await db.query('UPDATE courier_companies SET code = $2 WHERE id = $1', [id, code]);
    await updateIntegration(db, admin, id, i, ago(30 * DAY));
  };
  await integration(jnt, 'JNT', { authMethod: 'COMPANY_MANAGED', providerMode: 'SIMULATED', canConfirmAssignment: true, trackingPattern: 'JTSIM[0-9]{8}' });
  await integration(njv, 'NJV', { authMethod: 'COMPANY_MANAGED', providerMode: 'SIMULATED', canConfirmAssignment: false, trackingPattern: 'NVSIM[0-9]{8}' });
  await integration(spx, 'SPX', { authMethod: 'FEDERATED', providerMode: 'SIMULATED', canConfirmAssignment: true, trackingPattern: 'SPXSIM[0-9]{8}', idpMode: 'SIMULATED' });
  if (pos) await db.query(`UPDATE courier_companies SET code = 'POSLAJU' WHERE id = $1`, [pos]);
  if (dhl) await db.query(`UPDATE courier_companies SET code = 'DHL' WHERE id = $1`, [dhl]);
  const until = new Date(now.getTime() + 180 * DAY).toISOString().slice(0, 10);
  for (const [id, ref] of [[jnt, 'DEMO-JNT-2026'], [njv, 'DEMO-NJV-2026'], [spx, 'DEMO-SPX-2026']] as const) {
    await decideCompany(db, admin, id, {
      status: 'ACTIVE', verifiedNote: 'Demo: a simulated company. No real agreement or connection exists.', agreementRef: ref, agreementUntil: until, minAssurance: 'MEDIUM', allowFallback: true,
    }, ago(30 * DAY));
    await setCompanyStations(db, admin, id, id === spx ? [stationA.id] : allStations, ago(30 * DAY));
  }

  // --- Representatives, who manage their company's couriers ---------------------------------------
  const activate = async (userId: string) => {
    await db.query('UPDATE users SET password_hash = $2, terms_version = $3, terms_accepted_at = $4, phone = coalesce(phone, $5) WHERE id = $1', [userId, passwordHash, LEGAL.version, now, '+60123450100']);
    await db.query('DELETE FROM user_invites WHERE user_id = $1', [userId]);
  };
  const jntManager = await inviteRepresentative(db, admin, jnt, { fullName: 'Kavitha Raman', email: `jnt-manager@${DOMAIN}` }, ago(29 * DAY));
  await activate(jntManager.id);
  const njvManager = await inviteRepresentative(db, admin, njv, { fullName: 'Tan Wei Ming', email: `ninjavan-manager@${DOMAIN}` }, ago(29 * DAY));
  await activate(njvManager.id);
  const kavitha = (await actorByEmail(db, 'jnt-manager'))!;
  const weiMing = (await actorByEmail(db, 'ninjavan-manager'))!;

  // --- Couriers: the existing demo couriers now belong to their companies ----------------------------
  // Faizal (courier@) is one of J&T's own couriers: J&T vouches for him, not the township.
  await db.query(`UPDATE courier_accounts SET managed_by = 'COMPANY', employee_ref = 'JT-1001', invited_by = $2, last_verified_at = $3 WHERE user_id = $1`, [faizal.id, kavitha.id, ago(2 * DAY)]);
  await db.query('DELETE FROM courier_station_access WHERE user_id = $1', [faizal.id]);
  const hairul = await inviteCourier(db, kavitha, { fullName: 'Hairul Azman', email: `hairul@${DOMAIN}`, employeeRef: 'JT-1002' }, ago(20 * DAY));
  await activate(hairul.id);
  // Ahmad Zaki (courier2@) is a Ninja Van courier whom Ninja Van has suspended: he cannot deliver.
  await db.query(`UPDATE courier_accounts SET managed_by = 'COMPANY', employee_ref = 'NV-2002', invited_by = $2, status = 'ACTIVE', last_verified_at = $3 WHERE user_id = $1`, [ahmad.id, weiMing.id, ago(10 * DAY)]);
  await setTeamMember(db, weiMing, ahmad.id, { status: 'SUSPENDED', note: 'Under investigation (demo)' }, ago(DAY));
  const nurul = await inviteCourier(db, weiMing, { fullName: 'Nurul Ain', email: `nurul@${DOMAIN}`, employeeRef: 'NV-2001' }, ago(15 * DAY));
  await activate(nurul.id);
  // Shopee Express's own (simulated) staff directory: its couriers sign in there, and get a SimeTown account on first sign-in.
  for (const [ref, name, email, active] of [['SPX-3001', 'Lim Wei Jie', 'weijie@spx.demo.kita.test', true], ['SPX-3002', 'Rosli Osman', 'rosli@spx.demo.kita.test', false]] as const) {
    await db.query('INSERT INTO sim_directory (company_id, employee_ref, full_name, email, password_hash, active) VALUES ($1, $2, $3, $4, $5, $6)', [spx, ref, name, email, passwordHash, active]);
  }

  // --- Fictional shipments, one for each case the demo shows ------------------------------------------
  const phoneOf = async (a: Actor) => (await one<{ phone: string | null }>(db, 'SELECT phone FROM users WHERE id = $1', [a.id]))!.phone;
  const home = async (ref: string) => (await labelAddress(db, ref))!;
  type Address = { line: string; postcode: string };
  const [aisyahHome, danielHome, priyaHome, hafizHome, meilingHome, emptyHome] = (await Promise.all(['EV1-01', 'EV1-02', 'EV1-05', 'EV2-01', 'EV2-04', 'EV1-07'].map(home))) as [Address, Address, Address, Address, Address, Address];
  const ship = async (companyId: string, s: {
    tracking: string; name: string; phone?: string | null; address: { line: string; postcode: string }; demo: string; carriedBy?: string; eligible?: boolean;
    status?: string; code?: string | null; weightG?: number; dims?: [number, number, number];
  }) => {
    await db.query(
      `INSERT INTO sim_shipments (company_id, tracking_no, status, locker_eligible, recipient_name, recipient_phone, address_line, postcode, simetown_code, weight_g, length_mm, width_mm, height_mm, assigned_courier_ref, demo_case)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [companyId, s.tracking, s.status ?? 'OUT_FOR_DELIVERY', s.eligible ?? true, s.name, s.phone ?? null, s.address.line, s.address.postcode, s.code ?? null, s.weightG ?? null,
        s.dims?.[0] ?? null, s.dims?.[1] ?? null, s.dims?.[2] ?? null, s.carriedBy ?? null, s.demo],
    );
  };
  await ship(jnt, { tracking: 'JTSIM10000001', name: 'AISYAH BINTI RAHMAN', phone: await phoneOf(aisyah), address: aisyahHome, carriedBy: 'JT-1001', weightG: 800, dims: [300, 200, 80], demo: 'The main demo: J&T confirms the shipment and that Faizal carries it (high assurance), and SimeTown matches Aisyah by phone, name and address.' });
  await ship(njv, { tracking: 'NVSIM20000001', name: 'Daniel Tan', address: danielHome, demo: 'A Ninja Van shipment for Daniel, matched by address and name. Ninja Van cannot say which courier carries it, so it is medium assurance; Nurul Ain delivers it.' });
  await ship(jnt, { tracking: 'JTSIM10000004', name: 'Priya Nair', address: priyaHome, carriedBy: 'JT-1002', weightG: 500, dims: [250, 180, 60], demo: 'A duplicate: Hairul is already delivering it, so anyone else who scans it is refused.' });
  await ship(jnt, { tracking: 'JTSIM10000005', name: 'Kumar Selvam', phone: '+60198887766', address: aisyahHome, carriedBy: 'JT-1001', demo: 'Recipient mismatch: Aisyah’s address, but a name nobody there has. No door opens, and staff can check.' });
  await ship(jnt, { tracking: 'JTSIM10000006', name: 'Farid Hakim', address: emptyHome, carriedBy: 'JT-1001', demo: 'Unregistered recipient: a real address in the township, but nobody registered in SimeTown lives there.' });
  await ship(jnt, { tracking: 'JTSIM10000007', name: 'Aisyah Rahman', address: aisyahHome, carriedBy: 'JT-1001', eligible: false, demo: 'Not eligible: J&T says it needs a signature, so it cannot go in a locker.' });
  await ship(jnt, { tracking: 'JTSIM10000008', name: 'Hafiz Ismail', address: hafizHome, carriedBy: 'JT-1002', demo: 'Assigned to another courier: J&T says Hairul carries it. If Faizal scans it (a copied label?), it is refused and staff see an incident.' });
  await ship(jnt, { tracking: 'JTSIM10000009', name: 'Priya Nair', address: priyaHome, carriedBy: 'JT-1001', weightG: 400, dims: [220, 150, 50], demo: 'Already deposited: it is in Locker A for Priya. Scanning it again opens nothing and is recorded.' });
  await ship(njv, { tracking: 'NVSIM20000002', name: 'Hafiz Ismail', address: hafizHome, demo: 'Handed to Ahmad Zaki, whom Ninja Van has suspended: he cannot deliver it. Nurul Ain can.' });
  await ship(njv, { tracking: 'NVSIM20000003', name: 'Lim Mei Ling', address: meilingHome, demo: 'For the outage demo: switch Ninja Van’s simulated system down, then the courier uses Mei Ling’s SimeTown delivery code instead.' });
  await ship(spx, { tracking: 'SPXSIM30000001', name: 'Zainab', address: aisyahHome, code: zainab.memberCode, carriedBy: 'SPX-3001', weightG: 1200, dims: [350, 250, 120], demo: 'Shopee Express (simulated sign-in): matched by the SimeTown delivery code Zainab gave the shop, even though the address is not hers. Lim Wei Jie carries it.' });

  // --- Live states: one shipment already in a locker, one already being delivered by someone else ------------
  const faizalNow = (await actorByEmail(db, 'courier'))!;
  const delivered = await deliverShipment(db, faizalNow, { stationId: stationA.id, code: 'JTSIM10000009', idempotencyKey: randomUUID() }, ago(3 * 3_600_000));
  if (delivered.kind === 'OPENING') await simulateClose(db, faizalNow, delivered.parcelId, true, ago(3 * 3_600_000 - 2 * MIN));
  const hairulNow = (await actorByEmail(db, 'hairul'))!;
  const started = await deliverShipment(db, hairulNow, { stationId: stationA.id, code: 'JTSIM10000004', idempotencyKey: randomUUID() }, ago(20 * MIN));
  // Hairul shut the door before putting the parcel in; the unused door is freed, and the shipment stays his to deliver.
  if (started.kind === 'OPENING') await simulateClose(db, hairulNow, started.parcelId, false, ago(19 * MIN));
  await reconcile(db, ago(10 * MIN));
  await addFailedCheckDemo();

  log(`Courier platform: J&T Express, Ninja Van and Shopee Express are simulated companies with 11 fictional shipments and a failed parcel-check example; managers jnt-manager@ and ninjavan-manager@; couriers courier@, hairul@, nurul@ (active) and courier2@ (suspended by Ninja Van); Shopee staff SPX-3001 sign in through its simulated sign-in.`);
}
