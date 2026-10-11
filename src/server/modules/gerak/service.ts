import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { recordAction, type ActionReward } from '../rewards';
import { getSettings, startOf } from '../settings';
import { resolveTownship } from '../townships';

/** Gerak: walk or cycle a township loop and scan the QR code at each checkpoint. */

export async function gerakOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const tz = (await getSettings(db)).timezone;
  const loops = await db.query<{ id: string }>(
    `SELECT id, name, description, mode, distance_m FROM gerak_loops WHERE township_id = $1 AND active ORDER BY name`,
    [resident.townshipId],
  );
  const checkpoints = await db.query<{ loop_id: string }>(
    `SELECT cp.loop_id, cp.id, cp.seq, cp.name,
            EXISTS (SELECT 1 FROM gerak_checkins c WHERE c.checkpoint_id = cp.id AND c.user_id = $2
                     AND c.day = ($3::timestamptz AT TIME ZONE $4)::date) AS scanned_today
       FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
      WHERE l.township_id = $1 AND l.active ORDER BY cp.seq`,
    [resident.townshipId, resident.id, now, tz],
  );
  const totals = await one<{ month_m: number; month_loops: number; all_loops: number }>(
    db,
    `SELECT coalesce(sum(quantity) FILTER (WHERE created_at >= ${startOf('month', '$2', '$3')}), 0)::int AS month_m,
            count(*) FILTER (WHERE created_at >= ${startOf('month', '$2', '$3')})::int AS month_loops,
            count(*)::int AS all_loops
       FROM xp_events WHERE user_id = $1 AND activity = 'GERAK_LOOP'`,
    [resident.id, now, tz],
  );
  return {
    loops: loops.map((l) => ({ ...l, checkpoints: checkpoints.filter((c) => c.loop_id === l.id) })),
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
    `SELECT id, name, description, mode, distance_m, active FROM gerak_loops WHERE ($1::uuid IS NULL OR township_id = $1) ORDER BY name`,
    [actor.townshipId],
  );
  const checkpoints = await db.query<{ loop_id: string }>(
    `SELECT cp.loop_id, cp.id, cp.seq, cp.name, cp.code FROM gerak_checkpoints cp JOIN gerak_loops l ON l.id = cp.loop_id
      WHERE ($1::uuid IS NULL OR l.township_id = $1) ORDER BY cp.seq`,
    [actor.townshipId],
  );
  return loops.map((l) => ({ ...l, checkpoints: checkpoints.filter((c) => c.loop_id === l.id) }));
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
