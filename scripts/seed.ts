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
import { confirmResponse, createPost, respondToPost } from '../src/server/modules/community/service';
import { recordLevel } from '../src/server/modules/banjir/service';
import { checkIn, createLoop, listLoopsForStaff } from '../src/server/modules/gerak/service';
import { randomCode } from '../src/server/modules/identity/service';
import { submitReading } from '../src/server/modules/jimat/service';
import { createKiosk, recordDropOff } from '../src/server/modules/kitar/service';
import { createAccount } from '../src/server/modules/ledger/ledger';
import { recordCommunityDeposit, recordMerchantDeposit, runFloatCheck, runSettlement } from '../src/server/modules/ledger/finance';
import { setMerchantStatus } from '../src/server/modules/merchant/admin';
import { createSale, decideSale } from '../src/server/modules/merchant/service';
import { createReport, updateReport } from '../src/server/modules/reports/service';
import { seedThirdEdition } from './seed-third-edition';

/**
 * Demo data for local development and the hackathon demo. Everything here is
 * invented: the township, the people, the shops and the sponsor. Money and
 * points are created through the same services the app uses, so the ledger
 * and the float are consistent from the first screen.
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
    const check = await runFloatCheck(db, null, now);
    console.log(`\n  Float check: ${check.ok ? 'OK' : `FAILED: ${check.issues.join(' ')}`}`);
    if (!process.env.SEED_DEMO_PASSWORD) console.log(`  A new account (if any was added) uses the password: ${password}`);
    return db.close();
  }
  const daysAgo = (days: number, hour = 4) => new Date(Math.floor(now.getTime() / DAY) * DAY - days * DAY + hour * 3_600_000);

  // --- Township, zones, homes -------------------------------------------------
  const township = (await one<{ id: string }>(db, `INSERT INTO townships (name) VALUES ('Taman KITA (demo township)') RETURNING id`))!.id;
  const zones: Record<string, string> = {};
  for (const [name, route, point] of [
    ['Zone A · Lakeside', 'Leave by Jalan Kenanga towards the main gate. Avoid the lake road.', 'Community hall, Level 1'],
    ['Zone B · Central', 'Walk up Jalan Melur to the school field.', 'Primary school field'],
    ['Zone C · Hillside', 'Stay on high ground along Jalan Teratai.', 'Hillside surau car park'],
  ] as const) {
    zones[name] = (await one<{ id: string }>(db, 'INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, $2, $3, $4) RETURNING id', [township, name, route, point]))!.id;
  }
  // Addresses follow the pattern of SDP townships (house, street with its area code, precinct, postcode,
  // city, state), but every street, precinct and building here is invented.
  const POSTAL = { postcode: '41050', city: 'Klang', state: 'Selangor' };
  const insertHome = async (ref: string, zone: string, a: { street: string; precinct: string; houseNo: string; building?: string }) =>
    (await one<{ id: string }>(
      db,
      `INSERT INTO homes (township_id, zone_id, unit_code, street, precinct, house_no, building, property_type, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [township, zones[zone], ref, a.street, a.precinct, a.houseNo, a.building ?? null, a.building ? 'HIGHRISE' : 'LANDED', POSTAL.postcode, POSTAL.city, POSTAL.state],
    ))!.id;
  const streets = [
    ['Jalan Kenanga 1/KT1', 'Precinct Kenanga', 'KN', 'Zone A · Lakeside'],
    ['Jalan Melur 2/KT2', 'Precinct Melur', 'ML', 'Zone B · Central'],
    ['Jalan Cempaka 2/KT3', 'Precinct Melur', 'CP', 'Zone B · Central'],
    ['Jalan Teratai 3/KT4', 'Precinct Teratai', 'TR', 'Zone C · Hillside'],
  ] as const;
  const homes: Record<string, string> = {};
  for (const [street, precinct, prefix, zone] of streets) {
    for (let n = 1; n <= 8; n++) {
      // The property-record reference staff match against, such as KN-03; the address residents see is "No. 3, ...".
      const ref = `${prefix}-${String(n).padStart(2, '0')}`;
      homes[ref] = await insertHome(ref, zone, { street, precinct, houseNo: String(n) });
    }
  }
  // A small high-rise block, to show block-floor-unit addresses.
  for (const floor of [1, 2, 3]) {
    for (const unit of [1, 2]) {
      const houseNo = `A-${String(floor).padStart(2, '0')}-${String(unit).padStart(2, '0')}`;
      homes[`RK-${houseNo}`] = await insertHome(`RK-${houseNo}`, 'Zone B · Central', { street: 'Jalan Melur 2/KT2', precinct: 'Precinct Melur', houseNo, building: 'Residensi KITA, Block A' });
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

  const aisyah = await resident('Aisyah Rahman', 'aisyah', 'KN-01');
  const neighbours = [
    await resident('Daniel Tan', 'daniel', 'KN-02'),
    await resident('Priya Nair', 'priya', 'KN-05'),
    await resident('Hafiz Ismail', 'hafiz', 'ML-01'),
    await resident('Lim Mei Ling', 'meiling', 'ML-04'),
    await resident('Siti Aminah', 'siti', 'CP-02'),
    await resident('Arjun Singh', 'arjun', 'CP-06'),
    await resident('Wong Kar Yan', 'karyan', 'TR-03'),
    await resident('Zainab Yusof', 'zainab', 'TR-07'),
  ];
  const everyone = [aisyah, ...neighbours];
  await resident('Imran Hakim', 'imran', 'KN-01', 'PENDING', 'TENANT'); // waits for Aisyah, the owner, to confirm him
  // Waits for township staff. Registered before phone numbers were required, so she is asked to add one.
  await resident('Grace Chong', 'grace', 'RK-A-02-01', 'PENDING', 'OWNER', { phone: null });

  // --- Shops and a sponsor ------------------------------------------------------
  const shop = async (name: string, reg: string, category: string, login: string, contact: string, approve = true, poolSen = 0, lot = 'G-01') => {
    const id = (await one<{ id: string }>(
      db,
      `INSERT INTO merchants (township_id, name, registration_no, category, address_line, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [township, name, reg, category, `Lot ${lot}, KITA Square, Jalan Melur 2/KT2`, POSTAL.postcode, POSTAL.city, POSTAL.state],
    ))!.id;
    if (approve) await setMerchantStatus(db, admin, id, 'ACTIVE', daysAgo(21));
    if (poolSen) await recordMerchantDeposit(db, admin, id, { amountSen: poolSen, bankRef: `DEMO-${reg}` }, daysAgo(20));
    return user('MERCHANT', contact, login, { township_id: township, merchant_id: id });
  };
  const kafe = await shop('Kafe Seri Pagi', 'DEMO-0001', 'Food & drink', 'kafe', 'Lim Wei (Kafe Seri Pagi)', true, 50_000, 'G-03');
  const kedai = await shop('Kedai Runcit Mesra', 'DEMO-0002', 'Groceries', 'kedai', 'Aminah Salleh (Kedai Runcit Mesra)', true, 30_000, 'G-07');
  await shop('Bengkel Basikal Roda', 'DEMO-0003', 'Bicycle repair', 'bengkel', 'Kumar (Bengkel Basikal Roda)', false, 0, 'G-12');

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
    sponsorId, title: 'Good Neighbour Month', description: 'Help three neighbours through the Jiran help board and earn 150 points. Waiting for the sponsor’s payment.',
    activity: 'JIRAN_HELP', goalMetric: 'COUNT', goalTarget: 3, rewardPoints: 150, perPersonCap: 1,
    budgetSen: 100_000, poolBps: 6000, feeBps: 2500, costsBps: 1500, startsAt: now, endsAt: new Date(now.getTime() + 45 * DAY),
  });

  // --- Kitar kiosks, Gerak loops ------------------------------------------------
  await createKiosk(db, staff, { name: 'Kiosk Lakeside', location: 'Beside the Lakeside playground' });
  await createKiosk(db, staff, { name: 'Kiosk Central', location: 'Community hall car park' });
  const kiosks = await db.query<{ code: string }>('SELECT code FROM kitar_kiosks ORDER BY name');
  await createLoop(db, staff, { name: 'Lake Loop', description: 'A flat, shaded loop around the lake. Good for families.', mode: 'WALK', distanceM: 2_400, checkpoints: ['Lake gate', 'Boathouse'] });
  await createLoop(db, staff, { name: 'Park Connector Ride', description: 'The cycling lane from Central to Hillside and back.', mode: 'CYCLE', distanceM: 5_200, checkpoints: ['Central plaza', 'Hillside lookout', 'School crossing'] });
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
  const gotongRoyong = await createPost(db, staff, { type: 'EVENT', title: 'Gotong-royong at the lake', body: 'Bring gloves and a water bottle. Breakfast is on the township.', location: 'Lake gate', startsAt: new Date(now.getTime() + 4 * DAY), capacity: 60 });
  await createPost(db, neighbours[2]!, { type: 'EVENT', title: 'Sunday badminton, all levels', body: 'Friendly doubles. Spare rackets available.', location: 'Community hall court', startsAt: new Date(now.getTime() + 6 * DAY), capacity: 12 });
  for (const person of [neighbours[0]!, neighbours[1]!, neighbours[4]!]) await respondToPost(db, person, gotongRoyong.id);
  const favour = await createPost(db, neighbours[3]!, { type: 'HELP', title: 'Help moving a bookshelf', body: 'One flight of stairs. Ten minutes with two people.', location: 'Jalan Melur' });
  await respondToPost(db, neighbours[2]!, favour.id);
  await confirmResponse(db, neighbours[3]!, favour.id, neighbours[2]!.id, daysAgo(3));
  await createPost(db, neighbours[6]!, { type: 'HELP', title: 'Can someone water my plants next week?', body: 'Away from Monday to Friday. A few pots on the porch.', location: 'Jalan Teratai' });
  const stroller = await createPost(db, neighbours[4]!, { type: 'GIVE', title: 'Baby stroller, good condition', body: 'Our youngest has outgrown it. Free to a township family.', location: 'Jalan Cempaka' });
  await respondToPost(db, neighbours[1]!, stroller.id);
  await confirmResponse(db, neighbours[4]!, stroller.id, neighbours[1]!.id, daysAgo(5));
  await createPost(db, neighbours[5]!, { type: 'LEND', title: 'Cordless drill to borrow', body: 'Comes with a set of bits. Please return within three days.', location: 'Jalan Cempaka' });
  await createPost(db, neighbours[7]!, { type: 'GIVE', title: 'Box of children’s story books', body: 'About 20 books, ages 4 to 8, English and Bahasa Malaysia.', location: 'Jalan Teratai' });

  // --- Lapor ----------------------------------------------------------------------
  const report = (by: Actor, description: string, locationText: string, zone: string, at: Date) =>
    createReport(db, by, { description, locationText, zoneId: zones[zone] }, at);
  const r1 = await report(neighbours[0]!, 'Lampu jalan tidak menyala sejak tiga malam', 'Jalan Kenanga, near house KN-04', 'Zone A · Lakeside', daysAgo(6));
  await updateReport(db, staff, r1.id, { status: 'RESOLVED', staffNote: 'Bulb replaced by the contractor.' }, daysAgo(4));
  const r2 = await report(neighbours[4]!, 'Longkang tersumbat, air bertakung selepas hujan', 'Behind Jalan Cempaka shop row', 'Zone B · Central', daysAgo(3));
  await updateReport(db, staff, r2.id, { status: 'IN_PROGRESS', staffNote: 'Drain clearing booked for Thursday.' }, daysAgo(2));
  await report(neighbours[6]!, 'Motorcycles parked across the wheelchair ramp at the surau', 'Hillside surau entrance', 'Zone C · Hillside', daysAgo(1));
  await report(neighbours[3]!, 'Pothole on the bend, getting bigger', 'Jalan Melur, before the school', 'Zone B · Central', daysAgo(1, 7));
  await report(aisyah, 'Rubbish left beside the recycling kiosk', 'Lakeside playground', 'Zone A · Lakeside', daysAgo(0, 1));

  // --- Jimat: last month and the month before, typed in on the 3rd -------------------
  const firstOfMonth = (back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 3, 4));
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  for (const person of [aisyah, neighbours[0]!, neighbours[3]!, neighbours[6]!]) {
    const kwh = 320 + Math.floor(random() * 200);
    const litres = 16_000 + Math.floor(random() * 9_000);
    await submitReading(db, person, { month: monthKey(firstOfMonth(2)), electricityKwh: kwh, waterLitres: litres }, firstOfMonth(1)).catch(() => undefined);
    await submitReading(db, person, { month: monthKey(firstOfMonth(1)), electricityKwh: Math.round(kwh * (0.88 + random() * 0.2)), waterLitres: Math.round(litres * (0.9 + random() * 0.15)) }, firstOfMonth(0)).catch(() => undefined);
  }

  // --- Banjir: a calm day ---------------------------------------------------------------
  await recordLevel(db, { zoneId: zones['Zone A · Lakeside']!, levelPct: 42, actor: staff }, now);
  await recordLevel(db, { zoneId: zones['Zone B · Central']!, levelPct: 18, actor: staff }, now);
  await recordLevel(db, { zoneId: zones['Zone C · Hillside']!, levelPct: 9, actor: staff }, now);

  // --- Third edition: Tamu, Shop Offers, the smart machine, map tracking, Akses+, Taman ---------
  await seedThirdEdition(db, { passwordHash, now, log: () => undefined });

  const check = await runFloatCheck(db, admin2.id, now);
  if (!check.ok) throw new Error(`Seed left the float out of balance: ${check.issues.join(' ')}`);

  const rows = [
    ['Resident', `aisyah@${DOMAIN}`, 'the main demo account; owner of No. 1, Jalan Kenanga 1/KT1'],
    ['Resident (not yet confirmed)', `grace@${DOMAIN}`, 'A-02-01, Residensi KITA; asked to add a phone number'],
    ['Resident', `daniel@${DOMAIN}`, 'a neighbour'],
    ['Shop', `kafe@${DOMAIN}`, 'Kafe Seri Pagi'],
    ['Shop', `kedai@${DOMAIN}`, 'Kedai Runcit Mesra'],
    ['Shop (not yet approved)', `bengkel@${DOMAIN}`, 'Bengkel Basikal Roda'],
    ['Guard', `guard@${DOMAIN}`, 'the main gate: visitor passes, walk-ins, SOS, patrol'],
    ['Sponsor', `sponsor@${DOMAIN}`, 'Solar Cerah (demo sponsor)'],
    ['Township staff', `staff@${DOMAIN}`, ''],
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
