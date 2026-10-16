import { z } from 'zod';
import { STAFF, WILDLIFE_KINDS } from '@/shared/domain';
import { requireVerifiedResident } from '../../auth/actor';
import { badRequest } from '../../errors';
import { emptyBody, route, zId, zText } from '../../http/router';
import { readForm, readPhoto } from '../../http/uploads';
import * as taman from './service';

const sightingFields = z.object({ kind: z.enum(WILDLIFE_KINDS), species: zText(80, 2), location: zText(120, 2), note: zText(300).optional() });

export const tamanRoutes = [
  route({
    method: 'GET', path: '/taman', tag: 'Taman', summary: 'Gardens, plots, the watering roster and the wildlife log', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => taman.tamanOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/taman/gardens/:gardenId/apply', tag: 'Taman', summary: "Join a garden's waiting list; plots are given out by ballot (one per home)", auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    handler: (c) => taman.applyForPlot(c.db, c.actor, c.params.gardenId!, c.now),
  }),
  route({
    method: 'POST', path: '/taman/applications/:applicationId/withdraw', tag: 'Taman', summary: 'Leave a waiting list', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => taman.withdrawApplication(c.db, c.actor, c.params.applicationId!, c.now),
  }),
  route({
    method: 'POST', path: '/taman/plots/:plotId/release', tag: 'Taman', summary: 'Give a plot back', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => taman.releasePlot(c.db, c.actor, c.params.plotId!),
  }),
  route({
    method: 'POST', path: '/taman/roster', tag: 'Taman', summary: "Take a day on a garden's watering roster", auth: 'session', roles: ['RESIDENT'],
    body: z.object({ gardenId: zId, day: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/, 'Choose a day.') }),
    handler: (c) => taman.takeRosterDay(c.db, c.actor, c.body.gardenId, c.body.day, c.now),
  }),
  route({
    method: 'POST', path: '/taman/watered', tag: 'Taman', summary: "Scan the garden's code after watering", auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    body: z.object({ code: z.string().trim().min(6).max(16).regex(/^[A-Za-z0-9]+$/, 'Check the code.') }),
    handler: (c) => taman.markWatered(c.db, c.actor, c.body.code, c.now),
  }),
  route({
    method: 'POST', path: '/taman/sightings', tag: 'Taman', summary: 'Log a bird, insect or plant you spotted (multipart form; photo optional)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 20, windowSec: 3600, by: 'user' },
    handler: async (c) => {
      requireVerifiedResident(c.actor); // before the upload is read
      const form = await readForm(c.req);
      const text = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' && value.trim() ? value : undefined;
      };
      const parsed = sightingFields.safeParse({ kind: text('kind'), species: text('species'), location: text('location'), note: text('note') });
      if (!parsed.success) throw badRequest('Please say what you saw and where.', { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])) });
      return taman.addSighting(c.db, c.actor, { ...parsed.data, photo: await readPhoto(form) }, c.now);
    },
  }),
  route({
    method: 'GET', path: '/taman/sightings/:sightingId/photo', tag: 'Taman', summary: 'A sighting photo (the person who logged it, or staff)', auth: 'session',
    handler: (c) => taman.sightingPhoto(c.db, c.actor, c.params.sightingId!),
  }),
  route({
    method: 'GET', path: '/admin/taman/sightings', tag: 'Taman', summary: 'Sightings waiting to be confirmed', auth: 'session', roles: STAFF,
    handler: (c) => taman.sightingQueue(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/taman/sightings/:sightingId', tag: 'Taman', summary: 'Confirm or reject a sighting', auth: 'session', roles: STAFF,
    body: z.object({ confirm: z.boolean() }),
    handler: (c) => taman.decideSighting(c.db, c.actor, c.params.sightingId!, c.body.confirm, c.now),
  }),
  route({
    method: 'GET', path: '/admin/taman/gardens', tag: 'Taman', summary: 'Gardens with their printable gate codes', auth: 'session', roles: STAFF,
    handler: (c) => taman.listGardensForStaff(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/taman/gardens/:gardenId/ballot', tag: 'Taman', summary: "Draw the waiting list for a garden's free plots", auth: 'session', roles: STAFF, body: emptyBody,
    handler: (c) => taman.runBallot(c.db, c.actor, c.params.gardenId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/taman/gardens', tag: 'Taman', summary: 'Add a community garden and its plots', auth: 'session', roles: STAFF,
    body: z.object({ name: zText(80, 3), location: zText(160, 3), plots: z.number().int().min(1).max(60), plotSizeM2: z.number().int().min(1).max(100) }),
    handler: (c) => taman.createGarden(c.db, c.actor, c.body),
  }),
];
