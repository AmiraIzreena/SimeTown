import { z } from 'zod';
import { ADMINS, STAFF } from '@/shared/domain';
import { INCIDENT_STATUSES, PRIORITIES, REPORT_CONTEXTS, RESOLUTION_CATEGORIES } from '@/shared/incidents';
import { forbidden, notFound } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import { verifySupportChannel } from './courier-support';
import { runIncidentChecks } from './checks';
import * as engine from './engine';
import * as queries from './queries';
import { reportProblem, submitCourierTicket } from './triage';

const MODULES = ['LOCKERS', 'PARCELS', 'GUARDHOUSE', 'COURIERS', 'FACILITIES', 'COMMUNITY'] as const;
const zReference = z.string().regex(/^INC-\d{6,}$/, 'A case reference such as INC-000123.');
const zTarget = z.object({ assign: z.number().int().min(1).max(60 * 24 * 30), resolve: z.number().int().min(2).max(60 * 24 * 90), working: z.boolean() });

export const incidentRoutes = [
  // --- Reporting a problem -------------------------------------------------------------------------
  route({
    method: 'POST', path: '/incidents/report', tag: 'Incidents', summary: 'Report a problem: sent to the courier company, filed for the township, or checked against the township’s records first', auth: 'session', roles: ['RESIDENT', 'COURIER'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({
      context: z.enum(REPORT_CONTEXTS), reason: z.string().max(40), lockerParcelId: zId.optional(), guardParcelId: zId.optional(), trackingNo: z.string().trim().max(60).optional(),
      companyId: zId.optional(), stationId: zId.optional(), note: z.string().trim().max(1000).optional(), confirm: z.boolean().optional(),
    }),
    handler: (c) => reportProblem(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/incidents/mine', tag: 'Incidents', summary: 'My reports, with what the township office told me, and my courier referrals', auth: 'session', roles: ['RESIDENT', 'COURIER'],
    handler: (c) => queries.myReports(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/incidents/mine/:reference/reply', tag: 'Incidents', summary: 'Answer the township office’s question about my report', auth: 'session', roles: ['RESIDENT', 'COURIER'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ body: zText(1000, 2) }),
    handler: (c) => engine.replyToIncident(c.db, c.actor, z.string().parse(c.params.reference), c.body.body, c.now),
  }),
  route({
    method: 'POST', path: '/incidents/mine/:reference/reopen', tag: 'Incidents', summary: 'Not fixed: reopen my report within the township’s window (the admins are told)', auth: 'session', roles: ['RESIDENT', 'COURIER'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ reason: zText(500, 5) }),
    handler: (c) => engine.reopenIncident(c.db, c.actor, zReference.parse(c.params.reference), c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/incidents/referrals/:referralId/ticket', tag: 'Incidents', summary: 'Simulated courier companies only: file the complaint in the company’s (simulated) ticket system', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: (c) => submitCourierTicket(c.db, c.actor, c.params.referralId!, c.now),
  }),

  // --- The township's board ----------------------------------------------------------------------
  route({
    method: 'GET', path: '/admin/incidents', tag: 'Incidents', summary: 'All the township’s cases with counts and filters (Lapor’s reports listed alongside, read-only)', auth: 'session', roles: STAFF,
    query: z.object({
      module: z.enum([...MODULES, 'LAPOR']).optional(), modules: z.string().max(100).optional(), status: z.enum([...INCIDENT_STATUSES, 'ACTIVE', 'ALL']).optional(),
      priority: z.enum(PRIORITIES).optional(), owner: z.string().max(40).optional(), overdue: z.enum(['true', 'false']).optional(),
      from: z.iso.date().optional(), to: z.iso.date().optional(), q: z.string().max(60).optional(),
      disputedHandovers30d: z.enum(['true', 'false']).optional(),
    }),
    handler: (c) => queries.incidentBoard(c.db, c.actor, {
      ...c.query, overdue: c.query.overdue === 'true',
      disputedHandovers30d: c.query.disputedHandovers30d === 'true',
      modules: c.query.modules ? (c.query.modules.split(',').filter((m) => (MODULES as readonly string[]).includes(m)) as (typeof MODULES)[number][]) : undefined,
    }, c.now),
  }),
  route({
    method: 'GET', path: '/admin/incidents/policy', tag: 'Incidents', summary: 'How fast each priority must be taken and resolved (proposed values)', auth: 'session', roles: STAFF,
    handler: (c) => queries.getPolicyForTownship(c.db, c.actor),
  }),
  route({
    method: 'PATCH', path: '/admin/incidents/policy', tag: 'Incidents', summary: 'Change the case deadlines, working hours, holidays and the reopening window', auth: 'session', roles: ADMINS,
    body: z.object({
      targets: z.object({ CRITICAL: zTarget, HIGH: zTarget, NORMAL: zTarget, LOW: zTarget }),
      workday_start: z.number().int().min(0).max(23), workday_end: z.number().int().min(1).max(24), workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      holidays: z.array(z.iso.date()).max(60), dispute_days: z.number().int().min(1).max(60),
    }),
    handler: (c) => queries.saveIncidentPolicy(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/run-checks', tag: 'Incidents', summary: 'Run the deadline checks now (the scheduler runs them every 5 minutes)', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => runIncidentChecks(c.db, c.now, c.actor.townshipId),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/support', tag: 'Incidents', summary: 'Record a courier company’s support channel after checking it with the company', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(120, 2), url: z.url().startsWith('https://').max(300).nullable().optional(), phone: z.string().trim().max(30).nullable().optional() }),
    handler: async (c) => {
      await verifySupportChannel(c.db, c.actor.id, c.params.companyId!, c.body, c.now);
      return { ok: true };
    },
  }),
  route({
    method: 'GET', path: '/admin/incidents/by-reference/:reference', tag: 'Incidents', summary: 'One case in full, found by its reference (as linked from notifications)', auth: 'session', roles: STAFF,
    handler: (c) => {
      if (!/^INC-\d{6,}$/.test(c.params.reference!)) throw notFound('Case');
      return queries.incidentDetail(c.db, c.actor, c.params.reference!);
    },
  }),
  route({
    method: 'GET', path: '/admin/incidents/:id', tag: 'Incidents', summary: 'One case in full: history, escalations and the related records', auth: 'session', roles: STAFF,
    handler: (c) => queries.incidentDetail(c.db, c.actor, c.params.id!),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/claim', tag: 'Incidents', summary: '“I’ll handle this”: take an unassigned case (only one person can)', auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => engine.claimIncident(c.db, c.actor, c.params.id!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/assign', tag: 'Incidents', summary: 'Assign or reassign a case, with a reason when it already has an owner', auth: 'session', roles: ADMINS,
    body: z.object({ ownerId: zId, reason: z.string().trim().max(300).optional() }),
    handler: (c) => engine.assignIncident(c.db, c.actor, c.params.id!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/status', tag: 'Incidents', summary: 'Investigating, or waiting for the courier company, a contractor or someone else', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['INVESTIGATING', 'AWAITING_EXTERNAL_PARTY']), awaiting: z.enum(['COURIER', 'CONTRACTOR', 'OTHER']).optional(), note: z.string().trim().max(500).optional() }),
    handler: (c) => engine.setIncidentStatus(c.db, c.actor, c.params.id!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/note', tag: 'Incidents', summary: 'An investigation note only staff see', auth: 'session', roles: STAFF,
    body: z.object({ body: zText(2000, 2) }),
    handler: (c) => engine.addIncidentNote(c.db, c.actor, c.params.id!, c.body.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/update-resident', tag: 'Incidents', summary: 'Send the reporter an update (they are notified)', auth: 'session', roles: STAFF,
    body: z.object({ body: zText(1000, 5) }),
    handler: (c) => engine.updateResident(c.db, c.actor, c.params.id!, c.body.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/request-info', tag: 'Incidents', summary: 'Ask the reporter for more details; the case waits for their answer', auth: 'session', roles: STAFF,
    body: z.object({ question: zText(1000, 5) }),
    handler: (c) => engine.requestInfo(c.db, c.actor, c.params.id!, c.body.question, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/escalate', tag: 'Incidents', summary: 'Ask an admin to step in (the owner keeps the case)', auth: 'session', roles: STAFF,
    body: z.object({ note: zText(500, 5) }),
    handler: (c) => engine.requestEscalation(c.db, c.actor, c.params.id!, c.body.note, c.now),
  }),
  route({
    method: 'POST', path: '/admin/incidents/:id/resolve', tag: 'Incidents', summary: 'Record the outcome and tell the reporter; never unlocks, issues codes or changes the parcel', auth: 'session', roles: STAFF,
    body: z.object({ category: z.enum(RESOLUTION_CATEGORIES), outcome: zText(1000, 5), actionsTaken: zText(1000, 3), internalNote: z.string().trim().max(2000).optional() }),
    handler: (c) => {
      if (!STAFF.includes(c.actor.role)) throw forbidden();
      return engine.resolveIncident(c.db, c.actor, c.params.id!, c.body, c.now);
    },
  }),
];
