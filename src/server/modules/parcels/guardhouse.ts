import { shortAddress, type HomeAddress } from '@/shared/domain';
import { DELIVERY_PROBLEM_FOR_RESIDENT, DELIVERY_PROBLEMS, type DeliveryProblem } from '@/shared/lockers';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { AppError, notFound, ruleViolation } from '../../errors';
import { HOME_ADDRESS_COLUMNS } from '../townships';
import { checkCounterCode } from '../lockers/overflow';
import { checkParcelCode, normaliseParcelCode } from './service';

/**
 * The guardhouse register: every parcel held at the guardhouse, in one place. Two kinds arrive there: parcels a
 * courier leaves straight with the guard (the shelf), and smart locker parcels that could not go into the home's
 * own door. Both follow the same rules, so staff and guards see them side by side: when each arrived, how long
 * it has waited, whether it is overdue or a call is due, and the last thing done. Filtering, sorting and paging
 * happen in the database, so the register stays quick as it grows.
 */

export type GuardhouseSource = 'SHELF' | 'LOCKER';
export type GuardhouseStatus = 'WAITING' | 'RETURN_PENDING' | 'COLLECTED' | 'RETURNED';
export type GuardhouseShow = 'ALL' | 'WAITING' | 'OVERDUE' | 'CALL_DUE' | 'RETURN_PENDING' | 'COLLECTED' | 'RETURNED';

export interface RegisterFilter {
  q?: string;
  show?: GuardhouseShow;
  source?: GuardhouseSource;
  courier?: string;
  from?: string;
  to?: string;
  sort?: 'LONGEST' | 'NEWEST';
  page?: number;
}

const PAGE_SIZE = 20;
const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));

/**
 * One row per parcel, from either source, with its last action. A call is due once the guard was asked to call
 * and nobody has added a note since.
 */
const REGISTER = `
  WITH items AS (
    SELECT 'SHELF'::text AS source, p.id::text AS id, p.township_id, p.home_id, p.tracking_no, p.courier, p.shelf AS place,
           p.logged_at AS arrived_at, CASE WHEN p.status = 'WAITING' THEN NULL ELSE p.collected_at END AS left_at,
           p.status::text AS status, p.overdue_at, p.call_requested_at, NULL::text AS reason, NULL::text AS recipient,
           (p.call_requested_at IS NOT NULL AND p.status = 'WAITING'
             AND NOT EXISTS (SELECT 1 FROM guard_parcel_events n WHERE n.parcel_id = p.id AND n.kind = 'NOTE' AND n.at >= p.call_requested_at)) AS call_due,
           last.kind AS last_kind, last.body AS last_body, last.at AS last_at
      FROM parcels p
      LEFT JOIN LATERAL (SELECT e.kind, e.body, e.at FROM guard_parcel_events e WHERE e.parcel_id = p.id ORDER BY e.at DESC, e.id DESC LIMIT 1) last ON true
    UNION ALL
    SELECT 'LOCKER', lp.id::text, lp.township_id, lp.home_id, lp.tracking_no, co.name, o.name,
           lp.relocated_at, CASE WHEN lp.state IN ('COLLECTED', 'RETURNED') THEN lp.state_changed_at END,
           CASE lp.state WHEN 'RELOCATED_TO_STORAGE' THEN 'WAITING' ELSE lp.state END, lp.overdue_at, lp.call_requested_at, lp.delivery_problem, u.full_name,
           (lp.call_requested_at IS NOT NULL AND lp.state = 'RELOCATED_TO_STORAGE'
             AND NOT EXISTS (SELECT 1 FROM locker_parcel_notes n WHERE n.parcel_id = lp.id AND n.created_at >= lp.call_requested_at)),
           last.kind, last.body, last.at
      FROM locker_parcels lp
      JOIN courier_companies co ON co.id = lp.company_id
      JOIN overflow_locations o ON o.id = lp.overflow_location_id
      LEFT JOIN users u ON u.id = lp.recipient_user_id
      LEFT JOIN LATERAL (
        SELECT * FROM (
          SELECT 'EVENT'::text AS kind, ev.reason AS body, ev.at FROM parcel_events ev WHERE ev.parcel_id = lp.id
          UNION ALL SELECT 'NOTE', n.body, n.created_at FROM locker_parcel_notes n WHERE n.parcel_id = lp.id
        ) x ORDER BY x.at DESC LIMIT 1
      ) last ON true
     WHERE lp.relocated_at IS NOT NULL AND lp.state IN ('RELOCATED_TO_STORAGE', 'RETURN_PENDING', 'COLLECTED', 'RETURNED')
  )`;

