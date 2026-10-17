import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation, unauthorized } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { notify } from '../notifications';
import { recordAction, rewardUserById, type ActionReward } from '../rewards';
import { resolveTownship } from '../townships';
import { offerWorthByMaterial } from './rates';

/**
 * Kitar and the smart recycling machine (proposal 6.1, BR23).
 *
 * A machine proves who is recycling in one of three ways: the resident scans
 * the code on its screen (it changes every 30 seconds, so a photo of an old
 * code is useless), the machine reads the resident's SimeTown QR, or the visitor
 * recycles as a guest and gets a claim code for 14 days.
 *
 * The machine recognises, counts and weighs each item, and signs every record
 * with its own key. A drop-off counts only from a signed record, and an item
 * counts only when camera, barcode and weight agree. In this prototype the
 * machine is a tablet page operated from the console: it builds and signs the
 * same records a real machine would send, and they pass through the same
 * checks as the device endpoint (`/ingest/kitar/*`).
 */

const WINDOW_MS = 30_000;
const SESSION_IDLE_MS = 2 * 60_000;
const RECORD_MAX_AGE_MS = 5 * 60_000;
const MAX_SESSION_GRAMS = 20_000;
const MAX_SESSION_ITEMS = 200;
export const CLAIM_DAYS = 14;

/** What one item of each material plausibly weighs, in grams. Weight outside this range does not agree with the camera. */
export const ITEM_WEIGHT: Record<Material, [number, number]> = {
  PLASTIC_PET: [8, 120],
  PLASTIC_OTHER: [5, 400],
  PAPER: [5, 2000],
  GLASS: [100, 900],
  ALUMINIUM: [8, 60],
  E_WASTE: [20, 3000],
  TEXTILE: [50, 3000],
  COOKING_OIL: [200, 3000],
};

// --- Signatures ------------------------------------------------------------------

const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex');

function sameHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** The code on the machine's screen for one 30-second window. */
export function screenCode(secret: string, machineId: string, window: number): string {
  return createHmac('sha256', secret).update(`screen:${machineId}:${window}`).digest('base64url').slice(0, 20);
}

export interface ItemRecord {
  machineId: string;
  sessionId: string;
  seq: number;
  material: Material;
  cameraMaterial: Material | null;
  barcodeOk: boolean;
  weightG: number;
  accepted: boolean;
  ts: string;
}
export const itemText = (r: ItemRecord) =>
  ['item', r.machineId, r.sessionId, r.seq, r.material, r.cameraMaterial ?? '', r.barcodeOk ? 1 : 0, r.weightG, r.accepted ? 1 : 0, r.ts].join('|');

export interface SummaryRecord {
  machineId: string;
  sessionId: string;
  acceptedCount: number;
  rejectedCount: number;
  acceptedG: number;
  ts: string;
}
export const summaryText = (r: SummaryRecord) => ['done', r.machineId, r.sessionId, r.acceptedCount, r.rejectedCount, r.acceptedG, r.ts].join('|');

export interface StartRecord {
  machineId: string;
  mode: 'MEMBER_QR' | 'GUEST';
  memberCode: string | null;
  ts: string;
}
export const startText = (r: StartRecord) => ['start', r.machineId, r.mode, r.memberCode ?? '', r.ts].join('|');

interface MachineRow {
  id: string;
  township_id: string;
  kiosk_id: string;
  name: string;
  secret: string;
  status: 'ONLINE' | 'FULL' | 'OFFLINE';
  /** The one material this bin takes; null takes any material. */
  material: Material | null;
}

