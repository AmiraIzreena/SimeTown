import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { hashPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { parseConfig } from '@/server/config';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { clientIpFrom, createRouter } from '@/server/http/router';
import { MAX_PHOTO_BYTES } from '@/shared/photos';
import { T0, freshDb, makeHome, makeMerchant, makeResident, makeSponsorUser, makeWorld, sell, sellWithPoints, type World } from './helpers';

/** Regression tests for the security review: each block names the finding it guards against. */

let db: Db;
let w: World;
let handle: (req: Request) => Promise<Response>;
const ORIGIN = 'http://kita.test';

interface CallOptions {
  cookie?: string;
  body?: unknown;
  ip?: string;
  /** A raw streamed body with its content type, sent without a Content-Length (chunked). */
  stream?: { body: ReadableStream<Uint8Array>; type: string };
}

async function call(method: string, path: string, opts: CallOptions = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (method !== 'GET') headers.set('origin', ORIGIN);
  // Tests run with TRUST_PROXY=none, where the last X-Forwarded-For entry stands for the connection address.
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.stream) headers.set('content-type', opts.stream.type);
  const body = opts.stream?.body ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body, duplex: 'half' } as RequestInit));
  const payload = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { data?: any; error?: { code: string } }) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: payload?.data, error: payload?.error };
}

const cookieFor = async (actor: Actor) => `kita_session=${await createSession(db, actor.id, T0)}`;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());

const BASE_ENV = { APP_URL: 'https://kita.example', DATABASE_URL: 'postgres://u:p@db/kita', APP_ENV: 'production' };

