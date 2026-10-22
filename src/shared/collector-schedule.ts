/**
 * When a partner collector works, stored in recycling_collectors.days as one fixed,
 * readable line, so no new column is needed:
 *
 *   schedule:v1 days=MON,TUE,WED,THU,FRI time=MORNING
 *
 * Collectors added before this have free text there ("Tue and Sat mornings"). The
 * system cannot read that, so such a collector counts as available any day and time,
 * and their own words are shown as they are.
 */

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const SCHEDULE_TIMES = ['MORNING', 'AFTERNOON', 'BOTH'] as const;
export type ScheduleTime = (typeof SCHEDULE_TIMES)[number];
export interface Schedule {
  days: Weekday[];
  time: ScheduleTime;
}

export const DAY_PRESETS = { EVERY_DAY: WEEKDAYS, WEEKDAYS: WEEKDAYS.slice(0, 5), WEEKENDS: WEEKDAYS.slice(5) } as const;
export type DayPreset = keyof typeof DAY_PRESETS | 'CHOOSE';
export const DAY_PRESET_LABELS: Record<DayPreset, string> = { EVERY_DAY: 'Every day', WEEKDAYS: 'Weekdays', WEEKENDS: 'Weekends', CHOOSE: 'Choose days' };
export const WEEKDAY_LABELS: Record<Weekday, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
export const SCHEDULE_TIME_LABELS: Record<ScheduleTime, string> = { MORNING: 'Morning', AFTERNOON: 'Afternoon', BOTH: 'Both' };

const PREFIX = 'schedule:v1';

/** The stored line, with the days always in week order. */
export function formatSchedule(s: Schedule): string {
  const days = WEEKDAYS.filter((d) => s.days.includes(d));
  return `${PREFIX} days=${days.join(',')} time=${s.time}`;
}

/** The schedule, or null when the text is an older free-text description. */
export function parseSchedule(text: string): Schedule | null {
  const m = /^schedule:v1 days=([A-Z,]+) time=([A-Z]+)$/.exec(text.trim());
  if (!m) return null;
  const days = m[1]!.split(',').filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
  const time = m[2] as ScheduleTime;
  if (days.length === 0 || !(SCHEDULE_TIMES as readonly string[]).includes(time)) return null;
  return { days, time };
}

/** Monday to Sunday for a calendar day written YYYY-MM-DD, whatever the computer's own timezone. */
export function weekdayOf(day: string): Weekday {
  return WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

/** How far ahead a household can book a collection: from tomorrow up to this many days from today. */
export const BOOK_AHEAD_DAYS = 30;

/** One day and half-day a collector can come: "2026-10-27", "MORNING". */
export interface OpenSlot {
  day: string;
  slot: 'MORNING' | 'AFTERNOON';
}

/**
 * Every day and time a collector comes, for `count` days starting at `from` (YYYY-MM-DD), in order,
 * so the booking form can offer only those. Null for an older free-text schedule, which the system
 * cannot read: the form then asks for any day and time, as `worksOn` allows.
 */
export function openSlots(stored: string, from: string, count: number): OpenSlot[] | null {
  const s = parseSchedule(stored);
  if (!s) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const out: OpenSlot[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    if (!s.days.includes(weekdayOf(day))) continue;
    for (const slot of ['MORNING', 'AFTERNOON'] as const) if (s.time === 'BOTH' || s.time === slot) out.push({ day, slot });
  }
  return out;
}

/** Whether a collector with this stored text works on that day and slot. Unreadable text: yes. */
export function worksOn(stored: string, day: string, slot: 'MORNING' | 'AFTERNOON'): boolean {
  const s = parseSchedule(stored);
  if (!s) return true;
  return s.days.includes(weekdayOf(day)) && (s.time === 'BOTH' || s.time === slot);
}

/** The preset a set of days matches, for the form and for plain words. */
export function presetOf(days: readonly Weekday[]): DayPreset {
  const same = (a: readonly Weekday[]) => a.length === days.length && a.every((d) => days.includes(d));
  return same(DAY_PRESETS.EVERY_DAY) ? 'EVERY_DAY' : same(DAY_PRESETS.WEEKDAYS) ? 'WEEKDAYS' : same(DAY_PRESETS.WEEKENDS) ? 'WEEKENDS' : 'CHOOSE';
}

/**
 * The schedule in plain words, as separate pieces so each can be translated:
 * "Weekdays" + "Morning", or "Mon", "Wed" + "Both". An older free-text one is
 * returned as it was written.
 */
export function describeSchedule(stored: string): { legacy: string } | { days: string[]; time: string } {
  const s = parseSchedule(stored);
  if (!s) return { legacy: stored };
  const preset = presetOf(s.days);
  return { days: preset === 'CHOOSE' ? s.days.map((d) => WEEKDAY_LABELS[d]) : [DAY_PRESET_LABELS[preset]], time: SCHEDULE_TIME_LABELS[s.time] };
}
