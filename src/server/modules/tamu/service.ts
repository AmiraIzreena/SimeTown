import { formatAddress, licenceExpired, PASS_TYPE_INFO, shortAddress, type HomeAddress, type HostReply, type PassType, type VisitorDetail } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, townshipOf, type Actor } from '../../auth/actor';
import { hashToken, newToken } from '../../auth/session';
import { conflict, fieldErrors, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { myHelpTasks } from '../banjir/events';
import { emailVisitorArrived, emailVisitorAtGate, emailVisitorPass } from '../email/tamu';
import { randomCode } from '../identity/service';
import { onCollectionGateEntry } from '../kitar/collection-gate';
import { notify } from '../notifications';
import { getSettings, todayIn } from '../settings';
import { HOME_ADDRESS_COLUMNS } from '../townships';
import { decryptIdNumber, DETAIL_COLUMNS, maskedDetails, mergeDetails, missingOf, requireComplete, type DetailsInput, type StoredDetails } from './visitor-data';

/**
 * Tamu: visitor passes and the guard at the main gate (proposal 6.4).
 *
 * Every visit records the visitor's name, citizenship, identity number, how they travel (with the vehicle number
 * and, when they drive, their licence's expiry) and the reason for the visit (BR26, revised 2026-10-23). On a pass
 * the resident gives these, or leaves the identity for the visitor to give on their link; the guard completes
 * anything missing at the gate. A driving licence that has expired blocks entry by motor vehicle. The identity
 * number is stored encrypted and shown in full only to the guard at the gate; guards never hold the card itself.
 * Records are deleted after 90 days (BR26), and Tamu gives no points and no XP (BR27). "Not expected" informs the
 * guard; it never blocks lawful access on a public road.
 */

const MAX_LIVE_PASSES_PER_HOME = 30;
export const VISITOR_RETENTION_DAYS = 90;

const timeIn = (date: Date, tz: string) => date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** What a visitor's pass says on its own, without anything about who lives there beyond the street. */
type PassStatus = 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';

function passStatus(p: { status: string; valid_from: Date; valid_until: Date; max_entries: number | null; entries: number }, now: Date): PassStatus {
  if (p.status === 'CANCELLED') return 'CANCELLED';
  if (p.valid_until <= now) return 'EXPIRED';
  if (p.max_entries !== null && p.entries >= p.max_entries) return 'USED';
  if (p.valid_from > now) return 'NOT_YET';
  return 'ACTIVE';
}

export interface PassInput extends DetailsInput {
  type: PassType;
  visitorName: string;
  /** If given, SimeTown emails the visitor their pass link (and the new link when the pass is shared again). */
  visitorEmail?: string;
  validFrom: Date;
  validUntil: Date;
}

/**
 * A resident creates a pass. The link's token is returned once; only its hash is kept.
 *
 * From the Tamu form (`complete`), every detail is required, except that the resident may leave the visitor's
 * identity (citizenship, number and licence expiry) for the visitor to give on their link. Other callers, such as
 * the Assistant, which never handles identity numbers, give what they have; the visitor or the guard adds the rest.
 */
export async function createPass(db: Db, actor: Actor, input: PassInput, now: Date, options: { complete?: { identityByVisitor: boolean } } = {}) {
  const resident = requireVerifiedResident(actor);
  const info = PASS_TYPE_INFO[input.type];
  if (input.validUntil <= input.validFrom) throw ruleViolation('PASS_DATES', 'The pass must end after it starts.');
  if (input.validFrom.getTime() < now.getTime() - 3_600_000) throw ruleViolation('PASS_DATES', 'A pass cannot start in the past.');
  if (input.validUntil.getTime() - input.validFrom.getTime() > info.maxDays * 86_400_000) {
    throw ruleViolation('PASS_TOO_LONG', `A ${info.label.toLowerCase()} pass can last at most ${info.maxDays} day${info.maxDays === 1 ? '' : 's'}.`);
  }
  const byVisitor = options.complete?.identityByVisitor ?? false;
  const given: DetailsInput = byVisitor ? { ...input, citizenship: undefined, idNumber: undefined, licenceExpiry: undefined } : input;
  const details = mergeDetails(null, given, await todayIn(db, now));
  if (options.complete) requireComplete(details, byVisitor ? ['identity', 'licenceExpiry'] : []);
  return db.tx(async (tx) => {
    await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [resident.homeId]);
    const live = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM visitor_passes WHERE home_id = $1 AND status = 'ACTIVE' AND valid_until > $2`, [resident.homeId, now]);
    if (live!.n >= MAX_LIVE_PASSES_PER_HOME) throw ruleViolation('TOO_MANY_PASSES', 'Your home has many live passes. Cancel some you no longer need first.');
    const visitorEmail = input.visitorEmail?.trim().toLowerCase() || null;
    const pass = await insertPass(tx, {
      townshipId: resident.townshipId, homeId: resident.homeId, hostUserId: resident.id,
      type: input.type, visitorName: input.visitorName, validFrom: input.validFrom, validUntil: input.validUntil,
      details, detailsBy: details.id_number_enc ? 'HOST' : null, visitorEmail,
    }, now);
    const emailed = visitorEmail ? await sendPassByEmail(tx, pass.id, pass.token, now) : false;
    return { ...pass, emailed };
  });
}

/**
 * Writes a pass with a fresh link and gate code. Also used when SimeTown makes a pass for the household, such as
 * for a recycling collector or a home-service worker they booked: those come without visitor details, which the
 * guard fills in at the gate.
 */
export async function insertPass(
  tx: Queryable,
  input: { type: PassType; visitorName: string; vehicleNo?: string; validFrom: Date; validUntil: Date; townshipId: string; homeId: string; hostUserId: string; details?: StoredDetails; detailsBy?: 'HOST' | null; visitorEmail?: string | null },
  now: Date,
): Promise<{ id: string; code: string; token: string }> {
  const info = PASS_TYPE_INFO[input.type];
  const d = input.details;
  const token = newToken();
  // A short code for the guard to type, printed under the QR code. Retried on the rare clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `P${randomCode(7)}`;
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO visitor_passes (township_id, home_id, host_user_id, type, visitor_name, vehicle_no, code, token_hash, valid_from, valid_until, max_entries, created_at,
                                   citizenship, id_number_enc, id_last4, transport, licence_expiry, reason, reason_other, details_by, visitor_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) ON CONFLICT (code) DO NOTHING RETURNING id`,
      [
        input.townshipId, input.homeId, input.hostUserId, input.type, input.visitorName, (d ? d.vehicle_no : input.vehicleNo?.toUpperCase()) || null, code, hashToken(token),
        input.validFrom, input.validUntil, info.entries, now,
        d?.citizenship ?? null, d?.id_number_enc ?? null, d?.id_last4 ?? null, d?.transport ?? null, d?.licence_expiry ?? null, d?.reason ?? null, d?.reason_other ?? null, input.detailsBy ?? null, input.visitorEmail ?? null,
      ],
    );
    if (row) return { id: row.id, code, token };
  }
  throw conflict('TRY_AGAIN', 'Please try again.');
}

