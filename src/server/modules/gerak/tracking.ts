import { GERAK_MODE_INFO, type GerakMode } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig } from '../../config';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { recordAction, sumRewards, type ActionReward } from '../rewards';
import { getSettings } from '../settings';
import { notifyLoopDone } from './service';

/**
 * Gerak map tracking (proposal 6.2, BR24).
 *
 * The phone sends its position in small batches between Start and Finish,
 * and only then. Each batch is checked here, not on the phone:
 *   - a poor fix (accuracy worse than 50 m) is ignored;
 *   - the part of a trip faster than the activity's speed band does not count,
 *     so a car trip earns nothing;
 *   - a checkpoint ticks itself when the trip passes within its radius;
 *   - after 10 minutes without moving the activity ends by itself.
 * On Finish, the first and last 200 m (usually near home) are cut from the
 * stored route, and the whole route is deleted after 30 days.
 */

const POOR_FIX_M = 50;
const STILL_LIMIT_MS = 10 * 60_000;
const NEAR_HOME_M = 200;
const MAX_ROUTE_POINTS = 5000;
const MIN_TRIP_M = 200;

export interface TrackPoint {
  lat: number;
  lng: number;
  /** Accuracy in metres, as the browser reports it. */
  acc: number;
  /** When the fix was taken, in epoch milliseconds. */
  t: number;
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drops the stretch within `metres` of the start and of the end, so where someone lives is never stored. */
export function trimNearEnds(route: [number, number][], metres = NEAR_HOME_M): [number, number][] {
  if (route.length < 2) return [];
  const toPoint = ([lat, lng]: [number, number]) => ({ lat, lng });
  const first = toPoint(route[0]!);
  const last = toPoint(route[route.length - 1]!);
  return route.filter((p) => distanceM(toPoint(p), first) > metres && distanceM(toPoint(p), last) > metres);
}

interface ActivityRow {
  id: string;
  user_id: string;
  township_id: string;
  mode: GerakMode;
  status: 'ACTIVE' | 'FINISHED' | 'ABANDONED';
  simulated: boolean;
  started_at: Date;
  finished_at: Date | null;
  last_point_at: Date | null;
  last_moved_at: Date | null;
  last_lat: number | null;
  last_lng: number | null;
  points_count: number;
  ignored_points: number;
  distance_m: number;
  valid_m: number;
  too_fast_m: number;
  active_s: number;
  route: [number, number][];
  reward: ActionReward | null;
}

/** The township's loops and checkpoints with their positions, and the main gate, for the map. */
export async function gerakMap(q: Queryable, townshipId: string) {
  const [loops, checkpoints, gate] = await Promise.all([
    q.query<{ id: string; name: string; mode: string; distance_m: number; path: [number, number][] }>(
      'SELECT id, name, mode, distance_m, path FROM gerak_loops WHERE township_id = $1 AND active ORDER BY name',
      [townshipId],
    ),
    q.query<{ loop_id: string; loop_name: string; mode: string; distance_m: number; id: string; seq: number; name: string; lat: number | null; lng: number | null; radius_m: number }>(
      `SELECT l.id AS loop_id, l.name AS loop_name, l.mode, l.distance_m, cp.id, cp.seq, cp.name, cp.lat, cp.lng, cp.radius_m
         FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
        WHERE l.township_id = $1 AND l.active ORDER BY l.name, cp.seq`,
      [townshipId],
    ),
    one<{ gate_name: string | null; gate_lat: number | null; gate_lng: number | null }>(q, 'SELECT gate_name, gate_lat, gate_lng FROM townships WHERE id = $1', [townshipId]),
  ]);
  return {
    loops,
    checkpoints: checkpoints.filter((c) => c.lat !== null && c.lng !== null),
    gate: gate?.gate_lat != null ? { name: gate.gate_name, lat: gate.gate_lat, lng: gate.gate_lng } : null,
  };
}

/** Tap Start. Demo playback of a recorded route ("simulated") is refused in production. */
export async function startActivity(db: Db, actor: Actor, input: { mode: GerakMode; simulated: boolean }, now: Date) {
  const resident = requireVerifiedResident(actor);
  if (input.simulated && getConfig().APP_ENV === 'production') throw ruleViolation('SIMULATION_OFF', 'Simulated GPS is only available in the demo.');
  return db.tx(async (tx) => {
    const running = await one<{ id: string; last_point_at: Date | null; started_at: Date }>(
      tx,
      `SELECT id, last_point_at, started_at FROM gerak_activities WHERE user_id = $1 AND status = 'ACTIVE' FOR UPDATE`,
      [resident.id],
    );
    if (running) {
      // One activity at a time. One left running from long ago is closed without reward.
      if (now.getTime() - (running.last_point_at ?? running.started_at).getTime() < STILL_LIMIT_MS) {
        throw conflict('ACTIVITY_RUNNING', 'You already have an activity running. Finish it first.');
      }
      await tx.query(`UPDATE gerak_activities SET status = 'ABANDONED', finished_at = $2, route = '[]', route_deleted_at = $2 WHERE id = $1`, [running.id, now]);
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO gerak_activities (user_id, township_id, mode, simulated, started_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [resident.id, resident.townshipId, input.mode, input.simulated, now],
    );
    return { id: row!.id, startedAt: now, mode: input.mode, maxSpeedKmh: GERAK_MODE_INFO[input.mode].maxSpeedKmh };
  });
}

async function lockActivity(tx: Queryable, actor: Actor, id: string): Promise<ActivityRow> {
  const a = await one<ActivityRow>(tx, 'SELECT * FROM gerak_activities WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, actor.id]);
  if (!a) throw notFound('Activity');
  return a;
}

/** One batch of positions from the phone. Returns the running totals and any checkpoint just ticked. */
export async function addPoints(db: Db, actor: Actor, activityId: string, points: TrackPoint[], now: Date) {
  requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const a = await lockActivity(tx, actor, activityId);
    if (a.status !== 'ACTIVE') throw conflict('ACTIVITY_ENDED', 'This activity has ended.');
    const maxMs = GERAK_MODE_INFO[a.mode].maxSpeedKmh / 3.6;
    const checkpoints = await tx.query<{ id: string; name: string; lat: number; lng: number; radius_m: number }>(
      `SELECT cp.id, cp.name, cp.lat, cp.lng, cp.radius_m FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
        WHERE l.township_id = $1 AND l.active AND cp.lat IS NOT NULL AND cp.lng IS NOT NULL`,
      [a.township_id],
    );
    // Live tracking takes fixes up to now; demo playback runs on its own clock, within six hours of Start.
    const earliest = a.started_at.getTime() - 60_000;
    const latest = a.simulated ? a.started_at.getTime() + 6 * 3_600_000 : now.getTime() + 60_000;

    let last = a.last_lat !== null && a.last_lng !== null && a.last_point_at ? { lat: a.last_lat, lng: a.last_lng, t: a.last_point_at.getTime() } : null;
    let lastMoved = a.last_moved_at?.getTime() ?? a.started_at.getTime();
    let { distance_m: distance, valid_m: valid, too_fast_m: tooFast, active_s: activeS, ignored_points: ignored, points_count: count } = a;
    const route = [...a.route];
    const ticked: string[] = [];
    let stillTooLong = false;

    for (const p of [...points].sort((x, y) => x.t - y.t)) {
      if (p.t < earliest || p.t > latest || (last && p.t <= last.t)) {
        ignored++;
        continue;
      }
      if (p.acc > POOR_FIX_M) {
        ignored++; // a poor signal is ignored, never guessed at
        continue;
      }
      count++;
      if (last) {
        const d = distanceM(last, p);
        const dt = (p.t - last.t) / 1000;
        distance += d;
        if (d / dt <= maxMs) {
          valid += d;
          if (d >= 2) activeS += Math.min(dt, 60);
        } else {
          tooFast += d;
        }
        if (d >= 5) lastMoved = p.t;
        else if (p.t - lastMoved > STILL_LIMIT_MS) {
          stillTooLong = true;
          break;
        }
      } else {
        lastMoved = p.t;
      }
      last = { lat: p.lat, lng: p.lng, t: p.t };
      if (route.length < MAX_ROUTE_POINTS) route.push([Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5]);
      for (const cp of checkpoints) {
        if (distanceM(p, cp) <= cp.radius_m + Math.min(p.acc, 25)) {
          const hit = await tx.query(
            'INSERT INTO gerak_activity_hits (activity_id, checkpoint_id, hit_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING checkpoint_id',
            [a.id, cp.id, new Date(p.t)],
          );
          if (hit.length) ticked.push(cp.name);
        }
      }
    }

    await tx.query(
      `UPDATE gerak_activities SET last_point_at = $2, last_lat = $3, last_lng = $4, last_moved_at = $5, points_count = $6, ignored_points = $7,
              distance_m = $8, valid_m = $9, too_fast_m = $10, active_s = $11, route = $12::jsonb WHERE id = $1`,
      [a.id, last ? new Date(last.t) : null, last?.lat ?? null, last?.lng ?? null, new Date(lastMoved), count, ignored, Math.round(distance), Math.round(valid), Math.round(tooFast), Math.round(activeS), JSON.stringify(route)],
    );
    const result = { distanceM: Math.round(distance), validM: Math.round(valid), tooFastM: Math.round(tooFast), activeS: Math.round(activeS), ignored, ticked, ended: false as boolean, reward: null as ActionReward | null };
    if (stillTooLong) {
      // Ten minutes without moving: the activity ends by itself and is credited as it stood.
      const finished = await finishLocked(tx, (await lockActivity(tx, actor, activityId)), now);
      return { ...result, ended: true, reward: finished.reward };
    }
    return result;
  });
}

/** Tap Finish: the fair-play checks run, the route is trimmed, and verified distance and loops are credited. */
export async function finishActivity(db: Db, actor: Actor, activityId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const a = await lockActivity(tx, resident, activityId);
    if (a.status !== 'ACTIVE') throw conflict('ACTIVITY_ENDED', 'This activity has already ended.');
    return finishLocked(tx, a, now);
  });
}

