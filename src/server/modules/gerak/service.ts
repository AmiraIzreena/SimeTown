import { one, type Db, type Queryable } from '../../db/client';
import { notify } from '../notifications';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, forbidden, notFound, ruleViolation } from '../../errors';
import { ADMINS } from '@/shared/domain';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { recordAction, type ActionReward } from '../rewards';
import { getSettings, startOf } from '../settings';
import { resolveTownship } from '../townships';
import { loopDistanceSql } from './distance';

/** Gerak: walk or cycle a township loop and scan the QR code at each checkpoint. */

export async function gerakOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const tz = (await getSettings(db)).timezone;
  const loops = await db.query<{ id: string }>(
    `SELECT id, name, description, mode, distance_m FROM gerak_loops WHERE township_id = $1 AND active ORDER BY name`,
    [resident.townshipId],
  );
  const checkpoints = await db.query<{ loop_id: string }>(
    `SELECT cp.loop_id, cp.id, cp.seq, cp.name, cp.lat, cp.lng,
            EXISTS (SELECT 1 FROM gerak_checkins c WHERE c.checkpoint_id = cp.id AND c.user_id = $2
                     AND c.day = ($3::timestamptz AT TIME ZONE $4)::date) AS scanned_today
       FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
      WHERE l.township_id = $1 AND l.active ORDER BY cp.seq`,
    [resident.townshipId, resident.id, now, tz],
  );
  // Distance this month is distance on the township loops, finished or not (see distance.ts).
  const totals = await one<{ month_m: number; month_loops: number; all_loops: number }>(
    db,
    `SELECT ${loopDistanceSql('e.user_id = $1', `e.created_at >= ${startOf('month', '$2', '$3')}`, '$3')} AS month_m,
            (SELECT count(*) FROM xp_events WHERE user_id = $1 AND activity = 'GERAK_LOOP' AND created_at >= ${startOf('month', '$2', '$3')})::int AS month_loops,
            (SELECT count(*) FROM xp_events WHERE user_id = $1 AND activity = 'GERAK_LOOP')::int AS all_loops`,
    [resident.id, now, tz],
  );
  // Each completed loop is one GERAK_LOOP award a day, with ref "<loop id>:<day>".
  const history = await db.query<{ loop_id: string; times: number; last_at: string }>(
    `SELECT split_part(ref, ':', 1) AS loop_id, count(*)::int AS times, max(created_at) AS last_at
       FROM xp_events WHERE user_id = $1 AND activity = 'GERAK_LOOP' GROUP BY 1`,
    [resident.id],
  );
  return {
    loops: loops.map((l) => {
      const mine = history.find((h) => h.loop_id === l.id);
      return { ...l, checkpoints: checkpoints.filter((c) => c.loop_id === l.id), timesCompleted: mine?.times ?? 0, lastCompletedAt: mine?.last_at ?? null };
    }),
    monthMetres: totals!.month_m,
    monthLoops: totals!.month_loops,
    allLoops: totals!.all_loops,
  };
}

/**
 * Scanning a checkpoint's printed code proves the resident was there. Each
 * checkpoint counts once a day. When every checkpoint of a loop has been
 * scanned on the same day, the loop is complete and its distance is credited.
 */
/** Tells the resident a loop is complete, once per loop per day, under the Gerak notification category. */
export async function notifyLoopDone(q: Queryable, userId: string, loopName: string, xp: number, ref: string) {
  await notify(q, [userId], {
    title: `Loop completed: ${loopName}`,
    body: xp > 0 ? `Well done. You earned ${xp} Impact XP for walking, running or cycling the loop.` : 'Well done. Your loop is recorded on your Gerak page.',
    link: '/app/gerak',
    category: 'GERAK',
    dedupeKey: `gerak-loop:${userId}:${ref}`,
  });
}

export async function checkIn(db: Db, actor: Actor, code: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const tz = (await getSettings(tx)).timezone;
    const cp = await one<{ id: string; name: string; loop_id: string; loop_name: string; distance_m: number; day: string }>(
      tx,
      `SELECT cp.id, cp.name, l.id AS loop_id, l.name AS loop_name, l.distance_m, ($3::timestamptz AT TIME ZONE $4)::date::text AS day
         FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
        WHERE cp.code = $1 AND l.township_id = $2 AND l.active`,
      [code.trim().toUpperCase(), resident.townshipId, now, tz],
    );
    if (!cp) throw notFound('Checkpoint');
    const added = await tx.query(
      'INSERT INTO gerak_checkins (checkpoint_id, user_id, day, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING day',
      [cp.id, resident.id, cp.day, now],
    );
    if (added.length === 0) throw conflict('ALREADY_SCANNED', 'You have already scanned this checkpoint today.');

    const rewards: ActionReward[] = [await recordAction(tx, { user: resident, activity: 'GERAK_CHECKIN', ref: `${cp.id}:${cp.day}`, now })];
    const left = await one<{ n: number }>(
      tx,
      `SELECT count(*)::int AS n FROM gerak_checkpoints x
        WHERE x.loop_id = $1 AND NOT EXISTS (SELECT 1 FROM gerak_checkins c WHERE c.checkpoint_id = x.id AND c.user_id = $2 AND c.day = $3)`,
      [cp.loop_id, resident.id, cp.day],
    );
    const loopCompleted = left!.n === 0;
    if (loopCompleted) {
      rewards.push(await recordAction(tx, { user: resident, activity: 'GERAK_LOOP', ref: `${cp.loop_id}:${cp.day}`, quantity: cp.distance_m, now }));
      await notifyLoopDone(tx, resident.id, cp.loop_name, rewards.reduce((sum, r) => sum + r.xp, 0), `${cp.loop_id}:${cp.day}`);
    }
    return {
      checkpoint: cp.name,
      loop: cp.loop_name,
      loopCompleted,
      remaining: left!.n,
      reward: {
        xp: rewards.reduce((sum, r) => sum + r.xp, 0),
        points: rewards.reduce((sum, r) => sum + r.points, 0),
        offerPoints: rewards.reduce((sum, r) => sum + r.offerPoints, 0),
        fundedBy: rewards.flatMap((r) => r.fundedBy),
      },
    };
  });
}

