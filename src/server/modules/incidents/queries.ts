import { ADMINS, STAFF } from '@/shared/domain';
import { ACTIVE_STATUSES, PRIORITIES, type IncidentModule, type IncidentStatus, type Priority } from '@/shared/incidents';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { resolveTownship } from '../townships';
import { historyIntact, type IncidentRow } from './engine';
import { DEFAULT_INCIDENT_POLICY, getIncidentPolicy, type IncidentPolicy } from './policy';

/**
 * What staff and residents see of cases. Staff see their township's cases with
 * the full, internal history and the related records; residents see only their
 * own reports and only what was written for them. Lapor's community reports
 * keep their own queue and appear on the board for one view of everything
 * open, read-only, with a link to Lapor.
 */

export interface BoardFilter {
  module?: IncidentModule | 'LAPOR';
  modules?: IncidentModule[];
  status?: IncidentStatus | 'ACTIVE' | 'ALL';
  priority?: Priority;
  owner?: 'ME' | 'UNASSIGNED' | string;
  overdue?: boolean;
  disputedHandovers30d?: boolean;
  from?: string;
  to?: string;
  q?: string;
}

function requireStaff(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw forbidden();
}

const OVERDUE_SQL = `((i.owner_id IS NULL AND i.status IN ('OPEN', 'REOPENED') AND i.assign_due_at < $2) OR (i.status = ANY($3::text[]) AND i.resolve_due_at < $2))`;

