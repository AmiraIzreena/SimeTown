import { z } from 'zod';
import { STAFF } from '@/shared/domain';
import { emptyBody, route, zId, zText } from '../../http/router';
import * as assistant from './service';

export const assistantRoutes = [
  route({
    method: 'GET', path: '/assistant/status', tag: 'Assistant', summary: 'Whether answers come from the AI or the rules, and your AI questions used today', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => assistant.assistantStatus(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/assistant/ask', tag: 'Assistant', summary: 'Ask the Assistant; it answers from your own data and checked township facts, and saves the turn', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 30, windowSec: 600, by: 'user' },
    body: z.object({ conversationId: zId.optional(), message: zText(1000, 1), lang: z.enum(['en', 'ms']).default('en') }),
    handler: (c) => assistant.ask(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/assistant/actions/:actionId/confirm', tag: 'Assistant', summary: 'Yes: do what the Assistant proposed (a visitor pass, or sending a question to the office)', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    rateLimit: { limit: 20, windowSec: 600, by: 'user' },
    handler: (c) => assistant.confirmAction(c.db, c.actor, c.params.actionId!, c.now),
  }),
  route({
    method: 'POST', path: '/assistant/actions/:actionId/edit', tag: 'Assistant', summary: 'Change the details of a proposal before saying Yes (the pass times, or the question for the office)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({
      pass: z
        .object({
          visitorName: zText(80, 2),
          date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/, 'Choose a day.'),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time.'),
          hours: z.number().int().min(1, 'At least 1 hour.').max(48, 'At most 48 hours.'),
          type: z.enum(['ONE_VISIT', 'DELIVERY', 'EVENT']),
          vehicleNo: z.string().trim().max(15).optional(),
        })
        .optional(),
      question: zText(1000, 5).optional(),
    }),
    handler: (c) => assistant.editAction(c.db, c.actor, c.params.actionId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/assistant/actions/:actionId/cancel', tag: 'Assistant', summary: 'No: drop what the Assistant proposed', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => assistant.cancelAction(c.db, c.actor, c.params.actionId!, c.now),
  }),
  route({
    method: 'GET', path: '/assistant/conversations', tag: 'Assistant', summary: 'Your saved Assistant conversations, newest first', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => assistant.listConversations(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/assistant/conversations/:conversationId', tag: 'Assistant', summary: 'One of your conversations, with its messages', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => assistant.getConversation(c.db, c.actor, c.params.conversationId!, c.now),
  }),
  route({
    method: 'POST', path: '/assistant/conversations/:conversationId/delete', tag: 'Assistant', summary: 'Delete one of your conversations', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => assistant.deleteConversation(c.db, c.actor, c.params.conversationId!),
  }),
  route({
    method: 'POST', path: '/assistant/conversations/delete-all', tag: 'Assistant', summary: 'Delete all your conversations', auth: 'session', roles: ['RESIDENT'], body: emptyBody,
    handler: (c) => assistant.deleteAllConversations(c.db, c.actor),
  }),
  route({
    method: 'GET', path: '/admin/assistant/handoffs', tag: 'Assistant', summary: 'Questions residents sent to the township office through the Assistant', auth: 'session', roles: STAFF,
    handler: (c) => assistant.listHandoffs(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/assistant/handoffs/:handoffId/answer', tag: 'Assistant', summary: "Answer a resident's question; the reply appears in their chat", auth: 'session', roles: STAFF,
    body: z.object({ answer: zText(2000, 2) }),
    handler: (c) => assistant.answerHandoff(c.db, c.actor, c.params.handoffId!, c.body.answer, c.now),
  }),
];
