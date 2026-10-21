import { z } from 'zod';
import { REPORT_CATEGORIES, REPORT_STATUSES, STAFF, URGENCIES } from '@/shared/domain';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { pageQuery } from '../../http/pagination';
import { route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as issues from './issues';
import * as reports from './service';

// Messages a resident can act on, also when a field is left empty (never the validator's own wording).
const DESCRIBE = 'Please describe the problem in a few words.';
const WHERE = 'Please say where it is: a street, landmark or nearest house.';
const reportFields = z.object({
  description: z.string({ error: DESCRIBE }).trim().min(5, DESCRIBE).max(1000, 'Please keep the description under 1,000 characters.'),
  locationText: z.string({ error: WHERE }).trim().min(3, WHERE).max(160, 'Please keep the place under 160 characters.'),
  zoneId: zId.optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  // 'new', or the issue the resident agreed it belongs to. Absent: look for a matching issue first.
  issue: z.union([z.literal('new'), zId]).optional(),
});
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const reportRoutes = [
  route({
    method: 'POST', path: '/reports', tag: 'Lapor', summary: 'Report a hazard or access barrier (multipart form; optional photo). Without "issue", a likely matching issue is returned first ({ needsChoice, issue, alreadyYours }) and nothing is saved', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor); // before the upload is read
      const form = await readForm(c.req);
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const parsed = reportFields.safeParse({ description: text('description'), locationText: text('locationText'), zoneId: text('zoneId'), category: text('category'), issue: text('issue') });
      if (!parsed.success) throw badRequest('Please describe the problem and where it is.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      const { issue, ...fields } = parsed.data;
      if (!issue) {
        const match = await issues.findIssueMatch(c.db, c.actor, fields, c.now);
        if (match) return { needsChoice: true, ...match };
      }
      return reports.createReport(c.db, c.actor, { ...fields, issueId: issue && issue !== 'new' ? issue : undefined, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'GET', path: '/reports', tag: 'Lapor', summary: 'My reports and the ones I follow (resident) or the township queue (staff)', auth: 'session', roles: ['RESIDENT', ...STAFF],
    query: pageQuery.extend({
      status: z.enum(REPORT_STATUSES).optional(),
      // Residents only: the Lapor list as Ongoing / Finished, by type, mine or followed, and searchable.
      view: z.enum(reports.LAPOR_VIEWS).optional(), category: z.enum(REPORT_CATEGORIES).optional(),
      who: z.enum(reports.LAPOR_WHO).optional(), q: z.string().trim().max(60).optional(),
    }),
    handler: (c) => (c.query.view && !STAFF.includes(c.actor.role)
      ? reports.myLaporReports(c.db, c.actor, { ...c.query, view: c.query.view }, c.now)
      : reports.listReports(c.db, c.actor, c.query, c.now)),
  }),
  route({
    method: 'GET', path: '/report-issues', tag: 'Lapor', summary: "Public issues in my township (enough residents affected): written title, type, area, status and dates only, with the township's figures", auth: 'session', roles: ['RESIDENT'],
    query: pageQuery.extend({
      view: z.enum(issues.AROUND_VIEWS).default('open'), category: z.enum(REPORT_CATEGORIES).optional(),
      following: z.enum(['true', 'false']).optional().transform((value) => value === 'true'), q: z.string().trim().max(60).optional(),
    }),
    handler: (c) => issues.townshipIssues(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/report-issues/similar', tag: 'Lapor', summary: 'Public open issues that look like the report being written, to tap "Me too" instead', auth: 'session', roles: ['RESIDENT'],
    query: z.object({ text: z.string().trim().max(1200).default(''), category: z.enum(REPORT_CATEGORIES).optional(), zoneId: zId.optional() }),
    handler: (c) => issues.similarIssues(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/report-issues/attention', tag: 'Lapor', summary: 'Open issues that reached the public threshold or are urgent, with their reports (Needs attention)', auth: 'session', roles: STAFF,
    handler: (c) => issues.attentionIssues(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/report-issues/:issueId/me-too', tag: 'Lapor', summary: 'Say "Me too" on an issue (follow it and count as affected; no XP)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ on: z.boolean().default(true) }),
    handler: (c) => issues.setIssueMeToo(c.db, c.actor, c.params.issueId!, c.body.on, c.now),
  }),
  route({
    method: 'PATCH', path: '/report-issues/:issueId', tag: 'Lapor', summary: 'Staff update every open report in an issue at once, or correct its public title (logged)', auth: 'session', roles: STAFF,
    body: z.object({
      status: z.enum(REPORT_STATUSES).optional(), category: z.enum(REPORT_CATEGORIES).optional(),
      urgency: z.enum(URGENCIES).optional(), staffNote: zText(500).optional(),
      assignedTo: z.string().trim().max(80).optional(), targetDate: zDay.nullable().optional(),
      title: z.string().trim().max(80).optional(), titleMs: z.string().trim().max(80).optional(),
    }),
    handler: (c) => issues.updateIssue(c.db, c.actor, c.params.issueId!, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/reports/similar', tag: 'Lapor', summary: 'Open reports that look like the one about to be sent, to tap "Me too" instead', auth: 'session', roles: ['RESIDENT'],
    query: z.object({ text: z.string().trim().max(1200).default(''), category: z.enum(REPORT_CATEGORIES).optional(), zoneId: zId.optional() }),
    handler: (c) => reports.similarReports(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/reports/stats', tag: 'Lapor', summary: 'Open, late, duplicates avoided and time to fix (the one-channel test)', auth: 'session', roles: STAFF,
    handler: (c) => reports.reportStats(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/reports/:reportId', tag: 'Lapor', summary: 'One report', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => reports.getReport(c.db, c.actor, c.params.reportId!, c.now),
  }),
  route({
    method: 'GET', path: '/reports/:reportId/photo', tag: 'Lapor', summary: "The report's photo (reporter and township staff only)", auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => reports.getReportPhoto(c.db, c.actor, c.params.reportId!),
  }),
  route({
    method: 'GET', path: '/reports/:reportId/fixed-photo', tag: 'Lapor', summary: 'The photo staff took once it was fixed (reporter, followers and staff)', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => reports.getFixedPhoto(c.db, c.actor, c.params.reportId!),
  }),
  route({
    method: 'POST', path: '/reports/:reportId/me-too', tag: 'Lapor', summary: 'Follow a report about the same problem instead of filing another (no XP)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ on: z.boolean().default(true) }),
    handler: (c) => reports.setMeToo(c.db, c.actor, c.params.reportId!, c.body.on, c.now),
  }),
  route({
    method: 'PATCH', path: '/reports/:reportId', tag: 'Lapor', summary: 'Staff update status, type, urgency, note, who is fixing it and the target date (corrections to the AI are logged)', auth: 'session', roles: STAFF,
    body: z.object({
      status: z.enum(REPORT_STATUSES).optional(), category: z.enum(REPORT_CATEGORIES).optional(),
      urgency: z.enum(URGENCIES).optional(), staffNote: zText(500).optional(),
      assignedTo: z.string().trim().max(80).optional(), targetDate: zDay.nullable().optional(),
    }),
    handler: (c) => reports.updateReport(c.db, c.actor, c.params.reportId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/reports/:reportId/fixed-photo', tag: 'Lapor', summary: 'Staff attach a photo of the fix (multipart form)', auth: 'session', roles: STAFF,
    handler: async (c) => {
      const photo = await readPhoto(await readForm(c.req));
      if (!photo) throw badRequest('Add a photo of the fix.');
      return reports.setFixedPhoto(c.db, c.actor, c.params.reportId!, photo, c.now);
    },
  }),
];
