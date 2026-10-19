import type { FloodFaultReason, FloodSensorHealth, FloodSensorKind, FloodSensorSite, FloodSource, FloodStatus } from '@/shared/domain';

/** The shapes the Flood dashboard reads from /admin/banjir/*. */

export interface Reading {
  source: FloodSource;
  level: FloodStatus;
  levelPct: number | null;
  confidence: number | null;
  trusted: boolean;
  at: string;
  note: string;
}

export interface SensorView {
  id: string | null;
  code: string | null;
  levelPct: number;
  level: FloodStatus;
  faulty: boolean;
  pending: boolean;
  riseCm: number | null;
  risingFast: boolean;
  at: string;
}

export interface ZoneSensor {
  id: string;
  code: string;
  site: FloodSensorSite;
  health: FloodSensorHealth;
  health_reason: FloodFaultReason | null;
  last_seen_at: string | null;
  last_level_pct: number | null;
  last_battery: number | null;
  simulated: boolean;
  sim_paused: boolean;
}

export interface AgentZone {
  id: string;
  name: string;
  status: FloodStatus;
  level_pct: number;
  updated_at: string;
  assessment: {
    readings: Reading[];
    agreed: FloodStatus;
    single: FloodStatus;
    safeAgreed: boolean;
    rising: boolean;
    risingFast: boolean;
    levelPct: number | null;
    sensors: SensorView[];
    lastVerifiedAt: string | null;
  };
  draft: { id: string; level: FloodStatus; what: string; where_text: string; todo: string; deadline_at: string; created_at: string } | null;
  timeline: { id: number; at: string; step: string; detail: Record<string, unknown> }[];
  messages: { id: string; level: FloodStatus; kind: string; what: string; todo: string; decision: string; sent_at: string; next_update_at: string | null }[];
  checkins: null | {
    safe: number;
    need_help: number;
    homes: number;
    needHelp: { full_name: string; phone: string | null; house_no: string | null; building: string | null; street: string }[];
    priority: { full_name: string; phone: string | null; house_no: string | null; building: string | null; street: string; priority_note: string | null; checked_in: string | null }[];
  };
  sensors: ZoneSensor[];
  event: { id: string; started_at: string; peak_status: FloodStatus; sms: number } | null;
}

export interface Agent {
  zones: AgentZone[];
  warningPct: number;
  dangerPct: number;
}

export interface SensorRow {
  id: string;
  zone_id: string;
  zone_name: string;
  code: string;
  kind: FloodSensorKind;
  site: FloodSensorSite;
  location_note: string | null;
  base_cm: number;
  overflow_cm: number;
  calibrated_at: string | null;
  rise_cm_10min: number;
  low_battery_pct: number;
  health: FloodSensorHealth;
  health_reason: FloodFaultReason | null;
  last_seen_at: string | null;
  last_level_cm: number | null;
  last_level_pct: number | null;
  last_battery: number | null;
  last_rssi: number | null;
  simulated: boolean;
  sim_paused: boolean;
  sim_stuck: boolean;
  sim_battery: number | null;
  ticket: { reason: FloodFaultReason; at: string } | null;
  uptime_pct: number | null;
  log: { id: number; kind: string; reason: FloodFaultReason | null; note: string | null; ticket_open: boolean; at: string; resolved_at: string | null; actor_name: string | null }[];
}

export interface HelpBoard {
  events: {
    id: string;
    zone_id: string;
    zone_name: string;
    started_at: string;
    peak_status: FloodStatus;
    people: {
      user_id: string;
      full_name: string;
      phone: string | null;
      priority_note: string | null;
      priority: boolean;
      checked_in: 'SAFE' | 'NEED_HELP' | null;
      address: string;
      task: { id: string; status: 'ASSIGNED' | 'REACHED'; assignee: string; assigned_to: string; created_at: string; reached_at: string | null; note: string | null } | null;
    }[];
  }[];
  responders: { id: string; full_name: string; role: 'GUARD' | 'TOWNSHIP_STAFF' }[];
}

export interface EventRow {
  id: string;
  zone_id: string;
  zone_name: string;
  started_at: string;
  ended_at: string | null;
  peak_status: FloodStatus;
  peak_level_pct: number | null;
  people_warned: number;
  false_alarm: boolean | null;
  reviewed_at: string | null;
  first_warning_at: string | null;
  first_danger_at: string | null;
}

export interface EventReport {
  event: EventRow & { review_note: string | null; reviewer: string | null };
  durationMin: number | null;
  warningLeadMin: number | null;
  timeline: { id: number; at: string; step: string; detail: Record<string, unknown>; actor_name: string | null }[];
  messages: { id: string; level: FloodStatus; kind: string; what: string; todo: string; decision: string; sent_at: string; decided_by_name: string | null }[];
  checkins: { residents: number; safe: number; need_help: number; within_30: number; ratePct: number | null; within30Pct: number | null };
  help: { tasks: number; reached: number; avg_reach_min: number | null };
  smsSimulated: number;
  signals: { source: FloodSource; n: number; max_pct: number | null }[];
}

/** Plain words for each step the agent logs, and each way a message was decided. */
export const STEP_WORDS: Record<string, string> = {
  ASSESSED: 'Signals checked',
  DRAFTED: 'Draft waiting for the officer',
  DRAFT_DROPPED: 'Draft dropped',
  ALERT_SENT: 'Alert sent',
  ALL_CLEAR_SENT: 'All clear sent',
  OFFICER_CONFIRMED: 'Officer confirmed',
  OFFICER_CANCELLED: 'Officer cancelled',
  ESCALATED: 'Sent: no answer, water still rising',
  UNANSWERED: 'Unanswered: admins told',
  UPDATE_SENT: '15-minute update sent',
  SMS_QUEUED: 'SMS recorded (simulated)',
};
export const DECISION_WORDS: Record<string, string> = { TWO_SIGNALS: 'two signals agreed', ONE_SIGNAL: 'confirmed by the officer', ESCALATED: 'sent after 3 minutes', OFFICER: 'set by the officer', SCHEDULED: 'scheduled update' };
