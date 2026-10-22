import { randomInt } from 'node:crypto';
import { shortAddress, type HomeAddress } from '@/shared/domain';
import type { Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { createIncident } from '../incidents/engine';
import { notify } from '../notifications';
import { HOME_ADDRESS_COLUMNS } from '../townships';
import { getSettings } from '../settings';
import { getPolicy, guardsOf, inQuietHours, staffOf, WEEK_MS } from '../lockers/core';
import { emailShelfArrival, emailShelfReminder } from '../email/parcels';

/**
 * Parcels at the guardhouse (the brief's "secure parcel collection").
 *
 * The guard logs each parcel with its courier, shelf and a photo. The household
 * is told at once and gets a six-digit, one-time collection code that only they
 * see: the guard never knows it until it is shown to them. At handover the guard
 * checks the code and the photo, and the household is told who collected it, so
 * a wrong handover is noticed the same day.
 *
 * The same rules as smart locker parcels kept at the guardhouse: overdue after
 * the township's collection period, a reminder once a week from then, the guard
 * asked to call after the call period, notes, and never sent back by itself.
 * Every action is kept in the parcel's history (guard_parcel_events).
 */

const DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const daysSince = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));

/** One entry in a shelf parcel's history. */
export async function shelfEvent(q: Queryable, parcelId: string, kind: 'LOGGED' | 'REMINDER' | 'OVERDUE' | 'CALL_REQUESTED' | 'NOTE' | 'COLLECTED' | 'RETURNED' | 'PROBLEM', body: string | null, actorId: string | null, at: Date) {
  await q.query('INSERT INTO guard_parcel_events (parcel_id, kind, body, actor_id, at) VALUES ($1, $2, $3, $4, $5)', [parcelId, kind, body?.slice(0, 500) ?? null, actorId, at]);
}
/** Collected and returned parcels are deleted after this many days, with their photos. */
export const PARCEL_RETENTION_DAYS = 90;

async function household(q: Queryable, homeId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE home_id = $1 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
    [homeId],
  );
  return rows.map((r) => r.id);
}

export interface ParcelInput {
  homeId: string;
  courier: string;
  trackingNo?: string;
  shelf: string;
  note?: string;
  photo?: Photo;
}

