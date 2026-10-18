import type { Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { resolveTownship } from '../townships';

/**
 * What the console shows about shipment checks: how scans turned out this
 * week, the latest scans (refused ones first to catch the eye), repeated
 * scans of delivered shipments, and whether each company's system is
 * answering. Recipient details are never part of it.
 */
export async function shipmentMonitor(db: Db, actor: Actor, now: Date) {
  const townshipId = await resolveTownship(db, actor);
  const [outcomes, recent, replays, providers] = await Promise.all([
    db.query<{ outcome: string; n: number }>(
      `SELECT outcome, count(*)::int AS n FROM courier_scans WHERE township_id = $1 AND at > $2::timestamptz - interval '7 days' GROUP BY outcome ORDER BY n DESC`,
      [townshipId, now],
    ),
    db.query(
      `SELECT s.id, s.tracking_no, s.outcome, s.reason, s.at, u.full_name AS courier, c.name AS company, st.name AS station, x.assurance, x.match_method,
              linked_case.reference AS case_reference, linked_case.status AS case_status
         FROM courier_scans s LEFT JOIN users u ON u.id = s.courier_user_id LEFT JOIN courier_companies c ON c.id = s.company_id
         LEFT JOIN locker_stations st ON st.id = s.station_id LEFT JOIN courier_shipments x ON x.id = s.shipment_id
         LEFT JOIN LATERAL (
           SELECT i.reference, i.status FROM incidents i
            WHERE s.shipment_id IS NOT NULL AND i.shipment_id = s.shipment_id
            ORDER BY i.updated_at DESC LIMIT 1
         ) linked_case ON true
        WHERE s.township_id = $1 ORDER BY s.at DESC LIMIT 30`,
      [townshipId],
    ),
    db.query(
      `SELECT x.tracking_no, c.name AS company, x.deposited_at, count(s.id)::int AS attempts, max(s.at) AS last_attempt
         FROM courier_scans s JOIN courier_shipments x ON x.id = s.shipment_id JOIN courier_companies c ON c.id = x.company_id
        WHERE s.township_id = $1 AND s.outcome = 'ALREADY_DEPOSITED' AND s.at > $2::timestamptz - interval '30 days'
        GROUP BY x.id, c.name ORDER BY max(s.at) DESC LIMIT 20`,
      [townshipId, now],
    ),
    db.query(
      `SELECT c.id, c.name, c.provider_mode, c.sim_outage, c.provider_checked_at, c.provider_ok, c.provider_error, c.provider_latency_ms, c.can_confirm_assignment,
              (SELECT count(*)::int FROM courier_scans s WHERE s.company_id = c.id AND s.township_id = $1 AND s.outcome = 'PROVIDER_UNAVAILABLE' AND s.at > $2::timestamptz - interval '24 hours') AS failures_24h
         FROM courier_companies c JOIN courier_company_townships t ON t.company_id = c.id AND t.township_id = $1
        WHERE c.provider_mode <> 'NONE' ORDER BY c.name`,
      [townshipId, now],
    ),
  ]);
  return { outcomes, recent, replays, providers };
}