async function loadMachine(q: Queryable, machineId: string, lock = false): Promise<MachineRow> {
  const m = await one<MachineRow>(q, `SELECT id, township_id, kiosk_id, name, secret, status, material FROM kitar_machines WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [machineId]);
  if (!m) throw notFound('Machine');
  return m;
}

/** A device record: right signature, and recent, so an old record cannot be replayed later. */
function assertSigned(machine: MachineRow, text: string, signature: string, ts: string, now: Date): void {
  if (!sameHex(hmac(machine.secret, text), signature.toLowerCase())) throw unauthorized('The machine record is not signed correctly.');
  const age = Math.abs(now.getTime() - Date.parse(ts));
  if (!Number.isFinite(age) || age > RECORD_MAX_AGE_MS) throw unauthorized('The machine record is too old.');
}

// --- Sessions ----------------------------------------------------------------------

interface SessionRow {
  id: string;
  machine_id: string;
  user_id: string | null;
  mode: 'SCREEN_QR' | 'MEMBER_QR' | 'GUEST';
  status: 'OPEN' | 'DONE' | 'EXPIRED';
  started_at: Date;
  last_activity_at: Date;
  accepted_count: number;
  rejected_count: number;
  accepted_g: number;
}

/**
 * Opens a session on a machine. A session someone has left idle is closed
 * first; a session in use by someone else means the machine is busy.
 */
async function openSession(tx: Queryable, machine: MachineRow, userId: string | null, mode: SessionRow['mode'], now: Date): Promise<string> {
  if (machine.status !== 'ONLINE') throw ruleViolation('MACHINE_UNAVAILABLE', machine.status === 'FULL' ? 'This bin is full. Please use another bin.' : 'This bin is offline.');
  const open = await one<SessionRow>(tx, `SELECT id, user_id, last_activity_at FROM kitar_sessions WHERE machine_id = $1 AND status = 'OPEN' FOR UPDATE`, [machine.id]);
  if (open) {
    if (userId && open.user_id === userId) return open.id;
    if (now.getTime() - open.last_activity_at.getTime() < SESSION_IDLE_MS) throw conflict('MACHINE_BUSY', 'Someone is using this bin. Please wait a moment.');
    await tx.query(`UPDATE kitar_sessions SET status = 'EXPIRED', closed_at = $2 WHERE id = $1`, [open.id, now]);
  }
  const row = await one<{ id: string }>(
    tx,
    `INSERT INTO kitar_sessions (machine_id, user_id, mode, started_at, last_activity_at) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [machine.id, userId, mode, now],
  );
  await tx.query('UPDATE kitar_machines SET last_seen_at = $2 WHERE id = $1', [machine.id, now]);
  return row!.id;
}

/** The resident scanned the code on the machine's screen with SimeTown. */
export async function joinFromScreen(db: Db, actor: Actor, input: { machineId: string; code: string }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const machine = await loadMachine(tx, input.machineId, true);
    if (machine.township_id !== resident.townshipId) throw notFound('Machine');
    const window = Math.floor(now.getTime() / WINDOW_MS);
    // The current code or the one just before it, so a scan at the turn of the window still works.
    const valid = [window, window - 1].some((w) => {
      const expected = screenCode(machine.secret, machine.id, w);
      return expected.length === input.code.length && timingSafeEqual(Buffer.from(expected), Buffer.from(input.code));
    });
    if (!valid) throw ruleViolation('SCREEN_CODE_OLD', 'That code has changed. Scan the code on the bin’s screen again.');
    const sessionId = await openSession(tx, machine, resident.id, 'SCREEN_QR', now);
    return { sessionId, machine: machine.name, material: machine.material };
  });
}

