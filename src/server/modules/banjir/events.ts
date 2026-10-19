import { formatAddress, type FloodStatus, type HomeAddress } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { HOME_ADDRESS_COLUMNS } from '../townships';
import { uptimeSql } from './sensors';

/**
 * Flood events (proposal Appendix E.2, rule 10): everything from a zone's first alert
 * to its all clear. The post-event report, the false-alarm review, the priority
 * help tasks and the Insights tiles are all read from here and the audit trail.
 */

// --- Tracking, called from sendLevel -----------------------------------------------

/** The zone's open event, opened by its first alert and raised to danger if it gets there. */
export async function eventForAlert(tx: Queryable, zoneId: string, level: Exclude<FloodStatus, 'NORMAL'>, levelPct: number | null, now: Date): Promise<string> {
  const open = await one<{ id: string }>(tx, 'SELECT id FROM flood_events WHERE zone_id = $1 AND ended_at IS NULL FOR UPDATE', [zoneId]);
  if (!open) {
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO flood_events (zone_id, started_at, peak_status, peak_level_pct, first_warning_at, first_danger_at)
       VALUES ($1, $2, $3, $4, $2, CASE WHEN $3 = 'DANGER' THEN $2::timestamptz END) RETURNING id`,
      [zoneId, now, level, levelPct],
    );
    return row!.id;
  }
  await tx.query(
    `UPDATE flood_events SET peak_status = CASE WHEN $2 = 'DANGER' THEN 'DANGER' ELSE peak_status END,
            peak_level_pct = greatest(peak_level_pct, $3),
            first_danger_at = coalesce(first_danger_at, CASE WHEN $2 = 'DANGER' THEN $4::timestamptz END)
      WHERE id = $1`,
    [open.id, level, levelPct, now],
  );
  return open.id;
}

export async function notePeopleWarned(tx: Queryable, eventId: string, people: number) {
  await tx.query('UPDATE flood_events SET people_warned = greatest(people_warned, $2) WHERE id = $1', [eventId, people]);
}

/** The highest level seen while the event is open. */
export async function notePeak(tx: Queryable, zoneId: string, levelPct: number) {
  await tx.query('UPDATE flood_events SET peak_level_pct = greatest(coalesce(peak_level_pct, 0), $2) WHERE zone_id = $1 AND ended_at IS NULL', [zoneId, levelPct]);
}

export async function closeEvent(tx: Queryable, zoneId: string, now: Date) {
  await tx.query('UPDATE flood_events SET ended_at = $2 WHERE zone_id = $1 AND ended_at IS NULL', [zoneId, now]);
}

// --- Events and reports (tab 5) --------------------------------------------------------

async function loadEvent(q: Queryable, actor: Actor, eventId: string) {
  const event = await one<{
    id: string; zone_id: string; zone_name: string; township_id: string; started_at: Date; ended_at: Date | null; peak_status: FloodStatus; peak_level_pct: number | null;
    first_warning_at: Date | null; first_danger_at: Date | null; people_warned: number; false_alarm: boolean | null; review_note: string | null; reviewed_at: Date | null; reviewer: string | null;
  }>(
    q,
    `SELECT e.*, z.name AS zone_name, z.township_id, u.full_name AS reviewer
       FROM flood_events e JOIN flood_zones z ON z.id = e.zone_id LEFT JOIN users u ON u.id = e.reviewed_by WHERE e.id = $1`,
    [eventId],
  );
  if (!event) throw notFound('Event');
  assertTownshipAccess(actor, event.township_id);
  return event;
}

const minutesBetween = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 6_000) / 10 : null);

/** Check-ins during an event: everyone who answered, and who answered within 30 minutes of the first alert. */
async function eventCheckins(q: Queryable, eventId: string, zoneId: string, startedAt: Date) {
  return (await one<{ residents: number; safe: number; need_help: number; within_30: number }>(
    q,
    `SELECT (SELECT count(*)::int FROM users u JOIN homes h ON h.id = u.home_id WHERE h.zone_id = $2 AND u.role = 'RESIDENT' AND u.status = 'ACTIVE') AS residents,
            count(*) FILTER (WHERE c.status = 'SAFE')::int AS safe,
            count(*) FILTER (WHERE c.status = 'NEED_HELP')::int AS need_help,
            count(*) FILTER (WHERE c.first_at <= $3::timestamptz + interval '30 minutes')::int AS within_30
       FROM (SELECT DISTINCT ON (c.user_id) c.user_id, c.status,
                    (SELECT min(c2.created_at) FROM flood_checkins c2 JOIN flood_alerts a2 ON a2.id = c2.alert_id WHERE a2.event_id = $1 AND c2.user_id = c.user_id) AS first_at
               FROM flood_checkins c JOIN flood_alerts a ON a.id = c.alert_id WHERE a.event_id = $1
              ORDER BY c.user_id, c.created_at DESC) c`,
    [eventId, zoneId, startedAt],
  ))!;
}

export async function listEvents(db: Db, actor: Actor) {
  return db.query(
    `SELECT e.id, e.zone_id, z.name AS zone_name, e.started_at, e.ended_at, e.peak_status, e.peak_level_pct, e.people_warned, e.false_alarm, e.reviewed_at,
            e.first_warning_at, e.first_danger_at
       FROM flood_events e JOIN flood_zones z ON z.id = e.zone_id
      WHERE ($1::uuid IS NULL OR z.township_id = $1) ORDER BY e.started_at DESC LIMIT 40`,
    [actor.townshipId],
  );
}

/**
 * The post-event report (rule 10): the timeline, who was warned, the check-in rate
 * and the false-alarm review, taken from the audit trail and the agent's log.
 * Counts only: no resident is named in a report that may be printed.
 */
export async function eventReport(db: Db, actor: Actor, eventId: string, now: Date) {
  const event = await loadEvent(db, actor, eventId);
  const end = event.ended_at ?? now;
  // Thirty minutes before the first alert shows the signals that led to it.
  const from = new Date(event.started_at.getTime() - 30 * 60_000);
  const [timeline, messages, checkins, help, sms, signals] = await Promise.all([
    db.query(
      `SELECT l.id, l.at, l.step, l.detail, u.full_name AS actor_name FROM flood_agent_log l LEFT JOIN users u ON u.id = l.actor_user_id
        WHERE l.zone_id = $1 AND l.at BETWEEN $2 AND $3 AND l.step <> 'ASSESSED' ORDER BY l.at, l.id LIMIT 300`,
      [event.zone_id, from, end],
    ),
    db.query(
      `SELECT m.id, m.level, m.kind, m.what, m.todo, m.decision, m.sent_at, u.full_name AS decided_by_name FROM flood_messages m LEFT JOIN users u ON u.id = m.decided_by
        WHERE m.zone_id = $1 AND m.status = 'SENT' AND m.sent_at BETWEEN $2 AND $3 ORDER BY m.sent_at`,
      [event.zone_id, event.started_at, end],
    ),
    eventCheckins(db, event.id, event.zone_id, event.started_at),
    one<{ tasks: number; reached: number; avg_reach_min: number | null }>(
      db,
      `SELECT count(*)::int AS tasks, count(*) FILTER (WHERE t.status = 'REACHED')::int AS reached,
              round(avg(extract(epoch FROM t.reached_at - e.started_at) / 60)::numeric, 1)::float AS avg_reach_min
         FROM flood_help_tasks t JOIN flood_events e ON e.id = t.event_id WHERE t.event_id = $1`,
      [event.id],
    ),
    one<{ n: number }>(db, `SELECT count(*)::int AS n FROM sms_outbox WHERE zone_id = $1 AND created_at BETWEEN $2 AND $3`, [event.zone_id, event.started_at, end]),
    db.query(
      `SELECT source, count(*)::int AS n, max(level_pct) AS max_pct FROM flood_signals WHERE zone_id = $1 AND created_at BETWEEN $2 AND $3 GROUP BY source ORDER BY source`,
      [event.zone_id, from, end],
    ),
  ]);
  return {
    event: { ...event, township_id: undefined },
    durationMin: minutesBetween(event.started_at, end),
    warningLeadMin: event.first_danger_at ? minutesBetween(event.first_warning_at, event.first_danger_at) : null,
    timeline,
    messages,
    checkins: { ...checkins, ratePct: checkins.residents ? Math.round(((checkins.safe + checkins.need_help) / checkins.residents) * 100) : null, within30Pct: checkins.residents ? Math.round((checkins.within_30 / checkins.residents) * 100) : null },
    help: help!,
    smsSimulated: sms!.n,
    signals,
  };
}

/** The false-alarm review, after the all clear. Every review is in the audit trail. */
export async function reviewEvent(db: Db, actor: Actor, eventId: string, input: { falseAlarm: boolean; note: string }, now: Date) {
  return db.tx(async (tx) => {
    const event = await loadEvent(tx, actor, eventId);
    if (!event.ended_at) throw ruleViolation('EVENT_OPEN', 'Review an event after its all clear.');
    await tx.query('UPDATE flood_events SET false_alarm = $2, review_note = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1', [event.id, input.falseAlarm, input.note, actor.id, now]);
    await audit(tx, actor.id, 'FLOOD_EVENT_REVIEWED', 'flood_zone', event.zone_id, { eventId: event.id, falseAlarm: input.falseAlarm, before: event.false_alarm });
    return { id: event.id, falseAlarm: input.falseAlarm };
  });
}

// --- Priority help (tab 4) --------------------------------------------------------------

type HelpRow = HomeAddress & { user_id: string; full_name: string; phone: string | null; priority_note: string | null; priority: boolean; checked_in: 'SAFE' | 'NEED_HELP' | null };

/**
 * While a zone has an open event: the residents who asked to be reached first
 * (Akses+, with consent) and anyone who said "I need help", each with their task.
 * Duty staff only (BR32).
 */
export async function helpBoard(db: Db, actor: Actor) {
  const events = await db.query<{ id: string; zone_id: string; zone_name: string; started_at: Date; peak_status: FloodStatus }>(
    `SELECT e.id, e.zone_id, z.name AS zone_name, e.started_at, e.peak_status FROM flood_events e JOIN flood_zones z ON z.id = e.zone_id
      WHERE e.ended_at IS NULL AND ($1::uuid IS NULL OR z.township_id = $1) ORDER BY (e.peak_status = 'DANGER') DESC, e.started_at`,
    [actor.townshipId],
  );
  const result = [];
  for (const e of events) {
    const people = await db.query<HelpRow>(
      `SELECT u.id AS user_id, u.full_name, u.phone, p.priority_note, coalesce(p.priority_help, false) AS priority, ${HOME_ADDRESS_COLUMNS},
              (SELECT c.status FROM flood_checkins c JOIN flood_alerts a ON a.id = c.alert_id WHERE a.event_id = $2 AND c.user_id = u.id ORDER BY c.created_at DESC LIMIT 1) AS checked_in
         FROM users u JOIN homes h ON h.id = u.home_id LEFT JOIN access_profiles p ON p.user_id = u.id
        WHERE h.zone_id = $1 AND u.status = 'ACTIVE'
          AND (p.priority_help OR EXISTS (SELECT 1 FROM flood_checkins c JOIN flood_alerts a ON a.id = c.alert_id WHERE a.event_id = $2 AND c.user_id = u.id AND c.status = 'NEED_HELP'))
        ORDER BY (SELECT c.status FROM flood_checkins c JOIN flood_alerts a ON a.id = c.alert_id WHERE a.event_id = $2 AND c.user_id = u.id ORDER BY c.created_at DESC LIMIT 1) = 'NEED_HELP' DESC NULLS LAST,
                 h.street, h.house_no`,
      [e.zone_id, e.id],
    );
    const tasks = await db.query<{ id: string; user_id: string; status: 'ASSIGNED' | 'REACHED'; assignee: string; assigned_to: string; created_at: Date; reached_at: Date | null; note: string | null }>(
      `SELECT t.id, t.user_id, t.status, t.assigned_to, u.full_name AS assignee, t.created_at, t.reached_at, t.note FROM flood_help_tasks t JOIN users u ON u.id = t.assigned_to WHERE t.event_id = $1`,
      [e.id],
    );
    result.push({
      ...e,
      people: people.map(({ property_type, house_no, building, street, precinct, postcode, city, state, ...p }) => ({
        ...p,
        address: formatAddress({ property_type, house_no, building, street, precinct, postcode, city, state }),
        task: tasks.find((t) => t.user_id === p.user_id) ?? null,
      })),
    });
  }
  const responders = await db.query(
    `SELECT id, full_name, role FROM users WHERE role IN ('GUARD', 'TOWNSHIP_STAFF') AND status = 'ACTIVE' AND ($1::uuid IS NULL OR township_id = $1) ORDER BY role, full_name`,
    [actor.townshipId],
  );
  return { events: result, responders };
}

/** Duty staff send a guard (or a staff member) to reach a resident. Reassigning is allowed until they are reached. */
export async function assignHelpTask(db: Db, actor: Actor, input: { eventId: string; userId: string; assignedTo: string; note?: string }, now: Date) {
  return db.tx(async (tx) => {
    const event = await loadEvent(tx, actor, input.eventId);
    if (event.ended_at) throw ruleViolation('EVENT_ENDED', 'This flood event has ended.');
    const person = await one<HomeAddress & { full_name: string; priority: boolean; need_help: boolean }>(
      tx,
      `SELECT u.full_name, coalesce(p.priority_help, false) AS priority, ${HOME_ADDRESS_COLUMNS},
              EXISTS (SELECT 1 FROM flood_checkins c JOIN flood_alerts a ON a.id = c.alert_id WHERE a.event_id = $3 AND c.user_id = u.id AND c.status = 'NEED_HELP') AS need_help
         FROM users u JOIN homes h ON h.id = u.home_id LEFT JOIN access_profiles p ON p.user_id = u.id WHERE u.id = $1 AND h.zone_id = $2 AND u.status = 'ACTIVE'`,
      [input.userId, event.zone_id, event.id],
    );
    if (!person || !(person.priority || person.need_help)) throw notFound('Resident on the help list');
    const responder = await one<{ id: string }>(
      tx,
      `SELECT id FROM users WHERE id = $1 AND township_id = $2 AND role IN ('GUARD', 'TOWNSHIP_STAFF') AND status = 'ACTIVE'`,
      [input.assignedTo, event.township_id],
    );
    if (!responder) throw notFound('Guard');
    const reached = await one(tx, `SELECT 1 FROM flood_help_tasks WHERE event_id = $1 AND user_id = $2 AND status = 'REACHED'`, [event.id, input.userId]);
    if (reached) throw ruleViolation('ALREADY_REACHED', 'This resident has already been reached.');
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO flood_help_tasks (event_id, user_id, reason, assigned_to, assigned_by, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id, user_id) DO UPDATE SET assigned_to = EXCLUDED.assigned_to, assigned_by = EXCLUDED.assigned_by, note = EXCLUDED.note RETURNING id`,
      [event.id, input.userId, person.need_help ? 'NEED_HELP' : 'PRIORITY', input.assignedTo, actor.id, input.note ?? null, now],
    );
    const address = formatAddress(person);
    await notify(tx, [input.assignedTo], { priority: 'URGENT', title: `Flood help: reach ${person.full_name}`, body: `${address}. ${input.note ?? 'Check they are safe and help them to the assembly point.'}`, link: '/guard' });
    await audit(tx, actor.id, 'FLOOD_HELP_ASSIGNED', 'flood_zone', event.zone_id, { eventId: event.id, taskId: row!.id, assignedTo: input.assignedTo });
    return { id: row!.id };
  });
}

