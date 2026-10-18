import { z } from 'zod';
import { REPORT_CATEGORIES, REPORT_STATUSES, STAFF, URGENCIES } from '@/shared/domain';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { pageQuery } from '../../http/pagination';
import { route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as reports from './service';

const reportFields = z.object({
  description: zText(1000, 5),
  locationText: zText(160, 3),
  zoneId: zId.optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
});
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const reportRoutes = [
  route({
    method: 'POST', path: '/reports', tag: 'Lapor', summary: 'Report a hazard or access barrier (multipart form; optional photo)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor); // before the upload is read
      const form = await readForm(c.req);
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const parsed = reportFields.safeParse({ description: text('description'), locationText: text('locationText'), zoneId: text('zoneId'), category: text('category') });
      if (!parsed.success) throw badRequest('Please describe the problem and where it is.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      return reports.createReport(c.db, c.actor, { ...parsed.data, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'GET', path: '/reports', tag: 'Lapor', summary: 'My reports and the ones I follow (resident) or the township queue (staff)', auth: 'session', roles: ['RESIDENT', ...STAFF],
    query: pageQuery.extend({ status: z.enum(REPORT_STATUSES).optional() }),
    handler: (c) => reports.listReports(c.db, c.actor, c.query, c.now),
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
