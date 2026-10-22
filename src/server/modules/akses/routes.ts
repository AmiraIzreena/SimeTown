import { z } from 'zod';
import { ACCESS_NEEDS, ADMINS, PLACE_KINDS, STAFF } from '@/shared/domain';
import { ACCESS_CATEGORIES, ACCESS_INCIDENT_STATUSES, PARTY_KINDS } from '@/shared/akses';
import { PRIORITIES } from '@/shared/incidents';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import type { Db } from '../../db/client';
import { resolveTownship } from '../townships';
import { badRequest } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as akses from './service';
import { runAccessChecks } from './automation';
import * as config from './config';
import * as incidents from './incidents';
import { simulateProvider } from './integrations';
import * as places from './places';
import * as queries from './queries';

const placeBody = z.object({ name: zText(100, 3), kind: z.enum(PLACE_KINDS), location: zText(160, 3), note: zText(300).optional() });
const zReason = zText(300, 5);

/**
 * Runs a change that may unblock incidents waiting without a team (a place given a team, a team added or given
 * a member, a rule or the default team changed), then routes those incidents again straight away.
 */
async function withReroute<T>(c: { db: Db; actor: Actor; now: Date }, run: () => Promise<T>): Promise<T> {
  const result = await run();
  await incidents.rerouteWaiting(c.db, c.actor.townshipId ?? null, c.now);
  return result;
}

