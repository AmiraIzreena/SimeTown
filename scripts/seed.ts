import './env';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Role } from '../src/shared/domain';
import { LEGAL } from '../src/shared/legal';
import type { Actor } from '../src/server/auth/actor';
import { hashPassword } from '../src/server/auth/password';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { getConfig } from '../src/server/config';
import { getDb, one } from '../src/server/db/client';
import { createCampaign, fundCampaign } from '../src/server/modules/campaigns/service';
import { createPost } from '../src/server/modules/community/posts';
import { acceptResponse, confirmResponse, respondToPost } from '../src/server/modules/community/responses';
import { recordLevel } from '../src/server/modules/banjir/service';
import { checkIn, createLoop, listLoopsForStaff } from '../src/server/modules/gerak/service';
import { randomCode } from '../src/server/modules/identity/service';
import { createKiosk, recordDropOff } from '../src/server/modules/kitar/service';
import { createAccount } from '../src/server/modules/ledger/ledger';
import { recordCommunityDeposit, recordMerchantDeposit, runFloatCheck, runSettlement } from '../src/server/modules/ledger/finance';
import { setMerchantStatus } from '../src/server/modules/merchant/admin';
import { createSale, decideSale } from '../src/server/modules/merchant/service';
import { createReport, updateReport } from '../src/server/modules/reports/service';
import { seedHomeServices } from './seed-home-services';
import { seedThirdEdition } from './seed-third-edition';
import { seedCourierPlatform } from './seed-couriers';
import { seedIncidents } from './seed-incidents';
import { seedLockers } from './seed-lockers';
import { seedRequestShowcase, seedTomorrow } from './seed-tomorrow';
import { seedShowcase } from './seed-showcase';
import { seedAroundReports } from './seed-around';

