import type { Queryable } from '../../db/client';
import type { Settings } from '../settings';

/**
 * An early-warning ESTIMATE: where the water is heading, from the zone's last 30 minutes of readings.
 * It fits a straight line through the readings (least squares) and, if the water is climbing, says how
 * long until it reaches the next line at that rate. It is plain trend arithmetic, not machine learning,
 * and it is advisory only: it never raises, holds or clears an alert (BR28 decides those).
 *
 * The forecast slot for a trained model later (for example an LSTM or gradient-boosted model on months of
 * sensor and rainfall history): it would return the same shape with `method` set to the model's name.
 */

export type TrendMethod = 'LINEAR_TREND';

export interface Trend {
  direction: 'RISING' | 'STEADY' | 'FALLING';
  /** Change in percentage points an hour, from the fitted line. */
  ratePctPerHour: number;
  /** The next line the water would reach while rising, and in how many minutes at this rate. */
  nextLine: 'WARNING' | 'DANGER' | null;
  minutes: number | null;
  readings: number;
  method: TrendMethod;
}

const WINDOW_MS = 30 * 60_000;
const MIN_READINGS = 4;
const MIN_SPAN_MS = 10 * 60_000;
/** Below this the line is too flat to call rising or falling (percentage points an hour). */
const STEADY_PCT_PER_HOUR = 3;
/** An estimate further out than this is too uncertain to show. */
const MAX_MINUTES = 180;

/** Least-squares slope (per millisecond) and the fitted level at the newest reading. */
export function fitLine(points: { t: number; pct: number }[]): { slopePerMs: number; fittedNow: number } {
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanP = points.reduce((s, p) => s + p.pct, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.pct - meanP);
    den += (p.t - meanT) ** 2;
  }
  const slopePerMs = den === 0 ? 0 : num / den;
  const lastT = Math.max(...points.map((p) => p.t));
  return { slopePerMs, fittedNow: meanP + slopePerMs * (lastT - meanT) };
}

/** The estimate for one zone, or null when there are too few recent readings to say anything. */
export async function trendEstimate(q: Queryable, zoneId: string, now: Date, s: Pick<Settings, 'flood_warning_pct' | 'flood_danger_pct'>): Promise<Trend | null> {
  const rows = await q.query<{ level_pct: number; created_at: Date }>(
    `SELECT level_pct, created_at FROM flood_readings
      WHERE zone_id = $1 AND created_at <= $2 AND created_at > $2::timestamptz - make_interval(secs => $3::double precision)
      ORDER BY created_at`,
    [zoneId, now, WINDOW_MS / 1000],
  );
  if (rows.length < MIN_READINGS) return null;
  const points = rows.map((r) => ({ t: new Date(r.created_at).getTime(), pct: r.level_pct }));
  if (points[points.length - 1]!.t - points[0]!.t < MIN_SPAN_MS) return null;

  const { slopePerMs, fittedNow } = fitLine(points);
  const ratePctPerHour = Math.round(slopePerMs * 3_600_000 * 10) / 10;
  const direction = ratePctPerHour >= STEADY_PCT_PER_HOUR ? 'RISING' : ratePctPerHour <= -STEADY_PCT_PER_HOUR ? 'FALLING' : 'STEADY';
  const level = Math.max(0, Math.min(100, fittedNow));
  const nextLine = direction !== 'RISING' ? null : level < s.flood_warning_pct ? 'WARNING' : level < s.flood_danger_pct ? 'DANGER' : null;
  let minutes: number | null = null;
  if (nextLine) {
    const target = nextLine === 'WARNING' ? s.flood_warning_pct : s.flood_danger_pct;
    const m = Math.round((target - level) / (ratePctPerHour / 60));
    minutes = m <= MAX_MINUTES ? Math.max(1, m) : null;
  }
  return { direction, ratePctPerHour, nextLine: minutes === null ? null : nextLine, minutes, readings: rows.length, method: 'LINEAR_TREND' };
}
