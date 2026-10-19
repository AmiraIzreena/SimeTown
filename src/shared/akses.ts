import type { PlaceKind } from './domain';
import type { Priority } from './incidents';

/**
 * Akses+ accessibility management, shared by the server and the screens. A
 * place has two independent states: whether it has been verified as accessible,
 * and whether it can be used today. Resident reports become incidents that move
 * only along the transitions below. Routing and verification are plain rules,
 * so every automatic decision can be read back and explained.
 */

export const VERIFICATION_STATES = ['PENDING_VERIFICATION', 'VERIFIED', 'VERIFICATION_REQUIRED', 'NOT_VERIFIED'] as const;
export type Verification = (typeof VERIFICATION_STATES)[number];
export const VERIFICATION_LABELS: Record<Verification, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  VERIFIED: 'Verified accessible',
  VERIFICATION_REQUIRED: 'Verification required',
  NOT_VERIFIED: 'Not verified accessible',
};

export const AVAILABILITY_STATES = ['AVAILABLE', 'REPORTED_BLOCKED', 'CONFIRMED_BLOCKED', 'RESOLUTION_PENDING', 'UNKNOWN'] as const;
export type Availability = (typeof AVAILABILITY_STATES)[number];
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  AVAILABLE: 'Available',
  REPORTED_BLOCKED: 'Reported blocked',
  CONFIRMED_BLOCKED: 'Confirmed blocked',
  RESOLUTION_PENDING: 'Fix reported, being checked',
  UNKNOWN: 'Unknown',
};
/** What residents are told each availability means, so a report is never mistaken for a confirmed fact. */
export const AVAILABILITY_HINTS: Record<Availability, string> = {
  AVAILABLE: 'No open problem.',
  REPORTED_BLOCKED: 'Residents have reported a problem. Not yet confirmed.',
  CONFIRMED_BLOCKED: 'The team responsible has confirmed the problem.',
  RESOLUTION_PENDING: 'The team says it is fixed. Waiting for confirmation.',
  UNKNOWN: 'Not checked yet.',
};

export const ACCESS_INCIDENT_STATUSES = [
  'REPORTED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'VERIFICATION_PENDING', 'RESOLVED', 'REOPENED', 'ESCALATED',
] as const;
export type AccessIncidentStatus = (typeof ACCESS_INCIDENT_STATUSES)[number];

