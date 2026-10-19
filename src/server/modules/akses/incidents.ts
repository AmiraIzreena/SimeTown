import { ADMINS, STAFF, type PlaceKind } from '@/shared/domain';
import {
  ACCESS_ACTIVE, ACCESS_CATEGORY_INFO, ACCESS_STATUS_LABELS, canMoveAccess, escalatesToSdp, pickRule, resolveParty, verificationOutcome,
  type AccessCategory, type AccessIncidentStatus, type AccessPolicy, type Availability, type PartyKind,
} from '@/shared/akses';
import type { Priority } from '@/shared/incidents';
import type { Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { chain } from '../incidents/engine';
import { addMinutes, getIncidentPolicy } from '../incidents/policy';
import { notify } from '../notifications';
import { recordAction, rewardUserById } from '../rewards';
import { getSettings } from '../settings';
import { getAccessPolicy, partyRefs, townshipRules } from './config';

/**
 * The Akses+ incident workflow. A resident's report is validated, grouped with
 * any open incident for the same problem at the same place, classified and
 * routed by the township's rules to the organisation that runs the facility,
 * and given deadlines, all without a person approving it. The place's
 * availability follows its incidents; its accessibility verification does not.
 * A claimed fix is verified independently before the place shows as available
 * again. Anything automation cannot settle safely goes to the exception queue.
 */

export interface AccessIncident {
  id: string;
  reference: string;
  township_id: string;
  place_id: string;
  category: AccessCategory;
  priority: Priority;
  status: AccessIncidentStatus;
  blocks_access: boolean;
  party_id: string | null;
  routing: Record<string, unknown>;
  exception_reason: string | null;
  report_count: number;
  reporter_count: number;
  ack_due_at: Date | null;
  resolve_due_at: Date | null;
  verify_due_at: Date | null;
  assigned_at: Date | null;
  acknowledged_at: Date | null;
  confirmed_at: Date | null;
  confirmed_by: 'PARTY' | 'STAFF' | 'CORROBORATION' | null;
  resolution_submitted_at: Date | null;
  resolved_at: Date | null;
  reopen_count: number;
  escalated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PlaceRow { id: string; township_id: string; name: string; kind: PlaceKind; location: string; verification: string; availability: Availability; party_id: string | null }
interface PartyRow { id: string; name: string; kind: PartyKind; integration: 'IN_APP' | 'SIMULATED'; active: boolean }

/** Who is acting: a signed-in person, or a responsible party's own system. */
export type Acting = { kind: 'USER'; actor: Actor } | { kind: 'INTEGRATION'; partyId: string };

// --- History ----------------------------------------------------------------------------

export async function appendAccessEvent(
  q: Queryable, incidentId: string,
  e: { kind: string; visibility: 'INTERNAL' | 'PUBLIC'; body?: string | null; data?: Record<string, unknown>; actorId?: string | null; actorKind?: 'USER' | 'SYSTEM' | 'INTEGRATION' },
  now: Date,
) {
  const prev = await one<{ hash: string }>(q, 'SELECT hash FROM access_incident_events WHERE incident_id = $1 ORDER BY id DESC LIMIT 1', [incidentId]);
  const body = e.body ?? null;
  const data = e.data ?? {};
  const actorId = e.actorId ?? null;
  const hash = chain(prev?.hash ?? null, { incidentId, kind: e.kind, visibility: e.visibility, body, data, actorId, at: now });
  await q.query(
    `INSERT INTO access_incident_events (incident_id, kind, visibility, body, data, actor_id, actor_kind, at, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [incidentId, e.kind, e.visibility, body, JSON.stringify(data), actorId, e.actorKind ?? (actorId ? 'USER' : 'SYSTEM'), now, prev?.hash ?? null, hash],
  );
}

export async function accessHistoryIntact(q: Queryable, incidentId: string): Promise<boolean> {
  const rows = await q.query<{ kind: string; visibility: string; body: string | null; data: unknown; actor_id: string | null; at: Date; prev_hash: string | null; hash: string }>(
    'SELECT kind, visibility, body, data, actor_id, at, prev_hash, hash FROM access_incident_events WHERE incident_id = $1 ORDER BY id', [incidentId],
  );
  let prev: string | null = null;
  for (const r of rows) {
    if (r.prev_hash !== prev || chain(prev, { incidentId, kind: r.kind, visibility: r.visibility, body: r.body, data: r.data, actorId: r.actor_id, at: r.at }) !== r.hash) return false;
    prev = r.hash;
  }
  return true;
}

// --- Helpers ----------------------------------------------------------------------------

const residentLink = (ref: string) => `/app/akses#${ref}`;
export const staffLink = (ref: string) => `/console/access?ref=${ref}`;
const label = (i: Pick<AccessIncident, 'category' | 'reference'>) => `${ACCESS_CATEGORY_INFO[i.category].label} (${i.reference})`;

function move(i: AccessIncident, to: AccessIncidentStatus) {
  if (!canMoveAccess(i.status, to)) {
    throw conflict('INCIDENT_STATE', `This incident is “${ACCESS_STATUS_LABELS[i.status].toLowerCase()}” and cannot move to “${ACCESS_STATUS_LABELS[to].toLowerCase()}”.`);
  }
}

async function setStatus(q: Queryable, i: AccessIncident, to: AccessIncidentStatus, now: Date, by: { actorId?: string | null; actorKind?: 'USER' | 'SYSTEM' | 'INTEGRATION' } = {}, data: Record<string, unknown> = {}) {
  // An admin override is the one authorised exception to the allowed moves, and is recorded as one.
  if (!data.override) move(i, to);
  await q.query('UPDATE access_incidents SET status = $2, updated_at = $3 WHERE id = $1', [i.id, to, now]);
  await appendAccessEvent(q, i.id, { kind: 'STATUS', visibility: 'INTERNAL', data: { from: i.status, to, ...data }, actorId: by.actorId, actorKind: by.actorKind }, now);
  i.status = to;
}

async function loadIncident(q: Queryable, id: string, by: 'id' | 'reference' = 'id'): Promise<AccessIncident> {
  const i = await one<AccessIncident>(q, `SELECT * FROM access_incidents WHERE ${by} = $1 FOR UPDATE`, [id]);
  if (!i) throw notFound('Incident');
  return i;
}

const loadParty = (q: Queryable, id: string | null) => (id ? one<PartyRow>(q, 'SELECT id, name, kind, integration, active FROM access_parties WHERE id = $1', [id]) : Promise.resolve(undefined));

async function adminIds(q: Queryable, townshipId: string) {
  return (await q.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE'`, [townshipId])).map((r) => r.id);
}

async function reporterIds(q: Queryable, incidentId: string) {
  return (await q.query<{ reporter_id: string }>('SELECT DISTINCT reporter_id FROM access_reports WHERE incident_id = $1', [incidentId])).map((r) => r.reporter_id);
}

async function tellReporters(q: Queryable, i: AccessIncident, n: { title: string; body: string }, key: string) {
  for (const id of await reporterIds(q, i.id)) {
    await notify(q, [id], { ...n, link: residentLink(i.reference), category: 'REPORTS', dedupeKey: `${key}:${id}` });
  }
}

/** The resident-safe description sent to a party's own system: what and where, never who reported it. */
async function dispatchPayload(q: Queryable, i: AccessIncident) {
  const place = (await one<{ name: string; kind: string; location: string }>(q, 'SELECT name, kind, location FROM access_places WHERE id = $1', [i.place_id]))!;
  return { reference: i.reference, category: i.category, priority: i.priority, place: place.name, placeKind: place.kind, location: place.location, resolveBy: i.resolve_due_at };
}

/**
 * Tells the responsible party. Members of an in-app party get a notification
 * where they work; a party reached through an integration gets an outbox
 * message the `access` job delivers and retries.
 */
export async function tellParty(q: Queryable, i: AccessIncident, party: PartyRow, kind: 'ASSIGNMENT' | 'REMINDER' | 'REOPENED', n: { title: string; body: string }, key: string, now: Date) {
  if (party.integration === 'SIMULATED') {
    await q.query(
      `INSERT INTO access_dispatches (incident_id, party_id, kind, dedupe_key, payload, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (dedupe_key) DO NOTHING`,
      [i.id, party.id, kind, key, JSON.stringify({ ...(await dispatchPayload(q, i)), message: n.title }), now],
    );
    return;
  }
  const members = await q.query<{ user_id: string; role: string }>(
    `SELECT m.user_id, u.role FROM access_party_members m JOIN users u ON u.id = m.user_id WHERE m.party_id = $1 AND u.status = 'ACTIVE'`, [party.id],
  );
  const urgent = i.priority === 'CRITICAL' || i.priority === 'HIGH';
  for (const m of members) {
    await notify(q, [m.user_id], { ...n, priority: urgent ? 'URGENT' : 'NORMAL', link: m.role === 'GUARD' ? '/guard#access' : staffLink(i.reference), category: 'REPORTS', dedupeKey: `${key}:${m.user_id}` });
  }
}

const memberCount = async (q: Queryable, partyId: string) =>
  (await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM access_party_members m JOIN users u ON u.id = m.user_id WHERE m.party_id = $1 AND u.status = 'ACTIVE'`, [partyId]))!.n;

/**
 * Raises a reminder or an escalation once per incident and occasion. An
 * escalation that needs a decision moves the incident to ESCALATED (the party
 * can still act on it); informational ones (critical, recurring) only record
 * and alert. SDP admins are alerted only when it is within their authority.
 */
export async function escalateAccess(
  q: Queryable, i: AccessIncident,
  e: { reason: 'UNROUTED' | 'NOT_ACKNOWLEDGED' | 'OVERDUE' | 'CRITICAL' | 'DISPUTED' | 'RECURRING' | 'VERIFICATION_STALLED' | 'DISPATCH_FAILED'; level: 'REMINDER' | 'ESCALATION'; key: string; note: string; setStatus?: boolean },
  now: Date,
): Promise<boolean> {
  const row = await one(q, `INSERT INTO access_escalations (incident_id, reason, level, escalation_key, note, at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (incident_id, escalation_key) DO NOTHING RETURNING id`, [
    i.id, e.reason, e.level, e.key, e.note, now,
  ]);
  if (!row) return false;
  await appendAccessEvent(q, i.id, { kind: e.level === 'REMINDER' ? 'REMINDER' : 'ESCALATED', visibility: 'INTERNAL', body: e.note, data: { reason: e.reason } }, now);
  const party = await loadParty(q, i.party_id);
  if (e.level === 'REMINDER') {
    if (party) await tellParty(q, i, party, 'REMINDER', { title: `Reminder: ${label(i)}`, body: e.note }, `access-reminder:${i.id}:${e.key}`, now);
    return true;
  }
  await q.query('UPDATE access_incidents SET escalated_at = $2, updated_at = $2 WHERE id = $1', [i.id, now]);
  i.escalated_at = now;
  if (e.setStatus && i.status !== 'ESCALATED' && canMoveAccess(i.status, 'ESCALATED')) await setStatus(q, i, 'ESCALATED', now, {}, { reason: e.reason });
  if (escalatesToSdp(party?.kind ?? null, i.priority)) {
    for (const id of await adminIds(q, i.township_id)) {
      await notify(q, [id], { priority: 'URGENT', title: `Accessibility escalation: ${label(i)}`, body: e.note, link: staffLink(i.reference), category: 'REPORTS', dedupeKey: `access-escalated:${i.id}:${e.key}:${id}` });
    }
  } else if (party) {
    await tellParty(q, i, party, 'REMINDER', { title: `Escalated: ${label(i)}`, body: e.note }, `access-escalated:${i.id}:${e.key}`, now);
  }
  return true;
}

// --- Availability (separate from verification) -----------------------------------------------

/**
 * Works out a place's availability from its open incidents, so the resident
 * view, the console and the incidents always agree. A place becomes available
 * again only when its last blocking incident is resolved (verified), never
 * because the reports stopped. Verification is never touched here.
 */
export async function refreshAvailability(q: Queryable, placeId: string, now: Date, cause?: { incidentId: string }) {
  const place = (await one<{ name: string; availability: Availability }>(q, 'SELECT name, availability FROM access_places WHERE id = $1 FOR UPDATE', [placeId]))!;
  const open = await q.query<{ confirmed_at: Date | null; resolution_submitted_at: Date | null }>(
    `SELECT confirmed_at, resolution_submitted_at FROM access_incidents WHERE place_id = $1 AND blocks_access AND status <> 'RESOLVED'`, [placeId],
  );
  const current = place.availability;
  let next: Availability;
  if (open.some((r) => !r.resolution_submitted_at && r.confirmed_at)) next = 'CONFIRMED_BLOCKED';
  else if (open.some((r) => !r.resolution_submitted_at)) next = 'REPORTED_BLOCKED';
  else if (open.length) next = 'RESOLUTION_PENDING';
  else next = current === 'REPORTED_BLOCKED' || current === 'CONFIRMED_BLOCKED' || current === 'RESOLUTION_PENDING' ? 'AVAILABLE' : current;
  if (next === current) return current;
  await q.query('UPDATE access_places SET availability = $2, availability_changed_at = $3, updated_at = $3 WHERE id = $1', [placeId, next, now]);
  if (next === 'RESOLUTION_PENDING') return next;
  // People following the place hear about it once per change. Those who reported the problem hear through their report instead.
  const skip = cause ? await reporterIds(q, cause.incidentId) : [];
  const followers = (await q.query<{ user_id: string }>('SELECT user_id FROM access_place_follows WHERE place_id = $1', [placeId])).map((r) => r.user_id).filter((id) => !skip.includes(id));
  const text = {
    REPORTED_BLOCKED: { title: `Reported blocked: ${place.name}`, body: 'Residents have reported a problem. It is not confirmed yet; plan another way if you can.' },
    CONFIRMED_BLOCKED: { title: `Confirmed blocked: ${place.name}`, body: 'The team responsible has confirmed the problem and is working on it.' },
    AVAILABLE: { title: `Available again: ${place.name}`, body: 'The problem has been fixed and checked.' },
    UNKNOWN: null,
  }[next];
  if (text) await notify(q, followers, { ...text, link: '/app/akses', category: 'ALERTS', dedupeKey: `access-availability:${placeId}:${next}:${now.getTime()}` });
  return next;
}

// --- Intake: a resident reports a problem ---------------------------------------------------

export interface ReportInput { category: AccessCategory; description?: string; photo?: Photo; idempotencyKey: string }

async function storePhoto(q: Queryable, ownerId: string, photo: Photo): Promise<string> {
  const row = await one<{ id: string }>(q, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [ownerId, photo.mime, photo.bytes.length, Buffer.from(photo.bytes)]);
  return row!.id;
}

async function deadlinesFor(q: Queryable, townshipId: string, priority: Priority, policy: AccessPolicy, start: Date) {
  const workdays = await getIncidentPolicy(q, townshipId);
  const tz = (await getSettings(q)).timezone;
  const t = policy.targets[priority];
  return { ack: addMinutes(start, t.ack, t, workdays, tz), resolve: addMinutes(start, t.resolve, t, workdays, tz) };
}

/**
 * Sends the incident to its party, or to the exception queue with the reason.
 * Called on a new incident, a reopened one, and when an admin picks a party.
 */
async function route(q: Queryable, i: AccessIncident, place: PlaceRow, policy: AccessPolicy, now: Date, chosen?: { partyId: string; actorId: string; reason: string }) {
  let partyId: string | null = null;
  let exception: string | null = null;
  let routing: Record<string, unknown> = i.routing;
  if (chosen) {
    partyId = chosen.partyId;
    routing = { ...i.routing, manual: { by: chosen.actorId, reason: chosen.reason } };
  } else {
    const rule = pickRule(await townshipRules(q, i.township_id), i.category, place.kind);
    const decided = resolveParty(rule, place.party_id, await partyRefs(q, i.township_id));
    routing = { rule: { source: rule.source, category: rule.category, placeKind: rule.placeKind, target: rule.target }, ...('partyId' in decided ? { partyId: decided.partyId } : { exception: decided.exception }) };
    if ('partyId' in decided) partyId = decided.partyId;
    else exception = decided.exception;
  }
  const party = await loadParty(q, partyId);
  if (party && party.integration === 'IN_APP' && (await memberCount(q, party.id)) === 0) {
    exception = `Nobody is set up to act for ${party.name}.`;
    partyId = null;
  }
  if (!party || !partyId) {
    await q.query('UPDATE access_incidents SET party_id = NULL, routing = $2, exception_reason = $3, updated_at = $4 WHERE id = $1', [i.id, JSON.stringify(routing), exception, now]);
    i.party_id = null;
    await escalateAccess(q, i, { reason: 'UNROUTED', level: 'ESCALATION', key: `unrouted:${i.reopen_count}:${now.getTime()}`, note: `Could not be routed automatically: ${exception ?? 'no party'}`, setStatus: true }, now);
    return;
  }
  const due = await deadlinesFor(q, i.township_id, i.priority, policy, now);
  await q.query(
    `UPDATE access_incidents SET party_id = $2, routing = $3, exception_reason = NULL, assigned_at = $4, acknowledged_at = NULL, ack_due_at = $5,
            resolve_due_at = CASE WHEN resolve_due_at IS NULL OR $7 THEN $6 ELSE resolve_due_at END, updated_at = $4 WHERE id = $1`,
    [i.id, party.id, JSON.stringify(routing), now, due.ack, due.resolve, i.status === 'REOPENED'],
  );
  Object.assign(i, { party_id: party.id, assigned_at: now, acknowledged_at: null, ack_due_at: due.ack });
  if (i.status !== 'ASSIGNED') await setStatus(q, i, 'ASSIGNED', now, { actorId: chosen?.actorId ?? null }, { partyId: party.id });
  await appendAccessEvent(q, i.id, { kind: 'ASSIGNED', visibility: 'PUBLIC', body: `Sent to ${party.name}.`, data: { partyId: party.id, manual: Boolean(chosen) }, actorId: chosen?.actorId ?? null }, now);
  await tellParty(q, i, party, i.reopen_count > 0 && !chosen ? 'REOPENED' : 'ASSIGNMENT', {
    title: i.reopen_count > 0 ? `Reopened accessibility issue: ${label(i)}` : `New accessibility issue: ${label(i)}`,
    body: `${place.name}, ${place.location}. Please acknowledge it.`,
  }, `access-assigned:${i.id}:${party.id}:${i.reopen_count}`, now);
}

/** Many separate residents reporting the same problem confirm it, without waiting for anyone. */
async function corroborate(q: Queryable, i: AccessIncident, policy: AccessPolicy, now: Date) {
  if (!i.blocks_access || i.confirmed_at || i.reporter_count < policy.corroboration) return;
  await q.query(`UPDATE access_incidents SET confirmed_at = $2, confirmed_by = 'CORROBORATION' WHERE id = $1`, [i.id, now]);
  i.confirmed_at = now;
  await appendAccessEvent(q, i.id, { kind: 'CONFIRMED', visibility: 'PUBLIC', body: `Confirmed by ${i.reporter_count} separate residents.`, data: { basis: 'CORROBORATION' } }, now);
}

/** Enough residents saying a listing is wrong put its verification in question; it is never removed on their word alone. */
async function questionListing(q: Queryable, i: AccessIncident, policy: AccessPolicy, now: Date) {
  if (i.category !== 'MISINFORMATION' || i.reporter_count < policy.misinformation) return;
  const changed = await q.query(`UPDATE access_places SET verification = 'VERIFICATION_REQUIRED', updated_at = $2 WHERE id = $1 AND verification = 'VERIFIED' RETURNING id`, [i.place_id, now]);
  if (changed.length) await appendAccessEvent(q, i.id, { kind: 'VERIFICATION_REQUIRED', visibility: 'PUBLIC', body: 'The listing will be checked again.', data: { reporters: i.reporter_count } }, now);
}

export async function reportIssue(db: Db, actor: Actor, placeId: string, input: ReportInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  const info = ACCESS_CATEGORY_INFO[input.category];
  if (!info) throw notFound('Category');
  if (info.needsNote && !input.description?.trim()) throw ruleViolation('NOTE_NEEDED', 'Please describe the problem.', { fields: { description: 'Tell us what is wrong.' } });
  return db.tx(async (tx) => {
    const place = await one<PlaceRow>(
      tx, 'SELECT id, township_id, name, kind, location, verification, availability, party_id FROM access_places WHERE id = $1 AND township_id = $2 AND archived_at IS NULL FOR UPDATE',
      [placeId, resident.townshipId],
    );
    if (!place) throw notFound('Place');
    // The same submission sent twice (a double tap, a retry) is one report.
    const replay = await one<{ reference: string }>(
      tx, 'SELECT i.reference FROM access_reports r JOIN access_incidents i ON i.id = r.incident_id WHERE r.reporter_id = $1 AND r.idempotency_key = $2', [resident.id, input.idempotencyKey],
    );
    if (replay) return { reference: replay.reference, outcome: 'ALREADY_RECEIVED' as const };
    const policy = await getAccessPolicy(tx, place.township_id);

    const insertReport = async (incidentId: string) => {
      const photoId = input.photo ? await storePhoto(tx, resident.id, input.photo) : null;
      await tx.query(
        `INSERT INTO access_reports (incident_id, place_id, reporter_id, category, description, photo_id, idempotency_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [incidentId, place.id, resident.id, input.category, input.description?.trim() || null, photoId, input.idempotencyKey, now],
      );
    };

    // 1. The same problem already open at this place: add to it.
    const open = await one<AccessIncident>(tx, `SELECT * FROM access_incidents WHERE place_id = $1 AND category = $2 AND status <> 'RESOLVED' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [place.id, input.category]);
    if (open) {
      const mine = await one(tx, 'SELECT 1 FROM access_reports WHERE incident_id = $1 AND reporter_id = $2', [open.id, resident.id]);
      if (mine) return { reference: open.reference, outcome: 'ALREADY_REPORTED' as const };
      await insertReport(open.id);
      const counts = (await one<{ report_count: number; reporter_count: number }>(
        tx, `UPDATE access_incidents SET report_count = report_count + 1, reporter_count = reporter_count + 1, updated_at = $2 WHERE id = $1 RETURNING report_count, reporter_count`, [open.id, now],
      ))!;
      Object.assign(open, counts);
      await appendAccessEvent(tx, open.id, { kind: 'REPORT_ADDED', visibility: 'PUBLIC', body: 'Another resident reported the same problem.', data: { reporters: counts.reporter_count } }, now);
      await corroborate(tx, open, policy, now);
      await questionListing(tx, open, policy, now);
      await refreshAvailability(tx, place.id, now, { incidentId: open.id });
      await notify(tx, [resident.id], {
        title: `Added to ${open.reference}`, body: `This problem at ${place.name} is already being handled. We will tell you when it changes.`,
        link: residentLink(open.reference), category: 'REPORTS', dedupeKey: `access-linked:${open.id}:${resident.id}`,
      });
      return { reference: open.reference, outcome: 'LINKED' as const };
    }

    // 2. Fixed recently, but reported again: the fix did not hold, so the incident reopens.
    const recent = await one<AccessIncident>(
      tx, `SELECT * FROM access_incidents WHERE place_id = $1 AND category = $2 AND status = 'RESOLVED' AND resolved_at > $3 ORDER BY resolved_at DESC LIMIT 1 FOR UPDATE`,
      [place.id, input.category, new Date(now.getTime() - policy.disputeDays * 86_400_000)],
    );
    if (recent) {
      await insertReport(recent.id);
      const mine = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM access_reports WHERE incident_id = $1 AND reporter_id = $2', [recent.id, resident.id]);
      await tx.query(`UPDATE access_incidents SET report_count = report_count + 1, reporter_count = reporter_count + $2 WHERE id = $1`, [recent.id, mine!.n === 1 ? 1 : 0]);
      await reopen(tx, recent, place, policy, { actorId: resident.id, reason: input.description?.trim() || 'Reported again after it was fixed.' }, now);
      return { reference: recent.reference, outcome: 'REOPENED' as const };
    }

    // 3. A new incident: received, triaged, routed.
    const i = (await one<AccessIncident>(
      tx,
      `INSERT INTO access_incidents (township_id, place_id, category, priority, status, blocks_access, report_count, reporter_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'NORMAL', 'REPORTED', $4, 1, 1, $5, $5) RETURNING *`,
      [place.township_id, place.id, input.category, info.blocks, now],
    ))!;
    await insertReport(i.id);
    await appendAccessEvent(tx, i.id, { kind: 'REPORTED', visibility: 'PUBLIC', body: 'Report received.', data: { category: i.category }, actorId: resident.id }, now);

    const rule = pickRule(await townshipRules(tx, i.township_id), i.category, place.kind);
    const due = await deadlinesFor(tx, i.township_id, rule.priority, policy, now);
    await tx.query('UPDATE access_incidents SET priority = $2, resolve_due_at = $3 WHERE id = $1', [i.id, rule.priority, due.resolve]);
    Object.assign(i, { priority: rule.priority, resolve_due_at: due.resolve });
    await setStatus(tx, i, 'TRIAGED', now, {}, { priority: rule.priority, rule: { source: rule.source, category: rule.category, placeKind: rule.placeKind } });
    await route(tx, i, place, policy, now);

    if (i.priority === 'CRITICAL') {
      await escalateAccess(tx, i, { reason: 'CRITICAL', level: 'ESCALATION', key: 'critical', note: `Critical accessibility problem at ${place.name}.` }, now);
    }
    const since = new Date(now.getTime() - policy.recurring.days * 86_400_000);
    const recurring = (await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM access_incidents WHERE place_id = $1 AND created_at >= $2', [place.id, since]))!.n;
    if (recurring >= policy.recurring.incidents) {
      await escalateAccess(tx, i, {
        reason: 'RECURRING', level: 'ESCALATION', key: 'recurring',
        note: `${recurring} problems reported at ${place.name} in ${policy.recurring.days} days. It may need a lasting fix.`,
      }, now);
    }
    await questionListing(tx, i, policy, now);
    await refreshAvailability(tx, place.id, now, { incidentId: i.id });
    await notify(tx, [resident.id], {
      title: `Report received: ${i.reference}`,
      body: i.party_id ? 'It has been sent to the team responsible. We will tell you when it changes.' : 'The township office will decide who handles it. We will tell you when it changes.',
      link: residentLink(i.reference), category: 'REPORTS', dedupeKey: `access-received:${i.id}:${resident.id}`,
    });
    return { reference: i.reference, outcome: 'CREATED' as const };
  });
}

async function reopen(q: Queryable, i: AccessIncident, place: PlaceRow, policy: AccessPolicy, by: { actorId: string; reason: string }, now: Date) {
  move(i, 'REOPENED');
  const round = i.reopen_count + 1;
  // The problem is back on a resident's word: reported, not yet confirmed, until the party checks again.
  await q.query(
    `UPDATE access_incidents SET status = 'REOPENED', reopen_count = $2, resolved_at = NULL, confirmed_at = NULL, confirmed_by = NULL, resolution_submitted_at = NULL,
            verify_due_at = NULL, updated_at = $3 WHERE id = $1`, [i.id, round, now],
  );
  await appendAccessEvent(q, i.id, { kind: 'REOPENED', visibility: 'PUBLIC', body: by.reason, data: { round }, actorId: by.actorId }, now);
  Object.assign(i, { status: 'REOPENED', reopen_count: round, resolved_at: null, confirmed_at: null, resolution_submitted_at: null });
  await route(q, i, place, policy, now);
  if (round >= 2) {
    await escalateAccess(q, i, { reason: 'DISPUTED', level: 'ESCALATION', key: `reopened:${round}`, note: `Reopened ${round} times: the fixes are not holding.`, setStatus: true }, now);
  }
  await refreshAvailability(q, place.id, now, { incidentId: i.id });
  await tellReporters(q, i, { title: `Reopened: ${i.reference}`, body: 'The problem was reported again. It is back with the team responsible.' }, `access-reopened:${i.id}:${round}`);
}

// --- The responsible party ----------------------------------------------------------------------

/** Members of the incident's party act for it; an admin may act on its behalf (recorded as such). */
async function authorise(q: Queryable, acting: Acting, i: AccessIncident): Promise<{ actorId: string | null; actorKind: 'USER' | 'INTEGRATION'; source: 'IN_APP' | 'SIMULATED_INTEGRATION' | 'STAFF_ON_BEHALF' }> {
  if (acting.kind === 'INTEGRATION') {
    if (acting.partyId !== i.party_id) throw forbidden('This incident is not assigned to that organisation.');
    return { actorId: null, actorKind: 'INTEGRATION', source: 'SIMULATED_INTEGRATION' };
  }
  const { actor } = acting;
  if (actor.role !== 'HQ_ADMIN' && actor.townshipId !== i.township_id) throw notFound('Incident');
  if (i.party_id && (await one(q, 'SELECT 1 FROM access_party_members WHERE party_id = $1 AND user_id = $2', [i.party_id, actor.id]))) {
    return { actorId: actor.id, actorKind: 'USER', source: 'IN_APP' };
  }
  if (ADMINS.includes(actor.role)) return { actorId: actor.id, actorKind: 'USER', source: 'STAFF_ON_BEHALF' };
  throw forbidden('Only the team this incident is assigned to, or an admin, can do this.');
}

/** The party confirms the problem and starts work. A blocking problem now shows as confirmed. Call inside a transaction. */
export async function acknowledgeIncident(q: Queryable, acting: Acting, incidentId: string, now: Date) {
  const i = await loadIncident(q, incidentId);
  const who = await authorise(q, acting, i);
  if (!i.party_id) throw ruleViolation('NOT_ASSIGNED', 'Assign the incident to a team first.');
  await setStatus(q, i, 'IN_PROGRESS', now, who);
  await q.query(
    `UPDATE access_incidents SET acknowledged_at = $2, confirmed_at = coalesce(confirmed_at, CASE WHEN blocks_access THEN $2::timestamptz END),
            confirmed_by = coalesce(confirmed_by, CASE WHEN blocks_access THEN 'PARTY' END) WHERE id = $1`, [i.id, now],
  );
  const party = (await loadParty(q, i.party_id))!;
  await appendAccessEvent(q, i.id, { kind: 'ACKNOWLEDGED', visibility: 'PUBLIC', body: `${party.name} confirmed the problem and is working on it.`, data: { source: who.source }, actorId: who.actorId, actorKind: who.actorKind }, now);
  if (who.source === 'STAFF_ON_BEHALF') await audit(q, who.actorId, 'ACCESS_ACK_ON_BEHALF', 'access_incident', i.id, { partyId: party.id });
  await refreshAvailability(q, i.place_id, now, { incidentId: i.id });
  await tellReporters(q, i, { title: `Being fixed: ${i.reference}`, body: `${party.name} confirmed the problem and is working on it.` }, `access-ack:${i.id}:${i.reopen_count}`);
  // A confirmed report earns the first reporter Impact XP, once.
  const first = await one<{ reporter_id: string }>(q, 'SELECT reporter_id FROM access_reports WHERE incident_id = $1 ORDER BY created_at LIMIT 1', [i.id]);
  const reporter = first ? await rewardUserById(q, first.reporter_id) : null;
  if (reporter) await recordAction(q, { user: reporter, activity: 'AKSES_UPDATE', ref: `access-incident:${i.id}`, now });
  return { status: i.status };
}

/**
 * The party says it is fixed. The evidence is checked against the policy, and
 * the incident is resolved at once only when verification is already
 * satisfied (the facility's own system reports it back in service); otherwise
 * it waits for residents or staff to confirm. Call inside a transaction.
 */
export async function submitResolution(
  q: Queryable, acting: Acting, incidentId: string, input: { actionTaken: string; photo?: Photo; telemetry?: boolean }, now: Date,
) {
  const i = await loadIncident(q, incidentId);
  const who = await authorise(q, acting, i);
  if (!i.party_id) throw ruleViolation('NOT_ASSIGNED', 'Assign the incident to a team first.');
  const policy = await getAccessPolicy(q, i.township_id);
  const telemetry = Boolean(input.telemetry) && who.source === 'SIMULATED_INTEGRATION';
  if (!input.photo && !telemetry && policy.photoRequired.includes(i.category)) {
    throw ruleViolation('PHOTO_NEEDED', 'Add a photo showing the problem is fixed.', { fields: { photo: 'A photo is needed for this kind of problem.' } });
  }
  await setStatus(q, i, 'RESOLUTION_SUBMITTED', now, who);
  const photoId = input.photo && who.actorId ? await storePhoto(q, who.actorId, input.photo) : null;
  const resolution = (await one<{ id: string }>(
    q, `INSERT INTO access_resolutions (incident_id, party_id, submitted_by, source, action_taken, photo_id, telemetry, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [i.id, i.party_id, who.actorId, who.source, input.actionTaken.trim(), photoId, telemetry, now],
  ))!;
  const verifyDue = new Date(now.getTime() + policy.verifyHours * 3_600_000);
  await q.query('UPDATE access_incidents SET resolution_submitted_at = $2, verify_due_at = $3 WHERE id = $1', [i.id, now, verifyDue]);
  Object.assign(i, { resolution_submitted_at: now, verify_due_at: verifyDue });
  const party = (await loadParty(q, i.party_id))!;
  await appendAccessEvent(q, i.id, {
    kind: 'RESOLUTION_SUBMITTED', visibility: 'PUBLIC', body: `${party.name} reports it is fixed: ${input.actionTaken.trim()}`,
    data: { resolutionId: resolution.id, photo: Boolean(photoId), telemetry, source: who.source }, actorId: who.actorId, actorKind: who.actorKind,
  }, now);
  if (who.source === 'STAFF_ON_BEHALF') await audit(q, who.actorId, 'ACCESS_RESOLUTION_ON_BEHALF', 'access_incident', i.id, { partyId: party.id });
  return evaluate(q, i, resolution.id, policy, now);
}

/** Applies the verification rules to the current claimed fix. */
async function evaluate(q: Queryable, i: AccessIncident, resolutionId: string, policy: AccessPolicy, now: Date) {
  const r = (await one<{ telemetry: boolean; clear: number; still: number }>(
    q,
    `SELECT r.telemetry, count(*) FILTER (WHERE c.answer = 'CLEAR')::int AS clear, count(*) FILTER (WHERE c.answer = 'STILL_BLOCKED')::int AS still
       FROM access_resolutions r LEFT JOIN access_confirmations c ON c.resolution_id = r.id WHERE r.id = $1 GROUP BY r.id`, [resolutionId],
  ))!;
  const outcome = verificationOutcome({ priority: i.priority, clear: r.clear, stillBlocked: r.still, telemetry: r.telemetry }, policy);
  if (outcome === 'RESOLVED') {
    await finalize(q, i, resolutionId, r.telemetry && r.clear === 0 ? 'Reported back in service by the facility’s own system.' : r.clear === 1 ? 'Confirmed by a resident.' : `Confirmed by ${r.clear} residents.`, null, now);
    return { status: i.status };
  }
  if (outcome === 'DISPUTED') {
    await rejectResolution(q, i, resolutionId, 'A resident says it is still blocked.', null, now);
    return { status: i.status };
  }
  if (i.status === 'RESOLUTION_SUBMITTED') {
    await setStatus(q, i, 'VERIFICATION_PENDING', now);
    await refreshAvailability(q, i.place_id, now, { incidentId: i.id });
    const ask = { title: `Is it clear now? ${i.reference}`, body: 'The team responsible says the problem is fixed. Tell us if it is, or if it is still blocked.' };
    await tellReporters(q, i, ask, `access-verify:${resolutionId}`);
    const followers = (await q.query<{ user_id: string }>('SELECT user_id FROM access_place_follows WHERE place_id = $1', [i.place_id])).map((x) => x.user_id);
    const reporters = await reporterIds(q, i.id);
    await notify(q, followers.filter((id) => !reporters.includes(id)), { ...ask, link: residentLink(i.reference), category: 'REPORTS', dedupeKey: `access-verify-follow:${resolutionId}` });
  }
  return { status: i.status };
}

async function finalize(q: Queryable, i: AccessIncident, resolutionId: string | null, basis: string, decidedBy: string | null, now: Date, override = false) {
  if (resolutionId) await q.query(`UPDATE access_resolutions SET outcome = 'ACCEPTED', decided_by = $2, decision_basis = $3, decided_at = $4 WHERE id = $1`, [resolutionId, decidedBy, basis, now]);
  await setStatus(q, i, 'RESOLVED', now, { actorId: decidedBy }, { basis, ...(override ? { override: true } : {}) });
  await q.query('UPDATE access_incidents SET resolved_at = $2, resolution_submitted_at = NULL, verify_due_at = NULL WHERE id = $1', [i.id, now]);
  Object.assign(i, { resolved_at: now, resolution_submitted_at: null });
  await appendAccessEvent(q, i.id, { kind: 'RESOLVED', visibility: 'PUBLIC', body: `Fixed and verified. ${basis}`, data: { resolutionId }, actorId: decidedBy }, now);
  await refreshAvailability(q, i.place_id, now, { incidentId: i.id });
  const policy = await getAccessPolicy(q, i.township_id);
  await tellReporters(q, i, {
    title: `Fixed and verified: ${i.reference}`, body: `If the problem comes back within ${policy.disputeDays} days, tell us from Akses+ and it reopens.`,
  }, `access-resolved:${i.id}:${i.reopen_count}`);
}

async function rejectResolution(q: Queryable, i: AccessIncident, resolutionId: string, why: string, decidedBy: string | null, now: Date) {
  await q.query(`UPDATE access_resolutions SET outcome = 'REJECTED', decided_by = $2, decision_basis = $3, decided_at = $4 WHERE id = $1`, [resolutionId, decidedBy, why, now]);
  await setStatus(q, i, 'IN_PROGRESS', now, { actorId: decidedBy }, { rejected: resolutionId });
  await q.query('UPDATE access_incidents SET resolution_submitted_at = NULL, verify_due_at = NULL WHERE id = $1', [i.id]);
  i.resolution_submitted_at = null;
  await appendAccessEvent(q, i.id, { kind: 'RESOLUTION_REJECTED', visibility: 'PUBLIC', body: `Not fixed yet: ${why}`, data: { resolutionId }, actorId: decidedBy }, now);
  await refreshAvailability(q, i.place_id, now, { incidentId: i.id });
  const rejected = (await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM access_resolutions WHERE incident_id = $1 AND outcome = 'REJECTED'`, [i.id]))!.n;
  const party = await loadParty(q, i.party_id);
  if (party) await tellParty(q, i, party, 'REOPENED', { title: `Fix not accepted: ${label(i)}`, body: why }, `access-rejected:${resolutionId}`, now);
  // A second disputed fix is no longer routine: someone with authority looks at it.
  if (rejected >= 2) {
    await escalateAccess(q, i, { reason: 'DISPUTED', level: 'ESCALATION', key: `disputed:${rejected}`, note: `${rejected} claimed fixes have been disputed. ${why}`, setStatus: true }, now);
  }
}

// --- Residents verify -----------------------------------------------------------------------------

async function pendingResolution(q: Queryable, i: AccessIncident) {
  return one<{ id: string; submitted_by: string | null }>(q, `SELECT id, submitted_by FROM access_resolutions WHERE incident_id = $1 AND outcome = 'PENDING' ORDER BY submitted_at DESC LIMIT 1`, [i.id]);
}

/** A resident says whether a claimed fix is real. One answer each; the person who submitted the fix cannot confirm it. */
export async function confirmFix(db: Db, actor: Actor, reference: string, input: { answer: 'CLEAR' | 'STILL_BLOCKED'; note?: string; photo?: Photo }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const i = await loadIncident(tx, reference, 'reference');
    if (i.township_id !== resident.townshipId) throw notFound('Incident');
    const r = await pendingResolution(tx, i);
    if (!r || !['VERIFICATION_PENDING', 'ESCALATED'].includes(i.status)) throw conflict('NOTHING_TO_CONFIRM', 'There is no fix waiting to be confirmed.');
    if (r.submitted_by === resident.id) throw forbidden('You cannot confirm your own fix.');
    if (input.answer === 'STILL_BLOCKED' && !input.note?.trim()) throw ruleViolation('NOTE_NEEDED', 'Say what is still wrong.', { fields: { note: 'Say what is still wrong.' } });
    const photoId = input.photo ? await storePhoto(tx, resident.id, input.photo) : null;
    const added = await tx.query(
      `INSERT INTO access_confirmations (resolution_id, user_id, answer, note, photo_id, at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING user_id`,
      [r.id, resident.id, input.answer, input.note?.trim() || null, photoId, now],
    );
    if (!added.length) throw conflict('ALREADY_ANSWERED', 'You have already answered for this fix.');
    await appendAccessEvent(tx, i.id, {
      kind: input.answer === 'CLEAR' ? 'CONFIRMED_CLEAR' : 'DISPUTED', visibility: 'PUBLIC',
      body: input.answer === 'CLEAR' ? 'A resident confirmed it is clear.' : `A resident says it is still blocked: ${input.note!.trim()}`, data: { resolutionId: r.id }, actorId: resident.id,
    }, now);
    const policy = await getAccessPolicy(tx, i.township_id);
    return evaluate(tx, i, r.id, policy, now);
  });
}

/** Not fixed after all: a reporter reopens a resolved incident within the policy's window. */
export async function disputeResolved(db: Db, actor: Actor, reference: string, reason: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const i = await loadIncident(tx, reference, 'reference');
    if (i.township_id !== resident.townshipId) throw notFound('Incident');
    if (!(await one(tx, 'SELECT 1 FROM access_reports WHERE incident_id = $1 AND reporter_id = $2', [i.id, resident.id]))) {
      throw forbidden('Only someone who reported this problem can reopen it. You can report it as a new problem instead.');
    }
    if (i.status !== 'RESOLVED') throw conflict('INCIDENT_STATE', 'This incident is still open. You can tell us if a claimed fix is wrong when you are asked.');
    const policy = await getAccessPolicy(tx, i.township_id);
    if (!i.resolved_at || now.getTime() - i.resolved_at.getTime() > policy.disputeDays * 86_400_000) {
      throw ruleViolation('TOO_LATE', `An incident can be reopened within ${policy.disputeDays} days. Please report it again.`);
    }
    const place = (await one<PlaceRow>(tx, 'SELECT id, township_id, name, kind, location, verification, availability, party_id FROM access_places WHERE id = $1 FOR UPDATE', [i.place_id]))!;
    await reopen(tx, i, place, policy, { actorId: resident.id, reason: reason.trim() }, now);
    return { status: i.status };
  });
}

// --- Staff and admins: the exceptions ---------------------------------------------------------------

function requireStaff(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw forbidden();
}
const loadForStaff = async (q: Queryable, actor: Actor, id: string) => {
  const i = await loadIncident(q, id);
  if (actor.role !== 'HQ_ADMIN' && i.township_id !== actor.townshipId) throw notFound('Incident');
  return i;
};

/** An admin picks the party for an unroutable incident, or moves it to another with a reason. */
export async function assignParty(db: Db, actor: Actor, id: string, input: { partyId: string; reason: string }, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can assign or reassign an incident.');
  return db.tx(async (tx) => {
    const i = await loadForStaff(tx, actor, id);
    if (i.status === 'RESOLVED') throw conflict('INCIDENT_STATE', 'This incident is resolved.');
    const party = await one<PartyRow>(tx, 'SELECT id, name, kind, integration, active FROM access_parties WHERE id = $1 AND township_id = $2 AND active', [input.partyId, i.township_id]);
    if (!party) throw notFound('Organisation');
    if (party.id === i.party_id) throw conflict('SAME_PARTY', 'This organisation already has the incident.');
    const place = (await one<PlaceRow>(tx, 'SELECT id, township_id, name, kind, location, verification, availability, party_id FROM access_places WHERE id = $1', [i.place_id]))!;
    const policy = await getAccessPolicy(tx, i.township_id);
    if (['IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'VERIFICATION_PENDING'].includes(i.status)) {
      throw conflict('INCIDENT_STATE', 'The current team is already working on this. Escalate it first if it must move.');
    }
    await route(tx, i, place, policy, now, { partyId: party.id, actorId: actor.id, reason: input.reason.trim() });
    await audit(tx, actor.id, 'ACCESS_INCIDENT_ASSIGNED', 'access_incident', i.id, { partyId: party.id, reason: input.reason.trim() });
    return { status: i.status };
  });
}

/** A staff inspection decides a claimed fix: the human check when residents cannot, or when they disagree. */
export async function verifyResolution(db: Db, actor: Actor, id: string, input: { accept: boolean; note: string }, now: Date) {
  requireStaff(actor);
  return db.tx(async (tx) => {
    const i = await loadForStaff(tx, actor, id);
    const r = await pendingResolution(tx, i);
    if (!r) throw conflict('NOTHING_TO_CONFIRM', 'There is no fix waiting to be verified.');
    if (r.submitted_by === actor.id) throw forbidden('Someone else must verify a fix you submitted.');
    if (i.status === 'RESOLUTION_SUBMITTED') await setStatus(tx, i, 'VERIFICATION_PENDING', now);
    if (input.accept) await finalize(tx, i, r.id, `Checked on site by staff: ${input.note.trim()}`, actor.id, now);
    else await rejectResolution(tx, i, r.id, input.note.trim(), actor.id, now);
    await audit(tx, actor.id, input.accept ? 'ACCESS_FIX_VERIFIED' : 'ACCESS_FIX_REJECTED', 'access_incident', i.id, { note: input.note.trim() });
    return { status: i.status };
  });
}

/**
 * Admin overrides, each with a reason in the audit trail: confirm a problem
 * seen on site, or close an incident as resolved (a duplicate, a false report,
 * or a fix verified outside the app).
 */
export async function overrideIncident(db: Db, actor: Actor, id: string, input: { action: 'CONFIRM_BLOCKED' | 'RESOLVE'; reason: string }, now: Date) {
  if (input.action === 'CONFIRM_BLOCKED') requireStaff(actor);
  else if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can close an incident.');
  return db.tx(async (tx) => {
    const i = await loadForStaff(tx, actor, id);
    if (!ACCESS_ACTIVE.includes(i.status)) throw conflict('INCIDENT_STATE', 'This incident is already resolved.');
    if (input.action === 'CONFIRM_BLOCKED') {
      if (!i.blocks_access) throw ruleViolation('NOT_BLOCKING', 'This kind of problem does not block the place.');
      if (i.confirmed_at) throw conflict('ALREADY_CONFIRMED', 'This problem is already confirmed.');
      await tx.query(`UPDATE access_incidents SET confirmed_at = $2, confirmed_by = 'STAFF', updated_at = $2 WHERE id = $1`, [i.id, now]);
      await appendAccessEvent(tx, i.id, { kind: 'CONFIRMED', visibility: 'PUBLIC', body: 'Confirmed on site by township staff.', data: { basis: 'STAFF' }, actorId: actor.id }, now);
      await refreshAvailability(tx, i.place_id, now, { incidentId: i.id });
    } else {
      const r = await pendingResolution(tx, i);
      await appendAccessEvent(tx, i.id, { kind: 'OVERRIDE', visibility: 'INTERNAL', body: input.reason.trim(), data: { action: input.action, from: i.status }, actorId: actor.id }, now);
      await finalize(tx, i, r?.id ?? null, `Closed by an admin: ${input.reason.trim()}`, actor.id, now, true);
    }
    await audit(tx, actor.id, `ACCESS_OVERRIDE_${input.action}`, 'access_incident', i.id, { reason: input.reason.trim() });
    return { status: i.status };
  });
}
