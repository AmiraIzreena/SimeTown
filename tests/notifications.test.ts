import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/server/db/client';
import { listNotifications, markAllRead, notify, updateNotification } from '@/server/modules/notifications';
import { notificationCategoriesFor, notificationCategory, notificationDestination } from '@/shared/notifications';
import { createReport } from '@/server/modules/reports/service';
import { freshDb, makeResident, makeWorld, T0 } from './helpers';

let db: Db;
let user: string;
let other: string;
beforeAll(async () => {
  db = await freshDb();
  const world = await makeWorld(db);
  user = (await makeResident(world)).id;
  other = (await makeResident(world)).id;
});
afterAll(async () => { await db.close(); });

describe('notification center', () => {
  it('delivers an event once to each recipient, even with repeated recipients and retries', async () => {
    const event = { title: 'Ready', body: 'Collect your parcel', link: '/app/parcels', dedupeKey: 'parcel:one' };
    expect(await notify(db, [user, user, other], event)).toBe(2);
    expect(await notify(db, [user, other], event)).toBe(0);
    expect((await listNotifications(db, user)).items).toHaveLength(1);
    expect((await listNotifications(db, other)).items).toHaveLength(1);
  });
  it('scopes read and dismiss actions to the authenticated user', async () => {
    const item = (await listNotifications(db, user)).items[0]!;
    await expect(updateNotification(db, other, item.id, 'read', T0)).rejects.toMatchObject({ status: 404 });
    await expect(updateNotification(db, other, item.id, 'dismiss', T0)).rejects.toMatchObject({ status: 404 });
    await updateNotification(db, user, item.id, 'read', T0);
    expect((await listNotifications(db, user)).unread).toBe(0);
    expect((await listNotifications(db, other)).unread).toBe(1);
    expect((await listNotifications(db, user, { unread: true })).items).toHaveLength(0);
    await updateNotification(db, user, item.id, 'dismiss', T0);
    expect((await listNotifications(db, user)).items).toHaveLength(0);
    expect(await notify(db, [user], { title: 'Ready', body: 'Retry', dedupeKey: 'parcel:one' })).toBe(0);
  });
  it('paginates without overlap and filters categories while retaining the global unread count', async () => {
    for (let i = 0; i < 5; i++) await notify(db, [user], { title: `Event ${i}`, body: 'Update', link: i % 2 ? '/app/wallet' : '/app/parcels' });
    const first = await listNotifications(db, user, { limit: 2 });
    const second = await listNotifications(db, user, { limit: 2, cursor: first.nextCursor! });
    expect(first.items.map((n) => n.id).some((id) => second.items.some((n) => n.id === id))).toBe(false);
    expect(first.unread).toBe(5);
    const rewards = await listNotifications(db, user, { category: 'REWARDS' });
    expect(rewards.items).toHaveLength(2);
    expect(rewards.unread).toBe(5);
    // The category chips count each category under the other filters, whichever category is chosen.
    expect(rewards.categories).toMatchObject({ REWARDS: 2, PARCELS: 3 });
    // Search covers the title and text; % is a literal character, not a wildcard.
    expect((await listNotifications(db, user, { q: 'Event 3' })).items.map((n) => n.title)).toEqual(['Event 3']);
    expect((await listNotifications(db, user, { q: 'Event 3' })).categories).toEqual({ REWARDS: 1 });
    expect((await listNotifications(db, user, { q: '%' })).items).toHaveLength(0);
    await markAllRead(db, user, T0);
    expect((await listNotifications(db, user)).unread).toBe(0);
    expect((await listNotifications(db, other)).unread).toBe(1);
    await expect(listNotifications(db, user, { cursor: 'bad-cursor' })).rejects.toMatchObject({ status: 400 });
  });
  it('sorts newest first by number, not as text, when ids change length', async () => {
    // Push the id sequence past a power of ten so "9…" and "1…" ids are both in the list.
    await db.query(`SELECT setval(pg_get_serial_sequence('notifications', 'id'), 9_998)`);
    for (let i = 0; i < 3; i++) await notify(db, [other], { title: `Order ${i}`, body: 'Update' });
    const items = (await listNotifications(db, other)).items.slice(0, 3);
    expect(items.map((n) => n.title)).toEqual(['Order 2', 'Order 1', 'Order 0']);
    expect(items.map((n) => n.id)).toEqual(['10001', '10000', '9999']);
  });
  it('links Komuniti notifications and files them under Community', () => {
    expect(notificationDestination('/app/komuniti?tab=share')).toBe('/app/komuniti?tab=share');
    expect(notificationDestination('/console/komuniti')).toBe('/console/komuniti');
    expect(notificationCategory('/app/komuniti')).toBe('COMMUNITY');
    // Kitar and Gerak have their own categories; a report made from either page stays with the other reports.
    expect(notificationCategory('/app/kitar')).toBe('RECYCLING');
    expect(notificationCategory('/app/gerak')).toBe('GERAK');
    expect(notificationCategory('/app/lapor?tab=gerak#INC-000001')).toBe('REPORTS');
    expect(notificationDestination('/app/gerak')).toBe('/app/gerak');
  });
  it('opens a home service report from a staff notification and files it under Home services', () => {
    expect(notificationDestination('/console/home-services?report=abc')).toBe('/console/home-services?report=abc');
    expect(notificationCategory('/console/home-services?report=abc')).toBe('SERVICES');
  });
  it('offers business accounts only the categories they can receive', () => {
    expect(notificationCategoriesFor('MERCHANT', { retail: false, services: true })).toEqual(['SERVICES', 'ACCOUNT']);
    expect(notificationCategoriesFor('MERCHANT', { retail: true, services: true })).toEqual(['SERVICES', 'REWARDS', 'ACCOUNT']);
    expect(notificationCategoriesFor('HQ_ADMIN')).toContain('PARCELS');
  });
  it('rejects unsafe and unavailable destinations', () => {
    expect(notificationDestination('https://example.com')).toBeNull();
    expect(notificationDestination('//example.com')).toBeNull();
    expect(notificationDestination('/app/missing')).toBeNull();
    expect(notificationDestination('/app/home-services?booking=123')).toBe('/app/home-services?booking=123');
  });
  it('generates a persistent notification from an actual report submission', async () => {
    const world = await makeWorld(db);
    const resident = await makeResident(world);
    const report = await createReport(db, resident, { description: 'Broken street light outside my house', locationText: 'Main road', category: 'LIGHTING' }, T0);
    const inbox = await listNotifications(db, resident.id);
    expect(inbox.items.some((n) => n.category === 'REPORTS' && n.link?.includes(report.id))).toBe(true);
  });
  it('tells township staff and admins about every new report, and HQ only about urgent ones', async () => {
    const world = await makeWorld(db);
    const resident = await makeResident(world);
    const titles = async (userId: string) => (await listNotifications(db, userId, { limit: 50 })).items.map((n) => n.title);
    await createReport(db, resident, { description: 'Someone is using the parking reserved for me', locationText: 'Block A car park', category: 'OTHER' }, T0);
    expect(await titles(world.staff.id)).toContain('New Lapor report');
    expect(await titles(world.admin.id)).toContain('New Lapor report');
    expect(await titles(world.hq.id)).not.toContain('New Lapor report');

    const urgent = await createReport(db, resident, { description: 'Pokok tumbang across the road, live wire on the ground', locationText: 'Jalan Satu' }, T0);
    expect(urgent.urgency).toBe('URGENT');
    expect(await titles(world.hq.id)).toContain('Urgent safety report');
    expect(await titles(world.staff.id)).toContain('Urgent safety report');
  });
});
