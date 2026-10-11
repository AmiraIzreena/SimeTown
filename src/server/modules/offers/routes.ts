import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { requireVerifiedResident, townshipOf } from '../../auth/actor';
import { route, zText } from '../../http/router';
import { setAksesFriendly } from '../merchant/service';
import { getSettings } from '../settings';
import { resolveTownship } from '../townships';
import * as offers from './service';

const zRinggitSen = (max: number) => z.number().int().min(100).max(max).refine((v) => v % 100 === 0, 'Use whole ringgit.');

export const offerRoutes = [
  route({
    method: 'GET', path: '/merchant/offers', tag: 'Shop Offers', summary: "This shop's offers, this month's budget used and success fees", auth: 'session', roles: ['MERCHANT'],
    handler: (c) => offers.listOffersForMerchant(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/offers', tag: 'Shop Offers', summary: 'Create a Shop Offer with its terms and monthly budget (BR30)', auth: 'session', roles: ['MERCHANT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({
      title: zText(80, 3),
      discountSen: zRinggitSen(100_000),
      minSpendSen: z.number().int().min(0).max(10_000_000).default(0),
      daysMask: z.number().int().min(1).max(127).default(127),
      startMinute: z.number().int().min(0).max(1439).default(0),
      endMinute: z.number().int().min(1).max(1440).default(1440),
      monthlyBudgetSen: zRinggitSen(10_000_000),
    }),
    handler: (c) => offers.createOffer(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/offers/:offerId/status', tag: 'Shop Offers', summary: 'Pause, resume or end an offer', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']) }),
    handler: (c) => offers.setOfferStatus(c.db, c.actor, c.params.offerId!, c.body.status, c.now),
  }),
  route({
    method: 'POST', path: '/merchant/akses-friendly', tag: 'Shop Offers', summary: 'Show or hide the Akses-friendly badge for this shop', auth: 'session', roles: ['MERCHANT'],
    body: z.object({ aksesFriendly: z.boolean() }),
    handler: (c) => setAksesFriendly(c.db, c.actor, c.body.aksesFriendly),
  }),
  route({
    method: 'GET', path: '/offers', tag: 'Shop Offers', summary: 'Live Shop Offers in my township, my offer-backed points and the pledges behind them', auth: 'session', roles: ['RESIDENT'],
    handler: async (c) => {
      const townshipId = townshipOf(c.actor);
      const tz = (await getSettings(c.db)).timezone;
      const [live, pledges, balance, history] = await Promise.all([
        offers.listLiveOffers(c.db, townshipId, c.now),
        offers.pledgeSummary(c.db, townshipId, c.now, tz),
        c.actor.residencyStatus === 'VERIFIED' ? offers.offerBalance(c.db, requireVerifiedResident(c.actor).id) : Promise.resolve(0),
        offers.offerHistory(c.db, c.actor.id),
      ]);
      return { offers: live, pledges, balance, history };
    },
  }),
  route({
    method: 'GET', path: '/admin/offers', tag: 'Shop Offers', summary: "The township's pledges and offer-backed points this month", auth: 'session', roles: STAFF,
    handler: async (c) => {
      const townshipId = c.actor.townshipId ?? (await resolveTownship(c.db, c.actor).catch(() => null));
      const tz = (await getSettings(c.db)).timezone;
      return {
        pledges: await offers.pledgeSummary(c.db, townshipId, c.now, tz),
        offers: townshipId ? await offers.listLiveOffers(c.db, townshipId, c.now) : [],
      };
    },
  }),
];
