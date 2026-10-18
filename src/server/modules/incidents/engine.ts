import { createHash } from 'node:crypto';
import { ADMINS, STAFF } from '@/shared/domain';
import {
  ACTIVE_STATUSES, canMoveIncident, CATEGORY_LABELS, INCIDENT_STATUS_LABELS, RESOLUTION_LABELS, SYSTEM_CATEGORIES,
  type Awaiting, type IncidentModule, type IncidentStatus, type Priority, type ResolutionCategory,
} from '@/shared/incidents';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { deadlinesFor, getIncidentPolicy } from './policy';

/**
 * The township's one incident engine. Every module files its cases here, and
 * every case follows the same rules: a reference, a priority and deadlines
 * from the township's policy, exactly one accountable owner once someone takes
 * it, moves only along the allowed transitions, an append-only history (each
 * step hashed onto the one before), and separate notes for staff and for the
 * resident. Resolving a case records what happened; it never unlocks a locker,
 * issues a code or changes a parcel.
 */

export interface IncidentRow {
  id: string;
  reference: string;
  township_id: string;
  module: IncidentModule;
  kind: string;
  responsibility: 'TOWNSHIP' | 'MIXED' | 'UNCERTAIN';
  priority: Priority;
  severity: string;
  status: IncidentStatus;
  summary: string;
  description: string | null;
  details: Record<string, unknown>;
  station_id: string | null;
  parcel_id: string | null;
  guard_parcel_id: string | null;
  shipment_id: string | null;
  company_id: string | null;
  user_id: string | null;
  home_id: string | null;
  owner_id: string | null;
  assigned_at: Date | null;
  assign_due_at: Date | null;
  resolve_due_at: Date | null;
  awaiting: Awaiting | null;
  escalated_at: Date | null;
  resolution_category: string | null;
  resolution: string | null;
  resident_outcome: string | null;
  actions_taken: string | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  reopen_count: number;
  created_at: Date;
  updated_at: Date;
}

type EventKind = 'CREATED' | 'ASSIGNED' | 'REASSIGNED' | 'STATUS' | 'NOTE' | 'RESIDENT_UPDATE' | 'INFO_REQUESTED' | 'RESIDENT_REPLY' | 'ESCALATED' | 'RESOLVED' | 'REOPENED' | 'CLOSED' | 'RECLASSIFIED' | 'REPEATED';

/** JSON with its keys sorted at every level: the database may store an object's keys in another order. */
const canonical = (v: unknown): string =>
  v === null || typeof v !== 'object' ? JSON.stringify(v ?? null)
    : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;

const chain = (prev: string | null, e: { incidentId: string; kind: string; visibility: string; body: string | null; data: unknown; actorId: string | null; at: Date }) =>
  createHash('sha256').update([prev ?? '', e.incidentId, e.kind, e.visibility, e.body ?? '', canonical(e.data ?? {}), e.actorId ?? '', e.at.toISOString()].join('|')).digest('hex');

/** Adds one step to a case's history. Call with the incident row locked, so steps never interleave. */
export async function appendEvent(
  q: Queryable,
  incidentId: string,
  e: { kind: EventKind; visibility: 'INTERNAL' | 'RESIDENT'; body?: string | null; data?: Record<string, unknown>; actorId?: string | null },
  now: Date,
) {
  const prev = await one<{ hash: string }>(q, 'SELECT hash FROM incident_events WHERE incident_id = $1 ORDER BY id DESC LIMIT 1', [incidentId]);
  const body = e.body ?? null;
  const data = e.data ?? {};
  const actorId = e.actorId ?? null;
  const hash = chain(prev?.hash ?? null, { incidentId, kind: e.kind, visibility: e.visibility, body, data, actorId, at: now });
  await q.query(
    `INSERT INTO incident_events (incident_id, kind, visibility, body, data, actor_id, actor_kind, at, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [incidentId, e.kind, e.visibility, body, JSON.stringify(data), actorId, actorId ? 'USER' : 'SYSTEM', now, prev?.hash ?? null, hash],
  );
}

/** Whether a case's history is exactly as it was written: every hash recomputes and links to the one before. */
export async function historyIntact(q: Queryable, incidentId: string): Promise<boolean> {
  const rows = await q.query<{ kind: string; visibility: string; body: string | null; data: unknown; actor_id: string | null; at: Date; prev_hash: string | null; hash: string }>(
    'SELECT kind, visibility, body, data, actor_id, at, prev_hash, hash FROM incident_events WHERE incident_id = $1 ORDER BY id', [incidentId],
  );
  let prev: string | null = null;
  for (const r of rows) {
    if (r.prev_hash !== prev) return false;
    if (chain(prev, { incidentId, kind: r.kind, visibility: r.visibility, body: r.body, data: r.data, actorId: r.actor_id, at: r.at }) !== r.hash) return false;
    prev = r.hash;
  }
  return true;
}

async function staffIds(q: Queryable, townshipId: string, roles: readonly string[] = ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN']) {
  return (await q.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = ANY($2::text[]) AND status = 'ACTIVE'`, [townshipId, roles])).map((r) => r.id);
}
const adminIds = (q: Queryable, townshipId: string) => staffIds(q, townshipId, ['TOWNSHIP_ADMIN']);

