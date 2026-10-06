import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { route, zText } from '../../http/router';
import * as jimat from './service';

export const jimatRoutes = [
  route({
    method: 'GET', path: '/jimat', tag: 'Jimat', summary: "My home's readings, the change from last month and tips", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => jimat.jimatOverview(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/jimat/readings', tag: 'Jimat', summary: 'Enter monthly electricity and water readings', auth: 'session', roles: ['RESIDENT'],
    body: z.object({
      month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Use the form YYYY-MM.'),
      electricityKwh: z.number().int().min(0).max(100_000),
      waterLitres: z.number().int().min(0).max(10_000_000),
    }),
    handler: (c) => jimat.submitReading(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/jimat/solar-interest', tag: 'Jimat', summary: 'Ask to be contacted about solar, or withdraw that request', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ interested: z.boolean(), note: zText(300).optional() }),
    handler: (c) => jimat.setSolarInterest(c.db, c.actor, c.body.interested, c.body.note, c.now),
  }),
  route({
    method: 'GET', path: '/admin/solar-leads', tag: 'Jimat', summary: 'Residents who asked to be contacted about solar', auth: 'session', roles: STAFF,
    handler: (c) => jimat.listSolarLeads(c.db, c.actor),
  }),
];
