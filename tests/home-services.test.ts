import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import * as home from '@/server/modules/home-services/service';
import { applyAsMerchant, setMerchantStatus } from '@/server/modules/merchant/admin';
import { listActiveMerchants } from '@/server/modules/merchant/service';
import { T0, at, freshDb, makeHome, makeMerchant, makeResident, makeWorld, sell, type World } from './helpers';

/**
 * SimeTown Home Services: the booking flow from request to review, who may see
 * and do what, the private reports, and the Tamu contractor pass.
 */

let db: Db;
let w: World;
const ORIGIN = 'http://kita.test';
let handle: (req: Request) => Promise<Response>;

const HOUR = 3_600_000;
const visitAt = new Date(T0.getTime() + 4 * 24 * HOUR); // Friday, 12pm in Kuala Lumpur
const tomorrow = '2026-11-03';

/** A business approved for home services (and, optionally, as a shop too). */
async function makeServiceCompany(kind: 'SERVICES' | 'BOTH' = 'SERVICES') {
  const merchant = await makeMerchant(w);
  await home.setMerchantKind(db, w.admin, merchant.merchantId!, kind);
  const listing = await home.saveListing(db, merchant, { category: 'PLUMBING', description: 'Leaks, blocked drains and water heaters.', pricing: 'INSPECTION', calloutFeeSen: 3000, priceNote: 'RM30 inspection, credited to the repair' }, T0);
  const worker = await home.addWorker(db, merchant, { fullName: 'Ahmad Faizal' });
  const worker2 = await home.addWorker(db, merchant, { fullName: 'Ravi Kumar' });
  return { merchant, listingId: listing.id, workerId: worker.id, worker2Id: worker2.id };
}

const book = (resident: Actor, listingId: string, extra: Partial<home.BookingInput> = {}) =>
  home.createBooking(db, resident, { listingId, problem: 'Kitchen sink is leaking underneath.', preferredDate: tomorrow, preferredSlot: 'MORNING', ...extra }, T0);

async function call(method: string, path: string, as: Actor, body?: unknown) {
  const headers = new Headers({ cookie: `kita_session=${await createSession(db, as.id, T0)}` });
  if (method !== 'GET') headers.set('origin', ORIGIN);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: payload }));
  const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { data?: any; error?: { code: string } }) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: json?.data, error: json?.error, res };
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());

