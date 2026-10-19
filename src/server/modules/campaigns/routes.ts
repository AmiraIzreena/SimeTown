import { z } from 'zod';
import { ADMINS, CAMPAIGN_ACTIVITIES, campaignSplit, SPONSOR_TIERS, STAFF } from '@/shared/domain';
import { emptyBody, route, zId, zSen, zText } from '../../http/router';
import * as campaigns from './service';
import * as tiers from './tiers';

const campaignBody = z
  .object({
    townshipId: zId.optional(),
    sponsorId: zId.nullable(),
    title: zText(100, 3),
    description: zText(600, 3),
    activity: z.enum(CAMPAIGN_ACTIVITIES),
    goalMetric: z.enum(['COUNT', 'QUANTITY']).default('COUNT'),
    goalTarget: z.number().int().positive().max(10_000_000).default(1),
    rewardPoints: z.number().int().positive().max(100_000),
    perPersonCap: z.number().int().positive().max(100).default(1),
    budgetSen: zSen(1_000_000_000),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'The end must be after the start.' });

export const campaignRoutes = [
  route({
    method: 'GET', path: '/campaigns', tag: 'SimeTown Partner Hub', summary: 'Campaigns visible to this role (residents also get their progress)', auth: 'session',
    roles: ['RESIDENT', 'SPONSOR', ...STAFF],
    handler: (c) => campaigns.listCampaigns(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/campaigns', tag: 'SimeTown Partner Hub', summary: 'Set up a challenge (draft until funded)', auth: 'session', roles: STAFF,
    body: campaignBody,
    // The budget split follows who funds it (BR14); the browser cannot choose it.
    handler: (c) => campaigns.createCampaign(c.db, c.actor, { ...c.body, ...campaignSplit(c.body.sponsorId) }),
  }),
  route({
    method: 'POST', path: '/campaigns/:campaignId/fund', tag: 'SimeTown Partner Hub', summary: "Record the funder's payment and open the reward pool", auth: 'session', roles: ADMINS,
    body: z.object({ bankRef: zText(60, 3) }),
    handler: (c) => campaigns.fundCampaign(c.db, c.actor, c.params.campaignId!, c.body.bankRef, c.now),
  }),
  route({
    method: 'POST', path: '/campaigns/:campaignId/close', tag: 'SimeTown Partner Hub', summary: 'End a campaign and refund the unused pool', auth: 'session', roles: ADMINS,
    body: emptyBody,
    handler: (c) => campaigns.closeCampaign(c.db, c.actor, c.params.campaignId!, c.now),
  }),
  route({
    method: 'GET', path: '/campaigns/:campaignId/report', tag: 'SimeTown Partner Hub', summary: 'Grouped results for a campaign', auth: 'session', roles: ['SPONSOR', ...STAFF],
    handler: (c) => campaigns.campaignReport(c.db, c.actor, c.params.campaignId!, c.now),
  }),
  route({
    method: 'GET', path: '/sponsors', tag: 'SimeTown Partner Hub', summary: 'Sponsor organisations', auth: 'session', roles: STAFF,
    handler: (c) => tiers.listSponsorsWithTiers(c.db, c.now),
  }),
  route({
    method: 'POST', path: '/sponsors', tag: 'SimeTown Partner Hub', summary: 'Add a sponsor organisation', auth: 'session', roles: ADMINS,
    body: z.object({ name: zText(120, 2) }),
    handler: (c) => campaigns.createSponsor(c.db, c.actor, c.body.name),
  }),
  route({
    method: 'POST', path: '/admin/sponsors/:sponsorId/tier', tag: 'SimeTown Partner Hub', summary: 'Record a yearly tier payment and give the sponsor that tier (SDP HQ)', auth: 'session', roles: ['HQ_ADMIN'],
    body: z.object({ tier: z.enum(SPONSOR_TIERS), bankRef: zText(60, 3), category: zText(60, 2).optional(), tagline: zText(120, 3).optional() }),
    handler: (c) => tiers.setSponsorTier(c.db, c.actor, c.params.sponsorId!, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/sponsor/tier', tag: 'SimeTown Partner Hub', summary: 'My tier, its benefits and challenges used this year', auth: 'session', roles: ['SPONSOR'],
    handler: (c) => tiers.myTier(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/public/partners', tag: 'SimeTown Partner Hub', summary: 'The Partners page: sponsors with a current tier (names only)', auth: 'public',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    handler: (c) => tiers.publicPartners(c.db, c.now),
  }),
  route({
    method: 'GET', path: '/public/challenges', tag: 'SimeTown Partner Hub', summary: 'The Challenges page: live funded challenges and the actions that earn Impact XP (no budgets, no people)', auth: 'public',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    handler: (c) => campaigns.publicChallenges(c.db, c.now),
  }),
  route({
    method: 'GET', path: '/sponsored', tag: 'SimeTown Partner Hub', summary: 'One labelled sponsored banner for the home screen (never on safety screens)', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => tiers.sponsoredBanner(c.db, c.now),
  }),
];
