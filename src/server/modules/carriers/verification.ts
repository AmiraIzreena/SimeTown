import { sizeFor, type LockerSize } from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { AppError, badRequest, notFound } from '../../errors';
import { courierAccountOf, requireCourierAt, type CourierAccount } from '../lockers/couriers';
import { raiseIncident } from '../lockers/incidents';
import { matchesPattern, trackingFromScan } from './barcode';
import { matchResident } from './matching';
import { providerFor, recordProviderHealth } from './providers';
import type { Assurance, CompanyRow, MatchResult, ProviderShipment, VerificationState } from './types';

/**
 * Checking a scanned shipment before any locker is involved. The barcode only
 * names the shipment: whether it is real, deliverable, carried by this courier
 * and meant for a SimeTown household is asked of the courier company's own
 * system (simulated in the demo) and of SimeTown's records. Every check is
 * logged, and a shipment that has been deposited once is never deposited again.
 */

export interface Verification {
  state: VerificationState;
  reason: string | null;
  message: string;
  trackingNo: string;
  company: string;
  simulated: boolean;
  shipmentId: string | null;
  assurance: Assurance | null;
  match: Pick<MatchResult, 'method' | 'evidence' | 'masked'> | null;
  size: LockerSize | null;
  sizeFromProvider: boolean;
  /** May the courier go on with the resident's own SimeTown delivery code instead? */
  fallback: boolean;
  /** This courier's own delivery of this shipment, already under way. */
  resumeParcelId: string | null;
}

const MESSAGES: Record<string, string> = {
  VERIFIED: 'Shipment confirmed by the courier company and matched to a SimeTown household.',
  'NOT_FOUND:FORMAT': 'That does not look like one of your company’s tracking numbers. Check the label.',
  NOT_FOUND: 'Your courier company has no record of this shipment. Nothing was opened.',
  UNVERIFIED: 'Your courier company is not connected to SimeTown, so this shipment cannot be checked. Use the resident’s SimeTown delivery code.',
  'PROVIDER_UNAVAILABLE:FALLBACK': 'Your courier company’s system did not answer. Try again, or use the resident’s SimeTown delivery code.',
  PROVIDER_UNAVAILABLE: 'Your courier company’s system did not answer. Try again in a few minutes.',
  'RECIPIENT_MISMATCH:NOT_REGISTERED': 'The recipient is not a registered SimeTown household at this address. Deliver to the door or follow your company’s procedure.',
  'RECIPIENT_MISMATCH:NAME_MISMATCH': 'The name on the shipment does not match anyone at that address. Nothing was opened, and staff can check it.',
  'RECIPIENT_MISMATCH:AMBIGUOUS': 'The address matches more than one home. Use the resident’s SimeTown delivery code, or deliver to the door.',
  'RECIPIENT_MISMATCH:OUTSIDE_TOWNSHIP': 'This shipment is addressed outside this township.',
  'NOT_ELIGIBLE:DELIVERED': 'Your courier company says this shipment was already delivered. It cannot go in a locker.',
  'NOT_ELIGIBLE:CANCELLED': 'Your courier company says this shipment was cancelled. It cannot go in a locker.',
  'NOT_ELIGIBLE:RETURNED': 'Your courier company says this shipment is going back to the sender. It cannot go in a locker.',
  'NOT_ELIGIBLE:ON_HOLD': 'Your courier company has put this shipment on hold. It cannot go in a locker.',
  'NOT_ELIGIBLE:NOT_LOCKER_ELIGIBLE': 'Your courier company does not allow this shipment in a locker (for example, it needs a signature).',
  'NOT_ELIGIBLE:ASSIGNED_TO_ANOTHER_COURIER': 'Your courier company says another courier is carrying this shipment. Nothing was opened.',
  'NOT_ELIGIBLE:IN_PROGRESS': 'Another courier is already delivering this shipment. Nothing was opened.',
  'NOT_ELIGIBLE:ASSURANCE_TOO_LOW': 'This township needs your courier company to confirm who carries each shipment, and it cannot. Take it to the guardhouse.',
  'NOT_ELIGIBLE:TOO_BIG': 'This parcel is too big for any locker. Take it to the guardhouse.',
  ALREADY_DEPOSITED: 'This shipment has already been delivered to a locker. Nothing was opened, and the attempt was recorded.',
};
const messageFor = (state: VerificationState, reason: string | null) => MESSAGES[`${state}:${reason}`] ?? MESSAGES[state]!;

