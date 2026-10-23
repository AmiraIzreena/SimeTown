import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canMove, PARCEL_STATE_LABELS, PICKUP_QR_PREFIX, type LockerSize, type ParcelState } from '@/shared/lockers';
import { one, type Db, type Queryable } from '../../db/client';
import { getConfig } from '../../config';
import { conflict, notFound, ruleViolation } from '../../errors';
import { notify } from '../notifications';
import { raiseIncident } from './incidents';

/**
 * Smart lockers, the shared core: the parcel state machine with its event
 * history, pickup credentials, the collection policy and who may be told what.
 */

export type ActorKind = 'USER' | 'DEVICE' | 'SYSTEM';
export interface LockerActor {
  id: string | null;
  kind: ActorKind;
}
/**
 * Who asked for a door command, for every screen that lists commands: their name, role and, for a courier, their
 * company. Use with `locker_commands k`; it adds the aliases u, ca and cc.
 */
export const COMMAND_WHO_COLUMNS = 'u.full_name AS requested_by, u.role AS requester_role, cc.name AS requester_company';
export const COMMAND_WHO_JOINS = 'LEFT JOIN users u ON u.id = k.requested_by LEFT JOIN courier_accounts ca ON ca.user_id = u.id LEFT JOIN courier_companies cc ON cc.id = ca.company_id';

export const SYSTEM: LockerActor = { id: null, kind: 'SYSTEM' };
export const DEVICE: LockerActor = { id: null, kind: 'DEVICE' };
export const userActor = (id: string): LockerActor => ({ id, kind: 'USER' });

export interface ParcelRow {
  id: string;
  township_id: string;
  home_id: string | null;
  recipient_user_id: string | null;
  company_id: string;
  courier_user_id: string | null;
  tracking_no: string;
  size: LockerSize;
  station_id: string;
  compartment_id: string | null;
  overflow_location_id: string | null;
  state: ParcelState;
  resume_state: ParcelState | null;
  state_changed_at: Date;
  registered_at: Date;
  ready_at: Date | null;
  deadline_at: Date | null;
  first_reminder_at: Date | null;
  final_reminder_at: Date | null;
  collected_at: Date | null;
  relocated_at: Date | null;
  extensions: number;
  failure_reason: string | null;
  exception_note: string | null;
  /** The last reminder: for a parcel in its door, or a weekly one for a parcel overdue at the counter. */
  last_reminder_at: Date | null;
  /** When a parcel at the counter passed its collection period. It is never sent back by itself. */
  overdue_at: Date | null;
  /** When the guard was asked to call the household about a parcel still at the counter. */
  call_requested_at: Date | null;
  /** Why the parcel went to the counter instead of the home's door (DeliveryProblem). */
  delivery_problem: string | null;
  delivery_problem_note: string | null;
}

/** Columns a transition may also set. Anything else is refused, so a caller cannot slip in an arbitrary update. */
const PATCHABLE = new Set([
  'compartment_id', 'overflow_location_id', 'resume_state', 'ready_at', 'deadline_at', 'first_reminder_at', 'final_reminder_at',
  'collected_at', 'relocated_at', 'failure_reason', 'exception_note', 'station_id', 'last_reminder_at', 'overdue_at', 'call_requested_at',
  'delivery_problem', 'delivery_problem_note',
]);

/**
 * Moves a parcel to a new state, if that move is allowed from where it is now,
 * and records who did it, when and why. Locks the parcel row for the rest of
 * the transaction, so two requests cannot move it at once.
 */
export async function transition(
  tx: Queryable,
  parcelId: string,
  to: ParcelState,
  actor: LockerActor,
  reason: string,
  now: Date,
  patch: Record<string, unknown> = {},
): Promise<ParcelRow> {
  const p = await one<ParcelRow>(tx, 'SELECT * FROM locker_parcels WHERE id = $1 FOR UPDATE', [parcelId]);
  if (!p) throw notFound('Parcel');
  if (!canMove(p.state, to)) {
    throw conflict('PARCEL_STATE', `This parcel is ${PARCEL_STATE_LABELS[p.state].toLowerCase()} and cannot move to “${PARCEL_STATE_LABELS[to].toLowerCase()}”.`);
  }
  const entries = Object.entries(patch);
  for (const [key] of entries) if (!PATCHABLE.has(key)) throw new Error(`Not a patchable parcel column: ${key}`);
  const sets = entries.map(([key], i) => `${key} = $${i + 4}`);
  const updated = await one<ParcelRow>(
    tx,
    `UPDATE locker_parcels SET state = $2, state_changed_at = $3${sets.length ? `, ${sets.join(', ')}` : ''} WHERE id = $1 RETURNING *`,
    [parcelId, to, now, ...entries.map(([, v]) => v)],
  );
  await recordEvent(tx, parcelId, p.state, to, actor, reason, now);
  return updated!;
}

