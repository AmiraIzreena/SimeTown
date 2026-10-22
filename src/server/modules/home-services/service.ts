import {
  formatAddress, OPEN_BOOKING_STATUSES, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, SERVICE_DUE_SOON_DAYS, SERVICE_REMINDER_DAYS,
  type BookingStatus, type HomeAddress, type MerchantKind, type ServiceCategory, type ServicePricing, type ServiceReportCategory,
  type ServiceReportStatus, type ServiceSlot,
} from '@/shared/domain';
import type { Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { createPass, insertPass } from '../tamu/service';
import { HOME_ADDRESS_COLUMNS } from '../townships';

/**
 * SimeTown Home Services. A resident picks a township service company and asks
 * for a visit; the company accepts with a time and assigns one of its registered
 * workers, so the resident knows who is coming before they arrive. The price is
 * agreed in person after inspection: no money moves through SimeTown and nothing
 * here touches the points ledger. Only the resident can confirm a job is done.
 * Reviews need a completed booking; reports are private to the resident and
 * township staff, and are tied to the booking and the worker assigned.
 */

const MAX_OPEN_BOOKINGS_PER_HOME = 5;
const MAX_REPORTS_PER_BOOKING = 3;
const BOOK_AHEAD_DAYS = 60;
/** While a visit is arranged, the company needs the resident's address and phone. Not before, not after. */
const CONTACT_STATUSES: readonly BookingStatus[] = ['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE'];
const RESIDENT_CANCELLABLE: readonly BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'];
const MERCHANT_CANCELLABLE: readonly BookingStatus[] = ['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS'];
const RESIDENT_CONFIRMABLE: readonly BookingStatus[] = ['IN_PROGRESS', 'WORK_DONE'];
const PASS_STATUSES: readonly BookingStatus[] = ['SCHEDULED', 'IN_PROGRESS'];

const isStaff = (actor: Actor) => actor.role === 'TOWNSHIP_STAFF' || actor.role === 'TOWNSHIP_ADMIN' || actor.role === 'HQ_ADMIN';

/** Companies see a first name and an initial, never a resident's full name. */
function shortName(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0]}.` : first!;
}

/** Today's date in the township's timezone, as YYYY-MM-DD. */
const localDate = (date: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function merchantUserIds(q: Queryable, merchantId: string): Promise<string[]> {
  return (await q.query<{ id: string }>(`SELECT id FROM users WHERE merchant_id = $1 AND status = 'ACTIVE'`, [merchantId])).map((u) => u.id);
}

async function logEvent(
  q: Queryable,
  bookingId: string,
  actorId: string | null,
  e: { kind: 'STATUS' | 'WORKER' | 'PASS'; from?: BookingStatus | null; to?: BookingStatus | null; workerId?: string | null; workerName?: string | null; note?: string | null },
  now: Date,
) {
  await q.query(
    `INSERT INTO service_booking_events (booking_id, actor_user_id, kind, from_status, to_status, worker_id, worker_name, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [bookingId, actorId, e.kind, e.from ?? null, e.to ?? null, e.workerId ?? null, e.workerName ?? null, e.note ?? null, now],
  );
}

