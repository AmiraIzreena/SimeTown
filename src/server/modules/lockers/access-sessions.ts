import { ADMINS } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { custody, revokeCredentials, transition, userActor, type ParcelRow } from './core';
import { createUnlock, dispatch } from './hardware';

const OPENABLE = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'DEPOSIT_IN_PROGRESS', 'EXCEPTION'];
const ACTIVE = ['APPROVED', 'ACTIVE'];
const SESSION_MS = 30 * 60_000;

interface SessionRow {
  id: string; township_id: string; station_id: string; reason: string; status: string; requested_by: string; expires_at: Date | null;
}

/** Ask once for controlled access to several occupied doors at one station. */
export async function requestAccessSession(db: Db, actor: Actor, input: { stationId: string; parcelIds: string[]; reason: string }, now: Date) {
  const unique = [...new Set(input.parcelIds)];
  if (unique.length < 2) throw ruleViolation('SESSION_SIZE', 'Choose at least two parcels. For one parcel, use a single door-opening request.');
  return db.tx(async (tx) => {
    const station = await one<{ township_id: string; name: string }>(tx, 'SELECT township_id, name FROM locker_stations WHERE id = $1', [input.stationId]);
    if (!station) throw notFound('Locker station');
    assertTownshipAccess(actor, station.township_id);
    const parcels = await tx.query<ParcelRow>(
      `SELECT * FROM locker_parcels WHERE id = ANY($1::uuid[]) FOR UPDATE`, [unique],
    );
    if (parcels.length !== unique.length) throw notFound('Parcel');
    for (const parcel of parcels) {
      if (parcel.station_id !== input.stationId || !parcel.compartment_id || !OPENABLE.includes(parcel.state)) {
        throw conflict('PARCEL_STATE', 'Every selected parcel must still be inside this locker station.');
      }
      const existing = await one(tx,
        `SELECT 1 FROM locker_access_session_items item JOIN locker_access_sessions session ON session.id = item.session_id
          WHERE item.parcel_id = $1 AND session.status IN ('PENDING', 'APPROVED', 'ACTIVE')`, [parcel.id]);
      if (existing || await one(tx, `SELECT 1 FROM locker_exception_requests WHERE parcel_id = $1 AND status IN ('PENDING', 'APPROVED')`, [parcel.id])) {
        throw conflict('ACCESS_OPEN', `There is already an access request for ${parcel.tracking_no}.`);
      }
    }
    const session = (await one<{ id: string }>(tx,
      `INSERT INTO locker_access_sessions (township_id, station_id, reason, requested_by, requested_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [station.township_id, input.stationId, input.reason.trim(), actor.id, now],
    ))!;
    for (const parcel of parcels) {
      await tx.query(
        `INSERT INTO locker_access_session_items (session_id, parcel_id, compartment_id) VALUES ($1, $2, $3)`,
        [session.id, parcel.id, parcel.compartment_id],
      );
    }
    await audit(tx, actor.id, 'LOCKER_ACCESS_SESSION_REQUESTED', 'locker_access_session', session.id, { stationId: input.stationId, parcelIds: unique, reason: input.reason });
    const admins = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE' AND id <> $2`, [station.township_id, actor.id]);
    await notify(tx, admins.map((admin) => admin.id), {
      title: 'A maintenance access session needs approval',
      body: `${actor.fullName} requested controlled access to ${parcels.length} occupied doors at ${station.name}.`,
      link: '/console/operations?tab=lockers&view=access',
    });
    return { id: session.id, status: 'PENDING' as const };
  });
}

/** A second admin approves the session once; no door opens during approval. */
export async function decideAccessSession(db: Db, actor: Actor, id: string, input: { approve: boolean; note?: string }, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only a township admin can approve this.');
  return db.tx(async (tx) => {
    const session = await one<SessionRow>(tx, 'SELECT * FROM locker_access_sessions WHERE id = $1 FOR UPDATE', [id]);
    if (!session) throw notFound('Access session');
    assertTownshipAccess(actor, session.township_id);
    if (session.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This session has already been decided.');
    if (session.requested_by === actor.id) throw forbidden('A second admin must approve your own request.');
    const status = input.approve ? 'APPROVED' : 'REJECTED';
    const expiresAt = input.approve ? new Date(now.getTime() + SESSION_MS) : null;
    await tx.query(
      `UPDATE locker_access_sessions SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5, expires_at = $6 WHERE id = $1`,
      [id, status, actor.id, now, input.note?.trim() || null, expiresAt],
    );
    await audit(tx, actor.id, `LOCKER_ACCESS_SESSION_${status}`, 'locker_access_session', id, { note: input.note, expiresAt });
    await notify(tx, [session.requested_by], {
      title: input.approve ? 'Maintenance access approved' : 'Maintenance access rejected',
      body: input.approve ? 'The session is available for 30 minutes. Open and check one door at a time.' : 'The maintenance access session was not approved.',
      link: '/console/operations?tab=lockers&view=access',
    });
    return { status, expiresAt };
  });
}

async function activeSession(db: Db, actor: Actor, id: string, now: Date) {
  const session = await one<SessionRow>(db, 'SELECT * FROM locker_access_sessions WHERE id = $1', [id]);
  if (!session) throw notFound('Access session');
  assertTownshipAccess(actor, session.township_id);
  if (session.requested_by !== actor.id) throw forbidden('Only the staff member who requested this session can use it.');
  if (!ACTIVE.includes(session.status)) throw conflict('SESSION_STATUS', 'This access session is not active.');
  if (!session.expires_at || session.expires_at <= now) {
    await db.query(`UPDATE locker_access_sessions SET status = 'EXPIRED' WHERE id = $1 AND status IN ('APPROVED', 'ACTIVE')`, [id]);
    throw conflict('SESSION_EXPIRED', 'This access session has expired. Request a new one.');
  }
  return session;
}

/** Opens one selected door. Another cannot open while a door at the station is open. */
export async function openSessionItem(db: Db, actor: Actor, sessionId: string, itemId: string, idempotencyKey: string, now: Date) {
  await activeSession(db, actor, sessionId, now);
  const commandId = await db.tx(async (tx) => {
    const session = (await one<SessionRow>(tx, 'SELECT * FROM locker_access_sessions WHERE id = $1 FOR UPDATE', [sessionId]))!;
    if (!ACTIVE.includes(session.status) || !session.expires_at || session.expires_at <= now) throw conflict('SESSION_EXPIRED', 'This access session has expired.');
    const openDoor = await one(tx, `SELECT 1 FROM locker_compartments WHERE station_id = $1 AND door = 'OPEN'`, [session.station_id]);
    if (openDoor) throw conflict('DOOR_OPEN', 'Close the open locker door before opening another one.');
    const item = await one<{ id: string; parcel_id: string; compartment_id: string; status: string }>(
      tx, 'SELECT id, parcel_id, compartment_id, status FROM locker_access_session_items WHERE id = $1 AND session_id = $2 FOR UPDATE', [itemId, sessionId],
    );
    if (!item) throw notFound('Session parcel');
    if (item.status !== 'PENDING') throw conflict('ITEM_STATUS', 'This parcel has already been opened.');
    const parcel = (await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [item.parcel_id]))!;
    if (!OPENABLE.includes(parcel.state) || parcel.compartment_id !== item.compartment_id) {
      await tx.query(`UPDATE locker_access_session_items SET status = 'CANCELLED' WHERE id = $1`, [item.id]);
      throw conflict('PARCEL_MOVED', 'This parcel is no longer in that door. Nothing was opened.');
    }
    if (parcel.state !== 'EXCEPTION') await transition(tx, parcel.id, 'EXCEPTION', userActor(actor.id), `Maintenance access session: ${session.reason}`, now, { exception_note: session.reason });
    await revokeCredentials(tx, parcel.id, now);
    await custody(tx, parcel.id, { kind: 'LOCKER', ref: parcel.compartment_id }, { kind: 'STAFF', ref: actor.id }, actor.id, now, `Maintenance access session: ${session.reason}`);
    const command = await createUnlock(tx, { stationId: parcel.station_id, compartmentId: item.compartment_id, parcelId: parcel.id, purpose: 'EXCEPTION', requestedBy: actor.id, idempotencyKey }, now);
    await tx.query(`UPDATE locker_access_session_items SET status = 'OPENED', command_id = $2, opened_at = $3 WHERE id = $1`, [item.id, command.id, now]);
    await tx.query(`UPDATE locker_access_sessions SET status = 'ACTIVE' WHERE id = $1 AND status = 'APPROVED'`, [sessionId]);
    await audit(tx, actor.id, 'LOCKER_ACCESS_SESSION_DOOR_OPENED', 'locker_access_session', sessionId, { itemId, parcelId: parcel.id, commandId: command.id });
    return command.id;
  });
  const command = await dispatch(db, commandId, now);
  return { status: command.status, error: command.error };
}

/** The scan proves which parcel staff removed before the next door is used. */
export async function completeSessionItem(db: Db, actor: Actor, sessionId: string, itemId: string, trackingNo: string, now: Date) {
  await activeSession(db, actor, sessionId, now);
  return db.tx(async (tx) => {
    const item = await one<{ parcel_id: string; status: string; tracking_no: string }>(tx,
      `SELECT item.parcel_id, item.status, parcel.tracking_no FROM locker_access_session_items item
       JOIN locker_parcels parcel ON parcel.id = item.parcel_id WHERE item.id = $1 AND item.session_id = $2 FOR UPDATE OF item`, [itemId, sessionId]);
    if (!item) throw notFound('Session parcel');
    if (item.status !== 'OPENED') throw conflict('ITEM_STATUS', 'Open this parcel’s door before confirming removal.');
    if (item.tracking_no.toUpperCase() !== trackingNo.trim().toUpperCase()) throw conflict('WRONG_PARCEL', 'That is a different parcel. Check the tracking number and scan again.');
    await tx.query(`UPDATE locker_access_session_items SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`, [itemId, now]);
    const remaining = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM locker_access_session_items WHERE session_id = $1 AND status IN ('PENDING', 'OPENED')`, [sessionId]);
    if (remaining!.n === 0) await tx.query(`UPDATE locker_access_sessions SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`, [sessionId, now]);
    await audit(tx, actor.id, 'LOCKER_ACCESS_SESSION_PARCEL_CONFIRMED', 'locker_access_session', sessionId, { itemId, parcelId: item.parcel_id });
    return { status: remaining!.n === 0 ? 'COMPLETED' as const : 'ACTIVE' as const };
  });
}

export async function listAccessSessions(db: Db, actor: Actor, now: Date) {
  await db.query(`UPDATE locker_access_sessions SET status = 'EXPIRED' WHERE status IN ('APPROVED', 'ACTIVE') AND expires_at <= $1`, [now]);
  const sessions = await db.query<SessionRow & { station: string; requested_by_name: string; decided_by_name: string | null; requested_at: Date; decided_at: Date | null; decision_note: string | null; completed_at: Date | null }>(
    `SELECT session.*, station.name AS station, requester.full_name AS requested_by_name, decider.full_name AS decided_by_name
       FROM locker_access_sessions session JOIN locker_stations station ON station.id = session.station_id
       JOIN users requester ON requester.id = session.requested_by LEFT JOIN users decider ON decider.id = session.decided_by
      WHERE ($1::uuid IS NULL OR session.township_id = $1)
      ORDER BY (session.status = 'PENDING') DESC, session.requested_at DESC LIMIT 30`, [actor.townshipId]);
  if (sessions.length === 0) return [];
  const items = await db.query<{ id: string; session_id: string; parcel_id: string; compartment_id: string; status: string; tracking_no: string; compartment: string; command_status: string | null }>(
    `SELECT item.id, item.session_id, item.parcel_id, item.compartment_id, item.status, parcel.tracking_no, compartment.label AS compartment, command.status AS command_status
       FROM locker_access_session_items item JOIN locker_parcels parcel ON parcel.id = item.parcel_id
       JOIN locker_compartments compartment ON compartment.id = item.compartment_id LEFT JOIN locker_commands command ON command.id = item.command_id
      WHERE item.session_id = ANY($1::uuid[]) ORDER BY compartment.label`, [sessions.map((session) => session.id)]);
  return sessions.map((session) => ({ ...session, items: items.filter((item) => item.session_id === session.id), canOperate: session.requested_by === actor.id }));
}
