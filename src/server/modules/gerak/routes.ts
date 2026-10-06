import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { route, zText } from '../../http/router';
import * as gerak from './service';

export const zScanCode = z.string().trim().min(6).max(16).regex(/^[A-Za-z0-9]+$/, 'Check the code.');

export const gerakRoutes = [
  route({
    method: 'GET', path: '/gerak', tag: 'Gerak', summary: "Township loops, today's checkpoints and this month's distance", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => gerak.gerakOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/gerak/checkins', tag: 'Gerak', summary: 'Scan a checkpoint code', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 600, by: 'user' },
    body: z.object({ code: zScanCode }),
    handler: (c) => gerak.checkIn(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'GET', path: '/admin/gerak/loops', tag: 'Gerak', summary: 'Loops with their printable checkpoint codes', auth: 'session', roles: STAFF,
    handler: (c) => gerak.listLoopsForStaff(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/gerak/loops', tag: 'Gerak', summary: 'Create a loop and its checkpoints', auth: 'session', roles: STAFF,
    body: z.object({
      name: zText(80, 3), description: zText(300, 3), mode: z.enum(['WALK', 'CYCLE']),
      distanceM: z.number().int().min(100).max(100_000), checkpoints: z.array(zText(80, 2)).min(2).max(12),
    }),
    handler: (c) => gerak.createLoop(c.db, c.actor, c.body),
  }),
];