/** A Tamu pass for a visit stops working when the visit is cancelled or the worker changes. */
async function cancelVisitPass(q: Queryable, passId: string | null) {
  if (passId) await q.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = $1 AND status = 'ACTIVE'`, [passId]);
}

/** A contractor pass covers the visit: from two hours before (or now) until ten hours after. */
function visitPassWindow(scheduledAt: Date, now: Date) {
  const visit = scheduledAt.getTime();
  const validFrom = new Date(Math.max(now.getTime(), visit - 2 * 3_600_000));
  const validUntil = new Date(Math.max(visit, validFrom.getTime()) + 10 * 3_600_000);
  return { validFrom, validUntil };
}

/**
 * The resident asked the company to come, so the gate pass for the assigned worker is
 * made automatically, in the same transaction that sets the worker. The household is
 * the host; the company sees the code in its bookings. Returns the gate code.
 */
async function issueVisitPass(
  tx: Queryable,
  b: { id: string; township_id: string; home_id: string; resident_id: string; merchant_name: string; scheduled_at: Date },
  workerName: string,
  now: Date,
): Promise<string> {
  const pass = await insertPass(
    tx,
    { townshipId: b.township_id, homeId: b.home_id, hostUserId: b.resident_id, type: 'CONTRACTOR', visitorName: `${workerName} (${b.merchant_name})`.slice(0, 80), ...visitPassWindow(b.scheduled_at, now) },
    now,
  );
  await tx.query('UPDATE service_bookings SET pass_id = $2 WHERE id = $1', [b.id, pass.id]);
  await logEvent(tx, b.id, null, { kind: 'PASS', note: pass.code }, now);
  return pass.code;
}

const bookingLink = (id: string) => `/app/home-services?booking=${id}`;
const merchantBookingLink = (id: string) => `/merchant/bookings?booking=${id}`;

// ---------------------------------------------------------------------------
// The company's side: set-up
// ---------------------------------------------------------------------------

interface ServiceMerchant {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  township_id: string;
  offers_retail: boolean;
  offers_services: boolean;
  service_about: string | null;
}

/** The signed-in business, which must offer home services. Approval is checked by the actions that need it. */
async function serviceMerchant(q: Queryable, actor: Actor, opts: { active?: boolean; lock?: boolean } = {}): Promise<ServiceMerchant> {
  if (actor.role !== 'MERCHANT' || !actor.merchantId) throw forbidden();
  const m = await one<ServiceMerchant>(
    q,
    `SELECT id, name, status, township_id, offers_retail, offers_services, service_about FROM merchants WHERE id = $1${opts.lock ? ' FOR UPDATE' : ''}`,
    [actor.merchantId],
  );
  if (!m) throw notFound('Business');
  if (!m.offers_services) throw forbidden('Home services are not switched on for this business. Ask the township office.');
  if (opts.active && m.status !== 'ACTIVE') throw forbidden('This business has not been approved yet.');
  return m;
}

/** What the company has set up: its description, listings and workers. */
export async function serviceSetup(db: Db, actor: Actor) {
  const m = await serviceMerchant(db, actor);
  const [listings, workers] = await Promise.all([
    db.query(
      `SELECT id, category, description, pricing, callout_fee_sen, price_note, active, updated_at
         FROM service_listings WHERE merchant_id = $1 ORDER BY active DESC, category`,
      [m.id],
    ),
    db.query(
      `SELECT w.id, w.full_name, w.phone, w.active, w.created_at,
              (SELECT count(*)::int FROM service_bookings b WHERE b.worker_id = w.id AND b.status IN ('SCHEDULED', 'IN_PROGRESS')) AS open_jobs,
              (SELECT count(*)::int FROM service_bookings b WHERE b.worker_id = w.id AND b.status = 'COMPLETED') AS completed_jobs
         FROM service_workers w WHERE w.merchant_id = $1 ORDER BY w.active DESC, w.full_name`,
      [m.id],
    ),
  ]);
  return { merchant: { name: m.name, status: m.status, about: m.service_about, offersRetail: m.offers_retail }, listings, workers };
}

export async function updateServiceAbout(db: Db, actor: Actor, about: string) {
  const m = await serviceMerchant(db, actor);
  await db.query('UPDATE merchants SET service_about = $2 WHERE id = $1', [m.id, about || null]);
  return { ok: true };
}

export interface ListingInput {
  category: ServiceCategory;
  description: string;
  pricing: ServicePricing;
  calloutFeeSen: number | null;
  priceNote: string;
}

/** One listing per category: saving a category the company already lists updates it. */
export async function saveListing(db: Db, actor: Actor, input: ListingInput, now: Date) {
  const m = await serviceMerchant(db, actor);
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO service_listings (merchant_id, category, description, pricing, callout_fee_sen, price_note, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)
     ON CONFLICT (merchant_id, category) DO UPDATE
       SET description = EXCLUDED.description, pricing = EXCLUDED.pricing, callout_fee_sen = EXCLUDED.callout_fee_sen,
           price_note = EXCLUDED.price_note, active = true, updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [m.id, input.category, input.description, input.pricing, input.calloutFeeSen, input.priceNote, now],
  );
  return { id: row!.id };
}

/** Hiding a listing stops new bookings; bookings already made carry on. */
export async function setListingActive(db: Db, actor: Actor, listingId: string, active: boolean, now: Date) {
  const m = await serviceMerchant(db, actor);
  const rows = await db.query('UPDATE service_listings SET active = $3, updated_at = $4 WHERE id = $1 AND merchant_id = $2 RETURNING id', [listingId, m.id, active, now]);
  if (rows.length === 0) throw notFound('Listing');
  return { ok: true };
}

export async function addWorker(db: Db, actor: Actor, input: { fullName: string; phone?: string | null }) {
  const m = await serviceMerchant(db, actor);
  const count = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM service_workers WHERE merchant_id = $1 AND active', [m.id]);
  if (count!.n >= 200) throw ruleViolation('TOO_MANY_WORKERS', 'This business already has 200 active workers.');
  const row = await one<{ id: string }>(db, 'INSERT INTO service_workers (merchant_id, full_name, phone) VALUES ($1, $2, $3) RETURNING id', [m.id, input.fullName, input.phone ?? null]);
  return { id: row!.id };
}

/** A worker on a visit that has not finished must be replaced on it first. */
export async function setWorkerActive(db: Db, actor: Actor, workerId: string, active: boolean) {
  const m = await serviceMerchant(db, actor);
  return db.tx(async (tx) => {
    const worker = await one(tx, 'SELECT id FROM service_workers WHERE id = $1 AND merchant_id = $2 FOR UPDATE', [workerId, m.id]);
    if (!worker) throw notFound('Worker');
    if (!active && (await one(tx, `SELECT 1 FROM service_bookings WHERE worker_id = $1 AND status IN ('SCHEDULED', 'IN_PROGRESS')`, [workerId]))) {
      throw conflict('WORKER_BUSY', 'This worker is assigned to a visit that has not finished. Assign someone else to it first.');
    }
    await tx.query('UPDATE service_workers SET active = $2 WHERE id = $1', [workerId, active]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// The resident's side: finding a company
// ---------------------------------------------------------------------------

const PROVIDER_FILTER = `m.township_id = $1 AND m.status = 'ACTIVE' AND m.offers_services AND l.active`;

/** Each category with the number of companies offering it in the resident's township. */
export async function listCategories(db: Db, actor: Actor) {
  const townshipId = townshipOf(actor);
  const rows = await db.query<{ category: ServiceCategory; providers: number }>(
    `SELECT l.category, count(*)::int AS providers FROM service_listings l JOIN merchants m ON m.id = l.merchant_id
      WHERE ${PROVIDER_FILTER} GROUP BY l.category`,
    [townshipId],
  );
  const counts = new Map(rows.map((r) => [r.category, r.providers]));
  return SERVICE_CATEGORIES.map((category) => ({ category, providers: counts.get(category) ?? 0 }));
}

const RATINGS = `
  LEFT JOIN LATERAL (SELECT round(avg(rv.rating), 1)::float8 AS rating, count(*)::int AS reviews FROM service_reviews rv WHERE rv.merchant_id = m.id) r ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS jobs FROM service_bookings jb WHERE jb.merchant_id = m.id AND jb.status = 'COMPLETED') j ON true`;

/** Companies offering a category, best rated first, with their pricing disclosed up front. */
export async function listProviders(db: Db, actor: Actor, category: ServiceCategory) {
  const townshipId = townshipOf(actor);
  return db.query(
    `SELECT m.id AS merchant_id, m.name, m.service_about AS about, l.id AS listing_id, l.category, l.description, l.pricing,
            l.callout_fee_sen, l.price_note, r.rating, coalesce(r.reviews, 0) AS reviews, coalesce(j.jobs, 0) AS completed_jobs
       FROM service_listings l JOIN merchants m ON m.id = l.merchant_id ${RATINGS}
      WHERE ${PROVIDER_FILTER} AND l.category = $2
      ORDER BY r.rating DESC NULLS LAST, j.jobs DESC NULLS LAST, m.name`,
    [townshipId, category],
  );
}

/** A company's profile: what it offers and its reviews, each from a completed booking. */
export async function getProvider(db: Db, actor: Actor, merchantId: string) {
  const townshipId = townshipOf(actor);
  const merchant = await one<{ id: string; name: string; about: string | null; rating: number | null; reviews: number; completed_jobs: number; address: string | null }>(
    db,
    `SELECT m.id, m.name, m.service_about AS about, r.rating, coalesce(r.reviews, 0) AS reviews, coalesce(j.jobs, 0) AS completed_jobs,
            concat_ws(', ', m.address_line, concat_ws(' ', m.postcode, m.city)) AS address
       FROM merchants m ${RATINGS}
      WHERE m.id = $2 AND m.township_id = $1 AND m.status = 'ACTIVE' AND m.offers_services`,
    [townshipId, merchantId],
  );
  if (!merchant) throw notFound('Company');
  const [listings, reviews] = await Promise.all([
    db.query(
      `SELECT id, category, description, pricing, callout_fee_sen, price_note FROM service_listings WHERE merchant_id = $1 AND active ORDER BY category`,
      [merchantId],
    ),
    db.query<{ rating: number; comment: string | null; created_at: Date; full_name: string; category: ServiceCategory }>(
      `SELECT rv.rating, rv.comment, rv.created_at, u.full_name, l.category
         FROM service_reviews rv JOIN users u ON u.id = rv.resident_id
         JOIN service_bookings b ON b.id = rv.booking_id JOIN service_listings l ON l.id = b.listing_id
        WHERE rv.merchant_id = $1 ORDER BY rv.created_at DESC LIMIT 20`,
      [merchantId],
    ),
  ]);
  return {
    ...merchant,
    listings,
    reviews: reviews.map(({ full_name, ...rest }) => ({ ...rest, reviewer: shortName(full_name) })),
  };
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface BookingInput {
  listingId: string;
  problem: string;
  preferredDate: string;
  preferredSlot: ServiceSlot;
  photo?: Photo;
}

export async function createBooking(db: Db, actor: Actor, input: BookingInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  const { timezone } = await getSettings(db);
  const today = localDate(now, timezone);
  if (input.preferredDate < today) throw ruleViolation('BOOKING_DATE', 'Choose today or a later date.');
  if (input.preferredDate > addDays(today, BOOK_AHEAD_DAYS)) throw ruleViolation('BOOKING_DATE', `You can book up to ${BOOK_AHEAD_DAYS} days ahead.`);

  return db.tx(async (tx) => {
    // One booking at a time per home, so the limits below hold under a double tap.
    await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [resident.homeId]);
    const listing = await one<{ id: string; merchant_id: string; merchant_name: string; category: ServiceCategory }>(
      tx,
      `SELECT l.id, l.merchant_id, m.name AS merchant_name, l.category FROM service_listings l JOIN merchants m ON m.id = l.merchant_id
        WHERE l.id = $2 AND ${PROVIDER_FILTER}`,
      [resident.townshipId, input.listingId],
    );
    if (!listing) throw notFound('Service');
    const open = await tx.query<{ listing_id: string }>(
      `SELECT listing_id FROM service_bookings WHERE home_id = $1 AND status = ANY($2::text[])`,
      [resident.homeId, OPEN_BOOKING_STATUSES],
    );
    if (open.some((b) => b.listing_id === listing.id)) {
      throw conflict('ALREADY_BOOKED', 'Your home already has an open booking with this company for this service.');
    }
    if (open.length >= MAX_OPEN_BOOKINGS_PER_HOME) {
      throw ruleViolation('TOO_MANY_BOOKINGS', `Your home has ${MAX_OPEN_BOOKINGS_PER_HOME} open bookings. Finish or cancel one first.`);
    }
    let photoId: string | null = null;
    if (input.photo) {
      const upload = await one<{ id: string }>(tx, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [
        resident.id, input.photo.mime, input.photo.bytes.length, Buffer.from(input.photo.bytes),
      ]);
      photoId = upload!.id;
    }
    const booking = await one<{ id: string }>(
      tx,
      `INSERT INTO service_bookings (township_id, merchant_id, listing_id, resident_id, home_id, problem, photo_id, preferred_date, preferred_slot, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [resident.townshipId, listing.merchant_id, listing.id, resident.id, resident.homeId, input.problem, photoId, input.preferredDate, input.preferredSlot, now],
    );
    await logEvent(tx, booking!.id, resident.id, { kind: 'STATUS', to: 'REQUESTED' }, now);
    await notify(tx, await merchantUserIds(tx, listing.merchant_id), {
      title: 'New booking request',
      body: `A resident has requested ${SERVICE_CATEGORY_LABELS[listing.category].toLowerCase()}. Please accept or decline the request.`,
      link: merchantBookingLink(booking!.id),
    });
    return { id: booking!.id };
  });
}