async function memberIdOf(tx: Queryable, townshipId: string, memberCode: string): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `SELECT id FROM users WHERE member_code = $1 AND township_id = $2 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
    [memberCode.trim().toUpperCase(), townshipId],
  );
  if (!row) throw notFound('Member');
  return row.id;
}

async function startSession(tx: Queryable, machine: MachineRow, record: StartRecord, now: Date) {
  if (record.mode === 'GUEST') return { sessionId: await openSession(tx, machine, null, 'GUEST', now), guest: true };
  const memberId = await memberIdOf(tx, machine.township_id, record.memberCode ?? '');
  return { sessionId: await openSession(tx, machine, memberId, 'MEMBER_QR', now), guest: false };
}

/** Device endpoint: the machine starts a session itself (it read a SimeTown QR, or a guest tapped "Recycle as guest"). */
export async function ingestStart(db: Db, record: StartRecord & { signature: string }, now: Date) {
  return db.tx(async (tx) => {
    const machine = await loadMachine(tx, record.machineId, true);
    assertSigned(machine, startText(record), record.signature, record.ts, now);
    return startSession(tx, machine, record, now);
  });
}

// --- Items ---------------------------------------------------------------------------

/**
 * Camera, barcode and weight must agree, or the item does not count (proposal 6.1).
 * A bin set to one material counts only that material; a bin with none takes any.
 */
export function itemVerdict(
  r: Pick<ItemRecord, 'material' | 'cameraMaterial' | 'barcodeOk' | 'weightG' | 'accepted'>,
  binMaterial: Material | null = null,
): { accepted: boolean; reason: string | null } {
  const [min, max] = ITEM_WEIGHT[r.material];
  if (!r.accepted) return { accepted: false, reason: 'The bin did not take this item.' };
  if (binMaterial && r.material !== binMaterial) return { accepted: false, reason: `This bin is for ${MATERIAL_INFO[binMaterial].label} only.` };
  if (r.cameraMaterial !== r.material) return { accepted: false, reason: 'This item is not the material this bin takes.' };
  if (!r.barcodeOk) return { accepted: false, reason: 'This item could not be checked.' };
  if (r.weightG < min || r.weightG > max) return { accepted: false, reason: `The weight does not match ${MATERIAL_INFO[r.material].label.toLowerCase()}.` };
  return { accepted: true, reason: null };
}

async function storeItem(tx: Queryable, machine: MachineRow, record: ItemRecord, signature: string, now: Date) {
  const session = await one<SessionRow>(tx, `SELECT * FROM kitar_sessions WHERE id = $1 AND machine_id = $2 FOR UPDATE`, [record.sessionId, machine.id]);
  if (!session || session.status !== 'OPEN') throw notFound('Session');
  if (session.accepted_count + session.rejected_count >= MAX_SESSION_ITEMS) throw ruleViolation('SESSION_FULL', 'This session has reached its item limit. Finish and start again.');
  // A wrong-material item is stored as refused, not thrown away, so the bin's signed summary still matches.
  let verdict = itemVerdict(record, machine.material);
  if (verdict.accepted && session.accepted_g + record.weightG > MAX_SESSION_GRAMS) verdict = { accepted: false, reason: 'One session can take up to 20 kg.' };
  const inserted = await tx.query(
    `INSERT INTO kitar_items (session_id, seq, material, camera_material, barcode_ok, weight_g, accepted, reason, signature, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (session_id, seq) DO NOTHING RETURNING id`,
    [session.id, record.seq, record.material, record.cameraMaterial, record.barcodeOk, record.weightG, verdict.accepted, verdict.reason, signature, now],
  );
  if (inserted.length === 0) throw conflict('DUPLICATE_RECORD', 'This record has already been received.');
  await tx.query(
    `UPDATE kitar_sessions SET accepted_count = accepted_count + $2, rejected_count = rejected_count + $3, accepted_g = accepted_g + $4, last_activity_at = $5 WHERE id = $1`,
    [session.id, verdict.accepted ? 1 : 0, verdict.accepted ? 0 : 1, verdict.accepted ? record.weightG : 0, now],
  );
  await tx.query('UPDATE kitar_machines SET last_seen_at = $2 WHERE id = $1', [machine.id, now]);
  return { seq: record.seq, material: record.material, weightG: record.weightG, ...verdict };
}

/** Device endpoint: one item, signed by the machine. */
export async function ingestItem(db: Db, record: ItemRecord & { signature: string }, now: Date) {
  return db.tx(async (tx) => {
    const machine = await loadMachine(tx, record.machineId);
    assertSigned(machine, itemText(record), record.signature, record.ts, now);
    return storeItem(tx, machine, record, record.signature, now);
  });
}

// --- Finishing -------------------------------------------------------------------------

/**
 * Closes a session from the machine's signed summary, which must match the
 * items received. A resident's drop-off is recorded and rewarded at once; a
 * guest gets a claim code instead.
 */
async function finishSession(tx: Queryable, machine: MachineRow, record: SummaryRecord, signature: string, now: Date) {
  const session = await one<SessionRow>(tx, `SELECT * FROM kitar_sessions WHERE id = $1 AND machine_id = $2 FOR UPDATE`, [record.sessionId, machine.id]);
  if (!session || session.status !== 'OPEN') throw notFound('Session');
  if (record.acceptedCount !== session.accepted_count || record.rejectedCount !== session.rejected_count || record.acceptedG !== session.accepted_g) {
    throw conflict('SUMMARY_MISMATCH', 'The machine’s summary does not match the items it sent.');
  }
  const byMaterial = await tx.query<{ material: Material; grams: number }>(
    `SELECT material, sum(weight_g)::int AS grams FROM kitar_items WHERE session_id = $1 AND accepted GROUP BY material ORDER BY material`,
    [session.id],
  );
  let claimCode: string | null = null;
  let reward: ActionReward | null = null;
  if (session.user_id) {
    reward = await creditDropOff(tx, machine, session.id, session.user_id, byMaterial, session.accepted_g, now, false);
  } else if (session.accepted_g > 0) {
    claimCode = randomCode(8);
  }
  await tx.query(
    `UPDATE kitar_sessions SET status = 'DONE', closed_at = $2, summary_signature = $3, reward = $4::jsonb,
            claim_hash = $5, claim_expires_at = CASE WHEN $5::text IS NULL THEN NULL ELSE $2::timestamptz + make_interval(days => $6) END
      WHERE id = $1`,
    [session.id, now, signature, JSON.stringify(reward), claimCode ? hashClaim(claimCode) : null, CLAIM_DAYS],
  );
  return { sessionId: session.id, acceptedCount: session.accepted_count, rejectedCount: session.rejected_count, acceptedG: session.accepted_g, reward, claimCode, claimDays: claimCode ? CLAIM_DAYS : null };
}

const hashClaim = (code: string) => createHash('sha256').update(`kitar-claim:${code.trim().toUpperCase()}`).digest('hex');

/**
 * Whether kitar_dropoffs has the TEST label column (migration 016). A lookup, not a query that might fail: inside a
 * transaction a failed query aborts the whole transaction in Postgres, even when the error is caught.
 */
export async function hasDropoffSource(q: Queryable): Promise<boolean> {
  return Boolean(
    await one(q, `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'kitar_dropoffs' AND column_name = 'source'`),
  );
}

/**
 * Stores the drop-off (one row per material, for street totals) and gives XP, campaign points and offer-backed points.
 * A finished bin session and a guest claim call it with no `test`. Kitar test mode (test-entry.ts) passes `test`, so a
 * practice entry is labelled TEST and goes through exactly the same reward and limit code.
 */
export async function creditDropOff(
  tx: Queryable,
  machine: Pick<MachineRow, 'kiosk_id' | 'name'>,
  sessionId: string | null,
  userId: string,
  byMaterial: { material: Material; grams: number }[],
  grams: number,
  now: Date,
  guestClaim: boolean,
  test?: { ref: string; labelled: boolean; dropoffIds: string[] },
): Promise<ActionReward | null> {
  if (grams === 0) return null;
  for (const m of byMaterial) {
    if (test) {
      // With migration 016 the row itself says TEST; without it, the audit entry lists these ids instead.
      const row = await one<{ id: string }>(
        tx,
        test.labelled
          ? `INSERT INTO kitar_dropoffs (kiosk_id, user_id, material, weight_g, created_at, source) VALUES ($1, $2, $3, $4, $5, 'TEST') RETURNING id`
          : 'INSERT INTO kitar_dropoffs (kiosk_id, user_id, material, weight_g, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [machine.kiosk_id, userId, m.material, m.grams, now],
      );
      test.dropoffIds.push(row!.id);
      continue;
    }
    await tx.query('INSERT INTO kitar_dropoffs (kiosk_id, user_id, material, weight_g, created_at, session_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      machine.kiosk_id,
      userId,
      m.material,
      m.grams,
      now,
      sessionId,
    ]);
  }
  const user = await rewardUserById(tx, userId);
  if (!user) return null;
  // A signed machine record is the strongest proof Kitar has, so it may earn offer-backed points,
  // at each material's own rate. A guest's claim earns XP only (BR23).
  const offerWorth = guestClaim ? undefined : await offerWorthByMaterial(tx, byMaterial);
  const reward = await recordAction(tx, { user, activity: 'KITAR_DROPOFF', ref: test ? test.ref : `machine:${sessionId}`, quantity: grams, now, offerEligible: !guestClaim, xpOnly: guestClaim, offerWorth });
  const kg = (grams / 1000).toLocaleString('en-MY', { maximumFractionDigits: 2 });
  await notify(tx, [userId], {
    title: test ? `Test entry recorded at ${machine.name}` : `Recycling recorded at ${machine.name}`,
    body: reward.skipped ? `${kg} kg recorded. You have reached today’s recycling limit for rewards.` : `${kg} kg recorded: +${reward.xp} XP${reward.points ? `, +${reward.points} points` : ''}${reward.offerPoints ? `, +${reward.offerPoints} offer points` : ''}.`,
    link: '/app/kitar',
  });
  return reward;
}

/** Device endpoint: the machine's signed summary closes the session. */
export async function ingestFinish(db: Db, record: SummaryRecord & { signature: string }, now: Date) {
  return db.tx(async (tx) => {
    const machine = await loadMachine(tx, record.machineId);
    assertSigned(machine, summaryText(record), record.signature, record.ts, now);
    return finishSession(tx, machine, record, record.signature, now);
  });
}

/** A resident claims a guest session within 14 days: XP only, never points (BR23). */
export async function claimGuestSession(db: Db, actor: Actor, code: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const session = await one<{ id: string; machine_id: string; accepted_g: number; claim_expires_at: Date; claimed_by: string | null }>(
      tx,
      `SELECT s.id, s.machine_id, s.accepted_g, s.claim_expires_at, s.claimed_by FROM kitar_sessions s JOIN kitar_machines m ON m.id = s.machine_id
        WHERE s.claim_hash = $1 AND s.mode = 'GUEST' AND s.status = 'DONE' AND m.township_id = $2 FOR UPDATE OF s`,
      [hashClaim(code), resident.townshipId],
    );
    if (!session) throw notFound('Claim code');
    if (session.claimed_by) throw conflict('ALREADY_CLAIMED', 'This recycling has already been claimed.');
    if (session.claim_expires_at <= now) throw ruleViolation('CLAIM_EXPIRED', `Guest recycling can be claimed for ${CLAIM_DAYS} days only.`);
    await tx.query('UPDATE kitar_sessions SET claimed_by = $2, claimed_at = $3 WHERE id = $1', [session.id, resident.id, now]);
    const machine = await loadMachine(tx, session.machine_id);
    const byMaterial = await tx.query<{ material: Material; grams: number }>(
      `SELECT material, sum(weight_g)::int AS grams FROM kitar_items WHERE session_id = $1 AND accepted GROUP BY material`,
      [session.id],
    );
    const reward = await creditDropOff(tx, machine, session.id, resident.id, byMaterial, session.accepted_g, now, true);
    return { grams: session.accepted_g, reward };
  });
}

/** What the resident's phone shows while they recycle, and the result once the machine finishes. */
export async function myMachineSession(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const session = await one<SessionRow & { machine: string; machine_material: Material | null; reward: ActionReward | null; closed_at: Date | null }>(
    db,
    `SELECT s.*, m.name AS machine, m.material AS machine_material FROM kitar_sessions s JOIN kitar_machines m ON m.id = s.machine_id
      WHERE s.user_id = $1 AND s.started_at > $2::timestamptz - interval '30 minutes' ORDER BY s.started_at DESC LIMIT 1`,
    [resident.id, now],
  );
  if (!session) return null;
  const items = await db.query('SELECT seq, material, weight_g, accepted, reason FROM kitar_items WHERE session_id = $1 ORDER BY seq', [session.id]);
  return {
    id: session.id,
    machine: session.machine,
    material: session.machine_material,
    status: session.status,
    acceptedCount: session.accepted_count,
    rejectedCount: session.rejected_count,
    acceptedG: session.accepted_g,
    reward: session.reward,
    items,
  };
}

// --- The console's simulated machine ------------------------------------------------------

async function staffMachine(tx: Queryable, actor: Actor, machineId: string, lock = false): Promise<MachineRow> {
  const machine = await loadMachine(tx, machineId, lock);
  assertTownshipAccess(actor, machine.township_id);
  return machine;
}

/** What the machine's screen shows: its rotating code, and the session in progress. */
export async function machineScreen(db: Db, actor: Actor, machineId: string, now: Date) {
  const machine = await staffMachine(db, actor, machineId);
  const window = Math.floor(now.getTime() / WINDOW_MS);
  const session = await one<SessionRow & { full_name: string | null }>(
    db,
    `SELECT s.*, u.full_name FROM kitar_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.machine_id = $1 AND s.status = 'OPEN'`,
    [machine.id],
  );
  const items = session ? await db.query('SELECT seq, material, weight_g, accepted, reason FROM kitar_items WHERE session_id = $1 ORDER BY seq', [session.id]) : [];
  const kiosk = await one<{ name: string; location: string }>(db, 'SELECT name, location FROM kitar_kiosks WHERE id = $1', [machine.kiosk_id]);
  return {
    machine: { id: machine.id, name: machine.name, status: machine.status, material: machine.material, kiosk: kiosk!.name, location: kiosk!.location },
    // The resident's phone opens this link from the QR code: the code inside is only good for about a minute.
    screen: { code: screenCode(machine.secret, machine.id, window), expiresInMs: (window + 1) * WINDOW_MS - now.getTime() },
    session: session
      ? {
          id: session.id,
          mode: session.mode,
          // The machine greets a resident by first name only.
          greeting: session.full_name ? session.full_name.split(/\s+/)[0] : null,
          acceptedCount: session.accepted_count,
          rejectedCount: session.rejected_count,
          acceptedG: session.accepted_g,
          items,
        }
      : null,
  };
}

/** The console stands in for the machine's camera reading a SimeTown QR, or a guest tapping "Recycle as guest". */
export async function simulateStart(db: Db, actor: Actor, machineId: string, input: { mode: 'MEMBER_QR' | 'GUEST'; memberCode?: string }, now: Date) {
  return db.tx(async (tx) => {
    const machine = await staffMachine(tx, actor, machineId, true);
    const record: StartRecord = { machineId, mode: input.mode, memberCode: input.mode === 'MEMBER_QR' ? (input.memberCode ?? '').trim().toUpperCase() : null, ts: now.toISOString() };
    assertSigned(machine, startText(record), hmac(machine.secret, startText(record)), record.ts, now);
    return startSession(tx, machine, record, now);
  });
}

/**
 * Stands in for the machine's camera, barcode reader and scale. `outcome`
 * chooses what the simulated sensors report, so the checks can be shown.
 */
export async function simulateItem(db: Db, actor: Actor, machineId: string, input: { material: Material; outcome: 'ACCEPT' | 'WRONG_MATERIAL' | 'NOT_TAKEN' }, now: Date) {
  return db.tx(async (tx) => {
    const machine = await staffMachine(tx, actor, machineId);
    const session = await one<{ id: string; n: number }>(
      tx,
      `SELECT s.id, (SELECT count(*)::int FROM kitar_items i WHERE i.session_id = s.id) AS n FROM kitar_sessions s WHERE s.machine_id = $1 AND s.status = 'OPEN'`,
      [machine.id],
    );
    if (!session) throw ruleViolation('NO_SESSION', 'Start a session at the bin first.');
    const [min, max] = ITEM_WEIGHT[input.material];
    const other = MATERIALS.find((m) => m !== input.material)!;
    const record: ItemRecord = {
      machineId,
      sessionId: session.id,
      seq: session.n + 1,
      material: input.material,
      cameraMaterial: input.outcome === 'WRONG_MATERIAL' ? other : input.material,
      barcodeOk: input.outcome !== 'NOT_TAKEN',
      weightG: randomInt(min, Math.min(max, min * 4) + 1),
      accepted: input.outcome !== 'NOT_TAKEN',
      ts: now.toISOString(),
    };
    const signature = hmac(machine.secret, itemText(record));
    assertSigned(machine, itemText(record), signature, record.ts, now);
    return storeItem(tx, machine, record, signature, now);
  });
}

export async function simulateFinish(db: Db, actor: Actor, machineId: string, now: Date) {
  return db.tx(async (tx) => {
    const machine = await staffMachine(tx, actor, machineId);
    const session = await one<SessionRow>(tx, `SELECT * FROM kitar_sessions WHERE machine_id = $1 AND status = 'OPEN'`, [machine.id]);
    if (!session) throw ruleViolation('NO_SESSION', 'There is no session to finish.');
    const record: SummaryRecord = {
      machineId,
      sessionId: session.id,
      acceptedCount: session.accepted_count,
      rejectedCount: session.rejected_count,
      acceptedG: session.accepted_g,
      ts: now.toISOString(),
    };
    const signature = hmac(machine.secret, summaryText(record));
    assertSigned(machine, summaryText(record), signature, record.ts, now);
    return finishSession(tx, machine, record, signature, now);
  });
}

/** Staff mark a machine full or offline (bin-full and offline alerts), or back online. */
export async function setMachineStatus(db: Db, actor: Actor, machineId: string, status: MachineRow['status'], now: Date) {
  return db.tx(async (tx) => {
    const machine = await staffMachine(tx, actor, machineId, true);
    await tx.query('UPDATE kitar_machines SET status = $2, last_seen_at = $3 WHERE id = $1', [machine.id, status, now]);
    if (status !== 'ONLINE' && machine.status === 'ONLINE') {
      const staff = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`, [machine.township_id]);
      await notify(tx, staff.map((s) => s.id), { title: `${machine.name} is ${status === 'FULL' ? 'full' : 'offline'}`, body: 'Residents are sent to the kiosk until it is back.', link: '/console/places' });
    }
    await audit(tx, actor.id, 'MACHINE_STATUS', 'kitar_machine', machine.id, { from: machine.status, to: status });
    return { status };
  });
}

