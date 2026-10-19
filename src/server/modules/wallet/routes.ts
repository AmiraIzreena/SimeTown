import { z } from 'zod';
import { pageQuery } from '../../http/pagination';
import { emptyBody, route } from '../../http/router';
import { decideSale } from '../merchant/service';
import { listNotifications, markAllRead, updateNotification } from '../notifications';
import { NOTIFICATION_CATEGORIES } from '@/shared/notifications';
import { badRequest } from '../../errors';
import * as wallet from './service';

export const walletRoutes = [
  route({
    method: 'GET', path: '/wallet', tag: 'Points & XP', summary: 'Points, XP, level, badges, limits and requests waiting for confirmation', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => wallet.walletOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/wallet/history', tag: 'Points & XP', summary: 'Every points movement, with who funded it', auth: 'session', roles: ['RESIDENT'],
    query: pageQuery,
    handler: (c) => wallet.walletHistory(c.db, c.actor, c.query),
  }),
  route({
    method: 'POST', path: '/wallet/sales/:saleId/decision', tag: 'Points & XP', summary: 'Confirm or decline using points on a bill', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ accept: z.boolean() }),
    handler: (c) => decideSale(c.db, c.actor, c.params.saleId!, c.body.accept, c.now),
  }),
  route({
    method: 'GET', path: '/leagues/streets', tag: 'Points & XP', summary: "This month's Impact XP by street", auth: 'session', roles: ['RESIDENT'],
    handler: (c) => wallet.streetLeague(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/notifications', tag: 'Points & XP', summary: 'My notifications', auth: 'session',
    query: pageQuery.extend({ unread: z.enum(['true', 'false']).optional(), category: z.enum(NOTIFICATION_CATEGORIES).optional() }),
    handler: (c) => listNotifications(c.db, c.actor.id, { ...c.query, unread: c.query.unread === 'true' }),
  }),
  route({
    method: 'POST', path: '/notifications/read', tag: 'Points & XP', summary: 'Mark all notifications as read', auth: 'session', body: emptyBody,
    handler: async (c) => {
      await markAllRead(c.db, c.actor.id, c.now);
      return { ok: true };
    },
  }),
  ...(['read', 'dismiss'] as const).map((action) => route({
    // The router reserves *Id parameters for UUIDs; notification keys are bigint sequences.
    method: 'POST', path: `/notifications/:notificationKey/${action}`, tag: 'Points & XP', summary: `Notification: ${action}`, auth: 'session', body: emptyBody,
    handler: (c) => {
      const key = c.params.notificationKey ?? '';
      if (!/^\d{1,18}$/.test(key)) throw badRequest('The notification key is not valid.');
      return updateNotification(c.db, c.actor.id, key, action, c.now);
    },
  })),
];
