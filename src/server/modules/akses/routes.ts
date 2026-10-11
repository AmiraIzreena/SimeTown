import { z } from 'zod';
import { ACCESS_NEEDS, PLACE_KINDS, STAFF } from '@/shared/domain';
import { emptyBody, route, zText } from '../../http/router';
import * as akses from './service';

const placeBody = z.object({ name: zText(100, 3), kind: z.enum(PLACE_KINDS), location: zText(160, 3), note: zText(300).optional() });

export const aksesRoutes = [
  route({
    method: 'GET', path: '/me/access', tag: 'Akses+', summary: 'My access needs and display choices (private)', auth: 'session',
    handler: (c) => akses.getAccessProfile(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/me/access', tag: 'Akses+', summary: 'Save my access needs and choices (needs and the priority list need consent)', auth: 'session',
    body: z.object({
      needs: z.array(z.enum(ACCESS_NEEDS)).max(ACCESS_NEEDS.length).transform((v) => [...new Set(v)]),
      simpleMode: z.boolean(),
      readAloud: z.boolean(),
      flashAlerts: z.boolean(),
      priorityHelp: z.boolean(),
      priorityNote: zText(200).optional(),
      consent: z.boolean(),
    }),
    handler: (c) => akses.saveAccessProfile(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/me/access/delete', tag: 'Akses+', summary: 'Delete my access needs now (BR32)', auth: 'session', body: emptyBody,
    handler: (c) => akses.deleteAccessProfile(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/carers', tag: 'Akses+', summary: 'My carers, and the people I care for', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => akses.carerOverview(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/carers', tag: 'Akses+', summary: 'Ask another resident (by member code) to be my carer', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ memberCode: z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/, 'Check the member code.') }),
    handler: (c) => akses.inviteCarer(c.db, c.actor, c.body.memberCode, c.now),
  }),
  route({
    method: 'POST', path: '/carers/:linkId/respond', tag: 'Akses+', summary: 'Accept or decline being someone’s carer', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ accept: z.boolean() }),
    handler: (c) => akses.respondToCarerInvite(c.db, c.actor, c.params.linkId!, c.body.accept, c.now),
  }),
  route({
    method: 'POST', path: '/carers/:linkId/end', tag: 'Akses+', summary: 'End a carer link (either side)', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => akses.endCarerLink(c.db, c.actor, c.params.linkId!, c.now),
  }),
  route({
    method: 'GET', path: '/access-places', tag: 'Akses+', summary: 'Step-free routes, ramps, lifts, accessible toilets and OKU parking', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => akses.listPlaces(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/access-places', tag: 'Akses+', summary: 'Suggest an accessible place (staff check it)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: placeBody,
    handler: (c) => akses.suggestPlace(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/access-places/:placeId/blocked', tag: 'Akses+', summary: 'Say an accessible place is blocked', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ note: zText(300, 5) }),
    handler: (c) => akses.reportPlaceBlocked(c.db, c.actor, c.params.placeId!, c.body.note, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access-places', tag: 'Akses+', summary: 'Add a checked accessible place', auth: 'session', roles: STAFF,
    body: placeBody,
    handler: (c) => akses.createPlace(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access-places/:placeId/review', tag: 'Akses+', summary: 'Confirm a place, mark it blocked, or remove it', auth: 'session', roles: STAFF,
    body: z.object({ decision: z.enum(['VERIFIED', 'BLOCKED', 'REMOVE']) }),
    handler: (c) => akses.reviewPlace(c.db, c.actor, c.params.placeId!, c.body.decision, c.now),
  }),
];