/** A fresh link for a pass (the old one stops working), for sharing it again. */
export async function renewPassLink(db: Db, actor: Actor, passId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const token = newToken();
  const rows = await db.query<{ code: string }>(
    `UPDATE visitor_passes SET token_hash = $3 WHERE id = $1 AND home_id = $2 AND status = 'ACTIVE' AND valid_until > $4 RETURNING code`,
    [passId, resident.homeId, hashToken(token), now],
  );
  if (rows.length === 0) throw notFound('Pass');
  // The old link stops working, so a visitor who was emailed gets the new one.
  const emailed = await sendPassByEmail(db, passId, token, now);
  return { id: passId, code: rows[0]!.code, token, emailed };
}

/** Emails the pass link to the visitor, if the resident gave their address, in the resident's language. */
async function sendPassByEmail(q: Queryable, passId: string, token: string, now: Date): Promise<boolean> {
  const p = await one<{ visitor_email: string | null; visitor_name: string; valid_from: Date; valid_until: Date; street: string; township: string; gate_name: string | null; language: string }>(
    q,
    `SELECT p.visitor_email, p.visitor_name, p.valid_from, p.valid_until, h.street, t.name AS township, t.gate_name, u.language
       FROM visitor_passes p JOIN homes h ON h.id = p.home_id JOIN townships t ON t.id = p.township_id JOIN users u ON u.id = p.host_user_id
      WHERE p.id = $1`,
    [passId],
  );
  if (!p?.visitor_email) return false;
  await emailVisitorPass(q, {
    passId, token, address: p.visitor_email, lang: p.language === 'ms' ? 'ms' : 'en', visitorName: p.visitor_name,
    township: p.township, street: p.street, gate: p.gate_name, validFrom: p.valid_from, validUntil: p.valid_until, now,
  });
  return true;
}

