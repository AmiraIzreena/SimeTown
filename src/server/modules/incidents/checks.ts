import { one, type Db } from '../../db/client';
import { appendEvent, escalate, type IncidentRow } from './engine';
import { getIncidentPolicy } from './policy';

/**
 * The deadline watch, run by the scheduler every few minutes (the `incidents`
 * job). It escalates cases nobody took in time and cases past their resolution
 * deadline, and closes resolved cases once the reporter's window to dispute
 * them has passed. Each escalation is raised once, so running it again, or
 * after a restart, never sends a second alert; nothing here depends on a
 * browser being open.
 */
export async function runIncidentChecks(db: Db, now: Date, townshipId: string | null = null) {
  let unassigned = 0;
  let overdue = 0;
  let closed = 0;
  const late = await db.query<IncidentRow>(
    `SELECT * FROM incidents
      WHERE ($2::uuid IS NULL OR township_id = $2)
        AND ((owner_id IS NULL AND status IN ('OPEN', 'REOPENED') AND assign_due_at < $1)
          OR (status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'REOPENED') AND resolve_due_at < $1))
      ORDER BY created_at LIMIT 500`,
    [now, townshipId],
  );
  for (const row of late) {
    await db.tx(async (tx) => {
      const i = (await one<IncidentRow>(tx, 'SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [row.id]))!;
      if (i.owner_id === null && (i.status === 'OPEN' || i.status === 'REOPENED') && i.assign_due_at && i.assign_due_at < now) {
        if (await escalate(tx, i, 'UNASSIGNED', `unassigned:${i.reopen_count}`, `Nobody has taken this ${i.priority.toLowerCase()}-priority case since it was ${i.reopen_count ? 'reopened' : 'reported'}.`, null, now)) unassigned++;
      }
      if (i.resolve_due_at && i.resolve_due_at < now && !['RESOLVED', 'CLOSED'].includes(i.status)) {
        if (await escalate(tx, i, 'OVERDUE', `overdue:${i.reopen_count}`, 'This case is past its resolution deadline.', null, now)) overdue++;
      }
    });
  }
  // Resolved cases close once the reporter can no longer dispute them. Unresolved ones are never closed automatically.
  const resolved = await db.query<{ id: string; township_id: string; resolved_at: Date }>(
    `SELECT id, township_id, resolved_at FROM incidents WHERE status = 'RESOLVED' AND ($2::uuid IS NULL OR township_id = $2) AND resolved_at < $1::timestamptz - interval '1 day' LIMIT 500`,
    [now, townshipId],
  );
  for (const r of resolved) {
    const policy = await getIncidentPolicy(db, r.township_id);
    if (now.getTime() - r.resolved_at.getTime() < policy.dispute_days * 86_400_000) continue;
    await db.tx(async (tx) => {
      const done = await tx.query(`UPDATE incidents SET status = 'CLOSED', closed_at = $2, updated_at = $2 WHERE id = $1 AND status = 'RESOLVED' RETURNING id`, [r.id, now]);
      if (done.length) {
        await appendEvent(tx, r.id, { kind: 'CLOSED', visibility: 'RESIDENT', body: 'This report is closed.' }, now);
        closed++;
      }
    });
  }
  return { unassignedEscalated: unassigned, overdueEscalated: overdue, closed };
}
