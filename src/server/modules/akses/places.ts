import { ADMINS, STAFF, type PlaceKind } from '@/shared/domain';
import { isLikelyDuplicate, type Verification } from '@/shared/akses';
import type { Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { recordAction, rewardUserById } from '../rewards';
import { getAccessPolicy } from './config';
import { appendAccessEvent, refreshAvailability } from './incidents';

/**
 * The accessible-places directory. A verified place stays listed and verified
 * without anyone re-confirming it: it is inspected on a risk-based schedule,
 * and a temporary obstruction changes only its availability. A resident's
 * suggestion is checked for duplicates and waits for an inspection; it never
 * becomes verified on the resident's word. Places are archived, never deleted,
 * so their history stays.
 */

export interface PlaceInput { name: string; kind: PlaceKind; location: string; note?: string }

const isStaff = (actor: Actor) => STAFF.includes(actor.role);

/**
 * The directory. Everyone sees each place's verification and availability
 * separately, and the open problem behind a "blocked" (its stage, never who
 * reported it). Residents also see whether they follow the place and whether
 * a claimed fix is waiting for their answer.
 */
export async function listPlaces(db: Db, actor: Actor, options: { archived?: boolean } = {}) {
  const townshipId = townshipOf(actor);
  const staff = isStaff(actor);
  return db.query(
    `SELECT p.id, p.name, p.kind, p.location, p.note, p.verification, p.availability, p.availability_changed_at, p.verified_at AS last_verified_at,
            p.next_inspection_at, p.archived_at, p.updated_at, p.created_at, pa.name AS party_name, pa.id AS party_id, pa.integration AS party_integration,
            EXISTS (SELECT 1 FROM access_place_follows f WHERE f.place_id = p.id AND f.user_id = $2) AS following,
            CASE WHEN $3 THEN p.duplicate_of END AS duplicate_of,
            CASE WHEN $3 THEN (SELECT full_name FROM users WHERE id = p.reported_by) END AS suggested_by,
            coalesce((SELECT json_agg(json_build_object(
                      'reference', i.reference, 'category', i.category, 'status', i.status, 'priority', i.priority, 'blocks', i.blocks_access,
                      'reporters', i.reporter_count, 'since', i.created_at, 'confirmed', i.confirmed_at IS NOT NULL,
                      'mine', EXISTS (SELECT 1 FROM access_reports r WHERE r.incident_id = i.id AND r.reporter_id = $2),
                      'can_confirm', i.status IN ('VERIFICATION_PENDING', 'ESCALATED') AND i.resolution_submitted_at IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM access_resolutions rs JOIN access_confirmations c ON c.resolution_id = rs.id
                                         WHERE rs.incident_id = i.id AND rs.outcome = 'PENDING' AND c.user_id = $2)
                    ) ORDER BY i.created_at)
                FROM access_incidents i WHERE i.place_id = p.id AND i.status <> 'RESOLVED'), '[]') AS incidents
       FROM access_places p LEFT JOIN access_parties pa ON pa.id = p.party_id
      WHERE p.township_id = $1 AND (p.archived_at IS NULL) = NOT $4
      ORDER BY p.availability IN ('CONFIRMED_BLOCKED', 'REPORTED_BLOCKED') DESC, p.verification = 'VERIFIED' DESC, p.kind, p.name`,
    [townshipId, actor.id, staff, Boolean(options.archived) && staff],
  );
}

async function likelyDuplicate(q: Queryable, townshipId: string, input: PlaceInput, exceptId?: string) {
  const others = await q.query<{ id: string; name: string; kind: string; location: string }>(
    'SELECT id, name, kind, location FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND kind = $2 AND id IS DISTINCT FROM $3', [townshipId, input.kind, exceptId ?? null],
  );
  return others.find((o) => isLikelyDuplicate(input, o)) ?? null;
}

/** A resident suggests a place. It is listed as "pending verification" and goes to the verification queue; a likely duplicate is flagged, not merged blindly. */
export async function suggestPlace(db: Db, actor: Actor, input: PlaceInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const dup = await likelyDuplicate(tx, resident.townshipId, input);
    if (dup && (await one(tx, 'SELECT 1 FROM access_places WHERE id = $1 AND reported_by = $2', [dup.id, resident.id]))) {
      throw conflict('ALREADY_SUGGESTED', `You already suggested “${dup.name}”.`);
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO access_places (township_id, name, kind, location, note, verification, availability, duplicate_of, reported_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_VERIFICATION', 'UNKNOWN', $6, $7, $8, $8) RETURNING id`,
      [resident.townshipId, input.name, input.kind, input.location, input.note ?? null, dup?.id ?? null, resident.id, now],
    );
    return { id: row!.id, possibleDuplicate: dup ? { id: dup.id, name: dup.name } : null };
  });
}

