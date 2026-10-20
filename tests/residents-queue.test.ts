import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { T0, at, freshDb, makeHome, makeResident, makeWorld, type World } from './helpers';

let db: Db;
let w: World;
let other: World;
let handle: (req: Request) => Promise<Response>;

interface Row { id: string; full_name: string; unit_code: string; decided_by: string | null; reason: string | null }
interface Page { items: Row[]; nextCursor: string | null }

async function call(actor: Actor, method: string, path: string, body?: unknown) {
  const headers = new Headers({ cookie: `kita_session=${await createSession(db, actor.id, T0)}` });
  if (method !== 'GET') headers.set('origin', 'http://kita.test');
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const json = (await res.json()) as { data?: unknown };
  return { status: res.status, data: json.data as never };
}

/** A waiting resident in a given place, registered `days` before T0. */
async function waiting(name: string, precinct: string, days: number) {
  const r = await makeResident(w, { homeId: await makeHome(w, 'Jalan Melur', precinct), status: 'PENDING' });
  await db.query('UPDATE users SET full_name = $2, created_at = $3 WHERE id = $1', [r.id, name, at(-days)]);
  return r;
}

let aisyah: Actor, ben: Actor, chong: Actor;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  other = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
  ben = await waiting('Ben Tan', 'Precinct Melur', 2);
  aisyah = await waiting('Aisyah Rahman', 'Elmina Gardens', 9);
  chong = await waiting('Chong 100%_Wei', 'Precinct Melur', 5);
  await makeHome(w, 'Jalan Kosong', 'Empty Precinct'); // a place in the property record where nobody lives yet
  await makeHome(other, 'Jalan Lain', 'Other Township Precinct');
});
afterAll(() => db.close());

describe('confirm homes queue', () => {
  it('serves the longest waiting first, and pages through everyone once', async () => {
    const first = (await call(w.staff, 'GET', '/admin/residents?status=PENDING&limit=2')).data as Page;
    expect(first.items.map((r) => r.full_name)).toEqual(['Aisyah Rahman', 'Chong 100%_Wei']);
    const second = (await call(w.staff, 'GET', `/admin/residents?status=PENDING&limit=2&cursor=${first.nextCursor}`)).data as Page;
    expect(second.items.map((r) => r.full_name)).toEqual(['Ben Tan']);
    expect(second.nextCursor).toBeNull();
  });

  it('searches names and property records, treating % and _ as plain text, and filters by place', async () => {
    const find = async (query: string) => ((await call(w.staff, 'GET', `/admin/residents?status=PENDING&${query}`)).data as Page).items.map((r) => r.full_name);
    expect(await find('q=aisyah')).toEqual(['Aisyah Rahman']);
    expect(await find(`q=${encodeURIComponent('100%_W')}`)).toEqual(['Chong 100%_Wei']);
    expect(await find(`q=${encodeURIComponent('100%_X')}`)).toEqual([]);
    expect(await find(`q=U-&precinct=${encodeURIComponent('Precinct Melur')}`)).toEqual(['Chong 100%_Wei', 'Ben Tan']);
    expect(await find(`precinct=${encodeURIComponent('Empty Precinct')}`)).toEqual([]);
  });

  it('lists every place in the township, including places where nobody lives, with counts', async () => {
    const { places } = (await call(w.staff, 'GET', '/admin/residents/places')).data as { places: { name: string; pending: number }[] };
    const byName = Object.fromEntries(places.map((p) => [p.name, p.pending]));
    expect(byName).toMatchObject({ 'Precinct Melur': 2, 'Elmina Gardens': 1, 'Empty Precinct': 0 });
    expect(byName).not.toHaveProperty('Other Township Precinct');
  });

  it('sends the rejection reason to the resident, keeps it with the audit entry, and shows it in the Rejected list', async () => {
    expect((await call(w.staff, 'POST', `/admin/residents/${chong.id}/verify`, { approve: false, reason: 'The property record lists a different owner' })).status).toBe(200);
    const note = await one<{ body: string }>(db, 'SELECT body FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [chong.id]);
    expect(note!.body).toBe('Reason: The property record lists a different owner. Please contact the township office.');
    const rejected = (await call(w.staff, 'GET', '/admin/residents?status=REJECTED')).data as Page;
    expect(rejected.items.find((r) => r.id === chong.id)).toMatchObject({ reason: 'The property record lists a different owner', decided_by: w.staff.fullName });
  });

  it('ignores a reason on a confirmation, and lists the latest decision first', async () => {
    expect((await call(w.staff, 'POST', `/admin/residents/${aisyah.id}/verify`, { approve: true, reason: 'not used' })).status).toBe(200);
    const audit = await one<{ detail: Record<string, unknown> }>(db, `SELECT detail FROM audit_log WHERE entity_id = $1 AND action = 'RESIDENT_VERIFIED'`, [aisyah.id]);
    expect(audit!.detail).toEqual({});
    await db.query('UPDATE users SET verified_at = $2 WHERE id = $1', [aisyah.id, at(1)]);
    const confirmed = (await call(w.staff, 'GET', '/admin/residents?status=VERIFIED')).data as Page;
    expect(confirmed.items[0]!.id).toBe(aisyah.id);
  });

  it('refuses over-long reasons and searches, and keeps other townships out', async () => {
    expect((await call(w.staff, 'POST', `/admin/residents/${ben.id}/verify`, { approve: false, reason: 'x'.repeat(301) })).status).toBe(400);
    expect((await call(w.staff, 'GET', `/admin/residents?q=${'x'.repeat(61)}`)).status).toBe(400);
    const theirs = (await call(other.staff, 'GET', '/admin/residents?status=PENDING')).data as Page;
    expect(theirs.items.map((r) => r.id)).not.toContain(ben.id);
    expect((await call(other.staff, 'POST', `/admin/residents/${ben.id}/verify`, { approve: false })).status).toBe(403);
  });
});
