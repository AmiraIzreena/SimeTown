import type { ReportCategory, ReportStatus } from '@/shared/domain';
import type { Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { todayIn } from '../settings';

/**
 * Request tracking: everything a household is waiting on, in one list (the
 * brief's single resident hub). Reports and the ones followed with "Me too",
 * parcels at the guardhouse and in the lockers, and booked recycling
 * collections, each with where it stands and the next step, so nobody has to
 * know whom to ask.
 */

export type RequestKind = 'REPORT' | 'PARCEL' | 'LOCKER' | 'COLLECTION' | 'INCIDENT';
type ReportStep = 'RECEIVED' | 'CHECKED' | 'ASSIGNED' | 'FIXED' | 'CLOSED';

export async function myRequests(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const today = await todayIn(db, now);
  const [reports, parcels, lockers, collections, cases] = await Promise.all([
    db.query<{
      id: string; category: ReportCategory; location_text: string; status: ReportStatus; created_at: Date; updated_at: Date;
      checked_at: Date | null; assigned_to: string | null; target_date: string | null; mine: boolean; affected: number;
    }>(
      `SELECT r.id, r.category, r.location_text, r.status, r.created_at, r.updated_at, r.checked_at, r.assigned_to, r.target_date::text AS target_date,
              r.reporter_id = $1 AS mine, 1 + (SELECT count(*)::int FROM report_supporters s WHERE s.report_id = r.id) AS affected
         FROM reports r
        WHERE (r.reporter_id = $1 OR EXISTS (SELECT 1 FROM report_supporters s WHERE s.report_id = r.id AND s.user_id = $1))
          AND (r.status IN ('NEW', 'IN_PROGRESS') OR r.updated_at > $2::timestamptz - interval '14 days')
        ORDER BY r.updated_at DESC LIMIT 30`,
      [resident.id, now],
    ),
    db.query<{ id: string; courier: string; shelf: string; logged_at: Date }>(
      `SELECT id, courier, shelf, logged_at FROM parcels WHERE home_id = $1 AND status = 'WAITING' ORDER BY logged_at`,
      [resident.homeId],
    ),
    db.query<{ id: string; company: string; state: string; station: string; compartment: string | null; counter: string | null; deadline_at: Date | null; state_changed_at: Date }>(
      `SELECT p.id, co.name AS company, p.state, s.name AS station, c.label AS compartment, o.name AS counter, p.deadline_at, p.state_changed_at
         FROM locker_parcels p JOIN courier_companies co ON co.id = p.company_id JOIN locker_stations s ON s.id = p.station_id
         LEFT JOIN locker_compartments c ON c.id = p.compartment_id LEFT JOIN overflow_locations o ON o.id = p.overflow_location_id
        WHERE p.home_id = $1 AND p.state IN ('READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'RELOCATION_IN_PROGRESS', 'RELOCATED_TO_STORAGE', 'COLLECTION_IN_PROGRESS', 'RETURN_PENDING', 'EXCEPTION')
        ORDER BY p.state_changed_at`,
      [resident.homeId],
    ),
    db.query<{ id: string; day: string; slot: string; status: string; collector: string; created_at: Date }>(
      `SELECT x.id, x.day::text AS day, x.slot, x.status, c.name AS collector, x.created_at
         FROM recycling_collections x JOIN recycling_collectors c ON c.id = x.collector_id
        WHERE x.home_id = $1 AND x.status IN ('REQUESTED', 'CONFIRMED') ORDER BY x.day`,
      [resident.homeId],
    ),
    db.query<{ id: string; reference: string; kind: string; status: string; awaiting: string | null; owner_id: string | null; created_at: Date; updated_at: Date }>(
      `SELECT id, reference, kind, status, awaiting, owner_id, created_at, updated_at FROM incidents
        WHERE user_id = $1 AND (status NOT IN ('RESOLVED', 'CLOSED') OR updated_at > $2::timestamptz - interval '14 days') ORDER BY updated_at DESC LIMIT 20`,
      [resident.id, now],
    ),
  ]);

  const step = (r: (typeof reports)[number]): ReportStep =>
    r.status === 'RESOLVED' ? 'FIXED' : r.status === 'REJECTED' ? 'CLOSED' : r.assigned_to || r.target_date ? 'ASSIGNED' : r.checked_at ? 'CHECKED' : 'RECEIVED';

  const items = [
    ...reports.map((r) => ({
      kind: 'REPORT' as const,
      id: r.id,
      open: r.status === 'NEW' || r.status === 'IN_PROGRESS',
      category: r.category,
      place: r.location_text,
      step: step(r),
      assignedTo: r.assigned_to,
      targetDate: r.target_date,
      late: (r.status === 'NEW' || r.status === 'IN_PROGRESS') && r.target_date !== null && r.target_date < today,
      mine: r.mine,
      affected: r.affected,
      at: r.updated_at,
      link: '/app/lapor',
    })),
    ...parcels.map((p) => ({ kind: 'PARCEL' as const, id: p.id, open: true, courier: p.courier, shelf: p.shelf, at: p.logged_at, link: '/app/parcels' })),
    ...lockers.map((l) => ({
      kind: 'LOCKER' as const, id: l.id, open: true, courier: l.company, state: l.state, station: l.station, compartment: l.compartment, counter: l.counter,
      deadlineAt: l.deadline_at, at: l.state_changed_at, link: '/app/parcels',
    })),
    ...collections.map((x) => ({ kind: 'COLLECTION' as const, id: x.id, open: true, collector: x.collector, day: x.day, slot: x.slot, status: x.status, at: x.created_at, link: '/app/kitar' })),
    ...cases.map((c) => ({
      kind: 'INCIDENT' as const, id: c.id, reference: c.reference, category: c.kind, status: c.status, open: c.status !== 'RESOLVED' && c.status !== 'CLOSED',
      awaitingYou: c.status === 'AWAITING_EXTERNAL_PARTY' && c.awaiting === 'RESIDENT', handled: c.owner_id !== null, at: c.updated_at, link: `/app/reports#${c.reference}`,
    })),
  ];
  return {
    open: items.filter((i) => i.open).length,
    items: items.sort((a, b) => Number(b.open) - Number(a.open) || new Date(b.at).getTime() - new Date(a.at).getTime()),
  };
}
