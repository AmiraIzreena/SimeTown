import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { formatAddress, formatPhone, normalizePhone } from '@/shared/domain';
import { LEGAL } from '@/shared/legal';
import { T0, freshDb, makeHome, makeMerchant, makeResident, makeWorld, type World } from './helpers';

/** Required details (name, email, phone, address, consent), the address picker and the completion prompts. */

let db: Db;
let w: World;
let handle: (req: Request) => Promise<Response>;
const ORIGIN = 'http://kita.test';

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (method !== 'GET') headers.set('origin', ORIGIN);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const payload = (await res.json()) as { data?: any; error?: { code: string; details?: { fields?: Record<string, string> } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: payload.data, error: payload.error };
}
const cookieFor = async (actor: Actor) => `kita_session=${await createSession(db, actor.id, T0)}`;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => T0 }).handle;
});
afterAll(() => db.close());

describe('phone numbers and addresses', () => {
  it('stores phone numbers in one international form and shows them the Malaysian way', () => {
    expect(normalizePhone('012-345 6789')).toBe('+60123456789');
    expect(normalizePhone('+60 11-2345 6789')).toBe('+601123456789');
    expect(normalizePhone('60123456789')).toBe('+60123456789');
    expect(normalizePhone('03-2345 6789')).toBe('+60323456789');
    expect(normalizePhone('+65 6123 4567')).toBe('+6561234567');
    for (const bad of ['12345', '012-34', 'call me', '+60 99']) expect(normalizePhone(bad)).toBeNull();
    expect(formatPhone('+60123456789')).toBe('+60 12-345 6789');
  });

  it('writes landed and high-rise addresses as Malaysian post is addressed', () => {
    const base = { street: 'Jalan Metafasa U16/171', precinct: 'Elmina Valley 1', postcode: '40160', city: 'Shah Alam', state: 'Selangor' };
    expect(formatAddress({ ...base, property_type: 'LANDED', house_no: '12', building: null })).toBe('No. 12, Jalan Metafasa U16/171, Elmina Valley 1, 40160 Shah Alam, Selangor');
    expect(formatAddress({ ...base, property_type: 'HIGHRISE', house_no: 'A-03-07', building: 'Pangsapuri Harmoni Elmina, Block A' })).toBe(
      'A-03-07, Pangsapuri Harmoni Elmina, Block A, Jalan Metafasa U16/171, Elmina Valley 1, 40160 Shah Alam, Selangor',
    );
  });
});

describe('the address picker', () => {
  it('lists precincts and streets, then the homes on a street, without saying who lives there', async () => {
    const homeId = await makeHome(w, 'Jalan Picker 1', 'Precinct Picker');
    await makeHome(w, 'Jalan Picker 2', 'Precinct Picker');
    const options = await call('GET', `/townships/${w.townshipId}/addresses`);
    expect(options.data.precincts).toContainEqual({ precinct: 'Precinct Picker', streets: ['Jalan Picker 1', 'Jalan Picker 2'] });

    const homes = await call('GET', `/townships/${w.townshipId}/homes?street=${encodeURIComponent('Jalan Picker 1')}&precinct=${encodeURIComponent('Precinct Picker')}`);
    expect(homes.data).toHaveLength(1);
    expect(homes.data[0]).toEqual({ id: homeId, label: expect.stringMatching(/^No\. \d+$/), address: expect.stringContaining('Jalan Picker 1, Precinct Picker, 41050 Klang, Selangor') });
    expect(Object.keys(homes.data[0])).toEqual(['id', 'label', 'address']);
  });
});

