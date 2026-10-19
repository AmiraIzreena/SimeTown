import { randomUUID } from 'node:crypto';
import { one, type Db } from '../../db/client';
import { townshipOf, type Actor } from '../../auth/actor';
import { AppError, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { requireAdmin } from './config';
import { acknowledgeIncident, appendAccessEvent, escalateAccess, submitResolution, type AccessIncident } from './incidents';

/**
 * Connections to the systems of the organisations that run facilities (a lift
 * contractor's job system, a JMB's helpdesk). No real one exists yet, so the
 * prototype has a SIMULATED adapter, labelled as such everywhere it shows. A
 * real adapter implements the same two things: deliver an outbox message, and
 * report events back through `handlePartyEvent`.
 */

export interface DispatchMessage { id: string; kind: string; payload: Record<string, unknown> }
export interface PartyAdapter { deliver(party: { id: string; simulate_failures: number }, message: DispatchMessage, db: Db): Promise<{ externalRef: string }> }

/** Stands in for a provider's system. Accepts every message, unless told to fail the next few (to show retries). */
const simulated: PartyAdapter = {
  async deliver(party, message, db) {
    if (party.simulate_failures > 0) {
      await db.query('UPDATE access_parties SET simulate_failures = simulate_failures - 1 WHERE id = $1 AND simulate_failures > 0', [party.id]);
      throw new Error('Simulated provider did not answer.');
    }
    return { externalRef: `SIM-${message.id.slice(0, 8).toUpperCase()}` };
  },
};
export const ADAPTERS: Record<'SIMULATED', PartyAdapter> = { SIMULATED: simulated };

export const MAX_ATTEMPTS = 5;

/**
 * Delivers due outbox messages. Each is claimed first (so two runs never send
 * the same one at once), sent outside any transaction, then recorded. A
 * failure is retried with growing gaps; after the last attempt the incident is
 * escalated, because the party may never have heard of it.
 */
export async function deliverDispatches(db: Db, now: Date) {
  let sent = 0;
  let failed = 0;
  let retrying = 0;
  const due = await db.query<{ id: string }>(`SELECT id FROM access_dispatches WHERE status = 'PENDING' AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT 100`, [now]);
  for (const { id } of due) {
    // Claim: push the next attempt out so a parallel run skips it while this one works.
    const claimed = await one<{ id: string; kind: string; payload: Record<string, unknown>; attempts: number; party_id: string; incident_id: string }>(
      db, `UPDATE access_dispatches SET next_attempt_at = $2::timestamptz + interval '5 minutes' WHERE id = $1 AND status = 'PENDING' AND next_attempt_at <= $2 RETURNING id, kind, payload, attempts, party_id, incident_id`, [id, now],
    );
    if (!claimed) continue;
    const party = (await one<{ id: string; integration: 'IN_APP' | 'SIMULATED'; simulate_failures: number }>(db, 'SELECT id, integration, simulate_failures FROM access_parties WHERE id = $1', [claimed.party_id]))!;
    const adapter = party.integration === 'SIMULATED' ? ADAPTERS.SIMULATED : null;
    try {
      if (!adapter) throw new Error('This organisation has no integration.');
      const result = await adapter.deliver(party, claimed, db);
      await db.tx(async (tx) => {
        await tx.query(`UPDATE access_dispatches SET status = 'SENT', attempts = attempts + 1, external_ref = $2, sent_at = $3, last_error = NULL WHERE id = $1`, [claimed.id, result.externalRef, now]);
        await one(tx, 'SELECT 1 FROM access_incidents WHERE id = $1 FOR UPDATE', [claimed.incident_id]);
        await appendAccessEvent(tx, claimed.incident_id, { kind: 'DISPATCHED', visibility: 'INTERNAL', body: `Sent to the organisation’s system (simulated): ${result.externalRef}`, data: { dispatchId: claimed.id, kind: claimed.kind, attempt: claimed.attempts + 1 }, actorKind: 'SYSTEM' }, now);
      });
      sent++;
    } catch (error) {
      const attempts = claimed.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      await db.tx(async (tx) => {
        if (attempts >= MAX_ATTEMPTS) {
          await tx.query(`UPDATE access_dispatches SET status = 'FAILED', attempts = $2, last_error = $3 WHERE id = $1`, [claimed.id, attempts, message]);
          const i = (await one<AccessIncident>(tx, 'SELECT * FROM access_incidents WHERE id = $1 FOR UPDATE', [claimed.incident_id]))!;
          await escalateAccess(tx, i, { reason: 'DISPATCH_FAILED', level: 'ESCALATION', key: `dispatch:${claimed.id}`, note: `The organisation’s system could not be reached after ${attempts} attempts: ${message}`, setStatus: true }, now);
          failed++;
        } else {
          // 2, 4, 8, 16 minutes.
          await tx.query(`UPDATE access_dispatches SET attempts = $2, last_error = $3, next_attempt_at = $4 WHERE id = $1`, [claimed.id, attempts, message, new Date(now.getTime() + 2 ** attempts * 60_000)]);
          retrying++;
        }
      });
    }
  }
  return { dispatched: sent, dispatchRetrying: retrying, dispatchFailed: failed };
}

export interface PartyEvent { eventId: string; reference: string; type: 'ACKNOWLEDGED' | 'RESOLVED'; actionTaken?: string; telemetry?: boolean }

/**
 * An event from a party's system. Each event id is processed exactly once:
 * a repeat returns the first result and changes nothing. An event that no
 * longer fits the incident (it moved on) is recorded and ignored, not applied.
 */
export async function handlePartyEvent(db: Db, partyId: string, e: PartyEvent, now: Date) {
  return db.tx(async (tx) => {
    const seen = await one<{ result: Record<string, unknown> }>(tx, 'SELECT result FROM access_integration_events WHERE party_id = $1 AND event_id = $2', [partyId, e.eventId]);
    if (seen) return { ...seen.result, duplicate: true };
    const incident = await one<{ id: string; party_id: string | null }>(tx, 'SELECT id, party_id FROM access_incidents WHERE reference = $1', [e.reference]);
    if (!incident) throw notFound('Incident');
    let result: Record<string, unknown>;
    try {
      const acting = { kind: 'INTEGRATION' as const, partyId };
      const r = e.type === 'ACKNOWLEDGED'
        ? await acknowledgeIncident(tx, acting, incident.id, now)
        : await submitResolution(tx, acting, incident.id, { actionTaken: e.actionTaken?.trim() || 'Fixed (reported by the organisation’s system).', telemetry: e.telemetry }, now);
      result = { applied: true, status: r.status };
    } catch (error) {
      // Only a state or permission refusal is recorded as ignored. Anything else rolls back so the event can be sent again.
      if (!(error instanceof AppError) || error.status >= 500) throw error;
      result = { applied: false, reason: error.message };
    }
    await tx.query(
      'INSERT INTO access_integration_events (party_id, event_id, incident_id, kind, result, received_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [partyId, e.eventId, incident.id, e.type, JSON.stringify(result), now],
    );
    return result;
  });
}

/** Console demo: make the simulated provider answer as its real system would. Admins only, and labelled as a simulation. */
export async function simulateProvider(db: Db, actor: Actor, incidentId: string, input: { type: 'ACKNOWLEDGED' | 'RESOLVED'; telemetry?: boolean; actionTaken?: string; eventId?: string }, now: Date) {
  requireAdmin(actor);
  const i = await one<{ reference: string; party_id: string | null; township_id: string }>(db, 'SELECT reference, party_id, township_id FROM access_incidents WHERE id = $1', [incidentId]);
  if (!i || i.township_id !== townshipOf(actor)) throw notFound('Incident');
  const party = i.party_id ? await one<{ integration: string }>(db, 'SELECT integration FROM access_parties WHERE id = $1', [i.party_id]) : undefined;
  if (party?.integration !== 'SIMULATED') throw ruleViolation('NOT_SIMULATED', 'This incident is not with an organisation reached through a simulated integration.');
  const result = await handlePartyEvent(db, i.party_id!, { eventId: input.eventId ?? randomUUID(), reference: i.reference, type: input.type, telemetry: input.telemetry, actionTaken: input.actionTaken }, now);
  await audit(db, actor.id, 'ACCESS_PROVIDER_SIMULATED', 'access_incident', incidentId, { type: input.type, telemetry: Boolean(input.telemetry) });
  return result;
}