interface BookingRow {
  id: string;
  township_id: string;
  merchant_id: string;
  resident_id: string;
  home_id: string;
  worker_id: string | null;
  status: BookingStatus;
  scheduled_at: Date | null;
  pass_id: string | null;
  merchant_name: string;
  category: ServiceCategory;
  worker_name: string | null;
}

const BOOKING_LOCK = `
  SELECT b.id, b.township_id, b.merchant_id, b.resident_id, b.home_id, b.worker_id, b.status, b.scheduled_at, b.pass_id,
         m.name AS merchant_name, l.category, w.full_name AS worker_name
    FROM service_bookings b JOIN merchants m ON m.id = b.merchant_id JOIN service_listings l ON l.id = b.listing_id
    LEFT JOIN service_workers w ON w.id = b.worker_id`;

/** The resident's own booking, locked for a change. Someone else's is "not found", the same as a missing one. */
async function lockResidentBooking(tx: Queryable, actor: Actor, id: string): Promise<BookingRow> {
  const resident = requireVerifiedResident(actor);
  const b = await one<BookingRow>(tx, `${BOOKING_LOCK} WHERE b.id = $1 AND b.resident_id = $2 FOR UPDATE OF b`, [id, resident.id]);
  if (!b) throw notFound('Booking');
  return b;
}

async function lockMerchantBooking(tx: Queryable, actor: Actor, id: string): Promise<BookingRow> {
  await serviceMerchant(tx, actor, { active: true });
  const b = await one<BookingRow>(tx, `${BOOKING_LOCK} WHERE b.id = $1 AND b.merchant_id = $2 FOR UPDATE OF b`, [id, actor.merchantId]);
  if (!b) throw notFound('Booking');
  return b;
}

function requireStatus(b: BookingRow, allowed: readonly BookingStatus[], message: string) {
  if (!allowed.includes(b.status)) throw conflict('BOOKING_STATE', message);
}

const DETAIL_SELECT = `
  SELECT b.id, b.status, b.problem, b.photo_id IS NOT NULL AS has_photo, b.preferred_date, b.preferred_slot, b.scheduled_at,
         b.provider_note, b.closed_reason, b.created_at, b.updated_at, b.completed_at, b.merchant_id, b.resident_id, b.township_id,
         b.worker_id, b.pass_id, m.name AS merchant_name, l.category, l.pricing, l.callout_fee_sen, l.price_note,
         w.full_name AS worker_name, u.full_name AS resident_name, u.phone AS resident_phone, ${HOME_ADDRESS_COLUMNS},
         p.code AS pass_code, p.valid_from AS pass_valid_from, p.valid_until AS pass_valid_until,
         (p.status = 'ACTIVE' AND p.valid_until > $2) AS pass_live,
         rv.rating AS review_rating, rv.comment AS review_comment, rv.created_at AS reviewed_at
    FROM service_bookings b
    JOIN merchants m ON m.id = b.merchant_id JOIN service_listings l ON l.id = b.listing_id
    JOIN users u ON u.id = b.resident_id JOIN homes h ON h.id = b.home_id
    LEFT JOIN service_workers w ON w.id = b.worker_id
    LEFT JOIN visitor_passes p ON p.id = b.pass_id
    LEFT JOIN service_reviews rv ON rv.booking_id = b.id`;