export async function cancelPass(db: Db, actor: Actor, passId: string) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query(`UPDATE visitor_passes SET status = 'CANCELLED' WHERE id = $1 AND home_id = $2 AND status = 'ACTIVE' RETURNING id`, [passId, resident.homeId]);
  if (rows.length === 0) throw notFound('Pass');
  return { ok: true };
}

interface PassRow extends StoredDetails {
  id: string;
  visitor_email: string | null;
  type: PassType;
  visitor_name: string;
  code: string;
  valid_from: Date;
  valid_until: Date;
  max_entries: number | null;
  status: string;
  created_at: Date;
  entries: number;
  last_entry_at: Date | null;
}

const PASS_COLUMNS = `p.id, p.type, p.visitor_name, p.code, p.valid_from, p.valid_until, p.max_entries, p.status, p.created_at,
  p.citizenship, p.id_number_enc, p.id_last4, p.transport, p.vehicle_no, p.licence_expiry::text AS licence_expiry, p.reason, p.reason_other, p.visitor_email`;

/** The home's passes, its visit history and any walk-in visitor waiting for an answer. */
export async function tamuOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const [passes, visits, waiting, sos] = await Promise.all([
    db.query<PassRow>(
      `SELECT ${PASS_COLUMNS},
              (SELECT count(*)::int FROM visitor_entries e WHERE e.pass_id = p.id) AS entries,
              (SELECT max(e.entered_at) FROM visitor_entries e WHERE e.pass_id = p.id) AS last_entry_at
         FROM visitor_passes p WHERE p.home_id = $1 AND p.valid_until > $2::timestamptz - interval '7 days'
        ORDER BY p.valid_from DESC LIMIT 50`,
      [resident.homeId, now],
    ),
    db.query<StoredDetails & { id: string; kind: string; visitor_name: string; host_reply: string | null; entered_at: Date; exited_at: Date | null }>(
      `SELECT id, kind, visitor_name, host_reply, entered_at, exited_at, ${DETAIL_COLUMNS} FROM visitor_entries
        WHERE home_id = $1 ORDER BY entered_at DESC LIMIT 30`,
      [resident.homeId],
    ),
    db.query<StoredDetails & { id: string; visitor_name: string; entered_at: Date }>(
      `SELECT id, visitor_name, entered_at, ${DETAIL_COLUMNS} FROM visitor_entries
        WHERE home_id = $1 AND kind = 'WALK_IN' AND host_reply IS NULL AND entered_at > $2::timestamptz - interval '2 hours'
        ORDER BY entered_at DESC`,
      [resident.homeId, now],
    ),
    one(db, `SELECT id, status, created_at FROM guard_sos WHERE home_id = $1 AND status <> 'CLOSED' ORDER BY created_at DESC LIMIT 1`, [resident.homeId]),
  ]);
  return {
    passes: passes.map((p) => ({
      id: p.id,
      type: p.type,
      visitorName: p.visitor_name,
      vehicleNo: p.vehicle_no,
      code: p.code,
      validFrom: p.valid_from,
      validUntil: p.valid_until,
      entries: p.entries,
      maxEntries: p.max_entries,
      lastEntryAt: p.last_entry_at,
      status: passStatus(p, now),
      details: maskedDetails(p),
      missing: missingOf(p),
      visitorEmail: p.visitor_email,
    })),
    visits: visits.map((v) => ({ id: v.id, kind: v.kind, visitor_name: v.visitor_name, vehicle_no: v.vehicle_no, host_reply: v.host_reply, entered_at: v.entered_at, exited_at: v.exited_at, details: maskedDetails(v) })),
    waiting: waiting.map((w) => ({ id: w.id, visitor_name: w.visitor_name, vehicle_no: w.vehicle_no, entered_at: w.entered_at, details: maskedDetails(w) })),
    sos: sos ?? null,
    retentionDays: VISITOR_RETENTION_DAYS,
  };
}

