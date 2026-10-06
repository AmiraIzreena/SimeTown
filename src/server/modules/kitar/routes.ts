import { z } from 'zod';
import { MATERIALS, STAFF } from '@/shared/domain';
import { identifyMaterial } from '../../ai/classifier';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { route, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import { zScanCode } from '../gerak/routes';
import * as kitar from './service';

export const kitarRoutes = [
  route({
    method: 'GET', path: '/kitar', tag: 'Kitar', summary: "My recycling totals, my street's total and the kiosks", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => kitar.kitarOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/kitar/identify', tag: 'Kitar', summary: 'Photo check: what material is this? (multipart form; the photo is not stored)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor);
      const photo = await readPhoto(await readForm(c.req));
      if (!photo) throw badRequest('Attach a photo of the item.');
      return identifyMaterial(photo);
    },
  }),
  route({
    method: 'POST', path: '/kitar/dropoffs', tag: 'Kitar', summary: 'Record a drop-off at a kiosk', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({ kioskCode: zScanCode, material: z.enum(MATERIALS), weightG: z.number().int().min(1).max(20_000) }),
    handler: (c) => kitar.recordDropOff(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'GET', path: '/admin/kitar/kiosks', tag: 'Kitar', summary: 'Kiosks with their printable codes', auth: 'session', roles: STAFF,
    handler: (c) => kitar.listKiosksForStaff(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/kitar/kiosks', tag: 'Kitar', summary: 'Add a kiosk', auth: 'session', roles: STAFF,
    body: z.object({ name: zText(80, 3), location: zText(160, 3) }),
    handler: (c) => kitar.createKiosk(c.db, c.actor, c.body),
  }),
];
