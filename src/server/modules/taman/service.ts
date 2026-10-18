import { randomInt } from 'node:crypto';
import { STAFF, type WildlifeKind } from '@/shared/domain';
import type { Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { randomCode } from '../identity/service';
import { notify } from '../notifications';
import { recordAction, rewardUserById } from '../rewards';
import { getSettings } from '../settings';
import { resolveTownship } from '../townships';

/**
 * Taman: community gardens and more nature in the township (proposal section 5).
 * Apply for a plot (given out by ballot), take a day on the watering roster and prove it by scanning the
 * garden's code, and log the birds and insects you spot for staff to confirm.
 */

const PLOT_MONTHS = 6;
const ROSTER_DAYS = 14;

async function today(q: Queryable, now: Date): Promise<string> {
  const tz = (await getSettings(q)).timezone;
  return (await one<{ d: string }>(q, `SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS d`, [now, tz]))!.d;
}

export async function tamanOverview(db: Db, actor: Actor, now: Date) {
  const resident = requireVerifiedResident(actor);
  const day = await today(db, now);
  const [gardens, plots, roster, mine, sightings, applications] = await Promise.all([
    db.query<{ id: string; name: string; location: string; waiting: number }>(
      `SELECT g.id, g.name, g.location,
              (SELECT count(*)::int FROM garden_applications a WHERE a.garden_id = g.id AND a.status = 'WAITING') AS waiting
         FROM gardens g WHERE g.township_id = $1 ORDER BY g.name`,
      [resident.townshipId],
    ),
    db.query<{ garden_id: string; id: string; plot_no: string; size_m2: number; taken: boolean; mine: boolean; booked_until: string | null }>(
      `SELECT p.garden_id, p.id, p.plot_no, p.size_m2,
              (p.holder_home_id IS NOT NULL AND p.booked_until >= $2::date) AS taken,
              (p.holder_home_id = $3 AND p.booked_until >= $2::date) AS mine,
              CASE WHEN p.holder_home_id = $3 THEN p.booked_until::text END AS booked_until
         FROM garden_plots p JOIN gardens g ON g.id = p.garden_id WHERE g.township_id = $1 ORDER BY p.plot_no`,
      [resident.townshipId, day, resident.homeId],
    ),
    // The roster shows which days are taken, and which are yours; never who took the others.
    db.query<{ garden_id: string; day: string; mine: boolean; done: boolean }>(
      `SELECT r.garden_id, r.day::text AS day, (r.user_id = $3) AS mine, (r.done_at IS NOT NULL) AS done
         FROM garden_roster r JOIN gardens g ON g.id = r.garden_id
        WHERE g.township_id = $1 AND r.day BETWEEN $2::date AND $2::date + $4::int ORDER BY r.day`,
      [resident.townshipId, day, resident.id, ROSTER_DAYS],
    ),
    db.query(
      `SELECT id, kind, species, location, status, created_at, (photo_id IS NOT NULL) AS has_photo FROM wildlife_sightings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [resident.id],
    ),
    db.query(
      `SELECT kind, species, location, created_at FROM wildlife_sightings WHERE township_id = $1 AND status = 'CONFIRMED' ORDER BY created_at DESC LIMIT 20`,
      [resident.townshipId],
    ),
    // Only the home's own place on a waiting list; never who else applied.
    db.query<{ id: string; garden_id: string; created_at: Date }>(
      `SELECT id, garden_id, created_at FROM garden_applications WHERE home_id = $1 AND status = 'WAITING'`,
      [resident.homeId],
    ),
  ]);
  const species = await one<{ n: number; kinds: number }>(
    db,
    `SELECT count(DISTINCT lower(species))::int AS n, count(DISTINCT kind)::int AS kinds FROM wildlife_sightings WHERE township_id = $1 AND status = 'CONFIRMED'`,
    [resident.townshipId],
  );
  return {
    today: day,
    rosterDays: ROSTER_DAYS,
    plotMonths: PLOT_MONTHS,
    gardens: gardens.map((g) => ({
      ...g,
      freePlots: plots.filter((p) => p.garden_id === g.id && !p.taken).length,
      myApplication: applications.find((a) => a.garden_id === g.id) ?? null,
      plots: plots.filter((p) => p.garden_id === g.id),
      roster: roster.filter((r) => r.garden_id === g.id),
    })),
    mySightings: mine,
    townshipLog: sightings,
    speciesCount: species!.n,
  };
}

/**
 * Join a garden's waiting list. Plots are not booked first come, first served:
 * as at the real Elmina Community Edible Gardens, they are given out by ballot.
 * One plot, and one place on a waiting list, per home.
 */
export async function applyForPlot(db: Db, actor: Actor, gardenId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const day = await today(tx, now);
    await tx.query('SELECT id FROM homes WHERE id = $1 FOR UPDATE', [resident.homeId]);
    if (!(await one(tx, 'SELECT 1 FROM gardens WHERE id = $1 AND township_id = $2', [gardenId, resident.townshipId]))) throw notFound('Garden');
    if (await one(tx, 'SELECT 1 FROM garden_plots WHERE holder_home_id = $1 AND booked_until >= $2::date', [resident.homeId, day])) {
      throw conflict('ONE_PLOT', 'Your home already has a plot.');
    }
    if (await one(tx, `SELECT 1 FROM garden_applications WHERE home_id = $1 AND status = 'WAITING'`, [resident.homeId])) {
      throw conflict('ALREADY_APPLIED', 'Your home is already on a waiting list.');
    }
    const row = await one<{ id: string }>(tx, 'INSERT INTO garden_applications (garden_id, home_id, user_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [
      gardenId,
      resident.homeId,
      resident.id,
      now,
    ]);
    return { id: row!.id };
  });
}

export async function withdrawApplication(db: Db, actor: Actor, applicationId: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query(`UPDATE garden_applications SET status = 'WITHDRAWN', decided_at = $3 WHERE id = $1 AND home_id = $2 AND status = 'WAITING' RETURNING id`, [
    applicationId,
    resident.homeId,
    now,
  ]);
  if (rows.length === 0) throw notFound('Application');
  return { ok: true };
}

/**
 * Staff: draw the waiting list for a garden's free plots. Names are drawn in a
 * random order (crypto-strength), each winner gets the next free plot for six
 * months, and everyone hears the result. Those not drawn stay on the list.
 */
export async function runBallot(db: Db, actor: Actor, gardenId: string, now: Date) {
  return db.tx(async (tx) => {
    const garden = await one<{ township_id: string; name: string }>(tx, 'SELECT township_id, name FROM gardens WHERE id = $1 FOR UPDATE', [gardenId]);
    if (!garden) throw notFound('Garden');
    assertTownshipAccess(actor, garden.township_id);
    const day = await today(tx, now);
    // Lapsed plots go back into the draw, and a home whose plot lapsed elsewhere in the township may win again.
    await tx.query(
      'UPDATE garden_plots SET holder_home_id = NULL, holder_user_id = NULL WHERE booked_until < $2::date AND garden_id IN (SELECT id FROM gardens WHERE township_id = $1)',
      [garden.township_id, day],
    );
    const free = await tx.query<{ id: string; plot_no: string }>(
      'SELECT id, plot_no FROM garden_plots WHERE garden_id = $1 AND holder_home_id IS NULL ORDER BY plot_no FOR UPDATE',
      [gardenId],
    );
    const waiting = await tx.query<{ id: string; home_id: string; user_id: string }>(
      `SELECT id, home_id, user_id FROM garden_applications WHERE garden_id = $1 AND status = 'WAITING' ORDER BY created_at FOR UPDATE`,
      [gardenId],
    );
    if (free.length === 0) throw ruleViolation('NO_FREE_PLOTS', 'Every plot is taken. Run the ballot when one is given back.');
    if (waiting.length === 0) throw ruleViolation('NO_APPLICANTS', 'Nobody is on the waiting list.');
    for (let i = waiting.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [waiting[i], waiting[j]] = [waiting[j]!, waiting[i]!];
    }
    const winners = waiting.slice(0, free.length);
    for (const [i, app] of winners.entries()) {
      const plot = free[i]!;
      await tx.query(
        `UPDATE garden_plots SET holder_home_id = $2, holder_user_id = $3, booked_at = $4, booked_until = ($5::date + make_interval(months => $6))::date WHERE id = $1`,
        [plot.id, app.home_id, app.user_id, now, day, PLOT_MONTHS],
      );
      await tx.query(`UPDATE garden_applications SET status = 'ALLOCATED', plot_id = $2, decided_at = $3 WHERE id = $1`, [app.id, plot.id, now]);
      await notify(tx, [app.user_id], { title: `You won plot ${plot.plot_no} at ${garden.name}`, body: 'It is yours for six months. Happy growing!', link: '/app/taman' });
    }
    const stillWaiting = waiting.slice(free.length);
    await notify(tx, stillWaiting.map((a) => a.user_id), {
      title: `Still on the waiting list for ${garden.name}`,
      body: 'Every free plot was drawn. You stay on the list for the next ballot.',
      link: '/app/taman',
    });
    await audit(tx, actor.id, 'GARDEN_BALLOT', 'garden', gardenId, { freePlots: free.length, applicants: waiting.length, allocated: winners.length });
    return { allocated: winners.length, stillWaiting: stillWaiting.length, freePlotsLeft: free.length - winners.length };
  });
}

export async function releasePlot(db: Db, actor: Actor, plotId: string) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query('UPDATE garden_plots SET holder_home_id = NULL, holder_user_id = NULL, booked_until = NULL WHERE id = $1 AND holder_home_id = $2 RETURNING id', [plotId, resident.homeId]);
  if (rows.length === 0) throw notFound('Plot');
  return { ok: true };
}

/** Take a day on a garden's watering roster, up to two weeks ahead. One person per garden per day. */
export async function takeRosterDay(db: Db, actor: Actor, gardenId: string, day: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  const start = await today(db, now);
  const ok = await one<{ ok: boolean }>(db, `SELECT $1::date BETWEEN $2::date AND $2::date + $3::int AS ok`, [day, start, ROSTER_DAYS]);
  if (!ok!.ok) throw ruleViolation('ROSTER_DAY', `Choose a day in the next ${ROSTER_DAYS} days.`);
  if (!(await one(db, 'SELECT 1 FROM gardens WHERE id = $1 AND township_id = $2', [gardenId, resident.townshipId]))) throw notFound('Garden');
  const rows = await db.query('INSERT INTO garden_roster (garden_id, day, user_id) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING RETURNING day', [gardenId, day, resident.id]);
  if (rows.length === 0) throw conflict('DAY_TAKEN', 'Someone has already taken that day.');
  return { ok: true };
}

/**
 * Watering done: the resident scans the code at the garden gate. The printed
 * code can be shared, so it earns Impact XP only (and points from a funded
 * campaign, if a sponsor runs one), never offer-backed points.
 */
export async function markWatered(db: Db, actor: Actor, code: string, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const garden = await one<{ id: string; name: string }>(tx, 'SELECT id, name FROM gardens WHERE code = $1 AND township_id = $2', [code.trim().toUpperCase(), resident.townshipId]);
    if (!garden) throw notFound('Garden');
    const day = await today(tx, now);
    const slot = await one<{ user_id: string; done_at: Date | null }>(tx, 'SELECT user_id, done_at FROM garden_roster WHERE garden_id = $1 AND day = $2::date FOR UPDATE', [garden.id, day]);
    if (slot && slot.user_id !== resident.id) throw conflict('NOT_YOUR_DAY', 'Someone else is on the roster today.');
    if (slot?.done_at) throw conflict('ALREADY_DONE', 'Today’s watering is already recorded.');
    if (slot) await tx.query('UPDATE garden_roster SET done_at = $3 WHERE garden_id = $1 AND day = $2::date', [garden.id, day, now]);
    else await tx.query('INSERT INTO garden_roster (garden_id, day, user_id, done_at) VALUES ($1, $2::date, $3, $4)', [garden.id, day, resident.id, now]);
    const reward = await recordAction(tx, { user: resident, activity: 'TAMAN_WATERING', ref: `${garden.id}:${day}`, now });
    return { garden: garden.name, reward };
  });
}

export async function addSighting(db: Db, actor: Actor, input: { kind: WildlifeKind; species: string; location: string; note?: string; photo?: Photo }, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    let photoId: string | null = null;
    if (input.photo) {
      const upload = await one<{ id: string }>(tx, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [
        resident.id,
        input.photo.mime,
        input.photo.bytes.length,
        Buffer.from(input.photo.bytes),
      ]);
      photoId = upload!.id;
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO wildlife_sightings (township_id, user_id, kind, species, location, note, photo_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [resident.townshipId, resident.id, input.kind, input.species, input.location, input.note ?? null, photoId, now],
    );
    return { id: row!.id };
  });
}

/** Staff: sightings waiting to be confirmed. The resident's name is not shown; the record is about the animal. */
export async function sightingQueue(db: Db, actor: Actor) {
  return db.query(
    `SELECT id, kind, species, location, note, status, created_at, (photo_id IS NOT NULL) AS has_photo
       FROM wildlife_sightings WHERE ($1::uuid IS NULL OR township_id = $1) AND status = 'PENDING' ORDER BY created_at LIMIT 100`,
    [actor.townshipId],
  );
}

export async function decideSighting(db: Db, actor: Actor, id: string, confirm: boolean, now: Date) {
  return db.tx(async (tx) => {
    const s = await one<{ township_id: string; user_id: string; status: string; species: string }>(tx, 'SELECT township_id, user_id, status, species FROM wildlife_sightings WHERE id = $1 FOR UPDATE', [id]);
    if (!s) throw notFound('Sighting');
    assertTownshipAccess(actor, s.township_id);
    if (s.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This sighting has already been reviewed.');
    await tx.query('UPDATE wildlife_sightings SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1', [id, confirm ? 'CONFIRMED' : 'REJECTED', actor.id, now]);
    if (confirm) {
      const user = await rewardUserById(tx, s.user_id);
      if (user) await recordAction(tx, { user, activity: 'TAMAN_SIGHTING', ref: id, now });
    }
    await notify(tx, [s.user_id], { title: confirm ? `Your ${s.species} sighting is confirmed` : 'A sighting could not be confirmed', body: confirm ? 'It is now in the township’s wildlife log.' : 'Thank you for looking out for nature.', link: '/app/taman' });
    await audit(tx, actor.id, confirm ? 'SIGHTING_CONFIRMED' : 'SIGHTING_REJECTED', 'wildlife_sighting', id);
    return { status: confirm ? 'CONFIRMED' : 'REJECTED' };
  });
}

/** The photo is served only to the person who logged it and to that township's staff. */
export async function sightingPhoto(db: Db, actor: Actor, id: string): Promise<Response> {
  const s = await one<{ user_id: string; township_id: string; photo_id: string | null }>(db, 'SELECT user_id, township_id, photo_id FROM wildlife_sightings WHERE id = $1', [id]);
  const staff = STAFF.includes(actor.role);
  const allowed = s && (staff ? actor.role === 'HQ_ADMIN' || s.township_id === actor.townshipId : s.user_id === actor.id);
  if (!allowed || !s.photo_id) throw notFound('Photo');
  const upload = await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [s.photo_id]);
  if (!upload) throw notFound('Photo');
  return new Response(Buffer.from(upload.bytes), {
    headers: { 'Content-Type': upload.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600' },
  });
}

/** Staff: gardens with their printable gate codes. */
export async function listGardensForStaff(db: Db, actor: Actor) {
  return db.query(
    `SELECT g.id, g.name, g.location, g.code,
            (SELECT count(*)::int FROM garden_plots p WHERE p.garden_id = g.id) AS plots,
            (SELECT count(*)::int FROM garden_plots p WHERE p.garden_id = g.id AND p.holder_home_id IS NOT NULL AND p.booked_until >= current_date) AS booked,
            (SELECT count(*)::int FROM garden_applications a WHERE a.garden_id = g.id AND a.status = 'WAITING') AS waiting
       FROM gardens g WHERE ($1::uuid IS NULL OR g.township_id = $1) ORDER BY g.name`,
    [actor.townshipId],
  );
}

export async function createGarden(db: Db, actor: Actor, input: { name: string; location: string; plots: number; plotSizeM2: number }) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (await one(tx, 'SELECT 1 FROM gardens WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) throw conflict('GARDEN_EXISTS', 'A garden with this name already exists.');
    const garden = await one<{ id: string }>(tx, 'INSERT INTO gardens (township_id, name, location, code) VALUES ($1, $2, $3, $4) RETURNING id', [townshipId, input.name, input.location, `T${randomCode(9)}`]);
    for (let n = 1; n <= input.plots; n++) {
      await tx.query('INSERT INTO garden_plots (garden_id, plot_no, size_m2) VALUES ($1, $2, $3)', [garden!.id, String(n).padStart(2, '0'), input.plotSizeM2]);
    }
    await audit(tx, actor.id, 'GARDEN_CREATED', 'garden', garden!.id, { name: input.name });
    return { id: garden!.id };
  });
}