/** Staff add a place they have checked themselves: verified at once, with that check as its first inspection. */
export async function createPlace(db: Db, actor: Actor, input: PlaceInput & { partyId?: string | null }, now: Date) {
  if (!isStaff(actor)) throw forbidden();
  const townshipId = townshipOf(actor);
  return db.tx(async (tx) => {
    if (await one(tx, 'SELECT 1 FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND lower(name) = lower($2) AND kind = $3', [townshipId, input.name, input.kind])) {
      throw conflict('PLACE_EXISTS', 'This place is already listed.');
    }
    if (input.partyId && !(await one(tx, 'SELECT 1 FROM access_parties WHERE id = $1 AND township_id = $2', [input.partyId, townshipId]))) throw notFound('Organisation');
    const policy = await getAccessPolicy(tx, townshipId);
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO access_places (township_id, name, kind, location, note, verification, availability, availability_changed_at, party_id, verified_by, verified_at, next_inspection_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'VERIFIED', 'AVAILABLE', $8, $6, $7, $8, $9, $8, $8) RETURNING id`,
      [townshipId, input.name, input.kind, input.location, input.note ?? null, input.partyId ?? null, actor.id, now, new Date(now.getTime() + policy.inspectionDays[input.kind] * 86_400_000)],
    );
    await tx.query(`INSERT INTO access_inspections (place_id, outcome, note, inspector_id, at) VALUES ($1, 'VERIFIED', 'Added by staff after checking it.', $2, $3)`, [row!.id, actor.id, now]);
    await audit(tx, actor.id, 'ACCESS_PLACE_CREATED', 'access_place', row!.id, { name: input.name, kind: input.kind });
    return { id: row!.id };
  });
}

/**
 * An inspection: the only way a place's verification changes. It records who
 * checked, what they found and when, schedules the next check by the kind of
 * place, and settles any open "the listing is wrong" reports with the finding.
 */
export async function inspectPlace(db: Db, actor: Actor, placeId: string, input: { outcome: Exclude<Verification, 'PENDING_VERIFICATION'>; note: string; photo?: Photo }, now: Date) {
  if (!isStaff(actor)) throw forbidden();
  return db.tx(async (tx) => {
    const place = await one<{ township_id: string; kind: PlaceKind; verification: Verification; availability: string; reported_by: string | null; archived_at: Date | null }>(
      tx, 'SELECT township_id, kind, verification, availability, reported_by, archived_at FROM access_places WHERE id = $1 FOR UPDATE', [placeId],
    );
    if (!place || place.township_id !== townshipOf(actor)) throw notFound('Place');
    if (place.archived_at) throw conflict('ARCHIVED', 'This place is archived.');
    const policy = await getAccessPolicy(tx, place.township_id);
    const photoId = input.photo
      ? (await one<{ id: string }>(tx, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [actor.id, input.photo.mime, input.photo.bytes.length, Buffer.from(input.photo.bytes)]))!.id
      : null;
    await tx.query('INSERT INTO access_inspections (place_id, outcome, note, photo_id, inspector_id, at) VALUES ($1, $2, $3, $4, $5, $6)', [placeId, input.outcome, input.note.trim(), photoId, actor.id, now]);
    const verified = input.outcome === 'VERIFIED';
    await tx.query(
      `UPDATE access_places SET verification = $2, verified_by = CASE WHEN $3 THEN $4::uuid ELSE verified_by END, verified_at = CASE WHEN $3 THEN $5::timestamptz ELSE verified_at END,
              next_inspection_at = $6, duplicate_of = CASE WHEN $3 THEN NULL ELSE duplicate_of END,
              availability = CASE WHEN $3 AND availability = 'UNKNOWN' THEN 'AVAILABLE' ELSE availability END,
              availability_changed_at = CASE WHEN $3 AND availability = 'UNKNOWN' THEN $5::timestamptz ELSE availability_changed_at END, updated_at = $5
        WHERE id = $1`,
      [placeId, input.outcome, verified, actor.id, now, verified ? new Date(now.getTime() + policy.inspectionDays[place.kind] * 86_400_000) : null],
    );
    // The resident whose suggestion was confirmed earns Impact XP, once.
    if (verified && place.verification === 'PENDING_VERIFICATION' && place.reported_by) {
      const reporter = await rewardUserById(tx, place.reported_by);
      if (reporter) await recordAction(tx, { user: reporter, activity: 'AKSES_UPDATE', ref: `access-place:${placeId}`, now });
    }
    // Open "the listing is wrong" reports are answered by this inspection.
    const listingReports = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM access_incidents WHERE place_id = $1 AND category = 'MISINFORMATION' AND status <> 'RESOLVED' FOR UPDATE`, [placeId],
    );
    for (const i of listingReports) {
      await tx.query(`UPDATE access_incidents SET status = 'RESOLVED', resolved_at = $2, resolution_submitted_at = NULL, verify_due_at = NULL, updated_at = $2 WHERE id = $1`, [i.id, now]);
      await appendAccessEvent(tx, i.id, { kind: 'STATUS', visibility: 'INTERNAL', data: { from: i.status, to: 'RESOLVED', basis: 'INSPECTION' }, actorId: actor.id }, now);
      await appendAccessEvent(tx, i.id, { kind: 'RESOLVED', visibility: 'PUBLIC', body: `The listing was inspected: ${input.outcome === 'VERIFIED' ? 'confirmed accessible' : 'updated'}. ${input.note.trim()}`, actorId: actor.id }, now);
    }
    await refreshAvailability(tx, placeId, now);
    await audit(tx, actor.id, 'ACCESS_PLACE_INSPECTED', 'access_place', placeId, { outcome: input.outcome });
    return { verification: input.outcome };
  });
}