function where(actor: Actor, f: RegisterFilter, params: unknown[]) {
  const clauses: string[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replaceAll('?', `$${params.length}`)); };
  if (actor.townshipId) add('i.township_id = ?', actor.townshipId);
  const q = f.q?.trim();
  if (q) {
    // One value, used for every field searched: tracking number, courier, address, and the names of the household.
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const n = `$${params.length}`;
    clauses.push(`(i.tracking_no ILIKE ${n} OR i.courier ILIKE ${n} OR h.street ILIKE ${n} OR h.house_no ILIKE ${n} OR h.building ILIKE ${n}
      OR EXISTS (SELECT 1 FROM users r WHERE r.home_id = i.home_id AND r.full_name ILIKE ${n}))`);
  }
  switch (f.show ?? 'ALL') {
    case 'WAITING': clauses.push(`i.status IN ('WAITING', 'RETURN_PENDING')`); break;
    case 'OVERDUE': clauses.push(`i.status IN ('WAITING', 'RETURN_PENDING') AND i.overdue_at IS NOT NULL`); break;
    case 'CALL_DUE': clauses.push('i.call_due'); break;
    case 'RETURN_PENDING': clauses.push(`i.status = 'RETURN_PENDING'`); break;
    case 'COLLECTED': clauses.push(`i.status = 'COLLECTED'`); break;
    case 'RETURNED': clauses.push(`i.status = 'RETURNED'`); break;
  }
  if (f.source) add('i.source = ?', f.source);
  if (f.courier) add('i.courier = ?', f.courier);
  if (f.from) add(`i.arrived_at >= (?::date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`, f.from);
  if (f.to) add(`i.arrived_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`, f.to);
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

export interface RegisterRow {
  source: GuardhouseSource;
  id: string;
  trackingNo: string | null;
  courier: string;
  place: string;
  house: string;
  recipient: string | null;
  arrivedAt: Date;
  leftAt: Date | null;
  days: number;
  status: GuardhouseStatus;
  overdue: boolean;
  callDue: boolean;
  reason: string | null;
  lastAction: { text: string; at: Date } | null;
}