/** The guard (or duty staff) marks a resident reached. */
export async function markReached(db: Db, actor: Actor, taskId: string, now: Date) {
  return db.tx(async (tx) => {
    const task = await one<{ id: string; status: string; assigned_to: string; township_id: string; zone_id: string; event_id: string }>(
      tx,
      `SELECT t.id, t.status, t.assigned_to, z.township_id, z.id AS zone_id, t.event_id FROM flood_help_tasks t JOIN flood_events e ON e.id = t.event_id JOIN flood_zones z ON z.id = e.zone_id
        WHERE t.id = $1 FOR UPDATE OF t`,
      [taskId],
    );
    if (!task) throw notFound('Task');
    assertTownshipAccess(actor, task.township_id);
    if (actor.role === 'GUARD' && task.assigned_to !== actor.id) throw forbidden('This task is assigned to someone else.');
    if (task.status === 'REACHED') return { id: task.id, status: 'REACHED' };
    await tx.query(`UPDATE flood_help_tasks SET status = 'REACHED', reached_at = $2, reached_by = $3 WHERE id = $1`, [task.id, now, actor.id]);
    await audit(tx, actor.id, 'FLOOD_HELP_REACHED', 'flood_zone', task.zone_id, { eventId: task.event_id, taskId: task.id });
    return { id: task.id, status: 'REACHED' };
  });
}

