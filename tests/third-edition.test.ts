import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { checkBillFile } from '@/server/files/gate';
import { pdfText, simplePdf } from '@/server/files/pdf';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { deleteAccessProfile, getAccessProfile, inviteCarer, respondToCarerInvite, saveAccessProfile } from '@/server/modules/akses/service';
import { decideDraft, runAgentClock, simulateSignal } from '@/server/modules/banjir/agent';
import { recordLevel } from '@/server/modules/banjir/service';
import { setSponsorTier } from '@/server/modules/campaigns/tiers';
import { addPoints, finishActivity, startActivity, trimNearEnds } from '@/server/modules/gerak/tracking';
import { createLoop } from '@/server/modules/gerak/service';
import { confirmBill, parseBillText, readBill } from '@/server/modules/jimat/bills';
import { claimGuestSession, createMachine, itemText, joinFromScreen, machineScreen, simulateFinish, simulateItem, simulateStart } from '@/server/modules/kitar/machine';
import { createKiosk } from '@/server/modules/kitar/service';
import { runJob } from '@/server/modules/admin/service';
import { addSighting, applyForPlot, createGarden, decideSighting, markWatered, runBallot, withdrawApplication } from '@/server/modules/taman/service';
import { createPass, logWalkIn, publicPass, replyToWalkIn, scanPass, tamuOverview } from '@/server/modules/tamu/service';
import { T0, at, expectFloatBalanced, freshDb, makeCampaign, makeHome, makeResident, makeWorld, type World } from './helpers';

/** The features added for the proposal's third edition, one business rule at a time. */

let db: Db;
let w: World;
let guard: Actor;
const clock = { now: T0 };
let handle: (req: Request) => Promise<Response>;

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  const row = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ('guard@kita.test', 'Guard One', 'GUARD', $1) RETURNING id`, [w.townshipId]);
  guard = { ...w.staff, id: row!.id, role: 'GUARD', fullName: 'Guard One', email: 'guard@kita.test' };
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => clock.now }).handle;
});
afterAll(() => db.close());

async function call(method: string, path: string, opts: { as?: Actor; body?: unknown } = {}) {
  const headers = new Headers({ origin: 'http://kita.test' });
  if (opts.as) headers.set('cookie', `kita_session=${await createSession(db, opts.as.id, clock.now)}`);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { data?: any; error?: any }) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: json.data, error: json.error };
}

describe('Tamu: visitors and the guard (BR26, BR27)', () => {
  it('lets a guard scan a pass once, tells the host, and never gives XP', async () => {
    const host = await makeResident(w);
    const pass = await createPass(db, host, { type: 'ONE_VISIT', visitorName: 'Mak Cik Rohani', vehicleNo: 'wxy 1234', validFrom: T0, validUntil: at(1) }, T0);
    expect(pass.token.length).toBeGreaterThan(30);

    const visitorView = await publicPass(db, pass.token, T0);
    expect(visitorView).toMatchObject({ status: 'ACTIVE', visitorName: 'Mak Cik Rohani', code: pass.code });
    expect(JSON.stringify(visitorView)).not.toContain(host.fullName); // the host's name is never on the visitor's page

    const entry = await scanPass(db, guard, `KITAPASS:${pass.code}`, at(0.1));
    expect(entry).toMatchObject({ visitorName: 'Mak Cik Rohani', vehicleNo: 'WXY 1234' });
    await expect(scanPass(db, guard, pass.code, at(0.2))).rejects.toMatchObject({ code: 'PASS_USED' });
    const inbox = await db.query<{ title: string }>('SELECT title FROM notifications WHERE user_id = $1', [host.id]);
    expect(inbox.some((n) => n.title.startsWith('Mak Cik Rohani arrived at'))).toBe(true);
    expect((await one<{ xp_total: number }>(db, 'SELECT xp_total FROM users WHERE id = $1', [host.id]))!.xp_total).toBe(0);
  });

  it('refuses a pass from another township, and a pass that is too long', async () => {
    const other = await makeWorld(db);
    const host = await makeResident(other);
    const pass = await createPass(db, host, { type: 'DELIVERY', visitorName: 'Rider', validFrom: T0, validUntil: at(0.5) }, T0);
    await expect(scanPass(db, guard, pass.code, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createPass(db, host, { type: 'ONE_VISIT', visitorName: 'Too long', validFrom: T0, validUntil: at(5) }, T0)).rejects.toMatchObject({ code: 'PASS_TOO_LONG' });
  });

  it('asks the household about a walk-in visitor and shows the guard the answer, with no identity card stored', async () => {
    const homeId = await makeHome(w);
    const host = await makeResident(w, { homeId });
    const walkIn = await logWalkIn(db, guard, { visitorName: 'Unknown Contractor', vehicleNo: 'ABC123', homeId }, T0);
    expect(walkIn.notified).toBe(1);
    expect((await tamuOverview(db, host, T0)).waiting).toHaveLength(1);
    await replyToWalkIn(db, host, walkIn.entryId, 'NOT_EXPECTED', T0);
    const columns = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'visitor_entries'`);
    expect(columns.map((c) => c.column_name).some((c) => /(^|_)(ic|nric|mykad|identity|passport)(_|$)/i.test(c))).toBe(false);
  });

  it('deletes visitor records after 90 days in the daily cleanup', async () => {
    const before = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM visitor_entries');
    expect(before!.n).toBeGreaterThan(0);
    await runJob(db, 'cleanup', at(91));
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM visitor_entries'))!.n).toBe(0);
  });

  it('keeps residents out of the guard screen and the guard out of residents’ screens', async () => {
    const resident = await makeResident(w);
    expect((await call('GET', '/guard', { as: resident })).status).toBe(403);
    expect((await call('GET', '/tamu', { as: guard })).status).toBe(403);
    expect((await call('GET', '/guard', { as: guard })).status).toBe(200);
  });
});