/** The register: a page of parcels under the filters, the total, and the couriers to filter by. */
export async function guardhouseRegister(db: Db, actor: Actor, f: RegisterFilter, now: Date) {
  const params: unknown[] = [];
  const filter = where(actor, f, params);
  const page = Math.max(1, Math.min(500, f.page ?? 1));
  const order = f.sort === 'NEWEST' ? 'i.arrived_at DESC' : `(i.status IN ('WAITING', 'RETURN_PENDING')) DESC, i.call_due DESC, i.arrived_at ASC`;
  const rows = await db.query<HomeAddress & {
    source: GuardhouseSource; id: string; tracking_no: string | null; courier: string; place: string; recipient: string | null;
    arrived_at: Date; left_at: Date | null; status: GuardhouseStatus; overdue_at: Date | null; call_due: boolean; reason: string | null;
    last_kind: string | null; last_body: string | null; last_at: Date | null;
  }>(
    `${REGISTER}
     SELECT i.*, ${HOME_ADDRESS_COLUMNS} FROM items i JOIN homes h ON h.id = i.home_id
     ${filter} ORDER BY ${order}, i.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  const total = (await one<{ n: number }>(db, `${REGISTER} SELECT count(*)::int AS n FROM items i JOIN homes h ON h.id = i.home_id ${filter}`, params))!.n;
  const couriers = await db.query<{ courier: string }>(
    `${REGISTER} SELECT DISTINCT i.courier FROM items i WHERE ($1::uuid IS NULL OR i.township_id = $1) ORDER BY i.courier`,
    [actor.townshipId],
  );
  return {
    items: rows.map((r): RegisterRow => ({
      source: r.source,
      id: r.id,
      trackingNo: r.tracking_no,
      courier: r.courier,
      place: r.place,
      house: shortAddress(r),
      recipient: r.recipient,
      arrivedAt: r.arrived_at,
      leftAt: r.left_at,
      days: days(r.arrived_at, r.left_at ?? now),
      status: r.status,
      overdue: r.overdue_at !== null,
      callDue: r.call_due,
      reason: r.reason && (DELIVERY_PROBLEMS as readonly string[]).includes(r.reason) ? DELIVERY_PROBLEM_FOR_RESIDENT[r.reason as DeliveryProblem] : null,
      lastAction: r.last_at ? { text: r.last_body ?? lastKindText(r.last_kind), at: r.last_at } : null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    couriers: couriers.map((c) => c.courier),
  };
}

const lastKindText = (kind: string | null) => ({ LOGGED: 'Logged at the guardhouse', REMINDER: 'Reminder sent', OVERDUE: 'Overdue', CALL_REQUESTED: 'Guard asked to call', COLLECTED: 'Collected', RETURNED: 'Returned to the courier' } as Record<string, string>)[kind ?? ''] ?? '';

/** The figures above the register, for the whole guardhouse whatever the filters. */
export async function guardhouseOverview(db: Db, actor: Actor, now: Date) {
  const o = (await one<{ held: number; overdue: number; calls: number; arrived_today: number; collected_30d: number; returned_30d: number; avg_days: number | null; shelf: number; locker: number }>(
    db,
    `${REGISTER}
     SELECT count(*) FILTER (WHERE i.status IN ('WAITING', 'RETURN_PENDING'))::int AS held,
            count(*) FILTER (WHERE i.status IN ('WAITING', 'RETURN_PENDING') AND i.overdue_at IS NOT NULL)::int AS overdue,
            count(*) FILTER (WHERE i.call_due)::int AS calls,
            count(*) FILTER (WHERE (i.arrived_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = ($2::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::int AS arrived_today,
            count(*) FILTER (WHERE i.status = 'COLLECTED' AND i.left_at > $2::timestamptz - interval '30 days')::int AS collected_30d,
            count(*) FILTER (WHERE i.status = 'RETURNED' AND i.left_at > $2::timestamptz - interval '30 days')::int AS returned_30d,
            round(avg(extract(epoch FROM i.left_at - i.arrived_at) / 86400) FILTER (WHERE i.status = 'COLLECTED' AND i.left_at > $2::timestamptz - interval '30 days')::numeric, 1)::float AS avg_days,
            count(*) FILTER (WHERE i.status IN ('WAITING', 'RETURN_PENDING') AND i.source = 'SHELF')::int AS shelf,
            count(*) FILTER (WHERE i.status IN ('WAITING', 'RETURN_PENDING') AND i.source = 'LOCKER')::int AS locker
       FROM items i WHERE ($1::uuid IS NULL OR i.township_id = $1)`,
    [actor.townshipId, now],
  ))!;
  const room = (await one<{ capacity: number; open_from_hour: number | null; open_to_hour: number | null; name: string | null }>(
    db,
    `SELECT coalesce(sum(capacity), 0)::int AS capacity, min(open_from_hour) AS open_from_hour, max(open_to_hour) AS open_to_hour, min(name) AS name
       FROM overflow_locations WHERE active AND ($1::uuid IS NULL OR township_id = $1)`,
    [actor.townshipId],
  ))!;
  const disputes = (await one<{ n: number }>(
    db, `SELECT count(*)::int AS n FROM parcels WHERE ($1::uuid IS NULL OR township_id = $1) AND problem_at > $2::timestamptz - interval '30 days'`, [actor.townshipId, now],
  ))!.n;
  return {
    held: o.held, overdue: o.overdue, callsDue: o.calls, arrivedToday: o.arrived_today, collected30d: o.collected_30d, returned30d: o.returned_30d,
    averageDaysHeld: o.avg_days, bySource: { shelf: o.shelf, locker: o.locker }, capacity: room.capacity, disputes30d: disputes,
    guardhouse: room.name, openFromHour: room.open_from_hour, openToHour: room.open_to_hour,
  };
}

/** One parcel's full history at the guardhouse, oldest first, with who did each thing. */
export async function guardhouseParcel(db: Db, actor: Actor, source: GuardhouseSource, id: string, now: Date) {
  const params: unknown[] = [];
  const filter = where(actor, {}, params);
  params.push(source, id);
  const row = await one<HomeAddress & { source: GuardhouseSource; id: string; tracking_no: string | null; courier: string; place: string; recipient: string | null; arrived_at: Date; left_at: Date | null; status: GuardhouseStatus; overdue_at: Date | null; call_due: boolean; reason: string | null }>(
    db,
    `${REGISTER} SELECT i.*, ${HOME_ADDRESS_COLUMNS} FROM items i JOIN homes h ON h.id = i.home_id
     ${filter ? `${filter} AND` : 'WHERE'} i.source = $${params.length - 1} AND i.id = $${params.length}`,
    params,
  );
  if (!row) throw notFound('Parcel');
  const history = source === 'SHELF'
    ? await db.query<{ kind: string; body: string | null; at: Date; actor: string | null; actor_role: string | null }>(
      `SELECT e.kind, e.body, e.at, u.full_name AS actor, u.role AS actor_role FROM guard_parcel_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.parcel_id = $1 ORDER BY e.at, e.id`, [id])
    : await db.query<{ kind: string; body: string | null; at: Date; actor: string | null; actor_role: string | null }>(
      `SELECT * FROM (
         SELECT CASE WHEN e.to_state = 'COLLECTED' THEN 'COLLECTED' WHEN e.to_state IN ('RETURN_PENDING', 'RETURNED') THEN 'RETURNED' ELSE 'EVENT' END AS kind,
                e.reason AS body, e.at, u.full_name AS actor, u.role AS actor_role
           FROM parcel_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.parcel_id = $1
         UNION ALL
         SELECT 'NOTE', n.body, n.created_at, u.full_name, u.role FROM locker_parcel_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.parcel_id = $1
       ) x ORDER BY x.at`, [id]);
  return {
    source: row.source,
    id: row.id,
    trackingNo: row.tracking_no,
    courier: row.courier,
    place: row.place,
    house: shortAddress(row),
    recipient: row.recipient,
    arrivedAt: row.arrived_at,
    leftAt: row.left_at,
    days: days(row.arrived_at, row.left_at ?? now),
    status: row.status,
    overdue: row.overdue_at !== null,
    callDue: row.call_due,
    reason: row.reason && (DELIVERY_PROBLEMS as readonly string[]).includes(row.reason) ? DELIVERY_PROBLEM_FOR_RESIDENT[row.reason as DeliveryProblem] : null,
    history: history.map((h) => ({ kind: h.kind, text: h.body ?? lastKindText(h.kind), at: h.at, actor: h.actor, actorRole: h.actor_role })),
  };
}

export type CodeMatch =
  | { source: 'SHELF'; id: string; house: string; courier: string; trackingNo: string | null; shelf: string; hasPhoto: boolean; loggedAt: Date; days: number }
  | { source: 'LOCKER'; locationId: string; parcelId: string; house: string; courier: string; trackingNo: string; recipient: string | null; days: number; overdue: boolean };

/**
 * The code a resident shows at the guardhouse, whichever kind it is: a shelf collection code ("KITAPARCEL:…" or
 * six digits) or a smart locker pickup code ("SIMELOCKER:…" or a PIN). Six digits are tried as both; if both
 * match, the guard chooses. A staffed guardhouse is never locked by wrong codes.
 */
export async function checkGuardhouseCode(db: Db, actor: Actor, raw: string, now: Date) {
  const text = raw.trim();
  if (text.length < 6) throw ruleViolation('PICKUP_CODE', 'Type the six digits, or scan the QR code.');
  const upper = text.toUpperCase();
  const tryShelf = !upper.startsWith('SIMELOCKER:');
  const tryLocker = !upper.startsWith('KITAPARCEL:');
  const matches: CodeMatch[] = [];
  if (tryShelf && /^\d{6}$/.test(normaliseParcelCode(text))) {
    try {
      const p = await checkParcelCode(db, actor, text);
      matches.push({ source: 'SHELF', id: p.id, house: p.house, courier: p.courier, trackingNo: p.trackingNo, shelf: p.shelf, hasPhoto: p.hasPhoto, loggedAt: p.loggedAt, days: days(p.loggedAt, now) });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  if (tryLocker) {
    const locations = await db.query<{ id: string }>(`SELECT id FROM overflow_locations WHERE active AND ($1::uuid IS NULL OR township_id = $1)`, [actor.townshipId]);
    for (const loc of locations) {
      try {
        const p = await checkCounterCode(db, actor, loc.id, text, now);
        matches.push({ source: 'LOCKER', locationId: loc.id, parcelId: p.parcelId, house: p.house, courier: p.company, trackingNo: p.trackingNo, recipient: p.recipient, days: p.days, overdue: p.overdue });
        break;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
  }
  if (matches.length === 0) throw ruleViolation('PICKUP_CODE', 'No parcel at the guardhouse has this code. Check the code with the resident.');
  return { matches };
}
