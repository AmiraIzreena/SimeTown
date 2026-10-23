import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { actorFromToken, createSession, markActive, sessionCookie, sessionState } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { idleMinutesFor } from '@/shared/session';
import { T0, freshDb, makeGateWorker, makeResident, makeWorld, type World } from './helpers';

/** Sign-in timeouts (decided 2026-10-23): 15 min idle for staff, 30 for others, none for guards on shift, 12 h at most. */

let db: Db;
let w: World;
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const hours = (n: number) => minutes(n * 60);

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
});
afterAll(() => db.close());

describe('Sign-in timeouts', () => {
  it('gives each role its inactivity limit', () => {
    expect(idleMinutesFor('RESIDENT')).toBe(30);
    expect(idleMinutesFor('MERCHANT')).toBe(30);
    expect(idleMinutesFor('COURIER')).toBe(30);
    expect(idleMinutesFor('TOWNSHIP_STAFF')).toBe(15);
    expect(idleMinutesFor('TOWNSHIP_ADMIN')).toBe(15);
    expect(idleMinutesFor('HQ_ADMIN')).toBe(15);
    expect(idleMinutesFor('GUARD')).toBeNull();
    expect(idleMinutesFor('GUARDHOUSE')).toBeNull();
  });

  it('signs a resident out after 30 minutes without activity, however often their screen refreshes', async () => {
    const resident = await makeResident(w);
    const token = await createSession(db, resident.id, T0);
    // A screen refreshing itself every few minutes is not the person acting.
    for (const m of [5, 12, 19, 26, 29]) expect(await actorFromToken(db, token, minutes(m))).not.toBeNull();
    expect(await actorFromToken(db, token, minutes(31))).toBeNull();
    // The sign-in is gone, not just refused.
    expect(await actorFromToken(db, token, minutes(32))).toBeNull();
    expect(await one(db, 'SELECT 1 FROM sessions WHERE user_id = $1', [resident.id])).toBeFalsy();
  });

  it('starts the clock again when the person acts', async () => {
    const resident = await makeResident(w);
    const token = await createSession(db, resident.id, T0);
    const state = await markActive(db, token, minutes(25));
    expect(state).toMatchObject({ idleMinutes: 30 });
    expect(await actorFromToken(db, token, minutes(54))).not.toBeNull();
    expect(await actorFromToken(db, token, minutes(56))).toBeNull();
  });

  it('signs staff out after 15 minutes', async () => {
    const token = await createSession(db, w.staff.id, T0);
    expect(await actorFromToken(db, token, minutes(14))).not.toBeNull();
    expect(await actorFromToken(db, token, minutes(16))).toBeNull();
  });

  it('keeps a guard signed in through a quiet shift, but not past 12 hours', async () => {
    for (const role of ['GUARD', 'GUARDHOUSE'] as const) {
      const worker = await makeGateWorker(w, role);
      const token = await createSession(db, worker.id, T0);
      expect(await actorFromToken(db, token, hours(6))).not.toBeNull();
      expect(await actorFromToken(db, token, hours(11.9))).not.toBeNull();
      expect(await actorFromToken(db, token, hours(12.1))).toBeNull();
    }
  });

  it('never lets a sign-in last more than 12 hours, whatever the setting', async () => {
    const resident = await makeResident(w);
    const token = await createSession(db, resident.id, T0, 168);
    const state = await sessionState(db, token, T0);
    expect(state!.expiresAt.getTime() - T0.getTime()).toBe(12 * 3_600_000);
    expect(sessionCookie('x')).toContain(`Max-Age=${12 * 3600}`);
  });

  it('tells the browser the limits, and records activity, through the API', async () => {
    const clock = { now: T0 };
    const handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => clock.now }).handle;
    const call = async (as: Actor, token: string, method: string, path: string) => {
      const headers = new Headers({ origin: 'http://kita.test', cookie: `kita_session=${token}` });
      if (method === 'POST') headers.set('content-type', 'application/json');
      const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method, headers, body: method === 'POST' ? '{}' : undefined }));
      return { status: res.status, data: ((await res.json()) as { data?: { idleMinutes: number | null; lastActiveAt: string } }).data };
    };
    const resident = await makeResident(w);
    const token = await createSession(db, resident.id, T0);
    expect((await call(resident, token, 'GET', '/me/session')).data).toMatchObject({ idleMinutes: 30, lastActiveAt: T0.toISOString() });
    clock.now = minutes(20);
    const active = await call(resident, token, 'POST', '/me/activity');
    expect(active.data?.lastActiveAt).toBe(minutes(20).toISOString());
    clock.now = minutes(45);
    expect((await call(resident, token, 'GET', '/me/session')).status).toBe(200);
    clock.now = minutes(51);
    expect((await call(resident, token, 'GET', '/me/session')).status).toBe(401);
  });
});
