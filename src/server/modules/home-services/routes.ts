import { z } from 'zod';
import { ADMINS, MERCHANT_KINDS, SERVICE_CATEGORIES, SERVICE_PRICING, SERVICE_REPORT_CATEGORIES, SERVICE_REPORT_STATUSES, SERVICE_SLOTS, STAFF } from '@/shared/domain';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { emptyBody, route, zId, zPhone, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as home from './service';

const TAG = 'SimeTown Home';
const zReason = zText(300, 3);
const zNote = zText(300).optional();

const bookingFields = z.object({
  listingId: zId,
  problem: zText(1000, 5),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Choose a date.'),
  preferredSlot: z.enum(SERVICE_SLOTS),
});

export const homeServiceRoutes = [
  // --- Residents: find a company and book ---------------------------------------
  route({
    method: 'GET', path: '/home-services/categories', tag: TAG, summary: 'Service categories with the number of companies offering each', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => home.listCategories(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/home-services/providers', tag: TAG, summary: 'Companies offering a category, with ratings and pricing', auth: 'session', roles: ['RESIDENT'],
    query: z.object({ category: z.enum(SERVICE_CATEGORIES) }),
    handler: (c) => home.listProviders(c.db, c.actor, c.query.category),
  }),
  route({
    method: 'GET', path: '/home-services/providers/:merchantId', tag: TAG, summary: "A company's profile, listings and reviews", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => home.getProvider(c.db, c.actor, c.params.merchantId!),
  }),
  route({
    method: 'POST', path: '/home-services/bookings', tag: TAG, summary: 'Ask a company for a visit (multipart form; optional photo)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor); // before the upload is read
      const form = await readForm(c.req);
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const parsed = bookingFields.safeParse({ listingId: text('listingId'), problem: text('problem'), preferredDate: text('preferredDate'), preferredSlot: text('preferredSlot') });
      if (!parsed.success) throw badRequest('Please describe the problem and choose a date and time.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      return home.createBooking(c.db, c.actor, { ...parsed.data, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'GET', path: '/home-services/bookings', tag: TAG, summary: 'My bookings, open ones first', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => home.listMyBookings(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/home-services/logbook', tag: TAG, summary: "The home logbook: jobs confirmed at my home, and services due again", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => home.homeLogbook(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/home-services/bookings/:bookingId', tag: TAG, summary: 'One of my bookings: the worker, the history and what I can do next', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => home.getMyBooking(c.db, c.actor, c.params.bookingId!, c.now),
  }),
  route({
    method: 'GET', path: '/home-services/bookings/:bookingId/photo', tag: TAG, summary: 'The problem photo (the resident, the company booked and township staff only)', auth: 'session', roles: ['RESIDENT', 'MERCHANT', ...STAFF],
    handler: (c) => home.bookingPhoto(c.db, c.actor, c.params.bookingId!),
  }),
  route({
    method: 'POST', path: '/home-services/bookings/:bookingId/cancel', tag: TAG, summary: 'Cancel my booking before the visit', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ reason: zText(300).optional() }),
    handler: (c) => home.cancelByResident(c.db, c.actor, c.params.bookingId!, c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/home-services/bookings/:bookingId/confirm', tag: TAG, summary: 'Confirm the job is done (only the resident can)', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => home.confirmCompleted(c.db, c.actor, c.params.bookingId!, c.now),
  }),
  route({
    method: 'POST', path: '/home-services/bookings/:bookingId/review', tag: TAG, summary: 'Review the company for a completed booking', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ rating: z.number().int().min(1).max(5), comment: zText(500).optional() }),
    handler: (c) => home.reviewBooking(c.db, c.actor, c.params.bookingId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/home-services/bookings/:bookingId/reports', tag: TAG, summary: 'Privately report a problem to township staff (never shown to the company)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ category: z.enum(SERVICE_REPORT_CATEGORIES), description: zText(1000, 10) }),
    handler: (c) => home.reportBooking(c.db, c.actor, c.params.bookingId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/home-services/bookings/:bookingId/pass', tag: TAG, summary: 'Send the assigned worker a Tamu contractor pass for this visit', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' }, body: emptyBody,
    handler: (c) => home.sendGatePass(c.db, c.actor, c.params.bookingId!, c.now),
  }),

  // --- Service companies ----------------------------------------------------------
  route({
    method: 'GET', path: '/merchant/services', tag: TAG, summary: "The company's description, listings and workers", auth: 'session', roles: ['MERCHANT'],
    handler: (c) => home.serviceSetup(c.db, c.actor),
  }),
  route({
    method: 'PATCH', path: '/merchant/services/about', tag: TAG, summary: 'What residents read about the company', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ about: zText(600, 0) }),
    handler: (c) => home.updateServiceAbout(c.db, c.actor, c.body.about),
  }),
  route({
    method: 'POST', path: '/merchant/services/listings', tag: TAG, summary: 'Add or update the listing for a category, with its pricing', auth: 'session', roles: ['MERCHANT'],
    body: z.object({
      category: z.enum(SERVICE_CATEGORIES), description: zText(600, 5), pricing: z.enum(SERVICE_PRICING),
      calloutFeeSen: z.number().int().min(0).max(100_000).nullable().default(null), priceNote: zText(200, 3),
    }),
    handler: (c) => home.saveListing(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/services/listings/:listingId/active', tag: TAG, summary: 'Show or hide a listing', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ active: z.boolean() }),
    handler: (c) => home.setListingActive(c.db, c.actor, c.params.listingId!, c.body.active, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/services/workers', tag: TAG, summary: 'Register a worker (name and phone; never an IC)', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ fullName: zText(80, 2), phone: zPhone.optional() }),
    handler: (c) => home.addWorker(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/merchant/services/workers/:workerId/active', tag: TAG, summary: 'Make a worker active or inactive', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ active: z.boolean() }),
    handler: (c) => home.setWorkerActive(c.db, c.actor, c.params.workerId!, c.body.active),
  }),
  route({
    method: 'GET', path: '/merchant/bookings', tag: TAG, summary: "The company's bookings: open (default) or closed", auth: 'session', roles: ['MERCHANT'],
    query: z.object({ filter: z.enum(['OPEN', 'CLOSED']).default('OPEN') }),
    handler: (c) => home.listMerchantBookings(c.db, c.actor, c.query.filter, c.now),
  }),
  route({
    method: 'GET', path: '/merchant/bookings/:bookingId', tag: TAG, summary: 'One booking with its history', auth: 'session', roles: ['MERCHANT'],
    handler: (c) => home.getMerchantBooking(c.db, c.actor, c.params.bookingId!, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/accept', tag: TAG, summary: 'Accept with a visit time, and optionally a worker', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ scheduledAt: z.coerce.date(), workerId: zId.optional(), note: zNote }),
    handler: (c) => home.acceptBooking(c.db, c.actor, c.params.bookingId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/decline', tag: TAG, summary: 'Decline a request', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ reason: zReason }),
    handler: (c) => home.declineBooking(c.db, c.actor, c.params.bookingId!, c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/worker', tag: TAG, summary: 'Assign or change the worker (the resident is told)', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ workerId: zId }),
    handler: (c) => home.assignWorker(c.db, c.actor, c.params.bookingId!, c.body.workerId, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/start', tag: TAG, summary: 'The worker has arrived', auth: 'session', roles: ['MERCHANT'], body: emptyBody,
    handler: (c) => home.startVisit(c.db, c.actor, c.params.bookingId!, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/done', tag: TAG, summary: 'The work is finished; the resident confirms', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ note: zNote }),
    handler: (c) => home.markWorkDone(c.db, c.actor, c.params.bookingId!, c.body.note, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/bookings/:bookingId/cancel', tag: TAG, summary: 'Cancel an accepted booking (the resident is told why)', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ reason: zReason }),
    handler: (c) => home.cancelByMerchant(c.db, c.actor, c.params.bookingId!, c.body.reason, c.now),
  }),

  // --- Township staff -----------------------------------------------------------------
  route({
    method: 'GET', path: '/admin/home-services/reports', tag: TAG, summary: 'Reports about home service visits, harassment first', auth: 'session', roles: STAFF,
    query: z.object({ status: z.enum(SERVICE_REPORT_STATUSES).optional() }),
    handler: (c) => home.listServiceReports(c.db, c.actor, c.query.status),
  }),
  route({
    method: 'GET', path: '/admin/home-services/reports/:reportId', tag: TAG, summary: 'One report with the booking, worker assignment history and records', auth: 'session', roles: STAFF,
    handler: (c) => home.getServiceReport(c.db, c.actor, c.params.reportId!, c.now),
  }),
  route({
    method: 'PATCH', path: '/admin/home-services/reports/:reportId', tag: TAG, summary: 'Update a report (the resident is told)', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(SERVICE_REPORT_STATUSES).optional(), staffNote: zText(500).optional() }),
    handler: (c) => home.updateServiceReport(c.db, c.actor, c.params.reportId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/merchants/:merchantId/kind', tag: TAG, summary: 'Set what a business offers: shop, home services or both', auth: 'session', roles: ADMINS,
    body: z.object({ kind: z.enum(MERCHANT_KINDS) }),
    handler: (c) => home.setMerchantKind(c.db, c.actor, c.params.merchantId!, c.body.kind),
  }),
];
