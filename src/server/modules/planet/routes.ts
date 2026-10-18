import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { route, zId, zText } from '../../http/router';
import * as edging from './edging';
import * as materials from './materials';
import * as solar from './solar';

const siteFields = {
  name: zText(80, 2),
  kind: z.enum(solar.SOLAR_KINDS),
  zoneId: zId.nullable().optional(),
  usableM2: z.number().int().min(1).max(1_000_000),
  orientation: z.enum(solar.ORIENTATIONS),
  shading: z.enum(solar.SHADING).nullable().optional(),
  roofAgeYears: z.number().int().min(0).max(200).nullable().optional(),
  structuralChecked: z.boolean().optional(),
  expertRank: z.number().int().min(1).max(1000).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
};
const zRequirements = z.object({
  costRm: z.number().min(0).max(100_000).optional(),
  lifeYears: z.number().min(0).max(200).optional(),
  strengthMpa: z.number().min(0).max(500).optional(),
  permeable: z.boolean().optional(),
  uvStable: z.boolean().optional(),
});

export const planetRoutes = [
  // --- Solar opportunity mapper ---------------------------------------------------------
  route({
    method: 'GET', path: '/admin/solar/sites', tag: 'Planet', summary: 'Candidate solar sites ranked by output, nearby demand and readiness, with what is missing', auth: 'session', roles: STAFF,
    handler: (c) => solar.solarSites(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/solar/sites', tag: 'Planet', summary: 'Add a candidate rooftop or car park', auth: 'session', roles: STAFF,
    body: z.object(siteFields),
    handler: (c) => solar.createSolarSite(c.db, c.actor, c.body),
  }),
  route({
    method: 'PATCH', path: '/admin/solar/sites/:siteId', tag: 'Planet', summary: 'Update a site: survey results, checks done, or an expert’s rank', auth: 'session', roles: STAFF,
    body: z.object(siteFields).partial(),
    handler: (c) => solar.updateSolarSite(c.db, c.actor, c.params.siteId!, c.body),
  }),
  route({
    method: 'DELETE', path: '/admin/solar/sites/:siteId', tag: 'Planet', summary: 'Remove a site', auth: 'session', roles: STAFF,
    handler: (c) => solar.deleteSolarSite(c.db, c.actor, c.params.siteId!),
  }),

  // --- Material comparison ----------------------------------------------------------------
  route({
    method: 'GET', path: '/admin/materials', tag: 'Planet', summary: 'The uses that can be compared and their requirements (sample library)', auth: 'session', roles: STAFF,
    handler: async () => ({ uses: Object.entries(materials.USES).map(([id, u]) => ({ id, ...u })), sample: true }),
  }),
  route({
    method: 'POST', path: '/admin/materials/compare', tag: 'Planet', summary: 'Check every material for one use against the requirements, and flag missing evidence', auth: 'session', roles: STAFF,
    body: z.object({ use: z.enum(materials.USE_CASES), requirements: zRequirements }),
    handler: async (c) => materials.compareMaterials(c.body.use, c.body.requirements),
  }),
  route({
    method: 'POST', path: '/admin/materials/explain', tag: 'Planet', summary: 'The agent explains the comparison, using only the table', auth: 'session', roles: STAFF,
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ use: z.enum(materials.USE_CASES), requirements: zRequirements }),
    handler: (c) => materials.explainComparison(c.body.use, c.body.requirements),
  }),
  route({
    method: 'GET', path: '/admin/materials/shortlists', tag: 'Planet', summary: 'Saved shortlists and the median time to make one', auth: 'session', roles: STAFF,
    handler: (c) => materials.listShortlists(c.db),
  }),
  route({
    method: 'POST', path: '/admin/materials/shortlists', tag: 'Planet', summary: 'Save a shortlist with the time it took', auth: 'session', roles: STAFF,
    body: z.object({
      use: z.enum(materials.USE_CASES), requirements: zRequirements, materialIds: z.array(z.string().max(60)).min(1).max(10),
      secondsTaken: z.number().int().min(0).max(86_400), note: z.string().trim().max(300).optional(),
    }),
    handler: (c) => materials.saveShortlist(c.db, c.actor, c.body, c.now),
  }),

  // --- Recycled-plastic edging trial ------------------------------------------------------
  route({
    method: 'GET', path: '/admin/edging-trial', tag: 'Planet', summary: 'The edging trial’s test plan and results, and the plastic the township has collected', auth: 'session', roles: STAFF,
    handler: (c) => edging.edgingTrial(c.db, c.actor),
  }),
  route({
    method: 'PATCH', path: '/admin/edging-trial/tests/:testId', tag: 'Planet', summary: 'Record a test result for the recycled and the conventional edging', auth: 'session', roles: STAFF,
    body: z.object({
      status: z.enum(edging.TRIAL_STATUSES).optional(),
      resultRecycled: z.string().trim().max(300).nullable().optional(),
      resultConventional: z.string().trim().max(300).nullable().optional(),
    }),
    handler: (c) => edging.updateTrialTest(c.db, c.actor, c.params.testId!, c.body, c.now),
  }),
];
