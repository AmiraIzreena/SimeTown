import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { createSession } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { routes } from '@/server/http/api';
import { createRouter } from '@/server/http/router';
import { runJob } from '@/server/modules/admin/service';
import { saveAccessProfile } from '@/server/modules/akses/service';
import { checkIn, messageSources, runAgentClock, simulateSignal } from '@/server/modules/banjir/agent';
import { assignHelpTask, eventReport, floodInsights, helpBoard, markReached, reviewEvent } from '@/server/modules/banjir/events';
import { ingestReadings, signReading, type Reading } from '@/server/modules/banjir/ingest';
import { listSensors, logMaintenance, registerSensor } from '@/server/modules/banjir/sensors';
import { recordLevel } from '@/server/modules/banjir/service';
import { T0, freshDb, makeResident, makeWorld, type World } from './helpers';

/** Banjir with real sensors (proposal Appendix E): one test per new rule, and the paths around them. */

let db: Db;
let w: World;
const clock = { now: T0 };
let handle: (req: Request) => Promise<Response>;
let n = 0;

const sec = (s: number, from: Date = T0) => new Date(from.getTime() + s * 1000);
const min = (m: number, from: Date = T0) => sec(m * 60, from);

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  handle = createRouter(routes, { prefix: '/api/v1', db: async () => db, now: () => clock.now }).handle;
});
afterAll(() => db.close());

async function call(method: string, path: string, opts: { as?: Actor; body?: unknown; device?: boolean } = {}) {
  const headers = new Headers(opts.device ? {} : { origin: 'http://kita.test' });
  if (opts.as) headers.set('cookie', `kita_session=${await createSession(db, opts.as.id, clock.now)}`);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const res = await handle(new Request(`http://kita.test/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as { data?: any; error?: any }) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: json.data, error: json.error };
}

/** A zone with one home and one resident in it. */
async function makeZone(world: World = w) {
  const name = `Sensor Zone ${++n}`;
  const zone = (await one<{ id: string }>(db, `INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, $2, 'Go uphill', 'School') RETURNING id`, [world.townshipId, name]))!.id;
  const home = await one<{ id: string }>(db, `INSERT INTO homes (township_id, zone_id, unit_code, street) VALUES ($1, $2, $3, 'Jalan Sungai') RETURNING id`, [world.townshipId, zone, `SZ-${n}`]);
  const resident = await makeResident(world, { homeId: home!.id });
  return { zone, name, resident };
}

async function insertGuard(world: World, name: string): Promise<Actor> {
  const email = `${name.replace(/\s/g, '').toLowerCase()}${++n}@kita.test`;
  const row = await one<{ id: string }>(db, `INSERT INTO users (email, full_name, role, township_id) VALUES ($1, $2, 'GUARD', $3) RETURNING id`, [email, name, world.townshipId]);
  return { ...world.staff, id: row!.id, role: 'GUARD', fullName: name, email };
}

/** A real (not simulated) sensor: 0 cm is dry, 200 cm overflows, so 1% is 2 cm. */
async function sensor(zoneId: string, opts: { riseCm10min?: number } = {}) {
  return registerSensor(db, w.staff, { zoneId, code: `S-${++n}`, kind: 'RADAR', site: 'MAIN_DRAIN', baseCm: 0, overflowCm: 200, riseCm10min: opts.riseCm10min ?? 15, simulated: false }, T0);
}
type Sensor = Awaited<ReturnType<typeof sensor>>;

function signed(s: Sensor, zoneId: string, levelCm: number, at: Date, extra: Partial<Reading> = {}) {
  const reading: Reading = { sensor_id: s.id, zone_id: zoneId, level_cm: levelCm, battery: 90, rssi: -70, ts: at.toISOString(), ...extra };
  return { ...reading, signature: signReading(s.secret, reading) };
}
const send = (s: Sensor, zoneId: string, levelCm: number, at: Date, extra: Partial<Reading> = {}) => ingestReadings(db, [signed(s, zoneId, levelCm, at, extra)], at);
const zoneStatus = async (zoneId: string) => (await one<{ status: string }>(db, 'SELECT status FROM flood_zones WHERE id = $1', [zoneId]))!.status;
const draftOf = (zoneId: string) => one<{ id: string; level: string }>(db, `SELECT id, level FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT'`, [zoneId]);

describe('Signed ingestion (E.3 modules/flood/ingest)', () => {
  it('stores a signed reading, rejects a bad signature or the wrong zone, and drops a duplicate', async () => {
    const { zone } = await makeZone();
    const other = await makeZone();
    const s = await sensor(zone);
    clock.now = T0;
    const good = signed(s, zone, 40, T0);
    const ok = await call('POST', '/flood/readings', { body: good, device: true });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ stored: 1, duplicates: 0, readings: [{ levelPct: 20, nextReportSec: 60 }] });

    expect((await call('POST', '/flood/readings', { body: { ...signed(s, zone, 41, sec(60)), signature: 'a'.repeat(64) }, device: true })).status).toBe(401);
    expect((await call('POST', '/flood/readings', { body: { ...good, level_cm: 180 }, device: true })).status).toBe(401); // changed after signing
    expect((await call('POST', '/flood/readings', { body: signed(s, other.zone, 41, sec(60)), device: true })).status).toBe(401);

    // The gateway re-sends its buffer after a dropped link: the old reading is not stored twice.
    const again = await call('POST', '/flood/readings', { body: { readings: [good, signed(s, zone, 42, sec(60))] }, device: true });
    expect(again.data).toMatchObject({ stored: 1, duplicates: 1 });
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM flood_readings WHERE sensor_id = $1', [s.id]))!.n).toBe(2);
    expect((await call('POST', '/flood/readings', { body: signed(s, zone, 41, min(10)), device: true })).status).toBe(400); // from the future
  });

  it('never shows a sensor key again after registration', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    expect(s.secret).toMatch(/^[0-9a-f]{64}$/);
    const list = await call('GET', '/admin/banjir/sensors', { as: w.staff });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.data)).not.toContain(s.secret);
  });
});

