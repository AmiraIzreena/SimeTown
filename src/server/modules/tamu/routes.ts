import { z } from 'zod';
import { CITIZENSHIPS, HOST_REPLIES, PASS_TYPES, STAFF, TRANSPORT_MODES, VISIT_REASONS, type Role } from '@/shared/domain';
import { notFound } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import * as tamu from './service';

/** Guards work the gate; township staff and admins can cover for them. */
const GATE: Role[] = ['GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN'];
const zVehicle = z.string().trim().max(12).regex(/^[A-Za-z0-9 ]*$/, 'Letters and numbers only.').optional();
const zVisitor = zText(80, 2);
const zPassCode = z.string().trim().min(6).max(24).regex(/^[A-Za-z0-9:]+$/, 'Check the code.');
/** Visitor details (BR26, revised). Which are required depends on who gives them; the service checks that. */
const zDetails = {
  citizenship: z.enum(CITIZENSHIPS).optional(),
  idNumber: z.string().trim().max(30).optional(),
  transport: z.enum(TRANSPORT_MODES).optional(),
  vehicleNo: zVehicle,
  licenceExpiry: z.iso.date().optional(),
  reason: z.enum(VISIT_REASONS).optional(),
  reasonOther: z.string().trim().max(80).optional(),
};

export const tamuRoutes = [
  route({
    method: 'GET', path: '/tamu', tag: 'Tamu', summary: "My home's visitor passes, visits and walk-ins waiting for an answer", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => tamu.tamuOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/tamu/passes', tag: 'Tamu', summary: 'Create a visitor pass with the visitor’s details (the identity may be left for the visitor); the link is returned once', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ type: z.enum(PASS_TYPES), visitorName: zVisitor, validFrom: z.coerce.date(), validUntil: z.coerce.date(), ...zDetails, identityByVisitor: z.boolean().default(false) }),
    handler: ({ body: { identityByVisitor, ...input }, ...c }) => tamu.createPass(c.db, c.actor, input, c.now, { complete: { identityByVisitor } }),
  }),
  route({
    method: 'POST', path: '/tamu/passes/:passId/link', tag: 'Tamu', summary: 'A fresh link for a pass (the old link stops working)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' }, body: emptyBody,
    handler: (c) => tamu.renewPassLink(c.db, c.actor, c.params.passId!, c.now),
  }),
  route({
    method: 'POST', path: '/tamu/passes/:passId/cancel', tag: 'Tamu', summary: 'Cancel a pass', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => tamu.cancelPass(c.db, c.actor, c.params.passId!),
  }),
  route({
    method: 'POST', path: '/tamu/entries/:entryId/reply', tag: 'Tamu', summary: 'Answer the guard about a walk-in visitor', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ reply: z.enum(HOST_REPLIES) }),
    handler: (c) => tamu.replyToWalkIn(c.db, c.actor, c.params.entryId!, c.body.reply, c.now),
  }),
  route({
    method: 'POST', path: '/tamu/sos', tag: 'Tamu', summary: 'SOS to the guardhouse', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 5, windowSec: 600, by: 'user' }, body: emptyBody,
    handler: (c) => tamu.raiseSos(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/passes/:token', tag: 'Tamu', summary: "A visitor's pass from their link (no sign-in; street only, never the house)", auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: async (c) => {
      if (!/^[A-Za-z0-9_-]{30,100}$/.test(c.params.token!)) throw notFound('Pass');
      return tamu.publicPass(c.db, c.params.token!, c.now);
    },
  }),
  route({
    method: 'POST', path: '/passes/:token/details', tag: 'Tamu', summary: 'The visitor gives the details their host left for them, from their link (no sign-in)', auth: 'public',
    rateLimit: { limit: 10, windowSec: 600, by: 'ip' },
    body: z.object({ ...zDetails, consent: z.literal(true, 'Please agree before sending your details.') }),
    // The agreement is required above; the service takes only the details still missing.
    handler: async (c) => {
      if (!/^[A-Za-z0-9_-]{30,100}$/.test(c.params.token!)) throw notFound('Pass');
      return tamu.completePassDetails(c.db, c.params.token!, c.body, c.now);
    },
  }),
  route({
    method: 'GET', path: '/guard', tag: 'Tamu', summary: "The guard's screen: today's gate log, SOS calls, patrol and flood tasks", auth: 'session', roles: GATE,
    handler: (c) => tamu.guardOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/guard/scan', tag: 'Tamu', summary: "Scan a visitor's pass; if details are missing or the licence has expired, scan again with them. The host is told at once", auth: 'session', roles: GATE,
    body: z.object({ code: zPassCode, details: z.object(zDetails).optional() }),
    handler: (c) => tamu.scanPass(c.db, c.actor, c.body.code, c.now, c.body.details),
  }),
  route({
    method: 'POST', path: '/guard/walk-ins', tag: 'Tamu', summary: 'Log a visitor without a pass, with their details and the house (an expired driving licence is refused)', auth: 'session', roles: GATE,
    body: z.object({ visitorName: zVisitor, homeId: zId, ...zDetails }),
    handler: (c) => tamu.logWalkIn(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/guard/entries/:entryId/exit', tag: 'Tamu', summary: 'Log that a visitor has left', auth: 'session', roles: GATE, body: emptyBody,
    handler: (c) => tamu.logExit(c.db, c.actor, c.params.entryId!, c.now),
  }),
  route({
    method: 'POST', path: '/guard/sos/:sosId', tag: 'Tamu', summary: 'Acknowledge or close an SOS call', auth: 'session', roles: GATE,
    body: z.object({ close: z.boolean().default(false) }),
    handler: (c) => tamu.acknowledgeSos(c.db, c.actor, c.params.sosId!, c.body.close, c.now),
  }),
  route({
    method: 'POST', path: '/guard/patrol', tag: 'Tamu', summary: 'Scan a patrol point on a round', auth: 'session', roles: GATE,
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ code: z.string().trim().min(6).max(16).regex(/^[A-Za-z0-9]+$/, 'Check the code.') }),
    handler: (c) => tamu.scanPatrolPoint(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'GET', path: '/admin/patrol-points', tag: 'Tamu', summary: 'Patrol points with their printable codes', auth: 'session', roles: STAFF,
    handler: (c) => tamu.listPatrolPointsForStaff(c.db, c.actor),
  }),
];