type DetailRow = HomeAddress & {
  id: string;
  status: BookingStatus;
  problem: string;
  has_photo: boolean;
  preferred_date: string;
  preferred_slot: ServiceSlot;
  scheduled_at: Date | null;
  provider_note: string | null;
  closed_reason: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  merchant_id: string;
  resident_id: string;
  township_id: string;
  worker_id: string | null;
  pass_id: string | null;
  merchant_name: string;
  category: ServiceCategory;
  pricing: ServicePricing;
  callout_fee_sen: number | null;
  price_note: string;
  worker_name: string | null;
  resident_name: string;
  resident_phone: string | null;
  pass_code: string | null;
  pass_valid_from: Date | null;
  pass_valid_until: Date | null;
  pass_live: boolean | null;
  review_rating: number | null;
  review_comment: string | null;
  reviewed_at: Date | null;
};

async function events(q: Queryable, bookingId: string) {
  return q.query<{ kind: string; from_status: BookingStatus | null; to_status: BookingStatus | null; worker_name: string | null; note: string | null; created_at: Date; actor: 'RESIDENT' | 'COMPANY' | 'STAFF' | 'SYSTEM' }>(
    `SELECT e.kind, e.from_status, e.to_status, e.worker_name, e.note, e.created_at,
            CASE WHEN e.actor_user_id IS NULL THEN 'SYSTEM' WHEN u.role = 'RESIDENT' THEN 'RESIDENT' WHEN u.role = 'MERCHANT' THEN 'COMPANY' ELSE 'STAFF' END AS actor
       FROM service_booking_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.booking_id = $1 ORDER BY e.id`,
    [bookingId],
  );
}

const view = (r: DetailRow) => ({
  id: r.id,
  status: r.status,
  category: r.category,
  merchantId: r.merchant_id,
  merchantName: r.merchant_name,
  pricing: r.pricing,
  calloutFeeSen: r.callout_fee_sen,
  priceNote: r.price_note,
  problem: r.problem,
  hasPhoto: r.has_photo,
  preferredDate: r.preferred_date,
  preferredSlot: r.preferred_slot,
  scheduledAt: r.scheduled_at,
  providerNote: r.provider_note,
  closedReason: r.closed_reason,
  worker: r.worker_id ? { id: r.worker_id, name: r.worker_name! } : null,
  review: r.review_rating !== null ? { rating: r.review_rating, comment: r.review_comment, createdAt: r.reviewed_at } : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

/** The resident's bookings, open ones first. */
export async function listMyBookings(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<DetailRow>(
    `${DETAIL_SELECT} WHERE b.resident_id = $1
      ORDER BY (b.status = ANY($3::text[])) DESC, b.updated_at DESC LIMIT 50`,
    [resident.id, now, OPEN_BOOKING_STATUSES],
  );
  return rows.map(view);
}

/**
 * The home logbook: every job confirmed at this home, by anyone registered there
 * now or before, and when a recurring service is due again. It belongs to the home,
 * so an air-conditioner serviced by the previous owner still counts. Only the
 * resident who booked a job sees their own problem text and rating.
 */
export async function homeLogbook(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<{
    id: string; category: ServiceCategory; completed_at: Date; merchant_id: string; merchant_name: string; worker_name: string | null;
    provider_note: string | null; problem: string; resident_id: string; rating: number | null;
    listing_id: string; listed: boolean; pricing: ServicePricing; callout_fee_sen: number | null; price_note: string;
  }>(
    `SELECT b.id, l.category, b.completed_at, m.id AS merchant_id, m.name AS merchant_name, w.full_name AS worker_name, b.provider_note,
            b.problem, b.resident_id, rv.rating, l.id AS listing_id, (${PROVIDER_FILTER}) AS listed, l.pricing, l.callout_fee_sen, l.price_note
       FROM service_bookings b JOIN service_listings l ON l.id = b.listing_id JOIN merchants m ON m.id = b.merchant_id
       LEFT JOIN service_workers w ON w.id = b.worker_id LEFT JOIN service_reviews rv ON rv.booking_id = b.id
      WHERE b.home_id = $2 AND b.status = 'COMPLETED'
      ORDER BY b.completed_at DESC LIMIT 100`,
    [resident.townshipId, resident.homeId],
  );
  // "Book again" only for a company and service residents can still book.
  const rebook = (r: (typeof rows)[number]) =>
    r.listed ? { listingId: r.listing_id, merchantName: r.merchant_name, category: r.category, pricing: r.pricing, calloutFeeSen: r.callout_fee_sen, priceNote: r.price_note } : null;
  const entries = rows.map((r) => ({
    id: r.id,
    category: r.category,
    completedAt: r.completed_at,
    merchantName: r.merchant_name,
    workerName: r.worker_name,
    providerNote: r.provider_note,
    mine: r.resident_id === resident.id,
    problem: r.resident_id === resident.id ? r.problem : null,
    rating: r.resident_id === resident.id ? r.rating : null,
    rebook: rebook(r),
  }));

  const open = await db.query<{ category: ServiceCategory }>(
    `SELECT DISTINCT l.category FROM service_bookings b JOIN service_listings l ON l.id = b.listing_id WHERE b.home_id = $1 AND b.status = ANY($2::text[])`,
    [resident.homeId, OPEN_BOOKING_STATUSES],
  );
  const booked = new Set(open.map((o) => o.category));
  const reminders = [];
  for (const [category, days] of Object.entries(SERVICE_REMINDER_DAYS) as [ServiceCategory, number][]) {
    const last = rows.find((r) => r.category === category); // rows are newest first
    if (!last) continue;
    const dueAt = new Date(last.completed_at.getTime() + days * 86_400_000);
    const daysLeft = Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
    reminders.push({
      category,
      lastAt: last.completed_at,
      dueAt,
      daysLeft,
      state: booked.has(category) ? ('BOOKED' as const) : daysLeft < 0 ? ('OVERDUE' as const) : daysLeft <= SERVICE_DUE_SOON_DAYS ? ('DUE_SOON' as const) : ('OK' as const),
      rebook: rebook(last),
    });
  }
  return { entries, reminders };
}

/** One booking, as the resident sees it: who is coming, the history, and what they can do next. */
export async function getMyBooking(db: Db, actor: Actor, id: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const r = await one<DetailRow>(db, `${DETAIL_SELECT} WHERE b.id = $1 AND b.resident_id = $3`, [id, now, resident.id]);
  if (!r) throw notFound('Booking');
  const [history, reports, phone] = await Promise.all([
    events(db, id),
    db.query(`SELECT id, category, status, created_at FROM service_reports WHERE booking_id = $1 AND resident_id = $2 ORDER BY created_at`, [id, resident.id]),
    CONTACT_STATUSES.includes(r.status)
      ? one<{ phone: string | null }>(db, `SELECT phone FROM users WHERE merchant_id = $1 AND status = 'ACTIVE' AND phone IS NOT NULL ORDER BY created_at LIMIT 1`, [r.merchant_id])
      : undefined,
  ]);
  return {
    ...view(r),
    companyPhone: phone?.phone ?? null,
    pass: r.pass_id && r.pass_live ? { code: r.pass_code!, validFrom: r.pass_valid_from, validUntil: r.pass_valid_until } : null,
    history,
    reports,
    can: {
      cancel: RESIDENT_CANCELLABLE.includes(r.status),
      confirm: RESIDENT_CONFIRMABLE.includes(r.status),
      review: r.status === 'COMPLETED' && r.review_rating === null,
      report: r.scheduled_at !== null && reports.length < MAX_REPORTS_PER_BOOKING,
      sendPass: PASS_STATUSES.includes(r.status) && !(r.pass_id && r.pass_live),
    },
  };
}

export async function cancelByResident(db: Db, actor: Actor, id: string, reason: string | undefined, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockResidentBooking(tx, actor, id);
    requireStatus(b, RESIDENT_CANCELLABLE, 'This booking can no longer be cancelled here. If something went wrong, report it.');
    await tx.query(`UPDATE service_bookings SET status = 'CANCELLED', closed_reason = $2, updated_at = $3 WHERE id = $1`, [id, reason || null, now]);
    await cancelVisitPass(tx, b.pass_id);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: b.status, to: 'CANCELLED', note: reason || null }, now);
    await notify(tx, await merchantUserIds(tx, b.merchant_id), { title: 'Booking cancelled by resident', body: 'The resident has cancelled this booking. No further action is needed.', link: merchantBookingLink(id) });
    return { status: 'CANCELLED' as const };
  });
}

