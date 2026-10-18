/**
 * The township's incident vocabulary, shared by the server and the screens:
 * case statuses and the moves between them, priorities, and the rules that
 * decide who must act on a reported problem. The rules are plain data, so the
 * township can change them without touching the workflow.
 */

export const INCIDENT_STATUSES = ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'RESOLVED', 'REOPENED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Every move a case may make. The server refuses anything else. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'RESOLVED'],
  INVESTIGATING: ['AWAITING_EXTERNAL_PARTY', 'RESOLVED'],
  AWAITING_EXTERNAL_PARTY: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['REOPENED', 'CLOSED'],
  REOPENED: ['ASSIGNED', 'INVESTIGATING', 'RESOLVED'],
  CLOSED: [],
};
export const canMoveIncident = (from: IncidentStatus, to: IncidentStatus) => INCIDENT_TRANSITIONS[from].includes(to);
/** Statuses in which a case is still someone's work. */
export const ACTIVE_STATUSES: IncidentStatus[] = ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'REOPENED'];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Waiting for someone to take it',
  ASSIGNED: 'Assigned',
  INVESTIGATING: 'Being investigated',
  AWAITING_EXTERNAL_PARTY: 'Waiting for someone else',
  RESOLVED: 'Resolved',
  REOPENED: 'Reopened',
  CLOSED: 'Closed',
};

/** A case's status as the person who reported it sees it. */
export const RESIDENT_STATUS: Record<IncidentStatus, string> = {
  OPEN: 'Received', ASSIGNED: 'Being handled', INVESTIGATING: 'Being investigated', AWAITING_EXTERNAL_PARTY: 'Waiting for an answer',
  RESOLVED: 'Resolved', REOPENED: 'Reopened', CLOSED: 'Closed',
};

export const PRIORITIES = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };

export type IncidentModule = 'LOCKERS' | 'PARCELS' | 'GUARDHOUSE' | 'COURIERS' | 'FACILITIES' | 'COMMUNITY';
export const MODULE_LABELS: Record<IncidentModule | 'LAPOR', string> = {
  LOCKERS: 'Smart lockers', PARCELS: 'Guardhouse parcels', GUARDHOUSE: 'Gate and access', COURIERS: 'Courier platform', FACILITIES: 'Facilities', COMMUNITY: 'Community', LAPOR: 'Lapor',
};

export const AWAITING_LABELS = { RESIDENT: 'the resident', COURIER: 'the courier company', CONTRACTOR: 'a contractor', OTHER: 'someone else' } as const;
export type Awaiting = keyof typeof AWAITING_LABELS;

export const RESOLUTION_CATEGORIES = ['FIXED', 'PARCEL_FOUND', 'RECORDS_CONFIRMED', 'REFERRED_TO_COURIER', 'NO_FAULT_FOUND', 'DUPLICATE', 'OTHER'] as const;
export type ResolutionCategory = (typeof RESOLUTION_CATEGORIES)[number];
export const RESOLUTION_LABELS: Record<ResolutionCategory, string> = {
  FIXED: 'Fixed', PARCEL_FOUND: 'Parcel found and returned', RECORDS_CONFIRMED: 'Records checked and confirmed', REFERRED_TO_COURIER: 'For the courier company to handle',
  NO_FAULT_FOUND: 'No fault found', DUPLICATE: 'Duplicate of another case', OTHER: 'Other',
};

/** Where a problem is being reported from: it decides which reasons make sense. */
export const REPORT_CONTEXTS = ['LOCKER_WAITING', 'LOCKER_DONE', 'GUARD_WAITING', 'GUARD_DONE', 'NOT_ARRIVED', 'GATE', 'COURIER_STATION'] as const;
export type ReportContext = (typeof REPORT_CONTEXTS)[number];

/** Who must act. COURIER problems are referred, not opened as township cases. */
export type Responsibility = 'COURIER' | 'TOWNSHIP' | 'MIXED' | 'UNCERTAIN';

export interface ReportReason {
  key: string;
  label: string;
  hint: string;
  responsibility: Responsibility;
  module: IncidentModule;
  category: string;
  priority: Priority;
  /** The resident must describe it. */
  needsNote?: boolean;
}

const notSure = (module: IncidentModule): ReportReason => ({
  key: 'NOT_SURE', label: 'Not sure / I need help', hint: 'Tell us what happened. The township office works out who should handle it.', responsibility: 'UNCERTAIN', module, category: 'NEEDS_ASSISTANCE', priority: 'NORMAL', needsNote: true,
});

/**
 * The decision rules. Courier problems (delays, damage in transit, wrong
 * contents, delivery cancelled) belong to the courier company. Township
 * problems (lockers, the guardhouse, access, security) belong to the township.
 * Mixed problems need the township's own records checked first.
 */
