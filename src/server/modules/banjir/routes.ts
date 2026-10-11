import { z } from 'zod';
import { FLOOD_TEST_PICTURES, STAFF } from '@/shared/domain';
import { route, zId, zText } from '../../http/router';
import * as agent from './agent';
import * as banjir from './service';

const zLevel = z.number().int().min(0).max(100);
const pictureIds = FLOOD_TEST_PICTURES.map((p) => p.id) as [(typeof FLOOD_TEST_PICTURES)[number]['id'], ...(typeof FLOOD_TEST_PICTURES)[number]['id'][]];

export const banjirRoutes = [
  route({
    method: 'GET', path: '/banjir', tag: 'Banjir', summary: 'Water level, risk and the latest official message for each zone', auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    handler: (c) => banjir.banjirOverview(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/alerts/active', tag: 'Banjir', summary: 'Open flood alerts that concern me (drives the danger takeover)', auth: 'session', roles: ['RESIDENT', 'GUARD', ...STAFF],
    handler: (c) => banjir.activeAlerts(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/banjir/checkin', tag: 'Banjir', summary: '"I\'m safe" or "I need help" during an alert in my zone', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 600, by: 'user' },
    body: z.object({ status: z.enum(['SAFE', 'NEED_HELP']) }),
    handler: (c) => agent.checkIn(c.db, c.actor, c.body.status, c.now),
  }),
  route({
    method: 'GET', path: '/public/flood-status', tag: 'Banjir', summary: 'The one official flood status page (no sign-in, nothing about any person)', auth: 'public',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    handler: (c) => agent.publicFloodStatus(c.db),
  }),
  route({
    method: 'POST', path: '/admin/banjir/zones/:zoneId/level', tag: 'Banjir', summary: 'The duty officer sets a zone water level by hand (sent at once)', auth: 'session', roles: STAFF,
    body: z.object({ levelPct: zLevel }),
    handler: (c) => banjir.recordLevel(c.db, { zoneId: c.params.zoneId!, levelPct: c.body.levelPct, actor: c.actor }, c.now),
  }),
  route({
    method: 'GET', path: '/admin/banjir/agent', tag: 'Banjir', summary: "The Banjir agent: each zone's signals, drafts waiting for the officer and the decision timeline", auth: 'session', roles: STAFF,
    handler: (c) => agent.agentOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/zones/:zoneId/signals', tag: 'Banjir', summary: 'Prototype: a signal from the sensor simulator, a camera test picture or the rain gauge', auth: 'session', roles: STAFF,
    rateLimit: { limit: 240, windowSec: 60, by: 'user' },
    body: z.discriminatedUnion('source', [
      z.object({ source: z.literal('SENSOR'), levelPct: zLevel }),
      z.object({ source: z.literal('CAMERA'), pictureId: z.enum(pictureIds) }),
      z.object({ source: z.literal('RAIN'), rainMmHr: z.number().int().min(0).max(300) }),
    ]),
    handler: (c) => agent.simulateSignal(c.db, c.actor, c.params.zoneId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/banjir/drafts/:messageId', tag: 'Banjir', summary: 'One tap: send (optionally edited) or cancel a one-signal draft', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['SEND', 'CANCEL']), what: zText(300, 10).optional(), todo: zText(300, 10).optional() }),
    handler: (c) => agent.decideDraft(c.db, c.actor, c.params.messageId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/flood', tag: 'Banjir', summary: 'Sensor bridge posts a reading (bearer token); the agent judges it with the other signals', auth: 'sensor',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({ zoneId: zId, levelPct: zLevel }),
    handler: (c) => agent.ingestSensor(c.db, c.body, c.now),
  }),
];