/** The guard logs a parcel. The household is told where it is and how to collect it. */
export async function logParcel(db: Db, actor: Actor, input: ParcelInput, now: Date) {
  const townshipId = townshipOf(actor);
  return db.tx(async (tx) => {
    const home = await one<HomeAddress & { id: string }>(tx, `SELECT h.id, ${HOME_ADDRESS_COLUMNS} FROM homes h WHERE h.id = $1 AND h.township_id = $2`, [input.homeId, townshipId]);
    if (!home) throw notFound('Home');
    let photoId: string | null = null;
    if (input.photo) {
      const upload = await one<{ id: string }>(tx, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [
        actor.id, input.photo.mime, input.photo.bytes.length, Buffer.from(input.photo.bytes),
      ]);
      photoId = upload!.id;
    }
    const shelf = input.shelf.trim().toUpperCase();
    // A code unique among the township's waiting parcels; retried on the rare clash.
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO parcels (township_id, home_id, courier, tracking_no, shelf, note, photo_id, code, logged_by, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (township_id, code) WHERE status = 'WAITING' DO NOTHING RETURNING id`,
        [townshipId, home.id, input.courier.trim(), input.trackingNo?.trim().toUpperCase() || null, shelf, input.note?.trim() || null, photoId, code, actor.id, now],
      );
      if (!row) continue;
      await shelfEvent(tx, row.id, 'LOGGED', `Logged at the guardhouse on shelf ${shelf}`, actor.id, now);
      const people = await household(tx, home.id);
      await notify(tx, people, {
        title: `Parcel from ${input.courier.trim()} at the guardhouse`,
        body: `Shelf ${shelf}. Show code ${code} to collect it.`,
        link: `/app/parcels?tab=guardhouse&parcel=${row.id}`,
        dedupeKey: `guard-ready:${row.id}`,
      });
      const policy = await getPolicy(tx, townshipId, null);
      await emailShelfArrival(tx, people, { id: row.id, courier: input.courier.trim(), shelf, overdueAfterDays: policy.overflow_collect_days, at: now });
      return { id: row.id, house: shortAddress(home), notified: people.length };
    }
    throw conflict('TRY_AGAIN', 'Please try again.');
  });
}

interface ParcelRow extends HomeAddress {
  id: string;
  courier: string;
  tracking_no: string | null;
  shelf: string;
  note: string | null;
  photo_id: string | null;
  code: string;
  status: 'WAITING' | 'COLLECTED' | 'RETURNED';
  logged_at: Date;
  collected_at: Date | null;
  collected_by_name: string | null;
  problem_at: Date | null;
  reminded_at: Date | null;
  overdue_at: Date | null;
  call_requested_at: Date | null;
}

const PARCEL_SELECT = `
  SELECT p.id, p.courier, p.tracking_no, p.shelf, p.note, p.photo_id, p.code, p.status, p.logged_at, p.collected_at,
         p.collected_by_name, p.problem_at, p.reminded_at, p.overdue_at, p.call_requested_at, ${HOME_ADDRESS_COLUMNS}
    FROM parcels p JOIN homes h ON h.id = p.home_id`;

/** The household's parcels: waiting ones with their code, and the last 30 days of collected ones. */
export async function myParcels(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<ParcelRow>(
    `${PARCEL_SELECT}
      WHERE p.home_id = $1 AND (p.status = 'WAITING' OR p.logged_at > $2::timestamptz - interval '30 days')
      ORDER BY (p.status = 'WAITING') DESC, p.logged_at DESC LIMIT 50`,
    [resident.homeId, now],
  );
  return {
    parcels: rows.map((p) => ({
      id: p.id,
      courier: p.courier,
      trackingNo: p.tracking_no,
      shelf: p.shelf,
      note: p.note,
      hasPhoto: p.photo_id !== null,
      status: p.status,
      // The code only matters while the parcel is waiting.
      code: p.status === 'WAITING' ? p.code : null,
      loggedAt: p.logged_at,
      collectedAt: p.collected_at,
      collectedBy: p.collected_by_name,
      problemReported: p.problem_at !== null,
      // How long it has waited (or waited, once it left), and whether it went past the collection period.
      days: daysSince(p.logged_at, p.collected_at ?? now),
      overdue: p.overdue_at !== null,
    })),
  };
}

const GATE_ROLES = ['GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'];

/** The parcel's photo: for its household and for the gate. */
export async function parcelPhoto(db: Db, actor: Actor, id: string): Promise<Response> {
  const p = await one<{ home_id: string; township_id: string; photo_id: string | null }>(db, 'SELECT home_id, township_id, photo_id FROM parcels WHERE id = $1', [id]);
  const allowed = p && (GATE_ROLES.includes(actor.role) ? actor.role === 'HQ_ADMIN' || p.township_id === actor.townshipId : actor.homeId === p.home_id && actor.residencyStatus === 'VERIFIED');
  if (!allowed || !p.photo_id) throw notFound('Photo');
  const upload = await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [p.photo_id]);
  if (!upload) throw notFound('Photo');
  return new Response(Buffer.from(upload.bytes), {
    headers: { 'Content-Type': upload.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600' },
  });
}

/** A scanned QR reads "KITAPARCEL:123456"; a typed code is just the six digits. */
export const normaliseParcelCode = (input: string) => input.trim().toUpperCase().replace(/^KITAPARCEL:/, '').replace(/\s+/g, '');

/** The guard checks the code the resident shows, and sees which parcel and shelf it is. */
export async function checkParcelCode(db: Db, actor: Actor, rawCode: string) {
  const code = normaliseParcelCode(rawCode);
  if (!/^\d{6}$/.test(code)) throw ruleViolation('PARCEL_CODE', 'A collection code has six digits.');
  const p = await one<ParcelRow>(db, `${PARCEL_SELECT} WHERE p.township_id = $1 AND p.code = $2 AND p.status = 'WAITING'`, [townshipOf(actor), code]);
  if (!p) throw notFound('Parcel');
  return { id: p.id, house: shortAddress(p), courier: p.courier, trackingNo: p.tracking_no, shelf: p.shelf, note: p.note, hasPhoto: p.photo_id !== null, loggedAt: p.logged_at };
}

/**
 * Handover. The code must be shown again here, so a parcel can only leave the
 * guardhouse against its own code, and the code stops working at once.
 */
export async function handOverParcel(db: Db, actor: Actor, id: string, input: { code: string; collectedBy?: string }, now: Date) {
  const townshipId = townshipOf(actor);
  return db.tx(async (tx) => {
    const p = await one<{ home_id: string; status: string; code: string; courier: string; logged_at: Date; overdue_at: Date | null }>(
      tx, 'SELECT home_id, status, code, courier, logged_at, overdue_at FROM parcels WHERE id = $1 AND township_id = $2 FOR UPDATE', [id, townshipId],
    );
    if (!p) throw notFound('Parcel');
    if (p.status !== 'WAITING') throw conflict('PARCEL_GONE', 'This parcel has already left the guardhouse.');
    if (normaliseParcelCode(input.code) !== p.code) throw ruleViolation('PARCEL_CODE', 'The code does not match this parcel.');
    const by = input.collectedBy?.trim() || null;
    await tx.query(
      `UPDATE parcels SET status = 'COLLECTED', collected_at = $2, handed_over_by = $3, collected_by_name = $4 WHERE id = $1`,
      [id, now, actor.id, by],
    );
    const days = daysSince(p.logged_at, now);
    await shelfEvent(tx, id, 'COLLECTED', `Handed over against the collection code${by ? ` to ${by}` : ''}; collected after ${plural(days, 'day')}${p.overdue_at ? ', overdue' : ''}`, actor.id, now);
    await notify(tx, await household(tx, p.home_id), {
      title: `Parcel from ${p.courier} collected`,
      body: by ? `Collected by ${by}. Not you? Tell us in SimeTown.` : 'Not you? Tell us in SimeTown.',
      link: `/app/parcels?tab=guardhouse&parcel=${id}`,
      dedupeKey: `guard-collected:${id}`,
    });
    return { ok: true, days };
  });
}

/**
 * Back to the courier, only when the household or the courier asks: a parcel is never sent back just for waiting.
 * The reason is kept in its history.
 */
export async function returnParcel(db: Db, actor: Actor, id: string, reason: string, now: Date) {
  const why = reason.trim();
  if (why.length < 3) throw ruleViolation('REASON_NEEDED', 'Say who asked for it to go back, and why.', { fields: { reason: 'Say who asked for it to go back, and why.' } });
  const townshipId = townshipOf(actor);
  return db.tx(async (tx) => {
    const p = await one<{ home_id: string; courier: string }>(
      tx, `UPDATE parcels SET status = 'RETURNED', collected_at = $3, handed_over_by = $4, returned_reason = $5 WHERE id = $1 AND township_id = $2 AND status = 'WAITING' RETURNING home_id, courier`,
      [id, townshipId, now, actor.id, why.slice(0, 300)],
    );
    if (!p) throw notFound('Parcel');
    await shelfEvent(tx, id, 'RETURNED', `Returned to the courier: ${why}`, actor.id, now);
    await notify(tx, await household(tx, p.home_id), { title: `Parcel from ${p.courier} returned to the courier`, body: 'Contact the courier to arrange delivery again.', link: `/app/parcels?tab=guardhouse&parcel=${id}`, dedupeKey: `guard-returned:${id}` });
    await audit(tx, actor.id, 'PARCEL_RETURNED', 'parcel', id, { reason: why });
    return { ok: true };
  });
}

/** Guards and staff add a note to a shelf parcel's history, for example after calling the household. */
export async function addShelfNote(db: Db, actor: Actor, id: string, body: string, now: Date) {
  const text = body.trim();
  if (!text) throw ruleViolation('NOTE_EMPTY', 'Write the note first.', { fields: { body: 'Write the note first.' } });
  const p = await one<{ township_id: string }>(db, 'SELECT township_id FROM parcels WHERE id = $1', [id]);
  if (!p || (actor.role !== 'HQ_ADMIN' && p.township_id !== actor.townshipId)) throw notFound('Parcel');
  await shelfEvent(db, id, 'NOTE', text, actor.id, now);
  await audit(db, actor.id, 'PARCEL_NOTE', 'parcel', id);
  return { ok: true };
}

/** The household says a parcel marked collected never reached them. Staff look into it the same day. */
export async function reportParcelProblem(db: Db, actor: Actor, id: string, note: string | undefined, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const p = await one<{ status: string; problem_at: Date | null; courier: string; shelf: string }>(
      tx, 'SELECT status, problem_at, courier, shelf FROM parcels WHERE id = $1 AND home_id = $2 FOR UPDATE', [id, resident.homeId],
    );
    if (!p) throw notFound('Parcel');
    if (p.status !== 'COLLECTED') throw ruleViolation('PARCEL_NOT_COLLECTED', 'Only a parcel marked collected can be reported missing.');
    if (p.problem_at) throw conflict('ALREADY_REPORTED', 'You have already told us about this parcel.');
    await tx.query('UPDATE parcels SET problem_at = $2, problem_note = $3 WHERE id = $1', [id, now, note?.trim() || null]);
    await shelfEvent(tx, id, 'PROBLEM', `The household said this parcel never reached them${note?.trim() ? `: ${note.trim()}` : ''}`, resident.id, now);
    // A township case: the guard's handover record is the township's to check. Urgent, so staff are told at once.
    await createIncident(tx, {
      townshipId: resident.townshipId, module: 'PARCELS', category: 'COLLECTION_DISPUTE', responsibility: 'MIXED', priority: 'HIGH', reporterId: resident.id, homeId: resident.homeId,
      guardParcelId: id, description: note?.trim() || null, summary: `I didn’t collect this (${p.courier}, shelf ${p.shelf}).`, dedupeKey: `report:${resident.homeId}:guard:${id}:NOT_COLLECTED`,
      residentMessage: 'We are checking the guardhouse’s handover record. We will tell you what we find.',
    }, now);
    await audit(tx, resident.id, 'PARCEL_PROBLEM', 'parcel', id);
    return { ok: true };
  });
}

/** The guardhouse shelf: every parcel still waiting, oldest first. */
export async function guardParcels(db: Db, actor: Actor, now: Date) {
  const rows = await db.query<ParcelRow>(
    `${PARCEL_SELECT} WHERE p.township_id = $1 AND p.status = 'WAITING' ORDER BY p.logged_at LIMIT 200`,
    [townshipOf(actor)],
  );
  return {
    waiting: rows.map((p) => ({
      id: p.id, house: shortAddress(p), courier: p.courier, trackingNo: p.tracking_no, shelf: p.shelf, hasPhoto: p.photo_id !== null,
      loggedAt: p.logged_at, days: daysSince(p.logged_at, now), overdue: p.overdue_at !== null, callRequested: p.call_requested_at !== null,
    })),
  };
}

/**
 * The brief's test for secure parcel collection: faster retrieval and fewer
 * collection errors. Retrieval is the time from logging to handover; an error
 * is a handover the household says never reached them.
 */
export async function parcelStats(db: Db, actor: Actor, now: Date) {
  const s = await one<{ waiting: number; overdue: number; collected: number; returned: number; median_hours: number | null; same_day: number; problems: number }>(
    db,
    `SELECT count(*) FILTER (WHERE status = 'WAITING')::int AS waiting,
            count(*) FILTER (WHERE status = 'WAITING' AND overdue_at IS NOT NULL)::int AS overdue,
            count(*) FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days')::int AS collected,
            count(*) FILTER (WHERE status = 'RETURNED' AND collected_at > $2::timestamptz - interval '30 days')::int AS returned,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM collected_at - logged_at) / 3600)
              FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days'))::numeric, 1)::float AS median_hours,
            count(*) FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days' AND collected_at - logged_at < interval '24 hours')::int AS same_day,
            count(*) FILTER (WHERE problem_at > $2::timestamptz - interval '30 days')::int AS problems
       FROM parcels WHERE ($1::uuid IS NULL OR township_id = $1)`,
    [actor.townshipId, now],
  );
  const problems = await db.query<ParcelRow & { problem_note: string | null }>(
    `${PARCEL_SELECT.replace('p.reminded_at,', 'p.reminded_at, p.problem_note,')}
      WHERE ($1::uuid IS NULL OR p.township_id = $1) AND p.problem_at > $2::timestamptz - interval '30 days' ORDER BY p.problem_at DESC LIMIT 20`,
    [actor.townshipId, now],
  );
  const t = s!;
  return {
    waiting: t.waiting,
    overdue: t.overdue,
    collected30d: t.collected,
    returned30d: t.returned,
    medianHoursToCollect: t.median_hours,
    sameDayPct: t.collected ? Math.round((t.same_day / t.collected) * 100) : null,
    problems30d: t.problems,
    errorRatePct: t.collected ? Math.round((t.problems / t.collected) * 1000) / 10 : null,
    problemList: problems.map((p) => ({ id: p.id, house: shortAddress(p), courier: p.courier, shelf: p.shelf, collectedAt: p.collected_at, collectedBy: p.collected_by_name, note: p.problem_note, reportedAt: p.problem_at })),
  };
}

/**
 * Run every few minutes (the parcel-reminders and lockers jobs): the guardhouse rules for shelf parcels, the same
 * as for locker parcels kept there. A parcel becomes overdue once, at the collection period; from then the
 * household is reminded once a week (never in quiet hours); at the call period the guards and staff are asked once
 * to call. Nothing is ever sent back. Safe to run again at any time.
 */
export async function runShelfRules(db: Db, now: Date) {
  const counts = { overdue: 0, reminders: 0, calls: 0 };
  const tz = (await getSettings(db)).timezone;
  const waiting = await db.query<{ id: string; township_id: string }>(`SELECT id, township_id FROM parcels WHERE status = 'WAITING'`);
  const policies = new Map<string, Awaited<ReturnType<typeof getPolicy>>>();
  for (const { id, township_id } of waiting) {
    if (!policies.has(township_id)) policies.set(township_id, await getPolicy(db, township_id, null));
    const policy = policies.get(township_id)!;
    const quiet = inQuietHours(policy, now, tz);
    await db.tx(async (tx) => {
      const p = await one<{ home_id: string; courier: string; shelf: string; tracking_no: string | null; logged_at: Date; overdue_at: Date | null; last_reminder_at: Date | null; call_requested_at: Date | null; status: string }>(
        tx, 'SELECT home_id, courier, shelf, tracking_no, logged_at, overdue_at, last_reminder_at, call_requested_at, status FROM parcels WHERE id = $1 FOR UPDATE', [id],
      );
      if (!p || p.status !== 'WAITING') return;
      const days = daysSince(p.logged_at, now);
      let overdueAt = p.overdue_at;
      if (!overdueAt && now.getTime() >= p.logged_at.getTime() + policy.overflow_collect_days * DAY) {
        overdueAt = now;
        await tx.query('UPDATE parcels SET overdue_at = $2 WHERE id = $1', [id, now]);
        await shelfEvent(tx, id, 'OVERDUE', `Overdue: not collected within ${plural(policy.overflow_collect_days, 'day')}`, null, now);
        counts.overdue++;
      }
      if (overdueAt && !quiet) {
        const due = p.last_reminder_at && p.last_reminder_at.getTime() >= overdueAt.getTime() ? p.last_reminder_at.getTime() + WEEK_MS : overdueAt.getTime();
        if (now.getTime() >= due) {
          const people = await household(tx, p.home_id);
          await tx.query('UPDATE parcels SET last_reminder_at = $2, reminded_at = COALESCE(reminded_at, $2) WHERE id = $1', [id, now]);
          await shelfEvent(tx, id, 'REMINDER', `Weekly reminder sent to ${people.length} household member(s): uncollected for ${plural(days, 'day')}`, null, now);
          await notify(tx, people, {
            title: `Reminder: your parcel from ${p.courier} is waiting at the guardhouse`,
            body: `It has been on shelf ${p.shelf} for ${plural(days, 'day')}. Please collect it when you can.`,
            link: `/app/parcels?tab=guardhouse&parcel=${id}`,
            dedupeKey: `guard-reminder:${id}:${now.toISOString().slice(0, 10)}`,
          });
          await emailShelfReminder(tx, people, { id, courier: p.courier, shelf: p.shelf, trackingNo: p.tracking_no, loggedAt: p.logged_at, days, now });
          counts.reminders++;
        }
      }
      if (!p.call_requested_at && now.getTime() >= p.logged_at.getTime() + policy.counter_call_after_days * DAY) {
        await tx.query('UPDATE parcels SET call_requested_at = $2 WHERE id = $1', [id, now]);
        await shelfEvent(tx, id, 'CALL_REQUESTED', `The guard was asked to call the household: uncollected for ${plural(days, 'day')}`, null, now);
        const call = {
          title: 'Please call a household about a parcel',
          body: `A parcel from ${p.courier} has been on shelf ${p.shelf} at the guardhouse for ${plural(days, 'day')}. Call the household, then add a note to the parcel.`,
        };
        await notify(tx, await guardsOf(tx, township_id), { ...call, link: '/guard/parcels', dedupeKey: `guard-call:${id}` });
        await notify(tx, await staffOf(tx, township_id), { ...call, link: '/console/operations?tab=guardhouse', dedupeKey: `guard-call:${id}` });
        counts.calls++;
      }
    });
  }
  return counts;
}

/** Part of the daily cleanup: parcels that left the guardhouse long ago, and their photos. */
export async function deleteOldParcels(q: Queryable, now: Date): Promise<number> {
  const gone = await q.query<{ photo_id: string | null }>(
    `DELETE FROM parcels WHERE status <> 'WAITING' AND collected_at < $1::timestamptz - make_interval(days => $2) RETURNING photo_id`,
    [now, PARCEL_RETENTION_DAYS],
  );
  const photos = gone.map((g) => g.photo_id).filter((id): id is string => id !== null);
  if (photos.length) await q.query('DELETE FROM uploads WHERE id = ANY($1::uuid[])', [photos]);
  return gone.length;
}