/** Every move an incident may make. The server refuses anything else. */
export const ACCESS_TRANSITIONS: Record<AccessIncidentStatus, readonly AccessIncidentStatus[]> = {
  REPORTED: ['TRIAGED', 'ESCALATED'],
  TRIAGED: ['ASSIGNED', 'ESCALATED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'ESCALATED'],
  IN_PROGRESS: ['RESOLUTION_SUBMITTED', 'ESCALATED'],
  RESOLUTION_SUBMITTED: ['VERIFICATION_PENDING', 'RESOLVED', 'IN_PROGRESS'],
  VERIFICATION_PENDING: ['RESOLVED', 'IN_PROGRESS', 'ESCALATED'],
  RESOLVED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'],
  // Escalated: management is watching. The responsible party can still act, and an admin can reassign or decide.
  ESCALATED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'RESOLVED'],
};
export const canMoveAccess = (from: AccessIncidentStatus, to: AccessIncidentStatus) => ACCESS_TRANSITIONS[from].includes(to);
export const ACCESS_ACTIVE: AccessIncidentStatus[] = ['REPORTED', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLUTION_SUBMITTED', 'VERIFICATION_PENDING', 'REOPENED', 'ESCALATED'];

export const ACCESS_STATUS_LABELS: Record<AccessIncidentStatus, string> = {
  REPORTED: 'Reported',
  TRIAGED: 'Triaged',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLUTION_SUBMITTED: 'Resolution submitted',
  VERIFICATION_PENDING: 'Verification pending',
  RESOLVED: 'Resolved',
  REOPENED: 'Reopened',
  ESCALATED: 'Escalated',
};

export const ACCESS_CATEGORIES = ['OBSTRUCTION', 'PARKING_OBSTRUCTION', 'DAMAGED', 'OUT_OF_SERVICE', 'ROUTE_INACCESSIBLE', 'MISINFORMATION', 'OTHER'] as const;
export type AccessCategory = (typeof ACCESS_CATEGORIES)[number];
export const ACCESS_CATEGORY_INFO: Record<AccessCategory, { label: string; hint: string; blocks: boolean; needsNote?: boolean }> = {
  OBSTRUCTION: { label: 'Something is blocking it', hint: 'Bins, goods, works or other objects in the way.', blocks: true },
  PARKING_OBSTRUCTION: { label: 'A vehicle is blocking it', hint: 'Cars or motorcycles across a ramp or in an OKU bay without a permit.', blocks: true },
  DAMAGED: { label: 'Damaged or unsafe', hint: 'Broken surface, loose handrail, missing tiles.', blocks: true },
  OUT_OF_SERVICE: { label: 'Not working or locked', hint: 'Lift out of service, toilet locked, door will not open.', blocks: true },
  ROUTE_INACCESSIBLE: { label: 'Route no longer step-free', hint: 'Closed path, new kerb or steps, a diversion without a ramp.', blocks: true },
  MISINFORMATION: { label: 'The listing is wrong', hint: 'It was never accessible, or the details are wrong.', blocks: false, needsNote: true },
  OTHER: { label: 'Something else', hint: 'Tell us what is wrong.', blocks: false, needsNote: true },
};

export const PARTY_KINDS = ['TOWNSHIP_OPERATIONS', 'SECURITY', 'FACILITY_MANAGER', 'JMB_MC', 'MAINTENANCE_CONTRACTOR', 'LOCAL_AUTHORITY', 'ACCESS_VERIFIER'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];
export const PARTY_KIND_LABELS: Record<PartyKind, string> = {
  TOWNSHIP_OPERATIONS: 'Township operations',
  SECURITY: 'Security team',
  FACILITY_MANAGER: 'Facilities management',
  JMB_MC: 'JMB / MC',
  MAINTENANCE_CONTRACTOR: 'Maintenance contractor',
  LOCAL_AUTHORITY: 'Local authority',
  ACCESS_VERIFIER: 'Accessibility verification',
};

/** Where a rule sends an incident: whoever runs the place, a named party, or the one active party of a kind. */
export type RouteTarget = { type: 'PLACE' } | { type: 'PARTY'; partyId: string } | { type: 'PARTY_KIND'; kind: PartyKind };
export interface RoutingRule {
  id?: string;
  category: AccessCategory;
  placeKind: PlaceKind | null;
  target: RouteTarget;
  priority: Priority;
  source: 'TOWNSHIP' | 'DEFAULT';
}

/** The prototype's starting rules. A township's own rules (by category, or category and kind of place) take precedence. */
export const DEFAULT_ROUTING: RoutingRule[] = [
  { category: 'PARKING_OBSTRUCTION', placeKind: null, target: { type: 'PARTY_KIND', kind: 'SECURITY' }, priority: 'NORMAL', source: 'DEFAULT' },
  { category: 'OUT_OF_SERVICE', placeKind: 'LIFT', target: { type: 'PLACE' }, priority: 'HIGH', source: 'DEFAULT' },
  { category: 'OUT_OF_SERVICE', placeKind: null, target: { type: 'PLACE' }, priority: 'NORMAL', source: 'DEFAULT' },
  { category: 'DAMAGED', placeKind: 'RAMP', target: { type: 'PLACE' }, priority: 'HIGH', source: 'DEFAULT' },
  { category: 'DAMAGED', placeKind: 'STEP_FREE_ROUTE', target: { type: 'PLACE' }, priority: 'HIGH', source: 'DEFAULT' },
  { category: 'DAMAGED', placeKind: null, target: { type: 'PLACE' }, priority: 'NORMAL', source: 'DEFAULT' },
  { category: 'OBSTRUCTION', placeKind: null, target: { type: 'PLACE' }, priority: 'NORMAL', source: 'DEFAULT' },
  { category: 'ROUTE_INACCESSIBLE', placeKind: null, target: { type: 'PLACE' }, priority: 'NORMAL', source: 'DEFAULT' },
  { category: 'MISINFORMATION', placeKind: null, target: { type: 'PARTY_KIND', kind: 'ACCESS_VERIFIER' }, priority: 'LOW', source: 'DEFAULT' },
  { category: 'OTHER', placeKind: null, target: { type: 'PLACE' }, priority: 'NORMAL', source: 'DEFAULT' },
];

/** The most specific rule wins: the township's own before the defaults, a kind of place before "any". */
export function pickRule(rules: RoutingRule[], category: AccessCategory, kind: PlaceKind): RoutingRule {
  const candidates = [...rules.filter((r) => r.source === 'TOWNSHIP'), ...DEFAULT_ROUTING];
  return candidates.find((r) => r.category === category && r.placeKind === kind) ?? candidates.find((r) => r.category === category && r.placeKind === null)!;
}

export interface PartyRef { id: string; kind: PartyKind; active: boolean }

/**
 * Who must act. Never a guess: an inactive party, a place nobody is recorded as
 * running, or two parties of the same kind all send the incident to the
 * exception queue with the reason.
 */
export function resolveParty(rule: RoutingRule, placePartyId: string | null, parties: PartyRef[]): { partyId: string } | { exception: string } {
  const active = parties.filter((p) => p.active);
  if (rule.target.type === 'PARTY') {
    const id = rule.target.partyId;
    return active.some((p) => p.id === id) ? { partyId: id } : { exception: 'The party named in the routing rule is not active.' };
  }
  if (rule.target.type === 'PLACE') {
    if (!placePartyId) return { exception: 'No organisation is recorded as responsible for this place.' };
    return active.some((p) => p.id === placePartyId) ? { partyId: placePartyId } : { exception: 'The organisation responsible for this place is not active.' };
  }
  const kind = rule.target.kind;
  const ofKind = active.filter((p) => p.kind === kind);
  if (ofKind.length === 1) return { partyId: ofKind[0]!.id };
  return { exception: ofKind.length === 0 ? `No active ${PARTY_KIND_LABELS[kind].toLowerCase()} is set up.` : `More than one ${PARTY_KIND_LABELS[kind].toLowerCase()} could handle this.` };
}

export interface AccessTarget { ack: number; resolve: number; working: boolean }
export interface AccessPolicy {
  /** Minutes to acknowledge and to resolve, per priority. */
  targets: Record<Priority, AccessTarget>;
  /** Independent "it is clear now" confirmations needed before a claimed fix counts, per priority. */
  confirmations: Record<Priority, number>;
  /** Distinct residents reporting the same problem confirm it without waiting for the responsible party. */
  corroboration: number;
  /** Hours a claimed fix may wait for confirmation before a person is asked to inspect. */
  verifyHours: number;
  /** Days after resolution in which a resident can say the problem is back. */
  disputeDays: number;
  /** Incidents at one place within the window that make it a recurring problem. */
  recurring: { incidents: number; days: number };
  /** Distinct residents saying a listing is wrong before its verification is questioned. */
  misinformation: number;
  /** Categories whose resolution must include a photo. */
  photoRequired: AccessCategory[];
  /** Days between routine inspections, by kind of place (risk-based: lifts most often). */
  inspectionDays: Record<PlaceKind, number>;
}

export const DEFAULT_ACCESS_POLICY: AccessPolicy = {
  targets: {
    CRITICAL: { ack: 30, resolve: 8 * 60, working: false },
    HIGH: { ack: 2 * 60, resolve: 24 * 60, working: false },
    NORMAL: { ack: 4 * 60, resolve: 3 * 9 * 60, working: true },
    LOW: { ack: 9 * 60, resolve: 5 * 9 * 60, working: true },
  },
  confirmations: { CRITICAL: 2, HIGH: 2, NORMAL: 1, LOW: 1 },
  corroboration: 3,
  verifyHours: 48,
  disputeDays: 7,
  recurring: { incidents: 3, days: 30 },
  misinformation: 2,
  photoRequired: ['OBSTRUCTION', 'PARKING_OBSTRUCTION', 'DAMAGED', 'ROUTE_INACCESSIBLE'],
  inspectionDays: { LIFT: 90, ACCESSIBLE_TOILET: 90, RAMP: 180, STEP_FREE_ROUTE: 180, OKU_PARKING: 365, SEATING: 365 },
};

/**
 * Whether a claimed fix is verified. A photo alone never is: it needs residents
 * confirming independently, a staff inspection, or the facility's own system
 * reporting it back in service. Any "still blocked" answer stops it.
 */
export function verificationOutcome(input: { priority: Priority; clear: number; stillBlocked: number; telemetry: boolean }, policy: AccessPolicy): 'RESOLVED' | 'DISPUTED' | 'PENDING' {
  if (input.stillBlocked > 0) return 'DISPUTED';
  if (input.telemetry && input.clear >= 1) return 'RESOLVED';
  if (input.telemetry && (input.priority === 'NORMAL' || input.priority === 'LOW')) return 'RESOLVED';
  return input.clear >= policy.confirmations[input.priority] ? 'RESOLVED' : 'PENDING';
}

/** Parties SDP runs itself. Problems with facilities run by others are theirs to fix, and SDP hears only when it matters. */
export const SDP_PARTY_KINDS: PartyKind[] = ['TOWNSHIP_OPERATIONS', 'SECURITY', 'ACCESS_VERIFIER'];
/**
 * Whether an escalation is pushed to the township's SDP admins. Unrouted
 * incidents and SDP's own teams always; a third party's (a JMB, a contractor)
 * only when the priority is high or critical. Every escalation still shows on
 * the console either way.
 */
export function escalatesToSdp(partyKind: PartyKind | null, priority: Priority): boolean {
  if (!partyKind || SDP_PARTY_KINDS.includes(partyKind)) return true;
  return priority === 'CRITICAL' || priority === 'HIGH';
}

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'to', 'and', 'jalan', 'jln', 'block', 'blok', 'near', 'by', 'in', 'on']);
export const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}
/** A suggested place probably already listed: the same kind, and a name or location that mostly matches. */
export function isLikelyDuplicate(a: { name: string; kind: string; location: string }, b: { name: string; kind: string; location: string }): boolean {
  if (a.kind !== b.kind) return false;
  return similarity(a.name, b.name) >= 0.6 || (similarity(a.location, b.location) >= 0.7 && similarity(a.name, b.name) >= 0.3);
}