/** Admins set the one material a bin takes, or clear it (null: any material). Not while someone is recycling at it. */
export async function setMachineMaterial(db: Db, actor: Actor, machineId: string, material: Material | null) {
  return db.tx(async (tx) => {
    const machine = await staffMachine(tx, actor, machineId, true);
    if (await one(tx, `SELECT 1 FROM kitar_sessions WHERE machine_id = $1 AND status = 'OPEN'`, [machine.id])) {
      throw conflict('MACHINE_BUSY', 'Someone is using this bin. Please wait a moment.');
    }
    await tx.query('UPDATE kitar_machines SET material = $2 WHERE id = $1', [machine.id, material]);
    await audit(tx, actor.id, 'MACHINE_MATERIAL', 'kitar_machine', machine.id, { from: machine.material, to: material });
    return { material };
  });
}

/** Machines with today's use and their state, for staff and for Insights ("machine uptime"). */
export async function listMachines(db: Db, actor: Actor, now: Date) {
  return db.query(
    `SELECT m.id, m.name, m.status, m.material, m.last_seen_at, k.name AS kiosk,
            (SELECT count(*)::int FROM kitar_sessions s WHERE s.machine_id = m.id AND s.status = 'DONE' AND s.closed_at > $2::timestamptz - interval '24 hours') AS sessions_today,
            (SELECT coalesce(sum(s.accepted_g), 0)::int FROM kitar_sessions s WHERE s.machine_id = m.id AND s.status = 'DONE' AND s.closed_at > $2::timestamptz - interval '24 hours') AS grams_today
       FROM kitar_machines m JOIN kitar_kiosks k ON k.id = m.kiosk_id
      WHERE ($1::uuid IS NULL OR m.township_id = $1) ORDER BY m.name`,
    [actor.townshipId, now],
  );
}

