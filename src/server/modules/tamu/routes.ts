import { z } from 'zod';
import { HOST_REPLIES, PASS_TYPES, STAFF, type Role } from '@/shared/domain';
import { notFound } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import * as tamu from './service';

/** Guards work the gate; township staff and admins can cover for them. */
const GATE: Role[] = ['GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN'];
const zVehicle = z.string().trim().max(12).regex(/^[A-Za-z0-9 ]*$/, 'Letters and numbers only.').optional();
const zVisitor = zText(80, 2);
const zPassCode = z.string().trim().min(6).max(24).regex(/^[A-Za-z0-9:]+$/, 'Check the code.');

export const tamuRoutes = [
  route({
    method: 'GET', path: '/tamu', tag: 'Tamu', summary: "My home's visitor passes, visits and walk-ins waiting for an answer", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => tamu.tamuOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/tamu/passes', tag: 'Tamu', summary: 'Create a visitor pass; the link is returned once', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ type: z.enum(PASS_TYPES), visitorName: zVisitor, vehicleNo: zVehicle, validFrom: z.coerce.date(), validUntil: z.coerce.date() }),
    handler: (c) => tamu.createPass(c.db, c.actor, c.body, c.now),
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
    method: 'GET', path: '/guard', tag: 'Tamu', summary: "The guard's screen: today's gate log, SOS calls, patrol and flood tasks", auth: 'session', roles: GATE,
    handler: (c) => tamu.guardOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/guard/scan', tag: 'Tamu', summary: "Scan a visitor's pass; the host is told at once", auth: 'session', roles: GATE,
    body: z.object({ code: zPassCode }),
    handler: (c) => tamu.scanPass(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'POST', path: '/guard/walk-ins', tag: 'Tamu', summary: 'Log a visitor without a pass (name, vehicle, house; never an IC)', auth: 'session', roles: GATE,
    body: z.object({ visitorName: zVisitor, vehicleNo: zVehicle, homeId: zId }),
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
