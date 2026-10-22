import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '@/server/auth/session';
import { one, type Db } from '@/server/db/client';
import { renderEmail } from '@/server/modules/email/layout';
import { cleanupEmails, sendQueuedEmails, setMailerForTests, type Mailer } from '@/server/modules/email/outbox';
import { setEmailPreferences } from '@/server/modules/identity/service';
import { createStation, simulateClose, simulatorEvent } from '@/server/modules/lockers/admin';
import { myLockerParcels } from '@/server/modules/lockers/collection';
import { applyAsCourier, approveCourier, createCompany } from '@/server/modules/lockers/couriers';
import { chooseCounter, receiveAtCounter, registerParcel, reserveAndOpen } from '@/server/modules/lockers/delivery';
import { createOverflow, runExpiry } from '@/server/modules/lockers/overflow';
import { T0, at, freshDb, makeResident, makeWorld, type World } from './helpers';

/** Parcel emails: queued with the event, in the resident's language, sent later by the job, never with a code. */

let db: Db;
let w: World;
let courier: Actor;
let station: { id: string; code: string };
let counterId: string;
const key = () => randomUUID();
const H = 3_600_000;

const outbox = (userId: string) => db.query<{ kind: string; subject: string; html: string | null; body_text: string | null; status: string; attempts: number; last_error: string | null }>(
  'SELECT kind, subject, html, body_text, status, attempts, last_error FROM email_outbox WHERE user_id = $1 ORDER BY id', [userId],
);

async function resident(opts: { email?: string; language?: 'en' | 'ms' } = {}) {
  const r = await makeResident(w);
  await db.query('UPDATE users SET email = $2, language = $3 WHERE id = $1', [r.id, opts.email ?? `r-${randomUUID().slice(0, 8)}@simetown.my`, opts.language ?? 'en']);
  return r;
}

async function deposit(r: Actor, now = T0) {
  const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: `JT${randomUUID().slice(0, 10).replace(/-/g, '')}`.toUpperCase(), size: 'S', recipient: { memberCode: r.memberCode! } }, now);
  const opened = await reserveAndOpen(db, courier, reg.id, key(), now);
  if (opened.kind !== 'OPENING') throw new Error('No door');
  await simulateClose(db, courier, reg.id, true, now);
  return { id: reg.id, door: opened.compartment };
}