async function finishLocked(tx: Queryable, a: ActivityRow, now: Date) {
  const user = { id: a.user_id, homeId: '', townshipId: a.township_id };
  const home = await one<{ home_id: string }>(tx, 'SELECT home_id FROM users WHERE id = $1', [a.user_id]);
  user.homeId = home!.home_id;
  const tz = (await getSettings(tx)).timezone;
  const day = (await one<{ day: string }>(tx, `SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS day`, [a.started_at, tz]))!.day;
  const rewards: ActionReward[] = [];

  if (a.valid_m >= MIN_TRIP_M) {
    rewards.push(await recordAction(tx, { user, activity: 'GERAK_TRIP', ref: a.id, quantity: a.valid_m, now, offerEligible: true }));
  }

  // A loop counts when every one of its checkpoints was passed on this trip, in order (either direction).
  const loops = await tx.query<{ loop_id: string; name: string; distance_m: number; seqs: number[]; hit_seqs: number[] | null; cp_ids: string[] }>(
    `SELECT l.id AS loop_id, l.name, l.distance_m, array_agg(cp.seq ORDER BY cp.seq) AS seqs, array_agg(cp.id ORDER BY cp.seq) AS cp_ids,
            (SELECT array_agg(c2.seq ORDER BY h.hit_at) FROM gerak_activity_hits h JOIN gerak_checkpoints c2 ON c2.id = h.checkpoint_id
              WHERE h.activity_id = $1 AND c2.loop_id = l.id) AS hit_seqs
       FROM gerak_loops l JOIN gerak_checkpoints cp ON cp.loop_id = l.id
      WHERE l.township_id = $2 AND l.active GROUP BY l.id, l.name, l.distance_m`,
    [a.id, a.township_id],
  );
  const loopsDone: string[] = [];
  for (const loop of loops) {
    const hits = loop.hit_seqs ?? [];
    const forward = loop.seqs.join(',');
    const backward = [...loop.seqs].reverse().join(',');
    if (hits.length !== loop.seqs.length || (hits.join(',') !== forward && hits.join(',') !== backward)) continue;
    loopsDone.push(loop.loop_id);
    for (const cpId of loop.cp_ids) {
      await tx.query('INSERT INTO gerak_checkins (checkpoint_id, user_id, day, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [cpId, a.user_id, day, now]);
      rewards.push(await recordAction(tx, { user, activity: 'GERAK_CHECKIN', ref: `${cpId}:${day}`, now }));
    }
    const loopReward = await recordAction(tx, { user, activity: 'GERAK_LOOP', ref: `${loop.loop_id}:${day}`, quantity: loop.distance_m, now, offerEligible: true });
    rewards.push(loopReward);
    await notifyLoopDone(tx, a.user_id, loop.name, loopReward.xp, `${loop.loop_id}:${day}`);
  }

  const reward = sumRewards(rewards);
  await tx.query(
    `UPDATE gerak_activities SET status = 'FINISHED', finished_at = $2, route = $3::jsonb, reward = $4::jsonb WHERE id = $1`,
    [a.id, now, JSON.stringify(trimNearEnds(a.route)), JSON.stringify(reward)],
  );
  return {
    id: a.id,
    distanceM: a.distance_m,
    validM: a.valid_m,
    tooFastM: a.too_fast_m,
    activeS: a.active_s,
    loopsCompleted: loopsDone.length,
    countedAsTrip: a.valid_m >= MIN_TRIP_M,
    reward,
  };
}

/** The activity in progress, if any, and the last few, for the Gerak screen. */
export async function myActivities(db: Db, actor: Actor) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<ActivityRow>(
    `SELECT id, mode, status, simulated, started_at, finished_at, distance_m, valid_m, too_fast_m, active_s, ignored_points, route, reward
       FROM gerak_activities WHERE user_id = $1 AND status <> 'ABANDONED' ORDER BY started_at DESC LIMIT 10`,
    [resident.id],
  );
  const active = rows.find((r) => r.status === 'ACTIVE');
  const hits = active
    ? await db.query<{ checkpoint_id: string }>('SELECT checkpoint_id FROM gerak_activity_hits WHERE activity_id = $1', [active.id])
    : [];
  return {
    active: active ? { ...active, hits: hits.map((h) => h.checkpoint_id) } : null,
    // The latest trip's trimmed route is shown on the map; older ones only as totals.
    recent: rows.filter((r) => r.status === 'FINISHED').map(({ route, ...rest }, i) => ({ ...rest, routePoints: route.length, route: i === 0 ? route : [] })),
  };
}

/** Staff draw a loop on the map: its path, and where each checkpoint is and how close counts as passing it. */
export async function setLoopMap(
  db: Db,
  actor: Actor,
  loopId: string,
  input: { path: [number, number][]; checkpoints: { id: string; lat: number; lng: number; radiusM: number }[] },
) {
  return db.tx(async (tx) => {
    const loop = await one<{ township_id: string }>(tx, 'SELECT township_id FROM gerak_loops WHERE id = $1 FOR UPDATE', [loopId]);
    if (!loop) throw notFound('Loop');
    assertTownshipAccess(actor, loop.township_id);
    await tx.query('UPDATE gerak_loops SET path = $2::jsonb WHERE id = $1', [loopId, JSON.stringify(input.path)]);
    for (const cp of input.checkpoints) {
      const rows = await tx.query('UPDATE gerak_checkpoints SET lat = $3, lng = $4, radius_m = $5 WHERE id = $1 AND loop_id = $2 RETURNING id', [cp.id, loopId, cp.lat, cp.lng, cp.radiusM]);
      if (rows.length === 0) throw notFound('Checkpoint');
    }
    await audit(tx, actor.id, 'LOOP_MAPPED', 'gerak_loop', loopId, { points: input.path.length });
    return { ok: true };
  });
}
