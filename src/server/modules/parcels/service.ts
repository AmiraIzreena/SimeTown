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

/**
 * Parcels at the guardhouse (the brief's "secure parcel collection").
 *
 * The guard logs each parcel with its courier, shelf and a photo. The household
 * is told at once and gets a six-digit, one-time collection code that only they
 * see: the guard never knows it until it is shown to them. At handover the guard
 * checks the code and the photo, and the household is told who collected it, so
 * a wrong handover is noticed the same day.
 */

/** Waiting this long earns one reminder. */
export const PARCEL_REMINDER_DAYS = 3;
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
      const people = await household(tx, home.id);
      await notify(tx, people, {
        title: `Parcel from ${input.courier.trim()} at the guardhouse`,
        body: `Shelf ${shelf}. Show code ${code} to collect it.`,
        link: `/app/parcels?tab=guardhouse&parcel=${row.id}`,
        dedupeKey: `guard-ready:${row.id}`,
      });
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
}

const PARCEL_SELECT = `
  SELECT p.id, p.courier, p.tracking_no, p.shelf, p.note, p.photo_id, p.code, p.status, p.logged_at, p.collected_at,
         p.collected_by_name, p.problem_at, p.reminded_at, ${HOME_ADDRESS_COLUMNS}
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
    const p = await one<{ home_id: string; status: string; code: string; courier: string }>(
      tx, 'SELECT home_id, status, code, courier FROM parcels WHERE id = $1 AND township_id = $2 FOR UPDATE', [id, townshipId],
    );
    if (!p) throw notFound('Parcel');
    if (p.status !== 'WAITING') throw conflict('PARCEL_GONE', 'This parcel has already left the guardhouse.');
    if (normaliseParcelCode(input.code) !== p.code) throw ruleViolation('PARCEL_CODE', 'The code does not match this parcel.');
    const by = input.collectedBy?.trim() || null;
    await tx.query(
      `UPDATE parcels SET status = 'COLLECTED', collected_at = $2, handed_over_by = $3, collected_by_name = $4 WHERE id = $1`,
      [id, now, actor.id, by],
    );
    await notify(tx, await household(tx, p.home_id), {
      title: `Parcel from ${p.courier} collected`,
      body: by ? `Collected by ${by}. Not you? Tell us in SimeTown.` : 'Not you? Tell us in SimeTown.',
      link: `/app/parcels?tab=guardhouse&parcel=${id}`,
      dedupeKey: `guard-collected:${id}`,
    });
    return { ok: true };
  });
}

/** Unclaimed for too long, or refused: back to the courier. */
export async function returnParcel(db: Db, actor: Actor, id: string, now: Date) {
  const townshipId = townshipOf(actor);
  return db.tx(async (tx) => {
    const p = await one<{ home_id: string; courier: string }>(
      tx, `UPDATE parcels SET status = 'RETURNED', collected_at = $3, handed_over_by = $4 WHERE id = $1 AND township_id = $2 AND status = 'WAITING' RETURNING home_id, courier`,
      [id, townshipId, now, actor.id],
    );
    if (!p) throw notFound('Parcel');
    await notify(tx, await household(tx, p.home_id), { title: `Parcel from ${p.courier} returned to the courier`, body: 'Contact the courier to arrange delivery again.', link: `/app/parcels?tab=guardhouse&parcel=${id}`, dedupeKey: `guard-returned:${id}` });
    await audit(tx, actor.id, 'PARCEL_RETURNED', 'parcel', id);
    return { ok: true };
  });
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
      loggedAt: p.logged_at, days: Math.floor((now.getTime() - p.logged_at.getTime()) / 86_400_000),
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
            count(*) FILTER (WHERE status = 'WAITING' AND logged_at < $2::timestamptz - make_interval(days => $3))::int AS overdue,
            count(*) FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days')::int AS collected,
            count(*) FILTER (WHERE status = 'RETURNED' AND collected_at > $2::timestamptz - interval '30 days')::int AS returned,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM collected_at - logged_at) / 3600)
              FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days'))::numeric, 1)::float AS median_hours,
            count(*) FILTER (WHERE status = 'COLLECTED' AND collected_at > $2::timestamptz - interval '30 days' AND collected_at - logged_at < interval '24 hours')::int AS same_day,
            count(*) FILTER (WHERE problem_at > $2::timestamptz - interval '30 days')::int AS problems
       FROM parcels WHERE ($1::uuid IS NULL OR township_id = $1)`,
    [actor.townshipId, now, PARCEL_REMINDER_DAYS],
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

/** Daily: one reminder for parcels waiting three days or more. */
export async function sendParcelReminders(db: Db, now: Date): Promise<number> {
  return db.tx(async (tx) => {
    const due = await tx.query<{ id: string; home_id: string; courier: string; shelf: string }>(
      `UPDATE parcels SET reminded_at = $1
        WHERE status = 'WAITING' AND reminded_at IS NULL AND logged_at < $1::timestamptz - make_interval(days => $2)
        RETURNING id, home_id, courier, shelf`,
      [now, PARCEL_REMINDER_DAYS],
    );
    for (const p of due) {
      await notify(tx, await household(tx, p.home_id), {
        title: `Your parcel from ${p.courier} is still waiting`,
        body: `Shelf ${p.shelf} at the guardhouse. Please collect it soon.`,
        link: `/app/parcels?tab=guardhouse&parcel=${p.id}`,
        dedupeKey: `parcel-reminder:${p.id}`,
      });
    }
    return due.length;
  });
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