describe('Kitar smart machine (BR23)', () => {
  let machineId: string;
  beforeAll(async () => {
    await createKiosk(db, w.staff, { name: 'Kiosk Machine', location: 'Hall' });
    const kiosk = await one<{ id: string }>(db, `SELECT id FROM kitar_kiosks WHERE name = 'Kiosk Machine'`);
    machineId = (await createMachine(db, w.admin, { name: 'Machine 1', kioskId: kiosk!.id })).id;
  });

  it('starts from the rotating screen code, counts only items where camera, barcode and weight agree, and rewards the signed session', async () => {
    const resident = await makeResident(w);
    const screen = await machineScreen(db, w.staff, machineId, T0);
    await expect(joinFromScreen(db, resident, { machineId, code: screen.screen.code }, at(0.01))).rejects.toMatchObject({ code: 'SCREEN_CODE_OLD' }); // 14 minutes later
    await joinFromScreen(db, resident, { machineId, code: screen.screen.code }, new Date(T0.getTime() + 20_000));

    const t = new Date(T0.getTime() + 30_000);
    expect((await simulateItem(db, w.staff, machineId, { material: 'ALUMINIUM', outcome: 'ACCEPT' }, t)).accepted).toBe(true);
    expect((await simulateItem(db, w.staff, machineId, { material: 'PLASTIC_PET', outcome: 'ACCEPT' }, t)).accepted).toBe(true);
    const wrong = await simulateItem(db, w.staff, machineId, { material: 'GLASS', outcome: 'WRONG_MATERIAL' }, t);
    expect(wrong).toMatchObject({ accepted: false, reason: 'This item is not the material this bin takes.' });

    const done = await simulateFinish(db, w.staff, machineId, t);
    expect(done).toMatchObject({ acceptedCount: 2, rejectedCount: 1 });
    expect(done.reward!.xp).toBeGreaterThan(0);
    const drops = await db.query('SELECT material FROM kitar_dropoffs WHERE session_id = $1', [done.sessionId]);
    expect(drops).toHaveLength(2);
  });

  it('refuses a device record with a wrong signature, or a replay', async () => {
    const res = await handle(
      new Request('http://kita.test/api/v1/ingest/kitar/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ machineId, mode: 'GUEST', memberCode: null, ts: T0.toISOString(), signature: 'a'.repeat(64) }),
      }),
    );
    expect(res.status).toBe(401);
    const secret = (await one<{ secret: string }>(db, 'SELECT secret FROM kitar_machines WHERE id = $1', [machineId]))!.secret;
    const record = { machineId, sessionId: '00000000-0000-4000-8000-000000000000', seq: 1, material: 'PAPER' as const, cameraMaterial: 'PAPER' as const, barcodeOk: true, weightG: 50, accepted: true, ts: T0.toISOString() };
    const old = { ...record, ts: at(-1).toISOString() };
    const stale = await handle(
      new Request('http://kita.test/api/v1/ingest/kitar/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...old, signature: createHmac('sha256', secret).update(itemText(old)).digest('hex') }),
      }),
    );
    expect(stale.status).toBe(401); // a day-old record is refused even with the right signature
  });

  it('gives a guest a claim code that a resident can claim once for XP only, within 14 days', async () => {
    await simulateStart(db, w.staff, machineId, { mode: 'GUEST' }, T0);
    await simulateItem(db, w.staff, machineId, { material: 'PAPER', outcome: 'ACCEPT' }, T0);
    const done = await simulateFinish(db, w.staff, machineId, T0);
    expect(done.claimCode).toMatch(/^[A-Z0-9]{8}$/);
    const resident = await makeResident(w);
    await expect(claimGuestSession(db, resident, done.claimCode!, at(15))).rejects.toMatchObject({ code: 'CLAIM_EXPIRED' });
    const claimed = await claimGuestSession(db, resident, done.claimCode!, at(1));
    expect(claimed.reward).toMatchObject({ points: 0, offerPoints: 0 });
    expect(claimed.reward!.xp).toBeGreaterThan(0);
    await expect(claimGuestSession(db, resident, done.claimCode!, at(1))).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
  });
});

