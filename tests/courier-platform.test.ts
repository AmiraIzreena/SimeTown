import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, actorFromToken, COURIER_SESSION_HOURS, createSession, toActor } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { trackingFromScan } from '@/server/modules/carriers/barcode';
import { decideCompany, inviteRepresentative, onboardCompany, setCompanyStations, setSimulatedOutage } from '@/server/modules/carriers/companies';
import { applyDirectoryChange, checkClaims, completeCourierSso, startCourierSso } from '@/server/modules/carriers/federation';
import { verifyJwtSignature } from '@/server/modules/carriers/jwt';
import { homesForAddress, maskName, matchResident } from '@/server/modules/carriers/matching';
import { SIM_CLIENT_ID, simAuthorize, simJwks, simRedirectUri } from '@/server/modules/carriers/sim-idp';
import { inviteCourier, reconfirmCourier, recordCourierLogin, revalidateCouriers, setTeamMember } from '@/server/modules/carriers/team';
import { verifyShipment } from '@/server/modules/carriers/verification';
import { createStation, simulateClose } from '@/server/modules/lockers/admin';
import { applyAsCourier, createCompany } from '@/server/modules/lockers/couriers';
import { myLockerParcels, pickupAtStation, reportParcel } from '@/server/modules/lockers/collection';
import { DEVICE } from '@/server/modules/lockers/core';
import { deliverShipment, registerParcel, reserveAndOpen } from '@/server/modules/lockers/delivery';
import { decideException, requestException } from '@/server/modules/lockers/exceptions';
import { createUnlock, dispatch, handleAck, reconcile, replayCommand } from '@/server/modules/lockers/hardware';
import { hashPassword } from '@/server/auth/password';
import { T0, freshDb, makeHome, makeResident, makeWorld, type World } from './helpers';

/**
 * The courier platform: companies approved once, couriers managed by their
 * company or signed in through it, label scans checked with the (simulated)
 * company, households matched automatically, and the rules that keep a label
 * from ever opening a door by itself.
 */