/** Only the resident can say the job is finished, even before the company does. */
export async function confirmCompleted(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockResidentBooking(tx, actor, id);
    requireStatus(b, RESIDENT_CONFIRMABLE, 'You can confirm the job once the worker has visited.');
    await tx.query(`UPDATE service_bookings SET status = 'COMPLETED', completed_at = $2, updated_at = $2 WHERE id = $1`, [id, now]);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: b.status, to: 'COMPLETED' }, now);
    await notify(tx, await merchantUserIds(tx, b.merchant_id), { title: 'Job completed', body: 'The resident has confirmed the job is complete. The booking is now closed.', link: merchantBookingLink(id) });
    return { status: 'COMPLETED' as const };
  });
}

export async function reviewBooking(db: Db, actor: Actor, id: string, input: { rating: number; comment?: string }, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockResidentBooking(tx, actor, id);
    requireStatus(b, ['COMPLETED'], 'You can review a company once you have confirmed the job is done.');
    if (await one(tx, 'SELECT 1 FROM service_reviews WHERE booking_id = $1', [id])) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this booking.');
    await tx.query('INSERT INTO service_reviews (booking_id, merchant_id, resident_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, b.merchant_id, actor.id, input.rating, input.comment || null, now,
    ]);
    await notify(tx, await merchantUserIds(tx, b.merchant_id), { title: 'New review received', body: `A resident rated your service ${input.rating} out of 5.`, link: merchantBookingLink(id) });
    return { ok: true };
  });
}

/**
 * A private report about a booking, tied to the worker assigned at the time.
 * Township staff see it; the company never does.
 */
export async function reportBooking(db: Db, actor: Actor, id: string, input: { category: ServiceReportCategory; description: string }, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockResidentBooking(tx, actor, id);
    if (b.scheduled_at === null) throw conflict('BOOKING_STATE', 'You can report a problem once a company has accepted the booking.');
    const count = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM service_reports WHERE booking_id = $1', [id]);
    if (count!.n >= MAX_REPORTS_PER_BOOKING) throw ruleViolation('TOO_MANY_REPORTS', 'You have already reported this booking. Township staff will contact you.');
    const report = await one<{ id: string }>(
      tx,
      `INSERT INTO service_reports (township_id, booking_id, merchant_id, worker_id, resident_id, category, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [b.township_id, id, b.merchant_id, b.worker_id, actor.id, input.category, input.description, now],
    );
    const urgent = input.category === 'HARASSMENT';
    // Township staff handle every report; HQ is also told about harassment so it is never missed.
    const staff = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'ACTIVE' AND ((township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN')) OR ($2 AND role = 'HQ_ADMIN'))`,
      [b.township_id, urgent],
    );
    await notify(tx, staff.map((s) => s.id), {
      priority: urgent ? 'URGENT' : 'NORMAL',
      title: urgent ? 'Harassment reported during a home service visit' : 'New home service report',
      body: urgent
        ? `A resident has reported harassment involving ${b.merchant_name}. Please contact the resident as soon as possible.`
        : `A resident has reported a problem with ${b.merchant_name}. Please review the report.`,
      link: `/console/home-services?report=${report!.id}`,
    });
    return { id: report!.id };
  });
}

/**
 * A new Tamu contractor pass for the assigned worker, made by the resident. Passes are
 * normally made automatically when the worker is assigned; this is for when that pass
 * was cancelled in Tamu or has run out. The company also sees the pass code for the
 * guardhouse. The pass is cancelled again if the worker changes or the booking is cancelled.
 */
