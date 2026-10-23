import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { one, type Db } from '../src/server/db/client';
import {
  acceptBooking, addWorker, confirmCompleted, createBooking, markWorkDone, reviewBooking, saveListing, setMerchantKind, setOwnTrades, setServiceTrades, startVisit, updateServiceAbout,
  type ListingInput,
} from '../src/server/modules/home-services/service';
import { setMerchantStatus } from '../src/server/modules/merchant/admin';
import type { MerchantKind } from '../src/shared/domain';
import { LEGAL } from '../src/shared/legal';

/**
 * Demo data for SimeTown Home Services. Safe to run on a database that already
 * holds the demo township: it is added only if missing, and nothing already there
 * is changed. The companies, workers and reviews are invented. Aisyah's plumbing
 * booking is left for the live demo; the history below gives the companies ratings.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;
const HOUR = 3_600_000;

async function actorByLogin(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

interface Company {
  name: string;
  reg: string;
  login: string;
  contact: string;
  phone: string;
  shopNo: string;
  kind: MerchantKind;
  about: string;
  listings: ListingInput[];
  workers: string[];
}

const COMPANIES: Company[] = [
  {
    name: 'Elmina Plumbing Co.', reg: 'DEMO-HS-0001', login: 'plumber', contact: 'Rosli Hamid (Elmina Plumbing Co.)', phone: '+60124000001', shopNo: '21', kind: 'SERVICES',
    about: 'Family plumbing business serving City of Elmina homes. Leaks, blocked drains, water heaters and bathroom fittings. (Demo company.)',
    listings: [
      { category: 'PLUMBING', description: 'Leaking pipes and taps, blocked sinks and drains, water heater installation and repair.', pricing: 'INSPECTION', calloutFeeSen: 3000, priceNote: 'RM30 inspection, credited to the repair if you go ahead' },
      { category: 'REPAIRS', description: 'Small household repairs: door hinges, cabinet doors, curtain rails and shelves.', pricing: 'INSPECTION', calloutFeeSen: 3000, priceNote: 'RM30 call-out; the repair is quoted on the spot' },
    ],
    workers: ['Ahmad Faizal', 'Lim Chee Keong'],
  },
  {
    name: 'Sejuk Aircon Services', reg: 'DEMO-HS-0002', login: 'aircon', contact: 'Tan Mei Ling (Sejuk Aircon Services)', phone: '+60124000002', shopNo: '23', kind: 'SERVICES',
    about: 'Air-conditioner servicing, gas top-up and repairs for landed homes and apartments. (Demo company.)',
    listings: [
      { category: 'AIRCON', description: 'Standard service (clean filters, coil and drain) for wall-mounted units. Gas top-up and repairs quoted separately.', pricing: 'FIXED', calloutFeeSen: null, priceNote: 'RM80 per unit for a standard service; extra work quoted first' },
      { category: 'ELECTRICAL', description: 'Sockets, lights, fans and circuit breakers, by a registered electrician.', pricing: 'INSPECTION', calloutFeeSen: 4000, priceNote: 'RM40 inspection; repair quoted before work starts' },
    ],
    workers: ['Suresh Nair', 'Mohd Hafiz'],
  },
  {
    name: 'Kemas Home Care', reg: 'DEMO-HS-0003', login: 'kemas', contact: 'Nurul Huda (Kemas Home Care)', phone: '+60124000003', shopNo: '25', kind: 'BOTH',
    about: 'A cleaning-supplies shop that also sends trained cleaners to your home. Gives and accepts SimeTown points in the shop. (Demo company.)',
    listings: [
      { category: 'CLEANING', description: 'Home cleaning by the hour, move-in and move-out cleaning, and sofa or mattress shampoo.', pricing: 'FIXED', calloutFeeSen: null, priceNote: 'RM35 an hour, 3 hours minimum' },
      { category: 'RENOVATION', description: 'Painting and minor renovation that follows the township renovation rules.', pricing: 'QUOTE', calloutFeeSen: null, priceNote: 'Free site visit and written quotation' },
    ],
    workers: ['Siti Rahmah', 'Grace Wong'],
  },
];

export async function seedHomeServices(db: Db, input: { passwordHash: string; now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const township = await one<{ id: string; timezone: string }>(
    db,
    `SELECT t.id, s.timezone FROM townships t CROSS JOIN program_settings s WHERE t.name IN ('City of Elmina (demo data)', 'Taman KITA (demo township)', 'Taman SimeTown (demo township)') LIMIT 1`,
  );
  if (!township) return log('No demo township found; the home services demo data needs the main seed first.');
  if (await one(db, `SELECT 1 FROM merchants WHERE registration_no = $1`, [COMPANIES[0]!.reg])) return log('Home services demo data is already there.');
  const [admin, ...residents] = await Promise.all(['admin', 'aisyah', 'daniel', 'priya', 'hafiz', 'meiling'].map((login) => actorByLogin(db, login)));
  const [aisyah, daniel, priya, hafiz, meiling] = residents;
  if (!admin || !aisyah || !daniel || !priya || !hafiz || !meiling) return log('Some demo accounts are missing; the home services demo data was not added.');

  const companies: { actor: Actor; listings: string[]; workers: string[] }[] = [];
  for (const c of COMPANIES) {
    const merchant = await one<{ id: string }>(
      db,
      `INSERT INTO merchants (township_id, name, registration_no, category, address_line, postcode, city, state)
       VALUES ($1, $2, $3, $4, $5, '40160', 'Shah Alam', 'Selangor') RETURNING id`,
      [township.id, c.name, c.reg, c.kind === 'BOTH' ? 'Cleaning supplies and home cleaning' : 'Home services', `No. ${c.shopNo}, Jalan Eserina AB U16/AB, Elmina East`],
    );
    await setMerchantStatus(db, admin, merchant!.id, 'ACTIVE', new Date(now.getTime() - 200 * DAY));
    await setMerchantKind(db, admin, merchant!.id, c.kind);
    await setServiceTrades(db, admin, merchant!.id, c.listings.map((l) => l.category), now);
    const row = await one<Parameters<typeof toActor>[0]>(
      db,
      `INSERT INTO users AS u (email, password_hash, full_name, phone, role, township_id, merchant_id, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, $4, 'MERCHANT', $5, $6, $7, $8) RETURNING ${ACTOR_COLUMNS}`,
      [`${c.login}@${DOMAIN}`, input.passwordHash, c.contact, c.phone, township.id, merchant!.id, LEGAL.version, now],
    );
    const actor = toActor(row!);
    await updateServiceAbout(db, actor, c.about);
    const listings = [];
    for (const l of c.listings) listings.push((await saveListing(db, actor, l, now)).id);
    const workers = [];
    for (const name of c.workers) workers.push((await addWorker(db, actor, { fullName: name })).id);
    companies.push({ actor, listings, workers });
  }

  // A licence check waiting for staff: the plumber asks to take electrical jobs too.
  await setOwnTrades(db, companies[0]!.actor, { trades: [...COMPANIES[0]!.listings.map((l) => l.category), 'ELECTRICAL'], licence: 'ST-PW2-DEMO-0101' }, now);

  // Finished jobs from the past few weeks, each confirmed by the resident and reviewed.
  const history: [Actor, number, number, number, number, string, string][] = [
    // resident, company, listing, worker, days ago, problem, review
    [daniel, 0, 0, 0, 24, 'Water heater in the main bathroom trips the breaker.', '5|Explained the problem clearly and fixed it the same day.'],
    [priya, 0, 0, 1, 17, 'Kitchen sink drains very slowly.', '4|Good work. Arrived a little late but called ahead.'],
    [hafiz, 0, 1, 0, 9, 'Two cabinet doors in the kitchen are hanging loose.', '5|Quick and tidy.'],
    // 165 days ago, so the home logbook shows Aisyah's aircon as due soon (every 180 days).
    [aisyah, 1, 0, 0, 165, 'Living room air-conditioner leaks water onto the wall.', '5|Suresh cleaned the drain pipe and showed me what was blocked.'],
    [meiling, 1, 0, 1, 12, 'Annual service for two bedroom units.', '4|Fair price, as listed.'],
    [daniel, 2, 0, 0, 6, 'Move-in clean for a three-bedroom terrace.', '5|Very thorough. Will book again.'],
  ];
  for (const [resident, ci, li, wi, daysAgo, problem, review] of history) {
    const company = companies[ci]!;
    const t = new Date(now.getTime() - daysAgo * DAY);
    const preferredDate = new Intl.DateTimeFormat('en-CA', { timeZone: township.timezone }).format(new Date(t.getTime() + DAY));
    const { id } = await createBooking(db, resident, { listingId: company.listings[li]!, problem, preferredDate, preferredSlot: 'MORNING' }, t);
    const visit = new Date(t.getTime() + DAY + 2 * HOUR);
    await acceptBooking(db, company.actor, id, { scheduledAt: visit, workerId: company.workers[wi] }, new Date(t.getTime() + HOUR));
    await startVisit(db, company.actor, id, visit);
    await markWorkDone(db, company.actor, id, undefined, new Date(visit.getTime() + 2 * HOUR));
    await confirmCompleted(db, resident, id, new Date(visit.getTime() + 3 * HOUR));
    const [rating, comment] = review.split('|');
    await reviewBooking(db, resident, id, { rating: Number(rating), comment }, new Date(visit.getTime() + 4 * HOUR));
  }
  log('Home services: 3 demo companies (plumber@, aircon@, kemas@), their workers and past reviewed jobs.');
}
