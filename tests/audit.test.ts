import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import type { Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { T0, at, freshDb, makeWorld, type World } from './helpers';

let db: Db;
let w: World;
let other: World;
let handle: (req: Request) => Promise<Response>;

interface Entry { id: number; action: string; area: string | null; actor_name: string | null }
interface AuditPage { items: Entry[]; nextCursor: string | null; counts?: Record<string, number> }

async function get(actor: Actor, query = '') {
  const cookie = `kita_session=${await createSession(db, actor.id, T0)}`;
  const res = await handle(new Request(`http://kita.test/api/v1/admin/audit${query}`, { headers: { cookie } }));
  const body = (await res.json()) as { data?: AuditPage };
  return { status: res.status, data: body.data! };
}

async function entry(actorId: string | null, action: string, entityType: string, detail: Record<string, unknown>, createdAt: Date) {
  await db.query('INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail, created_at) VALUES ($1, $2, $3, NULL, $4::jsonb, $5)', [
    actorId, action, entityType, JSON.stringify(detail), createdAt,
  ]);
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  other = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
  await entry(w.admin.id, 'CAMPAIGN_FUNDED', 'campaign', { bankRef: 'AUDIT-REF-100%_A' }, at(-0.5));
  await entry(w.admin.id, 'DEPOSIT_RECORDED', 'merchant', { amountSen: 5000 }, at(-3));
  await entry(w.staff.id, 'MERCHANT_APPROVED', 'merchant', {}, at(-10));
  await entry(w.admin.id, 'SETTINGS_CHANGED', 'program_settings', {}, at(-40));
  await entry(w.staff.id, 'REPORT_STATUS', 'report', { from: 'NEW', to: 'IN_PROGRESS' }, at(-1.5));
  await entry(other.admin.id, 'CAMPAIGN_CREATED', 'campaign', { name: 'Other township' }, at(-1));
  await entry(null, 'COLLECTION_MISSED', 'recycling_collection', {}, at(-2));
});
afterAll(() => db.close());

describe('audit trail search and filters', () => {
  it('keeps a township admin to their own township, with counts that add up', async () => {
    const { status, data } = await get(w.admin);
    expect(status).toBe(200);
    expect(data.items.map((e) => e.action)).not.toContain('CAMPAIGN_CREATED');
    expect(data.items.map((e) => e.action)).not.toContain('COLLECTION_MISSED');
    const { all, ...areas } = data.counts!;
    expect(all).toBe(data.items.length);
    expect(Object.values(areas).reduce((a, b) => a + b, 0)).toBe(all);
  });

  it('puts money first, so a shop deposit is money and a shop approval is people', async () => {
    const money = (await get(w.admin, '?area=MONEY')).data.items.map((e) => e.action);
    expect(money).toEqual(expect.arrayContaining(['CAMPAIGN_FUNDED', 'DEPOSIT_RECORDED']));
    expect(money).not.toContain('MERCHANT_APPROVED');
    expect((await get(w.admin, '?area=PEOPLE')).data.items.map((e) => e.action)).toEqual(['MERCHANT_APPROVED']);
    expect((await get(w.admin, '?area=RULES')).data.items.map((e) => e.action)).toEqual(['SETTINGS_CHANGED']);
  });

  it('counts every area with the other filters applied, whichever area is picked', async () => {
    const page = (await get(w.admin, '?area=PEOPLE&period=7d')).data;
    expect(page.counts).toMatchObject({ all: 3, MONEY: 2, REPORTS: 1, PEOPLE: 0, RULES: 0 });
    expect(page.items).toHaveLength(0);
  });

  it('searches names, actions and details, treating % and _ as plain text', async () => {
    expect((await get(w.admin, `?q=${encodeURIComponent('100%_A')}`)).data.items.map((e) => e.action)).toEqual(['CAMPAIGN_FUNDED']);
    expect((await get(w.admin, `?q=${encodeURIComponent('100%_B')}`)).data.items).toHaveLength(0);
    expect((await get(w.admin, '?q=deposit%20recorded')).data.items.map((e) => e.action)).toEqual(['DEPOSIT_RECORDED']);
    expect((await get(w.admin, `?q=${encodeURIComponent(w.staff.fullName)}`)).data.items.map((e) => e.action).sort()).toEqual(['MERCHANT_APPROVED', 'REPORT_STATUS']);
  });

  it('filters by who and by time, including the app itself for HQ', async () => {
    expect((await get(w.admin, '?actor=TOWNSHIP_STAFF')).data.items.map((e) => e.action).sort()).toEqual(['MERCHANT_APPROVED', 'REPORT_STATUS']);
    expect((await get(w.admin, '?period=24h')).data.items.map((e) => e.action)).toEqual(['CAMPAIGN_FUNDED']);
    const system = (await get(w.hq, '?actor=SYSTEM')).data.items;
    expect(system.map((e) => e.action)).toContain('COLLECTION_MISSED');
    expect(system.every((e) => e.actor_name === null)).toBe(true);
  });

  it('pages through every entry exactly once, newest or oldest first', async () => {
    for (const sort of ['NEWEST', 'OLDEST']) {
      const ids: number[] = [];
      let cursor: string | null = null;
      do {
        const page: AuditPage = (await get(w.admin, `?limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`)).data;
        if (cursor) expect(page.counts).toBeUndefined();
        ids.push(...page.items.map((e) => Number(e.id)));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(5);
      expect(ids).toEqual([...ids].sort((a, b) => (sort === 'OLDEST' ? a - b : b - a)));
    }
  });

  it('refuses unknown filter values and over-long searches', async () => {
    for (const query of ['?area=EVERYTHING', '?actor=ROBOT', '?period=1y', '?sort=RANDOM', `?q=${'x'.repeat(61)}`]) {
      expect((await get(w.admin, query)).status).toBe(400);
    }
    expect((await get(w.staff)).status).toBe(403);
  });
});