beforeAll(async () => {
  db = await freshDb();
  w = await makeWorld(db);
  const companyId = (await createCompany(db, w.hq, 'J&T Express')).id;
  station = await createStation(db, w.admin, { name: 'Locker A', location: 'Main gate', layout: { S: 20 }, adapter: 'SIMULATED', hasDoorSensor: true, hasPresenceSensor: true });
  counterId = (await createOverflow(db, w.admin, { name: 'Main guardhouse', kind: 'COUNTER', location: 'Main gate', openFromHour: 8, openToHour: 22, instructions: 'Show your pickup code and your IC or passport.', capacity: 100, acceptsDeliveries: true })).id;
  const { id } = await applyAsCourier(db, { townshipId: w.townshipId, companyId, fullName: 'Ali Courier', email: 'courier@email.test', phone: '+60123456789', password: 'courier-password-1' }, T0);
  await approveCourier(db, w.admin, id, [station.id], T0);
  courier = toActor((await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE u.id = $1`, [id]))!);
});
afterEach(() => setMailerForTests(undefined));
afterAll(() => db.close());

describe('The email frame', () => {
  it('escapes every value, attaches the logo by id, and gives a plain-text part with the link', () => {
    const email = renderEmail({
      lang: 'en', subject: 'Your parcel is ready in your locker', preheader: 'x', bandLabel: 'Parcel lockers', heading: 'Your parcel is ready in your locker',
      firstName: '<b>Aisyah</b>', intro: 'your parcel from J&T Express has been delivered to your private locker door.',
      facts: [{ label: 'Tracking no.', value: '<script>alert(1)</script>' }], action: { label: 'Get my pickup code', url: 'https://simetown.my/app/parcels' }, footer: 'x',
    });
    expect(email.html).toContain('src="cid:simetown-mark"');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;Aisyah&lt;/b&gt;');
    expect(email.html).toContain('J&amp;T Express');
    expect(email.text).toContain('Get my pickup code: https://simetown.my/app/parcels');
    expect(() => renderEmail({ lang: 'en', subject: 's', preheader: 'p', bandLabel: 'b', heading: 'h', firstName: null, intro: 'i', facts: [], action: { label: 'a', url: 'javascript:alert(1)' }, footer: 'f' })).toThrow();
  });
});

describe('Parcel emails', () => {
  it('queue one email per person when a parcel is in the door, in their own language, and never with the pickup code', async () => {
    const r = await resident();
    const housemate = await makeResident(w, { homeId: r.homeId! });
    await db.query(`UPDATE users SET email = 'housemate@simetown.my', language = 'ms' WHERE id = $1`, [housemate.id]);
    const { id, door } = await deposit(r);
    const [mine] = await outbox(r.id);
    expect(mine).toMatchObject({ kind: 'LOCKER_READY', subject: 'Your parcel is ready in your locker', status: 'QUEUED' });
    expect(mine!.html).toContain(door);
    expect(mine!.html).toContain(`/app/parcels?tab=lockers&amp;parcel=${id}`);
    const code = (await myLockerParcels(db, r, T0)).parcels.find((p) => p.id === id)!;
    expect(mine!.html).not.toContain(code.pin!);
    expect(mine!.body_text).not.toContain(code.pin!);
    expect(mine!.html).not.toContain(code.qr!);
    const [theirs] = await outbox(housemate.id);
    expect(theirs!.subject).toBe('Bungkusan anda sedia di dalam lokar anda');
    expect(theirs!.html).toContain('lang="ms"');
    // The same event never queues twice.
    expect(await outbox(r.id)).toHaveLength(1);
  });

  it('respect a resident who switched parcel emails off, but always send a security alert', async () => {
    const r = await resident();
    await setEmailPreferences(db, r, { parcels: false });
    const { door } = await deposit(r);
    expect(await outbox(r.id)).toHaveLength(0);
    const comp = (await one<{ id: string }>(db, 'SELECT id FROM locker_compartments WHERE home_id = $1', [r.homeId]))!;
    await simulatorEvent(db, w.staff, station.id, { type: 'DOOR', compartmentId: comp.id, door: 'OPEN', itemPresent: true }, new Date(T0.getTime() + 20 * 60_000));
    const sent = await outbox(r.id);
    expect(sent).toEqual([expect.objectContaining({ kind: 'DOOR_FORCED', subject: 'Security alert: your locker door was opened without a code' })]);
    expect(sent[0]!.html).toContain(door);
    await expect(setEmailPreferences(db, w.staff, { parcels: false })).rejects.toMatchObject({ status: 403 });
  });

  it('tell the household why a parcel is at the counter, and remind weekly once it is overdue', async () => {
    const r = await resident();
    await deposit(r); // the door is now full
    const reg = await registerParcel(db, courier, { stationId: station.id, trackingNo: `JT${randomUUID().slice(0, 10).replace(/-/g, '')}`.toUpperCase(), size: 'S', recipient: { memberCode: r.memberCode! } }, T0);
    expect((await reserveAndOpen(db, courier, reg.id, key(), T0)).kind).toBe('NO_DOOR');
    await chooseCounter(db, courier, reg.id, counterId, T0);
    await receiveAtCounter(db, w.staff, reg.id, T0);
    const counter = (await outbox(r.id)).find((m) => m.kind === 'COUNTER_READY')!;
    expect(counter.subject).toBe('Your parcel is at the guardhouse');
    expect(counter.html).toContain('Your locker door already had a parcel in it.');
    expect(counter.html).toContain('Open daily, 8:00 am – 10:00 pm');
    await runExpiry(db, at(7));
    const reminder = (await outbox(r.id)).find((m) => m.kind === 'COUNTER_REMINDER')!;
    expect(reminder.subject).toBe('Reminder: your parcel has been waiting for 7 days');
    expect(reminder.html).toContain('days uncollected');
  });
});

describe('Sending', () => {
  it('waits while no mail account is set, and skips what waited more than a day', async () => {
    setMailerForTests(null);
    const r = await resident();
    await deposit(r, T0);
    expect(await sendQueuedEmails(db, new Date(T0.getTime() + H))).toMatchObject({ configured: false, sent: 0 });
    expect((await outbox(r.id))[0]!.status).toBe('QUEUED');
    await sendQueuedEmails(db, new Date(T0.getTime() + 25 * H));
    expect((await outbox(r.id))[0]).toMatchObject({ status: 'SKIPPED', html: null });
  });

  it('sends with the logo, never to test addresses, retries a failure and gives up after three tries', async () => {
    const now = at(30);
    const sent: { to: string; logo: boolean; from: string }[] = [];
    let fail = false;
    const mailer: Mailer = { async send(m) { if (fail) throw new Error('421 Try again later'); sent.push({ to: m.to, logo: m.logo !== null, from: m.from }); } };
    setMailerForTests(mailer);
    const real = await resident({ email: 'aisyah@simetown.my' });
    const demo = await resident({ email: 'demo@demo.kita.test' });
    await deposit(real, now);
    await deposit(demo, now);
    const result = await sendQueuedEmails(db, now);
    expect(result).toMatchObject({ configured: true, sent: 1 });
    expect(sent).toEqual([expect.objectContaining({ to: 'aisyah@simetown.my', logo: true })]);
    expect((await outbox(real.id))[0]).toMatchObject({ status: 'SENT' });
    expect((await outbox(demo.id))[0]).toMatchObject({ status: 'SKIPPED', last_error: 'Test address: never sent' });

    fail = true;
    const flaky = await resident({ email: 'flaky@simetown.my' });
    await deposit(flaky, now);
    await sendQueuedEmails(db, now);
    expect((await outbox(flaky.id))[0]).toMatchObject({ status: 'QUEUED', attempts: 1, last_error: '421 Try again later' });
    await sendQueuedEmails(db, new Date(now.getTime() + 11 * 60_000));
    await sendQueuedEmails(db, new Date(now.getTime() + 40 * 60_000));
    expect((await outbox(flaky.id))[0]).toMatchObject({ status: 'FAILED', attempts: 3 });
  });

  it('keeps an email’s words 30 days and its record 180 days', async () => {
    const r = await resident();
    await deposit(r, at(-200));
    await db.query(`UPDATE email_outbox SET status = 'SENT' WHERE user_id = $1`, [r.id]);
    const cleaned = await cleanupEmails(db, T0);
    expect(cleaned.emailsRemoved).toBeGreaterThanOrEqual(1);
    expect(await outbox(r.id)).toHaveLength(0);
  });
});
