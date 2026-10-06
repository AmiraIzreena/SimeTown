import { z } from 'zod';
import { POST_TYPES, STAFF } from '@/shared/domain';
import { pageQuery } from '../../http/pagination';
import { emptyBody, route, zText } from '../../http/router';
import * as community from './service';

const everyoneLocal = ['RESIDENT', ...STAFF] as const;

export const communityRoutes = [
  route({
    method: 'GET', path: '/posts', tag: 'Jiran & Kongsi', summary: 'Events, help requests and items to give or lend', auth: 'session', roles: everyoneLocal,
    query: pageQuery.extend({ type: z.enum(POST_TYPES), mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }),
    handler: (c) => community.listPosts(c.db, c.actor, c.query),
  }),
  route({
    method: 'POST', path: '/posts', tag: 'Jiran & Kongsi', summary: 'Create an event, a help request or a sharing offer', auth: 'session', roles: everyoneLocal,
    body: z.object({
      type: z.enum(POST_TYPES), title: zText(100, 3), body: zText(1000, 3), location: zText(120).optional(),
      startsAt: z.coerce.date().optional(), capacity: z.number().int().positive().max(5000).optional(),
    }),
    handler: (c) => community.createPost(c.db, c.actor, c.body),
  }),
  route({
    method: 'POST', path: '/posts/:postId/respond', tag: 'Jiran & Kongsi', summary: 'Join, offer help or ask for an item', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => community.respondToPost(c.db, c.actor, c.params.postId!),
  }),
  route({
    method: 'POST', path: '/posts/:postId/responses/:userId/confirm', tag: 'Jiran & Kongsi', summary: 'Confirm it happened (gives Impact XP)', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => community.confirmResponse(c.db, c.actor, c.params.postId!, c.params.userId!, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/close', tag: 'Jiran & Kongsi', summary: 'Close a post', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => community.closePost(c.db, c.actor, c.params.postId!),
  }),
  route({
    method: 'POST', path: '/posts/:postId/flag', tag: 'Jiran & Kongsi', summary: 'Flag a post for moderators', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ reason: zText(200, 3) }),
    handler: (c) => community.flagPost(c.db, c.actor, c.params.postId!, c.body.reason),
  }),
  route({
    method: 'GET', path: '/moderation/posts', tag: 'Jiran & Kongsi', summary: 'Posts hidden by flags, waiting for review', auth: 'session', roles: STAFF,
    handler: (c) => community.moderationQueue(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/moderation/posts/:postId', tag: 'Jiran & Kongsi', summary: 'Restore or remove a hidden post', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['RESTORE', 'REMOVE']) }),
    handler: (c) => community.moderatePost(c.db, c.actor, c.params.postId!, c.body.action),
  }),
];