/** The machines a resident can use, for the Kitar screen. */
export async function machinesForResident(q: Queryable, townshipId: string) {
  return q.query(
    `SELECT m.id, m.name, m.status, m.material, k.location, k.id AS kiosk_id, k.name AS kiosk FROM kitar_machines m JOIN kitar_kiosks k ON k.id = m.kiosk_id WHERE m.township_id = $1 ORDER BY m.name`,
    [townshipId],
  );
}

/**
 * Puts a machine at a kiosk. Its signing key is made here and never leaves the server, except to the device itself at set-up.
 * A bin can be set to one material; without one it takes any material.
 */
export async function createMachine(db: Db, actor: Actor, input: { name: string; kioskId: string; material?: Material | null }) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    const kiosk = await one(tx, 'SELECT 1 FROM kitar_kiosks WHERE id = $1 AND township_id = $2', [input.kioskId, townshipId]);
    if (!kiosk) throw notFound('Kiosk');
    if (await one(tx, 'SELECT 1 FROM kitar_machines WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('MACHINE_EXISTS', 'A machine with this name already exists.');
    }
    const row = await one<{ id: string }>(
      tx,
      'INSERT INTO kitar_machines (township_id, kiosk_id, name, secret, material) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [townshipId, input.kioskId, input.name, randomBytes(32).toString('hex'), input.material ?? null],
    );
    await audit(tx, actor.id, 'MACHINE_CREATED', 'kitar_machine', row!.id, { name: input.name, material: input.material ?? null });
    return { id: row!.id };
  });
}