export async function recordEvent(tx: Queryable, parcelId: string, from: ParcelState | null, to: ParcelState, actor: LockerActor, reason: string, now: Date) {
  await tx.query(
    'INSERT INTO parcel_events (parcel_id, from_state, to_state, actor_id, actor_kind, reason, at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [parcelId, from, to, actor.id, actor.kind, reason, now],
  );
}

export async function custody(
  tx: Queryable,
  parcelId: string,
  from: { kind: string; ref?: string | null },
  to: { kind: string; ref?: string | null },
  actorId: string | null,
  now: Date,
  note?: string,
) {
  await tx.query(
    'INSERT INTO custody_transfers (parcel_id, from_kind, from_ref, to_kind, to_ref, actor_id, note, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [parcelId, from.kind, from.ref ?? null, to.kind, to.ref ?? null, actorId, note ?? null, now],
  );
}

// --- Pickup credentials ---------------------------------------------------------------------

const DEV_SECRET = 'simetown-development-locker-secret-not-for-production';

function secret(): string {
  const config = getConfig();
  if (config.LOCKER_CREDENTIAL_SECRET) return config.LOCKER_CREDENTIAL_SECRET;
  if (config.APP_ENV === 'production') {
    throw ruleViolation('LOCKER_NOT_CONFIGURED', 'Smart lockers are not set up yet: LOCKER_CREDENTIAL_SECRET is missing.');
  }
  return DEV_SECRET;
}

const hmac = (text: string) => createHmac('sha256', secret()).update(text).digest('hex');

/** The six-digit PIN for a credential. Worked out on demand, never stored. */
export const pinFor = (credentialId: string) => String(parseInt(hmac(`pin:${credentialId}`).slice(0, 12), 16) % 1_000_000).padStart(6, '0');

/** The QR text for a credential: the id and a signature only the server can make. */
export const qrFor = (credentialId: string) => `${PICKUP_QR_PREFIX}${credentialId}.${hmac(`qr:${credentialId}`).slice(0, 32)}`;

/** How a PIN is found at one location without the PIN ever being stored. */
export const pinLookup = (locationId: string, pin: string) => createHash('sha256').update(`${locationId}:${pin}`).digest('hex');

/** The credential id in a scanned QR, if its signature is genuine. */
export function credentialFromQr(text: string): string | null {
  const body = text.trim().startsWith(PICKUP_QR_PREFIX) ? text.trim().slice(PICKUP_QR_PREFIX.length) : null;
  if (!body) return null;
  const [id, sig] = body.split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{32}$/.test(sig)) return null;
  const expected = hmac(`qr:${id}`).slice(0, 32);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

/** A new credential for a parcel at a locker or counter. Any older one stops working. */
export async function issueCredential(tx: Queryable, parcelId: string, kind: 'LOCKER' | 'OVERFLOW', locationId: string, now: Date): Promise<string> {
  await tx.query(`UPDATE pickup_credentials SET status = 'REVOKED', revoked_at = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [parcelId, now]);
  // Retried on the rare PIN clash with another live parcel at the same place.
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = randomUUID();
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO pickup_credentials (id, parcel_id, location_kind, location_id, pin_lookup, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (pin_lookup) WHERE status = 'ACTIVE' DO NOTHING RETURNING id`,
      [id, parcelId, kind, locationId, pinLookup(locationId, pinFor(id)), now],
    );
    if (row) return row.id;
  }
  throw conflict('TRY_AGAIN', 'Please try again.');
}