async function tellEach(q: Queryable, ids: string[], n: { title: string; body: string; link: string; priority?: 'NORMAL' | 'URGENT' }, dedupe: string) {
  for (const id of ids) await notify(q, [id], { ...n, dedupeKey: `${dedupe}:${id}` });
}

const residentLink = (i: Pick<IncidentRow, 'reference'>) => `/app/reports#${i.reference}`;
const staffLink = (i: Pick<IncidentRow, 'reference'>) => `/console/incidents?ref=${i.reference}`;
const title = (i: Pick<IncidentRow, 'kind' | 'reference'>) => `${CATEGORY_LABELS[i.kind] ?? i.kind} (${i.reference})`;

/** Tells the person who reported the case, if a person did. */
async function tellReporter(q: Queryable, i: IncidentRow, n: { title: string; body: string }, dedupe: string) {
  if (!i.user_id) return;
  await notify(q, [i.user_id], { ...n, link: residentLink(i), dedupeKey: `${dedupe}:${i.user_id}` });
}

export interface NewIncident {
  townshipId: string;
  module: IncidentModule;
  category: string;
  responsibility: 'TOWNSHIP' | 'MIXED' | 'UNCERTAIN';
  priority: Priority;
  summary: string;
  description?: string | null;
  details?: Record<string, unknown>;
  stationId?: string | null;
  parcelId?: string | null;
  guardParcelId?: string | null;
  shipmentId?: string | null;
  companyId?: string | null;
  /** The person who reported it, when a person did. */
  reporterId?: string | null;
  homeId?: string | null;
  /** The same key files one case; repeats are added to its history. */
  dedupeKey?: string;
  /** What the reporter is told when it is received. */
  residentMessage?: string;
}

const SEVERITY: Record<Priority, string> = { CRITICAL: 'HIGH', HIGH: 'HIGH', NORMAL: 'MEDIUM', LOW: 'LOW' };

/**
 * Files a case, or adds a repeat to the open case with the same key. Sets its
 * deadlines, tells the reporter, puts urgent cases in front of staff, and
 * escalates a critical case to the township's admins at once.
 */
