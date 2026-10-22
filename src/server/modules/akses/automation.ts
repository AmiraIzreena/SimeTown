import { PLACE_KIND_LABELS, type PlaceKind } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { notify } from '../notifications';
import { escalateAccess, rerouteWaiting, type AccessIncident } from './incidents';
import { deliverDispatches } from './integrations';

/**
 * The Akses+ clock, run by the scheduler every few minutes (the `access` job).
 * It routes any incident still waiting for a team once one can take it; reminds a responsible party that has not acknowledged or fixed an
 * incident in time and escalates when the reminder did not help; asks a person
 * to inspect a claimed fix nobody has confirmed; delivers and retries messages
 * to parties' systems; and reminds inspectors when a place is due. Every
 * reminder and escalation is raised once, so running it twice, or after a
 * restart, changes nothing. It never marks a place available, and never
 * resolves an incident, on its own.
 */
export async function runAccessChecks(db: Db, now: Date, townshipId: string | null = null) {
  // First, the safety net: anything still waiting for a team is routed if a team can now take it.
  const rerouted = await rerouteWaiting(db, townshipId, now);
  const counts = { rerouted, reminders: 0, escalations: 0, verificationStalled: 0, inspectionReminders: 0 };
  const candidates = await db.query<{ id: string }>(
    `SELECT id FROM access_incidents
      WHERE ($2::uuid IS NULL OR township_id = $2) AND status <> 'RESOLVED'
        AND ((party_id IS NOT NULL AND acknowledged_at IS NULL AND ack_due_at < $1)
          OR (resolution_submitted_at IS NULL AND resolve_due_at < $1)
          OR (status = 'VERIFICATION_PENDING' AND verify_due_at < $1))
      ORDER BY created_at LIMIT 500`,
    [now, townshipId],
  );
  for (const { id } of candidates) {
    await db.tx(async (tx) => {
      const i = (await one<AccessIncident>(tx, 'SELECT * FROM access_incidents WHERE id = $1 FOR UPDATE', [id]))!;
      if (i.status === 'RESOLVED') return;
      const round = `${i.reopen_count}:${i.party_id}`;
      // Not acknowledged: a reminder at the deadline; an escalation when a second window has passed too.
      if (i.party_id && !i.acknowledged_at && i.ack_due_at && i.ack_due_at < now && !i.resolution_submitted_at) {
        if (await escalateAccess(tx, i, { reason: 'NOT_ACKNOWLEDGED', level: 'REMINDER', key: `ack-reminder:${round}`, note: 'This incident has not been acknowledged in time.' }, now)) counts.reminders++;
        const window = i.ack_due_at.getTime() - (i.assigned_at ?? i.created_at).getTime();
        if (now.getTime() >= i.ack_due_at.getTime() + window) {
          if (await escalateAccess(tx, i, { reason: 'NOT_ACKNOWLEDGED', level: 'ESCALATION', key: `ack:${round}`, note: 'Still not acknowledged after a reminder.', setStatus: true }, now)) counts.escalations++;
        }
      }
      // Past its resolution target with no fix claimed: a reminder, then an escalation a day later.
      if (i.resolve_due_at && i.resolve_due_at < now && !i.resolution_submitted_at) {
        if (await escalateAccess(tx, i, { reason: 'OVERDUE', level: 'REMINDER', key: `overdue-reminder:${i.reopen_count}`, note: 'This incident is past its resolution target.' }, now)) counts.reminders++;
        if (now.getTime() >= i.resolve_due_at.getTime() + 86_400_000 || i.priority === 'CRITICAL') {
          if (await escalateAccess(tx, i, { reason: 'OVERDUE', level: 'ESCALATION', key: `overdue:${i.reopen_count}`, note: 'Still not resolved after its target and a reminder.', setStatus: true }, now)) counts.escalations++;
        }
      }
      // A claimed fix nobody has confirmed: a person inspects it. It is never accepted just because nobody objected.
      if (i.status === 'VERIFICATION_PENDING' && i.verify_due_at && i.verify_due_at < now) {
        if (await escalateAccess(tx, i, { reason: 'VERIFICATION_STALLED', level: 'ESCALATION', key: `verify:${i.verify_due_at.getTime()}`, note: 'Nobody has confirmed the claimed fix. Please inspect it.', setStatus: true }, now)) counts.verificationStalled++;
      }
    });
  }

  // Inspections due: a reminder to whoever runs the place (or the township's admins), once per due date. The place stays listed and verified.
  const due = await db.query<{ id: string; township_id: string; name: string; kind: PlaceKind; party_id: string | null; next_inspection_at: Date }>(
    `SELECT id, township_id, name, kind, party_id, next_inspection_at FROM access_places
      WHERE archived_at IS NULL AND ($2::uuid IS NULL OR township_id = $2) AND next_inspection_at < $1
        AND (inspection_reminded_at IS NULL OR inspection_reminded_at < next_inspection_at) LIMIT 500`,
    [now, townshipId],
  );
  for (const p of due) {
    await db.tx(async (tx) => {
      const claimed = await tx.query('UPDATE access_places SET inspection_reminded_at = $2 WHERE id = $1 AND (inspection_reminded_at IS NULL OR inspection_reminded_at < next_inspection_at) RETURNING id', [p.id, now]);
      if (!claimed.length) return;
      const members = p.party_id ? (await tx.query<{ user_id: string }>('SELECT user_id FROM access_party_members WHERE party_id = $1', [p.party_id])).map((r) => r.user_id) : [];
      const to = members.length ? members : (await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE'`, [p.township_id])).map((r) => r.id);
      await notify(tx, to, {
        title: `Inspection due: ${p.name}`, body: `Routine check of this ${PLACE_KIND_LABELS[p.kind].toLowerCase()}. Record it in Access places.`,
        link: '/console/access', category: 'REPORTS', dedupeKey: `access-inspection:${p.id}:${p.next_inspection_at.getTime()}`,
      });
      counts.inspectionReminders++;
    });
  }

  return { ...counts, ...(await deliverDispatches(db, now)) };
}