describe('client address for rate limits (KITA-01)', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('trusts only the entries our own proxies added to X-Forwarded-For', () => {
    const forged = headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' });
    expect(clientIpFrom(forged, 'forwarded', 1)).toBe('203.0.113.9');
    expect(clientIpFrom(headers({ 'x-forwarded-for': '1.1.1.1, 198.51.100.7, 10.0.0.2' }), 'forwarded', 2)).toBe('198.51.100.7');
    expect(clientIpFrom(headers({ 'x-forwarded-for': '203.0.113.9' }), 'forwarded', 2)).toBe('unknown');
  });

  it('uses Cloudflare’s header, and ignores X-Forwarded-For, behind Cloudflare', () => {
    expect(clientIpFrom(headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' }), 'cloudflare', 1)).toBe('203.0.113.9');
  });

  it('refuses to start a hosted app without a trusted proxy setting', () => {
    expect(() => parseConfig({ ...BASE_ENV, TRUST_PROXY: 'none' })).toThrow(/TRUST_PROXY/);
    expect(() => parseConfig(BASE_ENV)).toThrow(/TRUST_PROXY/);
    expect(parseConfig({ ...BASE_ENV, TRUST_PROXY: 'cloudflare' }).TRUST_PROXY).toBe('cloudflare');
  });

  it('keeps each visitor’s registration limit separate, so one person cannot block everyone', async () => {
    const homeId = await makeHome(w);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const body = {
        email: `visitor${i}@kita.test`, password: 'long-enough-pass', fullName: `Visitor ${i}`, phone: '012-345 6789',
        townshipId: w.townshipId, homeId, occupancy: 'OWNER', acceptTerms: true,
      };
      statuses.push((await call('POST', '/auth/register', { body, ip: `203.0.113.${i + 1}` })).status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe('sign-in lockout (KITA-02)', () => {
  it('lets the owner sign in from their own address while someone else guesses from another', async () => {
    const guesses: number[] = [];
    for (let i = 0; i < 11; i++) {
      guesses.push((await call('POST', '/auth/login', { body: { email: 'visitor0@kita.test', password: `wrong-guess-${i}` }, ip: '198.51.100.66' })).status);
    }
    expect(guesses.at(-1)).toBe(429); // the guesser is slowed down
    const owner = await call('POST', '/auth/login', { body: { email: 'visitor0@kita.test', password: 'long-enough-pass' }, ip: '203.0.113.1' });
    expect(owner.status).toBe(200);
  });
});

describe('admin account powers (KITA-03, KITA-04, KITA-05)', () => {
  it('keeps sponsor logins with HQ: a township admin can neither create nor take one over', async () => {
    const sponsor = await makeSponsorUser(w);
    const admin = await cookieFor(w.admin);
    expect((await call('POST', `/admin/accounts/${sponsor.id}/invite`, { cookie: admin, body: {} })).status).toBe(403);
    const created = await call('POST', '/admin/accounts', {
      cookie: admin,
      body: { email: 'second-sponsor-login@kita.test', fullName: 'Second Login', role: 'SPONSOR', sponsorId: sponsor.sponsorId },
    });
    expect(created.status).toBe(403);
    const listed = await call('GET', '/admin/accounts', { cookie: admin });
    expect(listed.data.some((a: { role: string }) => a.role === 'SPONSOR')).toBe(false);
    // HQ still activates the login: it has no password yet, so the link goes out at once.
    const byHq = await call('POST', `/admin/accounts/${sponsor.id}/invite`, { cookie: await cookieFor(w.hq), body: {} });
    expect(byHq.data.inviteToken).toBeTruthy();
  });

  it('needs a second admin before anyone gets a new password link for an account in use, and tells the owner', async () => {
    const resident = await makeResident(w);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [resident.id, await hashPassword('residents-own-password')]);
    const asked = await call('POST', `/admin/accounts/${resident.id}/invite`, { cookie: await cookieFor(w.admin), body: {} });
    expect(asked.data).toMatchObject({ pending: true });
    expect(asked.data.inviteToken).toBeUndefined();

    const decide = (cookie: string) => call('POST', `/admin/account-requests/${asked.data.requestId}/decision`, { cookie, body: { approve: true } });
    expect((await decide(await cookieFor(w.admin))).status).toBe(403); // not their own request
    expect((await decide(await cookieFor((await makeWorld(db)).admin))).status).toBe(404); // another township's admin
    const approved = await decide(await cookieFor(w.admin2));
    expect(approved.data.inviteToken).toBeTruthy();
    const told = await one<{ priority: string }>(db, `SELECT priority FROM notifications WHERE user_id = $1 AND title LIKE 'A new set-password link%'`, [resident.id]);
    expect(told?.priority).toBe('URGENT');
  });

  it('needs a second admin for a new link to any admin account', async () => {
    const asked = await call('POST', `/admin/accounts/${w.admin.id}/invite`, { cookie: await cookieFor(w.hq), body: {} });
    expect(asked.data).toMatchObject({ pending: true });
  });

  it('stops one HQ admin from giving themselves a second admin login', async () => {
    const hq = await cookieFor(w.hq);
    const asked = await call('POST', '/admin/accounts', { cookie: hq, body: { email: 'second-hq@kita.test', fullName: 'Second Login', role: 'HQ_ADMIN' } });
    expect(asked.data).toMatchObject({ pending: true });
    const decide = (cookie: string) => call('POST', `/admin/account-requests/${asked.data.requestId}/decision`, { cookie, body: { approve: true } });
    expect((await decide(hq)).status).toBe(403);
    expect((await decide(await cookieFor(w.admin))).status).toBe(404); // only HQ decides on admin accounts
    expect(await one(db, 'SELECT 1 FROM users WHERE email = $1', ['second-hq@kita.test'])).toBeUndefined();

    const approved = await decide(await cookieFor((await makeWorld(db)).hq));
    expect(approved.data.inviteToken).toBeTruthy();
    expect(await one(db, `SELECT 1 FROM users WHERE email = $1 AND role = 'HQ_ADMIN'`, ['second-hq@kita.test'])).toBeDefined();
  });
});

describe('request size (KITA-06)', () => {
  /** A body produced on demand, so the test can see how much of it the server actually read. */
  function endless(first: string, filler = 'x', chunk = 16 * 1024) {
    const enc = new TextEncoder();
    const state = { pulled: 0 };
    let sentFirst = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const bytes = enc.encode(sentFirst ? filler.repeat(chunk) : first);
        sentFirst = true;
        state.pulled += bytes.byteLength;
        controller.enqueue(bytes);
        if (state.pulled > 20_000_000) controller.close(); // a safety stop for the test itself
      },
    });
    return { body, state };
  }

  it('stops reading a JSON body as soon as it passes the limit, even without a Content-Length', async () => {
    const { body, state } = endless('{"email":"a@b.c","password":"');
    const res = await call('POST', '/auth/login', { stream: { body, type: 'application/json' }, ip: '192.0.2.10' });
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(200_000);
  });

  it('stops reading an oversized upload instead of holding it in memory', async () => {
    const resident = await makeResident(w);
    const head = '--B\r\nContent-Disposition: form-data; name="photo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n';
    const { body, state } = endless(head);
    const res = await call('POST', '/reports', { cookie: await cookieFor(resident), stream: { body, type: 'multipart/form-data; boundary=B' } });
    expect(res.status).toBe(413);
    // The form may hold one 10 MB photo plus its fields; reading stops just past that, far before the 20 MB the stream offers.
    expect(state.pulled).toBeGreaterThan(MAX_PHOTO_BYTES);
    expect(state.pulled).toBeLessThan(MAX_PHOTO_BYTES + 1_000_000);
  });

  it('refuses an unverified resident before reading their upload at all', async () => {
    const pending = await makeResident(w, { status: 'PENDING' });
    const { body, state } = endless('--B\r\n');
    const res = await call('POST', '/reports', { cookie: await cookieFor(pending), stream: { body, type: 'multipart/form-data; boundary=B' } });
    expect(res.status).toBe(403);
    expect(state.pulled).toBeLessThan(100_000); // at most what the runtime buffers ahead
  });
});

describe('township boundaries in finance (KITA-07)', () => {
  it('lets a township admin settle only their own township’s shops', async () => {
    const other = await makeWorld(db);
    const shop = await makeMerchant(other, 50_000);
    const resident = await makeResident(other);
    await sell(other, shop, resident, 100_000); // earns 1,000 points
    await sellWithPoints(other, shop, resident, 1_000, 300); // the shop is now owed RM3
    const settledIn = async () =>
      (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM settlements st JOIN merchants m ON m.id = st.merchant_id WHERE m.township_id = $1', [other.townshipId]))!.n;

    expect((await call('POST', '/finance/settlements/run', { cookie: await cookieFor(w.admin), body: {} })).status).toBe(200);
    expect(await settledIn()).toBe(0);
    expect((await call('POST', '/finance/settlements/run', { cookie: await cookieFor(other.admin), body: {} })).data).toMatchObject({ merchants: 1, totalSen: 300 });
    expect(await settledIn()).toBe(1);
  });
});

describe('bad input answers with 4xx, never 500 (KITA-09)', () => {
  const cursor = (parts: unknown) => Buffer.from(JSON.stringify(parts)).toString('base64url');

  it('rejects forged page cursors', async () => {
    const staff = await cookieFor(w.staff);
    const admin = await cookieFor(w.admin);
    expect((await call('GET', `/reports?cursor=${cursor(['not-a-date', '00000000-0000-0000-0000-000000000000'])}`, { cookie: staff })).status).toBe(400);
    expect((await call('GET', `/reports?cursor=${cursor(['', '00000000-0000-0000-0000-000000000000'])}`, { cookie: staff })).status).toBe(400);
    expect((await call('GET', `/admin/audit?cursor=${cursor(['', 'abc'])}`, { cookie: admin })).status).toBe(400);
  });

  it('treats broken %-encoding in a path as not found', async () => {
    expect((await call('GET', '/reports/%E0%A4%A', { cookie: await cookieFor(w.staff) })).status).toBe(404);
  });

  it('checks settings that depend on each other before saving them', async () => {
    const hq = await cookieFor(w.hq);
    const danger = await call('PATCH', '/admin/settings', { cookie: hq, body: { flood_danger_pct: 50 } });
    expect([danger.status, danger.error?.code]).toEqual([422, 'SETTINGS_INVALID']);
    const expiry = await call('PATCH', '/admin/settings', { cookie: hq, body: { expiry_max_months: 6 } });
    expect([expiry.status, expiry.error?.code]).toEqual([422, 'SETTINGS_INVALID']);
  });
});