describe('Rule 5: rate of rise', () => {
  it('counts a fast climb as a warning signal well below 75%', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone, { riseCm10min: 15 });
    await send(s, zone, 40, T0); // 20%
    await send(s, zone, 50, min(4));
    await send(s, zone, 60, min(8)); // 30%, but up 20 cm in 8 minutes
    const draft = await draftOf(zone);
    expect(draft).toMatchObject({ level: 'WARNING' }); // one signal: the officer is asked
    expect(await zoneStatus(zone)).toBe('NORMAL');
    // Heavy rain agrees: two signals of different types, sent at once with time to spare.
    await simulateSignal(db, w.staff, zone, { source: 'RAIN', rainMmHr: 45 }, min(8.5));
    expect(await zoneStatus(zone)).toBe('WARNING');
  });

  it('does not count a slow climb', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone, { riseCm10min: 15 });
    await send(s, zone, 40, T0);
    await send(s, zone, 46, min(5));
    await send(s, zone, 50, min(9));
    expect(await draftOf(zone)).toBeUndefined();
  });
});

describe('Rule 6: sensor health', () => {
  it('a low battery makes a sensor faulty: its danger reading is not counted, and staff get one ticket', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    await send(s, zone, 190, T0, { battery: 8 });
    await send(s, zone, 192, sec(15), { battery: 8 });
    expect(await draftOf(zone)).toBeUndefined();
    const row = await one<{ health: string; health_reason: string }>(db, 'SELECT health, health_reason FROM flood_sensors WHERE id = $1', [s.id]);
    expect(row).toEqual({ health: 'FAULTY', health_reason: 'LOW_BATTERY' });
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM flood_sensor_health WHERE sensor_id = $1 AND ticket_open', [s.id]))!.n).toBe(1);
    const inbox = await one<{ title: string }>(db, 'SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [w.staff.id]);
    expect(inbox!.title).toContain(`Sensor ${s.code} needs a check`);

    // A new battery: the sensor counts again, but the ticket stays open until maintenance is logged.
    await send(s, zone, 190, sec(30), { battery: 95 });
    expect(await draftOf(zone)).toMatchObject({ level: 'DANGER' });
    const closed = await logMaintenance(db, w.staff, s.id, { note: 'Battery replaced.' }, sec(40));
    expect(closed.ticketClosed).toBe(true);
  });

  it('a sensor silent for 5 minutes is marked faulty by the clock', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    const t = min(30);
    await send(s, zone, 160, t);
    await send(s, zone, 162, sec(15, t));
    expect(await draftOf(zone)).toMatchObject({ level: 'WARNING' });
    await runAgentClock(db, min(4, t));
    expect((await one<{ health: string }>(db, 'SELECT health FROM flood_sensors WHERE id = $1', [s.id]))!.health).toBe('OK');
    await runAgentClock(db, min(6, t));
    expect(await one(db, 'SELECT health, health_reason FROM flood_sensors WHERE id = $1', [s.id])).toEqual({ health: 'FAULTY', health_reason: 'NO_READING' });
  });

  it('a value stuck for 20 minutes is a fault', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    const t = min(60);
    for (let i = 0; i <= 20; i++) await send(s, zone, 33.3, min(i, t));
    expect(await one(db, 'SELECT health, health_reason FROM flood_sensors WHERE id = $1', [s.id])).toEqual({ health: 'FAULTY', health_reason: 'STUCK' });
    await send(s, zone, 33.6, min(21, t));
    expect((await one<{ health: string }>(db, 'SELECT health FROM flood_sensors WHERE id = $1', [s.id]))!.health).toBe('OK');
  });
});

