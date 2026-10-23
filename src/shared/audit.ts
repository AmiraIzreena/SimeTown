/**
 * Audit trail filters, shared by the console page and the API. Every entry falls in
 * exactly one area: rules first, then money, then by the kind of thing it changed.
 * Anything not listed (an older or archived feature) still shows under "All".
 */
export const AUDIT_AREAS = ['MONEY', 'PEOPLE', 'PARCELS', 'REPORTS', 'PLACES', 'RULES'] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  MONEY: 'Money & campaigns',
  PEOPLE: 'People & shops',
  PARCELS: 'Parcels & couriers',
  REPORTS: 'Reports & safety',
  PLACES: 'Places & recycling',
  RULES: 'Rules & settings',
};

/** Rule and setting changes, whatever they apply to. */
export const RULE_ACTIONS = [
  'SETTINGS_CHANGED', 'ACCESS_RULE_SAVED', 'ACCESS_RULE_DELETED', 'ACCESS_POLICY_CHANGED', 'INCIDENT_POLICY_SAVED', 'LOCKER_POLICY_SAVED',
] as const;
export const RULE_ENTITIES = ['program_settings', 'access_policy', 'access_routing_rule', 'incident_policy', 'collection_policy', 'locker_policy'] as const;

/** Money moving or being checked, whatever it belongs to (a shop deposit is money, not a shop change). */
export const MONEY_ACTIONS = [
  'DEPOSIT_RECORDED', 'SETTLEMENT_PAID', 'FLOAT_CHECK_FAILED', 'ADJUSTMENT_REQUESTED', 'ADJUSTMENT_APPROVED', 'ADJUSTMENT_REJECTED', 'SALE_REFUNDED',
] as const;

export const AREA_ENTITIES: Record<Exclude<AuditArea, 'RULES'>, readonly string[]> = {
  MONEY: ['campaign', 'sponsor', 'community_pool', 'float', 'adjustment', 'sale'],
  PEOPLE: ['user', 'account_request', 'merchant', 'shop_offer'],
  PARCELS: [
    'parcel', 'locker_parcel', 'locker_station', 'locker_compartment', 'locker_exception', 'locker_access_session',
    'courier_company', 'courier_account', 'overflow_location', 'relocation_task', 'incident',
  ],
  REPORTS: ['report', 'post', 'service_report', 'assistant_handoff', 'guard_sos', 'flood_zone', 'flood_sensor', 'wildlife_sighting'],
  PLACES: [
    'access_place', 'access_party', 'access_incident', 'kitar_kiosk', 'kitar_machine', 'kitar_dropoff', 'recycling_collection',
    'recycling_collector', 'gerak_loop', 'garden', 'parking_area', 'solar_site', 'edging_trial_test',
  ],
};

/** Who made the change. SYSTEM is the app itself (scheduled jobs, automatic decisions). */
export const AUDIT_ACTORS = ['HQ_ADMIN', 'TOWNSHIP_ADMIN', 'TOWNSHIP_STAFF', 'GUARD', 'GUARDHOUSE', 'MERCHANT', 'COURIER', 'RESIDENT', 'SYSTEM'] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];

export const AUDIT_PERIODS = ['24h', '7d', '30d', '90d'] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];
export const AUDIT_PERIOD_LABELS: Record<AuditPeriod, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };
export const AUDIT_PERIOD_HOURS: Record<AuditPeriod, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };

export interface AuditFilter {
  q?: string;
  area?: AuditArea;
  actor?: AuditActor;
  period?: AuditPeriod;
  sort?: 'NEWEST' | 'OLDEST';
}
