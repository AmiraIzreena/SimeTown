import { z } from 'zod';
import { ADMINS, ROLES, STAFF } from '@/shared/domain';
import { destroySession, readSessionToken, sessionCookie } from '../../auth/session';
import { recordCourierLogin } from '../carriers/team';
import { pageQuery } from '../../http/pagination';
import { emptyBody, json, route, zAcceptTerms, zEmail, zId, zPassword, zPhone, zText } from '../../http/router';
import { addressOptions, homesOnStreet, listTownships } from '../townships';
import * as identity from './service';

const signedIn = (data: unknown, token: string | null) => json({ data }, { headers: { 'Set-Cookie': sessionCookie(token) } });
const preSignIn = (limit: number, windowSec: number) => ({ limit, windowSec, by: 'ip' as const });
const zOccupancy = z.enum(['OWNER', 'TENANT']);

export const identityRoutes = [
  route({
    method: 'GET', path: '/townships', tag: 'SimeTown ID', summary: 'Townships that use SimeTown', auth: 'public',
    handler: (c) => listTownships(c.db),
  }),
  route({
    method: 'GET', path: '/townships/:townshipId/addresses', tag: 'SimeTown ID', summary: "The township's precincts and streets, for the address picker", auth: 'public',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    handler: (c) => addressOptions(c.db, c.params.townshipId!),
  }),
  route({
    method: 'GET', path: '/townships/:townshipId/homes', tag: 'SimeTown ID', summary: 'Houses and units on one street, for the address picker (addresses only)', auth: 'public',
    rateLimit: { limit: 240, windowSec: 60, by: 'ip' },
    query: z.object({ street: zText(120), precinct: zText(120).optional() }),
    handler: (c) => homesOnStreet(c.db, c.params.townshipId!, c.query.precinct ?? null, c.query.street),
  }),
  route({
    method: 'POST', path: '/auth/register', tag: 'SimeTown ID', summary: 'Register as a resident (starts unverified)', auth: 'public',
    rateLimit: preSignIn(10, 3600),
    body: z.object({
      email: zEmail, password: zPassword, fullName: zText(100, 2), phone: zPhone,
      townshipId: zId, homeId: zId, occupancy: zOccupancy, acceptTerms: zAcceptTerms,
    }),
    handler: async (c) => {
      const { token, actor } = await identity.registerResident(c.db, c.body, c.now);
      return signedIn(actor, token);
    },
  }),
  route({
    method: 'POST', path: '/auth/login', tag: 'SimeTown ID', summary: 'Sign in', auth: 'public',
    rateLimit: preSignIn(60, 900),
    body: z.object({ email: zEmail, password: z.string().min(1).max(200) }),
    handler: async (c) => {
      // Per account and address: guessing from one address is slowed, but a stranger cannot lock the owner out.
      await c.limit(`login:${c.body.email}:${c.ip}`, 10, 900);
      // A much higher ceiling per account still stops guessing spread over many addresses.
      await c.limit(`login:${c.body.email}`, 100, 900);
      const { token, actor } = await identity.login(c.db, c.body, c.now);
      if (actor.role === 'COURIER') await recordCourierLogin(c.db, actor.id, 'PASSWORD', c.ip, c.req.headers.get('user-agent'), c.now);
      return signedIn(actor, token);
    },
  }),
  route({
    method: 'POST', path: '/auth/accept-invite', tag: 'SimeTown ID', summary: 'Set a password from an invitation link', auth: 'public',
    rateLimit: preSignIn(20, 900),
    body: z.object({ token: z.string().min(20).max(100), password: zPassword, acceptTerms: zAcceptTerms }),
    handler: async (c) => {
      const { token, actor } = await identity.acceptInvite(c.db, c.body, c.now);
      return signedIn(actor, token);
    },
  }),
  route({
    method: 'POST', path: '/auth/logout', tag: 'SimeTown ID', summary: 'Sign out', auth: 'session', body: emptyBody,
    handler: async (c) => {
      const token = readSessionToken(c.req.headers.get('cookie'));
      if (token) await destroySession(c.db, token);
      return signedIn({ ok: true }, null);
    },
  }),
  route({
    method: 'GET', path: '/me', tag: 'SimeTown ID', summary: 'The signed-in account, with any required details still missing', auth: 'session',
    handler: (c) => identity.profile(c.db, c.actor),
  }),
  route({
    method: 'PATCH', path: '/me', tag: 'SimeTown ID', summary: 'Update name and phone (both required)', auth: 'session',
    body: z.object({ fullName: zText(100, 2), phone: zPhone }),
    handler: (c) => identity.updateProfile(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/me/language', tag: 'SimeTown ID', summary: 'Choose English or Bahasa Malaysia', auth: 'session',
    body: z.object({ language: z.enum(['en', 'ms']) }),
    handler: (c) => identity.setLanguage(c.db, c.actor, c.body.language),
  }),
  route({
    method: 'POST', path: '/me/terms', tag: 'SimeTown ID', summary: 'Accept the Terms of Use and Privacy Notice now in force', auth: 'session',
    body: z.object({ version: zText(40) }),
    handler: (c) => identity.acceptTerms(c.db, c.actor, c.body.version, c.now),
  }),
  route({
    method: 'POST', path: '/me/home', tag: 'SimeTown ID', summary: 'Set or change my address (a new home is confirmed again)', auth: 'session', roles: ['RESIDENT'],
    rateLimit: { limit: 10, windowSec: 3600, by: 'user' },
    body: z.object({ homeId: zId, occupancy: zOccupancy }),
    handler: (c) => identity.changeHome(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/me/password', tag: 'SimeTown ID', summary: 'Change password (signs out other devices)', auth: 'session',
    rateLimit: { limit: 10, windowSec: 900, by: 'user' },
    body: z.object({ current: z.string().min(1).max(200), next: zPassword }),
    handler: async (c) => signedIn({ ok: true }, await identity.changePassword(c.db, c.actor, c.body, c.now)),
  }),
  route({
    method: 'GET', path: '/me/export', tag: 'SimeTown ID', summary: 'Download everything held about me (PDPA)', auth: 'session',
    handler: async (c) =>
      json(await identity.exportMyData(c.db, c.actor), { headers: { 'Content-Disposition': 'attachment; filename="kita-plus-my-data.json"' } }),
  }),
  route({
    method: 'POST', path: '/me/delete', tag: 'SimeTown ID', summary: 'Delete my account (PDPA)', auth: 'session',
    rateLimit: { limit: 5, windowSec: 900, by: 'user' },
    body: z.object({ password: z.string().min(1).max(200) }),
    handler: async (c) => signedIn(await identity.deleteAccount(c.db, c.actor, c.body.password, c.now), null),
  }),
  route({
    method: 'GET', path: '/household/requests', tag: 'SimeTown ID', summary: 'Tenants waiting for this owner to confirm them', auth: 'session', roles: ['RESIDENT'],
    handler: (c) => identity.householdRequests(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/household/requests/:userId', tag: 'SimeTown ID', summary: 'Owner confirms or declines a tenant', auth: 'session', roles: ['RESIDENT'],
    body: z.object({ approve: z.boolean() }),
    handler: (c) => identity.decideTenant(c.db, c.actor, c.params.userId!, c.body.approve, c.now),
  }),
  route({
    method: 'GET', path: '/admin/residents', tag: 'SimeTown ID', summary: 'Residents by verification status', auth: 'session', roles: STAFF,
    query: pageQuery.extend({
      status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
      q: z.string().trim().max(60).optional(),
      precinct: z.string().trim().min(1).max(120).optional(),
    }),
    handler: (c) => identity.listResidents(c.db, c.actor, c.query),
  }),
  route({
    method: 'GET', path: '/admin/residents/places', tag: 'SimeTown ID', summary: 'Every place (precinct) with residents waiting, confirmed and rejected', auth: 'session', roles: STAFF,
    handler: (c) => identity.residentPlaces(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/residents/:userId/verify', tag: 'SimeTown ID', summary: 'Confirm or reject a resident against the property record (a rejection may give a reason)', auth: 'session', roles: STAFF,
    body: z.object({ approve: z.boolean(), reason: zText(300).optional() }),
    handler: (c) => identity.verifyResident(c.db, c.actor, c.params.userId!, c.body.approve, c.now, c.body.approve ? undefined : c.body.reason),
  }),
  route({
    method: 'GET', path: '/admin/accounts', tag: 'SimeTown ID', summary: 'Shop, sponsor and staff accounts', auth: 'session', roles: ADMINS,
    handler: (c) => identity.listAccounts(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/accounts', tag: 'SimeTown ID', summary: 'Create a shop, sponsor or staff account and get its invitation link', auth: 'session', roles: ADMINS,
    body: z.object({
      email: zEmail, fullName: zText(100, 2), role: z.enum(ROLES).exclude(['RESIDENT']),
      townshipId: zId.optional(), merchantId: zId.optional(), sponsorId: zId.optional(),
    }),
    handler: (c) => identity.createUser(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/accounts/:userId/invite', tag: 'SimeTown ID', summary: 'Issue a set-password link (a second admin approves it if the account is in use)', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => identity.reinvite(c.db, c.actor, c.params.userId!, c.now),
  }),
  route({
    method: 'GET', path: '/admin/account-requests', tag: 'SimeTown ID', summary: 'New admin accounts and password links waiting for a second admin', auth: 'session', roles: ADMINS,
    handler: (c) => identity.listAccountRequests(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/account-requests/:requestId/decision', tag: 'SimeTown ID', summary: 'Approve or reject an account request (not your own)', auth: 'session', roles: ADMINS,
    body: z.object({ approve: z.boolean() }),
    handler: (c) => identity.decideAccountRequest(c.db, c.actor, c.params.requestId!, c.body.approve, c.now),
  }),
];
