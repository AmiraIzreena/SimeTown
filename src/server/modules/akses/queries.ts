import { STAFF } from '@/shared/domain';
import { ACCESS_INCIDENT_STATUSES, type AccessIncidentStatus } from '@/shared/akses';
import { one, type Db } from '../../db/client';
import { townshipOf, type Actor } from '../../auth/actor';
import { forbidden, notFound } from '../../errors';
import { accessHistoryIntact } from './incidents';

/**
 * What people see. Staff get an exception-first overview: the numbers, then
 * only the incidents and places that need a decision. Residents see their own
 * reports with the public steps. A party's members see the work routed to them,
 * without the reporters' names.
 */

function requireStaff(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw forbidden();
}

const INCIDENT_COLUMNS = `
  i.id, i.reference, i.category, i.priority, i.status, i.blocks_access, i.party_id, i.exception_reason, i.report_count, i.reporter_count,
  i.ack_due_at, i.resolve_due_at, i.verify_due_at, i.assigned_at, i.acknowledged_at, i.confirmed_at, i.confirmed_by, i.resolution_submitted_at,
  i.resolved_at, i.reopen_count, i.escalated_at, i.created_at, i.updated_at,
  p.id AS place_id, p.name AS place_name, p.kind AS place_kind, p.location AS place_location,
  pa.name AS party_name, pa.kind AS party_kind, pa.integration AS party_integration`;

export async function accessOverview(db: Db, actor: Actor, now: Date) {
  requireStaff(actor);
  const townshipId = townshipOf(actor);
  const metrics = (await one<Record<string, number>>(
    db,
    `SELECT
       (SELECT count(*)::int FROM access_places WHERE township_id = $1 AND archived_at IS NULL) AS places,
       (SELECT count(*)::int FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND verification = 'VERIFIED') AS verified,
       (SELECT count(*)::int FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND verification IN ('PENDING_VERIFICATION', 'VERIFICATION_REQUIRED')) AS pending_verification,
       (SELECT count(*)::int FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND availability IN ('REPORTED_BLOCKED', 'CONFIRMED_BLOCKED')) AS blocked_places,
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND status <> 'RESOLVED') AS active,
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND status <> 'RESOLVED' AND priority = 'CRITICAL') AS critical,
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND status <> 'RESOLVED' AND resolution_submitted_at IS NULL AND resolve_due_at < $2) AS overdue,
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND status = 'RESOLVED' AND resolved_at > $2::timestamptz - interval '7 days') AS resolved_week,
       (SELECT count(*)::int FROM access_places WHERE township_id = $1 AND archived_at IS NULL AND next_inspection_at < $2) AS inspections_due`,
    [townshipId, now],
  ))!;
  // Only what needs a person: escalated (including unroutable), fixes waiting too long for confirmation, failed deliveries.
  const attention = await db.query(
    `SELECT ${INCIDENT_COLUMNS},
            (SELECT e.reason FROM access_escalations e WHERE e.incident_id = i.id AND e.level = 'ESCALATION' ORDER BY e.at DESC LIMIT 1) AS escalation_reason,
            (SELECT e.note FROM access_escalations e WHERE e.incident_id = i.id AND e.level = 'ESCALATION' ORDER BY e.at DESC LIMIT 1) AS escalation_note
       FROM access_incidents i JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id
      WHERE i.township_id = $1 AND (i.status = 'ESCALATED' OR (i.status <> 'RESOLVED' AND i.party_id IS NULL))
      ORDER BY CASE i.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, i.escalated_at NULLS LAST LIMIT 50`,
    [townshipId],
  );
  const suggestions = await db.query(
    `SELECT p.id, p.name, p.kind, p.location, p.note, p.verification, p.created_at, u.full_name AS suggested_by, d.id AS duplicate_id, d.name AS duplicate_name,
            (SELECT count(*)::int FROM access_incidents i WHERE i.place_id = p.id AND i.category = 'MISINFORMATION' AND i.status <> 'RESOLVED') AS listing_reports
       FROM access_places p LEFT JOIN users u ON u.id = p.reported_by LEFT JOIN access_places d ON d.id = p.duplicate_of
      WHERE p.township_id = $1 AND p.archived_at IS NULL AND p.verification IN ('PENDING_VERIFICATION', 'VERIFICATION_REQUIRED')
      ORDER BY p.created_at LIMIT 50`,
    [townshipId],
  );
  const inspections = await db.query(
    `SELECT p.id, p.name, p.kind, p.next_inspection_at, pa.name AS party_name FROM access_places p LEFT JOIN access_parties pa ON pa.id = p.party_id
      WHERE p.township_id = $1 AND p.archived_at IS NULL AND p.next_inspection_at < $2::timestamptz + interval '14 days' ORDER BY p.next_inspection_at LIMIT 20`,
    [townshipId, now],
  );
  const recent = await db.query(
    `SELECT ${INCIDENT_COLUMNS} FROM access_incidents i JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id
      WHERE i.township_id = $1 AND i.status = 'RESOLVED' ORDER BY i.resolved_at DESC LIMIT 5`,
    [townshipId],
  );
  const automation = (await one<Record<string, number>>(
    db,
    `SELECT
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND created_at > $2::timestamptz - interval '30 days') AS incidents_30d,
       (SELECT count(*)::int FROM access_incidents WHERE township_id = $1 AND created_at > $2::timestamptz - interval '30 days' AND NOT (routing ? 'manual') AND routing ? 'partyId') AS auto_routed_30d,
       (SELECT count(*)::int FROM access_dispatches d JOIN access_incidents i ON i.id = d.incident_id WHERE i.township_id = $1 AND d.status = 'PENDING' AND d.attempts > 0) AS dispatch_retrying,
       (SELECT count(*)::int FROM access_dispatches d JOIN access_incidents i ON i.id = d.incident_id WHERE i.township_id = $1 AND d.status = 'FAILED') AS dispatch_failed`,
    [townshipId, now],
  ))!;
  return { metrics, attention, suggestions, inspections, recent, automation };
}

