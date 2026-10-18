import { z } from 'zod';
import { ADMINS, STAFF } from '@/shared/domain';
import { LOCKER_SIZES } from '@/shared/lockers';
import { sessionCookie } from '../../auth/session';
import { getConfig } from '../../config';
import { one } from '../../db/client';
import { AppError, notFound, unauthorized } from '../../errors';
import { emptyBody, route, zEmail, zId, zPhone, zText } from '../../http/router';
import * as companies from './companies';
import { deliverShipment } from '../lockers/delivery';
import * as federation from './federation';
import { shipmentMonitor } from './monitoring';
import * as sim from './simulated';
import * as simIdp from './sim-idp';
import * as team from './team';
import { verifyShipment } from './verification';

const zCode = z.string().trim().min(4).max(512);
const zEnvName = z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'An environment variable name, such as JNT_PROVIDER_SECRET.').nullable().optional();
const zIntegration = z.object({
  authMethod: z.enum(['MANUAL', 'COMPANY_MANAGED', 'FEDERATED']),
  providerMode: z.enum(['NONE', 'SIMULATED', 'GATEWAY']),
  providerUrl: z.url().max(300).nullable().optional(),
  providerSecretEnv: zEnvName,
  canConfirmAssignment: z.boolean().optional(),
  trackingPattern: z.string().trim().max(120).nullable().optional(),
  idpMode: z.enum(['SIMULATED', 'OIDC']).nullable().optional(),
  idpIssuer: z.url().max(300).nullable().optional(),
  idpClientId: z.string().trim().max(120).nullable().optional(),
  idpClientSecretEnv: zEnvName,
  webhookSecretEnv: zEnvName,
  requireMfa: z.boolean().optional(),
});

/** Strips what only the server needs from a verification. */
const forCourier = <T extends { _home?: unknown }>(v: T) => {
  const { _home, ...rest } = v;
  void _home;
  return rest;
};

