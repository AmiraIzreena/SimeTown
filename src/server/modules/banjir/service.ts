import type { FloodStatus } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { notFound } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';

/** Banjir: water levels by zone, and warnings that take priority over everything else. */

export async function banjirOverview(db: Db, actor: Actor) {
  const s = await getSettings(db);
  const zones = await db.query(
    `SELECT id, name, level_pct, status, safe_route, assembly_point, updated_at
       FROM flood_zones WHERE ($1::uuid IS NULL OR township_id = $1) ORDER BY name`,
    [actor.townshipId],
  );
  const mine = actor.homeId ? await one<{ zone_id: string | null }>(db, 'SELECT zone_id FROM homes WHERE id = $1', [actor.homeId]) : undefined;
  return { zones, myZoneId: mine?.zone_id ?? null, warningPct: s.flood_warning_pct, dangerPct: s.flood_danger_pct };
}

/** Open alerts that concern this person: their own zone for a resident, the whole township for staff. */
export async function activeAlerts(db: Db, actor: Actor) {
  return db.query(
    `SELECT a.id, a.level, a.started_at, z.id AS zone_id, z.name AS zone_name, z.level_pct, z.safe_route, z.assembly_point
       FROM flood_alerts a JOIN flood_zones z ON z.id = a.zone_id
      WHERE a.ended_at IS NULL AND ($1::uuid IS NULL OR z.township_id = $1)
        AND ($2::uuid IS NULL OR z.id = (SELECT zone_id FROM homes WHERE id = $2))
      ORDER BY (a.level = 'DANGER') DESC, a.started_at DESC`,
    [actor.townshipId, actor.role === 'RESIDENT' ? actor.homeId : null],
  );
}

/**
 * A new water level for a zone, from a sensor or from staff. Crossing a line
 * opens, changes or closes the zone's alert. Reaching DANGER sends an URGENT
 * notification to every resident of the zone and to township staff (BR19).
 */
export async function recordLevel(db: Db, input: { zoneId: string; levelPct: number; source: 'SENSOR' | 'MANUAL'; actor?: Actor }, now: Date) {
  return db.tx(async (tx) => {
    const zone = await one<{ id: string; name: string; township_id: string; status: FloodStatus; safe_route: string }>(
      tx,
      'SELECT id, name, township_id, status, safe_route FROM flood_zones WHERE id = $1 FOR UPDATE',
      [input.zoneId],
    );
    const actor = input.actor;
    if (!zone || (actor && actor.role !== 'HQ_ADMIN' && zone.township_id !== actor.townshipId)) throw notFound('Zone');

    const s = await getSettings(tx);
    const status: FloodStatus = input.levelPct >= s.flood_danger_pct ? 'DANGER' : input.levelPct >= s.flood_warning_pct ? 'WARNING' : 'NORMAL';
    await tx.query('INSERT INTO flood_readings (zone_id, level_pct, source, created_at) VALUES ($1, $2, $3, $4)', [zone.id, input.levelPct, input.source, now]);
    await tx.query('UPDATE flood_zones SET level_pct = $2, status = $3, updated_at = $4 WHERE id = $1', [zone.id, input.levelPct, status, now]);

    if (status !== zone.status) {
      await tx.query('UPDATE flood_alerts SET ended_at = $2 WHERE zone_id = $1 AND ended_at IS NULL', [zone.id, now]);
      if (status !== 'NORMAL') {
        await tx.query('INSERT INTO flood_alerts (zone_id, level, started_at) VALUES ($1, $2, $3)', [zone.id, status, now]);
      }
      const residents = await tx.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN homes h ON h.id = u.home_id WHERE h.zone_id = $1 AND u.status = 'ACTIVE'`,
        [zone.id],
      );
      const staff = await tx.query<{ id: string }>(
        `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
        [zone.township_id],
      );
      const everyone = [...residents, ...staff].map((u) => u.id);
      if (status === 'DANGER') {
        await notify(tx, everyone, { priority: 'URGENT', title: `Flood danger in ${zone.name}`, body: `Water is at ${input.levelPct}%. ${zone.safe_route}`, link: '/app/banjir' });
      } else if (status === 'WARNING') {
        await notify(tx, everyone, { title: `Flood warning in ${zone.name}`, body: `Water is at ${input.levelPct}%. Be ready to move.`, link: '/app/banjir' });
      } else {
        await notify(tx, everyone, { title: `All clear in ${zone.name}`, body: 'The water level is back to normal.', link: '/app/banjir' });
      }
      await audit(tx, actor?.id ?? null, 'FLOOD_STATUS', 'flood_zone', zone.id, { from: zone.status, to: status, levelPct: input.levelPct, source: input.source });
    }
    return { zoneId: zone.id, levelPct: input.levelPct, status, changed: status !== zone.status };
  });
}
