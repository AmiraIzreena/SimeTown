import { ADMINS, PLACE_KINDS, type PlaceKind } from '@/shared/domain';
import { ACCESS_CATEGORIES, DEFAULT_ACCESS_POLICY, DEFAULT_ROUTING, type AccessCategory, type AccessPolicy, type PartyKind, type PartyRef, type RoutingRule } from '@/shared/akses';
import type { Priority } from '@/shared/incidents';
import { one, type Queryable } from '../../db/client';
import { townshipOf, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';

/**
 * The township's accessibility set-up: the organisations responsible for
 * facilities, the routing rules that send each kind of problem to one of them,
 * and the response and verification policy. All of it is data an admin can
 * change; the workflow reads it at the moment it decides.
 */

export interface Party extends PartyRef {
  name: string;
  integration: 'IN_APP' | 'SIMULATED';
  contact: string | null;
  simulate_failures: number;
}

export const requireAdmin = (actor: Actor) => {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only an admin can change this.');
};

export async function listParties(q: Queryable, townshipId: string): Promise<(Party & { members: { id: string; full_name: string; role: string }[]; places: number; open_issues: number })[]> {
  return q.query(
    `SELECT p.id, p.name, p.kind, p.integration, p.contact, p.active, p.simulate_failures,
            coalesce((SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role) ORDER BY u.full_name)
                        FROM access_party_members m JOIN users u ON u.id = m.user_id WHERE m.party_id = p.id), '[]') AS members,
            (SELECT count(*)::int FROM access_places pl WHERE pl.party_id = p.id AND pl.archived_at IS NULL) AS places,
            (SELECT count(*)::int FROM access_incidents i WHERE i.party_id = p.id AND i.status <> 'RESOLVED') AS open_issues
       FROM access_parties p WHERE p.township_id = $1 ORDER BY p.active DESC, p.name`,
    [townshipId],
  );
}

/** Who last changed each part of the configuration, for the governance line under each section. */
export async function configChanges(q: Queryable, townshipId: string) {
  const last = (actions: string[]) => one<{ at: Date; by: string | null }>(
    q,
    `SELECT a.created_at AS at, u.full_name AS by FROM audit_log a JOIN users u ON u.id = a.actor_user_id
      WHERE a.action = ANY($1::text[]) AND u.township_id = $2 ORDER BY a.id DESC LIMIT 1`,
    [actions, townshipId],
  );
  const [providers, rules, levels] = await Promise.all([
    last(['ACCESS_PARTY_CREATED', 'ACCESS_PARTY_UPDATED']),
    last(['ACCESS_RULE_SAVED', 'ACCESS_RULE_DELETED']),
    last(['ACCESS_POLICY_CHANGED']),
  ]);
  return { providers: providers ?? null, rules: rules ?? null, levels: levels ?? null };
}

export async function partyRefs(q: Queryable, townshipId: string): Promise<PartyRef[]> {
  return q.query('SELECT id, kind, active FROM access_parties WHERE township_id = $1', [townshipId]);
}

export async function createParty(q: Queryable, actor: Actor, input: { name: string; kind: PartyKind; integration: 'IN_APP' | 'SIMULATED'; contact?: string }) {
  requireAdmin(actor);
  const townshipId = townshipOf(actor);
  if (await one(q, 'SELECT 1 FROM access_parties WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
    throw conflict('PARTY_EXISTS', 'An organisation with this name is already set up.');
  }
  const row = await one<{ id: string }>(
    q, `INSERT INTO access_parties (township_id, name, kind, integration, contact) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [townshipId, input.name, input.kind, input.integration, input.contact ?? null],
  );
  await audit(q, actor.id, 'ACCESS_PARTY_CREATED', 'access_party', row!.id, input);
  return { id: row!.id };
}

export async function updateParty(q: Queryable, actor: Actor, partyId: string, input: { active?: boolean; simulateFailures?: number; addMember?: string; removeMember?: string }) {
  requireAdmin(actor);
  const party = await one<{ township_id: string; integration: string }>(q, 'SELECT township_id, integration FROM access_parties WHERE id = $1', [partyId]);
  if (!party || party.township_id !== townshipOf(actor)) throw notFound('Organisation');
  if (input.active !== undefined) await q.query('UPDATE access_parties SET active = $2 WHERE id = $1', [partyId, input.active]);
  if (input.simulateFailures !== undefined) {
    if (party.integration !== 'SIMULATED') throw ruleViolation('NOT_SIMULATED', 'Only a simulated integration can be told to fail.');
    await q.query('UPDATE access_parties SET simulate_failures = $2 WHERE id = $1', [partyId, input.simulateFailures]);
  }
  if (input.addMember) {
    // Members keep their own role: township staff, or guards for the security team. No new account type.
    const user = await one(q, `SELECT 1 FROM users WHERE id = $1 AND township_id = $2 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'GUARD') AND status = 'ACTIVE'`, [input.addMember, party.township_id]);
    if (!user) throw notFound('Staff member');
    await q.query('INSERT INTO access_party_members (party_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [partyId, input.addMember]);
  }
  if (input.removeMember) await q.query('DELETE FROM access_party_members WHERE party_id = $1 AND user_id = $2', [partyId, input.removeMember]);
  await audit(q, actor.id, 'ACCESS_PARTY_UPDATED', 'access_party', partyId, input);
  return { ok: true };
}

// --- Routing rules ----------------------------------------------------------------------

export async function townshipRules(q: Queryable, townshipId: string): Promise<RoutingRule[]> {
  const rows = await q.query<{ id: string; category: AccessCategory; place_kind: PlaceKind | null; target: 'PLACE' | 'PARTY'; party_id: string | null; priority: Priority }>(
    'SELECT id, category, place_kind, target, party_id, priority FROM access_routing_rules WHERE township_id = $1', [townshipId],
  );
  return rows.map((r) => ({
    id: r.id, category: r.category, placeKind: r.place_kind, priority: r.priority, source: 'TOWNSHIP',
    target: r.target === 'PARTY' ? { type: 'PARTY', partyId: r.party_id! } : { type: 'PLACE' },
  }));
}

/** Every rule that applies, the township's own first, for the console to show what decides. */
export async function effectiveRules(q: Queryable, actor: Actor) {
  const townshipId = townshipOf(actor);
  const own = await townshipRules(q, townshipId);
  const shadowed = (r: RoutingRule) => own.some((o) => o.category === r.category && o.placeKind === r.placeKind);
  return [...own, ...DEFAULT_ROUTING.filter((r) => !shadowed(r))];
}

export async function saveRule(
  q: Queryable, actor: Actor,
  input: { category: AccessCategory; placeKind: PlaceKind | null; target: 'PLACE' | 'PARTY'; partyId?: string | null; priority: Priority },
  now: Date,
) {
  requireAdmin(actor);
  const townshipId = townshipOf(actor);
  if (!ACCESS_CATEGORIES.includes(input.category) || (input.placeKind && !PLACE_KINDS.includes(input.placeKind))) throw notFound('Category');
  const partyId = input.target === 'PARTY' ? input.partyId ?? null : null;
  if (input.target === 'PARTY' && !(partyId && (await one(q, 'SELECT 1 FROM access_parties WHERE id = $1 AND township_id = $2', [partyId, townshipId])))) {
    throw ruleViolation('PARTY_NEEDED', 'Choose the organisation this goes to.');
  }
  await q.query(
    `INSERT INTO access_routing_rules (township_id, category, place_kind, target, party_id, priority, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (township_id, category, coalesce(place_kind, '*')) DO UPDATE SET target = EXCLUDED.target, party_id = EXCLUDED.party_id,
            priority = EXCLUDED.priority, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [townshipId, input.category, input.placeKind, input.target, partyId, input.priority, actor.id, now],
  );
  await audit(q, actor.id, 'ACCESS_RULE_SAVED', 'access_routing_rule', null, input);
  return effectiveRules(q, actor);
}

export async function deleteRule(q: Queryable, actor: Actor, ruleId: string) {
  requireAdmin(actor);
  const rows = await q.query('DELETE FROM access_routing_rules WHERE id = $1 AND township_id = $2 RETURNING id', [ruleId, townshipOf(actor)]);
  if (!rows.length) throw notFound('Rule');
  await audit(q, actor.id, 'ACCESS_RULE_DELETED', 'access_routing_rule', ruleId);
  return effectiveRules(q, actor);
}

// --- Policy -------------------------------------------------------------------------------

export async function getAccessPolicy(q: Queryable, townshipId: string): Promise<AccessPolicy> {
  const row = await one<{ policy: Partial<AccessPolicy> }>(q, 'SELECT policy FROM access_policies WHERE township_id = $1', [townshipId]);
  const p = row?.policy ?? {};
  return {
    ...DEFAULT_ACCESS_POLICY,
    ...p,
    targets: { ...DEFAULT_ACCESS_POLICY.targets, ...p.targets },
    confirmations: { ...DEFAULT_ACCESS_POLICY.confirmations, ...p.confirmations },
    recurring: { ...DEFAULT_ACCESS_POLICY.recurring, ...p.recurring },
    inspectionDays: { ...DEFAULT_ACCESS_POLICY.inspectionDays, ...p.inspectionDays },
  };
}

export async function saveAccessPolicy(q: Queryable, actor: Actor, changes: Partial<AccessPolicy>, now: Date) {
  requireAdmin(actor);
  const townshipId = townshipOf(actor);
  const before = await getAccessPolicy(q, townshipId);
  const next: AccessPolicy = {
    ...before, ...changes,
    targets: { ...before.targets, ...changes.targets },
    confirmations: { ...before.confirmations, ...changes.confirmations },
    recurring: { ...before.recurring, ...changes.recurring },
    inspectionDays: { ...before.inspectionDays, ...changes.inspectionDays },
  };
  for (const t of Object.values(next.targets)) if (t.resolve < t.ack) throw ruleViolation('POLICY_INVALID', 'The time to resolve cannot be shorter than the time to acknowledge.');
  await q.query(
    `INSERT INTO access_policies (township_id, policy, updated_by, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (township_id) DO UPDATE SET policy = EXCLUDED.policy, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [townshipId, JSON.stringify(next), actor.id, now],
  );
  await audit(q, actor.id, 'ACCESS_POLICY_CHANGED', 'access_policy', null, { changes });
  return next;
}