export async function setPlaceParty(db: Db, actor: Actor, placeId: string, partyId: string | null) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can change who runs a place.');
  const townshipId = townshipOf(actor);
  if (partyId && !(await one(db, 'SELECT 1 FROM access_parties WHERE id = $1 AND township_id = $2', [partyId, townshipId]))) throw notFound('Organisation');
  const rows = await db.query('UPDATE access_places SET party_id = $3 WHERE id = $1 AND township_id = $2 RETURNING id', [placeId, townshipId, partyId]);
  if (!rows.length) throw notFound('Place');
  await audit(db, actor.id, 'ACCESS_PLACE_PARTY_SET', 'access_place', placeId, { partyId });
  return { ok: true };
}

/** Takes a place out of the directory, keeping its record and history. Never while a problem there is still open. */
export async function archivePlace(db: Db, actor: Actor, placeId: string, reason: string, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can archive a place.');
  return db.tx(async (tx) => {
    const place = await one<{ township_id: string; archived_at: Date | null }>(tx, 'SELECT township_id, archived_at FROM access_places WHERE id = $1 FOR UPDATE', [placeId]);
    if (!place || place.township_id !== townshipOf(actor)) throw notFound('Place');
    if (place.archived_at) throw conflict('ARCHIVED', 'This place is already archived.');
    if (await one(tx, `SELECT 1 FROM access_incidents WHERE place_id = $1 AND status <> 'RESOLVED'`, [placeId])) {
      throw ruleViolation('OPEN_INCIDENTS', 'This place has open incidents. Resolve them first.');
    }
    await tx.query('UPDATE access_places SET archived_at = $2, archived_by = $3, archive_reason = $4, updated_at = $2 WHERE id = $1', [placeId, now, actor.id, reason.trim()]);
    await audit(tx, actor.id, 'ACCESS_PLACE_ARCHIVED', 'access_place', placeId, { reason: reason.trim() });
    return { ok: true };
  });
}

