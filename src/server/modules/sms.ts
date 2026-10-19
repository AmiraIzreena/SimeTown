import type { Queryable } from '../db/client';

/**
 * SMS for danger alerts (BR19), so residents without the app open are reached.
 *
 * The prototype has no SMS provider: each message is recorded in the outbox as
 * SIMULATED, so the dashboard can show who would have been texted. In the pilot
 * a provider (chosen after the telco and legal review in Appendix E.4) sends the
 * QUEUED messages. Phone numbers in the outbox are deleted after 30 days.
 */
export async function queueSms(
  q: Queryable,
  userIds: string[],
  input: { body: string; reason: 'FLOOD_DANGER'; zoneId?: string },
  now: Date,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await q.query(
    `INSERT INTO sms_outbox (user_id, phone, body, reason, zone_id, status, created_at)
     SELECT u.id, u.phone, $2, $3, $4, 'SIMULATED', $5 FROM users u
      WHERE u.id = ANY($1::uuid[]) AND u.phone IS NOT NULL AND u.status = 'ACTIVE'
     RETURNING id`,
    [userIds, input.body.slice(0, 480), input.reason, input.zoneId ?? null, now],
  );
  return rows.length;
}