describe('Gerak map tracking (BR24)', () => {
  // A short loop near (3.05, 101.45). 0.001° of latitude is about 111 m.
  const P = (dLat: number, dLng: number) => ({ lat: 3.05 + dLat, lng: 101.45 + dLng });

  it('ticks checkpoints by itself, ignores poor fixes and fast stretches, and credits a verified trip', async () => {
    await createLoop(db, w.staff, { name: 'Map Loop', description: 'Test', mode: 'WALK', distanceM: 900, checkpoints: ['North', 'South'] });
    const cps = await db.query<{ id: string; seq: number }>(`SELECT cp.id, cp.seq FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id WHERE l.name = 'Map Loop' ORDER BY cp.seq`);
    await db.query('UPDATE gerak_checkpoints SET lat = $2, lng = $3 WHERE id = $1', [cps[0]!.id, P(0.003, 0).lat, P(0.003, 0).lng]);
    await db.query('UPDATE gerak_checkpoints SET lat = $2, lng = $3 WHERE id = $1', [cps[1]!.id, P(0.006, 0).lat, P(0.006, 0).lng]);

    const resident = await makeResident(w);
    const a = await startActivity(db, resident, { mode: 'WALK', simulated: false }, T0);
    const t0 = T0.getTime();
    // Walking north at about 1.4 m/s: one fix every 40 s covers about 55 m (0.0005°).
    const walk = Array.from({ length: 14 }, (_, i) => ({ ...P(0.0005 * i, 0), acc: 8, t: t0 + 40_000 * (i + 1) }));
    walk.splice(3, 0, { ...P(0.0016, 0.01), acc: 120, t: t0 + 40_000 * 3 + 5_000 }); // a poor fix far off the path
    const progress = await addPoints(db, resident, a.id, walk, new Date(t0 + 40_000 * 15));
    expect(progress.ticked).toEqual(['North', 'South']);
    expect(progress.ignored).toBe(1);
    // Then a car: 1 km in 60 s does not count.
    const car = await addPoints(db, resident, a.id, [{ ...P(0.0155, 0), acc: 8, t: t0 + 40_000 * 15 + 60_000 }], new Date(t0 + 40_000 * 16 + 60_000));
    expect(car.tooFastM).toBeGreaterThan(900);

    const result = await finishActivity(db, resident, a.id, new Date(t0 + 40_000 * 17));
    expect(result.loopsCompleted).toBe(1);
    expect(result.validM).toBeGreaterThan(600);
    expect(result.validM).toBeLessThan(800);
    expect(result.reward.xp).toBeGreaterThan(0);
    // The first and last 200 m are not kept.
    const stored = await one<{ route: [number, number][] }>(db, 'SELECT route FROM gerak_activities WHERE id = $1', [a.id]);
    expect(stored!.route.length).toBeLessThan(walk.length);
  });

  it('trims the stretch near home from both ends of a route', () => {
    const route: [number, number][] = Array.from({ length: 11 }, (_, i) => [3.05 + 0.001 * i, 101.45]);
    const trimmed = trimNearEnds(route, 200);
    expect(trimmed[0]![0]).toBeGreaterThan(3.0518);
    expect(trimmed[trimmed.length - 1]![0]).toBeLessThan(3.0582);
  });

  it('refuses simulated GPS in production', async () => {
    const resident = await makeResident(w);
    process.env.APP_ENV = 'production';
    const { getConfig } = await import('@/server/config');
    const cfg = getConfig() as { APP_ENV: string };
    const original = cfg.APP_ENV;
    cfg.APP_ENV = 'production';
    try {
      await expect(startActivity(db, resident, { mode: 'WALK', simulated: true }, T0)).rejects.toMatchObject({ code: 'SIMULATION_OFF' });
    } finally {
      cfg.APP_ENV = original;
      process.env.APP_ENV = 'development';
    }
  });
});