export interface IncidentFilter { status?: AccessIncidentStatus | 'ACTIVE' | 'ALL'; priority?: string; partyId?: string; q?: string }

export async function listAccessIncidents(db: Db, actor: Actor, f: IncidentFilter) {
  requireStaff(actor);
  const townshipId = townshipOf(actor);
  const status = f.status ?? 'ACTIVE';
  const statuses = status === 'ALL' ? [...ACCESS_INCIDENT_STATUSES] : status === 'ACTIVE' ? ACCESS_INCIDENT_STATUSES.filter((s) => s !== 'RESOLVED') : [status];
  return db.query(
    `SELECT ${INCIDENT_COLUMNS} FROM access_incidents i JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id
      WHERE i.township_id = $1 AND i.status = ANY($2::text[]) AND ($3::text IS NULL OR i.priority = $3) AND ($4::uuid IS NULL OR i.party_id = $4)
        AND ($5::text IS NULL OR i.reference ILIKE '%' || $5 || '%' OR p.name ILIKE '%' || $5 || '%' OR p.location ILIKE '%' || $5 || '%')
      ORDER BY i.status = 'RESOLVED', CASE i.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, i.created_at DESC LIMIT 200`,
    [townshipId, statuses, f.priority ?? null, f.partyId ?? null, f.q?.trim() || null],
  );
}

