import { z } from 'zod';
import { SCHEDULE_TIMES, WEEKDAYS } from '@/shared/collector-schedule';
import { ADMINS, MATERIALS, STAFF } from '@/shared/domain';
import { identifyMaterial } from '../../ai/classifier';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import { pageQuery } from '../../http/pagination';
import { readForm, readPhoto } from '../../http/uploads';
import { zScanCode } from '../gerak/routes';
import * as collectionDemo from './collection-demo';
import * as collections from './collections';
import * as machine from './machine';
import * as kitar from './service';
import { recordTestEntry } from './test-entry';

const zSignature = z.string().regex(/^[0-9a-fA-F]{64}$/, 'An HMAC-SHA256 signature in hex.');

export const kitarRoutes = [
  route({
    method: 'GET', path: '/kitar', tag: 'Kitar', summary: "My recycling totals, my street's total and the kiosks", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => kitar.kitarOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/identify', tag: 'Kitar', summary: 'Photo check: what material is this? (multipart form; the photo is not stored)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor);
      const photo = await readPhoto(await readForm(c.req));
      if (!photo) throw badRequest('Attach a photo of the item.');
      return identifyMaterial(photo);
    },
  }),
  route({
    method: 'POST', path: '/kitar/dropoffs', tag: 'Kitar', summary: 'Record a drop-off at a kiosk', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({ kioskCode: zScanCode, material: z.enum(MATERIALS), weightG: z.number().int().min(1).max(20_000) }),
    handler: (c) => kitar.recordDropOff(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/kiosks', tag: 'Kitar', summary: 'Kiosks with their printable codes', auth: 'session', roles: STAFF,
    handler: (c) => kitar.listKiosksForStaff(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/kitar/kiosks', tag: 'Kitar', summary: 'Add a kiosk (township admin or SDP HQ)', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(80, 3), location: zText(160, 3), townshipId: zId.optional() }),
    handler: (c) => kitar.createKiosk(c.db, c.actor, c.body),
  }),

  route({
    method: 'POST', path: '/kitar/test-entry', tag: 'Kitar', summary: 'Kitar test mode (local demos only): a practice entry, marked TEST and audited', auth: 'session', roles: ['RESIDENT'],
    body: z.object({
      machineId: zId,
      material: z.enum(MATERIALS),
      weightG: z.number().int().min(1, 'Enter a weight more than 0 kg, up to 20 kg.').max(20_000, 'Enter a weight more than 0 kg, up to 20 kg.'),
    }),
    handler: (c) => recordTestEntry(c.db, c.actor, c.body, c.now),
  }),
  // --- The smart recycling machine (BR23) ---------------------------------------
  route({
    method: 'POST', path: '/kitar/machine/join', tag: 'Kitar', summary: "Start recycling at a bin by scanning the code on its screen", auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 600, by: 'user' },
    body: z.object({ machineId: zId, code: z.string().trim().min(10).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Scan the code on the bin again.') }),
    handler: (c) => machine.joinFromScreen(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/kitar/machine/session', tag: 'Kitar', summary: 'My recycling session at a bin, live, and its result', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => machine.myMachineSession(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/claim', tag: 'Kitar', summary: 'Claim guest recycling within 14 days (Impact XP only)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ code: z.string().trim().min(6).max(16).regex(/^[A-Za-z0-9]+$/, 'Check the code.') }),
    handler: (c) => machine.claimGuestSession(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/machines', tag: 'Kitar', summary: 'Kiosk bins, their state and today’s use', auth: 'session', roles: STAFF,
    handler: (c) => machine.listMachines(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines', tag: 'Kitar', summary: 'Put a bin at a kiosk', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(80, 3), kioskId: zId, material: z.enum(MATERIALS).nullable().optional() }),
    handler: (c) => machine.createMachine(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/status', tag: 'Kitar', summary: 'Mark a bin online, full or offline', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['ONLINE', 'FULL', 'OFFLINE']) }),
    handler: (c) => machine.setMachineStatus(c.db, c.actor, c.params.machineId!, c.body.status, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/material', tag: 'Kitar', summary: 'Set the one material a bin takes, or null for any material', auth: 'session', roles: ADMINS,
    body: z.object({ material: z.enum(MATERIALS).nullable() }),
    handler: (c) => machine.setMachineMaterial(c.db, c.actor, c.params.machineId!, c.body.material),
  }),
  route({
    method: 'GET', path: '/admin/kitar/machines/:machineId/screen', tag: 'Kitar', summary: "Prototype: the bin's screen (rotating code and the session in progress)", auth: 'session', roles: STAFF,
    handler: (c) => machine.machineScreen(c.db, c.actor, c.params.machineId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/start', tag: 'Kitar', summary: 'Prototype: the bin reads a SimeTown QR, or a guest taps "Recycle as guest"', auth: 'session', roles: STAFF,
    body: z.object({ mode: z.enum(['MEMBER_QR', 'GUEST']), memberCode: z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/).optional() }),
    handler: (c) => machine.simulateStart(c.db, c.actor, c.params.machineId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/items', tag: 'Kitar', summary: "Prototype: the bin's scale reports one item", auth: 'session', roles: STAFF,
    rateLimit: { limit: 240, windowSec: 60, by: 'user' },
    body: z.object({ material: z.enum(MATERIALS), outcome: z.enum(['ACCEPT', 'WRONG_MATERIAL', 'NOT_TAKEN']).default('ACCEPT') }),
    handler: (c) => machine.simulateItem(c.db, c.actor, c.params.machineId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/finish', tag: 'Kitar', summary: "Prototype: the bin signs its summary and closes the session", auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => machine.simulateFinish(c.db, c.actor, c.params.machineId!, c.now),
  }),
  // --- Collections from partner collectors ------------------------------------------------
  route({
    method: 'GET', path: '/kitar/collectors', tag: 'Kitar', summary: 'Partner collectors, what they take and when they come', auth: 'session', roles: ['RESIDENT'],
    query: z.object({
      material: z.enum(MATERIALS).optional(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      slot: z.enum(collections.COLLECTION_SLOTS).optional(),
    }),
    handler: (c) => collections.listCollectors(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/kitar/collections', tag: 'Kitar', summary: "My home's booked collections", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => collections.myCollections(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections', tag: 'Kitar', summary: 'Book a collection of bulky or special items; confirmed at once, with the gate pass', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({
      collectorId: zId, materials: z.array(z.enum(MATERIALS)).min(1).max(8), items: zText(300, 3),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'), slot: z.enum(collections.COLLECTION_SLOTS),
    }),
    handler: (c) => collections.bookCollection(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections/:collectionId/cancel', tag: 'Kitar', summary: 'Cancel a booked collection', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => collections.cancelCollection(c.db, c.actor, c.params.collectionId!, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections/:collectionId/weight', tag: 'Kitar', summary: 'Send what the collector took. The gate record decides it: the collector scanned in that day credits it (counted up to a maximum per material); no record closes it with no reward. On the day itself it waits for the nightly check', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({ weightG: z.number().int().min(1, 'Enter a weight more than 0 kg.').max(500_000, 'Enter a weight up to 500 kg.') }),
    handler: (c) => collections.reportCollectionWeight(c.db, c.actor, c.params.collectionId!, c.body.weightG, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections/:collectionId/came', tag: 'Kitar', summary: 'Say the collector came on a collection marked missed, with the weight they took. The gate record decides it at once', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ weightG: z.number().int().min(1, 'Enter a weight more than 0 kg.').max(500_000, 'Enter a weight up to 500 kg.') }),
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: (c) => collections.reportCollectorCame(c.db, c.actor, c.params.collectionId!, c.body.weightG, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections/:collectionId/demo/today', tag: 'Kitar', summary: 'Local demos only (pglite in development): move my confirmed collection and its gate pass to today', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    handler: (c) => collectionDemo.demoMoveToToday(c.db, c.actor, c.params.collectionId!, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/collections/:collectionId/demo/gate-scan', tag: 'Kitar', summary: "Local demos only (pglite in development): the real gate scan of my collection's pass, made with the township's guard account", auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    handler: (c) => collectionDemo.demoGateScan(c.db, c.actor, c.params.collectionId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/collectors', tag: 'Kitar', summary: 'Partner collectors with what they have collected', auth: 'session', roles: STAFF,
    query: z.object({ townshipId: zId.optional() }),
    handler: (c) => collections.listCollectorsForStaff(c.db, c.actor, c.query.townshipId),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collectors', tag: 'Kitar', summary: 'Add a partner collector (township admin or SDP HQ)', auth: 'session', roles: ADMINS,
    body: z.object({
      name: zText(80, 2), phone: z.string().trim().max(30).optional(), materials: z.array(z.enum(MATERIALS)).min(1).max(8),
      schedule: z.object({ days: z.array(z.enum(WEEKDAYS)).min(1, 'Choose at least one day.').max(7), time: z.enum(SCHEDULE_TIMES) }),
      notes: z.string().trim().max(200).optional(), townshipId: zId.optional(),
    }),
    handler: (c) => collections.createCollector(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collectors/:collectorId/active', tag: 'Kitar', summary: 'Pause or resume a collector', auth: 'session', roles: STAFF,
    body: z.object({ active: z.boolean() }),
    handler: (c) => collections.setCollectorActive(c.db, c.actor, c.params.collectorId!, c.body.active),
  }),
  route({
    method: 'GET', path: '/admin/kitar/collectors/:collectorId/today', tag: 'Kitar', summary: "A collector's collections today, to copy or print for them", auth: 'session', roles: STAFF,
    handler: (c) => collections.collectorDaySheet(c.db, c.actor, c.params.collectorId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/collections', tag: 'Kitar', summary: 'Recent collections, newest first, and how each was settled', auth: 'session', roles: STAFF,
    query: z.object({ status: z.enum(['REQUESTED', 'CONFIRMED', 'COLLECTED', 'CANCELLED', 'MISSED']).optional(), townshipId: zId.optional() }),
    handler: (c) => collections.collectionsForStaff(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/admin/kitar/collections/history', tag: 'Kitar', summary: 'Collection history: what each household logged, what was counted, the gate record and who settled it. Search, filters and paging', auth: 'session', roles: STAFF,
    query: pageQuery.extend({
      townshipId: zId.optional(), q: z.string().trim().max(60).optional(), outcome: z.enum(collections.HISTORY_OUTCOMES).optional(),
      collectorId: zId.optional(), material: z.enum(MATERIALS).optional(), days: z.coerce.number().int().min(1).max(3650).optional(),
      settledBy: z.enum(['SYSTEM', 'STAFF']).optional(),
    }),
    handler: (c) => collections.collectionHistory(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/collections/exceptions', tag: 'Kitar', summary: 'Only what needs a person: weights and disputes to check, homes and collectors to look at', auth: 'session', roles: STAFF,
    query: z.object({ townshipId: zId.optional() }),
    handler: (c) => collections.collectionExceptions(c.db, c.actor, c.now, c.query.townshipId),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collections/:collectionId/review', tag: 'Kitar', summary: 'Settle a collection waiting for review: accept a weight, or close it with no points', auth: 'session', roles: STAFF,
    body: z.object({ decision: z.enum(['ACCEPT', 'REJECT']), weightG: z.number().int().min(1).max(500_000).optional() }),
    handler: (c) => collections.reviewCollection(c.db, c.actor, c.params.collectionId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collections/:collectionId/confirm', tag: 'Kitar', summary: 'Confirm a request made before bookings were confirmed at once; the collector gets a gate pass for the day', auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => collections.confirmCollection(c.db, c.actor, c.params.collectionId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collections/:collectionId/collected', tag: 'Kitar', summary: "Record the collector's weighed total (earns the household Impact XP)", auth: 'session', roles: STAFF,
    body: z.object({ weightG: z.number().int().min(1).max(500_000) }),
    handler: (c) => collections.completeCollection(c.db, c.actor, c.params.collectionId!, c.body.weightG, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/collections/:collectionId/missed', tag: 'Kitar', summary: 'The collector did not come', auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => collections.missCollection(c.db, c.actor, c.params.collectionId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/stats', tag: 'Kitar', summary: 'Material accepted by month and why machines turned items away (the recycling test)', auth: 'session', roles: STAFF,
    query: z.object({ townshipId: zId.optional() }),
    handler: (c) => collections.recyclingStats(c.db, c.actor, c.now, c.query.townshipId),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/start', tag: 'Kitar', summary: 'Device: start a session (SimeTown QR read, or guest); signed by the bin', auth: 'machine',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    body: z.object({ machineId: zId, mode: z.enum(['MEMBER_QR', 'GUEST']), memberCode: z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/).nullable(), ts: z.iso.datetime(), signature: zSignature }),
    handler: (c) => machine.ingestStart(c.db, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/items', tag: 'Kitar', summary: 'Device: one item weighed by the bin’s scale; signed by the bin', auth: 'machine',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({
      machineId: zId, sessionId: zId, seq: z.number().int().min(1).max(1000), material: z.enum(MATERIALS), cameraMaterial: z.enum(MATERIALS).nullable(),
      barcodeOk: z.boolean(), weightG: z.number().int().min(1).max(5000), accepted: z.boolean(), ts: z.iso.datetime(), signature: zSignature,
    }),
    handler: (c) => machine.ingestItem(c.db, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/finish', tag: 'Kitar', summary: "Device: the session's summary, which must match the items; signed by the bin", auth: 'machine',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    body: z.object({
      machineId: zId, sessionId: zId, acceptedCount: z.number().int().min(0).max(1000), rejectedCount: z.number().int().min(0).max(1000),
      acceptedG: z.number().int().min(0).max(50_000), ts: z.iso.datetime(), signature: zSignature,
    }),
    handler: (c) => machine.ingestFinish(c.db, c.body, c.now),
  }),
];