let db: Db;
let w: World;
let stationA: { id: string; code: string };
let stationB: { id: string; code: string };
let jnt: string;
let njv: string;
let manager: Actor;
let faizal: Actor;
let hairul: Actor;
let aisyah: Actor;
let aisyahHome: string;
const MIN = 60_000;
const key = () => randomUUID();
const actorOf = async (id: string) => toActor((await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1`, [id]))!);
const parcelCount = async (tracking: string) => (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM locker_parcels WHERE tracking_no = $1', [tracking]))!.n;
const commandCount = async () => (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM locker_commands'))!.n;
const incidents = async (kind: string) => (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM incidents WHERE kind = $1', [kind]))!.n;

let serial = 0;
async function shipment(companyId: string, s: { name: string; address: string; phone?: string | null; carriedBy?: string | null; status?: string; eligible?: boolean; code?: string | null; dims?: [number, number, number] }) {
  const prefix = companyId === jnt ? 'JTSIM' : 'NVSIM';
  const tracking = `${prefix}${String(10_000_000 + ++serial)}`;
  await db.query(
    `INSERT INTO sim_shipments (company_id, tracking_no, status, locker_eligible, recipient_name, recipient_phone, address_line, postcode, simetown_code, length_mm, width_mm, height_mm, assigned_courier_ref, demo_case)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '41050', $8, $9, $10, $11, $12, 'test')`,
    [companyId, tracking, s.status ?? 'OUT_FOR_DELIVERY', s.eligible ?? true, s.name, s.phone ?? null, s.address, s.code ?? null, s.dims?.[0] ?? 200, s.dims?.[1] ?? 150, s.dims?.[2] ?? 50, s.carriedBy ?? null],
  );
  return tracking;
}

/** Deposits a verified shipment and shuts the door with the parcel inside. */
async function depositShipment(courier: Actor, tracking: string, at = T0) {
  const d = await deliverShipment(db, courier, { stationId: stationA.id, code: tracking, idempotencyKey: key() }, at);
  if (d.kind !== 'OPENING') throw new Error(`Not opening: ${d.kind}`);
  await simulateClose(db, courier, d.parcelId, true, at);
  return d.parcelId;
}

const addressOf = async (homeId: string) => {
  const h = (await one<{ house_no: string; street: string; precinct: string }>(db, 'SELECT house_no, street, precinct FROM homes WHERE id = $1', [homeId]))!;
  return `No. ${h.house_no}, ${h.street}, ${h.precinct}, 41050 Klang, Selangor`;
};

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  stationA = await createStation(db, w.admin, { name: 'Platform A', location: 'Gate', layout: { S: 4, M: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  stationB = await createStation(db, w.admin, { name: 'Platform B', location: 'Hall', layout: { S: 2 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  jnt = (await onboardCompany(db, w.admin, { name: 'J&T Express', code: 'JNT', authMethod: 'COMPANY_MANAGED', providerMode: 'SIMULATED', canConfirmAssignment: true, trackingPattern: 'JTSIM[0-9]{8}' }, T0)).id;
  njv = (await onboardCompany(db, w.admin, { name: 'Ninja Van', code: 'NJV', authMethod: 'COMPANY_MANAGED', providerMode: 'SIMULATED', trackingPattern: 'NVSIM[0-9]{8}' }, T0)).id;
  for (const id of [jnt, njv]) {
    await decideCompany(db, w.admin, id, { status: 'ACTIVE', verifiedNote: 'Registration and agreement checked' }, T0);
    await setCompanyStations(db, w.admin, id, [stationA.id], T0);
  }
  manager = await actorOf((await inviteRepresentative(db, w.admin, jnt, { fullName: 'Kavitha Raman', email: 'kavitha@jnt.test' }, T0)).id);
  faizal = await actorOf((await inviteCourier(db, manager, { fullName: 'Faizal Rahman', email: 'faizal@jnt.test', employeeRef: 'JT-1001' }, T0)).id);
  hairul = await actorOf((await inviteCourier(db, manager, { fullName: 'Hairul Azman', email: 'hairul@jnt.test', employeeRef: 'JT-1002' }, T0)).id);
  aisyahHome = await makeHome(w, 'Jalan Metafasa U16/171', 'Elmina Valley 1');
  aisyah = await makeResident(w, { homeId: aisyahHome });
  await db.query(`UPDATE users SET full_name = 'Aisyah Rahman', phone = '+60123000111' WHERE id = $1`, [aisyah.id]);
});
afterAll(() => db.close());

describe('Company-level authorisation', () => {
  it('lets a company-managed courier deliver with no township approval of the courier', async () => {
    const tracking = await shipment(jnt, { name: 'AISYAH BINTI RAHMAN', phone: '012-300 0111', address: await addressOf(aisyahHome), carriedBy: 'JT-1001' });
    const v = await verifyShipment(db, faizal, { stationId: stationA.id, code: tracking }, T0);
    expect(v).toMatchObject({ state: 'VERIFIED', assurance: 'HIGH', match: { method: 'PHONE_NAME_ADDRESS' } });
    expect(v.match!.masked!.name).not.toContain('AISYAH');
    expect(await one(db, `SELECT 1 FROM courier_station_access WHERE user_id = $1`, [faizal.id])).toBeUndefined();
  });

  it('refuses couriers of unapproved, suspended, revoked or expired companies, and stations not granted', async () => {
    const dhl = (await onboardCompany(db, w.admin, { name: 'DHL', code: 'DHL', authMethod: 'COMPANY_MANAGED', providerMode: 'NONE' }, T0)).id;
    await expect(inviteRepresentative(db, w.admin, dhl, { fullName: 'Not Yet', email: 'early@dhl.test' }, T0)).rejects.toMatchObject({ code: 'APPROVE_FIRST' });
    await expect(decideCompany(db, w.admin, dhl, { status: 'ACTIVE' }, T0)).rejects.toMatchObject({ code: 'VERIFY_FIRST' });
    // Station not granted to the company.
    await expect(verifyShipment(db, faizal, { stationId: stationB.id, code: 'JTSIM00000001' }, T0)).rejects.toMatchObject({ status: 403 });
    // Agreement ended.
    await decideCompany(db, w.admin, njv, { status: 'ACTIVE', agreementUntil: '2026-10-01' }, T0);
    const nv = await actorOf((await inviteRepresentative(db, w.admin, njv, { fullName: 'NV Manager', email: 'mgr@njv.test' }, T0)).id);
    const nurul = await actorOf((await inviteCourier(db, nv, { fullName: 'Nurul Ain', email: 'nurul@njv.test', employeeRef: 'NV-2001' }, T0)).id);
    await expect(verifyShipment(db, nurul, { stationId: stationA.id, code: 'NVSIM00000001' }, T0)).rejects.toMatchObject({ message: expect.stringContaining('agreement') });
    await decideCompany(db, w.admin, njv, { status: 'ACTIVE', agreementUntil: null }, T0);
    // An emergency suspension of the whole company signs its couriers out at once.
    const token = await createSession(db, nurul.id, T0, COURIER_SESSION_HOURS);
    await decideCompany(db, w.admin, njv, { status: 'SUSPENDED', reason: 'Investigation' }, T0);
    expect(await actorFromToken(db, token, T0)).toBeNull();
    await expect(verifyShipment(db, nurul, { stationId: stationA.id, code: 'NVSIM00000001' }, T0)).rejects.toMatchObject({ status: 403 });
    await decideCompany(db, w.admin, njv, { status: 'ACTIVE' }, T0);
    await decideCompany(db, w.admin, dhl, { status: 'REVOKED', reason: 'Never signed' }, T0);
    await expect(decideCompany(db, w.admin, dhl, { status: 'ACTIVE', verifiedNote: 'x' }, T0)).rejects.toMatchObject({ code: 'REVOKED' });
  });

  it('never lets someone sign up as a company-managed courier, and keeps managers away from doors', async () => {
    await expect(applyAsCourier(db, { townshipId: w.townshipId, companyId: jnt, fullName: 'Pretender', email: 'pretend@jnt.test', phone: '+60123456789', password: 'a-strong-password-1' }, T0))
      .rejects.toMatchObject({ code: 'ASK_YOUR_COMPANY' });
    await expect(verifyShipment(db, manager, { stationId: stationA.id, code: 'JTSIM00000001' }, T0)).rejects.toMatchObject({ status: 403 });
  });

  it('lets the company suspend a courier at once (their session ends and the attempt is an incident)', async () => {
    const temp = await actorOf((await inviteCourier(db, manager, { fullName: 'Temp Courier', email: 'temp@jnt.test', employeeRef: 'JT-1999' }, T0)).id);
    const token = await createSession(db, temp.id, T0, COURIER_SESSION_HOURS);
    await setTeamMember(db, manager, temp.id, { status: 'SUSPENDED', note: 'Left the route' }, T0);
    expect(await actorFromToken(db, token, T0)).toBeNull();
    await expect(verifyShipment(db, temp, { stationId: stationA.id, code: 'JTSIM00000002' }, T0)).rejects.toMatchObject({ message: 'Your company has suspended your locker access.' });
    expect(await incidents('SUSPENDED_COURIER')).toBe(1);
    expect(await one(db, `SELECT 1 FROM courier_scans WHERE courier_user_id = $1 AND outcome = 'COURIER_NOT_AUTHORISED'`, [temp.id])).toBeDefined();
    await setTeamMember(db, manager, temp.id, { status: 'REVOKED' }, T0);
    await expect(setTeamMember(db, manager, temp.id, { status: 'ACTIVE' }, T0)).rejects.toMatchObject({ code: 'REVOKED' });
  });

  it('expires courier sessions after a shift, and pauses couriers their company stops reconfirming', async () => {
    const token = await createSession(db, faizal.id, T0, COURIER_SESSION_HOURS);
    expect(await actorFromToken(db, token, new Date(T0.getTime() + 11 * 3_600_000))).not.toBeNull();
    expect(await actorFromToken(db, token, new Date(T0.getTime() + 13 * 3_600_000))).toBeNull();
    const stale = await actorOf((await inviteCourier(db, manager, { fullName: 'Stale Courier', email: 'stale@jnt.test', employeeRef: 'JT-1500' }, new Date(T0.getTime() - 100 * 86_400_000))).id);
    await revalidateCouriers(db, T0);
    expect((await one<{ status: string }>(db, 'SELECT status FROM courier_accounts WHERE user_id = $1', [stale.id]))!.status).toBe('SUSPENDED');
    await expect(reconfirmCourier(db, manager, stale.id, T0)).rejects.toMatchObject({ code: 'NOT_ACTIVE' });
    expect((await one<{ status: string }>(db, 'SELECT status FROM courier_accounts WHERE user_id = $1', [faizal.id]))!.status).toBe('ACTIVE');
  });

  it('flags a login used from many places at once', async () => {
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']) await recordCourierLogin(db, hairul.id, 'PASSWORD', ip, 'test', T0);
    expect(await incidents('SUSPICIOUS_LOGIN')).toBe(1);
  });
});

describe('Signing in through the courier company (OpenID Connect, simulated provider)', () => {
  let spx: string;
  const flow = async (employeeRef: string, password: string) => {
    const { url } = await startCourierSso(db, 'SPX', '/courier', T0);
    const u = new URL(url);
    const auth = await simAuthorize(db, 'SPX', {
      clientId: u.searchParams.get('client_id')!, redirectUri: u.searchParams.get('redirect_uri')!, state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!,
      codeChallenge: u.searchParams.get('code_challenge')!, codeChallengeMethod: u.searchParams.get('code_challenge_method')!, employeeRef, password,
    }, T0);
    const back = new URL(auth.redirect);
    return { state: back.searchParams.get('state')!, code: back.searchParams.get('code')! };
  };

  beforeAll(async () => {
    spx = (await onboardCompany(db, w.admin, { name: 'Shopee Express', code: 'SPX', authMethod: 'FEDERATED', providerMode: 'SIMULATED', idpMode: 'SIMULATED', trackingPattern: 'SPXSIM[0-9]{8}' }, T0)).id;
    await decideCompany(db, w.admin, spx, { status: 'ACTIVE', verifiedNote: 'Demo' }, T0);
    await setCompanyStations(db, w.admin, spx, [stationA.id], T0);
    const hash = await hashPassword('company-password-1');
    await db.query(`INSERT INTO sim_directory (company_id, employee_ref, full_name, email, password_hash, active) VALUES ($1, 'SPX-3001', 'Lim Wei Jie', 'weijie@spx.test', $2, true), ($1, 'SPX-3002', 'Rosli Osman', 'rosli@spx.test', $2, false)`, [spx, hash]);
  });

  it('creates the courier on first sign-in, for one shift, with no township approval', async () => {
    const back = await flow('SPX-3001', 'company-password-1');
    const signedIn = await completeCourierSso(db, { ...back, ip: '10.1.1.1', userAgent: 'test' }, T0);
    expect(signedIn.actor.role).toBe('COURIER');
    expect(signedIn.returnTo).toBe('/courier');
    expect(await one(db, `SELECT 1 FROM courier_accounts WHERE company_id = $1 AND employee_ref = 'SPX-3001' AND managed_by = 'FEDERATED' AND status = 'ACTIVE'`, [spx])).toBeDefined();
    expect(await actorFromToken(db, signedIn.token, new Date(T0.getTime() + 13 * 3_600_000))).toBeNull();
    // The state and the code each work once.
    await expect(completeCourierSso(db, { ...back, ip: '10.1.1.1', userAgent: 'test' }, T0)).rejects.toMatchObject({ status: 401 });
  });

  it('is refused by the company for a suspended employee, and checks every claim and the signature', async () => {
    await expect(flow('SPX-3002', 'company-password-1')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(flow('SPX-3001', 'wrong-password')).rejects.toMatchObject({ status: 401 });
    const base = { iss: 'https://idp.test', aud: 'simetown', sub: 'X1', iat: Math.floor(T0.getTime() / 1000), exp: Math.floor(T0.getTime() / 1000) + 300, nonce: 'n1' };
    const expected = { issuer: 'https://idp.test', clientId: 'simetown', nonce: 'n1', requireMfa: false };
    expect(() => checkClaims(base, expected, T0)).not.toThrow();
    expect(() => checkClaims({ ...base, iss: 'https://evil.test' }, expected, T0)).toThrow(/issuer/);
    expect(() => checkClaims({ ...base, aud: 'someone-else' }, expected, T0)).toThrow(/another application/);
    expect(() => checkClaims({ ...base, nonce: 'n2' }, expected, T0)).toThrow(/does not belong/);
    expect(() => checkClaims({ ...base, exp: base.iat - 600 }, expected, T0)).toThrow(/expired/);
    expect(() => checkClaims(base, { ...expected, requireMfa: true }, T0)).toThrow(/second sign-in step/);
    const keys = (await simJwks(db, 'SPX')).keys;
    const forged = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: keys[0]!.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(base)).toString('base64url')}.${Buffer.from('x').toString('base64url')}`;
    expect(() => verifyJwtSignature(forged, keys)).toThrow(/not valid/);
    expect(() => verifyJwtSignature(forged.replace(/^[^.]+/, Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')), keys)).toThrow(/RS256/);
    // A code exchanged with the wrong PKCE verifier is refused.
    const { url } = await startCourierSso(db, 'SPX', undefined, T0);
    const u = new URL(url);
    const verifier = 'x'.repeat(43);
    const auth = await simAuthorize(db, 'SPX', {
      clientId: SIM_CLIENT_ID, redirectUri: simRedirectUri(), state: u.searchParams.get('state')!, nonce: u.searchParams.get('nonce')!,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', employeeRef: 'SPX-3001', password: 'company-password-1',
    }, T0);
    const back = new URL(auth.redirect);
    await expect(completeCourierSso(db, { state: back.searchParams.get('state')!, code: back.searchParams.get('code')!, ip: '10.1.1.1', userAgent: null }, T0)).rejects.toMatchObject({ status: 401 });
  });

  it('applies the company’s own suspension message once, ending the session', async () => {
    const back = await flow('SPX-3001', 'company-password-1');
    const { token } = await completeCourierSso(db, { ...back, ip: '10.1.1.2', userAgent: 'test' }, T0);
    const company = { id: spx, name: 'Shopee Express' };
    expect(await applyDirectoryChange(db, company, { employeeRef: 'SPX-3001', active: false, eventId: 'evt-00000001' }, T0)).toMatchObject({ ok: true });
    expect(await actorFromToken(db, token, T0)).toBeNull();
    expect(await applyDirectoryChange(db, company, { employeeRef: 'SPX-3001', active: true, eventId: 'evt-00000001' }, T0)).toMatchObject({ duplicate: true });
    expect((await one<{ status: string }>(db, `SELECT status FROM courier_accounts WHERE company_id = $1 AND employee_ref = 'SPX-3001'`, [spx]))!.status).toBe('SUSPENDED');
    await applyDirectoryChange(db, company, { employeeRef: 'SPX-3001', active: true, eventId: 'evt-00000002' }, T0);
  });
});

