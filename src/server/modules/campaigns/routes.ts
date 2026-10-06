import { z } from 'zod';
import { ACTIVITIES, ADMINS, STAFF } from '@/shared/domain';
import { emptyBody, route, zId, zSen, zText } from '../../http/router';
import * as campaigns from './service';

const campaignBody = z
  .object({
    townshipId: zId.optional(),
    sponsorId: zId.nullable(),
    title: zText(100, 3),
    description: zText(600, 3),
    activity: z.enum(ACTIVITIES),
    goalMetric: z.enum(['COUNT', 'QUANTITY']).default('COUNT'),
    goalTarget: z.number().int().positive().max(10_000_000).default(1),
    rewardPoints: z.number().int().positive().max(100_000),
    perPersonCap: z.number().int().positive().max(100).default(1),
    budgetSen: zSen(1_000_000_000),
    poolBps: z.number().int().min(1).max(10_000).default(6000),
    feeBps: z.number().int().min(0).max(10_000).default(2500),
    costsBps: z.number().int().min(0).max(10_000).default(1500),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.poolBps + v.feeBps + v.costsBps === 10_000, { path: ['poolBps'], message: 'Pool, fee and costs must add up to 100%.' })
  .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'The end must be after the start.' });

export const campaignRoutes = [
  route({
    method: 'GET', path: '/campaigns', tag: 'KITA Partner Hub', summary: 'Campaigns visible to this role (residents also get their progress)', auth: 'session',
    roles: ['RESIDENT', 'SPONSOR', ...STAFF],
    handler: (c) => campaigns.listCampaigns(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/campaigns', tag: 'KITA Partner Hub', summary: 'Set up a challenge (draft until funded)', auth: 'session', roles: STAFF,
    body: campaignBody,
    handler: (c) => campaigns.createCampaign(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/campaigns/:campaignId/fund', tag: 'KITA Partner Hub', summary: "Record the funder's payment and open the reward pool", auth: 'session', roles: ADMINS,
    body: z.object({ bankRef: zText(60, 3) }),
    handler: (c) => campaigns.fundCampaign(c.db, c.actor, c.params.campaignId!, c.body.bankRef, c.now),
  }),
  route({
    method: 'POST', path: '/campaigns/:campaignId/close', tag: 'KITA Partner Hub', summary: 'End a campaign and refund the unused pool', auth: 'session', roles: ADMINS,
    body: emptyBody,
    handler: (c) => campaigns.closeCampaign(c.db, c.actor, c.params.campaignId!, c.now),
  }),
  route({
    method: 'GET', path: '/campaigns/:campaignId/report', tag: 'KITA Partner Hub', summary: 'Grouped results for a campaign', auth: 'session', roles: ['SPONSOR', ...STAFF],
    handler: (c) => campaigns.campaignReport(c.db, c.actor, c.params.campaignId!, c.now),
  }),
  route({
    method: 'GET', path: '/sponsors', tag: 'KITA Partner Hub', summary: 'Sponsor organisations', auth: 'session', roles: STAFF,
    handler: (c) => campaigns.listSponsors(c.db),
  }),
  route({
    method: 'POST', path: '/sponsors', tag: 'KITA Partner Hub', summary: 'Add a sponsor organisation', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(120, 2) }),
    handler: (c) => campaigns.createSponsor(c.db, c.actor, c.body.name),
  }),
];