/** The guard's own open help tasks, for the gate screen. */
export async function myHelpTasks(q: Queryable, actor: Actor) {
  const rows = await q.query<HomeAddress & { id: string; full_name: string; phone: string | null; note: string | null; reason: string; zone_name: string; priority_note: string | null; created_at: Date }>(
    `SELECT t.id, u.full_name, u.phone, t.note, t.reason, z.name AS zone_name, p.priority_note, t.created_at, ${HOME_ADDRESS_COLUMNS}
       FROM flood_help_tasks t JOIN flood_events e ON e.id = t.event_id JOIN flood_zones z ON z.id = e.zone_id
       JOIN users u ON u.id = t.user_id JOIN homes h ON h.id = u.home_id LEFT JOIN access_profiles p ON p.user_id = u.id
      WHERE t.assigned_to = $1 AND t.status = 'ASSIGNED' AND e.ended_at IS NULL ORDER BY t.created_at`,
    [actor.id],
  );
  return rows.map(({ property_type, house_no, building, street, precinct, postcode, city, state, ...t }) => ({
    ...t,
    address: formatAddress({ property_type, house_no, building, street, precinct, postcode, city, state }),
  }));
}

// --- History and Insights -------------------------------------------------------------------

/** A zone's water level over the last hours, as the highest reading in each 10-minute step. */
export async function zoneHistory(db: Db, actor: Actor, zoneId: string, now: Date, hours = 6) {
  const zone = await one<{ township_id: string }>(db, 'SELECT township_id FROM flood_zones WHERE id = $1', [zoneId]);
  if (!zone || (actor.role !== 'HQ_ADMIN' && actor.townshipId !== zone.township_id)) throw notFound('Zone');
  const points = await db.query<{ at: Date; pct: number }>(
    `SELECT to_timestamp(floor(extract(epoch FROM created_at) / 600) * 600) AS at, max(level_pct)::int AS pct
       FROM flood_readings WHERE zone_id = $1 AND created_at > $2::timestamptz - make_interval(hours => $3) AND created_at <= $2
      GROUP BY 1 ORDER BY 1`,
    [zoneId, now, hours],
  );
  return { zoneId, hours, points };
}

