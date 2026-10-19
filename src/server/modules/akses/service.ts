import type { AccessNeed } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { notFound, ruleViolation } from '../../errors';
import { notify } from '../notifications';

/**
 * Akses+ (proposal 6.6, BR32). A resident tells the app their access needs
 * once, and every screen adapts. Access needs are sensitive: they are stored
 * only with clear consent, seen only by the resident (and by duty staff
 * during an emergency, as the priority help list), and deleted on request.
 */

export interface AccessProfileInput {
  needs: AccessNeed[];
  simpleMode: boolean;
  readAloud: boolean;
  flashAlerts: boolean;
  priorityHelp: boolean;
  priorityNote?: string;
  consent: boolean;
}

const DEFAULTS = { needs: [] as AccessNeed[], simpleMode: false, readAloud: false, flashAlerts: false, priorityHelp: false, priorityNote: null as string | null, consentAt: null as Date | null };

export async function getAccessProfile(db: Db, actor: Actor) {
  const row = await one<{ needs: AccessNeed[]; simple_mode: boolean; read_aloud: boolean; flash_alerts: boolean; priority_help: boolean; priority_note: string | null; consent_at: Date }>(
    db,
    'SELECT needs, simple_mode, read_aloud, flash_alerts, priority_help, priority_note, consent_at FROM access_profiles WHERE user_id = $1',
    [actor.id],
  );
  if (!row) return DEFAULTS;
  return { needs: row.needs, simpleMode: row.simple_mode, readAloud: row.read_aloud, flashAlerts: row.flash_alerts, priorityHelp: row.priority_help, priorityNote: row.priority_note, consentAt: row.consent_at };
}

export async function saveAccessProfile(db: Db, actor: Actor, input: AccessProfileInput, now: Date) {
  // Display choices alone (Simple Mode, read-aloud, flashing alerts) are not health data, but anything
  // that says something about the person, or asks staff to act, needs explicit consent.
  if ((input.needs.length > 0 || input.priorityHelp) && !input.consent) {
    throw ruleViolation('CONSENT_NEEDED', 'Please agree to how we keep and use this information.', { fields: { consent: 'Needed to save access needs or join the priority help list.' } });
  }
  if (input.priorityHelp && actor.role !== 'RESIDENT') throw ruleViolation('RESIDENTS_ONLY', 'The priority help list is for residents.');
  await db.query(
    `INSERT INTO access_profiles (user_id, needs, simple_mode, read_aloud, flash_alerts, priority_help, priority_note, consent_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (user_id) DO UPDATE SET needs = EXCLUDED.needs, simple_mode = EXCLUDED.simple_mode, read_aloud = EXCLUDED.read_aloud,
            flash_alerts = EXCLUDED.flash_alerts, priority_help = EXCLUDED.priority_help, priority_note = EXCLUDED.priority_note,
            consent_at = EXCLUDED.consent_at, updated_at = EXCLUDED.updated_at`,
    [actor.id, input.needs, input.simpleMode, input.readAloud, input.flashAlerts, input.priorityHelp, input.priorityHelp ? (input.priorityNote ?? null) : null, now],
  );
  return getAccessProfile(db, actor);
}

/** Deleted on request, at once and completely (BR32). */
export async function deleteAccessProfile(db: Db, actor: Actor) {
  await db.query('DELETE FROM access_profiles WHERE user_id = $1', [actor.id]);
  return DEFAULTS;
}

// --- Carers -------------------------------------------------------------------------

/**
 * A resident asks a family member (another verified resident of the township)
 * to be their carer. The carer accepts. While the link is active the carer
 * hears about flood alerts in the resident's zone and sees whether they have
 * checked in safe. Either side can end it at any time.
 */
