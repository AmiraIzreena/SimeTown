import type { FloodStatus } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { notFound } from '../../errors';
import { getSettings } from '../settings';
import { assessZone, levelOf, sendLevel, VERIFIED_COLUMNS, VERIFIED_JOIN, withSources } from './agent';
import { trendEstimate } from './trend';

/** Banjir: water levels by zone, and warnings that take priority over everything else. */

export async function banjirOverview(db: Db, actor: Actor, now: Date) {
  const s = await getSettings(db);
  const rows = await db.query<{ id: string } & Record<string, unknown>>(
    `SELECT z.id, z.name, z.level_pct, z.status, z.safe_route, z.assembly_point, z.updated_at,
            m.kind AS message_kind, m.what, m.where_text, m.todo, m.next_update_at, m.sent_at, m.level AS message_level, m.signals, ${VERIFIED_COLUMNS},
            (fa.id IS NOT NULL AND fa.confirmed_at IS NULL) AS unconfirmed
       FROM flood_zones z
       LEFT JOIN LATERAL (SELECT kind, what, where_text, todo, next_update_at, sent_at, level, signals FROM flood_messages
                           WHERE zone_id = z.id AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1) m ON true
       LEFT JOIN flood_alerts fa ON fa.zone_id = z.id AND fa.ended_at IS NULL
       ${VERIFIED_JOIN}
      WHERE ($1::uuid IS NULL OR z.township_id = $1) ORDER BY z.name`,
    [actor.townshipId],
  );
  // The early warning residents see: a sensor climbing faster than its rate-of-rise line (Appendix E.2, rule 5).
  const zones = [];
  // And an estimate of where the water is heading, from the recent trend (advisory only; see trend.ts).
  for (const z of rows) zones.push({ ...withSources(z as typeof z & { status: FloodStatus }), rising_fast: (await assessZone(db, z.id, now, s)).risingFast, trend: await trendEstimate(db, z.id, now, s) });
  const mine = actor.homeId ? await one<{ zone_id: string | null }>(db, 'SELECT zone_id FROM homes WHERE id = $1', [actor.homeId]) : undefined;
  // During an alert in their own zone, a resident can say "I'm safe" or "I need help".
  const checkin = mine?.zone_id
    ? await one<{ status: string }>(
        db,
        `SELECT c.status FROM flood_alerts a JOIN flood_checkins c ON c.alert_id = a.id WHERE a.zone_id = $1 AND a.ended_at IS NULL AND c.user_id = $2`,
        [mine.zone_id, actor.id],
      )
    : undefined;
  return { zones, myZoneId: mine?.zone_id ?? null, myCheckin: checkin?.status ?? null, warningPct: s.flood_warning_pct, dangerPct: s.flood_danger_pct };
}

/** Open alerts that concern this person: their own zone for a resident, the whole township for staff. */
export async function activeAlerts(db: Db, actor: Actor) {
  const rows = await db.query<{ message_level: FloodStatus | null; signals: unknown } & Record<string, unknown>>(
    `SELECT a.id, a.level, a.started_at, a.next_update_at, z.id AS zone_id, z.name AS zone_name, z.level_pct, z.safe_route, z.assembly_point,
            m.level AS message_level, m.signals, ${VERIFIED_COLUMNS}
       FROM flood_alerts a JOIN flood_zones z ON z.id = a.zone_id
       LEFT JOIN LATERAL (SELECT level, signals FROM flood_messages
                           WHERE zone_id = z.id AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1) m ON true
       ${VERIFIED_JOIN}
      WHERE a.ended_at IS NULL AND ($1::uuid IS NULL OR z.township_id = $1)
        AND ($2::uuid IS NULL OR z.id = (SELECT zone_id FROM homes WHERE id = $2))
      ORDER BY (a.level = 'DANGER') DESC, a.started_at DESC`,
    [actor.townshipId, actor.role === 'RESIDENT' ? actor.homeId : null],
  );
  // The source of the warning goes with it (Appendix E.1), never the raw signals.
  return rows.map(withSources);
}

/**
 * The duty officer sets a zone's level by hand. A person deciding is the
 * human check the two-signal rule asks for, so the change goes out at once,
 * through the same Calm Alert Flow as the agent's messages. Reaching DANGER
 * sends an URGENT notification to every resident of the zone and to staff (BR19).
 */
export async function recordLevel(db: Db, input: { zoneId: string; levelPct: number; actor: Actor }, now: Date) {
  return db.tx(async (tx) => {
    const zone = await one<{ id: string; name: string; township_id: string; status: FloodStatus; level_pct: number; safe_route: string; assembly_point: string }>(
      tx,
      'SELECT id, name, township_id, status, level_pct, safe_route, assembly_point FROM flood_zones WHERE id = $1 FOR UPDATE',
      [input.zoneId],
    );
    const actor = input.actor;
    if (!zone || (actor.role !== 'HQ_ADMIN' && zone.township_id !== actor.townshipId)) throw notFound('Zone');

    const status = levelOf(input.levelPct, await getSettings(tx));
    await tx.query(`INSERT INTO flood_readings (zone_id, level_pct, source, created_at) VALUES ($1, $2, 'MANUAL', $3)`, [zone.id, input.levelPct, now]);
    if (status !== zone.status) {
      await tx.query(`UPDATE flood_messages SET status = 'CANCELLED', decided_by = $2 WHERE zone_id = $1 AND status = 'DRAFT'`, [zone.id, actor.id]);
      await sendLevel(tx, zone, { level: status, levelPct: input.levelPct, decision: 'OFFICER', signals: [{ source: 'MANUAL', levelPct: input.levelPct }], actorId: actor.id }, now);
    } else {
      await tx.query('UPDATE flood_zones SET level_pct = $2, updated_at = $3 WHERE id = $1', [zone.id, input.levelPct, now]);
    }
    return { zoneId: zone.id, levelPct: input.levelPct, status, changed: status !== zone.status };
  });
}
