import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { route, zId } from '../../http/router';
import * as banjir from './service';

const zLevel = z.number().int().min(0).max(100);

export const banjirRoutes = [
  route({
    method: 'GET', path: '/banjir', tag: 'Banjir', summary: 'Water level and risk for each zone', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => banjir.banjirOverview(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/alerts/active', tag: 'Banjir', summary: 'Open flood alerts that concern me (drives the danger takeover)', auth: 'session', roles: ['RESIDENT', ...STAFF],
    handler: (c) => banjir.activeAlerts(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/banjir/zones/:zoneId/level', tag: 'Banjir', summary: 'Staff set a zone water level (the prototype sensor)', auth: 'session', roles: STAFF,
    body: z.object({ levelPct: zLevel }),
    handler: (c) => banjir.recordLevel(c.db, { zoneId: c.params.zoneId!, levelPct: c.body.levelPct, source: 'MANUAL', actor: c.actor }, c.now),
  }),
  route({
    method: 'POST', path: '/ingest/flood', tag: 'Banjir', summary: 'Sensor bridge posts a reading (bearer token)', auth: 'sensor',
    rateLimit: { limit: 600, windowSec: 60, by: 'ip' },
    body: z.object({ zoneId: zId, levelPct: zLevel }),
    handler: (c) => banjir.recordLevel(c.db, { zoneId: c.body.zoneId, levelPct: c.body.levelPct, source: 'SENSOR' }, c.now),
  }),
];