export async function inviteCarer(db: Db, actor: Actor, memberCode: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const carer = await one<{ id: string }>(
      tx,
      `SELECT id FROM users WHERE member_code = $1 AND township_id = $2 AND role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE'`,
      [memberCode.trim().toUpperCase(), resident.townshipId],
    );
    if (!carer) throw notFound('Member');
    if (carer.id === resident.id) throw ruleViolation('SELF', 'You cannot be your own carer.');
    const row = await one<{ id: string; status: string }>(
      tx,
      `INSERT INTO carer_links (resident_id, carer_id, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (resident_id, carer_id) DO UPDATE SET status = CASE WHEN carer_links.status = 'REVOKED' THEN 'PENDING' ELSE carer_links.status END,
                                                         created_at = CASE WHEN carer_links.status = 'REVOKED' THEN EXCLUDED.created_at ELSE carer_links.created_at END
       RETURNING id, status`,
      [resident.id, carer.id, now],
    );
    if (row!.status === 'PENDING') {
      await notify(tx, [carer.id], { title: `${resident.fullName.split(/\s+/)[0]} asked you to be their carer`, body: 'Accept in Akses+ to hear about flood alerts in their area.', link: '/app/akses' });
    }
    return { id: row!.id, status: row!.status };
  });
}

export async function respondToCarerInvite(db: Db, actor: Actor, linkId: string, accept: boolean, now: Date) {
  const rows = await db.query<{ resident_id: string }>(
    `UPDATE carer_links SET status = $3, accepted_at = CASE WHEN $3 = 'ACTIVE' THEN $4::timestamptz ELSE NULL END, revoked_at = CASE WHEN $3 = 'REVOKED' THEN $4::timestamptz ELSE NULL END
      WHERE id = $1 AND carer_id = $2 AND status = 'PENDING' RETURNING resident_id`,
    [linkId, actor.id, accept ? 'ACTIVE' : 'REVOKED', now],
  );
  if (rows.length === 0) throw notFound('Request');
  await notify(db, [rows[0]!.resident_id], { title: accept ? 'Your carer accepted' : 'Your carer declined', body: accept ? 'They will hear about flood alerts in your area.' : 'You can ask someone else.', link: '/app/akses' });
  return { status: accept ? 'ACTIVE' : 'REVOKED' };
}

export async function endCarerLink(db: Db, actor: Actor, linkId: string, now: Date) {
  const rows = await db.query(
    `UPDATE carer_links SET status = 'REVOKED', revoked_at = $3 WHERE id = $1 AND (resident_id = $2 OR carer_id = $2) AND status <> 'REVOKED' RETURNING id`,
    [linkId, actor.id, now],
  );
  if (rows.length === 0) throw notFound('Link');
  return { status: 'REVOKED' };
}

/** My carers, and the people I care for with their area's flood status (never their access needs). */
export async function carerOverview(db: Db, actor: Actor) {
  const [myCarers, caringFor] = await Promise.all([
    db.query(
      `SELECT c.id, c.status, c.created_at, u.full_name FROM carer_links c JOIN users u ON u.id = c.carer_id
        WHERE c.resident_id = $1 AND c.status <> 'REVOKED' ORDER BY c.created_at`,
      [actor.id],
    ),
    db.query(
      `SELECT c.id, c.status, u.full_name, z.name AS zone_name, z.status AS zone_status,
              (SELECT f.status FROM flood_alerts a JOIN flood_checkins f ON f.alert_id = a.id WHERE a.zone_id = z.id AND a.ended_at IS NULL AND f.user_id = u.id) AS checked_in
         FROM carer_links c JOIN users u ON u.id = c.resident_id LEFT JOIN homes h ON h.id = u.home_id LEFT JOIN flood_zones z ON z.id = h.zone_id
        WHERE c.carer_id = $1 AND c.status <> 'REVOKED' ORDER BY c.created_at`,
      [actor.id],
    ),
  ]);
  return {
    myCarers,
    // A pending invitation shows the name only; the area's status only once the link is accepted.
    caringFor: caringFor.map((r) => (r.status === 'ACTIVE' ? r : { id: r.id, status: r.status, full_name: r.full_name })),
  };
}

// Accessible places, their incidents and the automation around them live in places.ts, incidents.ts and automation.ts.
