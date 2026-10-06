import type { Queryable } from '../db/client';

/** Writes one line to the audit trail. Call it in the same transaction as the change it describes. */
export async function audit(
  q: Queryable,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await q.query(
    'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actorId, action, entityType, entityId, JSON.stringify(detail)],
  );
}
