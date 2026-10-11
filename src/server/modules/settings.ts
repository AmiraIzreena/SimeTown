import { one, type Queryable } from '../db/client';

/** The programme's adjustable rules. One row, edited by an SDP HQ admin. */
export interface Settings {
  points_per_ringgit: number;
  issuance_fee_bps: number;
  min_redeem_points: number;
  redeem_step_points: number;
  max_redeem_bps: number;
  points_daily_person: number;
  points_monthly_person: number;
  points_monthly_home: number;
  expiry_inactive_months: number;
  expiry_max_months: number;
  redeem_confirm_minutes: number;
  flood_warning_pct: number;
  flood_danger_pct: number;
  flag_hide_threshold: number;
  min_group_size: number;
  timezone: string;
  issuance_paused: boolean;
  offer_points_monthly_home: number;
  offer_success_fee_bps: number;
}

export const SETTINGS_COLUMNS = [
  'points_per_ringgit',
  'issuance_fee_bps',
  'min_redeem_points',
  'redeem_step_points',
  'max_redeem_bps',
  'points_daily_person',
  'points_monthly_person',
  'points_monthly_home',
  'expiry_inactive_months',
  'expiry_max_months',
  'redeem_confirm_minutes',
  'flood_warning_pct',
  'flood_danger_pct',
  'flag_hide_threshold',
  'min_group_size',
  'timezone',
  'issuance_paused',
  'offer_points_monthly_home',
  'offer_success_fee_bps',
] as const satisfies readonly (keyof Settings)[];

export async function getSettings(q: Queryable): Promise<Settings> {
  return (await one<Settings>(q, `SELECT ${SETTINGS_COLUMNS.join(', ')} FROM program_settings`))!;
}

/** SQL for "start of the current day / month in the township's timezone", given ($now, $tz) placeholders. */
export const startOf = (unit: 'day' | 'month', now: string, tz: string) =>
  `(date_trunc('${unit}', ${now}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