/** Everything about one incident, for staff: reports with their evidence, claimed fixes and how they were judged, escalations, deliveries and the full history. */
export async function accessIncidentDetail(db: Db, actor: Actor, idOrRef: string) {
  requireStaff(actor);
  const byRef = /^ACC-\d+$/i.test(idOrRef);
  const incident = await one<{ id: string; township_id: string }>(
    db,
    `SELECT ${INCIDENT_COLUMNS}, i.township_id, i.routing, p.verification AS place_verification, p.availability AS place_availability
       FROM access_incidents i JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id WHERE ${byRef ? 'i.reference = upper($1)' : 'i.id::text = $1'}`,
    [idOrRef],
  );
  if (!incident || (actor.role !== 'HQ_ADMIN' && incident.township_id !== actor.townshipId)) throw notFound('Incident');
  const [reports, resolutions, escalations, dispatches, events] = await Promise.all([
    db.query(`SELECT r.id, r.category, r.description, r.photo_id, r.created_at, u.full_name AS reporter FROM access_reports r JOIN users u ON u.id = r.reporter_id WHERE r.incident_id = $1 ORDER BY r.created_at`, [incident.id]),
    db.query(
      `SELECT rs.id, rs.source, rs.action_taken, rs.photo_id, rs.telemetry, rs.outcome, rs.decision_basis, rs.submitted_at, rs.decided_at, u.full_name AS submitted_by,
              (SELECT count(*)::int FROM access_confirmations c WHERE c.resolution_id = rs.id AND c.answer = 'CLEAR') AS clear,
              (SELECT count(*)::int FROM access_confirmations c WHERE c.resolution_id = rs.id AND c.answer = 'STILL_BLOCKED') AS still_blocked
         FROM access_resolutions rs LEFT JOIN users u ON u.id = rs.submitted_by WHERE rs.incident_id = $1 ORDER BY rs.submitted_at DESC`, [incident.id],
    ),
    db.query('SELECT reason, level, note, at FROM access_escalations WHERE incident_id = $1 ORDER BY at DESC', [incident.id]),
    db.query('SELECT kind, status, attempts, external_ref, last_error, created_at, sent_at FROM access_dispatches WHERE incident_id = $1 ORDER BY created_at DESC', [incident.id]),
    db.query(`SELECT e.id::text, e.kind, e.visibility, e.body, e.data, e.actor_kind, e.at, u.full_name AS actor FROM access_incident_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.incident_id = $1 ORDER BY e.id`, [incident.id]),
  ]);
  return { incident, reports, resolutions, escalations, dispatches, events, historyIntact: await accessHistoryIntact(db, incident.id) };
}

/** A resident's own reports, with the steps they may see and what they can do next. */
export async function myAccessReports(db: Db, actor: Actor) {
  const rows = await db.query<{ id: string }>(
    `SELECT * FROM (SELECT DISTINCT ON (i.id) i.id, i.reference, i.category, i.status, i.priority, i.created_at, i.resolved_at, i.updated_at, i.confirmed_at IS NOT NULL AS confirmed,
            p.id AS place_id, p.name AS place_name, p.location AS place_location, pa.name AS party_name,
            (SELECT rs.photo_id FROM access_resolutions rs WHERE rs.incident_id = i.id ORDER BY rs.submitted_at DESC LIMIT 1) AS fix_photo_id,
            i.status IN ('VERIFICATION_PENDING', 'ESCALATED') AND i.resolution_submitted_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM access_resolutions rs JOIN access_confirmations c ON c.resolution_id = rs.id WHERE rs.incident_id = i.id AND rs.outcome = 'PENDING' AND c.user_id = $1) AS can_confirm
       FROM access_reports r JOIN access_incidents i ON i.id = r.incident_id JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id
      WHERE r.reporter_id = $1 ORDER BY i.id) mine ORDER BY updated_at DESC LIMIT 100`,
    [actor.id],
  );
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db.query<{ incident_id: string; kind: string; body: string | null; at: Date }>(`SELECT incident_id, kind, body, at FROM access_incident_events WHERE incident_id = ANY($1::uuid[]) AND visibility = 'PUBLIC' ORDER BY id`, [ids])
    : [];
  return rows.map(({ id, ...r }) => ({ ...r, steps: events.filter((e) => e.incident_id === id).map((e) => ({ kind: e.kind, body: e.body, at: e.at })) }));
}

/** The work routed to the parties the person belongs to (a guard on the security team, a facilities officer). No reporter names. */
export async function partyWork(db: Db, actor: Actor) {
  const parties = await db.query<{ id: string; name: string; kind: string }>(
    'SELECT p.id, p.name, p.kind FROM access_party_members m JOIN access_parties p ON p.id = m.party_id WHERE m.user_id = $1 AND p.active', [actor.id],
  );
  if (!parties.length) return { parties, incidents: [] };
  const incidents = await db.query(
    `SELECT ${INCIDENT_COLUMNS},
            (SELECT json_agg(json_build_object('description', r.description, 'photo_id', r.photo_id, 'at', r.created_at) ORDER BY r.created_at) FROM access_reports r WHERE r.incident_id = i.id) AS reports
       FROM access_incidents i JOIN access_places p ON p.id = i.place_id LEFT JOIN access_parties pa ON pa.id = i.party_id
      WHERE i.party_id = ANY($1::uuid[]) AND i.status <> 'RESOLVED'
      ORDER BY CASE i.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, i.created_at`,
    [parties.map((p) => p.id)],
  );
  return { parties, incidents };
}