export const REPORT_REASONS: Record<ReportContext, ReportReason[]> = {
  LOCKER_WAITING: [
    { key: 'DOOR_WONT_OPEN', label: 'The door will not open', hint: 'The PIN, QR code or app did not open my locker.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'LOCKER_WONT_OPEN', priority: 'HIGH' },
    { key: 'PARCEL_TRAPPED', label: 'My parcel is stuck inside', hint: 'The door opened but the parcel cannot be taken out, or the door shut again.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'PARCEL_TRAPPED', priority: 'HIGH' },
    { key: 'WRONG_LOCKER', label: 'Wrong or empty locker', hint: 'The door opened, but it was empty or held someone else’s parcel.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'WRONG_LOCKER', priority: 'HIGH' },
    { key: 'LOCKER_DAMAGED', label: 'The locker is damaged', hint: 'A broken door, a keypad that does not work, or signs of tampering.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'LOCKER_MALFUNCTION', priority: 'NORMAL' },
    notSure('LOCKERS'),
  ],
  LOCKER_DONE: [
    { key: 'NOT_COLLECTED', label: 'I didn’t collect this', hint: 'It is marked as collected, but nobody in your home took it.', responsibility: 'MIXED', module: 'LOCKERS', category: 'COLLECTION_DISPUTE', priority: 'HIGH' },
    { key: 'NOT_OURS', label: 'Not our parcel', hint: 'The locker gave us someone else’s parcel.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'WRONG_HOUSEHOLD', priority: 'HIGH' },
    { key: 'DAMAGED', label: 'It arrived damaged', hint: 'The box or what is inside was broken or wet.', responsibility: 'COURIER', module: 'LOCKERS', category: 'DAMAGED_IN_TRANSIT', priority: 'NORMAL' },
    { key: 'WRONG_CONTENTS', label: 'Wrong or missing items', hint: 'The parcel was ours, but something inside was wrong or missing.', responsibility: 'COURIER', module: 'LOCKERS', category: 'WRONG_CONTENTS', priority: 'NORMAL' },
    notSure('LOCKERS'),
  ],
  GUARD_WAITING: [
    { key: 'GUARD_REFUSED', label: 'The guard could not find or hand it over', hint: 'I showed my code, but the parcel was not given to me.', responsibility: 'TOWNSHIP', module: 'PARCELS', category: 'GUARD_HANDOVER', priority: 'NORMAL' },
    notSure('PARCELS'),
  ],
  GUARD_DONE: [
    { key: 'NOT_COLLECTED', label: 'I didn’t collect this', hint: 'It is marked as collected at the guardhouse, but nobody in your home took it.', responsibility: 'MIXED', module: 'PARCELS', category: 'COLLECTION_DISPUTE', priority: 'HIGH' },
    { key: 'DAMAGED', label: 'It arrived damaged', hint: 'The box or what is inside was broken or wet.', responsibility: 'COURIER', module: 'PARCELS', category: 'DAMAGED_IN_TRANSIT', priority: 'NORMAL' },
    { key: 'WRONG_CONTENTS', label: 'Wrong or missing items', hint: 'The parcel was ours, but something inside was wrong or missing.', responsibility: 'COURIER', module: 'PARCELS', category: 'WRONG_CONTENTS', priority: 'NORMAL' },
    notSure('PARCELS'),
  ],
  NOT_ARRIVED: [
    { key: 'DELAYED', label: 'My parcel is late', hint: 'The courier’s tracking says it should be here by now.', responsibility: 'COURIER', module: 'COURIERS', category: 'DELIVERY_DELAYED', priority: 'LOW' },
    { key: 'MARKED_DELIVERED', label: 'Tracking says delivered, but it is not here', hint: 'It is not in a locker or at the guardhouse.', responsibility: 'MIXED', module: 'COURIERS', category: 'DELIVERED_NOT_RECEIVED', priority: 'NORMAL' },
    { key: 'CANCELLED', label: 'The delivery was cancelled', hint: 'The courier cancelled or returned it without telling me why.', responsibility: 'COURIER', module: 'COURIERS', category: 'DELIVERY_CANCELLED', priority: 'LOW' },
    notSure('COURIERS'),
  ],
  GATE: [
    { key: 'COURIER_DENIED', label: 'A courier was turned away at the gate', hint: 'My delivery could not get into the township.', responsibility: 'TOWNSHIP', module: 'GUARDHOUSE', category: 'COURIER_DENIED_ENTRY', priority: 'NORMAL' },
    { key: 'VISITOR_REFUSED', label: 'My visitor was refused', hint: 'They had a pass, but the guardhouse did not let them in.', responsibility: 'TOWNSHIP', module: 'GUARDHOUSE', category: 'VISITOR_ACCESS', priority: 'NORMAL' },
    { key: 'WRONG_ENTRY', label: 'Someone got in who should not have', hint: 'A person was let in without my pass or permission.', responsibility: 'TOWNSHIP', module: 'GUARDHOUSE', category: 'UNAUTHORISED_ENTRY', priority: 'HIGH' },
    { key: 'SECURITY', label: 'A safety or security concern', hint: 'Something at the gate or guardhouse that the township should know.', responsibility: 'TOWNSHIP', module: 'GUARDHOUSE', category: 'SECURITY_CONCERN', priority: 'HIGH', needsNote: true },
    notSure('GUARDHOUSE'),
  ],
  COURIER_STATION: [
    { key: 'STATION_FAULT', label: 'The locker is not working', hint: 'Doors not opening, keypad or screen broken, station offline.', responsibility: 'TOWNSHIP', module: 'LOCKERS', category: 'LOCKER_MALFUNCTION', priority: 'HIGH' },
    { key: 'DENIED_ENTRY', label: 'I was turned away at the gate', hint: 'The guardhouse did not let me in to deliver.', responsibility: 'TOWNSHIP', module: 'GUARDHOUSE', category: 'COURIER_DENIED_ENTRY', priority: 'NORMAL' },
    { key: 'OTHER', label: 'Something else', hint: 'Tell the township office what happened.', responsibility: 'UNCERTAIN', module: 'COURIERS', category: 'NEEDS_ASSISTANCE', priority: 'NORMAL', needsNote: true },
  ],
};

/** How system-raised incidents are filed: their module, and their priority when raised. */
export const SYSTEM_CATEGORIES: Record<string, { module: IncidentModule; priority?: Priority; responsibility?: 'TOWNSHIP' | 'MIXED' }> = {
  BARCODE_REPLAY: { module: 'COURIERS' }, SHIPMENT_IN_USE: { module: 'COURIERS' }, SUSPENDED_COURIER: { module: 'COURIERS' },
  UNKNOWN_SHIPMENT: { module: 'COURIERS' }, RECIPIENT_MISMATCH: { module: 'COURIERS', priority: 'LOW' }, PROVIDER_OUTAGE: { module: 'COURIERS' },
  SUSPICIOUS_LOGIN: { module: 'COURIERS' }, DOOR_FORCED: { module: 'LOCKERS', priority: 'CRITICAL' }, DOOR_LEFT_OPEN: { module: 'LOCKERS' },
  UNLOCK_FAILED: { module: 'LOCKERS' }, COMMAND_REJECTED: { module: 'LOCKERS' }, KEYPAD_LOCKED: { module: 'LOCKERS' },
  NOT_COLLECTED_BY_ME: { module: 'LOCKERS', responsibility: 'MIXED' }, PARCEL_PROBLEM: { module: 'LOCKERS' }, STAFF_REPORT: { module: 'LOCKERS' },
};

export const CATEGORY_LABELS: Record<string, string> = {
  LOCKER_WONT_OPEN: 'Locker door will not open', PARCEL_TRAPPED: 'Parcel stuck in a locker', WRONG_LOCKER: 'Wrong or empty locker',
  LOCKER_MALFUNCTION: 'Locker not working', COLLECTION_DISPUTE: 'Marked collected, not received', WRONG_HOUSEHOLD: 'Parcel given to the wrong home',
  DAMAGED_IN_TRANSIT: 'Damaged in delivery', WRONG_CONTENTS: 'Wrong or missing items', GUARD_HANDOVER: 'Guardhouse handover problem',
  DELIVERY_DELAYED: 'Delivery late', DELIVERED_NOT_RECEIVED: 'Delivered, not received', DELIVERY_CANCELLED: 'Delivery cancelled',
  COURIER_DENIED_ENTRY: 'Courier turned away at the gate', VISITOR_ACCESS: 'Visitor refused', UNAUTHORISED_ENTRY: 'Unauthorised entry',
  SECURITY_CONCERN: 'Security concern', NEEDS_ASSISTANCE: 'Needs help working out', BARCODE_REPLAY: 'Label scanned again after delivery',
  SHIPMENT_IN_USE: 'Shipment held by another courier', SUSPENDED_COURIER: 'Suspended courier tried to deliver', UNKNOWN_SHIPMENT: 'Several unknown shipments',
  RECIPIENT_MISMATCH: 'Recipient did not match', PROVIDER_OUTAGE: 'Courier company not answering', DOOR_FORCED: 'Door opened without an unlock',
  DOOR_LEFT_OPEN: 'Door left open', UNLOCK_FAILED: 'Door did not open', COMMAND_REJECTED: 'Door command refused', KEYPAD_LOCKED: 'Keypad locked',
  SUSPICIOUS_LOGIN: 'Suspicious courier sign-in', NOT_COLLECTED_BY_ME: 'Household says it did not collect', PARCEL_PROBLEM: 'Household reported a parcel problem',
  STAFF_REPORT: 'Reported by staff', RELOCATION_PROBLEM: 'Parcel relocation stopped',
};