export async function loadCompany(q: Queryable, companyId: string): Promise<CompanyRow> {
  const c = await one<CompanyRow>(q, 'SELECT * FROM courier_companies WHERE id = $1', [companyId]);
  if (!c) throw notFound('Courier company');
  return c;
}

interface Approval {
  min_assurance: 'HIGH' | 'MEDIUM';
  allow_fallback: boolean;
}

/** Records one scan or typed tracking number, with its outcome. Outside any transaction, so a refusal is always recorded. */
export async function logScan(
  db: Db,
  s: { townshipId: string; companyId: string | null; courierId: string; stationId: string | null; shipmentId: string | null; trackingNo: string; outcome: string; reason?: string | null },
  now: Date,
) {
  await db.query(
    `INSERT INTO courier_scans (township_id, company_id, courier_user_id, station_id, shipment_id, tracking_no, outcome, reason, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [s.townshipId, s.companyId, s.courierId, s.stationId, s.shipmentId, s.trackingNo.slice(0, 60), s.outcome, s.reason ?? null, now],
  );
}

/** The shipment's permanent row, created on first sight. Locked when called inside a transaction with lock = true. */
export async function shipmentRow(q: Queryable, companyId: string, townshipId: string, trackingNo: string, now: Date, lock = false) {
  await q.query(
    `INSERT INTO courier_shipments (company_id, township_id, tracking_no, verification, first_seen_at, last_checked_at)
     VALUES ($1, $2, $3, 'UNVERIFIED', $4, $4) ON CONFLICT (company_id, tracking_no) DO NOTHING`,
    [companyId, townshipId, trackingNo, now],
  );
  return (await one<{ id: string; deposited_at: Date | null; parcel_id: string | null }>(
    q, `SELECT id, deposited_at, parcel_id FROM courier_shipments WHERE company_id = $1 AND tracking_no = $2${lock ? ' FOR UPDATE' : ''}`, [companyId, trackingNo],
  ))!;
}

/** A live (not finished, not failed) parcel for this shipment, and whose it is. */
async function liveParcel(q: Queryable, companyId: string, trackingNo: string) {
  return one<{ id: string; courier_user_id: string | null; state: string }>(
    q,
    `SELECT id, courier_user_id, state FROM locker_parcels WHERE company_id = $1 AND upper(tracking_no) = $2 AND state NOT IN ('COLLECTED', 'RETURNED', 'DELIVERY_FAILED')`,
    [companyId, trackingNo],
  );
}

/** The courier, their company, the station and the company's terms here, or a recorded refusal. */
export async function courierContext(db: Db, actor: Actor, stationId: string, trackingNo: string, now: Date) {
  const station = await one<{ id: string; township_id: string }>(db, 'SELECT id, township_id FROM locker_stations WHERE id = $1', [stationId]);
  if (!station) throw notFound('Station');
  let account: CourierAccount;
  try {
    account = await requireCourierAt(db, actor, stationId, now);
  } catch (error) {
    // A refused courier's scan is recorded too, and a suspended or withdrawn one is an incident.
    const known = await courierAccountOf(db, actor).catch(() => null);
    await logScan(db, { townshipId: station.township_id, companyId: known?.company_id ?? null, courierId: actor.id, stationId, shipmentId: null, trackingNo, outcome: 'COURIER_NOT_AUTHORISED', reason: known?.status ?? null }, now);
    if (known && (known.status === 'SUSPENDED' || known.status === 'REVOKED')) {
      await raiseIncident(db, {
        townshipId: station.township_id, kind: 'SUSPENDED_COURIER', severity: 'HIGH', companyId: known.company_id, userId: actor.id, stationId,
        summary: `A ${known.status === 'SUSPENDED' ? 'suspended' : 'withdrawn'} courier of ${known.company} tried to deliver at a locker.`,
        details: { trackingNo }, dedupeKey: `suspended:${actor.id}:${now.toISOString().slice(0, 10)}`,
      }, now);
    }
    throw error;
  }
  const company = await loadCompany(db, account.company_id);
  const approval = (await one<Approval>(db, 'SELECT min_assurance, allow_fallback FROM courier_company_townships WHERE company_id = $1 AND township_id = $2', [company.id, station.township_id]))!;
  return { station, account, company, approval };
}

/**
 * Everything SimeTown can find out about a scanned shipment, without opening
 * anything. Safe to call again: it changes nothing but the shipment's record
 * and the scan log.
 */
export async function verifyShipment(db: Db, actor: Actor, input: { stationId: string; code: string }, now: Date): Promise<Verification & { _home?: { homeId: string; recipientUserId: string | null; shipment: ProviderShipment } }> {
  const trackingNo = trackingFromScan(input.code);
  if (!trackingNo) throw badRequest('That code is not a tracking number SimeTown can read. Type the tracking number instead.');
  const { station, account, company, approval } = await courierContext(db, actor, input.stationId, trackingNo, now);
  const provider = providerFor(company);
  const base = { trackingNo, company: company.name, simulated: provider?.simulated ?? false, assurance: null, match: null, size: null, sizeFromProvider: false, resumeParcelId: null };
  const finish = async (state: VerificationState, reason: string | null, extra: Partial<Verification> = {}, shipmentId: string | null = null) => {
    await logScan(db, { townshipId: station.township_id, companyId: company.id, courierId: actor.id, stationId: station.id, shipmentId, trackingNo, outcome: state, reason }, now);
    return { ...base, state, reason, message: messageFor(state, reason), shipmentId, fallback: false, ...extra };
  };

  // A tracking number that does not even look like the company's is never sent anywhere.
  if (!matchesPattern(trackingNo, company.tracking_pattern)) return finish('NOT_FOUND', 'FORMAT');

  // Our own records first: a deposited shipment stays deposited, whatever anyone says.
  const known = await one<{ id: string; deposited_at: Date | null }>(db, 'SELECT id, deposited_at FROM courier_shipments WHERE company_id = $1 AND tracking_no = $2', [company.id, trackingNo]);
  if (known?.deposited_at) return replayed(db, { station, company, actor, trackingNo, shipmentId: known.id }, now).then(() => finish('ALREADY_DEPOSITED', null, {}, known.id));
  const live = await liveParcel(db, company.id, trackingNo);
  if (live && live.courier_user_id === actor.id) return finish('VERIFIED', 'RESUME', { resumeParcelId: live.id, message: 'You are already delivering this shipment. Carry on below.' }, known?.id ?? null);
  if (live) {
    await raiseIncident(db, {
      townshipId: station.township_id, kind: 'SHIPMENT_IN_USE', severity: 'MEDIUM', stationId: station.id, parcelId: live.id, shipmentId: known?.id ?? null, companyId: company.id, userId: actor.id,
      summary: `A second courier scanned ${trackingNo} while another courier was delivering it.`, dedupeKey: `in-use:${live.id}:${actor.id}`,
    }, now);
    return finish('NOT_ELIGIBLE', 'IN_PROGRESS', {}, known?.id ?? null);
  }

  // No connection to the company's system: only the resident's own delivery code can identify them.
  if (!provider) {
    const row = await shipmentRow(db, company.id, station.township_id, trackingNo, now);
    await db.query(`UPDATE courier_shipments SET verification = 'UNVERIFIED', reason = NULL, last_checked_at = $2 WHERE id = $1 AND deposited_at IS NULL`, [row.id, now]);
    return finish('UNVERIFIED', null, { fallback: true, assurance: 'LOW' }, row.id);
  }

  const answer = await provider.lookup(db, company, trackingNo, now);
  await recordProviderHealth(db, company.id, answer, now);
  if (!answer.ok) {
    const row = await shipmentRow(db, company.id, station.township_id, trackingNo, now);
    await db.query(`UPDATE courier_shipments SET verification = 'PROVIDER_UNAVAILABLE', reason = $2, last_checked_at = $3 WHERE id = $1 AND deposited_at IS NULL`, [row.id, answer.error.slice(0, 200), now]);
    await raiseIncident(db, {
      townshipId: station.township_id, kind: 'PROVIDER_OUTAGE', severity: 'MEDIUM', companyId: company.id, shipmentId: row.id,
      summary: `${company.name}${provider.simulated ? ' (simulated)' : ''} did not answer a shipment check: ${answer.error}`, dedupeKey: `outage:${company.id}:${now.toISOString().slice(0, 13)}`,
    }, now);
    return finish('PROVIDER_UNAVAILABLE', approval.allow_fallback ? 'FALLBACK' : null, { fallback: approval.allow_fallback, assurance: approval.allow_fallback ? 'LOW' : null }, row.id);
  }
  const s = answer.shipment;
  if (!s) {
    const recent = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM courier_scans WHERE courier_user_id = $1 AND outcome = 'NOT_FOUND' AND at > $2::timestamptz - interval '15 minutes'`, [actor.id, now]);
    if (recent!.n >= 2) {
      await raiseIncident(db, {
        townshipId: station.township_id, kind: 'UNKNOWN_SHIPMENT', severity: 'MEDIUM', companyId: company.id, userId: actor.id, stationId: station.id,
        summary: `A courier of ${company.name} scanned several shipments their company has no record of.`, dedupeKey: `unknown:${actor.id}:${now.toISOString().slice(0, 13)}`,
      }, now);
    }
    return finish('NOT_FOUND', null);
  }

  const row = await shipmentRow(db, company.id, station.township_id, trackingNo, now);
  const record = (verification: VerificationState, reason: string | null, extra: { assurance?: Assurance | null; match?: MatchResult | null; size?: LockerSize | null } = {}) =>
    db.query(
      `UPDATE courier_shipments SET verification = $2, reason = $3, provider_ref = $4, assurance = $5, match_method = $6, match_evidence = $7, home_id = $8, recipient_user_id = $9, size = $10, last_checked_at = $11
        WHERE id = $1 AND deposited_at IS NULL`,
      [row.id, verification, reason, s.providerRef, extra.assurance ?? null, extra.match?.method ?? null, JSON.stringify(extra.match?.evidence ?? []), extra.match?.homeId ?? null, extra.match?.recipientUserId ?? null, extra.size ?? null, now],
    );

  if (s.status === 'DELIVERED' || s.status === 'CANCELLED' || s.status === 'RETURNED' || s.status === 'ON_HOLD') {
    await record('NOT_ELIGIBLE', s.status);
    return finish('NOT_ELIGIBLE', s.status, {}, row.id);
  }
  if (!s.lockerEligible) {
    await record('NOT_ELIGIBLE', 'NOT_LOCKER_ELIGIBLE');
    return finish('NOT_ELIGIBLE', 'NOT_LOCKER_ELIGIBLE', {}, row.id);
  }
  // Who carries it, when the company can say. When it cannot, the lower assurance is recorded and the township's policy decides.
  let assurance: Assurance = 'MEDIUM';
  if (s.assignedCourierRef !== undefined) {
    if (!s.assignedCourierRef || s.assignedCourierRef !== account.employee_ref) {
      await record('NOT_ELIGIBLE', 'ASSIGNED_TO_ANOTHER_COURIER');
      await raiseIncident(db, {
        townshipId: station.township_id, kind: 'SHIPMENT_IN_USE', severity: 'HIGH', stationId: station.id, shipmentId: row.id, companyId: company.id, userId: actor.id,
        summary: `${account.company} says ${trackingNo} is carried by another courier, but this courier scanned it. The label may have been copied.`,
        dedupeKey: `assigned:${row.id}:${actor.id}`,
      }, now);
      return finish('NOT_ELIGIBLE', 'ASSIGNED_TO_ANOTHER_COURIER', {}, row.id);
    }
    assurance = 'HIGH';
  }
  if (approval.min_assurance === 'HIGH' && assurance !== 'HIGH') {
    await record('NOT_ELIGIBLE', 'ASSURANCE_TOO_LOW', { assurance });
    return finish('NOT_ELIGIBLE', 'ASSURANCE_TOO_LOW', { assurance }, row.id);
  }
  const size = s.parcel.dimensionsMm ? sizeFor(s.parcel.dimensionsMm) : null;
  if (s.parcel.dimensionsMm && !size) {
    await record('NOT_ELIGIBLE', 'TOO_BIG', { assurance });
    return finish('NOT_ELIGIBLE', 'TOO_BIG', { assurance }, row.id);
  }

  const match = await matchResident(db, station.township_id, s.recipient);
  const shown = { method: match.method, evidence: match.evidence, masked: match.masked };
  if (!match.matched) {
    await record('RECIPIENT_MISMATCH', match.reason, { assurance, match });
    if (match.reason === 'NAME_MISMATCH') {
      await raiseIncident(db, {
        townshipId: station.township_id, kind: 'RECIPIENT_MISMATCH', severity: 'LOW', shipmentId: row.id, companyId: company.id, stationId: station.id,
        summary: `${trackingNo}: the name ${company.name} has does not match anyone at the address.`, dedupeKey: `mismatch:${row.id}`,
      }, now);
    }
    return finish('RECIPIENT_MISMATCH', match.reason, { assurance, match: shown, fallback: match.reason === 'AMBIGUOUS' }, row.id);
  }
  await record('VERIFIED', null, { assurance, match, size });
  const result = await finish('VERIFIED', null, { assurance, match: shown, size, sizeFromProvider: Boolean(size) }, row.id);
  return { ...result, _home: { homeId: match.homeId!, recipientUserId: match.recipientUserId, shipment: s } };
}

