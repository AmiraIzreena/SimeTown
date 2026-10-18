import { randomUUID } from 'node:crypto';
import { ADMINS } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { custody, getPolicy, revokeCredentials, transition, userActor, type ParcelRow } from './core';
import { createUnlock, dispatch } from './hardware';

/**
 * Opening an occupied compartment outside the normal flow: a parcel in the
 * wrong door or for the wrong household, a damaged or suspected stolen parcel,
 * a fault. Staff ask, with a reason; a second admin approves (unless the
 * township has switched that off), and only then is the door opened. The
 * parcel is held as an exception with the staff member, its pickup code stops
 * working, and every step is recorded. Couriers never get this power.
 */

export const EXCEPTION_KINDS = ['WRONG_COMPARTMENT', 'WRONG_RECIPIENT', 'INTERRUPTED_DEPOSIT', 'RETRIEVAL', 'DAMAGED', 'SUSPECTED_THEFT', 'HARDWARE', 'UNCOLLECTED'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/** Where the parcel can be when staff open its door: in the locker, being deposited, or already an exception still inside. */
const OPENABLE = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'DEPOSIT_IN_PROGRESS', 'EXCEPTION'];

export async function requestException(db: Db, actor: Actor, parcelId: string, input: { kind: ExceptionKind; reason: string }, now: Date) {
  const request = await db.tx(async (tx) => {
    const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
    if (!p) throw notFound('Parcel');
    assertTownshipAccess(actor, p.township_id);
    if (!OPENABLE.includes(p.state) || !p.compartment_id) throw conflict('PARCEL_STATE', 'Only a parcel in a locker can be taken out this way.');
    if (await one(tx, `SELECT 1 FROM locker_exception_requests WHERE parcel_id = $1 AND status IN ('PENDING', 'APPROVED')`, [p.id])) throw conflict('EXCEPTION_OPEN', 'There is already a request for this parcel.');
    const row = (await one<{ id: string }>(
      tx,
      `INSERT INTO locker_exception_requests (township_id, parcel_id, compartment_id, kind, reason, requested_by, requested_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.township_id, p.id, p.compartment_id, input.kind, input.reason.trim(), actor.id, now],
    ))!;
    await audit(tx, actor.id, 'LOCKER_EXCEPTION_REQUESTED', 'locker_parcel', p.id, { kind: input.kind, reason: input.reason });
    const policy = await getPolicy(tx, p.township_id, p.station_id);
    if (policy.exceptions_need_second_approval) {
      const admins = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE' AND id <> $2`, [p.township_id, actor.id]);
      await notify(tx, admins.map((a) => a.id), { title: 'A locker door needs a second approval', body: `${actor.fullName} asked to open door for ${p.tracking_no}: ${input.reason.trim()}`, link: '/console/lockers' });
    }
    return { id: row.id, needsApproval: policy.exceptions_need_second_approval };
  });
  // Without a second approver, an admin's own request goes ahead at once; a staff member's still needs an admin.
  if (!request.needsApproval && ADMINS.includes(actor.role)) return { ...(await carryOut(db, actor, request.id, null, now)), id: request.id };
  return { id: request.id, status: 'PENDING' as const };
}

export async function decideException(db: Db, actor: Actor, id: string, input: { approve: boolean; note?: string }, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only a township admin can approve this.');
  const r = await one<{ requested_by: string; status: string; township_id: string }>(db, 'SELECT requested_by, status, township_id FROM locker_exception_requests WHERE id = $1', [id]);
  if (!r) throw notFound('Request');
  assertTownshipAccess(actor, r.township_id);
  if (r.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
  if (r.requested_by === actor.id) throw forbidden('A second admin must approve your own request.');
  if (!input.approve) {
    await db.query(`UPDATE locker_exception_requests SET status = 'REJECTED', decided_by = $2, decided_at = $3, decision_note = $4 WHERE id = $1`, [id, actor.id, now, input.note?.trim() || null]);
    await audit(db, actor.id, 'LOCKER_EXCEPTION_REJECTED', 'locker_exception', id, { note: input.note });
    return { status: 'REJECTED' as const };
  }
  return carryOut(db, actor, id, input.note ?? null, now);
}

/** Opens the door for the approved request. The parcel becomes an exception in the staff member's hands. */
async function carryOut(db: Db, actor: Actor, id: string, note: string | null, now: Date) {
  const commandId = await db.tx(async (tx) => {
    const r = (await one<{ parcel_id: string; compartment_id: string; kind: string; reason: string; requested_by: string; status: string }>(
      tx, 'SELECT parcel_id, compartment_id, kind, reason, requested_by, status FROM locker_exception_requests WHERE id = $1 FOR UPDATE', [id],
    ))!;
    if (r.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
    const p = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [r.parcel_id]))!;
    if (!OPENABLE.includes(p.state) || p.compartment_id !== r.compartment_id) {
      await tx.query(`UPDATE locker_exception_requests SET status = 'CANCELLED', decided_by = $2, decided_at = $3, decision_note = 'The parcel moved before approval' WHERE id = $1`, [id, actor.id, now]);
      throw ruleViolation('PARCEL_MOVED', 'The parcel is no longer in that door. Nothing was opened.');
    }
    if (p.state !== 'EXCEPTION') await transition(tx, p.id, 'EXCEPTION', userActor(actor.id), `Exception (${r.kind.toLowerCase().replace(/_/g, ' ')}): ${r.reason}`, now, { exception_note: r.reason });
    await revokeCredentials(tx, p.id, now);
    await custody(tx, p.id, { kind: 'LOCKER', ref: p.compartment_id }, { kind: 'STAFF', ref: r.requested_by }, actor.id, now, `Exception: ${r.reason}`);
    const command = await createUnlock(tx, { stationId: p.station_id, compartmentId: p.compartment_id!, parcelId: p.id, purpose: 'EXCEPTION', requestedBy: actor.id, idempotencyKey: `exception:${id}:${randomUUID()}` }, now);
    await tx.query(`UPDATE locker_exception_requests SET status = 'APPROVED', decided_by = $2, decided_at = $3, decision_note = $4, command_id = $5 WHERE id = $1`, [id, actor.id, now, note?.trim() || null, command.id]);
    await audit(tx, actor.id, 'LOCKER_EXCEPTION_APPROVED', 'locker_exception', id, { parcelId: p.id, commandId: command.id });
    return command.id;
  });
  const command = await dispatch(db, commandId, now);
  return { status: 'APPROVED' as const, command: { id: command.id, status: command.status, error: command.error } };
}

export async function listExceptions(db: Db, actor: Actor) {
  return db.query(
    `SELECT r.id, r.kind, r.reason, r.status, r.requested_at, r.decided_at, r.decision_note, p.tracking_no, p.state AS parcel_state, s.name AS station, c.label AS compartment,
            q.full_name AS requested_by, d.full_name AS decided_by, r.requested_by AS requested_by_id, k.status AS command_status
       FROM locker_exception_requests r JOIN locker_parcels p ON p.id = r.parcel_id JOIN locker_stations s ON s.id = p.station_id
       JOIN locker_compartments c ON c.id = r.compartment_id JOIN users q ON q.id = r.requested_by
       LEFT JOIN users d ON d.id = r.decided_by LEFT JOIN locker_commands k ON k.id = r.command_id
      WHERE ($1::uuid IS NULL OR r.township_id = $1)
      ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 50`,
    [actor.townshipId],
  );
}