export async function createIncident(q: Queryable, input: NewIncident, now: Date): Promise<{ id: string; reference: string; created: boolean }> {
  const policy = await getIncidentPolicy(q, input.townshipId);
  const tz = (await getSettings(q)).timezone;
  const { assignDue, resolveDue } = deadlinesFor(input.priority, policy, tz, now);
  const inserted = await one<IncidentRow>(
    q,
    `INSERT INTO incidents (township_id, module, kind, responsibility, priority, severity, summary, description, details, station_id, parcel_id, guard_parcel_id,
                            shipment_id, company_id, user_id, home_id, dedupe_key, status, assign_due_at, resolve_due_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'OPEN', $18, $19, $20, $20)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
    [
      input.townshipId, input.module, input.category, input.responsibility, input.priority, SEVERITY[input.priority], input.summary, input.description ?? null,
      JSON.stringify(input.details ?? {}), input.stationId ?? null, input.parcelId ?? null, input.guardParcelId ?? null, input.shipmentId ?? null,
      input.companyId ?? null, input.reporterId ?? null, input.homeId ?? null, input.dedupeKey ?? null, assignDue, resolveDue, now,
    ],
  );
  if (!inserted) {
    // Seen before: one case, with this occurrence added to it. A resolved one is reopened; a closed one keeps its record.
    const existing = (await one<IncidentRow>(q, 'SELECT * FROM incidents WHERE dedupe_key = $1 FOR UPDATE', [input.dedupeKey]))!;
    const reopen = existing.status === 'RESOLVED';
    await q.query(
      `UPDATE incidents SET updated_at = $2, details = details || jsonb_build_object('occurrences', coalesce((details->>'occurrences')::int, 1) + 1),
              status = CASE WHEN $3 THEN 'REOPENED' ELSE status END, reopen_count = reopen_count + CASE WHEN $3 THEN 1 ELSE 0 END
        WHERE id = $1`,
      [existing.id, now, reopen],
    );
    await appendEvent(q, existing.id, { kind: reopen ? 'REOPENED' : 'REPEATED', visibility: 'INTERNAL', body: input.summary }, now);
    return { id: existing.id, reference: existing.reference, created: false };
  }
  const i = inserted;
  await appendEvent(q, i.id, { kind: 'CREATED', visibility: 'INTERNAL', body: input.summary, data: { priority: i.priority, responsibility: i.responsibility, module: i.module }, actorId: input.reporterId }, now);
  if (input.reporterId) {
    await appendEvent(q, i.id, { kind: 'CREATED', visibility: 'RESIDENT', body: input.residentMessage ?? 'We have received your report. The township office will look into it.' }, now);
    await tellReporter(q, i, { title: `Report received: ${i.reference}`, body: input.residentMessage ?? 'The township office will look into it. You will be told what happens.' }, `incident-received:${i.id}`);
  }
  if (i.priority === 'CRITICAL' || i.priority === 'HIGH') {
    await tellEach(q, await staffIds(q, i.township_id), { priority: 'URGENT', title: `${i.priority === 'CRITICAL' ? 'Critical' : 'Urgent'} case: ${title(i)}`, body: i.summary, link: staffLink(i) }, `incident-new:${i.id}`);
  }
  if (i.priority === 'CRITICAL') await escalate(q, i, 'CRITICAL', 'critical', 'A critical case was reported.', null, now);
  return { id: i.id, reference: i.reference, created: true };
}

/** The system noticed something (a replayed label, a forced door): filed with the module and priority its category implies. */
export async function raiseSystemIncident(
  q: Queryable,
  input: Omit<NewIncident, 'module' | 'category' | 'responsibility' | 'priority'> & { kind: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; userId?: string | null },
  now: Date,
) {
  const rule = SYSTEM_CATEGORIES[input.kind] ?? { module: 'LOCKERS' as const };
  const priority: Priority = rule.priority ?? (input.severity === 'HIGH' ? 'HIGH' : input.severity === 'LOW' ? 'LOW' : 'NORMAL');
  // The person whose action raised it (a courier, say) is not a reporter waiting for an answer.
  return createIncident(q, { ...input, module: rule.module, category: input.kind, responsibility: rule.responsibility ?? 'TOWNSHIP', priority, reporterId: null, details: { ...(input.details ?? {}), ...(input.userId ? { raisedBy: input.userId } : {}) } }, now);
}

/** Flags a case for the township's admins, once for each reason and occasion. The owner stays the owner. */
export async function escalate(q: Queryable, i: IncidentRow, reason: 'UNASSIGNED' | 'OVERDUE' | 'CRITICAL' | 'DISPUTED' | 'STAFF_REQUEST' | 'EVIDENCE_REVIEW', key: string, note: string, actorId: string | null, now: Date) {
  const row = await one(q, `INSERT INTO incident_escalations (incident_id, reason, escalation_key, note, raised_by, at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (incident_id, escalation_key) DO NOTHING RETURNING id`, [
    i.id, reason, key, note, actorId, now,
  ]);
  if (!row) return false;
  await q.query('UPDATE incidents SET escalated_at = $2, updated_at = $2 WHERE id = $1', [i.id, now]);
  await appendEvent(q, i.id, { kind: 'ESCALATED', visibility: 'INTERNAL', body: note, data: { reason }, actorId }, now);
  await tellEach(q, await adminIds(q, i.township_id), { priority: 'URGENT', title: `Escalated: ${title(i)}`, body: note, link: staffLink(i) }, `incident-escalated:${i.id}:${key}`);
  return true;
}

// --- Staff actions -----------------------------------------------------------------------------

function requireStaff(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw forbidden();
}
const isAdmin = (actor: Actor) => ADMINS.includes(actor.role);

async function load(q: Queryable, actor: Actor, id: string): Promise<IncidentRow> {
  const i = await one<IncidentRow>(q, 'SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [id]);
  if (!i || (actor.role !== 'HQ_ADMIN' && i.township_id !== actor.townshipId)) throw notFound('Case');
  return i;
}

function move(i: IncidentRow, to: IncidentStatus) {
  if (!canMoveIncident(i.status, to)) throw conflict('CASE_STATE', `This case is “${INCIDENT_STATUS_LABELS[i.status].toLowerCase()}” and cannot move to “${INCIDENT_STATUS_LABELS[to].toLowerCase()}”.`);
}

/** Only the case's owner, or an admin, works on an assigned case. */
function requireOwner(actor: Actor, i: IncidentRow) {
  if (i.owner_id !== actor.id && !isAdmin(actor)) throw forbidden('Only the person handling this case, or an admin, can do this.');
}

/** "I'll handle this". Only one of two people taking the same case at once succeeds. */
export async function claimIncident(db: Db, actor: Actor, id: string, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    const taken = await one<IncidentRow>(
      tx,
      `UPDATE incidents SET owner_id = $2, assigned_at = $3, status = 'ASSIGNED', updated_at = $3
        WHERE id = $1 AND owner_id IS NULL AND status IN ('OPEN', 'REOPENED') RETURNING *`,
      [i.id, actor.id, now],
    );
    if (!taken) throw conflict('ALREADY_TAKEN', 'Someone else is already handling this case.');
    await appendEvent(tx, i.id, { kind: 'ASSIGNED', visibility: 'INTERNAL', body: `${actor.fullName} is handling this case.`, data: { owner: actor.id, claimed: true }, actorId: actor.id }, now);
    await appendEvent(tx, i.id, { kind: 'ASSIGNED', visibility: 'RESIDENT', body: 'A member of the township office is now handling your report.' }, now);
    await audit(tx, actor.id, 'INCIDENT_CLAIMED', 'incident', i.id);
    return { ok: true };
  });
}

/** An admin gives the case to someone, or moves it from one person to another with a reason. */
export async function assignIncident(db: Db, actor: Actor, id: string, input: { ownerId: string; reason?: string }, now: Date) {
  if (!isAdmin(actor)) throw forbidden('Only an admin can assign or reassign a case.');
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    if (i.status === 'RESOLVED' || i.status === 'CLOSED') throw conflict('CASE_STATE', 'This case is no longer open.');
    const to = await one<{ id: string; full_name: string }>(
      tx, `SELECT id, full_name FROM users WHERE id = $1 AND township_id = $2 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`, [input.ownerId, i.township_id],
    );
    if (!to) throw notFound('Staff member');
    if (to.id === i.owner_id) throw conflict('SAME_OWNER', 'This person already handles the case.');
    if (i.owner_id && !input.reason?.trim()) throw ruleViolation('REASON_NEEDED', 'Say why the case is moving to someone else.');
    const status: IncidentStatus = i.status === 'OPEN' || i.status === 'REOPENED' ? 'ASSIGNED' : i.status;
    await tx.query('UPDATE incidents SET owner_id = $2, assigned_at = $3, status = $4, updated_at = $3 WHERE id = $1', [i.id, to.id, now, status]);
    await appendEvent(tx, i.id, {
      kind: i.owner_id ? 'REASSIGNED' : 'ASSIGNED', visibility: 'INTERNAL', body: i.owner_id ? `Moved to ${to.full_name}: ${input.reason!.trim()}` : `Assigned to ${to.full_name}.`,
      data: { from: i.owner_id, to: to.id, reason: input.reason?.trim() ?? null }, actorId: actor.id,
    }, now);
    await notify(tx, [to.id], { title: `Case for you: ${title(i)}`, body: i.summary, link: staffLink(i), dedupeKey: `incident-assigned:${i.id}:${to.id}:${now.getTime()}` });
    await audit(tx, actor.id, i.owner_id ? 'INCIDENT_REASSIGNED' : 'INCIDENT_ASSIGNED', 'incident', i.id, { from: i.owner_id, to: to.id, reason: input.reason });
    return { ok: true };
  });
}

/** Investigating, or waiting for someone outside the township office (the resident is asked through requestInfo). */
export async function setIncidentStatus(db: Db, actor: Actor, id: string, input: { status: 'INVESTIGATING' | 'AWAITING_EXTERNAL_PARTY'; awaiting?: Exclude<Awaiting, 'RESIDENT'>; note?: string }, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    requireOwner(actor, i);
    move(i, input.status);
    const awaiting = input.status === 'AWAITING_EXTERNAL_PARTY' ? input.awaiting ?? 'OTHER' : null;
    await tx.query('UPDATE incidents SET status = $2, awaiting = $3, updated_at = $4 WHERE id = $1', [i.id, input.status, awaiting, now]);
    await appendEvent(tx, i.id, { kind: 'STATUS', visibility: 'INTERNAL', body: input.note?.trim() || null, data: { to: input.status, awaiting }, actorId: actor.id }, now);
    if (awaiting === 'COURIER') await appendEvent(tx, i.id, { kind: 'STATUS', visibility: 'RESIDENT', body: 'The township office has asked the courier company about this and is waiting for its answer.' }, now);
    return { ok: true };
  });
}

/** A note only staff see. */
export async function addIncidentNote(db: Db, actor: Actor, id: string, body: string, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    await appendEvent(tx, i.id, { kind: 'NOTE', visibility: 'INTERNAL', body: body.trim(), actorId: actor.id }, now);
    await tx.query('UPDATE incidents SET updated_at = $2 WHERE id = $1', [i.id, now]);
    return { ok: true };
  });
}

/** A message the resident sees, and is told about. */
export async function updateResident(db: Db, actor: Actor, id: string, body: string, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    if (!i.user_id) throw ruleViolation('NO_REPORTER', 'Nobody reported this case, so there is nobody to update.');
    requireOwner(actor, i);
    await appendEvent(tx, i.id, { kind: 'RESIDENT_UPDATE', visibility: 'RESIDENT', body: body.trim(), actorId: actor.id }, now);
    await tx.query('UPDATE incidents SET updated_at = $2 WHERE id = $1', [i.id, now]);
    await tellReporter(tx, i, { title: `Update on your report ${i.reference}`, body: body.trim() }, `incident-update:${i.id}:${now.getTime()}`);
    return { ok: true };
  });
}

/** Asks the resident for more details. The case waits for them, and the owner is told when they answer. */
export async function requestInfo(db: Db, actor: Actor, id: string, question: string, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    if (!i.user_id) throw ruleViolation('NO_REPORTER', 'Nobody reported this case, so there is nobody to ask.');
    requireOwner(actor, i);
    move(i, 'AWAITING_EXTERNAL_PARTY');
    await tx.query(`UPDATE incidents SET status = 'AWAITING_EXTERNAL_PARTY', awaiting = 'RESIDENT', updated_at = $2 WHERE id = $1`, [i.id, now]);
    await appendEvent(tx, i.id, { kind: 'INFO_REQUESTED', visibility: 'RESIDENT', body: question.trim(), actorId: actor.id }, now);
    await tellReporter(tx, i, { title: `We need a few more details (${i.reference})`, body: question.trim() }, `incident-info:${i.id}:${now.getTime()}`);
    return { ok: true };
  });
}

/** Records the outcome. Never touches the parcel, the locker or any code: those have their own authorised steps. */
export async function resolveIncident(
  db: Db, actor: Actor, id: string,
  input: { category: ResolutionCategory; outcome: string; actionsTaken: string; internalNote?: string }, now: Date,
) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    requireOwner(actor, i);
    if (i.status === 'AWAITING_EXTERNAL_PARTY' && i.awaiting === 'COURIER' && input.category !== 'REFERRED_TO_COURIER' && !input.internalNote?.trim()) {
      throw ruleViolation('STILL_WAITING', 'This case is waiting for the courier company. Note what it answered before resolving.');
    }
    move(i, 'RESOLVED');
    await tx.query(
      `UPDATE incidents SET status = 'RESOLVED', awaiting = NULL, resolution_category = $2, resident_outcome = $3, actions_taken = $4, resolution = coalesce($5, resolution),
              resolved_at = $6, handled_by = $7, updated_at = $6 WHERE id = $1`,
      [i.id, input.category, input.outcome.trim(), input.actionsTaken.trim(), input.internalNote?.trim() || null, now, actor.id],
    );
    await appendEvent(tx, i.id, { kind: 'RESOLVED', visibility: 'INTERNAL', body: input.internalNote?.trim() || input.actionsTaken.trim(), data: { category: input.category, actionsTaken: input.actionsTaken.trim() }, actorId: actor.id }, now);
    await appendEvent(tx, i.id, { kind: 'RESOLVED', visibility: 'RESIDENT', body: input.outcome.trim(), data: { category: input.category } }, now);
    await tellReporter(tx, i, { title: `Report ${i.reference}: ${RESOLUTION_LABELS[input.category]}`, body: input.outcome.trim() }, `incident-resolved:${i.id}:${i.reopen_count}`);
    await audit(tx, actor.id, 'INCIDENT_RESOLVED', 'incident', i.id, { category: input.category });
    return { ok: true };
  });
}

/** Staff ask an admin to step in. The owner keeps the case. */
export async function requestEscalation(db: Db, actor: Actor, id: string, note: string, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await load(tx, actor, id);
    if (!ACTIVE_STATUSES.includes(i.status)) throw conflict('CASE_STATE', 'This case is no longer open.');
    const n = (await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM incident_escalations WHERE incident_id = $1 AND reason = 'STAFF_REQUEST'`, [i.id]))!.n;
    await escalate(tx, i, 'STAFF_REQUEST', `staff:${n + 1}`, `${actor.fullName} asked for an admin: ${note.trim()}`, actor.id, now);
    return { ok: true };
  });
}

