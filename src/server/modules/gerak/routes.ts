import { z } from 'zod';
import { ADMINS, GERAK_MODES, STAFF } from '@/shared/domain';
import { requireVerifiedResident } from '../../auth/actor';
import { getConfig } from '../../config';
import { emptyBody, route, zId, zText } from '../../http/router';
import * as gerak from './service';
import * as tracking from './tracking';

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

  route({
    method: 'POST', path: '/admin/gerak/loops/:loopId/visibility', tag: 'Gerak',
    summary: 'Show a loop to residents again, or hide it (township admin or SDP HQ; a reason is kept in the audit log). Every part of Gerak follows at once',
    auth: 'session', roles: ADMINS,
    body: z.object({ active: z.boolean(), reason: zText(300, 3) }),
    handler: (c) => gerak.setLoopActive(c.db, c.actor, c.params.loopId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/gerak/loops/:loopId/map', tag: 'Gerak', summary: 'Draw a loop on the map: its path and where each checkpoint is', auth: 'session', roles: STAFF,
    body: z.object({
      path: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).max(500),
      checkpoints: z.array(z.object({ id: zId, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(5).max(200) })).max(12),
    }),
    handler: (c) => tracking.setLoopMap(c.db, c.actor, c.params.loopId!, c.body),
  }),

  // --- Map tracking (BR24) ---------------------------------------------------------
  route({
    method: 'GET', path: '/gerak/map', tag: 'Gerak', summary: 'Checkpoints with their positions, the activity in progress and recent trips', auth: 'session', roles: ['RESIDENT'],
    handler: async (c) => {
      const resident = requireVerifiedResident(c.actor);
      const [map, mine] = await Promise.all([tracking.gerakMap(c.db, resident.townshipId), tracking.myActivities(c.db, resident)]);
      return { ...map, ...mine, simulationAllowed: getConfig().APP_ENV !== 'production' };
    },
  }),
  route({
    method: 'POST', path: '/gerak/activities', tag: 'Gerak', summary: 'Tap Start: begin a tracked walk, run, ride or wheelchair trip', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({ mode: z.enum(GERAK_MODES), simulated: z.boolean().default(false) }),
    handler: (c) => tracking.startActivity(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/gerak/activities/:activityId/points', tag: 'Gerak', summary: 'A batch of positions, sent only between Start and Finish', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 120, windowSec: 60, by: 'user' },
    body: z.object({
      points: z
        .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), acc: z.number().min(0).max(10_000), t: z.number().int().min(0).max(4_102_444_800_000) }))
        .min(1)
        .max(300),
    }),
    handler: (c) => tracking.addPoints(c.db, c.actor, c.params.activityId!, c.body.points, c.now),
  }),
  route({
    method: 'POST', path: '/gerak/activities/:activityId/finish', tag: 'Gerak', summary: 'Tap Finish: fair-play checks, then verified distance and loops are credited', auth: 'session', roles: ['RESIDENT'],
    body: emptyBody,
    handler: (c) => tracking.finishActivity(c.db, c.actor, c.params.activityId!, c.now),
  }),
];