/** A deposited shipment scanned again: refused, recorded, and an incident for staff. */
async function replayed(db: Db, x: { station: { id: string; township_id: string }; company: CompanyRow; actor: Actor; trackingNo: string; shipmentId: string }, now: Date) {
  const original = await one<{ courier_user_id: string | null; parcel_id: string | null }>(
    db, 'SELECT p.courier_user_id, s.parcel_id FROM courier_shipments s LEFT JOIN locker_parcels p ON p.id = s.parcel_id WHERE s.id = $1', [x.shipmentId],
  );
  const sameCourier = original?.courier_user_id === x.actor.id;
  await raiseIncident(db, {
    townshipId: x.station.township_id, kind: 'BARCODE_REPLAY', severity: sameCourier ? 'MEDIUM' : 'HIGH', stationId: x.station.id, shipmentId: x.shipmentId,
    parcelId: original?.parcel_id ?? null, companyId: x.company.id, userId: x.actor.id,
    summary: `${x.trackingNo} was scanned again after it had been deposited${sameCourier ? ' (by the same courier)' : ', by a different courier'}. No door was opened.`,
    dedupeKey: `replay:${x.shipmentId}`,
  }, now);
}

/** A refusal the courier screen can show, with the verification state as its code. */
export function refusal(v: Verification): AppError {
  return new AppError(v.state === 'ALREADY_DEPOSITED' || v.state === 'NOT_ELIGIBLE' ? 409 : 422, v.state, v.message);
}