describe('registration needs every required detail', () => {
  const body = (overrides: Record<string, unknown>) => ({
    email: `new${Math.random().toString(36).slice(2, 8)}@kita.test`, password: 'long-enough-pass', fullName: 'New Resident', phone: '012-345 6789',
    townshipId: w.townshipId, occupancy: 'OWNER', acceptTerms: true, ...overrides,
  });

  it('refuses a registration without a phone number, a valid phone number or acceptance of the Terms', async () => {
    const homeId = await makeHome(w);
    const noPhone = await call('POST', '/auth/register', { body: { ...body({ homeId }), phone: undefined } });
    expect(noPhone.error?.details?.fields?.phone).toBeTruthy();
    const badPhone = await call('POST', '/auth/register', { body: body({ homeId, phone: '12345' }) });
    expect(badPhone.error?.details?.fields?.phone).toMatch(/valid phone/);
    const noConsent = await call('POST', '/auth/register', { body: body({ homeId, acceptTerms: false }) });
    expect(noConsent.error?.details?.fields?.acceptTerms).toMatch(/Terms/);
  });

  it('accepts only an address from this township’s property record', async () => {
    const elsewhere = await makeWorld(db);
    const res = await call('POST', '/auth/register', { body: body({ homeId: await makeHome(elsewhere) }) });
    expect([res.status, res.error?.code]).toEqual([422, 'ADDRESS_NOT_FOUND']);
  });

  it('records the phone in international form and the Terms version accepted', async () => {
    const res = await call('POST', '/auth/register', { body: body({ homeId: await makeHome(w), email: 'complete@kita.test' }) });
    expect(res.status).toBe(200);
    const saved = await one<{ phone: string; terms_version: string }>(db, 'SELECT phone, terms_version FROM users WHERE email = $1', ['complete@kita.test']);
    expect(saved).toEqual({ phone: '+60123456789', terms_version: LEGAL.version });
  });

  it('asks a shop for its business address, contact phone and consent', async () => {
    const res = await call('POST', '/merchants/apply', {
      body: { townshipId: w.townshipId, businessName: 'Kedai Baru', registrationNo: 'REG-PROFILE-1', category: 'Groceries', contactName: 'Encik Ali', email: 'shop-profile@kita.test', password: 'long-enough-pass' },
    });
    expect(Object.keys(res.error?.details?.fields ?? {})).toEqual(expect.arrayContaining(['addressLine', 'postcode', 'city', 'state', 'phone', 'acceptTerms']));
  });
});

describe('asking for missing details', () => {
  it('tells staff what is missing, and clears it once they add a phone and accept the Terms', async () => {
    const staff = await cookieFor(w.staff);
    expect((await call('GET', '/me', { cookie: staff })).data.missing).toEqual(['phone', 'terms']);

    expect((await call('PATCH', '/me', { cookie: staff, body: { fullName: 'Staff Member' } })).status).toBe(400); // phone is required
    expect((await call('PATCH', '/me', { cookie: staff, body: { fullName: 'Staff Member', phone: '019-876 5432' } })).status).toBe(200);
    expect((await call('POST', '/me/terms', { cookie: staff, body: { version: 'an-old-version' } })).error?.code).toBe('TERMS_CHANGED');
    expect((await call('POST', '/me/terms', { cookie: staff, body: { version: LEGAL.version } })).status).toBe(200);

    const me = await call('GET', '/me', { cookie: staff });
    expect(me.data.missing).toEqual([]);
    expect(me.data.phone).toBe('+60198765432');
  });

  it('asks a resident whose home has no full address to choose it, and confirms the new home again', async () => {
    const legacy = await one<{ id: string }>(db, `INSERT INTO homes (township_id, unit_code, street) VALUES ($1, 'OLD-1', 'Jalan Lama') RETURNING id`, [w.townshipId]);
    const resident = await makeResident(w, { homeId: legacy!.id });
    const cookie = await cookieFor(resident);
    expect((await call('GET', '/me', { cookie })).data.missing).toContain('address');

    const moved = await call('POST', '/me/home', { cookie, body: { homeId: await makeHome(w), occupancy: 'OWNER' } });
    expect(moved.data).toEqual({ residencyStatus: 'PENDING' });
    const me = await call('GET', '/me', { cookie });
    expect(me.data.missing).not.toContain('address');
    expect(me.data.home.address).toMatch(/^No\. \d+, Jalan Satu, Precinct 1, 41050 Klang, Selangor$/);
    expect(me.data.residencyStatus).toBe('PENDING');
  });

  it('asks a shop for its business address until it is given', async () => {
    const shop = await makeMerchant(w);
    const cookie = await cookieFor(shop);
    expect((await call('GET', '/me', { cookie })).data.missing).toContain('shopAddress');
    const saved = await call('PATCH', '/merchant/profile', { cookie, body: { addressLine: 'Lot G-09, Jalan Satu', postcode: '41050', city: 'Klang', state: 'Selangor' } });
    expect(saved.status).toBe(200);
    expect((await call('GET', '/me', { cookie })).data.missing).not.toContain('shopAddress');
    expect((await call('PATCH', '/merchant/profile', { cookie, body: { addressLine: 'Lot G-09, Jalan Satu', postcode: '4105', city: 'Klang', state: 'Atlantis' } })).status).toBe(400);
  });
});