export async function restorePlace(db: Db, actor: Actor, placeId: string, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can restore a place.');
  const rows = await db.query('UPDATE access_places SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = $3 WHERE id = $1 AND township_id = $2 AND archived_at IS NOT NULL RETURNING id', [placeId, townshipOf(actor), now]);
  if (!rows.length) throw notFound('Place');
  await audit(db, actor.id, 'ACCESS_PLACE_RESTORED', 'access_place', placeId);
  return { ok: true };
}

/** Follow a place to hear when it is blocked or available again. */
export async function followPlace(db: Db, actor: Actor, placeId: string, follow: boolean, now: Date) {
  const resident = requireVerifiedResident(actor);
  if (!(await one(db, 'SELECT 1 FROM access_places WHERE id = $1 AND township_id = $2 AND archived_at IS NULL', [placeId, resident.townshipId]))) throw notFound('Place');
  if (follow) await db.query('INSERT INTO access_place_follows (place_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [placeId, resident.id, now]);
  else await db.query('DELETE FROM access_place_follows WHERE place_id = $1 AND user_id = $2', [placeId, resident.id]);
  return { following: follow };
}

/**
 * An evidence photo. A fix's photo (and an inspection's) is shown to the
 * township, so residents can judge it. A report's photo is shown only to the
 * reporter, township staff, and members of the team handling it.
 */
export async function getAccessPhoto(db: Db, actor: Actor, uploadId: string): Promise<Response> {
  const townshipId = actor.townshipId;
  const source = await one<{ kind: 'REPORT' | 'PUBLIC'; township_id: string; reporter_id: string | null; party_id: string | null }>(
    db,
    `SELECT 'REPORT' AS kind, i.township_id, r.reporter_id, i.party_id FROM access_reports r JOIN access_incidents i ON i.id = r.incident_id WHERE r.photo_id = $1
     UNION ALL SELECT 'REPORT', i.township_id, c.user_id, i.party_id FROM access_confirmations c JOIN access_resolutions rs ON rs.id = c.resolution_id JOIN access_incidents i ON i.id = rs.incident_id WHERE c.photo_id = $1
     UNION ALL SELECT 'PUBLIC', i.township_id, NULL, NULL FROM access_resolutions rs JOIN access_incidents i ON i.id = rs.incident_id WHERE rs.photo_id = $1
     UNION ALL SELECT 'PUBLIC', p.township_id, NULL, NULL FROM access_inspections n JOIN access_places p ON p.id = n.place_id WHERE n.photo_id = $1
     LIMIT 1`,
    [uploadId],
  );
  if (!source || (actor.role !== 'HQ_ADMIN' && source.township_id !== townshipId)) throw notFound('Photo');
  if (source.kind === 'REPORT' && !isStaff(actor) && source.reporter_id !== actor.id
    && !(source.party_id && (await one(db, 'SELECT 1 FROM access_party_members WHERE party_id = $1 AND user_id = $2', [source.party_id, actor.id])))) {
    throw notFound('Photo');
  }
  const upload = (await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [uploadId]))!;
  return new Response(Buffer.from(upload.bytes), { headers: { 'Content-Type': upload.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
