import { REPORT_REASONS, type ReportContext, type ReportReason } from '@/shared/incidents';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { forbidden, notFound, ruleViolation } from '../../errors';
import { channelOf, companyForSupport, supportAdapterFor, type SupportChannel } from './courier-support';
import { matchesPattern } from '../carriers/barcode';
import { matchResident } from '../carriers/matching';
import { providerFor } from '../carriers/providers';
import type { CompanyRow } from '../carriers/types';
import { createIncident } from './engine';

/**
 * Where a reported problem goes. The reporter picks what went wrong; the
 * rules (src/shared/incidents.ts) and the township's own records decide who
 * must act:
 *
 *   - the courier company: the resident is shown the courier, the tracking
 *     number and the company's verified support channel. Only a referral is
 *     recorded; no township case, no staff alert;
 *   - the township: a case is filed with the parcel, locker or gate attached;
 *   - both: the township's records are checked first and shown to the
 *     resident, who confirms before a case is filed;
 *   - not sure: a case goes to the township's triage queue.
 *
 * The courier is identified only from records SimeTown trusts (the company the
 * courier delivered for, a shipment matched to this home, or the guard's own
 * entry), never from the look of a tracking number; otherwise the resident
 * chooses it.
 */

export interface ReportInput {
  context: ReportContext;
  reason: string;
  lockerParcelId?: string;
  guardParcelId?: string;
  trackingNo?: string;
  companyId?: string;
  stationId?: string;
  note?: string;
  /** The resident has seen the township's records and still wants a case opened. */
  confirm?: boolean;
}

export type CourierGuidance = {
  referralId: string;
  company: { id: string; name: string; simulated: boolean; identifiedBy: 'DELIVERY_RECORD' | 'SHIPMENT_RECORD' | 'GUARD_RECORD' | 'RESIDENT' };
  trackingNo: string | null;
  support: SupportChannel | null;
  canSubmitTicket: boolean;
};

export type ReportOutcome =
  | { route: 'COURIER'; guidance: CourierGuidance }
  | { route: 'CHOOSE_COURIER'; companies: { id: string; name: string }[] }
  | { route: 'CONFIRM'; evidence: string[]; question: string }
  | { route: 'FOUND'; message: string }
  | { route: 'TOWNSHIP'; incident: { reference: string; created: boolean } };

interface LockerParcel {
  id: string; township_id: string; home_id: string; company_id: string; company: string; tracking_no: string; state: string; station_id: string; station: string;
  compartment_id: string | null; compartment: string | null; collected_at: Date | null; ready_at: Date | null; state_changed_at: Date; shipment_id: string | null;
}
interface GuardParcel {
  id: string; township_id: string; home_id: string; courier: string; tracking_no: string | null; status: string; shelf: string; logged_at: Date; collected_at: Date | null;
  collected_by_name: string | null; handed_over_by: string | null;
}

const LOCKER_LIVE = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'COLLECTION_IN_PROGRESS', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING', 'EXCEPTION'];
const THIRTY_DAYS = 30 * 86_400_000;
const time = (d: Date) => d.toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