describe('the booking flow (Aisyah and the plumber)', () => {
  it('goes from request to a confirmed, reviewed job, with the worker known before arrival', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const aisyah = await makeResident(w);

    const providers = await home.listProviders(db, aisyah, 'PLUMBING');
    expect(providers.map((p) => p.listing_id)).toContain(listingId);
    expect(providers.find((p) => p.listing_id === listingId)).toMatchObject({ callout_fee_sen: 3000, pricing: 'INSPECTION' });

    const { id } = await book(aisyah, listingId);

    // Before accepting, the company sees a short name and nothing that locates the home.
    const request = await home.getMerchantBooking(db, merchant, id, T0);
    expect(request.status).toBe('REQUESTED');
    expect(request.address).toBeNull();
    expect(request.residentPhone).toBeNull();
    expect(request.residentName).not.toBe(aisyah.fullName);

    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt, note: 'Bring the sink key' }, T0);
    const accepted = await home.getMerchantBooking(db, merchant, id, T0);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.address).toMatch(/Klang/);

    await home.assignWorker(db, merchant, id, workerId, T0);
    const mine = await home.getMyBooking(db, aisyah, id, T0);
    expect(mine.status).toBe('SCHEDULED');
    expect(mine.worker?.name).toBe('Ahmad Faizal');
    expect(mine.merchantName).toBeTruthy();
    expect(mine.pass?.code).toBeTruthy(); // made automatically with the worker
    expect(mine.can.sendPass).toBe(false);

    await home.startVisit(db, merchant, id, T0);
    await home.markWorkDone(db, merchant, id, 'Replaced the trap. RM120 agreed and paid in cash.', T0);
    const waiting = await home.getMyBooking(db, aisyah, id, T0);
    expect(waiting.status).toBe('WORK_DONE');
    expect(waiting.can.confirm).toBe(true);
    // The company cannot finish the booking on the resident's behalf.
    expect(waiting.completedAt).toBeNull();

    await home.confirmCompleted(db, aisyah, id, T0);
    await home.reviewBooking(db, aisyah, id, { rating: 5, comment: 'Quick and tidy.' }, T0);
    await expect(home.reviewBooking(db, aisyah, id, { rating: 1 }, T0)).rejects.toMatchObject({ code: 'ALREADY_REVIEWED' });

    const profile = await home.getProvider(db, aisyah, merchant.merchantId!);
    expect(profile.rating).toBe(5);
    expect(profile.reviews).toHaveLength(1);
    expect(profile.reviews[0]!.reviewer).not.toBe(aisyah.fullName);

    // Once done, the address is withheld from the company again.
    expect((await home.getMerchantBooking(db, merchant, id, T0)).address).toBeNull();

    // Every step is on the record, with who did it.
    const history = (await home.getMyBooking(db, aisyah, id, T0)).history;
    expect(history.filter((e) => e.kind !== 'PASS').map((e) => e.to_status)).toEqual(['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED']);
    expect(history.find((e) => e.kind === 'WORKER')?.worker_name).toBe('Ahmad Faizal');
    // The gate pass was made by the system, not by a person.
    expect(history.find((e) => e.kind === 'PASS')?.actor).toBe('SYSTEM');
  });

  it('accepts with a worker in one step, and the resident may confirm once the worker is on site', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    expect((await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt, workerId }, T0)).status).toBe('SCHEDULED');
    await expect(home.confirmCompleted(db, resident, id, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
    await home.startVisit(db, merchant, id, T0);
    expect((await home.confirmCompleted(db, resident, id, T0)).status).toBe('COMPLETED');
  });

  it('lets the company mark the work done without tapping "worker has arrived" first, but not before a worker is set', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt }, T0);
    await expect(home.markWorkDone(db, merchant, id, undefined, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
    await home.assignWorker(db, merchant, id, workerId, T0);
    expect((await home.markWorkDone(db, merchant, id, 'Fixed the tap.', T0)).status).toBe('WORK_DONE');
    expect((await home.confirmCompleted(db, resident, id, T0)).status).toBe('COMPLETED');
  });

  it('lets the company decline, and the resident book another company after', async () => {
    const { merchant, listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.declineBooking(db, merchant, id, 'Fully booked this week', T0);
    expect((await home.getMyBooking(db, resident, id, T0)).closedReason).toBe('Fully booked this week');
    await expect(home.acceptBooking(db, merchant, id, { scheduledAt: visitAt }, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
    // A declined booking no longer blocks a new one.
    await expect(book(resident, listingId)).resolves.toHaveProperty('id');
  });

  it('lets the resident cancel before the visit, but not once the worker is on site', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const first = await book(resident, listingId);
    await home.cancelByResident(db, resident, first.id, 'Fixed it myself', T0);
    const second = await book(resident, listingId);
    await home.acceptBooking(db, merchant, second.id, { scheduledAt: visitAt, workerId }, T0);
    await home.startVisit(db, merchant, second.id, T0);
    await expect(home.cancelByResident(db, resident, second.id, undefined, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
  });
});

describe('rules that keep bookings honest', () => {
  it('refuses a second open booking for the same service, and dates in the past or too far ahead', async () => {
    const { listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    await book(resident, listingId);
    await expect(book(resident, listingId)).rejects.toMatchObject({ code: 'ALREADY_BOOKED' });
    await expect(book(resident, listingId, { preferredDate: '2026-11-01' })).rejects.toMatchObject({ code: 'BOOKING_DATE' });
    await expect(book(resident, listingId, { preferredDate: '2027-02-01' })).rejects.toMatchObject({ code: 'BOOKING_DATE' });
  });

  it('holds two simultaneous requests to one booking', async () => {
    const { listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const results = await Promise.allSettled([book(resident, listingId), book(resident, listingId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM service_bookings WHERE resident_id = $1`, [resident.id]);
    expect(n!.n).toBe(1);
  });

  it('needs a confirmed home, and a visit time in the future', async () => {
    const { merchant, listingId } = await makeServiceCompany();
    const pending = await makeResident(w, { status: 'PENDING' });
    await expect(book(pending, listingId)).rejects.toMatchObject({ status: 403 });
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await expect(home.acceptBooking(db, merchant, id, { scheduledAt: at(-1) }, T0)).rejects.toMatchObject({ code: 'VISIT_TIME' });
    await expect(home.acceptBooking(db, merchant, id, { scheduledAt: at(90) }, T0)).rejects.toMatchObject({ code: 'VISIT_TIME' });
  });

  it('only reviews completed bookings', async () => {
    const { merchant, listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt }, T0);
    await expect(home.reviewBooking(db, resident, id, { rating: 2 }, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
  });

  it('lists only approved companies with home services switched on, in the resident’s township', async () => {
    const resident = await makeResident(w);
    const pendingApp = await applyAsMerchant(db, {
      townshipId: w.townshipId, businessName: 'Paip Baru Sdn Bhd', registrationNo: 'PAIP-0001', category: 'Plumbing', kind: 'SERVICES',
      addressLine: 'No. 5, Jalan Dua', postcode: '41050', city: 'Klang', state: 'Selangor', contactName: 'Hafiz', email: 'paip@kita.test', phone: '+60123456789', password: 'long-enough-pass',
    }, T0);
    const pendingUser = await one<Actor & { merchant_id: string }>(db, 'SELECT id, merchant_id FROM users WHERE id = $1', [pendingApp.userId]);
    const pendingActor = { ...resident, id: pendingUser!.id, role: 'MERCHANT', merchantId: pendingUser!.merchant_id, homeId: null } as Actor;
    // It can set up before approval, but is not listed until approved.
    const pendingListing = await home.saveListing(db, pendingActor, { category: 'ELECTRICAL', description: 'Wiring and sockets.', pricing: 'QUOTE', calloutFeeSen: null, priceNote: 'Quote after a site visit' }, T0);
    expect((await home.listProviders(db, resident, 'ELECTRICAL')).map((p) => p.listing_id)).not.toContain(pendingListing.id);
    await expect(book(resident, pendingListing.id)).rejects.toMatchObject({ status: 404 });
    await setMerchantStatus(db, w.admin, pendingApp.merchantId, 'ACTIVE', T0);
    expect((await home.listProviders(db, resident, 'ELECTRICAL')).map((p) => p.listing_id)).toContain(pendingListing.id);

    // A different township's resident sees nothing of it.
    const other = await makeWorld(db);
    const outsider = await makeResident(other);
    expect(await home.listProviders(db, outsider, 'ELECTRICAL')).toHaveLength(0);
    await expect(home.getProvider(db, outsider, pendingApp.merchantId)).rejects.toMatchObject({ status: 404 });
  });

  it('will not retire a worker who is on an unfinished visit', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt, workerId }, T0);
    await expect(home.setWorkerActive(db, merchant, workerId, false)).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  });
});

describe('who may see and do what', () => {
  it('keeps one company out of another company’s bookings', async () => {
    const a = await makeServiceCompany();
    const b = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, a.listingId);
    await expect(home.getMerchantBooking(db, b.merchant, id, T0)).rejects.toMatchObject({ status: 404 });
    await expect(home.acceptBooking(db, b.merchant, id, { scheduledAt: visitAt }, T0)).rejects.toMatchObject({ status: 404 });
    expect((await home.listMerchantBookings(db, b.merchant, 'OPEN', T0)).map((x) => x.id)).not.toContain(id);
    // Nor can it assign its own worker to someone else's booking, or a worker that is not its own.
    await home.acceptBooking(db, a.merchant, id, { scheduledAt: visitAt }, T0);
    await expect(home.assignWorker(db, a.merchant, id, b.workerId, T0)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps residents out of each other’s bookings and photos', async () => {
    const { listingId } = await makeServiceCompany();
    const owner = await makeResident(w);
    const neighbour = await makeResident(w);
    const { id } = await book(owner, listingId);
    await expect(home.getMyBooking(db, neighbour, id, T0)).rejects.toMatchObject({ status: 404 });
    await expect(home.cancelByResident(db, neighbour, id, undefined, T0)).rejects.toMatchObject({ status: 404 });
    await expect(home.bookingPhoto(db, neighbour, id)).rejects.toMatchObject({ status: 404 });
  });

  it('separates shop tools from home-service tools on the same account system', async () => {
    const retail = await makeMerchant(w);
    await expect(home.serviceSetup(db, retail)).rejects.toMatchObject({ status: 403 });
    const servicesOnly = await makeServiceCompany('SERVICES');
    const member = await makeResident(w);
    await expect(sell(w, servicesOnly.merchant, member, 1000)).rejects.toMatchObject({ status: 403 });
    expect((await listActiveMerchants(db, w.townshipId)).map((m) => m.id)).not.toContain(servicesOnly.merchant.merchantId);
    // A business offering both keeps both.
    const both = await makeServiceCompany('BOTH');
    await expect(home.serviceSetup(db, both.merchant)).resolves.toHaveProperty('listings');
    await expect(sell(w, both.merchant, member, 1000)).resolves.toHaveProperty('id');
  });

  it('will not switch services off while bookings are open', async () => {
    const { merchant, listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    await book(resident, listingId);
    await expect(home.setMerchantKind(db, w.admin, merchant.merchantId!, 'RETAIL')).rejects.toMatchObject({ code: 'OPEN_BOOKINGS' });
    const other = await makeWorld(db);
    await expect(home.setMerchantKind(db, other.admin, merchant.merchantId!, 'BOTH')).rejects.toMatchObject({ status: 403 });
  });

  it('enforces roles at the API too', async () => {
    const { merchant, listingId } = await makeServiceCompany();
    const resident = await makeResident(w);
    expect((await call('GET', '/merchant/bookings', resident)).status).toBe(403);
    expect((await call('GET', '/home-services/providers?category=PLUMBING', merchant)).status).toBe(403);
    expect((await call('GET', '/admin/home-services/reports', merchant)).status).toBe(403);
    expect((await call('POST', `/admin/merchants/${merchant.merchantId}/kind`, w.staff, { kind: 'BOTH' })).status).toBe(403);

    const form = new FormData();
    form.set('listingId', listingId);
    form.set('problem', 'Bathroom tap drips all night.');
    form.set('preferredDate', tomorrow);
    form.set('preferredSlot', 'EVENING');
    const created = await call('POST', '/home-services/bookings', resident, form);
    expect(created.status).toBe(200);
    const listed = await call('GET', '/merchant/bookings', merchant);
    expect(listed.data.map((b: { id: string }) => b.id)).toContain(created.data.id);
    const bad = await call('POST', `/merchant/bookings/${created.data.id}/accept`, merchant, { scheduledAt: 'not a date' });
    expect(bad.status).toBe(400);
  });
});

describe('private reports', () => {
  it('reaches township staff with the worker on record, and never the company', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await expect(home.reportBooking(db, resident, id, { category: 'NO_SHOW', description: 'Nobody has replied at all.' }, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt, workerId }, T0);
    const { id: reportId } = await home.reportBooking(db, resident, id, { category: 'HARASSMENT', description: 'The worker made rude remarks to my daughter.' }, T0);

    const urgent = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND priority = 'URGENT'`, [w.staff.id]);
    expect(urgent!.n).toBeGreaterThan(0);
    // HQ is told about harassment too, and the notification opens the report itself.
    const hqNote = await one<{ link: string }>(db, `SELECT link FROM notifications WHERE user_id = $1 AND priority = 'URGENT' ORDER BY id DESC LIMIT 1`, [w.hq.id]);
    expect(hqNote?.link).toBe(`/console/home-services?report=${reportId}`);

    const queue = await home.listServiceReports(db, w.staff, undefined);
    expect(queue.map((r) => r.id)).toContain(reportId);
    const detail = await home.getServiceReport(db, w.staff, reportId, T0);
    expect(detail.worker_name).toBe('Ahmad Faizal');
    expect(detail.history.some((e) => e.kind === 'WORKER' && e.worker_name === 'Ahmad Faizal')).toBe(true);

    // The company's view of the booking says nothing about it.
    const companyView = JSON.stringify(await home.getMerchantBooking(db, merchant, id, T0));
    expect(companyView).not.toMatch(/rude remarks|HARASSMENT/);
    const merchantNotes = await db.query<{ body: string }>(`SELECT body FROM notifications WHERE user_id = $1`, [merchant.id]);
    expect(merchantNotes.some((n) => /report/i.test(n.body))).toBe(false);

    // Staff of another township cannot open it.
    const other = await makeWorld(db);
    await expect(home.getServiceReport(db, other.staff, reportId, T0)).rejects.toMatchObject({ status: 404 });
    expect((await home.listServiceReports(db, other.staff, undefined)).map((r) => r.id)).not.toContain(reportId);

    // A note alone still reaches the resident.
    await home.updateServiceReport(db, w.staff, reportId, { status: 'NEW', staffNote: 'We have called the company and will update you tomorrow.' }, T0);
    expect(await one(db, `SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Update on your home service report'`, [resident.id])).toBeDefined();

    await home.updateServiceReport(db, w.staff, reportId, { status: 'CLOSED', staffNote: 'Spoke to the company; the worker was removed from township jobs.' }, T0);
    await expect(home.updateServiceReport(db, w.staff, reportId, { status: 'REVIEWING' }, T0)).rejects.toMatchObject({ code: 'REPORT_CLOSED' });
    expect((await home.getMyBooking(db, resident, id, T0)).reports[0]).toMatchObject({ status: 'CLOSED' });
  });
});

describe('Tamu contractor pass', () => {
  it('is made automatically for the assigned worker, shown to the company, and replaced when the worker changes', async () => {
    const { merchant, listingId, workerId, worker2Id } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt }, T0);
    // No worker yet, so no pass.
    expect((await home.getMyBooking(db, resident, id, T0)).pass).toBeNull();
    await expect(home.sendGatePass(db, resident, id, T0)).rejects.toMatchObject({ code: 'BOOKING_STATE' });
    await home.assignWorker(db, merchant, id, workerId, T0);

    const first = (await home.getMyBooking(db, resident, id, T0)).pass!;
    expect(first.code).toBeTruthy();
    const stored = await one<{ type: string; visitor_name: string; status: string; valid_from: Date; valid_until: Date; host_user_id: string }>(
      db, 'SELECT type, visitor_name, status, valid_from, valid_until, host_user_id FROM visitor_passes WHERE code = $1', [first.code]);
    expect(stored).toMatchObject({ type: 'CONTRACTOR', status: 'ACTIVE', host_user_id: resident.id });
    expect(stored!.visitor_name).toMatch(/^Ahmad Faizal \(/);
    expect(stored!.valid_from.getTime()).toBeLessThanOrEqual(visitAt.getTime());
    expect(stored!.valid_until.getTime()).toBeGreaterThan(visitAt.getTime());
    expect((await home.getMerchantBooking(db, merchant, id, T0)).passCode).toBe(first.code);
    // The resident has nothing to send; the manual button is only a fallback.
    expect((await home.getMyBooking(db, resident, id, T0)).can.sendPass).toBe(false);
    await expect(home.sendGatePass(db, resident, id, T0)).rejects.toMatchObject({ code: 'PASS_SENT' });

    await home.assignWorker(db, merchant, id, worker2Id, T0);
    expect((await one<{ status: string }>(db, 'SELECT status FROM visitor_passes WHERE code = $1', [first.code]))!.status).toBe('CANCELLED');
    const second = (await home.getMyBooking(db, resident, id, T0)).pass!;
    expect(second.code).not.toBe(first.code);
    expect((await one<{ visitor_name: string }>(db, 'SELECT visitor_name FROM visitor_passes WHERE code = $1', [second.code]))!.visitor_name).not.toMatch(/^Ahmad Faizal/);

    // If the pass is cancelled in Tamu, the resident can make a new one.
    await db.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE code = $1`, [second.code]);
    expect((await home.getMyBooking(db, resident, id, T0)).can.sendPass).toBe(true);
    expect((await home.sendGatePass(db, resident, id, T0)).code).not.toBe(second.code);
  });

  it('is made when the company accepts with a worker, and cancelled with the booking', async () => {
    const { merchant, listingId, workerId } = await makeServiceCompany();
    const resident = await makeResident(w);
    const { id } = await book(resident, listingId);
    await home.acceptBooking(db, merchant, id, { scheduledAt: visitAt, workerId }, T0);
    const pass = (await home.getMyBooking(db, resident, id, T0)).pass!;
    expect(pass.code).toBeTruthy();
    await home.cancelByMerchant(db, merchant, id, 'Our van broke down', T0);
    const after = await one<{ status: string }>(db, 'SELECT status FROM visitor_passes WHERE code = $1', [pass.code]);
    expect(after!.status).toBe('CANCELLED');
  });
});

describe('home logbook', () => {
  async function completeJob(resident: Actor, company: Awaited<ReturnType<typeof makeServiceCompany>>, listingId: string, now: Date) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(now.getTime() + 24 * HOUR));
    const { id } = await home.createBooking(db, resident, { listingId, problem: 'Aircon drips water inside.', preferredDate: date, preferredSlot: 'MORNING' }, now);
    const visit = new Date(now.getTime() + 26 * HOUR);
    await home.acceptBooking(db, company.merchant, id, { scheduledAt: visit, workerId: company.workerId }, now);
    await home.startVisit(db, company.merchant, id, visit);
    await home.markWorkDone(db, company.merchant, id, 'Cleaned the drain pipe.', visit);
    await home.confirmCompleted(db, resident, id, visit);
    return id;
  }

  it('records confirmed jobs for the whole home, keeps each person’s own words private, and reminds when a service is due', async () => {
    const company = await makeServiceCompany();
    const aircon = await home.saveListing(db, company.merchant, { category: 'AIRCON', description: 'Standard service for wall units.', pricing: 'FIXED', calloutFeeSen: null, priceNote: 'RM80 per unit' }, T0);
    const homeId = await makeHome(w);
    const owner = await makeResident(w, { homeId });
    const tenant = await makeResident(w, { homeId, occupancy: 'TENANT' });
    const neighbour = await makeResident(w);

    // Serviced 170 days before T0: due in 10 days, so "due soon".
    const id = await completeJob(owner, company, aircon.id, new Date(T0.getTime() - 170 * 24 * HOUR));
    const mine = await home.homeLogbook(db, owner, T0);
    expect(mine.entries[0]).toMatchObject({ id, category: 'AIRCON', workerName: 'Ahmad Faizal', providerNote: 'Cleaned the drain pipe.', mine: true, problem: 'Aircon drips water inside.' });
    expect(mine.entries[0]!.rebook?.listingId).toBe(aircon.id);
    expect(mine.reminders).toHaveLength(1);
    expect(mine.reminders[0]).toMatchObject({ category: 'AIRCON', state: 'DUE_SOON' });

    // The tenant sees the home's record, not the owner's own words.
    const theirs = await home.homeLogbook(db, tenant, T0);
    expect(theirs.entries[0]).toMatchObject({ id, mine: false, problem: null, rating: null });
    // A neighbour sees nothing of it.
    expect((await home.homeLogbook(db, neighbour, T0)).entries.map((e) => e.id)).not.toContain(id);

    // Once a new aircon booking is open, the reminder says so instead of nagging.
    await home.createBooking(db, tenant, { listingId: aircon.id, problem: 'Time for the next service.', preferredDate: tomorrow, preferredSlot: 'AFTERNOON' }, T0);
    expect((await home.homeLogbook(db, owner, T0)).reminders[0]!.state).toBe('BOOKED');

    // A company that is no longer bookable cannot be booked again from the logbook.
    await setMerchantStatus(db, w.admin, company.merchant.merchantId!, 'SUSPENDED', T0);
    expect((await home.homeLogbook(db, owner, T0)).entries[0]!.rebook).toBeNull();
  });
});