describe('Rule 7: debounce and hysteresis', () => {
  it('needs two readings in a row to trigger', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    await send(s, zone, 186, T0); // 93%: a spider on the sensor?
    expect(await draftOf(zone)).toBeUndefined();
    await send(s, zone, 60, sec(15)); // gone again
    expect(await draftOf(zone)).toBeUndefined();
    await send(s, zone, 186, sec(30));
    await send(s, zone, 188, sec(45));
    expect(await draftOf(zone)).toMatchObject({ level: 'DANGER' });
  });

  it('clears only after every sensor has stayed below 60% for 30 minutes', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    const t = min(120);
    await send(s, zone, 160, t);
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-78' }, sec(10, t));
    await send(s, zone, 162, sec(15, t));
    expect(await zoneStatus(zone)).toBe('WARNING');
    // The water drops to 50%, and the camera agrees it is low, but it has not held for 30 minutes.
    await send(s, zone, 100, min(5, t));
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-12' }, sec(5 * 60 + 10, t));
    expect(await zoneStatus(zone)).toBe('WARNING');
    for (let m = 10; m <= 30; m += 5) await send(s, zone, 100, min(m, t));
    // 65% is below the warning line but above the all-clear line: the 30 minutes start again.
    await send(s, zone, 130, min(35, t));
    await send(s, zone, 100, min(40, t));
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-12' }, min(40.5, t));
    expect(await zoneStatus(zone)).toBe('WARNING');
    for (let m = 44; m <= 68; m += 4) await send(s, zone, 100, min(m, t));
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-12' }, min(68.5, t));
    expect(await zoneStatus(zone)).toBe('NORMAL');
  });
});

describe('Rule 8: independence', () => {
  it('counts two sensors in the same zone as one signal', async () => {
    const { zone } = await makeZone();
    const [a, b] = [await sensor(zone), await sensor(zone)];
    for (const [s, i] of [[a, 0], [b, 1]] as const) {
      await send(s, zone, 190, sec(i));
      await send(s, zone, 191, sec(15 + i));
    }
    expect(await zoneStatus(zone)).toBe('NORMAL'); // two sensors agreeing is still one signal
    expect(await draftOf(zone)).toMatchObject({ level: 'DANGER' });
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-93' }, sec(20));
    expect(await zoneStatus(zone)).toBe('DANGER'); // a camera is a different type: now two signals
  });
});