/** Reads the text fields of a multipart form with a schema, the way JSON bodies are checked. */
function formFields<T>(form: FormData, schema: z.ZodType<T>, names: string[]): T {
  const raw = Object.fromEntries(names.map((n) => {
    const v = form.get(n);
    return [n, typeof v === 'string' && v.trim() ? v : undefined];
  }));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest('Please check the highlighted fields.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
  return parsed.data;
}

const PARTY_ROLES = [...STAFF, 'GUARD'] as const;

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

  // --- Accessible places: residents ---------------------------------------------------------------
  route({
    method: 'GET', path: '/access-places', tag: 'Akses+', summary: 'Accessible places: verification and today’s availability, kept separate', auth: 'session', roles: ['RESIDENT', ...STAFF],
    query: z.object({ archived: z.enum(['true', 'false']).optional() }),
    handler: (c) => places.listPlaces(c.db, c.actor, { archived: c.query.archived === 'true' }),
  }),
  route({
    method: 'POST', path: '/access-places', tag: 'Akses+', summary: 'Suggest an accessible place (checked for duplicates; verified only by an inspection)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: placeBody,
    handler: (c) => places.suggestPlace(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/access-places/:placeId/reports', tag: 'Akses+', summary: 'Report a problem at a place (multipart form; optional photo). Grouped, classified and routed automatically', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor); // before the upload is read
      const form = await readForm(c.req);
      const fields = formFields(form, z.object({
        category: z.enum(ACCESS_CATEGORIES), description: zText(500, 3).optional(), idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
      }), ['category', 'description', 'idempotencyKey']);
      return incidents.reportIssue(c.db, c.actor, c.params.placeId!, { ...fields, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'POST', path: '/access-places/:placeId/follow', tag: 'Akses+', summary: 'Follow a place to hear when it is blocked or available again', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ follow: z.boolean() }),
    handler: (c) => places.followPlace(c.db, c.actor, c.params.placeId!, c.body.follow, c.now),
  }),
  route({
    method: 'GET', path: '/me/access-reports', tag: 'Akses+', summary: 'My accessibility reports and their progress', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => queries.myAccessReports(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/access-incidents/:reference/confirm', tag: 'Akses+', summary: 'Say whether a claimed fix is real (multipart form; optional photo)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor);
      const form = await readForm(c.req);
      const fields = formFields(form, z.object({ answer: z.enum(['CLEAR', 'STILL_BLOCKED']), note: zText(300, 3).optional() }), ['answer', 'note']);
      return incidents.confirmFix(c.db, c.actor, c.params.reference!, { ...fields, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'POST', path: '/access-incidents/:reference/reopen', tag: 'Akses+', summary: 'The problem is back: reopen a resolved incident I reported', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ reason: zReason }),
    handler: (c) => incidents.disputeResolved(c.db, c.actor, c.params.reference!, c.body.reason, c.now),
  }),
  route({
    method: 'GET', path: '/access-photos/:uploadId', tag: 'Akses+', summary: 'An evidence photo (who may see it depends on what it shows)', auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    handler: (c) => places.getAccessPhoto(c.db, c.actor, c.params.uploadId!),
  }),

  // --- The responsible party's work queue (staff or guards who belong to it) ---------------------------
  route({
    method: 'GET', path: '/access-work', tag: 'Akses+', summary: 'Accessibility incidents routed to the teams I belong to', auth: 'session', roles: PARTY_ROLES,
    handler: (c) => queries.partyWork(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/access-work/:incidentId/acknowledge', tag: 'Akses+', summary: 'Confirm the problem and start work', auth: 'session', roles: PARTY_ROLES, body: emptyBody,
    handler: (c) => c.db.tx((tx) => incidents.acknowledgeIncident(tx, { kind: 'USER', actor: c.actor }, c.params.incidentId!, c.now)),
  }),
  route({
    method: 'POST', path: '/access-work/:incidentId/resolve', tag: 'Akses+', summary: 'Submit a fix with evidence (multipart form; photo needed for most problems). It is verified before it counts', auth: 'session', roles: PARTY_ROLES,
    handler: async (c) => {
      const form = await readForm(c.req);
      const fields = formFields(form, z.object({ actionTaken: zText(500, 5) }), ['actionTaken']);
      const photo = await readPhoto(form);
      return c.db.tx((tx) => incidents.submitResolution(tx, { kind: 'USER', actor: c.actor }, c.params.incidentId!, { ...fields, photo }, c.now));
    },
  }),

  // --- The SDP console: exceptions, verification and set-up ------------------------------------------
  route({
    method: 'GET', path: '/admin/access/overview', tag: 'Akses+', summary: 'Accessibility metrics and only what needs a person', auth: 'session', roles: STAFF,
    handler: (c) => queries.accessOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/admin/access/incidents', tag: 'Akses+', summary: 'Accessibility incidents, with filters', auth: 'session', roles: STAFF,
    query: z.object({ status: z.enum([...ACCESS_INCIDENT_STATUSES, 'ACTIVE', 'ALL']).optional(), priority: z.enum(PRIORITIES).optional(), partyId: zId.optional(), q: z.string().max(60).optional() }),
    handler: (c) => queries.listAccessIncidents(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/admin/access/incidents/:key', tag: 'Akses+', summary: 'One incident (by id or ACC- reference): reports, evidence, fixes, escalations, deliveries and history', auth: 'session', roles: STAFF,
    handler: (c) => queries.accessIncidentDetail(c.db, c.actor, c.params.key!),
  }),
  route({
    method: 'POST', path: '/admin/access/incidents/:incidentId/assign', tag: 'Akses+', summary: 'Send an unroutable or escalated incident to an organisation', auth: 'session', roles: ADMINS,
    body: z.object({ partyId: zId, reason: zReason }),
    handler: (c) => incidents.assignParty(c.db, c.actor, c.params.incidentId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access/incidents/:incidentId/verify', tag: 'Akses+', summary: 'Accept or reject a claimed fix after an inspection', auth: 'session', roles: STAFF,
    body: z.object({ accept: z.boolean(), note: zReason }),
    handler: (c) => incidents.verifyResolution(c.db, c.actor, c.params.incidentId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access/incidents/:incidentId/override', tag: 'Akses+', summary: 'Confirm a problem seen on site, or (admin) close an incident, with a reason', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['CONFIRM_BLOCKED', 'RESOLVE']), reason: zReason }),
    handler: (c) => incidents.overrideIncident(c.db, c.actor, c.params.incidentId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access/incidents/:incidentId/simulate', tag: 'Akses+', summary: 'SIMULATION: make a simulated provider acknowledge or fix (prototype only)', auth: 'session', roles: ADMINS,
    body: z.object({ type: z.enum(['ACKNOWLEDGED', 'RESOLVED']), telemetry: z.boolean().optional(), actionTaken: zText(300, 3).optional(), eventId: z.string().min(8).max(64).optional() }),
    handler: (c) => simulateProvider(c.db, c.actor, c.params.incidentId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access/run-checks', tag: 'Akses+', summary: 'Run the Akses+ reminders, escalations and deliveries now for my township (the scheduler also runs them)', auth: 'session', roles: ADMINS, body: emptyBody,
    rateLimit: { limit: 20, windowSec: 600, by: 'user' },
    handler: async (c) => runAccessChecks(c.db, c.now, await resolveTownship(c.db, c.actor)),
  }),
  route({
    method: 'POST', path: '/admin/access-places', tag: 'Akses+', summary: 'Add a place staff have checked (verified, with its first inspection)', auth: 'session', roles: STAFF,
    body: placeBody.extend({ partyId: zId.nullable().optional() }),
    handler: (c) => withReroute(c, () => places.createPlace(c.db, c.actor, c.body, c.now)),
  }),
  route({
    method: 'POST', path: '/admin/access-places/:placeId/inspect', tag: 'Akses+', summary: 'Record an inspection: the only way verification changes (multipart form; optional photo)', auth: 'session', roles: STAFF,
    handler: async (c) => {
      const form = await readForm(c.req);
      const fields = formFields(form, z.object({ outcome: z.enum(['VERIFIED', 'NOT_VERIFIED', 'VERIFICATION_REQUIRED']), note: zText(500, 3) }), ['outcome', 'note']);
      return places.inspectPlace(c.db, c.actor, c.params.placeId!, { ...fields, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'POST', path: '/admin/access-places/:placeId/party', tag: 'Akses+', summary: 'Record which organisation runs a place', auth: 'session', roles: ADMINS,
    body: z.object({ partyId: zId.nullable() }),
    handler: (c) => withReroute(c, () => places.setPlaceParty(c.db, c.actor, c.params.placeId!, c.body.partyId)),
  }),
  route({
    method: 'POST', path: '/admin/access-places/:placeId/archive', tag: 'Akses+', summary: 'Archive a place (kept with its history; never deleted)', auth: 'session', roles: ADMINS,
    body: z.object({ reason: zReason }),
    handler: (c) => places.archivePlace(c.db, c.actor, c.params.placeId!, c.body.reason, c.now),
  }),
  route({
    method: 'POST', path: '/admin/access-places/:placeId/restore', tag: 'Akses+', summary: 'Bring an archived place back', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => places.restorePlace(c.db, c.actor, c.params.placeId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/access/parties', tag: 'Akses+', summary: 'Organisations responsible for facilities, and who acts for them', auth: 'session', roles: STAFF,
    handler: async (c) => {
      const townshipId = await resolveTownship(c.db, c.actor);
      return {
        parties: await config.listParties(c.db, townshipId),
        changes: await config.configChanges(c.db, townshipId),
        people: await c.db.query(`SELECT id, full_name, role FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'GUARD') AND status = 'ACTIVE' ORDER BY full_name`, [townshipId]),
      };
    },
  }),
  route({
    method: 'POST', path: '/admin/access/parties', tag: 'Akses+', summary: 'Add an organisation', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(100, 3), kind: z.enum(PARTY_KINDS), integration: z.enum(['IN_APP', 'SIMULATED']), contact: zText(160).optional() }),
    handler: (c) => withReroute(c, () => config.createParty(c.db, c.actor, c.body)),
  }),
  route({
    method: 'POST', path: '/admin/access/parties/:partyId', tag: 'Akses+', summary: 'Change an organisation: active, members, simulated failures', auth: 'session', roles: ADMINS,
    body: z.object({ active: z.boolean().optional(), simulateFailures: z.number().int().min(0).max(10).optional(), addMember: zId.optional(), removeMember: zId.optional() }),
    handler: (c) => withReroute(c, () => config.updateParty(c.db, c.actor, c.params.partyId!, c.body)),
  }),
  route({
    method: 'GET', path: '/admin/access/rules', tag: 'Akses+', summary: 'Routing rules that apply (the township’s own, then the defaults)', auth: 'session', roles: STAFF,
    handler: (c) => config.effectiveRules(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/access/rules', tag: 'Akses+', summary: 'Set where a kind of problem goes, and its priority', auth: 'session', roles: ADMINS,
    body: z.object({ category: z.enum(ACCESS_CATEGORIES), placeKind: z.enum(PLACE_KINDS).nullable(), target: z.enum(['PLACE', 'PARTY']), partyId: zId.nullable().optional(), priority: z.enum(PRIORITIES) }),
    handler: (c) => withReroute(c, () => config.saveRule(c.db, c.actor, c.body, c.now)),
  }),
  route({
    method: 'POST', path: '/admin/access/rules/:ruleId/delete', tag: 'Akses+', summary: 'Remove a township rule (the default applies again)', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => withReroute(c, () => config.deleteRule(c.db, c.actor, c.params.ruleId!)),
  }),
  route({
    method: 'GET', path: '/admin/access/policy', tag: 'Akses+', summary: 'Response targets and verification rules (proposed values)', auth: 'session', roles: STAFF,
    handler: async (c) => config.getAccessPolicy(c.db, await resolveTownship(c.db, c.actor)),
  }),
  route({
    method: 'POST', path: '/admin/access/policy', tag: 'Akses+', summary: 'Change response targets and verification rules', auth: 'session', roles: ADMINS,
    body: z.object({
      targets: z.partialRecord(z.enum(PRIORITIES), z.object({ ack: z.number().int().min(5).max(20_160), resolve: z.number().int().min(15).max(86_400), working: z.boolean() })).optional(),
      confirmations: z.partialRecord(z.enum(PRIORITIES), z.number().int().min(1).max(5)).optional(),
      corroboration: z.number().int().min(2).max(10).optional(),
      verifyHours: z.number().int().min(1).max(336).optional(),
      disputeDays: z.number().int().min(1).max(60).optional(),
      // The catch-all team for problems no rule can place; null turns it off.
      defaultPartyId: zId.nullable().optional(),
    }),
    handler: (c) => withReroute(c, () => config.saveAccessPolicy(c.db, c.actor, c.body as never, c.now)),
  }),
];