export async function sendGatePass(db: Db, actor: Actor, id: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const b = await one<BookingRow & { pass_live: boolean | null }>(
    db,
    `SELECT x.*, (p.status = 'ACTIVE' AND p.valid_until > $3) AS pass_live FROM (${BOOKING_LOCK} WHERE b.id = $1 AND b.resident_id = $2) x
       LEFT JOIN visitor_passes p ON p.id = x.pass_id`,
    [id, resident.id, now],
  );
  if (!b) throw notFound('Booking');
  requireStatus(b, PASS_STATUSES, 'A gate pass can be sent once the company has assigned a worker.');
  if (b.pass_id && b.pass_live) throw conflict('PASS_SENT', 'A gate pass for this visit is already active.');
  const { validFrom, validUntil } = visitPassWindow(b.scheduled_at!, now);
  const visitorName = `${b.worker_name} (${b.merchant_name})`.slice(0, 80);
  const pass = await createPass(db, resident, { type: 'CONTRACTOR', visitorName, validFrom, validUntil }, now);
  const linked = await db.tx(async (tx) => {
    const rows = await tx.query(
      `UPDATE service_bookings SET pass_id = $3, updated_at = $4 WHERE id = $1 AND resident_id = $2 AND worker_id = $5 AND status = ANY($6::text[])
         AND (pass_id IS NULL OR pass_id = $7) RETURNING id`,
      [id, resident.id, pass.id, now, b.worker_id, PASS_STATUSES, b.pass_id],
    );
    if (rows.length === 0) return false;
    await logEvent(tx, id, resident.id, { kind: 'PASS', note: pass.code }, now);
    await notify(tx, await merchantUserIds(tx, b.merchant_id), {
      title: 'Gate pass received',
      body: `The resident has sent a gate pass for ${b.worker_name}. Pass code: ${pass.code}. Show it to the guard at the main gate.`,
      link: merchantBookingLink(id),
    });
    return true;
  });
  if (!linked) {
    // The booking changed while the pass was made (a new worker, a cancellation): withdraw it.
    await cancelVisitPass(db, pass.id);
    throw conflict('BOOKING_CHANGED', 'The booking changed just now. Please look at it again.');
  }
  return { code: pass.code, token: pass.token, validFrom, validUntil };
}

/** The problem photo: the resident who sent it, the company booked, and township staff. */
export async function bookingPhoto(db: Db, actor: Actor, id: string): Promise<Response> {
  const b = await one<{ photo_id: string | null; resident_id: string; merchant_id: string; township_id: string }>(
    db,
    'SELECT photo_id, resident_id, merchant_id, township_id FROM service_bookings WHERE id = $1',
    [id],
  );
  const allowed =
    b &&
    (actor.role === 'RESIDENT'
      ? b.resident_id === actor.id
      : actor.role === 'MERCHANT'
        ? b.merchant_id === actor.merchantId
        : isStaff(actor) && (actor.role === 'HQ_ADMIN' || b.township_id === actor.townshipId));
  if (!allowed) throw notFound('Booking');
  const upload = b.photo_id ? await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [b.photo_id]) : undefined;
  if (!upload) throw notFound('Photo');
  return new Response(Buffer.from(upload.bytes), {
    headers: { 'Content-Type': upload.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600' },
  });
}

// ---------------------------------------------------------------------------
// The company's side: bookings
// ---------------------------------------------------------------------------

function merchantView(r: DetailRow, now: Date) {
  const contact = CONTACT_STATUSES.includes(r.status);
  return {
    ...view(r),
    // A short name always; the address and phone only while a visit is arranged.
    residentName: shortName(r.resident_name),
    residentPhone: contact ? r.resident_phone : null,
    address: contact ? formatAddress(r) : null,
    passCode: r.pass_id && r.pass_live && contact ? r.pass_code : null,
    passValidUntil: r.pass_id && r.pass_live && contact ? r.pass_valid_until : null,
    overdue: r.status === 'REQUESTED' && r.created_at.getTime() < now.getTime() - 24 * 3_600_000,
  };
}

export async function listMerchantBookings(db: Db, actor: Actor, filter: 'OPEN' | 'CLOSED', now: Date) {
  const m = await serviceMerchant(db, actor);
  const rows = await db.query<DetailRow>(
    `${DETAIL_SELECT} WHERE b.merchant_id = $1 AND (b.status = ANY($3::text[])) = $4
      ORDER BY ${filter === 'OPEN' ? `(b.status = 'REQUESTED') DESC, b.scheduled_at NULLS FIRST, b.created_at` : 'b.updated_at DESC'} LIMIT 100`,
    [m.id, now, OPEN_BOOKING_STATUSES, filter === 'OPEN'],
  );
  return rows.map((r) => merchantView(r, now));
}

export async function getMerchantBooking(db: Db, actor: Actor, id: string, now: Date) {
  const m = await serviceMerchant(db, actor);
  const r = await one<DetailRow>(db, `${DETAIL_SELECT} WHERE b.id = $1 AND b.merchant_id = $3`, [id, now, m.id]);
  if (!r) throw notFound('Booking');
  return { ...merchantView(r, now), history: await events(db, id) };
}

async function activeWorker(q: Queryable, merchantId: string, workerId: string) {
  const w = await one<{ id: string; full_name: string }>(q, 'SELECT id, full_name FROM service_workers WHERE id = $1 AND merchant_id = $2 AND active', [workerId, merchantId]);
  if (!w) throw notFound('Worker');
  return w;
}

function checkVisitTime(scheduledAt: Date, now: Date) {
  if (scheduledAt.getTime() <= now.getTime()) throw ruleViolation('VISIT_TIME', 'Choose a visit time in the future.');
  if (scheduledAt.getTime() > now.getTime() + BOOK_AHEAD_DAYS * 86_400_000) throw ruleViolation('VISIT_TIME', `Choose a visit within ${BOOK_AHEAD_DAYS} days.`);
}

/**
 * The company accepts with a visit time, which may differ from the resident's
 * preference. With a worker named, the booking is scheduled at once.
 */
export async function acceptBooking(db: Db, actor: Actor, id: string, input: { scheduledAt: Date; workerId?: string; note?: string }, now: Date) {
  checkVisitTime(input.scheduledAt, now);
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, ['REQUESTED'], 'This booking has already been answered.');
    const worker = input.workerId ? await activeWorker(tx, b.merchant_id, input.workerId) : null;
    const status: BookingStatus = worker ? 'SCHEDULED' : 'ACCEPTED';
    await tx.query(
      `UPDATE service_bookings SET status = $2, scheduled_at = $3, worker_id = $4, provider_note = $5, updated_at = $6 WHERE id = $1`,
      [id, status, input.scheduledAt, worker?.id ?? null, input.note || null, now],
    );
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: 'REQUESTED', to: 'ACCEPTED', note: input.note || null }, now);
    if (worker) {
      await logEvent(tx, id, actor.id, { kind: 'WORKER', from: 'ACCEPTED', to: 'SCHEDULED', workerId: worker.id, workerName: worker.full_name }, now);
      await issueVisitPass(tx, { ...b, scheduled_at: input.scheduledAt }, worker.full_name, now);
    }
    await notify(tx, [b.resident_id], {
      title: 'Booking accepted',
      body: worker
        ? `${b.merchant_name} has accepted your booking. ${worker.full_name} is assigned to your visit, and their gate pass is ready.`
        : `${b.merchant_name} has accepted your booking and set a visit time. They will tell you who is coming.`,
      link: bookingLink(id),
    });
    return { status };
  });
}

