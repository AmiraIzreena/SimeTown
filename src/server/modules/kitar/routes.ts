import { z } from 'zod';
import { ADMINS, MATERIALS, STAFF } from '@/shared/domain';
import { identifyMaterial } from '../../ai/classifier';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import { zScanCode } from '../gerak/routes';
import * as machine from './machine';
import * as kitar from './service';

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
    method: 'POST', path: '/admin/kitar/kiosks', tag: 'Kitar', summary: 'Add a kiosk', auth: 'session', roles: STAFF,
    body: z.object({ name: zText(80, 3), location: zText(160, 3) }),
    handler: (c) => kitar.createKiosk(c.db, c.actor, c.body),
  }),

  // --- The smart recycling machine (BR23) ---------------------------------------
  route({
    method: 'POST', path: '/kitar/machine/join', tag: 'Kitar', summary: "Start recycling at a machine by scanning the code on its screen", auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 600, by: 'user' },
    body: z.object({ machineId: zId, code: z.string().trim().min(10).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Scan the machine again.') }),
    handler: (c) => machine.joinFromScreen(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/kitar/machine/session', tag: 'Kitar', summary: 'My recycling session at a machine, live, and its result', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => machine.myMachineSession(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/claim', tag: 'Kitar', summary: 'Claim guest recycling within 14 days (Impact XP only)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ code: z.string().trim().min(6).max(16).regex(/^[A-Za-z0-9]+$/, 'Check the code.') }),
    handler: (c) => machine.claimGuestSession(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/machines', tag: 'Kitar', summary: 'Recycling machines, their state and today’s use', auth: 'session', roles: STAFF,
    handler: (c) => machine.listMachines(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines', tag: 'Kitar', summary: 'Put a recycling machine at a kiosk', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(80, 3), kioskId: zId }),
    handler: (c) => machine.createMachine(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/status', tag: 'Kitar', summary: 'Mark a machine online, full or offline', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['ONLINE', 'FULL', 'OFFLINE']) }),
    handler: (c) => machine.setMachineStatus(c.db, c.actor, c.params.machineId!, c.body.status, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/machines/:machineId/screen', tag: 'Kitar', summary: "Prototype: the machine's screen (rotating code and the session in progress)", auth: 'session', roles: STAFF,
    handler: (c) => machine.machineScreen(c.db, c.actor, c.params.machineId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/start', tag: 'Kitar', summary: 'Prototype: the machine reads a KITA QR, or a guest taps "Recycle as guest"', auth: 'session', roles: STAFF,
    body: z.object({ mode: z.enum(['MEMBER_QR', 'GUEST']), memberCode: z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/).optional() }),
    handler: (c) => machine.simulateStart(c.db, c.actor, c.params.machineId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/items', tag: 'Kitar', summary: "Prototype: the machine's camera, barcode reader and scale report one item", auth: 'session', roles: STAFF,
    rateLimit: { limit: 240, windowSec: 60, by: 'user' },
    body: z.object({ material: z.enum(MATERIALS), outcome: z.enum(['ACCEPT', 'WRONG_MATERIAL', 'NOT_TAKEN']).default('ACCEPT') }),
    handler: (c) => machine.simulateItem(c.db, c.actor, c.params.machineId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/kitar/machines/:machineId/finish', tag: 'Kitar', summary: "Prototype: the machine signs its summary and closes the session", auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => machine.simulateFinish(c.db, c.actor, c.params.machineId!, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/start', tag: 'Kitar', summary: 'Device: start a session (KITA QR read, or guest); signed by the machine', auth: 'machine',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    body: z.object({ machineId: zId, mode: z.enum(['MEMBER_QR', 'GUEST']), memberCode: z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/).nullable(), ts: z.iso.datetime(), signature: zSignature }),
    handler: (c) => machine.ingestStart(c.db, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/items', tag: 'Kitar', summary: 'Device: one item recognised, counted and weighed; signed by the machine', auth: 'machine',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({
      machineId: zId, sessionId: zId, seq: z.number().int().min(1).max(1000), material: z.enum(MATERIALS), cameraMaterial: z.enum(MATERIALS).nullable(),
      barcodeOk: z.boolean(), weightG: z.number().int().min(1).max(5000), accepted: z.boolean(), ts: z.iso.datetime(), signature: zSignature,
    }),
    handler: (c) => machine.ingestItem(c.db, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/kitar/finish', tag: 'Kitar', summary: "Device: the session's summary, which must match the items; signed by the machine", auth: 'machine',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    body: z.object({
      machineId: zId, sessionId: zId, acceptedCount: z.number().int().min(0).max(1000), rejectedCount: z.number().int().min(0).max(1000),
      acceptedG: z.number().int().min(0).max(50_000), ts: z.iso.datetime(), signature: zSignature,
    }),
    handler: (c) => machine.ingestFinish(c.db, c.body, c.now),
  }),
];
