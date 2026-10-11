import type { Role } from '@/shared/domain';

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
  funder: string;
  live: boolean;
  pool_left_sen: number;
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
  zones: (Zone & { message_kind: string | null; what: string | null; where_text: string | null; todo: string | null; next_update_at: string | null; sent_at: string | null })[];
  myZoneId: string | null;
  myCheckin: 'SAFE' | 'NEED_HELP' | null;
  warningPct: number;
  dangerPct: number;
}