/** Staff view: includes the secret codes, for printing the QR posters. */
export async function listLoopsForStaff(db: Db, actor: Actor) {
  const loops = await db.query<{ id: string }>(
    // mapped: the route is drawn, which on-loop distance and the map need; hidden (inactive) loops are listed for staff only.
    // path: the drawn route, for the staff map. lastChange: the latest show or hide, who did it and why (audit log).
    `SELECT l.id, l.name, l.description, l.mode, l.distance_m, l.active, jsonb_array_length(l.path) > 1 AS mapped, l.path,
            (SELECT jsonb_build_object('action', a.action, 'at', a.created_at, 'by', u.full_name, 'role', u.role, 'reason', a.detail->>'reason')
               FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
              WHERE a.entity_type = 'gerak_loop' AND a.entity_id = l.id::text AND a.action IN ('LOOP_SHOWN', 'LOOP_HIDDEN')
              ORDER BY a.id DESC LIMIT 1) AS "lastChange"
       FROM gerak_loops l WHERE ($1::uuid IS NULL OR l.township_id = $1) ORDER BY l.active DESC, l.name`,
    [actor.townshipId],
  );
  const checkpoints = await db.query<{ loop_id: string }>(
    `SELECT cp.loop_id, cp.id, cp.seq, cp.name, cp.code, (cp.lat IS NOT NULL AND cp.lng IS NOT NULL) AS located, cp.lat, cp.lng, cp.radius_m
       FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
      WHERE ($1::uuid IS NULL OR l.township_id = $1) ORDER BY cp.seq`,
    [actor.townshipId],
  );
  return loops.map((l) => ({ ...l, checkpoints: checkpoints.filter((c) => c.loop_id === l.id) }));
}

/**
 * Shows a loop to residents again, or hides it. Every resident-facing part of Gerak reads live loops only
 * (the loop list, the map, poster scans, GPS tracking and distance on the loops), so the change reaches all of
 * them at once. Township admins and SDP HQ only, with a reason that goes into the audit log.
 */
export async function setLoopActive(db: Db, actor: Actor, loopId: string, input: { active: boolean; reason: string }, now: Date) {
  if (!ADMINS.includes(actor.role)) throw forbidden('Only a township admin or SDP HQ can show or hide a loop.');
  return db.tx(async (tx) => {
    const loop = await one<{ township_id: string; name: string; active: boolean; checkpoints: number }>(
      tx,
      `SELECT l.township_id, l.name, l.active, (SELECT count(*)::int FROM gerak_checkpoints cp WHERE cp.loop_id = l.id) AS checkpoints
         FROM gerak_loops l WHERE l.id = $1 FOR UPDATE`,
      [loopId],
    );
    if (!loop) throw notFound('Loop');
    assertTownshipAccess(actor, loop.township_id);
    if (loop.active === input.active) return { id: loopId, active: loop.active, changed: false };
    if (input.active && loop.checkpoints < 2) throw ruleViolation('LOOP_INCOMPLETE', 'A loop needs at least two checkpoints before residents can use it.');
    await tx.query('UPDATE gerak_loops SET active = $2 WHERE id = $1', [loopId, input.active]);
    await audit(tx, actor.id, input.active ? 'LOOP_SHOWN' : 'LOOP_HIDDEN', 'gerak_loop', loopId, { name: loop.name, reason: input.reason, at: now.toISOString() });
    return { id: loopId, active: input.active, changed: true };
  });
}

export interface LoopInput {
  name: string;
  description: string;
  mode: 'WALK' | 'CYCLE';
  distanceM: number;
  checkpoints: string[];
}

export async function createLoop(db: Db, actor: Actor, input: LoopInput) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM gerak_loops WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('LOOP_EXISTS', 'A loop with this name already exists.');
    }
    const loop = await one<{ id: string }>(
      tx,
      'INSERT INTO gerak_loops (township_id, name, description, mode, distance_m) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [townshipId, input.name, input.description, input.mode, input.distanceM],
    );
    for (const [i, name] of input.checkpoints.entries()) {
      await tx.query('INSERT INTO gerak_checkpoints (loop_id, seq, name, code) VALUES ($1, $2, $3, $4)', [loop!.id, i + 1, name, `G${randomCode(9)}`]);
    }
    await audit(tx, actor.id, 'LOOP_CREATED', 'gerak_loop', loop!.id, { name: input.name });
    return { id: loop!.id };
  });
}