export async function revokeCredentials(tx: Queryable, parcelId: string, now: Date) {
  await tx.query(`UPDATE pickup_credentials SET status = 'REVOKED', revoked_at = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [parcelId, now]);
}

export async function spendCredential(tx: Queryable, parcelId: string, now: Date) {
  await tx.query(`UPDATE pickup_credentials SET status = 'USED', used_at = $2 WHERE parcel_id = $1 AND status = 'ACTIVE'`, [parcelId, now]);
}

const ATTEMPT_WINDOW_MIN = 10;
const MAX_FAILED_ATTEMPTS = 10;
/** Wrong codes at one station keypad in a day before it locks until staff unlock it. */
export const DAILY_KEYPAD_LOCKOUT = 30;

/**
 * Finds the live credential a PIN or QR stands for at one place, in its own
 * transaction so a wrong code is always recorded. Wrong codes are counted per
 * place: after ten in 10 minutes, that place refuses codes for a while and
 * staff are told. An unattended station keypad that collects thirty in a day
 * locks until staff unlock it, so a PIN cannot be guessed slowly either.
 */
export async function resolveCredential(
  db: Db, locationId: string, text: string, now: Date, opts: { unattended?: boolean } = {},
): Promise<{ id: string; parcel_id: string; location_kind: string }> {
  const cred = await db.tx((tx) => lookupCredential(tx, locationId, text, now, opts.unattended ?? false));
  if (!cred) throw ruleViolation('PICKUP_CODE', 'That code is not right for a parcel here.');
  return cred;
}

/** Wrong codes at a place in the last 10 minutes and the last day, counting only since staff last unlocked it. */
async function failureCounts(tx: Queryable, locationId: string, now: Date) {
  return (await one<{ recent: number; today: number }>(
    tx,
    `SELECT count(*) FILTER (WHERE at > $2::timestamptz - make_interval(mins => $3))::int AS recent, count(*)::int AS today
       FROM pickup_attempts
      WHERE location_id = $1 AND NOT ok
        AND at > greatest($2::timestamptz - interval '1 day', coalesce((SELECT max(cleared_at) FROM pickup_lockouts WHERE location_id = $1), '-infinity'::timestamptz))`,
    [locationId, now, ATTEMPT_WINDOW_MIN],
  ))!;
}

export async function keypadLocked(q: Queryable, locationId: string): Promise<boolean> {
  return Boolean(await one(q, 'SELECT 1 FROM pickup_lockouts WHERE location_id = $1 AND cleared_at IS NULL', [locationId]));
}

async function lookupCredential(tx: Queryable, locationId: string, text: string, now: Date, unattended: boolean) {
  if (unattended && (await keypadLocked(tx, locationId))) {
    throw ruleViolation('KEYPAD_LOCKED', 'This keypad is locked after too many wrong codes. Open your door from the SimeTown app, or ask the township office.');
  }
  if ((await failureCounts(tx, locationId, now)).recent >= MAX_FAILED_ATTEMPTS) {
    throw ruleViolation('TOO_MANY_ATTEMPTS', 'Too many wrong codes here. Please wait 10 minutes or ask the township office.');
  }
  const clean = text.trim();
  const fromQr = credentialFromQr(clean);
  const cred = fromQr
    ? await one<{ id: string; parcel_id: string; location_kind: string }>(tx, `SELECT id, parcel_id, location_kind FROM pickup_credentials WHERE id = $1 AND location_id = $2 AND status = 'ACTIVE'`, [fromQr, locationId])
    : /^\d{6}$/.test(clean)
      ? await one<{ id: string; parcel_id: string; location_kind: string }>(tx, `SELECT id, parcel_id, location_kind FROM pickup_credentials WHERE pin_lookup = $1 AND status = 'ACTIVE'`, [pinLookup(locationId, clean)])
      : undefined;
  await tx.query('INSERT INTO pickup_attempts (location_id, ok, at) VALUES ($1, $2, $3)', [locationId, Boolean(cred), now]);
  if (!cred) await escalate(tx, locationId, now, unattended);
  return cred ?? null;
}

/** After a wrong code: lock an unattended keypad that has had too many today, or tell staff about a burst. */
async function escalate(tx: Queryable, locationId: string, now: Date, unattended: boolean) {
  const { recent, today } = await failureCounts(tx, locationId, now);
  if (recent < MAX_FAILED_ATTEMPTS && !(unattended && today >= DAILY_KEYPAD_LOCKOUT)) return;
  const place = await one<{ township_id: string; name: string }>(
    tx, 'SELECT township_id, name FROM locker_stations WHERE id = $1 UNION ALL SELECT township_id, name FROM overflow_locations WHERE id = $1', [locationId],
  );
  if (!place) return;
  const staff = await staffOf(tx, place.township_id);
  if (unattended && today >= DAILY_KEYPAD_LOCKOUT) {
    const locked = await one<{ id: string }>(
      tx,
      `INSERT INTO pickup_lockouts (location_id, township_id, failures, locked_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (location_id) WHERE cleared_at IS NULL DO NOTHING RETURNING id`,
      [locationId, place.township_id, today, now],
    );
    if (locked) {
      await tell(tx, staff, {
        title: 'Locker keypad locked',
        body: `${place.name}: ${today} wrong pickup codes in a day, so its keypad is locked. Residents can still open their doors from the app. Unlock it under Smart lockers once it is safe.`,
        link: '/console/lockers',
        priority: 'URGENT',
      }, `keypad-locked:${locked.id}`);
      await raiseIncident(tx, {
        townshipId: place.township_id, kind: 'KEYPAD_LOCKED', severity: 'MEDIUM', stationId: locationId,
        summary: `${place.name}: keypad locked after ${today} wrong pickup codes in a day. Someone may be guessing PINs.`, dedupeKey: `keypad-locked:${locked.id}`,
      }, now);
    }
  } else if (recent === MAX_FAILED_ATTEMPTS) {
    await tell(tx, staff, {
      title: 'Many wrong pickup codes',
      body: `${place.name}: ${recent} wrong pickup codes in ${ATTEMPT_WINDOW_MIN} minutes. It is refusing codes for a while.`,
      link: '/console/lockers',
    }, `keypad-burst:${locationId}:${Math.floor(now.getTime() / (ATTEMPT_WINDOW_MIN * 60_000))}`);
  }
}

/** Staff unlock a station keypad that locked itself after too many wrong codes. */
export async function unlockKeypad(tx: Queryable, townshipId: string | null, locationId: string, actorId: string, now: Date) {
  const row = await one<{ id: string }>(
    tx,
    `UPDATE pickup_lockouts SET cleared_at = $3, cleared_by = $4
      WHERE location_id = $1 AND cleared_at IS NULL AND ($2::uuid IS NULL OR township_id = $2) RETURNING id`,
    [locationId, townshipId, now, actorId],
  );
  if (!row) throw notFound('Locked keypad');
  return row;
}

// --- Collection policy ----------------------------------------------------------------------

export interface Policy {
  /** Kept for older records: doors now belong to one home and have no collection deadline. */
  first_reminder_hours: number;
  final_reminder_hours: number;
  relocate_after_hours: number;
  /** Days a parcel waits at the guardhouse before it is overdue. It is never sent back by itself. */
  overflow_collect_days: number;
  quiet_from_hour: number;
  quiet_to_hour: number;
  extensions_enabled: boolean;
  extension_hours: number;
  max_extensions: number;
  /** Always off: SimeTown charges no fees. A late-collection charge is a planned feature only. */
  fee_enabled: boolean;
  fee_sen: number | null;
  /** Opening an occupied door outside the normal flow needs a second admin. */
  exceptions_need_second_approval: boolean;
  /** Hours a parcel may wait in the home's own door before the first reminder; then one a week. */
  door_reminder_hours: number;
  /** Days at the guardhouse after which the guard on duty is asked to call the household. */
  counter_call_after_days: number;
}

/** Proposed starting values, not a verified township policy. */
export const DEFAULT_POLICY: Policy = {
  first_reminder_hours: 24,
  final_reminder_hours: 36,
  relocate_after_hours: 48,
  overflow_collect_days: 7,
  quiet_from_hour: 22,
  quiet_to_hour: 8,
  extensions_enabled: false,
  extension_hours: 24,
  max_extensions: 1,
  fee_enabled: false,
  fee_sen: null,
  exceptions_need_second_approval: true,
  door_reminder_hours: 48,
  counter_call_after_days: 14,
};

/** Reminders after the first come once a week, so nobody is pestered. */
export const WEEK_MS = 7 * 86_400_000;

const POLICY_COLUMNS = Object.keys(DEFAULT_POLICY).join(', ');

/** A station's own policy if it has one, else the township's, else the defaults. */
export async function getPolicy(q: Queryable, townshipId: string, stationId: string | null): Promise<Policy> {
  const row = await one<Policy>(
    q,
    `SELECT ${POLICY_COLUMNS} FROM collection_policies
      WHERE township_id = $1 AND (station_id = $2 OR station_id IS NULL)
      ORDER BY (station_id IS NULL) LIMIT 1`,
    [townshipId, stationId],
  );
  return row ?? DEFAULT_POLICY;
}

/** True between the policy's quiet hours, in the township's timezone, when reminders wait. */
export function inQuietHours(policy: Policy, now: Date, tz: string): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const { quiet_from_hour: from, quiet_to_hour: to } = policy;
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

// --- People to tell -------------------------------------------------------------------------

export async function householdOf(q: Queryable, homeId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE home_id = $1 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
    [homeId],
  );
  return rows.map((r) => r.id);
}

export async function staffOf(q: Queryable, townshipId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
    [townshipId],
  );
  return rows.map((r) => r.id);
}

/** Guards of the township: they hold parcels at the guardhouse. */
export async function guardsOf(q: Queryable, townshipId: string): Promise<string[]> {
  const rows = await q.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'GUARD' AND status = 'ACTIVE'`, [townshipId]);
  return rows.map((r) => r.id);
}

/** One notification per person, each kept once even if the same event is processed twice. */
export async function tell(q: Queryable, userIds: string[], n: { title: string; body: string; link: string; priority?: 'NORMAL' | 'URGENT' }, dedupe?: string) {
  for (const id of userIds) await notify(q, [id], { ...n, dedupeKey: dedupe ? `${dedupe}:${id}` : undefined });
}
