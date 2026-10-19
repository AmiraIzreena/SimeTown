import type { Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { badRequest, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { runFloatCheck, runSettlement } from '../ledger/finance';
import { expirePoints, sendExpiryReminders } from '../ledger/points';
import { expireOfferPoints } from '../offers/service';
import { sendParcelReminders } from '../parcels/service';
import { reconcile } from '../lockers/hardware';
import { notifyProviders } from '../carriers/providers';
import { revalidateCouriers } from '../carriers/team';
import { runIncidentChecks } from '../incidents/checks';
import { runAccessChecks } from '../akses/automation';
import { runCollectionChecks } from '../kitar/collection-automation';
import { runExpiry } from '../lockers/overflow';
import { retentionCleanup } from '../retention';
import { runAgentClock } from '../banjir/agent';
import { getSettings, SETTINGS_COLUMNS, type Settings } from '../settings';

/** Audit trail, programme settings and scheduled jobs. */

export async function listAudit(db: Db, actor: Actor, page: PageQuery) {
  const [, afterId] = decodeCursor(page.cursor, 'id');
  // Township admins see what people of their township did; HQ sees everything.
  // `subject` names the thing that changed (a shop, a kiosk, a report's place), so the page can say which one.
  const rows = await db.query<{ id: number }>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at, u.full_name AS actor_name, u.role AS actor_role,
            CASE a.entity_type
              WHEN 'report' THEN (SELECT r.location_text FROM reports r WHERE r.id::text = a.entity_id)
              WHEN 'merchant' THEN (SELECT m.name FROM merchants m WHERE m.id::text = a.entity_id)
              WHEN 'sale' THEN (SELECT m.name FROM sales s JOIN merchants m ON m.id = s.merchant_id WHERE s.id::text = a.entity_id)
              WHEN 'campaign' THEN (SELECT c.title FROM campaigns c WHERE c.id::text = a.entity_id)
              WHEN 'sponsor' THEN (SELECT sp.name FROM sponsors sp WHERE sp.id::text = a.entity_id)
              WHEN 'user' THEN (SELECT t.full_name FROM users t WHERE t.id::text = a.entity_id)
              WHEN 'post' THEN (SELECT p.title FROM posts p WHERE p.id::text = a.entity_id)
              WHEN 'gerak_loop' THEN (SELECT g.name FROM gerak_loops g WHERE g.id::text = a.entity_id)
              WHEN 'kitar_kiosk' THEN (SELECT k.name FROM kitar_kiosks k WHERE k.id::text = a.entity_id)
              WHEN 'flood_zone' THEN (SELECT z.name FROM flood_zones z WHERE z.id::text = a.entity_id)
              WHEN 'account_request' THEN (SELECT coalesce(t.full_name, r.full_name) FROM account_requests r LEFT JOIN users t ON t.id = r.user_id
                                            WHERE r.id::text = a.entity_id)
            END AS subject
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ($1::uuid IS NULL OR u.township_id = $1) AND ($2::bigint IS NULL OR a.id < $2::bigint)
      ORDER BY a.id DESC LIMIT $3`,
    [actor.townshipId, afterId, page.limit + 1],
  );
  return toPage(rows, page.limit, (r) => ['', r.id]);
}

export async function updateSettings(db: Db, actor: Actor, changes: Partial<Settings>, now: Date) {
  const keys = SETTINGS_COLUMNS.filter((key) => changes[key] !== undefined);
  if (keys.length === 0) throw badRequest('Nothing to change.');
  return db.tx(async (tx) => {
    const before = await getSettings(tx);
    // Rules that compare two settings are checked against the result, so a change to one side is caught too.
    const after = { ...before, ...changes };
    if (after.flood_danger_pct < after.flood_warning_pct) {
      throw ruleViolation('SETTINGS_INVALID', 'The danger level must be at or above the warning level.', { fields: { flood_danger_pct: 'Must be at or above the warning level.' } });
    }
    if (after.expiry_max_months < after.expiry_inactive_months) {
      throw ruleViolation('SETTINGS_INVALID', 'Points cannot expire sooner overall than after inactivity.', { fields: { expiry_max_months: 'Must be at least the inactivity period.' } });
    }
    await tx.query(
      `UPDATE program_settings SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(', ')}, updated_at = $1`,
      [now, ...keys.map((key) => changes[key])],
    );
    await audit(tx, actor.id, 'SETTINGS_CHANGED', 'program_settings', null, Object.fromEntries(keys.map((key) => [key, { from: before[key], to: changes[key] }])));
    return getSettings(tx);
  });
}

export const JOBS = ['expire-points', 'float-check', 'settle', 'cleanup', 'flood-agent', 'parcel-reminders', 'lockers', 'couriers', 'incidents', 'access', 'recycling'] as const;
export type JobName = (typeof JOBS)[number];

/**
 * Scheduled work, called by any scheduler through POST /internal/jobs/:name or
 * `npm run job <name>`. Suggested timing: expire-points, float-check and cleanup
 * daily; settle weekly. Every job is safe to run twice.
 */
export async function runJob(db: Db, name: JobName, now: Date): Promise<Record<string, unknown>> {
  switch (name) {
    case 'expire-points':
      return { ...(await expirePoints(db, now)), offerLotsExpired: await expireOfferPoints(db, now), reminders: await sendExpiryReminders(db, now) };
    case 'float-check': {
      const check = await runFloatCheck(db, null, now);
      return { ok: check.ok, issues: check.issues };
    }
    case 'settle':
      return runSettlement(db, null, now);
    case 'parcel-reminders':
      // Daily: one reminder for each parcel waiting three days or more.
      return { remindersSent: await sendParcelReminders(db, now) };
    case 'lockers':
      // Every few minutes: settle unanswered door commands and unused reservations, doors left open, then reminders, overdue parcels,
      // relocation tasks, and telling courier companies about deposits they have not heard of (retried).
      return { ...(await reconcile(db, now)), ...(await runExpiry(db, now)), providers: await notifyProviders(db, now) };
    case 'incidents':
      // Every 5 minutes: escalate cases nobody took in time or past their deadline (once each), close resolved cases after the dispute window.
      return runIncidentChecks(db, now);
    case 'access':
      // Every 5 minutes: Akses+ reminders and escalations (once each), stalled verifications, inspection reminders, and delivering or retrying messages to parties' systems.
      return runAccessChecks(db, now);
    case 'recycling':
      // Nightly: day-before reminders, collections that did not happen or were never weighed, and homes or collectors to check.
      return runCollectionChecks(db, now);
    case 'couriers':
      // Daily: couriers their company has not reconfirmed are paused, agreements about to end are flagged, ended ones stop access.
      return revalidateCouriers(db, now);
    case 'flood-agent':
      // Every minute or two: one-signal drafts past their deadline, and the 15-minute updates (BR28).
      return runAgentClock(db, now);
    case 'cleanup': {
      const sessions = await db.query('DELETE FROM sessions WHERE expires_at < $1 RETURNING id', [now]);
      await db.query(`DELETE FROM rate_limits WHERE window_start < $1::timestamptz - interval '1 day'`, [now]);
      await db.query(`DELETE FROM user_invites WHERE expires_at < $1 OR used_at IS NOT NULL`, [now]);
      const sales = await db.query(`UPDATE sales SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < $1 RETURNING id`, [now]);
      return { sessionsRemoved: sessions.length, salesExpired: sales.length, ...(await retentionCleanup(db, now)) };
    }
  }
}
