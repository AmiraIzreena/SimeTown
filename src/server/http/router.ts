import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z, type ZodType } from 'zod';
import { MALAYSIAN_STATES, normalizePhone, type Role } from '@/shared/domain';
import type { Actor } from '../auth/actor';
import { actorFromToken, readSessionToken } from '../auth/session';
import { getConfig, type Config } from '../config';
import { getDb, type Db } from '../db/client';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../errors';
import { log } from '../logger';
import { readBody } from './body';
import { enforceRateLimit } from './rate-limit';

/**
 * A small declarative router. Every endpoint is one `RouteDef` that states who
 * may call it and what it accepts. Authentication, role checks, the CSRF origin
 * check, validation, rate limiting, logging and error mapping all happen here,
 * once, so no handler can forget them. The same table generates the API docs.
 */

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface Ctx<B = unknown, Q = unknown> {
  db: Db;
  /** The signed-in person. Always set on `session` routes. */
  actor: Actor;
  params: Record<string, string>;
  body: B;
  query: Q;
  req: Request;
  now: Date;
  ip: string;
  /** An extra rate limit inside a handler, for example per email address on sign-in. */
  limit(key: string, limit: number, windowSec: number): Promise<void>;
}

export interface RouteDef<B = unknown, Q = unknown> {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  /**
   * public  = no sign-in needed
   * session = signed-in browser session; `roles` narrows it
   * cron / sensor = machine caller with a bearer token from the environment
   * machine = a device that signs each record with its own key; the handler must verify the signature
   */
  auth: 'public' | 'session' | 'cron' | 'sensor' | 'machine';
  roles?: readonly Role[];
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Overrides the default write limit. `by: 'ip'` is for endpoints used before sign-in. */
  rateLimit?: { limit: number; windowSec: number; by: 'ip' | 'user' };
  handler: (c: Ctx<B, Q>) => Promise<unknown>;
}

/** Keeps each route's body and query types attached to its handler. */
export function route<B = undefined, Q = undefined>(def: RouteDef<B, Q>): RouteDef {
  return def as unknown as RouteDef;
}

const DEFAULT_WRITE_LIMIT = { limit: 120, windowSec: 60, by: 'user' as const };
const MAX_JSON_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Compiled {
  def: RouteDef;
  pattern: RegExp;
  keys: string[];
}

function compile(def: RouteDef): Compiled {
  const keys: string[] = [];
  const pattern = def.path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { def, pattern: new RegExp(`^${pattern}$`), keys };
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...init.headers },
  });
}

/**
 * The caller's address, which keys the per-address rate limits. Only entries a
 * proxy we run has added can be trusted: anything further left in
 * X-Forwarded-For was written by the client and could be anything.
 */
export function clientIpFrom(headers: Headers, mode: Config['TRUST_PROXY'], hops: number): string {
  if (mode === 'cloudflare') return headers.get('cf-connecting-ip')?.trim() || 'unknown';
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  // forwarded: the address our outermost proxy saw, `hops` entries from the right.
  // none (local development only): Next.js fills the header from the connection when the client sent none.
  return chain[mode === 'forwarded' ? chain.length - hops : chain.length - 1] ?? 'unknown';
}

/** Cloudflare's ray id ties our logs to Cloudflare's, but only when Cloudflare is really in front. */
function requestIdOf(req: Request): string {
  try {
    if (getConfig().TRUST_PROXY === 'cloudflare') return req.headers.get('cf-ray') ?? randomUUID();
  } catch {
    // An invalid configuration is reported by the request itself, below.
  }
  return randomUUID();
}

function bearerMatches(req: Request, secret: string | undefined): boolean {
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/**
 * Browsers attach cookies to cross-site form posts. Requiring the Origin header
 * to be our own origin on every state-changing request (with SameSite=Lax
 * cookies as a second layer) stops cross-site request forgery.
 */
function assertSameOrigin(req: Request): void {
  if (req.headers.get('origin') !== getConfig().appOrigin) {
    throw forbidden('This request did not come from the SimeTown app.');
  }
}

async function readJson(req: Request): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw badRequest('Send the request body as JSON.');
  }
  const text = new TextDecoder().decode(await readBody(req, MAX_JSON_BYTES));
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

/** A path segment such as an id; broken %-encoding cannot name anything, so it is "not found". */
function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw notFound();
  }
}

function validate<T>(schema: ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[issue.path.join('.') || where] ??= issue.message;
  throw new AppError(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', { fields });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    const retry = (error.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    if (retry) headers['Retry-After'] = String(retry);
    return json({ error: { code: error.code, message: error.message, details: error.details, requestId } }, { status: error.status, headers });
  }
  const code = (error as { code?: string }).code;
  // Database constraint errors that slipped past a service check: answer politely instead of with a 500.
  if (code === '22P02') return json({ error: { code: 'BAD_REQUEST', message: 'An id in the request is not valid.', requestId } }, { status: 400 });
  if (code === '23503') return json({ error: { code: 'BAD_REQUEST', message: 'Something this request refers to does not exist.', requestId } }, { status: 400 });
  if (code === '23505') return json({ error: { code: 'CONFLICT', message: 'This has already been recorded.', requestId } }, { status: 409 });
  if (code === '23514') return json({ error: { code: 'RULE_VIOLATION', message: 'This would break one of the programme rules.', requestId } }, { status: 422 });
  if (code === '22003' || code === '22007' || code === '22008') {
    return json({ error: { code: 'BAD_REQUEST', message: 'A value in the request is out of range.', requestId } }, { status: 400 });
  }
  return json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId } }, { status: 500 });
}

