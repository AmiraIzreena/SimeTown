import { z } from 'zod';
import { BILL_KINDS, STAFF } from '@/shared/domain';
import { readBillForm } from '../../files/gate';
import { emptyBody, route, zText } from '../../http/router';
import * as bills from './bills';
import * as jimat from './service';

const zMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Use the form YYYY-MM.');

export const jimatRoutes = [
  route({
    method: 'GET', path: '/jimat', tag: 'Jimat', summary: "My home's readings, the change from last month and tips", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => jimat.jimatOverview(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/jimat/readings', tag: 'Jimat', summary: 'Enter monthly electricity and water readings', auth: 'session', roles: ['RESIDENT'],
    body: z.object({
      month: zMonth,
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

  // --- Bill reading (BR25) -----------------------------------------------------------
  route({
    method: 'GET', path: '/jimat/bills', tag: 'Jimat', summary: 'Bills read and confirmed for my home (numbers only; no file is kept)', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => bills.myBills(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/jimat/bills', tag: 'Jimat', summary: 'Upload a bill (multipart: file, kind). Checked, read in memory, never stored', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      const { form, file } = await readBillForm(c.req);
      const kind = z.enum(BILL_KINDS).nullable().catch(null).parse(form.get('kind'));
      return bills.readBill(c.db, c.actor, { bytes: file, kind }, c.now);
    },
  }),
  route({
    method: 'POST', path: '/jimat/bills/:billId/confirm', tag: 'Jimat', summary: 'Confirm or correct the numbers read from a bill', auth: 'session', roles: ['RESIDENT'],
    body: z.object({
      kind: z.enum(BILL_KINDS),
      usage: z.number().int().min(0).max(10_000_000),
      amountSen: z.number().int().min(0).max(10_000_000),
      month: zMonth,
    }),
    handler: (c) => bills.confirmBill(c.db, c.actor, c.params.billId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/jimat/bills/:billId/discard', tag: 'Jimat', summary: 'Throw away a bill that was read but not confirmed', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => bills.discardBill(c.db, c.actor, c.params.billId!),
  }),
  route({
    method: 'GET', path: '/jimat/sample-bill', tag: 'Jimat', summary: 'Prototype: a sample bill (PDF) to my address, marked SAMPLE, for trying bill reading', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    query: z.object({ kind: z.enum(BILL_KINDS).default('ELECTRICITY') }),
    handler: (c) => bills.sampleBill(c.db, c.actor, c.query.kind, c.now),
  }),
];