export async function declineBooking(db: Db, actor: Actor, id: string, reason: string, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, ['REQUESTED'], 'This booking has already been answered.');
    await tx.query(`UPDATE service_bookings SET status = 'DECLINED', closed_reason = $2, updated_at = $3 WHERE id = $1`, [id, reason, now]);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: 'REQUESTED', to: 'DECLINED', note: reason }, now);
    await notify(tx, [b.resident_id], { title: 'Booking declined', body: `${b.merchant_name} is unable to take this booking. Please choose another company.`, link: bookingLink(id) });
    return { status: 'DECLINED' as const };
  });
}

/** Assign or change the worker. Any gate pass for the previous worker is withdrawn and a new one made. */
export async function assignWorker(db: Db, actor: Actor, id: string, workerId: string, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, ['ACCEPTED', 'SCHEDULED'], 'The worker can only be set before the visit starts.');
    const worker = await activeWorker(tx, b.merchant_id, workerId);
    if (b.worker_id === worker.id) return { status: b.status };
    const changed = b.worker_id !== null;
    await tx.query(`UPDATE service_bookings SET status = 'SCHEDULED', worker_id = $2, pass_id = NULL, updated_at = $3 WHERE id = $1`, [id, worker.id, now]);
    await cancelVisitPass(tx, b.pass_id);
    await logEvent(tx, id, actor.id, { kind: 'WORKER', from: b.status, to: 'SCHEDULED', workerId: worker.id, workerName: worker.full_name }, now);
    await issueVisitPass(tx, { ...b, scheduled_at: b.scheduled_at! }, worker.full_name, now);
    await notify(tx, [b.resident_id], {
      title: changed ? 'Worker changed' : 'Worker assigned',
      body: changed
        ? `${b.merchant_name} has assigned ${worker.full_name} to your visit instead. Their gate pass is ready, and the previous one has been cancelled.`
        : `${worker.full_name} from ${b.merchant_name} is assigned to your visit. Their gate pass is ready.`,
      link: bookingLink(id),
    });
    return { status: 'SCHEDULED' as const };
  });
}

export async function startVisit(db: Db, actor: Actor, id: string, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, ['SCHEDULED'], 'Assign a worker before starting the visit.');
    await tx.query(`UPDATE service_bookings SET status = 'IN_PROGRESS', updated_at = $2 WHERE id = $1`, [id, now]);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: 'SCHEDULED', to: 'IN_PROGRESS' }, now);
    return { status: 'IN_PROGRESS' as const };
  });
}

/**
 * The company says the work is finished. The booking completes only when the resident confirms.
 * Pressing "Worker has arrived" first is optional, so a short job takes one tap.
 */
export async function markWorkDone(db: Db, actor: Actor, id: string, note: string | undefined, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, ['SCHEDULED', 'IN_PROGRESS'], 'Assign a worker before marking the work done.');
    await tx.query(`UPDATE service_bookings SET status = 'WORK_DONE', provider_note = coalesce($2, provider_note), updated_at = $3 WHERE id = $1`, [id, note || null, now]);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: b.status, to: 'WORK_DONE', note: note || null }, now);
    await notify(tx, [b.resident_id], { title: 'Please confirm the job', body: `${b.merchant_name} has marked the work as finished. Please confirm it is complete, or report a problem.`, link: bookingLink(id) });
    return { status: 'WORK_DONE' as const };
  });
}

export async function cancelByMerchant(db: Db, actor: Actor, id: string, reason: string, now: Date) {
  return db.tx(async (tx) => {
    const b = await lockMerchantBooking(tx, actor, id);
    requireStatus(b, MERCHANT_CANCELLABLE, 'This booking cannot be cancelled now.');
    await tx.query(`UPDATE service_bookings SET status = 'CANCELLED', closed_reason = $2, updated_at = $3 WHERE id = $1`, [id, reason, now]);
    await cancelVisitPass(tx, b.pass_id);
    await logEvent(tx, id, actor.id, { kind: 'STATUS', from: b.status, to: 'CANCELLED', note: reason }, now);
    await notify(tx, [b.resident_id], { title: 'Booking cancelled by company', body: `${b.merchant_name} has cancelled your booking. Reason: ${reason}`, link: bookingLink(id) });
    return { status: 'CANCELLED' as const };
  });
}

// ---------------------------------------------------------------------------
// Township staff: reports and business set-up
// ---------------------------------------------------------------------------

/**
 * The resident's own private reports about home-service visits, open ones first. Companies never see these;
 * staff_note is the township team's last message to the resident, so it is safe to show them.
 * history: each status change and message from the township team, oldest first. It never names the staff
 * member; the resident hears from "the township team".
 */
export async function listMyServiceReports(db: Db, actor: Actor) {
  const resident = requireVerifiedResident(actor);
  return db.query(
    `SELECT r.id, r.booking_id, r.category, r.status, r.description, r.staff_note, r.created_at, r.updated_at,
            m.name AS merchant_name, w.full_name AS worker_name, l.category AS service_category, b.scheduled_at,
            coalesce((SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'to', a.detail->>'to', 'note', a.detail->>'note') ORDER BY a.id)
                        FROM audit_log a
                       WHERE a.entity_type = 'service_report' AND a.entity_id = r.id::text
                         AND a.action IN ('SERVICE_REPORT_STATUS', 'SERVICE_REPORT_NOTE')), '[]'::jsonb) AS history
       FROM service_reports r JOIN merchants m ON m.id = r.merchant_id
       JOIN service_bookings b ON b.id = r.booking_id JOIN service_listings l ON l.id = b.listing_id
       LEFT JOIN service_workers w ON w.id = r.worker_id
      WHERE r.resident_id = $1
      ORDER BY (r.status = 'CLOSED'), r.updated_at DESC LIMIT 100`,
    [resident.id],
  );
}

export async function listServiceReports(db: Db, actor: Actor, status: ServiceReportStatus | undefined) {
  return db.query(
    // handled: the staff member who last changed the report's status, and when (from the audit log).
    `SELECT r.id, r.category, r.status, r.description, r.created_at, r.updated_at, m.name AS merchant_name, w.full_name AS worker_name,
            u.full_name AS resident_name, l.category AS service_category,
            (SELECT jsonb_build_object('by', su.full_name, 'role', su.role, 'at', a.created_at)
               FROM audit_log a JOIN users su ON su.id = a.actor_user_id
              WHERE a.entity_type = 'service_report' AND a.entity_id = r.id::text ORDER BY a.id DESC LIMIT 1) AS handled
       FROM service_reports r JOIN merchants m ON m.id = r.merchant_id JOIN users u ON u.id = r.resident_id
       JOIN service_bookings b ON b.id = r.booking_id JOIN service_listings l ON l.id = b.listing_id
       LEFT JOIN service_workers w ON w.id = r.worker_id
      WHERE ($1::uuid IS NULL OR r.township_id = $1) AND ($2::text IS NULL OR r.status = $2)
      ORDER BY (r.status = 'CLOSED'), (r.category = 'HARASSMENT') DESC, r.created_at DESC LIMIT 100`,
    [actor.role === 'HQ_ADMIN' ? null : townshipOf(actor), status ?? null],
  );
}