export interface Router {
  handle(req: Request): Promise<Response>;
  routes: RouteDef[];
}

export function createRouter(routes: RouteDef[], options: { prefix: string; db?: () => Promise<Db>; now?: () => Date }): Router {
  const table = routes.map(compile);
  const openDb = options.db ?? getDb;
  const clock = options.now ?? (() => new Date());

  async function handle(req: Request): Promise<Response> {
    const started = Date.now();
    const requestId = requestIdOf(req);
    const url = new URL(req.url);
    const path = url.pathname.slice(options.prefix.length).replace(/\/$/, '') || '/';
    let status = 500;
    let actorId: string | undefined;

    try {
      const candidates = table.map((r) => ({ r, match: r.pattern.exec(path) })).filter((c) => c.match);
      const found = candidates.find((c) => c.r.def.method === req.method);
      if (!found) {
        throw candidates.length ? new AppError(405, 'METHOD_NOT_ALLOWED', 'This action is not available here.') : notFound('Endpoint');
      }
      const { def, keys } = found.r;
      const params = Object.fromEntries(keys.map((key, i) => [key, decodePathPart(found.match![i + 1]!)]));
      for (const [key, value] of Object.entries(params)) {
        if (/id$/i.test(key) && !UUID.test(value)) throw notFound();
      }

      const db = await openDb();
      const now = clock();
      const { TRUST_PROXY, TRUSTED_PROXY_HOPS } = getConfig();
      const ip = clientIpFrom(req.headers, TRUST_PROXY, TRUSTED_PROXY_HOPS);
      const write = req.method !== 'GET';
      let actor: Actor | null = null;

      if (def.auth === 'cron' || def.auth === 'sensor') {
        const secret = def.auth === 'cron' ? getConfig().CRON_SECRET : getConfig().SENSOR_INGEST_TOKEN;
        if (!secret) throw notFound('Endpoint'); // feature switched off
        if (!bearerMatches(req, secret)) throw unauthorized('A valid token is required.');
      } else if (def.auth === 'machine') {
        // No cookie and no Origin: a device, not a browser. Its handler checks the record's signature
        // against that machine's own key before anything is stored.
      } else {
        if (write) assertSameOrigin(req);
        if (def.auth === 'session') {
          actor = await actorFromToken(db, readSessionToken(req.headers.get('cookie')), now);
          if (!actor) throw unauthorized();
          actorId = actor.id;
          if (def.roles && !def.roles.includes(actor.role)) throw forbidden();
        }
      }

      const limit = def.rateLimit ?? (write && actor ? DEFAULT_WRITE_LIMIT : undefined);
      if (limit) {
        const who = limit.by === 'user' && actor ? `u:${actor.id}` : `ip:${ip}`;
        await enforceRateLimit(db, `${def.method} ${def.path} ${who}`, limit.limit, limit.windowSec, now);
      }

      const query = def.query ? validate(def.query, Object.fromEntries(url.searchParams), 'query') : undefined;
      const body = def.body ? validate(def.body, await readJson(req), 'body') : undefined;

      const result = await def.handler({
        db, actor: actor as Actor, params, body, query, req, now, ip,
        limit: (key, max, windowSec) => enforceRateLimit(db, key, max, windowSec, now),
      });
      const response = result instanceof Response ? result : json({ data: result ?? null });
      status = response.status;
      response.headers.set('X-Request-Id', requestId);
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId);
      status = response.status;
      if (status >= 500) log.error('Request failed', error, { requestId, method: req.method, path });
      // A database rule caught what a service check should have: answered politely, but kept visible.
      else if (!(error instanceof AppError)) log.warn('Request refused by a database rule', { requestId, method: req.method, path, code: (error as { code?: string }).code });
      response.headers.set('X-Request-Id', requestId);
      return response;
    } finally {
      log.info('request', { requestId, method: req.method, path, status, ms: Date.now() - started, actorId });
    }
  }

  return { handle, routes };
}

// --- Small schema helpers shared by the route files ---------------------------

export const zId = z.uuid();
export const zText = (max: number, min = 1) => z.string().trim().min(min).max(max);
/** An amount of money in whole sen. */
export const zSen = (max = 100_000_000) => z.number().int().positive().max(max);
export const zEmail = z.email().max(254).transform((v) => v.toLowerCase());
export const zPassword = z.string().min(10, 'Use at least 10 characters.').max(200);
export const emptyBody = z.object({}).strict();
/** A phone number, checked and stored in international form ("+60123456789"). */
export const zPhone = z
  .string()
  .trim()
  .max(30)
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (phone) return phone;
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, such as 012-345 6789.' });
    return z.NEVER;
  });
/** The person ticked "I accept the Terms of Use and Privacy Notice". */
export const zAcceptTerms = z.literal(true, { error: 'Please read and accept the Terms of Use and Privacy Notice.' });
export const zPostcode = z.string().trim().regex(/^\d{5}$/, 'Enter the 5-digit postcode.');
export const zState = z.enum(MALAYSIAN_STATES, { error: 'Choose a state.' });