// --- The reporter -----------------------------------------------------------------------------

async function ownCase(q: Queryable, actor: Actor, reference: string): Promise<IncidentRow> {
  const i = await one<IncidentRow>(q, 'SELECT * FROM incidents WHERE reference = $1 AND user_id = $2 FOR UPDATE', [reference, actor.id]);
  if (!i) throw notFound('Report');
  return i;
}

/** The reporter answers a question from staff. */
export async function replyToIncident(db: Db, actor: Actor, reference: string, body: string, now: Date) {
  return db.tx(async (tx) => {
    const i = await ownCase(tx, actor, reference);
    if (i.status === 'CLOSED') throw conflict('CASE_STATE', 'This report is closed.');
    await appendEvent(tx, i.id, { kind: 'RESIDENT_REPLY', visibility: 'RESIDENT', body: body.trim(), actorId: actor.id }, now);
    if (i.status === 'AWAITING_EXTERNAL_PARTY' && i.awaiting === 'RESIDENT') {
      await tx.query(`UPDATE incidents SET status = 'INVESTIGATING', awaiting = NULL, updated_at = $2 WHERE id = $1`, [i.id, now]);
    } else {
      await tx.query('UPDATE incidents SET updated_at = $2 WHERE id = $1', [i.id, now]);
    }
    const to = i.owner_id ? [i.owner_id] : await staffIds(tx, i.township_id);
    await tellEach(tx, to, { title: `Reply on ${i.reference}`, body: body.trim().slice(0, 200), link: staffLink(i) }, `incident-reply:${i.id}:${now.getTime()}`);
    return { ok: true };
  });
}

