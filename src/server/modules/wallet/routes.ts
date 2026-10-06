import { z } from 'zod';
import { pageQuery } from '../../http/pagination';
import { emptyBody, route } from '../../http/router';
import { decideSale } from '../merchant/service';
import { listNotifications, markAllRead } from '../notifications';
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
    handler: (c) => listNotifications(c.db, c.actor.id),
  }),
  route({
    method: 'POST', path: '/notifications/read', tag: 'Points & XP', summary: 'Mark all notifications as read', auth: 'session', body: emptyBody,
    handler: async (c) => {
      await markAllRead(c.db, c.actor.id, c.now);
      return { ok: true };
    },
  }),
];