/** One report with the booking, its full history of who was assigned when, and the worker's record. */
export async function getServiceReport(db: Db, actor: Actor, id: string, now: Date) {
  const report = await one<{ id: string; township_id: string; booking_id: string; worker_id: string | null; merchant_id: string; category: string; status: string; description: string; staff_note: string | null; created_at: Date; updated_at: Date; worker_name: string | null; worker_phone: string | null }>(
    db,
    `SELECT r.id, r.township_id, r.booking_id, r.worker_id, r.merchant_id, r.category, r.status, r.description, r.staff_note, r.created_at, r.updated_at,
            w.full_name AS worker_name, w.phone AS worker_phone
       FROM service_reports r LEFT JOIN service_workers w ON w.id = r.worker_id WHERE r.id = $1`,
    [id],
  );
  if (!report || (actor.role !== 'HQ_ADMIN' && report.township_id !== actor.townshipId)) throw notFound('Report');
  const booking = await one<DetailRow>(db, `${DETAIL_SELECT} WHERE b.id = $1`, [report.booking_id, now]);
  const [history, workerRecord, companyRecord, companyPhone] = await Promise.all([
    events(db, report.booking_id),
    report.worker_id
      ? one<{ reports: number; jobs: number }>(
          db,
          `SELECT (SELECT count(*)::int FROM service_reports WHERE worker_id = $1) AS reports,
                  (SELECT count(*)::int FROM service_bookings WHERE worker_id = $1 AND status = 'COMPLETED') AS jobs`,
          [report.worker_id],
        )
      : undefined,
    one<{ reports: number; jobs: number }>(
      db,
      `SELECT (SELECT count(*)::int FROM service_reports WHERE merchant_id = $1) AS reports,
              (SELECT count(*)::int FROM service_bookings WHERE merchant_id = $1 AND status = 'COMPLETED') AS jobs`,
      [report.merchant_id],
    ),
    one<{ phone: string | null }>(db, `SELECT phone FROM users WHERE merchant_id = $1 AND status = 'ACTIVE' AND phone IS NOT NULL ORDER BY created_at LIMIT 1`, [report.merchant_id]),
  ]);
  return {
    ...report,
    booking: booking && { ...view(booking), residentName: booking.resident_name, residentPhone: booking.resident_phone, address: formatAddress(booking) },
    history,
    workerPhone: report.worker_phone,
    workerRecord: workerRecord ?? null,
    companyRecord,
    companyPhone: companyPhone?.phone ?? null,
  };
}

export async function updateServiceReport(db: Db, actor: Actor, id: string, input: { status?: ServiceReportStatus; staffNote?: string }, now: Date) {
  return db.tx(async (tx) => {
    const r = await one<{ township_id: string; resident_id: string; status: ServiceReportStatus }>(tx, 'SELECT township_id, resident_id, status FROM service_reports WHERE id = $1 FOR UPDATE', [id]);
    if (!r || (actor.role !== 'HQ_ADMIN' && r.township_id !== actor.townshipId)) throw notFound('Report');
    if (r.status === 'CLOSED' && input.status && input.status !== 'CLOSED') throw conflict('REPORT_CLOSED', 'This report is already closed.');
    const status = input.status ?? r.status;
    await tx.query('UPDATE service_reports SET status = $2, staff_note = coalesce($3, staff_note), updated_at = $4 WHERE id = $1', [id, status, input.staffNote ?? null, now]);
    // Each change and each message is kept, so the resident can follow the report step by step (Lapor).
    if (status !== r.status) await audit(tx, actor.id, 'SERVICE_REPORT_STATUS', 'service_report', id, { from: r.status, to: status, ...(input.staffNote ? { note: input.staffNote } : {}) });
    else if (input.staffNote) await audit(tx, actor.id, 'SERVICE_REPORT_NOTE', 'service_report', id, { note: input.staffNote });
    // A new note is news to the resident too, even when the status stays the same.
    if (status !== r.status || input.staffNote) {
      await notify(tx, [r.resident_id], {
        title: status === 'CLOSED' ? 'Your home service report is closed' : status === r.status ? 'Update on your home service report' : 'Your home service report is under review',
        body: input.staffNote ?? 'The township team has updated your report.',
        link: `/app/lapor?tab=home&report=${id}`, // opens this report, expanded
      });
    }
    return { status };
  });
}

/**
 * The township office decides what a business account offers. Services cannot be
 * switched off while it has open bookings, nor the shop while an offer is live.
 */
export async function setMerchantKind(db: Db, actor: Actor, merchantId: string, kind: MerchantKind) {
  const offersRetail = kind !== 'SERVICES';
  const offersServices = kind !== 'RETAIL';
  return db.tx(async (tx) => {
    const m = await one<{ township_id: string; offers_retail: boolean; offers_services: boolean }>(
      tx,
      'SELECT township_id, offers_retail, offers_services FROM merchants WHERE id = $1 FOR UPDATE',
      [merchantId],
    );
    if (!m) throw notFound('Business');
    assertTownshipAccess(actor, m.township_id);
    if (m.offers_services && !offersServices && (await one(tx, `SELECT 1 FROM service_bookings WHERE merchant_id = $1 AND status = ANY($2::text[])`, [merchantId, OPEN_BOOKING_STATUSES]))) {
      throw conflict('OPEN_BOOKINGS', 'This business still has open bookings. They must finish first.');
    }
    if (m.offers_retail && !offersRetail && (await one(tx, `SELECT 1 FROM shop_offers WHERE merchant_id = $1 AND status = 'ACTIVE'`, [merchantId]))) {
      throw conflict('LIVE_OFFER', 'This shop has a live Shop Offer. It must end first.');
    }
    await tx.query('UPDATE merchants SET offers_retail = $2, offers_services = $3 WHERE id = $1', [merchantId, offersRetail, offersServices]);
    await audit(tx, actor.id, 'MERCHANT_KIND', 'merchant', merchantId, { kind });
    return { kind };
  });
}