export async function incidentBoard(db: Db, actor: Actor, filter: BoardFilter, now: Date) {
  requireStaff(actor);
  const townshipId = await resolveTownship(db, actor);
  const modules = filter.modules ?? (filter.module && filter.module !== 'LAPOR' ? [filter.module] : null);
  const metrics = (await one<{ open: number; unassigned: number; mine: number; investigating: number; awaiting: number; overdue: number; critical: number; resolved_30d: number }>(
    db,
    `SELECT count(*) FILTER (WHERE i.status = ANY($3::text[]))::int AS open,
            count(*) FILTER (WHERE i.status = ANY($3::text[]) AND i.owner_id IS NULL)::int AS unassigned,
            count(*) FILTER (WHERE i.status = ANY($3::text[]) AND i.owner_id = $4)::int AS mine,
            count(*) FILTER (WHERE i.status = 'INVESTIGATING')::int AS investigating,
            count(*) FILTER (WHERE i.status = 'AWAITING_EXTERNAL_PARTY')::int AS awaiting,
            count(*) FILTER (WHERE ${OVERDUE_SQL})::int AS overdue,
            count(*) FILTER (WHERE i.status = ANY($3::text[]) AND i.priority = 'CRITICAL')::int AS critical,
            count(*) FILTER (WHERE i.status IN ('RESOLVED', 'CLOSED') AND i.resolved_at > $2::timestamptz - interval '30 days')::int AS resolved_30d
       FROM incidents i WHERE i.township_id = $1 AND ($5::text[] IS NULL OR i.module = ANY($5::text[]))`,
    [townshipId, now, ACTIVE_STATUSES, actor.id, modules],
  ))!;
  const referrals = (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM courier_referrals WHERE township_id = $1 AND created_at > $2::timestamptz - interval '30 days'`, [townshipId, now]))!.n;
  const status = filter.status ?? 'ACTIVE';
  const rows = filter.module === 'LAPOR' ? [] : await db.query(
    `SELECT i.id, i.reference, i.module, i.kind, i.priority, i.status, i.summary, i.responsibility, i.created_at, i.updated_at, i.assign_due_at, i.resolve_due_at, i.escalated_at,
            i.awaiting, u.full_name AS owner, i.owner_id, s.name AS station, ${OVERDUE_SQL} AS overdue,
            (i.owner_id IS NULL AND i.status IN ('OPEN', 'REOPENED') AND i.assign_due_at < $2) AS unassigned_late
       FROM incidents i LEFT JOIN users u ON u.id = i.owner_id LEFT JOIN locker_stations s ON s.id = i.station_id
      WHERE i.township_id = $1
        AND ($5::text[] IS NULL OR i.module = ANY($5::text[]))
        AND ($6::text = 'ALL' OR ($6 = 'ACTIVE' AND i.status = ANY($3::text[])) OR i.status = $6)
        AND ($7::text IS NULL OR i.priority = $7)
        AND ($8::text IS NULL OR ($8 = 'ME' AND i.owner_id = $4) OR ($8 = 'UNASSIGNED' AND i.owner_id IS NULL) OR i.owner_id::text = $8)
        AND (NOT $9::boolean OR ${OVERDUE_SQL})
        AND ($10::date IS NULL OR i.created_at >= $10::date) AND ($11::date IS NULL OR i.created_at < $11::date + 1)
        AND ($12::text IS NULL OR i.reference ILIKE '%' || $12 || '%' OR i.summary ILIKE '%' || $12 || '%')
        AND (NOT $14::boolean OR (i.module = 'PARCELS' AND i.kind = 'COLLECTION_DISPUTE' AND EXISTS (
          SELECT 1 FROM parcels p WHERE p.id = i.guard_parcel_id AND p.township_id = i.township_id
            AND p.problem_at > $2::timestamptz - interval '30 days'
        )))
      ORDER BY (i.status = ANY($3::text[])) DESC, array_position($13::text[], i.priority), ${OVERDUE_SQL} DESC, i.created_at DESC
      LIMIT 200`,
    [townshipId, now, ACTIVE_STATUSES, actor.id, modules, status, filter.priority ?? null, filter.owner ?? null, filter.overdue ?? false, filter.from ?? null, filter.to ?? null,
      filter.q?.trim() || null, [...PRIORITIES], filter.disputedHandovers30d ?? false],
  );
  // Lapor's own queue, shown alongside but never copied.
  const showLapor = !modules && (filter.module === undefined || filter.module === 'LAPOR') && !filter.priority && !filter.owner && !filter.q;
  const lapor = showLapor
    ? await db.query(
        `SELECT r.id, r.category, r.status, r.location_text, r.created_at, r.updated_at, r.assigned_to, r.target_date::text AS target_date,
                (r.status IN ('NEW', 'IN_PROGRESS') AND r.target_date < ($2::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date) AS overdue
           FROM reports r WHERE r.township_id = $1 AND ($3::text = 'ALL' OR r.status IN ('NEW', 'IN_PROGRESS'))
          ORDER BY r.created_at DESC LIMIT 50`,
        [townshipId, now, status === 'ALL' ? 'ALL' : 'ACTIVE'],
      )
    : [];
  const laporOpen = (await one<{ open: number; late: number }>(
    db, `SELECT count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS'))::int AS open, count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS') AND target_date < ($2::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::int AS late FROM reports WHERE township_id = $1`, [townshipId, now],
  ))!;
  const staff = await db.query<{ id: string; full_name: string; role: string }>(
    `SELECT id, full_name, role FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE' ORDER BY full_name`, [townshipId],
  );
  return { metrics: { ...metrics, courierReferrals30d: referrals, laporOpen: laporOpen.open, laporLate: laporOpen.late }, incidents: rows, lapor, staff, me: actor.id, isAdmin: ADMINS.includes(actor.role) };
}

/** One case, in full, for staff: its history, escalations, and the related parcel, locker or guardhouse records. No codes or secrets. */
export async function incidentDetail(db: Db, actor: Actor, idOrRef: string) {
  requireStaff(actor);
  const i = await one<IncidentRow & { owner: string | null; reporter: string | null; reporter_role: string | null; station: string | null; company: string | null }>(
    db,
    `SELECT i.*, o.full_name AS owner, r.full_name AS reporter, r.role AS reporter_role, s.name AS station, c.name AS company
       FROM incidents i LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users r ON r.id = i.user_id LEFT JOIN locker_stations s ON s.id = i.station_id
       LEFT JOIN courier_companies c ON c.id = i.company_id
      WHERE (i.id::text = $1 OR i.reference = $1)`,
    [idOrRef],
  );
  if (!i || (actor.role !== 'HQ_ADMIN' && i.township_id !== actor.townshipId)) throw notFound('Case');
  const [events, escalations, home] = await Promise.all([
    db.query(`SELECT e.id, e.kind, e.visibility, e.body, e.data, e.at, u.full_name AS actor FROM incident_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.incident_id = $1 ORDER BY e.id`, [i.id]),
    db.query(`SELECT x.reason, x.note, x.at, u.full_name AS raised_by FROM incident_escalations x LEFT JOIN users u ON u.id = x.raised_by WHERE x.incident_id = $1 ORDER BY x.at`, [i.id]),
    i.home_id ? one<{ unit_code: string; house_no: string | null; street: string }>(db, 'SELECT unit_code, house_no, street FROM homes WHERE id = $1', [i.home_id]) : Promise.resolve(undefined),
  ]);
  let parcel: Record<string, unknown> | null = null;
  if (i.parcel_id) {
    const p = await one(db, `SELECT p.tracking_no, p.state, p.size, p.ready_at, p.collected_at, p.assurance, co.name AS company, s.name AS station, c.label AS compartment
                               FROM locker_parcels p JOIN courier_companies co ON co.id = p.company_id JOIN locker_stations s ON s.id = p.station_id
                               LEFT JOIN locker_compartments c ON c.id = p.compartment_id WHERE p.id = $1`, [i.parcel_id]);
    parcel = p ? {
      kind: 'LOCKER', ...p,
      history: await db.query(`SELECT e.to_state, e.reason, e.at, e.actor_kind, u.full_name AS actor FROM parcel_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.parcel_id = $1 ORDER BY e.id DESC LIMIT 20`, [i.parcel_id]),
      doors: await db.query(`SELECT k.purpose, k.status, k.created_at, k.acked_at, k.error, u.full_name AS requested_by FROM locker_commands k LEFT JOIN users u ON u.id = k.requested_by WHERE k.parcel_id = $1 ORDER BY k.created_at DESC LIMIT 10`, [i.parcel_id]),
      custody: await db.query(`SELECT t.from_kind, t.to_kind, t.note, t.at, u.full_name AS actor FROM custody_transfers t LEFT JOIN users u ON u.id = t.actor_id WHERE t.parcel_id = $1 ORDER BY t.id`, [i.parcel_id]),
    } : null;
  } else if (i.guard_parcel_id) {
    const g = await one(db, `SELECT p.courier, p.tracking_no, p.shelf, p.status, p.logged_at, p.collected_at, p.collected_by_name, p.problem_note, l.full_name AS logged_by, h.full_name AS handed_over_by
                               FROM parcels p LEFT JOIN users l ON l.id = p.logged_by LEFT JOIN users h ON h.id = p.handed_over_by WHERE p.id = $1`, [i.guard_parcel_id]);
    parcel = g ? { kind: 'GUARD', ...g } : null;
  }
  return {
    incident: { ...i, home: home ? `${home.house_no ? `No. ${home.house_no}, ` : ''}${home.street} (${home.unit_code})` : null },
    events, escalations, parcel, historyIntact: await historyIntact(db, i.id),
    can: {
      claim: i.owner_id === null && (i.status === 'OPEN' || i.status === 'REOPENED'),
      work: (i.owner_id === actor.id || ADMINS.includes(actor.role)) && ACTIVE_STATUSES.includes(i.status) && i.status !== 'OPEN',
      assign: ADMINS.includes(actor.role) && ACTIVE_STATUSES.includes(i.status),
      escalate: ACTIVE_STATUSES.includes(i.status),
      messageResident: Boolean(i.user_id) && i.reporter_role !== null,
    },
  };
}

/** The reporter's own reports, with only what was written for them, and their courier referrals. */
export async function myReports(db: Db, actor: Actor, now: Date) {
  const policy = actor.townshipId ? await getIncidentPolicy(db, actor.townshipId) : DEFAULT_INCIDENT_POLICY;
  const cases = await db.query<IncidentRow>(`SELECT * FROM incidents WHERE user_id = $1 ORDER BY (status IN ('RESOLVED', 'CLOSED')), updated_at DESC LIMIT 50`, [actor.id]);
  const events = cases.length
    ? await db.query<{ incident_id: string; kind: string; body: string | null; at: Date; mine: boolean }>(
        `SELECT incident_id, kind, body, at, (actor_id = $2) AS mine FROM incident_events WHERE incident_id = ANY($1::uuid[]) AND visibility = 'RESIDENT' ORDER BY id`,
        [cases.map((c) => c.id), actor.id],
      )
    : [];
  const referrals = await db.query(
    `SELECT r.id, r.reason, r.tracking_no, r.ticket_ref, r.ticket_status, r.ticket_simulated, r.created_at, c.name AS company, c.provider_mode = 'SIMULATED' AS simulated,
            CASE WHEN c.support_verified_at IS NOT NULL THEN json_build_object('name', c.support_name, 'url', c.support_url, 'phone', c.support_phone) END AS support
       FROM courier_referrals r LEFT JOIN courier_companies c ON c.id = r.company_id WHERE r.user_id = $1 AND r.created_at > $2::timestamptz - interval '60 days' ORDER BY r.created_at DESC LIMIT 30`,
    [actor.id, now],
  );
  return {
    disputeDays: policy.dispute_days,
    reports: cases.map((c) => ({
      reference: c.reference, category: c.kind, module: c.module, status: c.status, summary: c.summary, createdAt: c.created_at, updatedAt: c.updated_at,
      outcome: c.status === 'RESOLVED' || c.status === 'CLOSED' ? c.resident_outcome : null,
      awaitingYou: c.status === 'AWAITING_EXTERNAL_PARTY' && c.awaiting === 'RESIDENT',
      handled: c.owner_id !== null,
      canReopen: c.status === 'RESOLVED' && c.resolved_at !== null && now.getTime() - c.resolved_at.getTime() <= policy.dispute_days * 86_400_000,
      timeline: events.filter((e) => e.incident_id === c.id).map((e) => ({ kind: e.kind, body: e.body, at: e.at, mine: e.mine })),
    })),
    referrals,
  };
}

// --- Policy -------------------------------------------------------------------------------------

export async function getPolicyForTownship(db: Db, actor: Actor) {
  requireStaff(actor);
  return { policy: await getIncidentPolicy(db, await resolveTownship(db, actor)), defaults: DEFAULT_INCIDENT_POLICY };
}

export async function saveIncidentPolicy(db: Db, actor: Actor, input: IncidentPolicy, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can change the case deadlines.');
  for (const p of PRIORITIES) {
    const t = input.targets[p];
    if (!t || t.assign < 1 || t.resolve <= t.assign) throw ruleViolation('TARGETS', `${p}: the resolution target must come after the assignment target.`);
  }
  const townshipId = await resolveTownship(db, actor);
  await db.query(
    `INSERT INTO incident_policies (township_id, targets, workday_start, workday_end, workdays, holidays, dispute_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::date[], $7, $8)
     ON CONFLICT (township_id) DO UPDATE SET targets = EXCLUDED.targets, workday_start = EXCLUDED.workday_start, workday_end = EXCLUDED.workday_end,
       workdays = EXCLUDED.workdays, holidays = EXCLUDED.holidays, dispute_days = EXCLUDED.dispute_days, updated_at = EXCLUDED.updated_at`,
    [townshipId, JSON.stringify(input.targets), input.workday_start, input.workday_end, input.workdays, input.holidays, input.dispute_days, now],
  );
  await audit(db, actor.id, 'INCIDENT_POLICY_SAVED', 'incident_policy', townshipId, { ...input });
  return { ok: true };
}

export async function assertCaseExists(db: Db, reference: string) {
  if (!(await one(db, 'SELECT 1 FROM incidents WHERE reference = $1', [reference]))) throw notFound('Case');
}