export const carrierRoutes = [
  // --- Couriers: checking and delivering a scanned shipment ------------------------------------
  route({
    method: 'POST', path: '/courier/shipments/check', tag: 'Courier platform', summary: 'Check a scanned label with the courier company and SimeTown: no door opens (masked recipient only)', auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ stationId: zId, code: zCode }),
    handler: async (c) => forCourier(await verifyShipment(c.db, c.actor, c.body, c.now)),
  }),
  route({
    method: 'POST', path: '/courier/shipments/deliver', tag: 'Courier platform', summary: 'Check the shipment again and, if verified, reserve and open the smallest door that fits', auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 60, windowSec: 600, by: 'user' },
    body: z.object({ stationId: zId, code: zCode, size: z.enum(LOCKER_SIZES).optional(), idempotencyKey: z.string().min(8).max(80) }),
    handler: (c) => deliverShipment(c.db, c.actor, c.body, c.now),
  }),

  // --- Company managers: their own couriers -----------------------------------------------------
  route({
    method: 'GET', path: '/courier/team', tag: 'Courier platform', summary: "A company manager's couriers here, and the company's terms", auth: 'session', roles: ['COURIER'],
    handler: (c) => team.teamOverview(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/courier/team', tag: 'Courier platform', summary: 'Add one of the company’s couriers (they get a link to set a password)', auth: 'session', roles: ['COURIER'],
    rateLimit: { limit: 30, windowSec: 3600, by: 'user' },
    body: z.object({ fullName: zText(120, 2), email: zEmail, phone: zPhone.nullable().optional(), employeeRef: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes.') }),
    handler: (c) => team.inviteCourier(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/courier/team/:userId/status', tag: 'Courier platform', summary: 'Suspend, reactivate or remove one of the company’s couriers (sessions end at once)', auth: 'session', roles: ['COURIER'],
    body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']), note: z.string().trim().max(200).optional() }),
    handler: (c) => team.setTeamMember(c.db, c.actor, c.params.userId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/courier/team/:userId/reconfirm', tag: 'Courier platform', summary: 'Confirm the courier still works for the company', auth: 'session', roles: ['COURIER'], body: emptyBody,
    handler: (c) => team.reconfirmCourier(c.db, c.actor, c.params.userId!, c.now),
  }),

  // --- Signing in through a courier company -----------------------------------------------------
  route({
    method: 'GET', path: '/auth/courier-sso/companies', tag: 'Courier platform', summary: 'Courier companies whose couriers sign in with the company’s own sign-in', auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: (c) => federation.federatedCompanies(c.db),
  }),
  route({
    method: 'POST', path: '/auth/courier-sso/start', tag: 'Courier platform', summary: 'Start signing in through a courier company (OpenID Connect with PKCE)', auth: 'public',
    rateLimit: { limit: 20, windowSec: 600, by: 'ip' },
    body: z.object({ company: z.string().trim().regex(/^[A-Za-z0-9]{2,12}$/), returnTo: z.string().max(200).optional() }),
    handler: (c) => federation.startCourierSso(c.db, c.body.company, c.body.returnTo, c.now),
  }),
  route({
    method: 'GET', path: '/auth/courier-sso/callback', tag: 'Courier platform', summary: 'Where the courier company sends the courier back; signs them in for one shift', auth: 'public',
    rateLimit: { limit: 20, windowSec: 600, by: 'ip' },
    query: z.object({ code: z.string().min(10).max(200).optional(), state: z.string().min(10).max(200).optional(), error: z.string().max(100).optional() }),
    handler: async (c) => {
      const back = (path: string, cookie?: string) => new Response(null, { status: 303, headers: { Location: `${getConfig().appOrigin}${path}`, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
      if (!c.query.code || !c.query.state) return back('/login?sso=cancelled');
      try {
        const { token, returnTo } = await federation.completeCourierSso(c.db, { state: c.query.state, code: c.query.code, ip: c.ip, userAgent: c.req.headers.get('user-agent') }, c.now);
        return back(returnTo, sessionCookie(token));
      } catch (error) {
        const message = error instanceof AppError ? error.message : 'The sign-in could not be completed.';
        return back(`/login?sso=failed&message=${encodeURIComponent(message.slice(0, 200))}`);
      }
    },
  }),

  // --- The simulated companies' sign-in (demo only; refused in production) ----------------------
  route({
    method: 'GET', path: '/sim-idp/:code/.well-known/openid-configuration', tag: 'Simulated courier companies', summary: 'Discovery document of a simulated company’s sign-in', auth: 'public',
    handler: async (c) => {
      if (getConfig().APP_ENV === 'production' || !(await one(c.db, `SELECT 1 FROM courier_companies WHERE code = $1 AND idp_mode = 'SIMULATED'`, [c.params.code!.toUpperCase()]))) throw notFound('Simulated sign-in');
      return simIdp.simDiscovery(c.params.code!.toUpperCase());
    },
  }),
  route({
    method: 'GET', path: '/sim-idp/:code/jwks', tag: 'Simulated courier companies', summary: 'Signing keys of a simulated company’s sign-in', auth: 'public',
    handler: (c) => simIdp.simJwks(c.db, c.params.code!),
  }),
  route({
    method: 'GET', path: '/sim-idp/:code/page', tag: 'Simulated courier companies', summary: 'What the simulated sign-in page shows', auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: (c) => simIdp.simSignInPage(c.db, c.params.code!),
  }),
  route({
    method: 'POST', path: '/sim-idp/:code/authorize', tag: 'Simulated courier companies', summary: 'The simulated company checks its employee and issues a one-time code', auth: 'public',
    rateLimit: { limit: 20, windowSec: 600, by: 'ip' },
    body: z.object({
      clientId: z.string().max(80), redirectUri: z.string().max(300), state: z.string().max(200), nonce: z.string().max(200), codeChallenge: z.string().max(100),
      codeChallengeMethod: z.string().max(10), employeeRef: z.string().trim().max(40), password: z.string().max(200), otp: z.string().trim().max(10).optional(),
    }),
    handler: (c) => simIdp.simAuthorize(c.db, c.params.code!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/sim-idp/:code/token', tag: 'Simulated courier companies', summary: 'The simulated company exchanges the code for a signed ID token (PKCE)', auth: 'public',
    rateLimit: { limit: 60, windowSec: 600, by: 'ip' },
    body: z.object({ code: z.string().max(200), code_verifier: z.string().max(200), client_id: z.string().max(80), redirect_uri: z.string().max(300) }),
    handler: (c) => simIdp.simToken(c.db, c.params.code!, { code: c.body.code, codeVerifier: c.body.code_verifier, clientId: c.body.client_id, redirectUri: c.body.redirect_uri }, c.now),
  }),

  route({
    method: 'GET', path: '/demo/labels', tag: 'Simulated courier companies', summary: 'Printable demo labels for the simulated companies’ fictional shipments (demo only)', auth: 'public',
    rateLimit: { limit: 60, windowSec: 60, by: 'ip' },
    handler: (c) => sim.demoLabels(c.db),
  }),

  // --- A company's own system telling SimeTown about its staff (signed) --------------------------
  route({
    method: 'POST', path: '/couriers/:code/directory-events', tag: 'Courier platform', summary: 'A courier company suspends, reactivates or removes one of its couriers (HMAC-signed, applied once)', auth: 'machine',
    rateLimit: { limit: 120, windowSec: 60, by: 'ip' },
    body: z.object({
      eventId: z.string().trim().min(8).max(80), employeeRef: z.string().trim().min(2).max(120), status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']),
      ts: z.iso.datetime(), signature: z.string().regex(/^[0-9a-fA-F]{64}$/),
    }),
    handler: async (c) => {
      const company = await one<{ id: string; name: string; webhook_secret_env: string | null }>(c.db, 'SELECT id, name, webhook_secret_env FROM courier_companies WHERE code = $1', [c.params.code!.toUpperCase()]);
      const secret = company?.webhook_secret_env ? process.env[company.webhook_secret_env] : undefined;
      if (!company || !secret || secret.length < 32) throw unauthorized('The message is not signed correctly.');
      const { signature, ...message } = c.body;
      federation.verifyWebhook(secret, message, signature.toLowerCase(), c.now);
      return federation.applyDirectoryChange(c.db, company, { employeeRef: message.employeeRef, active: message.status === 'REMOVED' ? 'REMOVED' : message.status === 'ACTIVE', eventId: message.eventId }, c.now);
    },
  }),

  // --- Township: companies and shipment checks -------------------------------------------------
  route({
    method: 'GET', path: '/admin/couriers/companies', tag: 'Courier platform', summary: 'Courier companies with their approval, stations, representatives, integration and history', auth: 'session', roles: STAFF,
    handler: (c) => companies.listCourierCompanies(c.db, c.actor, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies', tag: 'Courier platform', summary: 'Start onboarding a courier company (it can do nothing until approved)', auth: 'session', roles: ADMINS,
    body: zIntegration.extend({ name: zText(60, 2), code: z.string().trim().regex(/^[A-Za-z0-9]{2,12}$/, '2 to 12 letters or numbers.') }),
    handler: (c) => companies.onboardCompany(c.db, c.actor, c.body, c.now),
  }),
  route({
    method: 'PATCH', path: '/admin/couriers/companies/:companyId/integration', tag: 'Courier platform', summary: 'How the company’s couriers sign in and how its shipments are checked', auth: 'session', roles: ADMINS,
    body: zIntegration,
    handler: (c) => companies.updateIntegration(c.db, c.actor, c.params.companyId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/decision', tag: 'Courier platform', summary: 'Approve, suspend or revoke a company here, with its agreement and assurance terms', auth: 'session', roles: ADMINS,
    body: z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']), reason: z.string().trim().max(300).optional(), verifiedNote: z.string().trim().max(300).optional(),
      agreementRef: z.string().trim().max(80).optional(), agreementUntil: z.iso.date().nullable().optional(), minAssurance: z.enum(['HIGH', 'MEDIUM']).optional(), allowFallback: z.boolean().optional(),
    }),
    handler: (c) => companies.decideCompany(c.db, c.actor, c.params.companyId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/stations', tag: 'Courier platform', summary: 'The stations the company’s couriers may use', auth: 'session', roles: ADMINS,
    body: z.object({ stationIds: z.array(zId).max(100) }),
    handler: (c) => companies.setCompanyStations(c.db, c.actor, c.params.companyId!, c.body.stationIds, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/representatives', tag: 'Courier platform', summary: 'Add a representative the company has named (returns a one-time link)', auth: 'session', roles: ADMINS,
    body: z.object({ fullName: zText(120, 2), email: zEmail, phone: zPhone.nullable().optional() }),
    handler: (c) => companies.inviteRepresentative(c.db, c.actor, c.params.companyId!, c.body, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/representatives/:userId/remove', tag: 'Courier platform', summary: 'Remove a company representative', auth: 'session', roles: ADMINS, body: emptyBody,
    handler: (c) => companies.removeRepresentative(c.db, c.actor, c.params.companyId!, c.params.userId!, c.now),
  }),
  route({
    method: 'POST', path: '/admin/couriers/companies/:companyId/simulated-outage', tag: 'Simulated courier companies', summary: 'Simulated companies only: switch the company’s system down or up', auth: 'session', roles: ADMINS,
    body: z.object({ down: z.boolean() }),
    handler: (c) => companies.setSimulatedOutage(c.db, c.actor, c.params.companyId!, c.body.down, c.now),
  }),
  route({
    method: 'GET', path: '/admin/couriers/shipments', tag: 'Courier platform', summary: 'Shipment checks this week, the latest scans, repeated scans and provider health', auth: 'session', roles: STAFF,
    handler: (c) => shipmentMonitor(c.db, c.actor, c.now),
  }),
  route({
    method: 'GET', path: '/admin/couriers/simulated', tag: 'Simulated courier companies', summary: 'The simulated companies’ fictional shipments and staff directories', auth: 'session', roles: STAFF,
    handler: (c) => sim.simulatedOverview(c.db, c.actor),
  }),
  route({
    method: 'POST', path: '/admin/couriers/simulated/shipments/:shipmentId', tag: 'Simulated courier companies', summary: 'Act as the simulated company changing a shipment’s status', auth: 'session', roles: STAFF,
    body: z.object({ status: z.enum(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'RETURNED']) }),
    handler: (c) => sim.setSimulatedShipment(c.db, c.actor, c.params.shipmentId!, c.body),
  }),
  route({
    method: 'POST', path: '/admin/couriers/simulated/:companyId/directory/:employeeRef', tag: 'Simulated courier companies', summary: 'Act as the simulated company suspending or reactivating one of its staff', auth: 'session', roles: STAFF,
    body: z.object({ active: z.boolean() }),
    handler: (c) => sim.setSimulatedEmployee(c.db, c.actor, c.params.companyId!, c.params.employeeRef!, c.body.active, c.now),
  }),
];