/** Not fixed after all: the reporter reopens a resolved case within the township's window. It goes back to its owner and to the admins. */
export async function reopenIncident(db: Db, actor: Actor, reference: string, reason: string, now: Date) {
  return db.tx(async (tx) => {
    const i = await ownCase(tx, actor, reference);
    move(i, 'REOPENED');
    const policy = await getIncidentPolicy(tx, i.township_id);
    if (!i.resolved_at || now.getTime() - i.resolved_at.getTime() > policy.dispute_days * 86_400_000) {
      throw ruleViolation('TOO_LATE', `A report can be reopened within ${policy.dispute_days} days of its outcome. Please report it again.`);
    }
    const count = i.reopen_count + 1;
    await tx.query(`UPDATE incidents SET status = 'REOPENED', reopen_count = $2, resolved_at = NULL, updated_at = $3 WHERE id = $1`, [i.id, count, now]);
    await appendEvent(tx, i.id, { kind: 'REOPENED', visibility: 'RESIDENT', body: reason.trim(), data: { round: count }, actorId: actor.id }, now);
    await escalate(tx, { ...i, status: 'REOPENED' }, 'DISPUTED', `disputed:${count}`, `The resident disputes the outcome: ${reason.trim()}`, actor.id, now);
    if (i.owner_id) await notify(tx, [i.owner_id], { priority: 'URGENT', title: `Reopened: ${title(i)}`, body: reason.trim().slice(0, 200), link: staffLink(i), dedupeKey: `incident-reopened:${i.id}:${count}` });
    await tellReporter(tx, i, { title: `Report ${i.reference} reopened`, body: 'The township office will look at it again.' }, `incident-reopened-resident:${i.id}:${count}`);
    return { ok: true };
  });
}