describe('Events, SMS, priority help and the report (rules 9 and 10)', () => {
  it('records the event from first alert to all clear, with check-ins, help and the review', async () => {
    // A township of its own, so the Insights tiles below count this event only.
    const w2 = await makeWorld(db);
    const [guard, otherGuard] = [await insertGuard(w2, 'Guard Amin'), await insertGuard(w2, 'Guard Bala')];
    const { zone, resident } = await makeZone(w2);
    await db.query(`UPDATE users SET phone = '+60123456789' WHERE id = $1`, [resident.id]);
    await saveAccessProfile(db, resident, { needs: ['MOBILITY'], simpleMode: false, readAloud: false, flashAlerts: false, priorityHelp: true, consent: true }, T0);
    const staff = w2.staff;
    const t = min(300);
    await recordLevel(db, { zoneId: zone, levelPct: 80, actor: staff }, t);
    await recordLevel(db, { zoneId: zone, levelPct: 95, actor: staff }, min(12, t));

    // BR19: the danger alert goes by SMS too (simulated in the prototype).
    const sms = await db.query<{ status: string; phone: string }>('SELECT status, phone FROM sms_outbox WHERE zone_id = $1', [zone]);
    expect(sms).toEqual([{ status: 'SIMULATED', phone: '+60123456789' }]);

    await checkIn(db, resident, 'SAFE', min(20, t));
    const board = await helpBoard(db, staff);
    expect(board.events).toHaveLength(1);
    const mine = board.events[0]!;
    expect(mine.people.map((p) => p.full_name)).toEqual([resident.fullName]);
    const task = await assignHelpTask(db, staff, { eventId: mine.id, userId: resident.id, assignedTo: guard.id }, min(21, t));
    const before = await call('GET', '/guard', { as: guard });
    expect(before.data.helpTasks).toMatchObject([{ id: task.id, full_name: resident.fullName }]);
    await expect(markReached(db, otherGuard, task.id, min(25, t))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await markReached(db, guard, task.id, min(26, t));
    expect((await call('GET', '/guard', { as: guard })).data.helpTasks).toEqual([]);

    await expect(reviewEvent(db, staff, mine.id, { falseAlarm: false, note: 'Real flood.' }, min(30, t))).rejects.toMatchObject({ code: 'EVENT_OPEN' });
    await recordLevel(db, { zoneId: zone, levelPct: 20, actor: staff }, min(60, t));
    await reviewEvent(db, staff, mine.id, { falseAlarm: false, note: 'Real flood after 80 mm of rain.' }, min(70, t));

    const report = await eventReport(db, staff, mine.id, min(80, t));
    expect(report).toMatchObject({ durationMin: 60, warningLeadMin: 12, smsSimulated: 1, help: { tasks: 1, reached: 1, avg_reach_min: 26 } });
    expect(report.event).toMatchObject({ peak_status: 'DANGER', peak_level_pct: 95, false_alarm: false });
    expect(report.checkins).toMatchObject({ residents: 1, safe: 1, within_30: 1, within30Pct: 100 });
    expect(JSON.stringify(report)).not.toContain(resident.fullName); // a printable report names nobody

    const tiles = await floodInsights(db, w2.townshipId, min(90, t));
    expect(tiles).toMatchObject({ warningLeadMin: 12, falseAlarmPct: 0, reachPriorityMin: 26 });
  });
});

describe('The source on every warning (Appendix E.1)', () => {
  it('shows the signals that agreed on the takeover, the Banjir page and the public status page', async () => {
    const { zone, resident } = await makeZone();
    const s = await sensor(zone);
    const t = min(600);
    await simulateSignal(db, w.staff, zone, { source: 'RAIN', rainMmHr: 5 }, t); // light rain: does not back a warning
    await send(s, zone, 160, sec(10, t)); // 80%
    await send(s, zone, 162, sec(25, t)); // and it holds
    await simulateSignal(db, w.staff, zone, { source: 'CAMERA', pictureId: 'day-78' }, sec(40, t));
    expect(await zoneStatus(zone)).toBe('WARNING');
    clock.now = sec(45, t);

    const alerts = await call('GET', '/alerts/active', { as: resident });
    expect(alerts.data).toMatchObject([{ zone_id: zone, sources: ['SENSOR', 'CAMERA'] }]);
    expect(alerts.data[0]).not.toHaveProperty('signals'); // the raw signals stay on the server
    const page = await call('GET', '/banjir', { as: resident });
    expect(page.data.zones.find((z: { id: string }) => z.id === zone)).toMatchObject({ sources: ['SENSOR', 'CAMERA'] });
    const pub = await call('GET', '/public/flood-status');
    const zones = pub.data.flatMap((x: { zones: unknown[] }) => x.zones) as { id: string; sources: unknown }[];
    expect(zones.find((z) => z.id === zone)?.sources).toEqual(['SENSOR', 'CAMERA']);

    // The duty officer setting the level by hand is the source; back to normal, no source is shown.
    await recordLevel(db, { zoneId: zone, levelPct: 95, actor: w.staff }, min(2, t));
    expect((await call('GET', '/alerts/active', { as: resident })).data[0].sources).toEqual(['MANUAL']);
    await recordLevel(db, { zoneId: zone, levelPct: 10, actor: w.staff }, min(5, t));
    expect((await call('GET', '/banjir', { as: resident })).data.zones.find((z: { id: string }) => z.id === zone).sources).toBeNull();
  });

  it('falls back to every trusted signal when none reached the level, and never lists an untrusted one', () => {
    const signals = [
      { source: 'SENSOR', level: 'NORMAL', trusted: true },
      { source: 'RAIN', level: 'NORMAL', trusted: true },
      { source: 'CAMERA', level: 'NORMAL', trusted: false },
    ];
    expect(messageSources('WARNING', signals)).toEqual(['SENSOR', 'RAIN']);
    expect(messageSources('NORMAL', signals)).toEqual(['SENSOR', 'RAIN']);
    expect(messageSources(null, signals)).toEqual([]);
    expect(messageSources('DANGER', 'not a list')).toEqual([]);
  });
});

describe('The simulator uses the real path', () => {
  it('turns the console slider into signed readings from simulated sensors, and keeps them reporting', async () => {
    const { zone } = await makeZone();
    const t = min(600);
    const s = await registerSensor(db, w.staff, { zoneId: zone, code: `SIM-${++n}`, kind: 'ULTRASONIC', site: 'LAKE_EDGE', baseCm: 10, overflowCm: 110, simulated: true }, t);
    await simulateSignal(db, w.staff, zone, { source: 'SENSOR', levelPct: 80 }, sec(1, t));
    const reading = await one<{ signature: string; level_pct: number }>(db, 'SELECT signature, level_pct FROM flood_readings WHERE sensor_id = $1 ORDER BY created_at DESC LIMIT 1', [s.id]);
    expect(reading!.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.abs(reading!.level_pct - 80)).toBeLessThanOrEqual(1);
    // Above the warning line the sensor reports every 15 seconds; the second reading confirms the first.
    await runAgentClock(db, sec(17, t));
    expect(await draftOf(zone)).toMatchObject({ level: 'WARNING' });
    const listed = (await listSensors(db, w.staff, sec(20, t))).find((x) => x.id === s.id)!;
    expect(listed).toMatchObject({ health: 'OK', simulated: true });
  });
});

describe('Clean-up', () => {
  it('summarises raw readings by day and deletes them after 90 days', async () => {
    const { zone } = await makeZone();
    const s = await sensor(zone);
    const old = new Date(T0.getTime() - 100 * 86_400_000);
    await db.query(`INSERT INTO flood_readings (zone_id, level_pct, source, created_at, sensor_id, level_cm) VALUES ($1, 30, 'SENSOR', $2, $3, 60), ($1, 50, 'SENSOR', $4, $3, 100)`, [zone, old, s.id, sec(60, old)]);
    const result = await runJob(db, 'cleanup', T0);
    expect(result.floodReadingsDeleted).toBeGreaterThanOrEqual(2);
    expect(await one(db, 'SELECT readings, min_pct, max_pct FROM flood_readings_daily WHERE sensor_id = $1', [s.id])).toEqual({ readings: 2, min_pct: 30, max_pct: 50 });
  });
});
