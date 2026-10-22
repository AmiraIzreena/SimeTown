import type { Activity } from '@/shared/domain';

/**
 * "Distance on the township loops": the one measure behind the Gerak "Distance this month" tile,
 * the Insights distance figure and every Gerak kilometre challenge, so they always agree.
 *
 * It is the sum of
 *   - the on-loop part of each tracked trip (GERAK_ON_LOOP), finished loop or not; and
 *   - the set distance of each loop finished by scanning its posters (GERAK_LOOP), unless a tracked
 *     trip that day passed that loop's checkpoints and had its on-loop part counted: that walk is
 *     already in the first sum, so it never counts twice.
 * Distance off the loops never counts.
 *
 * This file has no imports from the database or rewards, so rewards.ts can use it without a cycle.
 */

/** The activities whose kilometre challenges count distance on the loops (COUNT goals on GERAK_LOOP still count loops). */
export const LOOP_DISTANCE_ACTIVITIES: readonly Activity[] = ['GERAK_LOOP', 'GERAK_ON_LOOP'];

/** True for a challenge measured as distance on the loops. */
export const isLoopDistanceGoal = (activity: string, metric: string) => metric === 'QUANTITY' && (LOOP_DISTANCE_ACTIVITIES as readonly string[]).includes(activity);

/**
 * SQL for the distance on the loops, in metres, as an int expression.
 * `scope` and `window` are conditions on the xp_events row aliased `e` (whose events, and when);
 * `tz` is the SQL for the township timezone, used to match a trip to the day a loop was finished.
 */
export function loopDistanceSql(scope: string, window: string, tz: string): string {
  return `((SELECT coalesce(sum(e.quantity), 0) FROM xp_events e
             WHERE e.activity = 'GERAK_ON_LOOP' AND ${scope} AND ${window})
         + (SELECT coalesce(sum(e.quantity), 0) FROM xp_events e
             WHERE e.activity = 'GERAK_LOOP' AND ${scope} AND ${window}
               AND NOT EXISTS (
                 SELECT 1 FROM gerak_activity_hits h
                   JOIN gerak_activities a ON a.id = h.activity_id
                   JOIN gerak_checkpoints cp ON cp.id = h.checkpoint_id
                  WHERE a.user_id = e.user_id AND cp.loop_id::text = split_part(e.ref, ':', 1)
                    AND (a.started_at AT TIME ZONE ${tz})::date::text = split_part(e.ref, ':', 2)
                    AND EXISTS (SELECT 1 FROM xp_events o WHERE o.user_id = a.user_id AND o.activity = 'GERAK_ON_LOOP' AND o.ref = a.id::text))))::int`;
}