describe('Jimat bill reading (BR25)', () => {
  const bill = (lines: string[]) => simplePdf(lines.map((text, i) => ({ text, x: 50, y: 780 - i * 20 })));

  it('refuses a file by its real signature, a PDF with a script hidden by #-escapes, and the EICAR test file', () => {
    expect(() => checkBillFile(new TextEncoder().encode('hello, I am a text file'))).toThrow(/Only JPG, PNG, WebP or PDF/);
    const sneaky = Buffer.concat([simplePdf([{ text: 'Bill', x: 50, y: 700 }]), Buffer.from('\n<< /S /J#61vaScript /JS (app.alert(1)) >>\n')]);
    expect(() => checkBillFile(sneaky)).toThrow(/active content/);
    const eicar = Buffer.from('%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n');
    expect(() => checkBillFile(eicar)).toThrow(/malware/);
  });

  it('reads a bill’s own text, checks it, and lets the same bill be used once only; the file is never stored', async () => {
    const homeId = await makeHome(w, 'Jalan Bil', 'Precinct 9');
    const resident = await makeResident(w, { homeId });
    const pdf = bill([
      'KITA Demo Electricity',
      'Alamat / Address: No. 1, Jalan Bil, Precinct 9',
      'No. Akaun / Account No: 2201234567890',
      'Tempoh Bil / Billing Period: 01/10/2026 - 31/10/2026',
      'Jumlah Penggunaan / Total Usage: 342 kWh',
      'Jumlah Perlu Dibayar / Amount Due: RM 149.11',
    ]);
    expect(pdfText(pdf)).toContain('342 kWh');
    const read = await readBill(db, resident, { bytes: pdf, kind: 'ELECTRICITY' }, T0);
    expect(read).toMatchObject({ source: 'TEXT' });
    expect(read.fields).toMatchObject({ usage: { value: 342, unsure: false }, amountSen: { value: 14_911, unsure: false }, month: { value: '2026-10', unsure: false } });
    expect(read.checks.every((c) => c.ok)).toBe(true);
    // Only the last four digits ever leave the reading step; the full account number is kept as a hash only.
    expect(JSON.stringify(read)).not.toContain('2201234567890');
    expect(read.fields.accountLast4.value).toBe('7890');
    const stored = await one<{ fields: unknown; account_hash: string }>(db, 'SELECT fields, account_hash FROM jimat_bills WHERE id = $1', [read.billId]);
    expect(JSON.stringify(stored!.fields)).not.toContain('2201234567890');
    expect(stored!.account_hash).toMatch(/^[0-9a-f]{64}$/);
    const columns = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'jimat_bills'`);
    expect(columns.some((c) => /bytes|file_data|content/.test(c.column_name))).toBe(false);

    await confirmBill(db, resident, read.billId, { kind: 'ELECTRICITY', usage: 342, amountSen: 14_911, month: '2026-10' }, T0);
    const again = await readBill(db, resident, { bytes: pdf, kind: 'ELECTRICITY' }, T0);
    await expect(confirmBill(db, resident, again.billId, { kind: 'ELECTRICITY', usage: 342, amountSen: 14_911, month: '2026-10' }, T0)).rejects.toMatchObject({ code: 'BILL_USED' });
  });

  it('marks a field unsure when it is not next to its label', () => {
    const parsed = parseBillText('Bill RM 80.00 for 200 kWh in Okt 2026', 'ELECTRICITY');
    expect(parsed.usage).toEqual({ value: 200, unsure: true });
    expect(parsed.month).toEqual({ value: '2026-10', unsure: true });
  });
});

describe('Banjir agent (BR28)', () => {
  let zoneId: string;
  let resident: Actor;
  beforeAll(async () => {
    const z = await one<{ id: string }>(db, `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, 'Agent Zone', 'Go uphill', 'School') RETURNING id`, [w.townshipId]);
    zoneId = z!.id;
    const h = await one<{ id: string }>(db, `INSERT INTO homes (township_id, zone_id, unit_code, street) VALUES ($1, $2, 'AZ-1', 'Jalan Air') RETURNING id`, [w.townshipId, zoneId]);
    resident = await makeResident(w, { homeId: h!.id });
  });
  const status = async () => (await one<{ status: string }>(db, 'SELECT status FROM flood_zones WHERE id = $1', [zoneId]))!.status;

  it('only drafts on one signal, and sends at once when a second signal agrees', async () => {
    await simulateSignal(db, w.staff, zoneId, { source: 'SENSOR', levelPct: 80 }, T0);
    expect(await status()).toBe('NORMAL');
    const draft = await one<{ level: string; status: string }>(db, `SELECT level, status FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT'`, [zoneId]);
    expect(draft).toMatchObject({ level: 'WARNING' });
    // An unclear night picture does not count as a second signal.
    await simulateSignal(db, w.staff, zoneId, { source: 'CAMERA', pictureId: 'night-88' }, at(0.0005));
    expect(await status()).toBe('NORMAL');
    await simulateSignal(db, w.staff, zoneId, { source: 'CAMERA', pictureId: 'day-78' }, at(0.001));
    expect(await status()).toBe('WARNING');
    const msg = await one<{ what: string; todo: string; next_update_at: Date; decision: string }>(db, `SELECT what, todo, next_update_at, decision FROM flood_messages WHERE zone_id = $1 AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1`, [zoneId]);
    expect(msg).toMatchObject({ decision: 'TWO_SIGNALS' });
    expect(msg!.next_update_at).toBeTruthy(); // every alert states the time of the next update
  });

  it('sends a one-signal Danger after 3 minutes with no answer while the water still rises', async () => {
    await simulateSignal(db, w.staff, zoneId, { source: 'SENSOR', levelPct: 92 }, at(0.002));
    expect(await status()).toBe('WARNING'); // only the sensor says danger
    await simulateSignal(db, w.staff, zoneId, { source: 'SENSOR', levelPct: 95 }, at(0.0025));
    await runAgentClock(db, new Date(at(0.002).getTime() + 2 * 60_000));
    expect(await status()).toBe('WARNING');
    await runAgentClock(db, new Date(at(0.002).getTime() + 4 * 60_000));
    expect(await status()).toBe('DANGER');
    const inbox = await db.query<{ priority: string; title: string }>('SELECT priority, title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [resident.id]);
    expect(inbox[0]).toMatchObject({ priority: 'URGENT', title: 'Flood danger in Agent Zone' });
  });

  it('lets the officer confirm or cancel a draft, and sends the all clear when two sources agree', async () => {
    await recordLevel(db, { zoneId, levelPct: 20, actor: w.staff }, at(0.01));
    expect(await status()).toBe('NORMAL');
    await simulateSignal(db, w.staff, zoneId, { source: 'RAIN', rainMmHr: 45 }, at(0.02));
    const draft = await one<{ id: string }>(db, `SELECT id FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT'`, [zoneId]);
    await decideDraft(db, w.staff, draft!.id, { action: 'SEND', todo: 'Heavy rain: please stay away from the lake road for now.' }, at(0.021));
    expect(await status()).toBe('WARNING');
    await simulateSignal(db, w.staff, zoneId, { source: 'SENSOR', levelPct: 15 }, at(0.03));
    await simulateSignal(db, w.staff, zoneId, { source: 'CAMERA', pictureId: 'day-12' }, at(0.031));
    expect(await status()).toBe('NORMAL');
  });

  it('sends the agreed warning but still asks the officer about a one-signal danger, and drops a draft whose signal goes stale', async () => {
    const z = await one<{ id: string }>(db, `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, 'Second Zone', 'Go east', 'Hall') RETURNING id`, [w.townshipId]);
    const zone = z!.id;
    const t = at(1);
    await simulateSignal(db, w.staff, zone, { source: 'SENSOR', levelPct: 93 }, t); // danger, one signal
    await simulateSignal(db, w.staff, zone, { source: 'RAIN', rainMmHr: 45 }, new Date(t.getTime() + 30_000)); // supports a warning
    expect((await one<{ status: string }>(db, 'SELECT status FROM flood_zones WHERE id = $1', [zone]))!.status).toBe('WARNING');
    const draft = await one<{ id: string; level: string }>(db, `SELECT id, level FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT'`, [zone]);
    expect(draft).toMatchObject({ level: 'DANGER' });
    // Twenty minutes later nothing fresh says danger: the draft is dropped, not sent.
    await runAgentClock(db, new Date(t.getTime() + 20 * 60_000));
    expect((await one<{ status: string }>(db, 'SELECT status FROM flood_messages WHERE id = $1', [draft!.id]))!.status).toBe('CANCELLED');
    expect((await one<{ status: string }>(db, 'SELECT status FROM flood_zones WHERE id = $1', [zone]))!.status).toBe('WARNING');
  });

  it('serves the public status page with no sign-in and no personal data', async () => {
    const res = await call('GET', '/public/flood-status');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).not.toContain(resident.fullName);
    expect(res.data[0].zones.length).toBeGreaterThan(0);
  });
});