/** The host answers a walk-in visitor: the guard sees the answer at once. */
export async function replyToWalkIn(db: Db, actor: Actor, entryId: string, reply: HostReply, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const entry = await one<{ township_id: string; visitor_name: string; host_reply: string | null }>(
      tx,
      `SELECT township_id, visitor_name, host_reply FROM visitor_entries WHERE id = $1 AND home_id = $2 AND kind = 'WALK_IN' FOR UPDATE`,
      [entryId, resident.homeId],
    );
    if (!entry) throw notFound('Visitor');
    if (entry.host_reply) throw conflict('ALREADY_ANSWERED', 'Someone in your home has already answered.');
    await tx.query('UPDATE visitor_entries SET host_reply = $2, replied_by = $3, replied_at = $4 WHERE id = $1', [entryId, reply, resident.id, now]);
    const guards = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'GUARD' AND status = 'ACTIVE'`, [entry.township_id]);
    const words = { EXPECTED: 'is expected', NOT_EXPECTED: 'is NOT expected', CALL_ME: 'needs a call to the host' }[reply];
    await notify(tx, guards.map((g) => g.id), { title: `${entry.visitor_name} ${words}`, body: 'The host replied in SimeTown.', link: '/guard' });
    return { reply };
  });
}

/** The SOS button sends one urgent call to the guardhouse. Pressing again while it is open does nothing more. */
export async function raiseSos(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO guard_sos (township_id, home_id, user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [resident.townshipId, resident.homeId, resident.id, now],
    );
    if (!row) return { alreadyOpen: true };
    const home = await one<HomeAddress>(tx, `SELECT ${HOME_ADDRESS_COLUMNS} FROM homes h WHERE h.id = $1`, [resident.homeId]);
    const responders = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE township_id = $1 AND role IN ('GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
      [resident.townshipId],
    );
    await notify(tx, responders.map((r) => r.id), { priority: 'URGENT', title: 'SOS from a resident', body: `Help needed at ${formatAddress(home!)}.`, link: '/guard' });
    await audit(tx, resident.id, 'SOS_RAISED', 'guard_sos', row.id);
    return { id: row.id, alreadyOpen: false };
  });
}

// --- The visitor's link ------------------------------------------------------------

/**
 * What a visitor sees from their link: no sign-in and no app. Only the street is shown, never the house number or
 * the host's name, and of their identity number only the last 4 characters.
 */
export async function publicPass(db: Db, token: string, now: Date) {
  const p = await one<PassRow & HomeAddress & { township: string; gate_name: string | null; gate_lat: number | null; gate_lng: number | null }>(
    db,
    `SELECT ${PASS_COLUMNS},
            (SELECT count(*)::int FROM visitor_entries e WHERE e.pass_id = p.id) AS entries, NULL AS last_entry_at,
            ${HOME_ADDRESS_COLUMNS}, t.name AS township, t.gate_name, t.gate_lat, t.gate_lng
       FROM visitor_passes p JOIN homes h ON h.id = p.home_id JOIN townships t ON t.id = p.township_id
      WHERE p.token_hash = $1`,
    [hashToken(token)],
  );
  if (!p) throw notFound('Pass');
  const status = passStatus(p, now);
  const usable = status === 'ACTIVE' || status === 'NOT_YET';
  return {
    status,
    type: p.type,
    typeLabel: PASS_TYPE_INFO[p.type].label,
    visitorName: p.visitor_name,
    vehicleNo: p.vehicle_no,
    // The code is only useful while the pass can still be used.
    code: usable ? p.code : null,
    validFrom: p.valid_from,
    validUntil: p.valid_until,
    township: p.township,
    street: p.street,
    gate: p.gate_name ? { name: p.gate_name, lat: p.gate_lat, lng: p.gate_lng } : null,
    details: maskedDetails(p),
    // What the visitor can still give before they arrive. Anything already given cannot be changed here.
    missing: usable ? missingOf(p) : [],
  };
}

/** Only the details still missing are taken; what the host already gave stays as it is. */
function onlyMissing(input: DetailsInput, missing: VisitorDetail[], options: { licenceUpdate?: boolean } = {}): DetailsInput {
  const out: DetailsInput = {};
  if (missing.includes('identity')) Object.assign(out, { citizenship: input.citizenship, idNumber: input.idNumber });
  if (missing.includes('transport')) Object.assign(out, { transport: input.transport, vehicleNo: input.vehicleNo, licenceExpiry: input.licenceExpiry });
  if (missing.includes('vehicleNo')) out.vehicleNo = input.vehicleNo;
  if (missing.includes('licenceExpiry') || options.licenceUpdate) out.licenceExpiry = input.licenceExpiry;
  if (missing.includes('reason')) Object.assign(out, { reason: input.reason, reasonOther: input.reasonOther });
  return out;
}

/** The visitor gives the details their host left for them, on their own link, before they arrive. */
export async function completePassDetails(db: Db, token: string, input: DetailsInput, now: Date) {
  const today = await todayIn(db, now);
  await db.tx(async (tx) => {
    const p = await one<PassRow>(
      tx,
      `SELECT ${PASS_COLUMNS}, (SELECT count(*)::int FROM visitor_entries e WHERE e.pass_id = p.id) AS entries, NULL AS last_entry_at
         FROM visitor_passes p WHERE p.token_hash = $1 FOR UPDATE OF p`,
      [hashToken(token)],
    );
    if (!p) throw notFound('Pass');
    const status = passStatus(p, now);
    if (status !== 'ACTIVE' && status !== 'NOT_YET') throw ruleViolation(`PASS_${status}`, 'This pass can no longer be used. Ask your host for a new one.');
    const missing = missingOf(p);
    if (missing.length === 0) throw conflict('DETAILS_GIVEN', 'Your details are already complete. The guard checks them at the gate.');
    const next = mergeDetails(p, onlyMissing(input, missing), today);
    requireComplete(next);
    await writePassDetails(tx, p.id, next, missing.includes('identity') ? 'VISITOR' : null);
  });
  return publicPass(db, token, now);
}

async function writePassDetails(q: Queryable, passId: string, d: StoredDetails, detailsBy: 'VISITOR' | 'GUARD' | null) {
  await q.query(
    `UPDATE visitor_passes SET citizenship = $2, id_number_enc = $3, id_last4 = $4, transport = $5, vehicle_no = $6, licence_expiry = $7,
            reason = $8, reason_other = $9, details_by = coalesce($10, details_by) WHERE id = $1`,
    [passId, d.citizenship, d.id_number_enc, d.id_last4, d.transport, d.vehicle_no, d.licence_expiry, d.reason, d.reason_other, detailsBy],
  );
}

// --- The guard ------------------------------------------------------------------------

/** A scanned QR code reads "KITAPASS:<code>"; a typed code is just the code. */
export const normalisePassCode = (input: string) => input.trim().toUpperCase().replace(/^KITAPASS:/, '');

/** What the guard sees about a visitor: everything, including the full identity number to compare with the card. */
function guardView(d: StoredDetails) {
  return { ...maskedDetails(d), idNumber: decryptIdNumber(d.id_number_enc) };
}

const expiredLicence = (d: StoredDetails, today: string) => Boolean(d.licence_expiry && licenceExpired(d.licence_expiry, today));

/**
 * The guard scans a pass. A valid pass with every detail opens an entry, and the host is told the moment their
 * visitor arrives (in the app and by email). If details are missing, or the driving licence has expired, nothing is
 * recorded yet: the guard is shown what is needed, fills it in and scans again with it. An invalid pass says why.
 */
export async function scanPass(db: Db, actor: Actor, rawCode: string, now: Date, details?: DetailsInput) {
  const townshipId = townshipOf(actor);
  const code = normalisePassCode(rawCode);
  const today = await todayIn(db, now);
  return db.tx(async (tx) => {
    const p = await one<PassRow & HomeAddress & { home_id: string; host_user_id: string; gate_name: string | null }>(
      tx,
      `SELECT ${PASS_COLUMNS}, p.home_id, p.host_user_id, NULL AS last_entry_at, t.gate_name,
              (SELECT count(*)::int FROM visitor_entries e WHERE e.pass_id = p.id) AS entries, ${HOME_ADDRESS_COLUMNS}
         FROM visitor_passes p JOIN homes h ON h.id = p.home_id JOIN townships t ON t.id = p.township_id
        WHERE p.code = $1 AND p.township_id = $2 FOR UPDATE OF p`,
      [code, townshipId],
    );
    if (!p) throw notFound('Pass');
    const status = passStatus(p, now);
    if (status !== 'ACTIVE') {
      const why: Record<Exclude<PassStatus, 'ACTIVE'>, string> = {
        CANCELLED: 'The host cancelled this pass.',
        EXPIRED: 'This pass has expired.',
        USED: 'This pass has already been used.',
        NOT_YET: 'This pass is not valid yet.',
      };
      throw ruleViolation(`PASS_${status}`, why[status]);
    }
    const head = { passId: p.id, visitorName: p.visitor_name, type: p.type, typeLabel: PASS_TYPE_INFO[p.type].label, house: shortAddress(p), street: p.street };
    const missing = missingOf(p);
    const expired = expiredLicence(p, today);
    let d: StoredDetails = p;
    if (missing.length > 0 || expired) {
      if (!details) {
        return { outcome: 'NEEDS_DETAILS' as const, ...head, missing: expired ? [...missing, 'licenceExpiry' as const] : missing, licenceExpired: expired, details: guardView(p) };
      }
      d = mergeDetails(p, onlyMissing(details, missing, { licenceUpdate: expired }), today);
      requireComplete(d);
      if (expiredLicence(d, today)) throw fieldErrors({ licenceExpiry: 'This driving licence has expired. A visitor cannot drive in on it.' });
      await writePassDetails(tx, p.id, d, missing.includes('identity') ? 'GUARD' : null);
    }
    const entry = await one<{ id: string }>(
      tx,
      `INSERT INTO visitor_entries (township_id, home_id, pass_id, kind, visitor_name, vehicle_no, guard_user_id, entered_at,
                                    citizenship, id_number_enc, id_last4, transport, licence_expiry, reason, reason_other)
       VALUES ($1, $2, $3, 'PASS', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [townshipId, p.home_id, p.id, p.visitor_name, d.vehicle_no, actor.id, now, d.citizenship, d.id_number_enc, d.id_last4, d.transport, d.licence_expiry, d.reason, d.reason_other],
    );
    const tz = (await getSettings(tx)).timezone;
    await notify(tx, [p.host_user_id], { title: `${p.visitor_name} arrived at ${timeIn(now, tz)}`, body: 'Scanned in at the main gate.', link: '/app/tamu' });
    await emailVisitorArrived(tx, [p.host_user_id], { entryId: entry!.id, visitorName: p.visitor_name, details: d, gate: p.gate_name, at: now });
    if (p.type === 'CONTRACTOR') await onCollectionGateEntry(tx, p.id);
    return { outcome: 'LET_IN' as const, entryId: entry!.id, ...head, vehicleNo: d.vehicle_no, details: guardView(d) };
  });
}

