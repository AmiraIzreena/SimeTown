import { z } from 'zod';
import { STAFF, type Role } from '@/shared/domain';
import { badRequest } from '../../errors';
import { route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as parcels from './service';
import * as guardhouse from './guardhouse';

/** Guards work the guardhouse; township staff and admins can cover for them. */
const GATE: Role[] = ['GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN'];
/** Reading the guardhouse register: the gate, and HQ across townships. */
const REGISTER_READERS: Role[] = [...GATE, 'HQ_ADMIN'];
const zDate = z.string().regex(/^d{4}-d{2}-d{2}$/, 'Choose a date.');
const zParcelCode = z.string().trim().min(6).max(20).regex(/^[A-Za-z0-9: ]+$/, 'Check the code.');

const parcelFields = z.object({
  homeId: zId,
  courier: zText(40, 2),
  trackingNo: z.string().trim().max(40).optional(),
  shelf: zText(12, 1),
  note: z.string().trim().max(200).optional(),
});

export const parcelRoutes = [
  route({
    method: 'GET', path: '/parcels', tag: 'Parcels', summary: "My home's parcels: waiting ones with their one-time code, and the last 30 days", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => parcels.myParcels(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/parcels/:parcelId/photo', tag: 'Parcels', summary: "The parcel's photo (its household and the gate)", auth: 'session', roles: ['RESIDENT', ...GATE, 'HQ_ADMIN'],
    handler: (c) => parcels.parcelPhoto(c.db, c.actor, c.params.parcelId!),
  }),
  route({
    method: 'POST', path: '/parcels/:parcelId/problem', tag: 'Parcels', summary: 'Say a parcel marked collected never reached you', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ note: z.string().trim().max(300).optional() }),
    handler: (c) => parcels.reportParcelProblem(c.db, c.actor, c.params.parcelId!, c.body.note, c.now),
  }),
  route({
    method: 'GET', path: '/guard/parcels', tag: 'Parcels', summary: 'Every parcel waiting at the guardhouse, oldest first', auth: 'session', roles: GATE,
    handler: (c) => parcels.guardParcels(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/guard/parcels', tag: 'Parcels', summary: 'Log a parcel (multipart form; optional photo). The household gets its code', auth: 'session', roles: GATE,
    rateLimit: { limit: 300, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      const form = await readForm(c.req);
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const parsed = parcelFields.safeParse({ homeId: text('homeId'), courier: text('courier'), trackingNo: text('trackingNo'), shelf: text('shelf'), note: text('note') });
      if (!parsed.success) throw badRequest('Choose the house, the courier and the shelf.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      return parcels.logParcel(c.db, c.actor, { ...parsed.data, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'POST', path: '/guard/parcels/check', tag: 'Parcels', summary: 'Check the code a resident shows: which parcel and shelf', auth: 'session', roles: GATE,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ code: zParcelCode }),
    handler: (c) => parcels.checkParcelCode(c.db, c.actor, c.body.code),
  }),
  route({
    method: 'POST', path: '/guard/parcels/:parcelId/collect', tag: 'Parcels', summary: 'Hand a parcel over against its code (the code then stops working)', auth: 'session', roles: GATE,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ code: zParcelCode, collectedBy: z.string().trim().max(80).optional() }),
    handler: (c) => parcels.handOverParcel(c.db, c.actor, c.params.parcelId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/guard/parcels/:parcelId/return', tag: 'Parcels', summary: 'Send a parcel back to the courier, when the household or the courier asks (with the reason)', auth: 'session', roles: GATE,
    body: z.object({ reason: zText(300, 3) }),
    handler: (c) => parcels.returnParcel(c.db, c.actor, c.params.parcelId!, c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/guard/parcels/:parcelId/notes', tag: 'Parcels', summary: "Add a note to a parcel's history, for example after calling the household", auth: 'session', roles: GATE,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ body: zText(500, 1) }),
    handler: (c) => parcels.addShelfNote(c.db, c.actor, c.params.parcelId!, c.body.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/guardhouse/parcels', tag: 'Parcels', summary: 'The guardhouse register: every parcel held there, searchable and filtered, a page at a time', auth: 'session', roles: REGISTER_READERS,
    query: z.object({
      q: z.string().trim().max(60).optional(),
      show: z.enum(['ALL', 'WAITING', 'OVERDUE', 'CALL_DUE', 'RETURN_PENDING', 'COLLECTED', 'RETURNED']).optional(),
      source: z.enum(['SHELF', 'LOCKER']).optional(),
      courier: z.string().trim().max(60).optional(),
      from: zDate.optional(),
      to: zDate.optional(),
      sort: z.enum(['LONGEST', 'NEWEST']).optional(),
      page: z.coerce.number().int().min(1).max(500).optional(),
    }),
    handler: (c) => guardhouse.guardhouseRegister(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/admin/guardhouse/overview', tag: 'Parcels', summary: 'The guardhouse at a glance: held, overdue, calls due, collected, average days held, room', auth: 'session', roles: REGISTER_READERS,
    handler: (c) => guardhouse.guardhouseOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/admin/guardhouse/parcels/:source/:parcelId', tag: 'Parcels', summary: "One parcel's full history at the guardhouse", auth: 'session', roles: REGISTER_READERS,
    handler: (c) => {
      const source = c.params.source === 'locker' ? 'LOCKER' : c.params.source === 'shelf' ? 'SHELF' : null;
      if (!source) throw badRequest('Unknown parcel kind.');
      return guardhouse.guardhouseParcel(c.db, c.actor, source, c.params.parcelId!, c.now);
    },
  }),
  route({
    method: 'POST', path: '/admin/guardhouse/check', tag: 'Parcels', summary: 'Check any code shown at the guardhouse: a shelf collection code or a smart locker pickup code', auth: 'session', roles: GATE,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ code: z.string().trim().min(6).max(120) }),
    handler: (c) => guardhouse.checkGuardhouseCode(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'GET', path: '/admin/parcels/stats', tag: 'Parcels', summary: 'Waiting, time to collect, same-day share and handovers queried (the parcel test)', auth: 'session', roles: STAFF,
    handler: (c) => parcels.parcelStats(c.db, c.actor, c.now),
  }),
];