describe('Akses+ (BR32) and Taman', () => {
  it('stores access needs only with consent, and deletes them on request', async () => {
    const resident = await makeResident(w);
    const input = { needs: ['MOBILITY' as const], simpleMode: true, readAloud: false, flashAlerts: true, priorityHelp: true, consent: false };
    await expect(saveAccessProfile(db, resident, input, T0)).rejects.toMatchObject({ code: 'CONSENT_NEEDED' });
    expect((await saveAccessProfile(db, resident, { ...input, consent: true }, T0)).needs).toEqual(['MOBILITY']);
    await deleteAccessProfile(db, resident);
    expect((await getAccessProfile(db, resident)).needs).toEqual([]);
  });

  it('links a carer only when the carer accepts', async () => {
    const [resident, carer] = [await makeResident(w), await makeResident(w)];
    const link = await inviteCarer(db, resident, carer.memberCode!, T0);
    expect(link.status).toBe('PENDING');
    const other = await makeResident(w);
    await expect(respondToCarerInvite(db, other, link.id, true, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await respondToCarerInvite(db, carer, link.id, true, T0)).status).toBe('ACTIVE');
  });

  it('gives plots out by ballot, one per home, and keeps the rest on the waiting list', async () => {
    const { id: gardenId } = await createGarden(db, w.staff, { name: 'Ballot Garden', location: 'Central park', plots: 2, plotSizeM2: 4 });
    const applicants = [await makeResident(w), await makeResident(w), await makeResident(w)];
    await expect(runBallot(db, w.staff, gardenId, T0)).rejects.toMatchObject({ code: 'NO_APPLICANTS' });
    const applications = [];
    for (const r of applicants) applications.push(await applyForPlot(db, r, gardenId, T0));
    await expect(applyForPlot(db, applicants[0]!, gardenId, T0)).rejects.toMatchObject({ code: 'ALREADY_APPLIED' });

    expect(await runBallot(db, w.staff, gardenId, T0)).toEqual({ allocated: 2, stillWaiting: 1, freePlotsLeft: 0 });
    const holders = await db.query<{ holder_user_id: string }>('SELECT holder_user_id FROM garden_plots WHERE garden_id = $1 AND holder_home_id IS NOT NULL', [gardenId]);
    expect(new Set(holders.map((h) => h.holder_user_id)).size).toBe(2);
    const loser = applicants.find((r) => !holders.some((h) => h.holder_user_id === r.id))!;
    const winner = applicants.find((r) => r.id !== loser.id)!;
    await expect(applyForPlot(db, winner, gardenId, T0)).rejects.toMatchObject({ code: 'ONE_PLOT' });
    await expect(runBallot(db, w.staff, gardenId, T0)).rejects.toMatchObject({ code: 'NO_FREE_PLOTS' });
    const inbox = await db.query<{ user_id: string; title: string }>(`SELECT user_id, title FROM notifications WHERE title LIKE '%Ballot Garden'`);
    expect(inbox.filter((n) => n.title.startsWith('You won plot'))).toHaveLength(2);
    expect(inbox.find((n) => n.user_id === loser.id)?.title).toBe('Still on the waiting list for Ballot Garden');

    // The resident who was not drawn can leave the list, and only their own home's entry.
    const loserApp = applications[applicants.indexOf(loser)]!;
    await expect(withdrawApplication(db, winner, loserApp.id, T0)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await withdrawApplication(db, loser, loserApp.id, T0);
    expect((await one<{ waiting: number }>(db, `SELECT count(*)::int AS waiting FROM garden_applications WHERE garden_id = $1 AND status = 'WAITING'`, [gardenId]))!.waiting).toBe(0);
  });

  it('records watering by the garden code, and gives XP for confirmed sightings', async () => {
    const { id: gardenId } = await createGarden(db, w.staff, { name: 'Test Garden', location: 'By the lake', plots: 2, plotSizeM2: 6 });
    const resident = await makeResident(w);
    const code = (await one<{ code: string }>(db, 'SELECT code FROM gardens WHERE id = $1', [gardenId]))!.code;
    const watered = await markWatered(db, resident, code, T0);
    expect(watered.reward.xp).toBe(15);
    expect(watered.reward.offerPoints).toBe(0); // a printed gate code proves too little for points
    const sighting = await addSighting(db, resident, { kind: 'BIRD', species: 'Oriental magpie-robin', location: 'Lake' }, T0);
    await decideSighting(db, w.staff, sighting.id, true, T0);
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM xp_events WHERE user_id = $1 AND activity = 'TAMAN_SIGHTING'`, [resident.id]))!.n).toBe(1);
  });
});

describe('sponsor tiers', () => {
  it('records the tier fee as income outside the float, allows one Title Partner, and lists partners publicly', async () => {
    const a = await one<{ id: string }>(db, `INSERT INTO sponsors (name) VALUES ('Tier A') RETURNING id`);
    const b = await one<{ id: string }>(db, `INSERT INTO sponsors (name) VALUES ('Tier B') RETURNING id`);
    await setSponsorTier(db, w.hq, a!.id, { tier: 'TITLE_PARTNER', bankRef: 'TIER-A', category: 'Energy' }, T0);
    await expect(setSponsorTier(db, w.hq, b!.id, { tier: 'TITLE_PARTNER', bankRef: 'TIER-B' }, T0)).rejects.toMatchObject({ code: 'TIER_TAKEN' });
    await expect(setSponsorTier(db, w.hq, b!.id, { tier: 'GREEN_CHAMPION', bankRef: 'TIER-B2', category: 'energy' }, T0)).rejects.toMatchObject({ code: 'CATEGORY_TAKEN' });
    await setSponsorTier(db, w.hq, b!.id, { tier: 'COMMUNITY_FRIEND', bankRef: 'TIER-B3' }, T0);
    await expectFloatBalanced(db);
    clock.now = T0;
    const partners = await call('GET', '/public/partners');
    expect(partners.data.map((g: { tier: string }) => g.tier)).toEqual(['TITLE_PARTNER', 'COMMUNITY_FRIEND']);
    expect((await call('POST', `/admin/sponsors/${a!.id}/tier`, { as: w.admin, body: { tier: 'COMMUNITY_FRIEND', bankRef: 'X-1' } })).status).toBe(403);
  });
});

describe('public Challenges page', () => {
  it('lists only live funded challenges and the XP actions, with no budgets or people', async () => {
    const live = await makeCampaign(w, { title: 'Live recycling week', rewardPoints: 250 });
    await makeCampaign(w, { title: 'Draft only' }, false);
    await makeCampaign(w, { title: 'Starts next month', startsAt: at(20), endsAt: at(40) });
    clock.now = T0;
    const res = await call('GET', '/public/challenges');
    expect(res.status).toBe(200);
    const titles = res.data.challenges.map((c: { title: string }) => c.title);
    expect(titles).toContain('Live recycling week');
    expect(titles).not.toContain('Draft only');
    expect(titles).not.toContain('Starts next month');
    const card = res.data.challenges.find((c: { id: string }) => c.id === live);
    expect(card).toMatchObject({ reward_points: 250, funder: 'Sime Darby Property', activity: 'KITAR_DROPOFF' });
    expect(Object.keys(card)).not.toContain('budget_sen');
    expect(res.data.everyday.some((a: { activity: string; xp: number }) => a.activity === 'KITAR_DROPOFF' && a.xp > 0)).toBe(true);
  });
});
