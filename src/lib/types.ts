import type { Role, WarningSource } from '@/shared/domain';
import type { FloodTrendView } from '@/components/features/flood-trend';

/** Shapes the screens receive from the API. Kept small: only what is displayed. */

/** Required details the person has not given yet (see identity/service.ts → profile). */
export type MissingDetail = 'phone' | 'address' | 'shopAddress' | 'terms';

export interface Me {
  id: string;
  role: Role;
  email: string;
  fullName: string;
  phone: string | null;
  language: 'en' | 'ms';
  /** Residents only: whether parcel emails are on, and the address they go to. */
  emails?: { parcels: boolean; address: string | null } | null;
  residencyStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  memberCode: string | null;
  townshipId: string | null;
  township: string | null;
  occupancy: 'OWNER' | 'TENANT' | null;
  /** Residents only: their home's postal address. */
  home: {
    propertyType: 'LANDED' | 'HIGHRISE';
    houseNo: string | null;
    building: string | null;
    street: string;
    precinct: string | null;
    postcode: string | null;
    city: string | null;
    state: string | null;
    address: string;
  } | null;
  /** Shops only: the business address. */
  shop: { addressLine: string | null; postcode: string | null; city: string | null; state: string | null } | null;
  terms: { version: string | null; acceptedAt: string | null; current: string };
  missing: MissingDetail[];
}

export interface ActionRewardView {
  xp: number;
  points: number;
  /** Offer-backed points, backed by what township shops pledged this month. */
  offerPoints?: number;
  fundedBy: string[];
}

export interface SaleView {
  id: string;
  merchantName: string;
  memberName: string;
  billSen: number;
  redeemPoints: number;
  offerPoints: number;
  offerTitle: string | null;
  successFeeSen: number;
  cashSen: number;
  pointsEarned: number;
  feeSen: number;
  earnNote: 'POOL_EMPTY' | 'LIMIT_REACHED' | null;
  status: 'PENDING' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'REFUNDED';
  expiresAt: string | null;
  refundShortfallSen: number | null;
  createdAt: string;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  activity: string;
  goal_metric: 'COUNT' | 'QUANTITY';
  goal_target: number;
  quantity_unit: string | null;
  reward_points: number;
  per_person_cap: number;
  budget_sen: number;
  pool_bps: number;
  fee_bps: number;
  costs_bps: number;
  starts_at: string;
  ends_at: string;
  status: 'DRAFT' | 'FUNDED' | 'CLOSED';
  refunded_sen: number | null;
  sponsor_id: string | null;
  funder: string;
  live: boolean;
  pool_left_sen: number;
  /** False for a campaign cancelled before its payment was recorded (closed, nothing ever given). */
  funded?: boolean;
  /** Staff views only. */
  rewards_given?: number;
  /** Staff views only: the sponsor's tier today, and whether this campaign is beyond what it includes this year. */
  sponsor_tier?: string;
  extra?: boolean;
  my_progress?: number;
  my_rewards?: number;
}

export interface Zone {
  id: string;
  name: string;
  level_pct: number;
  status: 'NORMAL' | 'WARNING' | 'DANGER';
  safe_route: string;
  assembly_point: string;
  updated_at: string;
}

export interface BanjirOverview {
  zones: (Zone & {
    message_kind: string | null;
    what: string | null;
    where_text: string | null;
    todo: string | null;
    next_update_at: string | null;
    sent_at: string | null;
    /** A warning raised on one signal, still waiting for a second check: shown amber, not red. */
    unconfirmed: boolean;
    /** The last reading from a healthy sensor, or a level the duty officer set. */
    verified_at: string | null;
    verified_by: 'SENSOR' | 'MANUAL' | null;
    sensors_ok: number | null;
    /** What backed the latest warning (Appendix E.1); null while the zone is normal. */
    sources: WarningSource[] | null;
    /** A sensor is climbing faster than its rate-of-rise line: the early warning. */
    rising_fast: boolean;
    /** Where the water is heading from the recent trend: an estimate, never an alert. */
    trend: FloodTrendView | null;
  })[];
  myZoneId: string | null;
  myCheckin: 'SAFE' | 'NEED_HELP' | null;
  warningPct: number;
  dangerPct: number;
}
