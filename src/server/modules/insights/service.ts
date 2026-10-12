import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { floatPosition } from '../ledger/finance';
import { pledgeSummary } from '../offers/service';
import { getSettings } from '../settings';

/**
 * SimeTown Insights: what the township achieved in the last 30 days. Totals for
 * groups only, never one person's activity (BR16).
 */
export async function insightsOverview(db: Db, actor: Actor, now: Date) {
  const t = actor.townshipId; // NULL = every township (HQ)
  const tz = (await getSettings(db)).timezone;
  const since = `$2::timestamptz - interval '30 days'`;
  const [people, planet, reports, community, shops, points, byActivity, byCategory, byZone, daily, float] = await Promise.all([
    one(
      db,
      `SELECT (SELECT count(*)::int FROM homes WHERE ($1::uuid IS NULL OR township_id = $1)) AS homes,
              (SELECT count(*)::int FROM users WHERE role = 'RESIDENT' AND residency_status = 'VERIFIED' AND status = 'ACTIVE' AND ($1::uuid IS NULL OR township_id = $1)) AS residents,
              (SELECT count(*)::int FROM users WHERE role = 'RESIDENT' AND residency_status = 'PENDING' AND status = 'ACTIVE' AND ($1::uuid IS NULL OR township_id = $1)) AS waiting,
              (SELECT count(DISTINCT u.home_id)::int FROM users u
                WHERE ($1::uuid IS NULL OR u.township_id = $1)
                  AND (EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = u.id AND e.created_at >= ${since})
                    OR EXISTS (SELECT 1 FROM sales s WHERE s.user_id = u.id AND s.created_at >= ${since}))) AS active_homes`,
      [t, now],
    ),
    one(
      db,
      `SELECT (SELECT coalesce(sum(d.weight_g), 0)::int FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
                WHERE ($1::uuid IS NULL OR k.township_id = $1) AND d.created_at >= ${since}) AS recycled_g,
              (SELECT count(*)::int FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
                WHERE ($1::uuid IS NULL OR k.township_id = $1) AND d.created_at >= ${since}) AS drop_offs,
              (SELECT coalesce(sum(e.quantity), 0)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE e.activity = 'GERAK_LOOP' AND ($1::uuid IS NULL OR u.township_id = $1) AND e.created_at >= ${since}) AS moved_m,
              (SELECT count(*)::int FROM jimat_readings r JOIN homes h ON h.id = r.home_id
                WHERE ($1::uuid IS NULL OR h.township_id = $1) AND r.created_at >= ${since}) AS readings,
              (SELECT count(*)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE e.activity = 'JIMAT_SAVER' AND ($1::uuid IS NULL OR u.township_id = $1) AND e.created_at >= ${since}) AS saver_homes`,
      [t, now],
    ),
    one(
      db,
      `SELECT count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS'))::int AS open,
              count(*) FILTER (WHERE status = 'NEW' AND urgency = 'URGENT')::int AS urgent_new,
              count(*) FILTER (WHERE created_at >= ${since})::int AS received,
              count(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at >= ${since})::int AS resolved,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 3600)
                     FILTER (WHERE status = 'RESOLVED' AND resolved_at >= ${since}))::numeric, 1)::float8 AS median_hours
         FROM reports WHERE ($1::uuid IS NULL OR township_id = $1)`,
      [t, now],
    ),
    one(
      db,
      `SELECT (SELECT count(*)::int FROM posts WHERE type = 'EVENT' AND ($1::uuid IS NULL OR township_id = $1) AND created_at >= ${since}) AS events,
              (SELECT count(*)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE e.activity = 'JIRAN_EVENT' AND ($1::uuid IS NULL OR u.township_id = $1) AND e.created_at >= ${since}) AS attendances,
              (SELECT count(*)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE e.activity = 'JIRAN_HELP' AND ($1::uuid IS NULL OR u.township_id = $1) AND e.created_at >= ${since}) AS favours,
              (SELECT count(*)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE e.activity = 'KONGSI_SHARE' AND ($1::uuid IS NULL OR u.township_id = $1) AND e.created_at >= ${since}) AS items_shared`,
      [t, now],
    ),
    one(
      db,
      `SELECT (SELECT count(*)::int FROM merchants WHERE status = 'ACTIVE' AND ($1::uuid IS NULL OR township_id = $1)) AS active_shops,
              count(*)::int AS sales, coalesce(sum(s.bill_sen), 0)::bigint AS bill_sen,
              coalesce(sum(s.points_earned), 0)::int AS points_given, coalesce(sum(s.redeem_points), 0)::int AS points_accepted,
              coalesce(sum(s.fee_sen), 0)::int AS fees_sen
         FROM sales s JOIN merchants m ON m.id = s.merchant_id
        WHERE s.status = 'COMPLETED' AND ($1::uuid IS NULL OR m.township_id = $1) AND s.completed_at >= ${since}`,
      [t, now],
    ),
    one(
      db,
      `SELECT coalesce(sum(l.amount) FILTER (WHERE l.source = 'PURCHASE'), 0)::int AS from_shops,
              coalesce(sum(l.amount) FILTER (WHERE l.source = 'CAMPAIGN'), 0)::int AS from_campaigns
         FROM point_lots l JOIN users u ON u.id = l.user_id
        WHERE ($1::uuid IS NULL OR u.township_id = $1) AND l.earned_at >= ${since}`,
      [t, now],
    ),
    db.query(
      `SELECT r.label, count(e.id)::int AS actions
         FROM activity_rules r
         LEFT JOIN (xp_events e JOIN users u ON u.id = e.user_id AND ($1::uuid IS NULL OR u.township_id = $1))
                ON e.activity = r.activity AND e.created_at >= ${since}
        GROUP BY r.activity, r.label ORDER BY actions DESC, r.label`,
      [t, now],
    ),
    db.query(
      `SELECT category, count(*)::int AS open FROM reports
        WHERE status IN ('NEW', 'IN_PROGRESS') AND ($1::uuid IS NULL OR township_id = $1) GROUP BY category ORDER BY open DESC`,
      [t],
    ),
    // The "heatmap": where open problems cluster.
    db.query(
      `SELECT z.name AS zone, count(r.id)::int AS open
         FROM flood_zones z LEFT JOIN reports r ON r.zone_id = z.id AND r.status IN ('NEW', 'IN_PROGRESS')
        WHERE ($1::uuid IS NULL OR z.township_id = $1) GROUP BY z.id, z.name ORDER BY open DESC, z.name`,
      [t],
    ),
    db.query(
      `SELECT d.day::text AS day,
              (SELECT count(*)::int FROM xp_events e JOIN users u ON u.id = e.user_id
                WHERE ($1::uuid IS NULL OR u.township_id = $1) AND (e.created_at AT TIME ZONE $3)::date = d.day) AS actions,
              (SELECT count(*)::int FROM sales s JOIN merchants m ON m.id = s.merchant_id
                WHERE s.status = 'COMPLETED' AND ($1::uuid IS NULL OR m.township_id = $1) AND (s.completed_at AT TIME ZONE $3)::date = d.day) AS sales
         FROM (SELECT generate_series(($2::timestamptz AT TIME ZONE $3)::date - 13, ($2::timestamptz AT TIME ZONE $3)::date, interval '1 day')::date AS day) d
        ORDER BY d.day`,
      [t, now, tz],
    ),
    floatPosition(db),
  ]);
  const [smart, offers] = await Promise.all([
    one(
      db,
      `SELECT (SELECT count(*)::int FROM kitar_machines WHERE ($1::uuid IS NULL OR township_id = $1)) AS machines,
              (SELECT count(*)::int FROM kitar_machines WHERE status = 'ONLINE' AND ($1::uuid IS NULL OR township_id = $1)) AS machines_online,
              (SELECT coalesce(sum(s.accepted_g), 0)::int FROM kitar_sessions s JOIN kitar_machines m ON m.id = s.machine_id
                WHERE s.status = 'DONE' AND ($1::uuid IS NULL OR m.township_id = $1) AND s.closed_at >= ${since}) AS machine_g,
              (SELECT count(*)::int FROM kitar_sessions s JOIN kitar_machines m ON m.id = s.machine_id
                WHERE s.status = 'DONE' AND s.mode = 'GUEST' AND ($1::uuid IS NULL OR m.township_id = $1) AND s.closed_at >= ${since}) AS guest_sessions,
              (SELECT coalesce(sum(a.valid_m), 0)::int FROM gerak_activities a WHERE a.status = 'FINISHED' AND ($1::uuid IS NULL OR a.township_id = $1) AND a.finished_at >= ${since}) AS tracked_m,
              (SELECT count(*)::int FROM jimat_bills b JOIN homes h ON h.id = b.home_id WHERE b.status = 'CONFIRMED' AND ($1::uuid IS NULL OR h.township_id = $1) AND b.confirmed_at >= ${since}) AS bills_read,
              (SELECT count(*)::int FROM visitor_entries e WHERE ($1::uuid IS NULL OR e.township_id = $1) AND e.entered_at >= ${since}) AS visits,
              (SELECT count(*)::int FROM flood_messages f JOIN flood_zones z ON z.id = f.zone_id
                WHERE f.status = 'SENT' AND f.kind = 'ALERT' AND ($1::uuid IS NULL OR z.township_id = $1) AND f.sent_at >= ${since}) AS flood_alerts,
              (SELECT count(*)::int FROM reports r WHERE r.category = 'ACCESS_BARRIER' AND ($1::uuid IS NULL OR r.township_id = $1) AND r.created_at >= ${since}) AS barriers_reported,
              (SELECT count(*)::int FROM reports r WHERE r.category = 'ACCESS_BARRIER' AND r.status = 'RESOLVED' AND r.resolved_at - r.created_at <= interval '7 days'
                AND ($1::uuid IS NULL OR r.township_id = $1) AND r.created_at >= ${since}) AS barriers_fixed_on_time,
              (SELECT count(*)::int FROM wildlife_sightings w WHERE w.status = 'CONFIRMED' AND ($1::uuid IS NULL OR w.township_id = $1) AND w.created_at >= ${since}) AS sightings,
              (SELECT count(*)::int FROM garden_plots p JOIN gardens g ON g.id = p.garden_id WHERE p.holder_home_id IS NOT NULL AND p.booked_until >= current_date AND ($1::uuid IS NULL OR g.township_id = $1)) AS plots_booked`,
      [t, now],
    ),
    pledgeSummary(db, t, now, tz),
  ]);
  return { people, planet, reports, community, shops, points, byActivity, byCategory, byZone, daily, float, smart, offers };
}