async function referToCourier(
  q: Queryable, actor: Actor, reason: ReportReason, company: { id: string; identifiedBy: CourierGuidance['company']['identifiedBy'] },
  x: { trackingNo: string | null; lockerParcelId?: string | null; guardParcelId?: string | null }, now: Date,
): Promise<ReportOutcome> {
  const c = (await companyForSupport(q, company.id))!;
  // The same problem with the same parcel, reported again within a week, is the same referral.
  const existing = await one<{ id: string }>(
    q, `SELECT id FROM courier_referrals WHERE user_id = $1 AND reason = $2 AND coalesce(tracking_no, '') = coalesce($3, '') AND created_at > $4::timestamptz - interval '7 days'`,
    [actor.id, reason.category, x.trackingNo, now],
  );
  const referralId = existing?.id ?? (await one<{ id: string }>(
    q,
    `INSERT INTO courier_referrals (township_id, home_id, user_id, company_id, tracking_no, reason, locker_parcel_id, guard_parcel_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
    [actor.townshipId, actor.homeId, actor.id, c.id, x.trackingNo, reason.category, x.lockerParcelId ?? null, x.guardParcelId ?? null, now],
  ))!.id;
  return {
    route: 'COURIER',
    guidance: {
      referralId, trackingNo: x.trackingNo, support: channelOf(c), canSubmitTicket: Boolean(supportAdapterFor(c)),
      company: { id: c.id, name: c.name, simulated: c.provider_mode === 'SIMULATED', identifiedBy: company.identifiedBy },
    },
  };
}

/** What the township's records say about how a locker parcel was collected, in words the household understands. */
async function lockerEvidence(q: Queryable, p: LockerParcel) {
  const lines: string[] = [];
  let suspicious = false;
  const how = await one<{ requested_by: string | null; name: string | null; same_home: boolean | null; acked_at: Date }>(
    q,
    `SELECT k.requested_by, u.full_name AS name, (u.home_id = $2) AS same_home, k.acked_at FROM locker_commands k LEFT JOIN users u ON u.id = k.requested_by
      WHERE k.parcel_id = $1 AND k.purpose = 'COLLECT' AND k.status = 'ACKED' ORDER BY k.acked_at DESC LIMIT 1`,
    [p.id, p.home_id],
  );
  const counter = await one<{ to_ref: string | null; at: Date }>(q, `SELECT to_ref, at FROM custody_transfers WHERE parcel_id = $1 AND from_kind = 'OVERFLOW' AND to_kind = 'RESIDENT' ORDER BY at DESC LIMIT 1`, [p.id]);
  if (counter) lines.push(`It was handed over at the parcel counter on ${time(counter.at)}, after staff checked the pickup code and ID.`);
  else if (how?.requested_by && how.same_home) lines.push(`The door was opened from the SimeTown app by ${how.name?.split(' ')[0] ?? 'someone'} in your home on ${time(how.acked_at)}.`);
  else if (how?.requested_by) {
    lines.push(`The door was opened on ${time(how.acked_at)} by someone outside your home.`);
    suspicious = true;
  } else if (how) lines.push(`The door was opened with your home’s PIN or QR code at the locker’s keypad on ${time(how.acked_at)}.`);
  else lines.push('The township’s records do not show how the door was opened.');
  if (p.collected_at) lines.push(`The locker then reported the door shut with the compartment empty (${time(p.collected_at)}).`);
  const forced = await one(q, `SELECT 1 FROM incidents WHERE station_id = $1 AND kind IN ('DOOR_FORCED', 'DOOR_LEFT_OPEN') AND created_at BETWEEN $2 AND $3::timestamptz + interval '1 hour'`, [
    p.station_id, p.ready_at ?? p.state_changed_at, p.collected_at ?? p.state_changed_at,
  ]);
  if (forced) {
    lines.push('The locker also reported a door problem while your parcel was inside.');
    suspicious = true;
  }
  return { lines, suspicious };
}

export async function reportProblem(db: Db, actor: Actor, input: ReportInput, now: Date): Promise<ReportOutcome> {
  const reason = REPORT_REASONS[input.context]?.find((r) => r.key === input.reason);
  if (!reason) throw ruleViolation('REASON', 'Choose what went wrong.');
  const note = input.note?.trim() || null;
  if (reason.needsNote && (!note || note.length < 5)) throw ruleViolation('SAY_WHAT', 'Tell us what happened.');
  const isCourier = input.context === 'COURIER_STATION';
  if (isCourier ? actor.role !== 'COURIER' : actor.role !== 'RESIDENT' || !actor.homeId) throw forbidden();
  const townshipId = actor.townshipId!;
  const base = { townshipId, module: reason.module, category: reason.category, priority: reason.priority, reporterId: actor.id, homeId: actor.homeId, description: note };

  // --- A courier at a station ---------------------------------------------------------------------
  if (isCourier) {
    const station = input.stationId ? await one<{ id: string; name: string }>(db, 'SELECT id, name FROM locker_stations WHERE id = $1 AND township_id = $2', [input.stationId, townshipId]) : null;
    const incident = await createIncident(db, {
      ...base, homeId: null, responsibility: reason.responsibility === 'UNCERTAIN' ? 'UNCERTAIN' : 'TOWNSHIP', stationId: station?.id ?? null,
      summary: `A courier reported: ${reason.label.toLowerCase()}${station ? ` at ${station.name}` : ''}.`, dedupeKey: `courier-report:${actor.id}:${reason.key}:${station?.id ?? ''}:${now.toISOString().slice(0, 13)}`,
      residentMessage: 'The township office has your report.',
    }, now);
    return { route: 'TOWNSHIP', incident: { reference: incident.reference, created: incident.created } };
  }

  // --- A locker parcel ---------------------------------------------------------------------------
  if (input.context === 'LOCKER_WAITING' || input.context === 'LOCKER_DONE') {
    const p = await one<LockerParcel>(
      db,
      `SELECT p.id, p.township_id, p.home_id, p.company_id, co.name AS company, p.tracking_no, p.state, p.station_id, s.name AS station, p.compartment_id, c.label AS compartment,
              p.collected_at, p.ready_at, p.state_changed_at, p.shipment_id
         FROM locker_parcels p JOIN courier_companies co ON co.id = p.company_id JOIN locker_stations s ON s.id = p.station_id
         LEFT JOIN locker_compartments c ON c.id = p.compartment_id WHERE p.id = $1 AND p.home_id = $2`,
      [input.lockerParcelId, actor.homeId],
    );
    if (!p) throw notFound('Parcel');
    const done = p.state === 'COLLECTED' || p.state === 'RETURNED';
    if (input.context === 'LOCKER_DONE' && (!done || now.getTime() - p.state_changed_at.getTime() > THIRTY_DAYS)) throw ruleViolation('PARCEL_STATE', 'Only a parcel finished in the last 30 days can be reported here. Contact the township office.');
    if (input.context === 'LOCKER_WAITING' && !LOCKER_LIVE.includes(p.state)) throw ruleViolation('PARCEL_STATE', 'This parcel is not in a locker.');
    if (reason.responsibility === 'COURIER') return referToCourier(db, actor, reason, { id: p.company_id, identifiedBy: 'DELIVERY_RECORD' }, { trackingNo: p.tracking_no, lockerParcelId: p.id }, now);
    let priority = reason.priority;
    let evidence: string[] = [];
    if (reason.key === 'NOT_COLLECTED') {
      if (p.state !== 'COLLECTED') throw ruleViolation('PARCEL_STATE', 'This parcel was not marked as collected.');
      const e = await lockerEvidence(db, p);
      evidence = e.lines;
      if (!input.confirm) return { route: 'CONFIRM', evidence, question: 'Could someone else in your home have collected it? If not, the township office will investigate.' };
      if (e.suspicious) priority = 'CRITICAL';
    }
    const incident = await createIncident(db, {
      ...base, priority, responsibility: reason.responsibility === 'MIXED' ? 'MIXED' : reason.responsibility === 'UNCERTAIN' ? 'UNCERTAIN' : 'TOWNSHIP',
      stationId: p.station_id, parcelId: p.id, shipmentId: p.shipment_id, companyId: p.company_id,
      summary: `${reason.label} (${p.company} ${p.tracking_no}, ${p.station}${p.compartment ? ` door ${p.compartment}` : ''}).`,
      details: { reason: reason.key, evidence, parcelState: p.state }, dedupeKey: `report:${actor.homeId}:${p.id}:${reason.key}`,
      residentMessage: reason.key === 'NOT_COLLECTED' ? 'We are checking the locker’s records and its door history. We will tell you what we find.' : undefined,
    }, now);
    return { route: 'TOWNSHIP', incident: { reference: incident.reference, created: incident.created } };
  }

  // --- A guardhouse parcel -----------------------------------------------------------------------
  if (input.context === 'GUARD_WAITING' || input.context === 'GUARD_DONE') {
    const g = await one<GuardParcel>(
      db, 'SELECT id, township_id, home_id, courier, tracking_no, status, shelf, logged_at, collected_at, collected_by_name, handed_over_by FROM parcels WHERE id = $1 AND home_id = $2', [input.guardParcelId, actor.homeId],
    );
    if (!g) throw notFound('Parcel');
    if (input.context === 'GUARD_WAITING' && g.status !== 'WAITING') throw ruleViolation('PARCEL_STATE', 'This parcel is no longer waiting at the guardhouse.');
    if (input.context === 'GUARD_DONE' && (g.status !== 'COLLECTED' || !g.collected_at || now.getTime() - g.collected_at.getTime() > THIRTY_DAYS)) throw ruleViolation('PARCEL_STATE', 'Only a parcel collected in the last 30 days can be reported here.');
    if (reason.responsibility === 'COURIER') {
      // The guard typed the courier's name; it counts only when it is exactly a company SimeTown knows.
      const company = await one<{ id: string }>(db, 'SELECT id FROM courier_companies WHERE lower(name) = lower($1)', [g.courier.trim()]);
      const chosen = company?.id ?? input.companyId;
      if (!chosen) return { route: 'CHOOSE_COURIER', companies: await db.query('SELECT id, name FROM courier_companies WHERE active ORDER BY name') };
      if (!company && !(await one(db, 'SELECT 1 FROM courier_companies WHERE id = $1', [chosen]))) throw notFound('Courier company');
      return referToCourier(db, actor, reason, { id: chosen, identifiedBy: company ? 'GUARD_RECORD' : 'RESIDENT' }, { trackingNo: g.tracking_no, guardParcelId: g.id }, now);
    }
    let evidence: string[] = [];
    if (reason.key === 'NOT_COLLECTED') {
      evidence = [`The guard recorded handing it over on ${time(g.collected_at!)}${g.collected_by_name ? ` to ${g.collected_by_name}` : ''}, after the one-time code was given.`];
      if (!input.confirm) return { route: 'CONFIRM', evidence, question: 'Could someone else in your home have collected it? If not, the township office will investigate.' };
    }
    const incident = await createIncident(db, {
      ...base, responsibility: reason.responsibility === 'MIXED' ? 'MIXED' : reason.responsibility === 'UNCERTAIN' ? 'UNCERTAIN' : 'TOWNSHIP', guardParcelId: g.id,
      summary: `${reason.label} (${g.courier}${g.tracking_no ? ` ${g.tracking_no}` : ''}, shelf ${g.shelf}).`, details: { reason: reason.key, evidence },
      dedupeKey: `report:${actor.homeId}:guard:${g.id}:${reason.key}`,
    }, now);
    if (reason.key === 'NOT_COLLECTED') await db.query('UPDATE parcels SET problem_at = coalesce(problem_at, $2), problem_note = coalesce(problem_note, $3) WHERE id = $1', [g.id, now, note]);
    return { route: 'TOWNSHIP', incident: { reference: incident.reference, created: incident.created } };
  }

  // --- A parcel that has not arrived -------------------------------------------------------------
  if (input.context === 'NOT_ARRIVED') {
    const tracking = input.trackingNo?.trim().toUpperCase() || null;
    if (reason.responsibility !== 'UNCERTAIN' && !tracking) throw ruleViolation('TRACKING', 'Enter the tracking number from the courier or the shop.');
    if (tracking) {
      // Already here? The township's own records say so before anyone is bothered.
      const inLocker = await one<{ station: string; compartment: string | null; state: string }>(
        db, `SELECT s.name AS station, c.label AS compartment, p.state FROM locker_parcels p JOIN locker_stations s ON s.id = p.station_id LEFT JOIN locker_compartments c ON c.id = p.compartment_id
              WHERE p.home_id = $1 AND upper(p.tracking_no) = $2 ORDER BY p.registered_at DESC LIMIT 1`, [actor.homeId, tracking],
      );
      if (inLocker && LOCKER_LIVE.includes(inLocker.state)) return { route: 'FOUND', message: `It is here: ${inLocker.station}${inLocker.compartment ? `, door ${inLocker.compartment}` : ''}. Your pickup code is on the Parcels page.` };
      const atGuard = await one<{ shelf: string }>(db, `SELECT shelf FROM parcels WHERE home_id = $1 AND upper(tracking_no) = $2 AND status = 'WAITING'`, [actor.homeId, tracking]);
      if (atGuard) return { route: 'FOUND', message: `It is at the guardhouse, shelf ${atGuard.shelf}. Your collection code is on the Parcels page.` };
    }
    if (reason.responsibility === 'COURIER') {
      const known = tracking ? await one<{ company_id: string }>(db, 'SELECT company_id FROM courier_shipments WHERE tracking_no = $1 AND home_id = $2', [tracking, actor.homeId]) : null;
      const confirmed = !known && tracking && !input.companyId ? await askConnectedProviders(db, actor, tracking, now) : null;
      const chosen = known?.company_id ?? confirmed ?? input.companyId;
      if (!chosen) return { route: 'CHOOSE_COURIER', companies: await db.query('SELECT id, name FROM courier_companies WHERE active ORDER BY name') };
      if (!known && !confirmed && !(await one(db, 'SELECT 1 FROM courier_companies WHERE id = $1', [chosen]))) throw notFound('Courier company');
      return referToCourier(db, actor, reason, { id: chosen, identifiedBy: known || confirmed ? 'SHIPMENT_RECORD' : 'RESIDENT' }, { trackingNo: tracking }, now);
    }
    if (reason.key === 'MARKED_DELIVERED' && !input.confirm) {
      return { route: 'CONFIRM', evidence: ['The township has no record of this parcel in a locker or at the guardhouse for your home.'], question: 'Should the township office check the gate, the lockers and the guardhouse for it?' };
    }
    const incident = await createIncident(db, {
      ...base, responsibility: reason.responsibility === 'MIXED' ? 'MIXED' : 'UNCERTAIN', companyId: input.companyId ?? null,
      summary: `${reason.label}${tracking ? ` (${tracking})` : ''}.`, details: { reason: reason.key, trackingNo: tracking }, dedupeKey: `report:${actor.homeId}:arrive:${tracking ?? now.getTime()}:${reason.key}`,
    }, now);
    return { route: 'TOWNSHIP', incident: { reference: incident.reference, created: incident.created } };
  }

  // --- The gate and guardhouse --------------------------------------------------------------------
  const incident = await createIncident(db, {
    ...base, responsibility: reason.responsibility === 'UNCERTAIN' ? 'UNCERTAIN' : 'TOWNSHIP',
    summary: `${reason.label}.`, details: { reason: reason.key }, dedupeKey: `report:${actor.homeId}:gate:${reason.key}:${now.toISOString().slice(0, 10)}`,
  }, now);
  return { route: 'TOWNSHIP', incident: { reference: incident.reference, created: incident.created } };
}

/**
 * Which connected courier company has this shipment for this home. The
 * tracking number's format only decides whom to ask; a company counts only
 * when its own system confirms the shipment and that it is addressed to this
 * home. One answer, or none: never a guess between two.
 */
async function askConnectedProviders(db: Db, actor: Actor, tracking: string, now: Date): Promise<string | null> {
  const companies = await db.query<CompanyRow>(
    `SELECT c.* FROM courier_companies c WHERE c.active AND c.provider_mode <> 'NONE' AND c.tracking_pattern IS NOT NULL
        AND EXISTS (SELECT 1 FROM courier_company_townships t WHERE t.company_id = c.id AND t.township_id = $1 AND t.status = 'ACTIVE')`,
    [actor.townshipId],
  );
  const found: string[] = [];
  for (const c of companies.filter((x) => matchesPattern(tracking, x.tracking_pattern))) {
    const answer = await providerFor(c)?.lookup(db, c, tracking, now);
    if (!answer?.ok || !answer.shipment) continue;
    const match = await matchResident(db, actor.townshipId!, answer.shipment.recipient);
    if (match.matched && match.homeId === actor.homeId) found.push(c.id);
  }
  return found.length === 1 ? found[0]! : null;
}

/** For a simulated company only: file the complaint in its (simulated) ticket system, labelled as simulated. */
export async function submitCourierTicket(db: Db, actor: Actor, referralId: string, now: Date) {
  const r = await one<{ id: string; company_id: string | null; tracking_no: string | null; reason: string; ticket_ref: string | null }>(
    db, 'SELECT id, company_id, tracking_no, reason, ticket_ref FROM courier_referrals WHERE id = $1 AND user_id = $2', [referralId, actor.id],
  );
  if (!r || !r.company_id) throw notFound('Referral');
  if (r.ticket_ref) return { ticketRef: r.ticket_ref, simulated: true };
  const company = (await companyForSupport(db, r.company_id))!;
  const adapter = supportAdapterFor(company);
  if (!adapter) throw ruleViolation('NO_TICKETS', `${company.name}’s own system is not connected to SimeTown. Contact the company through its support channel.`);
  const ticket = await adapter.submitTicket(db, r);
  await db.query('UPDATE courier_referrals SET ticket_ref = $2, ticket_status = $3, ticket_simulated = $4, updated_at = $5 WHERE id = $1', [r.id, ticket.ticketRef, ticket.status, adapter.simulated, now]);
  return { ticketRef: ticket.ticketRef, simulated: adapter.simulated };
}
