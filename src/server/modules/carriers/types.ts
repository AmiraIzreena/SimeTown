import type { LockerSize } from '@/shared/lockers';

/**
 * The courier integration layer's own vocabulary. Every courier company's
 * system, real or simulated, is translated into these shapes by its adapter,
 * so the delivery flow never contains company-specific logic.
 */

/** Where a shipment stands in the courier company's own system. */
export type ProviderShipmentStatus = 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'ON_HOLD' | 'CANCELLED' | 'RETURNED';

/** A shipment as the provider describes it. Only what the provider chooses to share. */
export interface ProviderShipment {
  trackingNo: string;
  providerRef: string;
  status: ProviderShipmentStatus;
  lockerEligible: boolean;
  recipient: {
    name: string;
    phone: string | null;
    addressLine: string;
    postcode: string | null;
    /** The resident's SimeTown delivery code, when the shop or provider has it. */
    simetownCode: string | null;
  };
  parcel: { weightG: number | null; dimensionsMm: [number, number, number] | null };
  /** Which of the company's couriers carries it, if the provider tracks that; undefined when it cannot say. */
  assignedCourierRef?: string | null;
}

export type LookupResult =
  | { ok: true; shipment: ProviderShipment | null; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

export interface CompanyRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  auth_method: 'MANUAL' | 'COMPANY_MANAGED' | 'FEDERATED';
  provider_mode: 'NONE' | 'SIMULATED' | 'GATEWAY';
  provider_url: string | null;
  provider_secret_env: string | null;
  can_confirm_assignment: boolean;
  tracking_pattern: string | null;
  idp_mode: 'SIMULATED' | 'OIDC' | null;
  idp_issuer: string | null;
  idp_client_id: string | null;
  idp_client_secret_env: string | null;
  webhook_secret_env: string | null;
  require_mfa: boolean;
  sim_outage: boolean;
}

/** The verification outcomes the courier sees, in one fixed list. */
export const VERIFICATION_STATES = [
  'VERIFIED', 'NOT_FOUND', 'UNVERIFIED', 'PROVIDER_UNAVAILABLE', 'RECIPIENT_MISMATCH', 'NOT_ELIGIBLE', 'ALREADY_DEPOSITED',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export type Assurance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MatchResult {
  matched: boolean;
  method: 'MEMBER_CODE' | 'PHONE_NAME_ADDRESS' | 'ADDRESS_NAME' | 'DELIVERY_CODE' | 'LABEL_ADDRESS_NAME' | null;
  homeId: string | null;
  recipientUserId: string | null;
  /** Which details agreed, never the details themselves. */
  evidence: string[];
  /** Why no match was made, in a word the courier and staff can act on. */
  reason: 'NOT_REGISTERED' | 'NAME_MISMATCH' | 'AMBIGUOUS' | 'OUTSIDE_TOWNSHIP' | null;
  /** What the courier may see: masked, enough to check the label. */
  masked: { name: string; address: string } | null;
}

export interface SizeHint {
  size: LockerSize | null;
  fromProvider: boolean;
}
