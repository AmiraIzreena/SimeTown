import { z } from 'zod';
import { AUDIT_ACTORS, AUDIT_AREAS, AUDIT_PERIODS } from '@/shared/audit';
import { ADMINS, STAFF } from '@/shared/domain';
import { one } from '../../db/client';
import { AppError, notFound } from '../../errors';
import { pageQuery } from '../../http/pagination';
import { emptyBody, json, route, zSen, zText } from '../../http/router';
import { insightsOverview } from '../insights/service';
import * as finance from '../ledger/finance';
import { getSettings } from '../settings';
import { JOBS, listAudit, runJob, updateSettings, type JobName } from './service';

const settingsBody = z
  .object({
    points_per_ringgit: z.number().int().min(0).max(10),
    issuance_fee_bps: z.number().int().min(0).max(5000),
    min_redeem_points: z.number().int().min(1).max(100_000),
    redeem_step_points: z.number().int().min(1).max(10_000),
    max_redeem_bps: z.number().int().min(0).max(10_000),
    points_daily_person: z.number().int().min(1).max(1_000_000),
    points_monthly_person: z.number().int().min(1).max(10_000_000),
    points_monthly_home: z.number().int().min(1).max(10_000_000),
    expiry_inactive_months: z.number().int().min(1).max(120),
    expiry_max_months: z.number().int().min(1).max(120),
    redeem_confirm_minutes: z.number().int().min(1).max(60),
    flood_warning_pct: z.number().int().min(1).max(100),
    flood_danger_pct: z.number().int().min(1).max(100),
    flag_hide_threshold: z.number().int().min(1).max(100),
    min_group_size: z.number().int().min(2).max(1000),
    issuance_paused: z.boolean(),
    offer_points_monthly_home: z.number().int().min(1).max(1_000_000),
    offer_success_fee_bps: z.number().int().min(0).max(5000),
  })
  .partial()
  .strict();

export const adminRoutes = [
  route({
    method: 'GET', path: '/insights', tag: 'SimeTown Insights', summary: 'Township results for the last 30 days (totals only)', auth: 'session', roles: STAFF,
    handler: (c) => insightsOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/finance/float', tag: 'Finance', summary: 'The reward float against everything it owes, and recent checks', auth: 'session', roles: STAFF,
    handler: (c) => finance.floatOverview(c.db),
  }),
  route({
    method: 'POST', path: '/finance/float/check', tag: 'Finance', summary: 'Run the float check now, optionally against a bank statement figure', auth: 'session', roles: ADMINS,
    body: z.object({ bankStatementSen: z.number().int().min(0).optional() }),
    handler: (c) => finance.runFloatCheck(c.db, c.actor.id, c.now, c.body.bankStatementSen),
  }),
  route({
    method: 'GET', path: '/finance/settlements', tag: 'Finance', summary: 'Payments to shops', auth: 'session', roles: STAFF,
    handler: (c) => finance.listSettlements(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/finance/settlements/run', tag: 'Finance', summary: "Pay every shop in the admin's township what it is owed (the weekly settlement)", auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => finance.runSettlement(c.db, c.actor.id, c.now, c.actor.townshipId),
  }),
  route({
    method: 'POST', path: '/finance/community-pool/deposits', tag: 'Finance', summary: "Record SDP's payment into the community pool", auth: 'session', roles: ADMINS,
    body: z.object({ amountSen: zSen(), bankRef: zText(60, 3) }),
    handler: (c) => finance.recordCommunityDeposit(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/finance/adjustments', tag: 'Finance', summary: 'Manual balance corrections and their approvals', auth: 'session', roles: ADMINS,
    handler: (c) => finance.listAdjustments(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/finance/adjustments', tag: 'Finance', summary: 'Request a manual correction (needs a second admin)', auth: 'session', roles: ADMINS,
    body: z.object({
      memberCode: zText(12, 6),
      points: z.number().int().min(-100_000).max(100_000).refine((v) => v !== 0, 'Enter a number other than zero.'),
      reason: zText(300, 10),
    }),
    handler: (c) => finance.requestAdjustment(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/finance/adjustments/:adjustmentId/decision', tag: 'Finance', summary: 'Approve or reject a correction (not your own)', auth: 'session', roles: ADMINS,
    body: z.object({ approve: z.boolean() }),
    handler: (c) => finance.decideAdjustment(c.db, c.actor, c.params.adjustmentId!, c.body.approve, c.now),
  }),
  route({
    method: 'GET', path: '/admin/audit', tag: 'Admin', summary: 'Audit trail', auth: 'session', roles: ADMINS,
    query: pageQuery.extend({
      q: z.string().trim().max(60).optional(),
      area: z.enum(AUDIT_AREAS).optional(),
      actor: z.enum(AUDIT_ACTORS).optional(),
      period: z.enum(AUDIT_PERIODS).optional(),
      sort: z.enum(['NEWEST', 'OLDEST']).optional(),
    }),
    handler: (c) => listAudit(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/admin/settings', tag: 'Admin', summary: 'Programme rules', auth: 'session', roles: STAFF,
    handler: (c) => getSettings(c.db),
  }),
  route({
    method: 'PATCH', path: '/admin/settings', tag: 'Admin', summary: 'Change programme rules (SDP HQ only)', auth: 'session', roles: ['HQ_ADMIN'],
    body: settingsBody,
    handler: (c) => updateSettings(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/internal/jobs/:name', tag: 'System', summary: `Run a scheduled job (${JOBS.join(', ')}); bearer token`, auth: 'cron',
    handler: async (c) => {
      if (!JOBS.includes(c.params.name as JobName)) throw notFound('Job');
      return runJob(c.db, c.params.name as JobName, c.now);
    },
  }),
  route({
    method: 'GET', path: '/health', tag: 'System', summary: 'Liveness: the process is up', auth: 'public',
    handler: async () => ({ status: 'ok' }),
  }),
  route({
    method: 'GET', path: '/ready', tag: 'System', summary: 'Readiness: the database answers and the schema is migrated', auth: 'public',
    handler: async (c) => {
      try {
        const row = await one<{ latest: string | null }>(c.db, 'SELECT max(id) AS latest FROM schema_migrations');
        if (!row?.latest) throw new Error('no migrations applied');
        return json({ data: { status: 'ready', schema: row.latest } });
      } catch {
        throw new AppError(503, 'NOT_READY', 'The database is not ready.');
      }
    },
  }),
];