describe('Shipment verification and resident matching', () => {
  it('reads tracking numbers from 1D and 2D codes, never the recipient', () => {
    expect(trackingFromScan(' jtsim12345678 ')).toBe('JTSIM12345678');
    expect(trackingFromScan('https://track.example/parcel?awb=NVSIM00001111')).toBe('NVSIM00001111');
    expect(trackingFromScan('SPXSIM00001234|AISYAH|0123456789')).toBe('SPXSIM00001234');
    expect(trackingFromScan('hello')).toBeNull();
    expect(maskName('Aisyah Rahman')).toBe('A••••h R••••n');
  });

  it('refuses unknown and fake shipments without contacting anyone or opening anything', async () => {
    const before = await commandCount();
    expect(await verifyShipment(db, faizal, { stationId: stationA.id, code: 'JTSIM99999999' }, T0)).toMatchObject({ state: 'NOT_FOUND', reason: null });
    expect(await verifyShipment(db, faizal, { stationId: stationA.id, code: 'JT-FAKE-0001' }, T0)).toMatchObject({ state: 'NOT_FOUND', reason: 'FORMAT' });
    await expect(deliverShipment(db, faizal, { stationId: stationA.id, code: 'JTSIM99999999', size: 'S', idempotencyKey: key() }, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(verifyShipment(db, faizal, { stationId: stationA.id, code: '??' }, T0)).rejects.toMatchObject({ status: 400 });
    expect(await commandCount()).toBe(before);
    expect(await parcelCount('JTSIM99999999')).toBe(0);
  });

  it('matches by delivery code, phone, or address and name, and never by a name alone', async () => {
    const address = await addressOf(aisyahHome);
    expect(await matchResident(db, w.townshipId, { name: 'Someone Else', phone: null, addressLine: 'Anywhere', postcode: null, simetownCode: aisyah.memberCode })).toMatchObject({ matched: true, method: 'MEMBER_CODE' });
    expect(await matchResident(db, w.townshipId, { name: 'Aisyah Rahman', phone: null, addressLine: address, postcode: null, simetownCode: null })).toMatchObject({ matched: true, method: 'ADDRESS_NAME' });
    expect(await matchResident(db, w.townshipId, { name: 'Aisyah Rahman', phone: null, addressLine: 'Somewhere not in the township', postcode: null, simetownCode: null })).toMatchObject({ matched: false, reason: 'NOT_REGISTERED' });
    expect(await matchResident(db, w.townshipId, { name: 'Kumar Selvam', phone: null, addressLine: address, postcode: null, simetownCode: null })).toMatchObject({ matched: false, reason: 'NAME_MISMATCH' });
    expect(await matchResident(db, w.townshipId, { name: 'Aisyah Rahman', phone: null, addressLine: address.replace('41050', '99999'), postcode: '99999', simetownCode: null })).toMatchObject({ matched: false, reason: 'OUTSIDE_TOWNSHIP' });
    // High-rise units are matched by block, floor and unit.
    const flat = (await one<{ id: string }>(db, `INSERT INTO homes (township_id, zone_id, unit_code, street, precinct, house_no, building, property_type, postcode) VALUES ($1, $2, 'HM-A-02-01', 'Jalan Casuarina', 'West', 'A-02-01', 'Pangsapuri Harmoni, Block A', 'HIGHRISE', '41050') RETURNING id`, [w.townshipId, w.zoneId]))!.id;
    expect((await homesForAddress(db, w.townshipId, 'Unit A-2-1, Pangsapuri Harmoni Blok A, Jln Casuarina, 41050 Klang', null)).homes.map((h) => h.id)).toEqual([flat]);
  });

  it('gives each refusal its own state: mismatch, unregistered, not eligible, held elsewhere, provider down', async () => {
    const address = await addressOf(aisyahHome);
    const emptyHome = await makeHome(w, 'Jalan Metafasa U16/171', 'Elmina Valley 1');
    const check = (code: string, courier = faizal) => verifyShipment(db, courier, { stationId: stationA.id, code }, T0);
    expect(await check(await shipment(jnt, { name: 'Kumar Selvam', address, carriedBy: 'JT-1001' }))).toMatchObject({ state: 'RECIPIENT_MISMATCH', reason: 'NAME_MISMATCH' });
    expect(await check(await shipment(jnt, { name: 'Farid Hakim', address: await addressOf(emptyHome), carriedBy: 'JT-1001' }))).toMatchObject({ state: 'RECIPIENT_MISMATCH', reason: 'NOT_REGISTERED' });
    expect(await check(await shipment(jnt, { name: 'Aisyah Rahman', address, carriedBy: 'JT-1001', eligible: false }))).toMatchObject({ state: 'NOT_ELIGIBLE', reason: 'NOT_LOCKER_ELIGIBLE' });
    expect(await check(await shipment(jnt, { name: 'Aisyah Rahman', address, carriedBy: 'JT-1001', status: 'CANCELLED' }))).toMatchObject({ state: 'NOT_ELIGIBLE', reason: 'CANCELLED' });
    expect(await check(await shipment(jnt, { name: 'Aisyah Rahman', address, carriedBy: 'JT-1001', dims: [900, 900, 900] }))).toMatchObject({ state: 'NOT_ELIGIBLE', reason: 'TOO_BIG' });
    // Ninja Van cannot say who carries a shipment: medium assurance, and a township that needs high assurance refuses it.
    const nv = await actorOf((await one<{ user_id: string }>(db, `SELECT user_id FROM courier_accounts WHERE employee_ref = 'NV-2001'`))!.user_id);
    const nvTracking = await shipment(njv, { name: 'Aisyah Rahman', address });
    expect(await check(nvTracking, nv)).toMatchObject({ state: 'VERIFIED', assurance: 'MEDIUM' });
    await decideCompany(db, w.admin, njv, { status: 'ACTIVE', minAssurance: 'HIGH' }, T0);
    expect(await check(nvTracking, nv)).toMatchObject({ state: 'NOT_ELIGIBLE', reason: 'ASSURANCE_TOO_LOW' });
    await decideCompany(db, w.admin, njv, { status: 'ACTIVE', minAssurance: 'MEDIUM' }, T0);
    // The provider is down: the resident's delivery code is the only fallback, recorded at low assurance.
    await setSimulatedOutage(db, w.admin, njv, true, T0);
    expect(await check(nvTracking, nv)).toMatchObject({ state: 'PROVIDER_UNAVAILABLE', fallback: true });
    expect(await incidents('PROVIDER_OUTAGE')).toBe(1);
    await expect(registerParcel(db, nv, { stationId: stationA.id, trackingNo: nvTracking, size: 'S', recipient: { homeId: aisyahHome, name: 'Aisyah' } }, T0)).rejects.toMatchObject({ code: 'DELIVERY_CODE_ONLY' });
    const fallback = await registerParcel(db, nv, { stationId: stationA.id, trackingNo: nvTracking, size: 'S', recipient: { memberCode: aisyah.memberCode! } }, T0);
    expect(fallback.verified).toBe(true);
    expect((await one<{ assurance: string }>(db, 'SELECT assurance FROM locker_parcels WHERE id = $1', [fallback.id]))!.assurance).toBe('LOW');
    await setSimulatedOutage(db, w.admin, njv, false, T0);
    // With the provider answering, the fallback is not allowed.
    const other = await shipment(njv, { name: 'Aisyah Rahman', address });
    await expect(registerParcel(db, nv, { stationId: stationA.id, trackingNo: other, size: 'S', recipient: { memberCode: aisyah.memberCode! } }, T0)).rejects.toMatchObject({ code: 'SCAN_FIRST' });
  });
});

describe('A label never opens a door by itself', () => {
  it('delivers once: a repeated scan after deposit opens nothing, creates nothing and is recorded', async () => {
    const tracking = await shipment(jnt, { name: 'Aisyah Rahman', address: await addressOf(aisyahHome), carriedBy: 'JT-1001' });
    const parcelId = await depositShipment(faizal, tracking);
    expect((await one<{ state: string }>(db, 'SELECT state FROM locker_parcels WHERE id = $1', [parcelId]))!.state).toBe('READY_FOR_COLLECTION');
    expect((await one<{ title: string }>(db, 'SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [aisyah.id]))!.title).toContain('J&T Express');
    expect((await one<{ status: string }>(db, 'SELECT status FROM sim_shipments WHERE tracking_no = $1', [tracking]))!.status).toBe('DELIVERED');
    const commands = await commandCount();
    for (const courier of [faizal, hairul]) {
      expect(await verifyShipment(db, courier, { stationId: stationA.id, code: tracking }, T0)).toMatchObject({ state: 'ALREADY_DEPOSITED' });
      await expect(deliverShipment(db, courier, { stationId: stationA.id, code: tracking, idempotencyKey: key() }, T0)).rejects.toMatchObject({ code: 'ALREADY_DEPOSITED' });
    }
    await expect(registerParcel(db, faizal, { stationId: stationA.id, trackingNo: tracking, size: 'S', recipient: { memberCode: aisyah.memberCode! } }, T0)).rejects.toMatchObject({ status: 422 });
    expect(await commandCount()).toBe(commands);
    expect(await parcelCount(tracking)).toBe(1);
    expect(await incidents('BARCODE_REPLAY')).toBe(1);
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM courier_scans WHERE tracking_no = $1 AND outcome = 'ALREADY_DEPOSITED'`, [tracking]))!.n).toBeGreaterThanOrEqual(4);
    // The completed parcel cannot be reopened through the courier's flow.
    await expect(reserveAndOpen(db, faizal, parcelId, key(), T0)).rejects.toMatchObject({ code: 'PARCEL_STATE' });
    // The database itself refuses a second parcel for the same shipment.
    const shipmentId = (await one<{ shipment_id: string }>(db, 'SELECT shipment_id FROM locker_parcels WHERE id = $1', [parcelId]))!.shipment_id;
    await expect(db.query(
      `INSERT INTO locker_parcels (township_id, home_id, company_id, tracking_no, size, station_id, state, state_changed_at, registered_at, shipment_id) VALUES ($1, $2, $3, 'X1', 'S', $4, 'VERIFIED', now(), now(), $5)`,
      [w.townshipId, aisyahHome, jnt, stationA.id, shipmentId],
    )).rejects.toThrow();
    // The resident collects with the PIN; the compartment is free again.
    const pin = (await myLockerParcels(db, aisyah, T0)).parcels.find((p) => p.id === parcelId)!.pin!;
    await pickupAtStation(db, stationA.id, pin, DEVICE, key(), T0);
    await simulateClose(db, aisyah, parcelId, false, T0);
    expect(await one(db, `SELECT 1 FROM locker_compartments WHERE parcel_id = $1`, [parcelId])).toBeUndefined();
    await expect(pickupAtStation(db, stationA.id, pin, DEVICE, key(), T0)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    // The household reports a problem: "we did not collect it" is a township case (once); damage goes to the courier company, not the township.
    await reportParcel(db, aisyah, parcelId, { reason: 'NOT_COLLECTED', note: 'Nobody was home' }, T0);
    await reportParcel(db, aisyah, parcelId, { reason: 'NOT_COLLECTED' }, T0);
    expect(await incidents('COLLECTION_DISPUTE')).toBe(1);
    await expect(reportParcel(db, aisyah, parcelId, { reason: 'OTHER' }, T0)).rejects.toMatchObject({ code: 'SAY_WHAT' });
    expect(await reportParcel(db, aisyah, parcelId, { reason: 'DAMAGED' }, T0)).toMatchObject({ route: 'COURIER' });
    expect(await incidents('DAMAGED_IN_TRANSIT')).toBe(0);
    expect((await myLockerParcels(db, aisyah, T0)).parcels.find((p) => p.id === parcelId)).toMatchObject({ reported: true, referred: true });
  });

  it('refuses a copied label before the real courier arrives', async () => {
    const tracking = await shipment(jnt, { name: 'Aisyah Rahman', address: await addressOf(aisyahHome), carriedBy: 'JT-1001' });
    // Another J&T courier: J&T says it is not theirs.
    expect(await verifyShipment(db, hairul, { stationId: stationA.id, code: tracking }, T0)).toMatchObject({ state: 'NOT_ELIGIBLE', reason: 'ASSIGNED_TO_ANOTHER_COURIER' });
    // A courier of another company: not even their company's tracking number.
    const nv = await actorOf((await one<{ user_id: string }>(db, `SELECT user_id FROM courier_accounts WHERE employee_ref = 'NV-2001'`))!.user_id);
    expect(await verifyShipment(db, nv, { stationId: stationA.id, code: tracking }, T0)).toMatchObject({ state: 'NOT_FOUND', reason: 'FORMAT' });
    expect(await parcelCount(tracking)).toBe(0);
  });

  it('lets only one of two simultaneous deliveries of the same shipment succeed', async () => {
    const tracking = await shipment(jnt, { name: 'Aisyah Rahman', address: await addressOf(aisyahHome), carriedBy: null });
    await db.query(`UPDATE courier_companies SET can_confirm_assignment = false WHERE id = $1`, [jnt]);
    const results = await Promise.allSettled([faizal, hairul].map((c) => deliverShipment(db, c, { stationId: stationA.id, code: tracking, idempotencyKey: key() }, T0)));
    await db.query(`UPDATE courier_companies SET can_confirm_assignment = true WHERE id = $1`, [jnt]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await parcelCount(tracking)).toBe(1);
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM locker_reservations r JOIN locker_parcels p ON p.id = r.parcel_id WHERE p.tracking_no = $1`, [tracking]))!.n).toBe(1);
  });

  it('opens the same reserved door at most a few times, and the same request key opens it once', async () => {
    const tracking = await shipment(jnt, { name: 'Aisyah Rahman', address: await addressOf(aisyahHome), carriedBy: 'JT-1001' });
    const k = key();
    const first = await deliverShipment(db, faizal, { stationId: stationA.id, code: tracking, idempotencyKey: k }, T0);
    if (first.kind !== 'OPENING') throw new Error('expected a door');
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM locker_commands WHERE idempotency_key = $1`, [k]))!.n).toBe(1);
    for (let i = 0; i < 2; i++) {
      await simulateClose(db, faizal, first.parcelId, false, T0);
      await reserveAndOpen(db, faizal, first.parcelId, key(), T0);
    }
    await simulateClose(db, faizal, first.parcelId, false, T0);
    await expect(reserveAndOpen(db, faizal, first.parcelId, key(), T0)).rejects.toMatchObject({ code: 'TOO_MANY_OPENS' });
  });
});

describe('Door commands the controller must refuse', () => {
  it('refuses an expired authorisation and a replayed command, and the door stays shut', async () => {
    const comp = (await one<{ id: string }>(db, `SELECT id FROM locker_compartments WHERE station_id = $1 AND state = 'AVAILABLE' LIMIT 1`, [stationB.id]))!;
    const command = await db.tx((tx) => createUnlock(tx, { stationId: stationB.id, compartmentId: comp.id, parcelId: null, purpose: 'MAINTENANCE', requestedBy: w.admin.id, idempotencyKey: key() }, T0));
    const late = await dispatch(db, command.id, new Date(T0.getTime() + 2 * MIN));
    expect(late.status).toBe('FAILED');
    expect(late.error).toMatch(/expired/);
    expect((await one<{ door: string }>(db, 'SELECT door FROM locker_compartments WHERE id = $1', [comp.id]))!.door).not.toBe('OPEN');
    const fresh = await db.tx((tx) => createUnlock(tx, { stationId: stationB.id, compartmentId: comp.id, parcelId: null, purpose: 'MAINTENANCE', requestedBy: w.admin.id, idempotencyKey: key() }, T0));
    expect((await dispatch(db, fresh.id, T0)).status).toBe('ACKED');
    expect(await replayCommand(db, stationB.id, fresh.id, T0)).toMatchObject({ opened: false, error: expect.stringMatching(/already carried out/) });
    expect(await incidents('COMMAND_REJECTED')).toBe(2);
  });

  it('does not accept a station acknowledging a command after it expired', async () => {
    const gw = await createStation(db, w.admin, { name: 'Gateway C', location: 'Lobby', layout: { S: 1 }, adapter: 'HTTP_GATEWAY', gatewayUrl: 'http://gateway.invalid', hasDoorSensor: true, hasPresenceSensor: true });
    const comp = (await one<{ id: string }>(db, 'SELECT id FROM locker_compartments WHERE station_id = $1', [gw.id]))!;
    const command = await db.tx((tx) => createUnlock(tx, { stationId: gw.id, compartmentId: comp.id, parcelId: null, purpose: 'MAINTENANCE', requestedBy: w.admin.id, idempotencyKey: key() }, T0));
    expect(await handleAck(db, gw.id, command.id, true, null, new Date(T0.getTime() + 5 * MIN), 'DEVICE', 'late-ack-0001')).toMatchObject({ late: true });
    expect((await one<{ status: string }>(db, 'SELECT status FROM locker_commands WHERE id = $1', [command.id]))!.status).toBe('TIMED_OUT');
  });

  it('raises an incident for a door left open', async () => {
    const comp = (await one<{ id: string }>(db, `SELECT id FROM locker_compartments WHERE station_id = $1 AND state = 'AVAILABLE' LIMIT 1`, [stationB.id]))!;
    await db.query(`UPDATE locker_compartments SET door = 'OPEN', updated_at = $2 WHERE id = $1`, [comp.id, new Date(T0.getTime() - 10 * MIN)]);
    expect((await reconcile(db, T0)).doorsLeftOpen).toBeGreaterThanOrEqual(1);
    expect(await incidents('DOOR_LEFT_OPEN')).toBeGreaterThanOrEqual(1);
    await db.query(`UPDATE locker_compartments SET door = 'CLOSED' WHERE id = $1`, [comp.id]);
  });
});

describe('Staff exceptions', () => {
  it('opens an occupied door only after a second admin approves, and holds the parcel as an exception', async () => {
    const tracking = await shipment(jnt, { name: 'Aisyah Rahman', address: await addressOf(aisyahHome), carriedBy: 'JT-1001' });
    const parcelId = await depositShipment(faizal, tracking);
    const pin = (await myLockerParcels(db, aisyah, T0)).parcels.find((p) => p.id === parcelId)!.pin!;
    const request = await requestException(db, w.admin, parcelId, { kind: 'WRONG_RECIPIENT', reason: 'Label says another unit' }, T0);
    expect(request).toMatchObject({ status: 'PENDING' });
    await expect(decideException(db, w.admin, request.id, { approve: true }, T0)).rejects.toMatchObject({ status: 403 });
    await expect(decideException(db, w.staff, request.id, { approve: true }, T0)).rejects.toMatchObject({ status: 403 });
    expect(await decideException(db, w.admin2, request.id, { approve: true }, T0)).toMatchObject({ status: 'APPROVED', command: { status: 'ACKED' } });
    expect((await one<{ state: string }>(db, 'SELECT state FROM locker_parcels WHERE id = $1', [parcelId]))!.state).toBe('EXCEPTION');
    await expect(pickupAtStation(db, stationA.id, pin, DEVICE, key(), T0)).rejects.toMatchObject({ code: 'PICKUP_CODE' });
    await simulateClose(db, w.admin, parcelId, false, T0);
    expect(await one(db, 'SELECT 1 FROM locker_compartments WHERE parcel_id = $1', [parcelId])).toBeUndefined();
    expect((await one<{ status: string }>(db, 'SELECT status FROM locker_exception_requests WHERE id = $1', [request.id]))!.status).toBe('DONE');
  });

  it('keeps the old way working for companies whose couriers are approved one by one', async () => {
    const pos = (await createCompany(db, w.admin, 'Pos Laju')).id;
    expect((await one<{ status: string }>(db, 'SELECT status FROM courier_company_townships WHERE company_id = $1 AND township_id = $2', [pos, w.townshipId]))!.status).toBe('ACTIVE');
    const applied = await applyAsCourier(db, { townshipId: w.townshipId, companyId: pos, fullName: 'Pos Courier', email: 'courier@pos.test', phone: '+60123456789', password: 'a-strong-password-1' }, T0);
    const courier = await actorOf(applied.id);
    await expect(registerParcel(db, courier, { stationId: stationA.id, trackingNo: 'EP123456789MY', size: 'S', recipient: { memberCode: aisyah.memberCode! } }, T0)).rejects.toMatchObject({ status: 403 });
  });
});
