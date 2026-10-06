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
    method: 'GET', path: '/reports', tag: 'Lapor', summary: 'My reports (resident) or the township queue (staff)', auth: 'session', roles: ['RESIDENT', ...STAFF],
    query: pageQuery.extend({ status: z.enum(REPORT_STATUSES).optional() }),
    handler: (c) => reports.listReports(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/reports/:reportId', tag: 'Lapor', summary: 'One report', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => reports.getReport(c.db, c.actor, c.params.reportId!),
  }),
  route({
    method: 'GET', path: '/reports/:reportId/photo', tag: 'Lapor', summary: "The report's photo (reporter and township staff only)", auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => reports.getReportPhoto(c.db, c.actor, c.params.reportId!),
  }),
  route({
    method: 'PATCH', path: '/reports/:reportId', tag: 'Lapor', summary: 'Staff update status, type, urgency or note (corrections to the AI are logged)', auth: 'session', roles: STAFF,
    body: z.object({
      status: z.enum(REPORT_STATUSES).optional(), category: z.enum(REPORT_CATEGORIES).optional(),
      urgency: z.enum(URGENCIES).optional(), staffNote: zText(500).optional(),
    }),
    handler: (c) => reports.updateReport(c.db, c.actor, c.params.reportId!, c.body, c.now),
  }),
];