/**
 * A visitor with no pass: the guard records their details and the house, and everyone in the home is asked (in the
 * app and by email). A driving licence that has expired is refused: they cannot be logged to drive in.
 */
export async function logWalkIn(db: Db, actor: Actor, input: DetailsInput & { visitorName: string; homeId: string }, now: Date) {
  const townshipId = townshipOf(actor);
  const d = mergeDetails(null, input, await todayIn(db, now));
  requireComplete(d);
  return db.tx(async (tx) => {
    const home = await one<HomeAddress & { id: string; gate_name: string | null }>(
      tx,
      `SELECT h.id, ${HOME_ADDRESS_COLUMNS}, t.gate_name FROM homes h JOIN townships t ON t.id = h.township_id WHERE h.id = $1 AND h.township_id = $2`,
      [input.homeId, townshipId],
    );
    if (!home) throw notFound('Home');
    const entry = await one<{ id: string }>(
      tx,
      `INSERT INTO visitor_entries (township_id, home_id, kind, visitor_name, vehicle_no, guard_user_id, entered_at,
                                    citizenship, id_number_enc, id_last4, transport, licence_expiry, reason, reason_other)
       VALUES ($1, $2, 'WALK_IN', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [townshipId, home.id, input.visitorName, d.vehicle_no, actor.id, now, d.citizenship, d.id_number_enc, d.id_last4, d.transport, d.licence_expiry, d.reason, d.reason_other],
    );
    const household = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE home_id = $1 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
      [home.id],
    );
    const people = household.map((u) => u.id);
    await notify(tx, people, {
      title: `${input.visitorName} is at the main gate`,
      body: 'Are you expecting them? Reply Expected, Not expected or Call me.',
      link: '/app/tamu',
    });
    await emailVisitorAtGate(tx, people, { entryId: entry!.id, visitorName: input.visitorName, details: d, gate: home.gate_name, at: now });
    return { entryId: entry!.id, house: shortAddress(home), notified: household.length };
  });
}

export async function logExit(db: Db, actor: Actor, entryId: string, now: Date) {
  const rows = await db.query(
    `UPDATE visitor_entries SET exited_at = $3 WHERE id = $1 AND township_id = $2 AND exited_at IS NULL RETURNING id`,
    [entryId, townshipOf(actor), now],
  );
  if (rows.length === 0) throw notFound('Entry');
  return { ok: true };
}

export async function acknowledgeSos(db: Db, actor: Actor, sosId: string, close: boolean, now: Date) {
  return db.tx(async (tx) => {
    const sos = await one<{ status: string; user_id: string }>(tx, `SELECT status, user_id FROM guard_sos WHERE id = $1 AND township_id = $2 FOR UPDATE`, [sosId, townshipOf(actor)]);
    if (!sos) throw notFound('SOS');
    if (sos.status === 'CLOSED') throw conflict('ALREADY_CLOSED', 'This call is already closed.');
    if (close) await tx.query(`UPDATE guard_sos SET status = 'CLOSED', closed_at = $2 WHERE id = $1`, [sosId, now]);
    else await tx.query(`UPDATE guard_sos SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = $3 WHERE id = $1`, [sosId, actor.id, now]);
    if (!close) await notify(tx, [sos.user_id], { priority: 'URGENT', title: 'The guardhouse is on its way', body: 'A guard has seen your SOS.', link: '/app/tamu' });
    await audit(tx, actor.id, close ? 'SOS_CLOSED' : 'SOS_ACKNOWLEDGED', 'guard_sos', sosId);
    return { status: close ? 'CLOSED' : 'ACKNOWLEDGED' };
  });
}

/** What the guard needs today on one screen: the gate log, open SOS calls, patrol rounds and any flood tasks. */
export async function guardOverview(db: Db, actor: Actor, now: Date) {
  const townshipId = townshipOf(actor);
  const tz = (await getSettings(db)).timezone;
  const [entries, sos, patrol, floods, township] = await Promise.all([
    db.query<HomeAddress & StoredDetails & Record<string, unknown>>(
      `SELECT e.id, e.kind, e.visitor_name, e.host_reply, e.entered_at, e.exited_at, p.type AS pass_type,
              e.citizenship, e.id_number_enc, e.id_last4, e.transport, e.vehicle_no, e.licence_expiry::text AS licence_expiry, e.reason, e.reason_other,
              ${HOME_ADDRESS_COLUMNS}
         FROM visitor_entries e JOIN homes h ON h.id = e.home_id LEFT JOIN visitor_passes p ON p.id = e.pass_id
        WHERE e.township_id = $1 AND e.entered_at > $2::timestamptz - interval '24 hours'
        ORDER BY e.entered_at DESC LIMIT 100`,
      [townshipId, now],
    ),
    db.query<HomeAddress & Record<string, unknown>>(
      `SELECT s.id, s.status, s.created_at, u.full_name, u.phone, ${HOME_ADDRESS_COLUMNS}
         FROM guard_sos s JOIN homes h ON h.id = s.home_id JOIN users u ON u.id = s.user_id
        WHERE s.township_id = $1 AND s.status <> 'CLOSED' ORDER BY s.created_at DESC`,
      [townshipId],
    ),
    db.query(
      `SELECT pp.id, pp.seq, pp.name,
              (SELECT max(ps.scanned_at) FROM patrol_scans ps WHERE ps.point_id = pp.id
                AND ps.scanned_at >= date_trunc('day', $2::timestamptz AT TIME ZONE $3) AT TIME ZONE $3) AS last_scan_today
         FROM patrol_points pp WHERE pp.township_id = $1 ORDER BY pp.seq`,
      [townshipId, now, tz],
    ),
    db.query<{ name: string; status: 'WARNING' | 'DANGER'; assembly_point: string; safe_route: string }>(
      `SELECT name, status, assembly_point, safe_route FROM flood_zones WHERE township_id = $1 AND status <> 'NORMAL' ORDER BY (status = 'DANGER') DESC, name`,
      [townshipId],
    ),
    one<{ name: string; gate_name: string | null }>(db, 'SELECT name, gate_name FROM townships WHERE id = $1', [townshipId]),
  ]);
  // Residents duty staff asked this guard to reach during a flood (Appendix E.3, priority help).
  const helpTasks = await myHelpTasks(db, actor);
  return {
    township: township!.name,
    gate: township!.gate_name,
    // The log shows the last 4 characters of an identity number; the full number appears only when scanning.
    entries: entries.map(({ property_type, house_no, building, street, precinct, postcode, city, state, citizenship, id_number_enc, id_last4, transport, vehicle_no, licence_expiry, reason, reason_other, ...rest }) => ({
      ...rest,
      vehicle_no,
      house: shortAddress({ property_type, house_no, building, street, precinct, postcode, city, state }),
      details: maskedDetails({ citizenship, id_number_enc, id_last4, transport, vehicle_no, licence_expiry, reason, reason_other }),
    })),
    sos: sos.map((s) => ({ id: s.id, status: s.status, created_at: s.created_at, full_name: s.full_name, phone: s.phone, address: formatAddress(s) })),
    patrol,
    floodTasks: floods.flatMap((z) => floodTasks(z)),
    helpTasks,
  };
}

/** The guard's task list while a flood warning is on (proposal 6.4: "flood task list"). */
function floodTasks(z: { name: string; status: 'WARNING' | 'DANGER'; assembly_point: string; safe_route: string }) {
  const tasks = [
    { zone: z.name, level: z.status, task: 'Keep the main gate lane clear for emergency vehicles.' },
    { zone: z.name, level: z.status, task: `Check the drain grilles on the way to ${z.name}, if it is safe to do so.` },
  ];
  if (z.status === 'DANGER') {
    tasks.unshift(
      { zone: z.name, level: z.status, task: `Open the assembly point: ${z.assembly_point}.` },
      { zone: z.name, level: z.status, task: `Direct cars and walkers along the safe route: ${z.safe_route}` },
    );
  }
  return tasks;
}

export async function scanPatrolPoint(db: Db, actor: Actor, rawCode: string, now: Date) {
  const point = await one<{ id: string; name: string }>(db, 'SELECT id, name FROM patrol_points WHERE code = $1 AND township_id = $2', [rawCode.trim().toUpperCase(), townshipOf(actor)]);
  if (!point) throw notFound('Patrol point');
  await db.query('INSERT INTO patrol_scans (point_id, guard_user_id, scanned_at) VALUES ($1, $2, $3)', [point.id, actor.id, now]);
  return { point: point.name };
}

/** Staff view: patrol points with their printable codes. */
export async function listPatrolPointsForStaff(db: Db, actor: Actor) {
  return db.query('SELECT id, seq, name, code FROM patrol_points WHERE ($1::uuid IS NULL OR township_id = $1) ORDER BY seq', [actor.townshipId]);
}

/** BR26: visitor records, with every detail in them, are deleted after 90 days. Part of the daily cleanup job. */
export async function deleteOldVisitorRecords(q: Queryable, now: Date): Promise<{ entries: number; passes: number }> {
  const entries = await q.query(`DELETE FROM visitor_entries WHERE entered_at < $1::timestamptz - make_interval(days => $2) RETURNING id`, [now, VISITOR_RETENTION_DAYS]);
  const passes = await q.query(`DELETE FROM visitor_passes WHERE valid_until < $1::timestamptz - make_interval(days => $2) RETURNING id`, [now, VISITOR_RETENTION_DAYS]);
  await q.query(`DELETE FROM patrol_scans WHERE scanned_at < $1::timestamptz - make_interval(days => $2)`, [now, VISITOR_RETENTION_DAYS]);
  await q.query(`DELETE FROM guard_sos WHERE status = 'CLOSED' AND created_at < $1::timestamptz - make_interval(days => $2)`, [now, VISITOR_RETENTION_DAYS]);
  return { entries: entries.length, passes: passes.length };
}
