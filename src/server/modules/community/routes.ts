import { z } from 'zod';
import { ADMINS, POST_FLAG_CATEGORIES, POST_STATUSES, POST_TYPES, STAFF } from '@/shared/domain';
import { pageQuery } from '../../http/pagination';
import { emptyBody, route, zText } from '../../http/router';
import * as moderation from './moderation';
import * as posts from './posts';
import * as responses from './responses';

const TAG = 'Komuniti';
const everyoneLocal = ['RESIDENT', ...STAFF] as const;
/** HQ can narrow the console to one township; others always see their own. */
const townshipQuery = z.object({ townshipId: z.uuid().optional() });

export const communityRoutes = [
  // The feed
  route({
    method: 'GET', path: '/posts', tag: TAG, summary: 'Events, help requests and items to give or lend: one type, several (GIVE,LEND) or all', auth: 'session', roles: everyoneLocal,
    query: pageQuery.extend({
      type: z.string().optional().transform((v) => (v ? v.split(',') : undefined)).pipe(z.array(z.enum(POST_TYPES)).optional()),
      q: z.string().trim().max(80).optional().transform((v) => v || undefined),
      mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    }),
    handler: (c) => posts.listPosts(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/posts/impact', tag: TAG, summary: 'Your verified community XP: events attended, items shared, neighbours helped', auth: 'session', roles: everyoneLocal,
    handler: (c) => posts.myImpact(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/posts', tag: TAG, summary: 'Create an event, a help request or a sharing offer', auth: 'session', roles: everyoneLocal,
    body: z.object({
      type: z.enum(POST_TYPES), title: zText(100, 3), body: zText(1000, 3), location: zText(120).optional(),
      startsAt: z.coerce.date().optional(), capacity: z.number().int().positive().max(5000).optional(),
    }),
    handler: (c) => posts.createPost(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/close', tag: TAG, summary: 'Close a post', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => posts.closePost(c.db, c.actor, c.params.postId!),
  }),

  // Responding, and the author's answers
  route({
    method: 'POST', path: '/posts/:postId/respond', tag: TAG, summary: 'Join, offer help or ask for an item', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => responses.respondToPost(c.db, c.actor, c.params.postId!, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/withdraw', tag: TAG, summary: 'Cancel your RSVP or request (events: before they start)', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => responses.withdrawResponse(c.db, c.actor, c.params.postId!, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/responses/:userId/accept', tag: TAG, summary: 'Accept a help, give-away or borrow request (loans need a return date)', auth: 'session', roles: everyoneLocal,
    body: z.object({ dueBack: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.').optional() }),
    handler: (c) => responses.acceptResponse(c.db, c.actor, c.params.postId!, c.params.userId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/responses/:userId/decline', tag: TAG, summary: 'Decline a request', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => responses.declineResponse(c.db, c.actor, c.params.postId!, c.params.userId!),
  }),
  route({
    method: 'POST', path: '/posts/:postId/responses/:userId/returned', tag: TAG, summary: 'Mark a lent item returned (gives the lender Impact XP)', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => responses.markReturned(c.db, c.actor, c.params.postId!, c.params.userId!, c.now),
  }),
  route({
    method: 'POST', path: '/posts/:postId/responses/:userId/confirm', tag: TAG, summary: 'Confirm it happened (gives Impact XP)', auth: 'session', roles: everyoneLocal, body: emptyBody,
    handler: (c) => responses.confirmResponse(c.db, c.actor, c.params.postId!, c.params.userId!, c.now),
  }),

  // Reporting a post
  route({
    method: 'POST', path: '/posts/:postId/flag', tag: TAG, summary: 'Report a post to township staff', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ category: z.enum(POST_FLAG_CATEGORIES).default('OTHER'), reason: zText(200, 3).optional() }),
    handler: (c) => moderation.flagPost(c.db, c.actor, c.params.postId!, c.body),
  }),

  // The console: township staff, township admins and HQ
  route({
    method: 'GET', path: '/admin/komuniti/overview', tag: TAG, summary: 'Komuniti at a glance: open posts, reports waiting, hidden posts, overdue loans, suspensions', auth: 'session', roles: STAFF,
    query: townshipQuery,
    handler: (c) => moderation.overview(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/admin/komuniti/reports', tag: TAG, summary: 'Reported posts waiting for a decision: hidden first, then scams and safety', auth: 'session', roles: STAFF,
    query: townshipQuery,
    handler: (c) => moderation.listReports(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/admin/komuniti/posts', tag: TAG, summary: 'Every post, including hidden and removed ones', auth: 'session', roles: STAFF,
    query: pageQuery.merge(townshipQuery).extend({
      status: z.enum(POST_STATUSES).optional(),
      type: z.enum(POST_TYPES).optional(),
      q: z.string().trim().max(80).optional().transform((v) => v || undefined),
    }),
    handler: (c) => moderation.listPosts(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'GET', path: '/admin/komuniti/posts/:postId', tag: TAG, summary: 'One post in full: responses, every report and decision, and the author’s record', auth: 'session', roles: STAFF,
    handler: (c) => moderation.getPost(c.db, c.actor, c.params.postId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/komuniti/posts/:postId/moderate', tag: TAG, summary: 'Keep (dismiss the reports), hide while checking, or remove with a reason', auth: 'session', roles: STAFF,
    body: z.object({ action: z.enum(['KEEP', 'HIDE', 'REMOVE']), note: zText(500, 3).optional() })
      .refine((b) => b.action !== 'REMOVE' || b.note, { path: ['note'], message: 'Tell the author why it was removed.' }),
    handler: (c) => moderation.moderatePost(c.db, c.actor, c.params.postId!, c.body, c.now),
  }),

  // Suspensions: township admins and HQ
  route({
    method: 'GET', path: '/admin/komuniti/suspensions', tag: TAG, summary: 'Residents who cannot post or respond in Komuniti right now', auth: 'session', roles: STAFF,
    query: townshipQuery,
    handler: (c) => moderation.listSuspensions(c.db, c.actor, c.query, c.now),
  }),
  route({
    method: 'POST', path: '/admin/komuniti/suspensions/:userId', tag: TAG, summary: 'Suspend a resident from Komuniti for some days (replaces an earlier suspension)', auth: 'session', roles: ADMINS,
    body: z.object({ days: z.number().int().min(1).max(365), reason: zText(300, 3) }),
    handler: (c) => moderation.suspendResident(c.db, c.actor, c.params.userId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/komuniti/suspensions/:userId/lift', tag: TAG, summary: 'Lift a Komuniti suspension early', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => moderation.liftSuspension(c.db, c.actor, c.params.userId!, c.now),
  }),
];
