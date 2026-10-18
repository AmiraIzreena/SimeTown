import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { notFound } from '../../errors';
import { claimIncident, createIncident, raiseSystemIncident, resolveIncident } from '../incidents/engine';

/**
 * Locker and courier security incidents: anything a person should look at,
 * from a replayed label to a door that opened without an unlock. They are
 * filed in the township's central incident system (modules/incidents), where
 * they get an owner, deadlines and escalation like every other case. Raising
 * one never blocks or undoes anything by itself.
 */

export type IncidentKind =
  | 'BARCODE_REPLAY' | 'SHIPMENT_IN_USE' | 'SUSPENDED_COURIER' | 'UNKNOWN_SHIPMENT' | 'RECIPIENT_MISMATCH' | 'PROVIDER_OUTAGE'
  | 'DOOR_FORCED' | 'DOOR_LEFT_OPEN' | 'UNLOCK_FAILED' | 'COMMAND_REJECTED' | 'KEYPAD_LOCKED' | 'SUSPICIOUS_LOGIN'
  | 'NOT_COLLECTED_BY_ME' | 'PARCEL_PROBLEM' | 'STAFF_REPORT';

export interface IncidentInput {
  townshipId: string;
  kind: IncidentKind;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  details?: Record<string, unknown>;
  stationId?: string | null;
  parcelId?: string | null;
  shipmentId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  /** The same key files one case; later occurrences are added to its history. */
  dedupeKey?: string;
}

export async function raiseIncident(q: Queryable, input: IncidentInput, now: Date): Promise<{ id: string; created: boolean }> {
  return raiseSystemIncident(q, input, now);
}

/** The locker cases, for older callers of the locker console: the central board shows the same records. */
export async function listIncidents(db: Db, actor: Actor, filter: { status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ALL' }) {
  const status = filter.status === 'RESOLVED' ? ['RESOLVED', 'CLOSED'] : filter.status === 'ALL' ? null : ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'REOPENED'];
  return db.query(
    `SELECT i.id, i.reference, i.kind, i.severity, i.priority, i.summary, i.details, i.status, i.resolution, i.created_at, i.updated_at,
            s.name AS station, p.tracking_no, c.name AS company, o.full_name AS owner
       FROM incidents i LEFT JOIN locker_stations s ON s.id = i.station_id LEFT JOIN locker_parcels p ON p.id = i.parcel_id
       LEFT JOIN courier_companies c ON c.id = i.company_id LEFT JOIN users o ON o.id = i.owner_id
      WHERE ($1::uuid IS NULL OR i.township_id = $1) AND i.module IN ('LOCKERS', 'COURIERS') AND ($2::text[] IS NULL OR i.status = ANY($2::text[]))
      ORDER BY i.updated_at DESC LIMIT 100`,
    [actor.townshipId, status],
  );
}

/** The older locker console's two actions: acknowledging takes the case; resolving records an outcome. */
export async function updateIncident(db: Db, actor: Actor, id: string, input: { status: 'ACKNOWLEDGED' | 'RESOLVED'; resolution?: string }, now: Date) {
  const i = await one<{ owner_id: string | null; status: string }>(db, 'SELECT owner_id, status FROM incidents WHERE id = $1', [id]);
  if (!i) throw notFound('Incident');
  if (i.owner_id === null) await claimIncident(db, actor, id, now);
  if (input.status === 'RESOLVED') {
    await resolveIncident(db, actor, id, { category: 'OTHER', outcome: input.resolution?.trim() || 'Checked by the township office.', actionsTaken: input.resolution?.trim() || 'Checked.' }, now);
  }
  return { ok: true };
}

/** Staff record something they saw: a damaged locker, a suspected theft. */
export async function reportIncident(db: Db, actor: Actor, input: { summary: string; stationId?: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }, now: Date) {
  const townshipId = actor.townshipId;
  if (!townshipId) throw notFound('Township');
  if (input.stationId && !(await one(db, 'SELECT 1 FROM locker_stations WHERE id = $1 AND township_id = $2', [input.stationId, townshipId]))) throw notFound('Station');
  return createIncident(db, {
    townshipId, module: 'LOCKERS', category: 'STAFF_REPORT', responsibility: 'TOWNSHIP', priority: input.severity === 'HIGH' ? 'HIGH' : input.severity === 'LOW' ? 'LOW' : 'NORMAL',
    summary: input.summary.trim(), stationId: input.stationId ?? null, details: { reportedBy: actor.id },
  }, now);
}