/**
 * The Insights tiles from Appendix E.3: warning lead time, false-alarm rate, check-in
 * rate within 30 minutes, time to reach priority residents and sensor uptime.
 * Events of the last 90 days; uptime over the last 24 hours.
 */
export async function floodInsights(db: Db, townshipId: string | null, now: Date) {
  const events = await db.query<{ id: string; zone_id: string; started_at: Date; first_warning_at: Date | null; first_danger_at: Date | null; false_alarm: boolean | null }>(
    `SELECT e.id, e.zone_id, e.started_at, e.first_warning_at, e.first_danger_at, e.false_alarm FROM flood_events e JOIN flood_zones z ON z.id = e.zone_id
      WHERE ($1::uuid IS NULL OR z.township_id = $1) AND e.started_at > $2::timestamptz - interval '90 days' AND e.started_at <= $2`,
    [townshipId, now],
  );
  const leads = events.filter((e) => e.first_danger_at).map((e) => minutesBetween(e.first_warning_at, e.first_danger_at)!);
  const reviewed = events.filter((e) => e.false_alarm !== null);
  const rates: number[] = [];
  for (const e of events) {
    const c = await eventCheckins(db, e.id, e.zone_id, e.started_at);
    if (c.residents) rates.push((c.within_30 / c.residents) * 100);
  }
  const [reach, sensors] = await Promise.all([
    one<{ avg_min: number | null }>(
      db,
      `SELECT round(avg(extract(epoch FROM t.reached_at - e.started_at) / 60)::numeric, 1)::float AS avg_min
         FROM flood_help_tasks t JOIN flood_events e ON e.id = t.event_id JOIN flood_zones z ON z.id = e.zone_id
        WHERE t.status = 'REACHED' AND t.reason = 'PRIORITY' AND ($1::uuid IS NULL OR z.township_id = $1) AND e.started_at > $2::timestamptz - interval '90 days'`,
      [townshipId, now],
    ),
    one<{ sensors: number; faulty: number; uptime_pct: number | null }>(
      db,
      `SELECT count(*)::int AS sensors, count(*) FILTER (WHERE s.health = 'FAULTY')::int AS faulty, round(avg(${uptimeSql('s.id', '$2')}))::int AS uptime_pct
         FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id WHERE s.status = 'ACTIVE' AND ($1::uuid IS NULL OR z.township_id = $1)`,
      [townshipId, now],
    ),
  ]);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    events: events.length,
    warningLeadMin: avg(leads),
    falseAlarmPct: reviewed.length ? Math.round((reviewed.filter((e) => e.false_alarm).length / reviewed.length) * 100) : null,
    reviewed: reviewed.length,
    checkin30Pct: avg(rates),
    reachPriorityMin: reach?.avg_min ?? null,
    sensors: sensors!.sensors,
    faultySensors: sensors!.faulty,
    sensorUptimePct: sensors!.uptime_pct,
  };
}
