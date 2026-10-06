import { z } from 'zod';
import { ADMINS } from '@/shared/domain';
import { townshipOf } from '../../auth/actor';
import { pageQuery } from '../../http/pagination';
import { emptyBody, route, zAcceptTerms, zEmail, zId, zPassword, zPhone, zPostcode, zSen, zState, zText } from '../../http/router';
import { recordMerchantDeposit } from '../ledger/finance';
import * as admin from './admin';
import * as merchant from './service';

const zMemberCode = z.string().trim().min(6).max(12).regex(/^[A-Za-z0-9]+$/, 'Check the member code.');

export const merchantRoutes = [
  route({
    method: 'POST', path: '/merchants/apply', tag: 'KITA Merchant', summary: 'Apply to join as a shop (needs admin approval)', auth: 'public',
    rateLimit: { limit: 5, windowSec: 3600, by: 'ip' },
    body: z.object({
      townshipId: zId, businessName: zText(120, 2), registrationNo: zText(40, 4), category: zText(40, 2),
      addressLine: zText(160, 5), postcode: zPostcode, city: zText(60, 2), state: zState,
      contactName: zText(100, 2), email: zEmail, phone: zPhone, password: zPassword, acceptTerms: zAcceptTerms,
    }),
    handler: (c) => admin.applyAsMerchant(c.db, c.body, c.now),
  }),
  route({
    method: 'PATCH', path: '/merchant/profile', tag: 'KITA Merchant', summary: "Update the shop's business address", auth: 'session', roles: ['MERCHANT'],
    body: z.object({ addressLine: zText(160, 5), postcode: zPostcode, city: zText(60, 2), state: zState }),
    handler: (c) => merchant.updateShopAddress(c.db, c.actor, c.body),
  }),
  route({
    method: 'GET', path: '/merchants', tag: 'KITA Merchant', summary: 'Shops residents can visit', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => merchant.listActiveMerchants(c.db, townshipOf(c.actor)),
  }),
  route({
    method: 'GET', path: '/merchant/summary', tag: 'KITA Merchant', summary: 'Reward pool, amount owed, last 7 days and the rules', auth: 'session', roles: ['MERCHANT'],
    handler: (c) => merchant.merchantSummary(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/sales', tag: 'KITA Merchant', summary: 'Record a sale: give points, and optionally ask to accept points', auth: 'session', roles: ['MERCHANT'],
    body: z.object({
      memberCode: zMemberCode,
      billSen: zSen(10_000_000),
      redeemPoints: z.number().int().min(0).max(3_000_000).default(0),
      idempotencyKey: zId,
    }),
    handler: (c) => merchant.createSale(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/merchant/sales', tag: 'KITA Merchant', summary: "This shop's sales", auth: 'session', roles: ['MERCHANT'],
    query: pageQuery,
    handler: (c) => merchant.listSales(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/merchant/sales/:saleId', tag: 'KITA Merchant', summary: 'One sale (used to wait for the resident to confirm)', auth: 'session', roles: ['MERCHANT'],
    handler: (c) => merchant.getSale(c.db, c.actor, c.params.saleId!, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/sales/:saleId/refund', tag: 'KITA Merchant', summary: 'Refund a sale: claw back earned points, return spent points', auth: 'session', roles: ['MERCHANT'],
    body: emptyBody,
    handler: (c) => merchant.refundSale(c.db, c.actor, c.params.saleId!, c.now),
  }),
  route({
    method: 'GET', path: '/merchant/statements', tag: 'KITA Merchant', summary: 'Weekly statements and the amount due this week', auth: 'session', roles: ['MERCHANT'],
    handler: (c) => merchant.listStatements(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/admin/merchants', tag: 'KITA Merchant', summary: 'All shops with pool and amounts owed', auth: 'session', roles: ADMINS,
    handler: (c) => admin.listMerchantsForAdmin(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/merchants/:merchantId/status', tag: 'KITA Merchant', summary: 'Approve, suspend or restore a shop', auth: 'session', roles: ADMINS,
    body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }),
    handler: (c) => admin.setMerchantStatus(c.db, c.actor, c.params.merchantId!, c.body.status, c.now),
  }),
  route({
    method: 'POST', path: '/admin/merchants/:merchantId/deposits', tag: 'KITA Merchant', summary: "Record money a shop paid into its reward pool", auth: 'session', roles: ADMINS,
    body: z.object({ amountSen: zSen(), bankRef: zText(60, 3) }),
    handler: (c) => recordMerchantDeposit(c.db, c.actor, c.params.merchantId!, c.body, c.now),
  }),
];