/**
 * Demo data for local development and the hackathon demo. Everything here is
 * invented: the people, homes, shops and sponsor. The named township and its
 * Gerak paths use the real City of Elmina and public park paths; no demo home
 * represents a real resident or property record. Money and points are created
 * through the same services the app uses, so the ledger stays consistent.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;

// A small fixed-seed generator, so the demo looks the same every time.
let seed = 20261111;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;

async function main() {
  const config = getConfig();
  if (config.APP_ENV === 'production') throw new Error('Refusing to seed demo data when APP_ENV=production.');
  const db = await getDb();
  const password = process.env.SEED_DEMO_PASSWORD ?? randomBytes(9).toString('base64url');
  if (password.length < 10) throw new Error('SEED_DEMO_PASSWORD must be at least 10 characters.');
  const passwordHash = await hashPassword(password);
  const now = new Date();

  if (await one(db, 'SELECT 1 FROM townships LIMIT 1')) {
    // An existing demo database: add only what the third edition's features need, and touch nothing else.
    console.log('The database already has data. Adding any missing third-edition demo data only.\n');
    await seedThirdEdition(db, { passwordHash, now, log: (line) => console.log(`  ${line}`) });
    await seedHomeServices(db, { passwordHash, now, log: (line) => console.log(`  ${line}`) });
    await seedTomorrow(db, { now, log: (line) => console.log(`  ${line}`) });
    await seedRequestShowcase(db, { now, log: (line) => console.log(`  ${line}`) });
    await seedLockers(db, { passwordHash, now, log: (line) => console.log(`  ${line}`) });
    await seedCourierPlatform(db, { passwordHash, now, log: (line) => console.log(`  ${line}`) });
    await seedIncidents(db, { passwordHash, now, log: (line) => console.log(`  ${line}`) });
    await seedShowcase(db, { now, log: (line) => console.log(`  ${line}`) });
    await seedAroundReports(db, { now, log: (line) => console.log(`  ${line}`) });
    const check = await runFloatCheck(db, null, now);
    console.log(`\n  Float check: ${check.ok ? 'OK' : `FAILED: ${check.issues.join(' ')}`}`);
    if (!process.env.SEED_DEMO_PASSWORD) console.log(`  A new account (if any was added) uses the password: ${password}`);
    return db.close();
  }
  const daysAgo = (days: number, hour = 4) => new Date(Math.floor(now.getTime() / DAY) * DAY - days * DAY + hour * 3_600_000);

  // --- Township, zones, homes -------------------------------------------------
  const township = (await one<{ id: string }>(db, `INSERT INTO townships (name) VALUES ('City of Elmina (demo data)') RETURNING id`))!.id;
  const zones: Record<string, string> = {};
  for (const [name, route, point] of [
    // Areas follow City of Elmina's own precincts. The routes and assembly points are demo plans.
    ['Elmina Valley 1 & 2', 'Leave by Persiaran Metafasa, away from Sungai Subang. Keep off the riverside paths.', 'Persiaran Metafasa at Jalan Metafasa U16/156'],
    ['Elmina Valley 3, 4 & 5', 'Leave by Persiaran Elektron towards Persiaran Elmina. Keep off the Central Park riverside paths.', 'SJK (T) Ladang Rasak field'],
    ['Elmina Gardens', 'Leave by Jalan Frekuensi U16/110 towards Persiaran Atmosfera. Keep off the lake path by Sungai Subang.', 'Surau Elmina Gardens car park'],
    ['Elmina West', 'Leave by Persiaran Casuarina towards Persiaran Elmina.', 'Pangsapuri Harmoni Elmina car park'],
  ] as const) {
    zones[name] = (await one<{ id: string }>(db, 'INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, $2, $3, $4) RETURNING id', [township, name, route, point]))!.id;
  }
  // Real City of Elmina streets and precincts (Seksyen U16 Elmina East and U17 Elmina West, 40160 Shah Alam),
  // as mapped in OpenStreetMap and used in property listings. The house numbers and the people are invented.
  const POSTAL = { postcode: '40160', city: 'Shah Alam', state: 'Selangor' };
  const insertHome = async (ref: string, zone: string, a: { street: string; precinct: string; houseNo: string; building?: string }) =>
    (await one<{ id: string }>(
      db,
      `INSERT INTO homes (township_id, zone_id, unit_code, street, precinct, house_no, building, property_type, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [township, zones[zone], ref, a.street, a.precinct, a.houseNo, a.building ?? null, a.building ? 'HIGHRISE' : 'LANDED', POSTAL.postcode, POSTAL.city, POSTAL.state],
    ))!.id;
  const streets = [
    ['Jalan Metafasa U16/171', 'Elmina Valley 1', 'EV1', 'Elmina Valley 1 & 2'],
    ['Jalan Metafasa U16/161', 'Elmina Valley 2', 'EV2', 'Elmina Valley 1 & 2'],
    ['Jalan Metafasa U16/1N', 'Elmina Valley 3', 'EV3', 'Elmina Valley 3, 4 & 5'],
    ['Jalan Frekuensi U16/115', 'Elmina Gardens', 'EG', 'Elmina Gardens'],
  ] as const;
  const homes: Record<string, string> = {};
  for (const [street, precinct, prefix, zone] of streets) {
    for (let n = 1; n <= 8; n++) {
      // The property-record reference staff match against, such as EV1-03; the address residents see is "No. 3, ...".
      const ref = `${prefix}-${String(n).padStart(2, '0')}`;
      homes[ref] = await insertHome(ref, zone, { street, precinct, houseNo: String(n) });
    }
  }
  // A few flats in Pangsapuri Harmoni Elmina, Sime Darby Property's affordable homes in Elmina West,
  // to show block-floor-unit addresses.
  for (const floor of [1, 2, 3]) {
    for (const unit of [1, 2]) {
      const houseNo = `A-${String(floor).padStart(2, '0')}-${String(unit).padStart(2, '0')}`;
      homes[`HM-${houseNo}`] = await insertHome(`HM-${houseNo}`, 'Elmina West', { street: 'Jalan Casuarina U17/56', precinct: 'Elmina West', houseNo, building: 'Pangsapuri Harmoni Elmina, Block A' });
    }
  }

  // --- People -------------------------------------------------------------------
  // Every demo account has the required details and has accepted the current Terms, except where noted.
  let phoneSerial = 0;
  const demoPhone = () => `+6012300${String(++phoneSerial).padStart(4, '0')}`;
  const user = async (role: Role, name: string, login: string, fields: Record<string, unknown> = {}): Promise<Actor> => {
    const values: Record<string, unknown> = {
      email: `${login}@${DOMAIN}`, password_hash: passwordHash, full_name: name, role, phone: demoPhone(), terms_version: LEGAL.version, terms_accepted_at: now, ...fields,
    };
    const keys = Object.keys(values);
    const row = await one<Parameters<typeof toActor>[0]>(
      db,
      `INSERT INTO users AS u (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${ACTOR_COLUMNS}`,
      Object.values(values),
    );
    return toActor(row!);
  };
  const resident = async (name: string, login: string, unit: string, status = 'VERIFIED', occupancy = 'OWNER', extra: Record<string, unknown> = {}) => {
    const actor = await user('RESIDENT', name, login, {
      township_id: township, home_id: homes[unit], occupancy, residency_status: status, member_code: randomCode(8), ...extra,
    });
    await createAccount(db, 'WALLET', { userId: actor.id });
    return actor;
  };

  const admin = await user('TOWNSHIP_ADMIN', 'Nurul Huda', 'admin', { township_id: township });
  const admin2 = await user('TOWNSHIP_ADMIN', 'Jason Lee', 'admin2', { township_id: township });
  const staff = await user('TOWNSHIP_STAFF', 'Ravi Kumar', 'staff', { township_id: township });
  await user('HQ_ADMIN', 'Farah Aziz', 'hq');

  const aisyah = await resident('Aisyah Rahman', 'aisyah', 'EV1-01');
  const neighbours = [
    await resident('Daniel Tan', 'daniel', 'EV1-02'),
    await resident('Priya Nair', 'priya', 'EV1-05'),
    await resident('Hafiz Ismail', 'hafiz', 'EV2-01'),
    await resident('Lim Mei Ling', 'meiling', 'EV2-04'),
    await resident('Siti Aminah', 'siti', 'EV3-02'),
    await resident('Arjun Singh', 'arjun', 'EV3-06'),
    await resident('Wong Kar Yan', 'karyan', 'EG-03'),
    await resident('Zainab Yusof', 'zainab', 'EG-07'),
  ];
  const everyone = [aisyah, ...neighbours];
  await resident('Imran Hakim', 'imran', 'EV1-01', 'PENDING', 'TENANT'); // waits for Aisyah, the owner, to confirm him
  // Waits for township staff. Registered before phone numbers were required, so she is asked to add one.
  await resident('Grace Chong', 'grace', 'HM-A-02-01', 'PENDING', 'OWNER', { phone: null });

  // --- Shops and a sponsor ------------------------------------------------------
  const shop = async (name: string, reg: string, category: string, login: string, contact: string, approve = true, poolSen = 0, shopNo = '1') => {
    const id = (await one<{ id: string }>(
      db,
      `INSERT INTO merchants (township_id, name, registration_no, category, address_line, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [township, name, reg, category, `No. ${shopNo}, Jalan Eserina AB U16/AB, Elmina East`, POSTAL.postcode, POSTAL.city, POSTAL.state],
    ))!.id;
    if (approve) await setMerchantStatus(db, admin, id, 'ACTIVE', daysAgo(21));
    if (poolSen) await recordMerchantDeposit(db, admin, id, { amountSen: poolSen, bankRef: `DEMO-${reg}` }, daysAgo(20));
    return user('MERCHANT', contact, login, { township_id: township, merchant_id: id });
  };
  const kafe = await shop('Kafe Seri Pagi', 'DEMO-0001', 'Food & drink', 'kafe', 'Lim Wei (Kafe Seri Pagi)', true, 50_000, '3');
  const kedai = await shop('Kedai Runcit Mesra', 'DEMO-0002', 'Groceries', 'kedai', 'Aminah Salleh (Kedai Runcit Mesra)', true, 30_000, '7');
  await shop('Bengkel Basikal Roda', 'DEMO-0003', 'Bicycle repair', 'bengkel', 'Kumar (Bengkel Basikal Roda)', false, 0, '12');

  const sponsorId = (await one<{ id: string }>(db, `INSERT INTO sponsors (name) VALUES ('Solar Cerah (demo sponsor)') RETURNING id`))!.id;
  await user('SPONSOR', 'Tan Hui Min (Solar Cerah)', 'sponsor', { sponsor_id: sponsorId });
  await recordCommunityDeposit(db, admin, { amountSen: 20_000, bankRef: 'DEMO-SDP-COMMUNITY' }, daysAgo(20));

  // --- Campaigns ----------------------------------------------------------------
  const monthEnd = new Date(now.getTime() + 21 * DAY);
  const kitarCampaign = await createCampaign(db, staff, {
    sponsorId, title: 'Kitar Challenge', description: 'Recycle at any township kiosk this month and earn 300 points. One reward per resident.',
    activity: 'KITAR_DROPOFF', goalMetric: 'COUNT', goalTarget: 1, rewardPoints: 300, perPersonCap: 1,
    budgetSen: 200_000, poolBps: 6000, feeBps: 2500, costsBps: 1500, startsAt: daysAgo(15), endsAt: monthEnd,
  });
  await fundCampaign(db, admin, kitarCampaign.id, 'DEMO-SPONSOR-KITAR', daysAgo(15));
  const gerakCampaign = await createCampaign(db, staff, {
    sponsorId: null, title: 'Green Mobility Challenge', description: 'Walk or cycle 10 km of township loops this month and earn 200 points.',
    activity: 'GERAK_LOOP', goalMetric: 'QUANTITY', goalTarget: 10_000, rewardPoints: 200, perPersonCap: 1,
    budgetSen: 50_000, poolBps: 10_000, feeBps: 0, costsBps: 0, startsAt: daysAgo(15), endsAt: monthEnd,
  });
  await fundCampaign(db, admin, gerakCampaign.id, 'DEMO-SDP-GERAK', daysAgo(15));
  await createCampaign(db, staff, {
    sponsorId, title: 'Good Neighbour Month', description: 'Help three neighbours through the Jiran help board and earn 150 points.',
    activity: 'JIRAN_HELP', goalMetric: 'COUNT', goalTarget: 3, rewardPoints: 150, perPersonCap: 1,
    budgetSen: 100_000, poolBps: 6000, feeBps: 2500, costsBps: 1500, startsAt: now, endsAt: new Date(now.getTime() + 45 * DAY),
  });

  // --- Kitar kiosks, Gerak loops ------------------------------------------------
  await createKiosk(db, staff, { name: 'Kiosk Elmina Valley', location: 'Elmina Valley Central Park car park' });
  await createKiosk(db, staff, { name: 'Kiosk Elmina Gardens', location: 'Beside Surau Elmina Gardens' });
  const kiosks = await db.query<{ code: string }>('SELECT code FROM kitar_kiosks ORDER BY name');
  await createLoop(db, staff, { name: 'Elmina Central Park Walk', description: 'A public walking route through Elmina Central Park and Elmina Gardens.', mode: 'WALK', distanceM: 2_400, checkpoints: ['Central Park entrance', 'Elmina Gardens turn'] });
  const loops = (await listLoopsForStaff(db, staff)) as unknown as { name: string; checkpoints: { code: string }[] }[];

  // --- Two weeks of township life -----------------------------------------------
  const materials = ['PLASTIC_PET', 'PAPER', 'ALUMINIUM', 'GLASS', 'E_WASTE'] as const;
  for (let day = 14; day >= 0; day--) {
    // "Today" is the last few hours, never the future.
    const at = (hour: number) => (day === 0 ? new Date(now.getTime() - (9 - hour) * 20 * 60_000) : daysAgo(day, hour));
    for (const person of everyone) {
      if (random() < 0.55) {
        const cashier = random() < 0.6 ? kafe : kedai;
        const bill = (8 + Math.floor(random() * 60)) * 100;
        await createSale(db, cashier, { memberCode: person.memberCode!, billSen: bill, redeemPoints: 0, idempotencyKey: randomUUID() }, at(5));
      }
      if (random() < 0.3) {
        await recordDropOff(db, person, { kioskCode: pick(kiosks).code, material: pick([...materials]), weightG: 200 + Math.floor(random() * 2_300) }, at(2)).catch(() => undefined);
      }
      if (random() < 0.25) {
        for (const cp of pick(loops).checkpoints) await checkIn(db, person, cp.code, at(1)).catch(() => undefined);
      }
    }
  }
  // Aisyah, the demo resident: a drop-off inside the sponsored challenge, then a café visit.
  await recordDropOff(db, aisyah, { kioskCode: kiosks[0]!.code, material: 'PLASTIC_PET', weightG: 350 }, daysAgo(2, 1)).catch(() => undefined);
  await createSale(db, kafe, { memberCode: aisyah.memberCode!, billSen: 4_500, redeemPoints: 0, idempotencyKey: randomUUID() }, daysAgo(1, 5));
  // A neighbour spends points at the grocer, so last week's statement has something on it.
  const spender = neighbours[0]!;
  const balance = (await one<{ balance: number }>(db, `SELECT balance FROM ledger_accounts WHERE user_id = $1 AND kind = 'WALLET'`, [spender.id]))!.balance;
  if (balance >= 300) {
    const pending = await createSale(db, kedai, { memberCode: spender.memberCode!, billSen: 2_000, redeemPoints: 300, idempotencyKey: randomUUID() }, daysAgo(9, 6));
    await decideSale(db, spender, pending.id, true, daysAgo(9, 6));
  }
  await runSettlement(db, admin.id, daysAgo(7, 9));

  // --- Jiran and Kongsi -----------------------------------------------------------
  const gotongRoyong = await createPost(db, staff, { type: 'EVENT', title: 'Gotong-royong at the park', body: 'Bring gloves and a water bottle. Breakfast is on the township.', location: 'Elmina Central Park entrance', startsAt: new Date(now.getTime() + 4 * DAY), capacity: 60 }, now);
  await createPost(db, neighbours[2]!, { type: 'EVENT', title: 'Sunday badminton, all levels', body: 'Friendly doubles. Spare rackets available.', location: 'Community hall court', startsAt: new Date(now.getTime() + 6 * DAY), capacity: 12 }, now);
  for (const person of [neighbours[0]!, neighbours[1]!, neighbours[4]!]) await respondToPost(db, person, gotongRoyong.id, now);
  const favour = await createPost(db, neighbours[3]!, { type: 'HELP', title: 'Help moving a bookshelf', body: 'One flight of stairs. Ten minutes with two people.', location: 'Jalan Metafasa U16/161' }, now);
  await respondToPost(db, neighbours[2]!, favour.id, now);
  await acceptResponse(db, neighbours[3]!, favour.id, neighbours[2]!.id, {}, daysAgo(4));
  await confirmResponse(db, neighbours[3]!, favour.id, neighbours[2]!.id, daysAgo(3));
  await createPost(db, neighbours[6]!, { type: 'HELP', title: 'Can someone water my plants next week?', body: 'Away from Monday to Friday. A few pots on the porch.', location: 'Jalan Frekuensi U16/115' }, now);
  const stroller = await createPost(db, neighbours[4]!, { type: 'GIVE', title: 'Baby stroller, good condition', body: 'Our youngest has outgrown it. Free to a township family.', location: 'Jalan Metafasa U16/1N' }, now);
  await respondToPost(db, neighbours[1]!, stroller.id, now);
  await acceptResponse(db, neighbours[4]!, stroller.id, neighbours[1]!.id, {}, daysAgo(6));
  await confirmResponse(db, neighbours[4]!, stroller.id, neighbours[1]!.id, daysAgo(5));
  const drill = await createPost(db, neighbours[5]!, { type: 'LEND', title: 'Cordless drill to borrow', body: 'Comes with a set of bits. Please return within three days.', location: 'Jalan Metafasa U16/1N' }, now);
  // The drill is out on loan right now, due back in two days.
  await respondToPost(db, neighbours[0]!, drill.id, now);
  await acceptResponse(db, neighbours[5]!, drill.id, neighbours[0]!.id, { dueBack: new Date(now.getTime() + 2 * DAY).toISOString().slice(0, 10) }, now);
  await confirmResponse(db, neighbours[5]!, drill.id, neighbours[0]!.id, now);
  await createPost(db, neighbours[7]!, { type: 'GIVE', title: 'Box of children’s story books', body: 'About 20 books, ages 4 to 8, English and Bahasa Malaysia.', location: 'Jalan Frekuensi U16/115' }, now);

  // --- Lapor ----------------------------------------------------------------------
  const report = (by: Actor, description: string, locationText: string, zone: string, at: Date) =>
    createReport(db, by, { description, locationText, zoneId: zones[zone] }, at);
  const r1 = await report(neighbours[0]!, 'Lampu jalan tidak menyala sejak tiga malam', 'Jalan Metafasa U16/171, near No. 4', 'Elmina Valley 1 & 2', daysAgo(6));
  await updateReport(db, staff, r1.id, { status: 'RESOLVED', staffNote: 'Bulb replaced by the contractor.' }, daysAgo(4));
  const r2 = await report(neighbours[4]!, 'Longkang tersumbat, air bertakung selepas hujan', 'Back lane behind Jalan Metafasa U16/1N', 'Elmina Valley 3, 4 & 5', daysAgo(3));
  await updateReport(db, staff, r2.id, { status: 'IN_PROGRESS', staffNote: 'Drain clearing booked for Thursday.' }, daysAgo(2));
  await report(neighbours[6]!, 'Motorcycles parked across the wheelchair ramp at the surau', 'Surau Elmina Gardens entrance', 'Elmina Gardens', daysAgo(1));
  await report(neighbours[3]!, 'Pothole on the bend, getting bigger', 'Persiaran Metafasa, before SJK (T) Ladang Rasak', 'Elmina Valley 3, 4 & 5', daysAgo(1, 7));
  await report(aisyah, 'Rubbish left beside the recycling kiosk', 'Kiosk Elmina Valley, Elmina Valley Central Park', 'Elmina Valley 1 & 2', daysAgo(0, 1));

  // --- Banjir: a calm day ---------------------------------------------------------------
  await recordLevel(db, { zoneId: zones['Elmina Valley 1 & 2']!, levelPct: 42, actor: staff }, now);
  await recordLevel(db, { zoneId: zones['Elmina Valley 3, 4 & 5']!, levelPct: 18, actor: staff }, now);
  await recordLevel(db, { zoneId: zones['Elmina Gardens']!, levelPct: 9, actor: staff }, now);
  await recordLevel(db, { zoneId: zones['Elmina West']!, levelPct: 6, actor: staff }, now);

  // --- Third edition: Tamu, Shop Offers, the smart machine, map tracking and Akses+ -------------
  await seedThirdEdition(db, { passwordHash, now, log: () => undefined });
  await seedHomeServices(db, { passwordHash, now, log: () => undefined });
  await seedTomorrow(db, { now, log: () => undefined });
  await seedRequestShowcase(db, { now, log: () => undefined });
  await seedLockers(db, { passwordHash, now, log: () => undefined });
  await seedCourierPlatform(db, { passwordHash, now, log: () => undefined });
  await seedIncidents(db, { passwordHash, now, log: () => undefined });
  await seedShowcase(db, { now, log: () => undefined });
  await seedAroundReports(db, { now, log: () => undefined });

  const check = await runFloatCheck(db, admin2.id, now);
  if (!check.ok) throw new Error(`Seed left the float out of balance: ${check.issues.join(' ')}`);

  const rows = [
    ['Resident', `aisyah@${DOMAIN}`, 'the main demo account; owner of No. 1, Jalan Metafasa U16/171, Elmina Valley 1'],
    ['Resident (not yet confirmed)', `grace@${DOMAIN}`, 'A-02-01, Pangsapuri Harmoni Elmina; asked to add a phone number'],
    ['Resident', `daniel@${DOMAIN}`, 'a neighbour'],
    ['Shop', `kafe@${DOMAIN}`, 'Kafe Seri Pagi'],
    ['Shop', `kedai@${DOMAIN}`, 'Kedai Runcit Mesra'],
    ['Shop (not yet approved)', `bengkel@${DOMAIN}`, 'Bengkel Basikal Roda'],
    ['Home services', `plumber@${DOMAIN}`, 'Elmina Plumbing Co. (workers Ahmad and Lim)'],
    ['Home services', `aircon@${DOMAIN}`, 'Sejuk Aircon Services'],
    ['Shop and home services', `kemas@${DOMAIN}`, 'Kemas Home Care'],
    ['Guard', `guard@${DOMAIN}`, 'the main gate: visitor passes, walk-ins, SOS, patrol'],
    ['Courier', `courier@${DOMAIN}`, 'Faizal, J&T Express (simulated): managed by J&T, delivers to the smart lockers'],
    ['Courier', `hairul@${DOMAIN}`, 'Hairul, J&T Express (simulated)'],
    ['Courier', `nurul@${DOMAIN}`, 'Nurul Ain, Ninja Van (simulated)'],
    ['Courier (suspended)', `courier2@${DOMAIN}`, 'Ahmad Zaki: suspended by Ninja Van, cannot deliver'],
    ['Courier company manager', `jnt-manager@${DOMAIN}`, 'Kavitha, J&T Express: adds and suspends J&T couriers'],
    ['Courier company manager', `ninjavan-manager@${DOMAIN}`, 'Tan Wei Ming, Ninja Van'],
    ['Sponsor', `sponsor@${DOMAIN}`, 'Solar Cerah (demo sponsor)'],
    ['Township staff', `staff@${DOMAIN}`, 'Ravi Kumar: takes and investigates cases'],
    ['Township staff', `staff2@${DOMAIN}`, 'Mei Chen: a second person to hand cases to'],
    ['Township admin', `admin@${DOMAIN}`, ''],
    ['Township admin (second approver)', `admin2@${DOMAIN}`, ''],
    ['SDP HQ admin', `hq@${DOMAIN}`, ''],
  ];
  console.log('\nDemo data created. Float check: OK.\n');
  for (const [role, email, note] of rows) console.log(`  ${role!.padEnd(34)} ${email!.padEnd(28)} ${note}`);
  console.log(`\n  Password for every demo account: ${password}`);
  console.log(`  Aisyah's member code: ${aisyah.memberCode}`);
  console.log('  Kiosk and checkpoint codes are shown in the SDP console (Kitar & Gerak).\n');
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
