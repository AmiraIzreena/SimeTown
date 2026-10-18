import type { Priority } from '@/shared/incidents';
import { one, type Queryable } from '../../db/client';

/**
 * How quickly each priority must be picked up and resolved. The starting
 * values are the prototype's proposals, not Sime Darby Property's agreed
 * service levels; each township can change them. "Working" targets count only
 * working hours on working days, skipping the township's holidays.
 */

export interface Target {
  /** Minutes until someone must have taken the case. */
  assign: number;
  /** Minutes until it must be resolved. */
  resolve: number;
  /** Count only working time. */
  working: boolean;
}

export interface IncidentPolicy {
  targets: Record<Priority, Target>;
  workday_start: number;
  workday_end: number;
  workdays: number[];
  holidays: string[];
  dispute_days: number;
}

export const DEFAULT_INCIDENT_POLICY: IncidentPolicy = {
  targets: {
    CRITICAL: { assign: 15, resolve: 4 * 60, working: false },
    HIGH: { assign: 60, resolve: 24 * 60, working: false },
    NORMAL: { assign: 4 * 60, resolve: 2 * 9 * 60, working: true },
    LOW: { assign: 9 * 60, resolve: 3 * 9 * 60, working: true },
  },
  workday_start: 9,
  workday_end: 18,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  dispute_days: 7,
};

export async function getIncidentPolicy(q: Queryable, townshipId: string): Promise<IncidentPolicy> {
  const row = await one<Omit<IncidentPolicy, 'holidays'> & { holidays: (string | Date)[] }>(
    q, 'SELECT targets, workday_start, workday_end, workdays, holidays, dispute_days FROM incident_policies WHERE township_id = $1', [townshipId],
  );
  if (!row) return DEFAULT_INCIDENT_POLICY;
  return {
    ...row,
    targets: { ...DEFAULT_INCIDENT_POLICY.targets, ...row.targets },
    holidays: row.holidays.map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d))),
  };
}

const DAY_MIN = 24 * 60;

/** The local date, ISO weekday and minute of the day, in the township's time zone. */
function local(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** A moment the given number of minutes later, counting only working time when asked to. */
export function addMinutes(start: Date, minutes: number, target: Pick<Target, 'working'>, policy: IncidentPolicy, tz: string): Date {
  if (!target.working) return new Date(start.getTime() + minutes * 60_000);
  let t = start.getTime();
  let remaining = minutes;
  const open = policy.workday_start * 60;
  const close = policy.workday_end * 60;
  for (let guard = 0; guard < 800; guard++) {
    const l = local(new Date(t), tz);
    const workday = policy.workdays.includes(l.weekday) && !policy.holidays.includes(l.date);
    if (!workday || l.minute >= close) {
      t += (DAY_MIN - l.minute) * 60_000; // to the next local midnight
      continue;
    }
    if (l.minute < open) {
      t += (open - l.minute) * 60_000;
      continue;
    }
    const available = close - l.minute;
    if (remaining <= available) return new Date(t + remaining * 60_000);
    remaining -= available;
    t += available * 60_000;
  }
  return new Date(t);
}

export function deadlinesFor(priority: Priority, policy: IncidentPolicy, tz: string, now: Date) {
  const target = policy.targets[priority];
  return { assignDue: addMinutes(now, target.assign, target, policy, tz), resolveDue: addMinutes(now, target.resolve, target, policy, tz) };
}
