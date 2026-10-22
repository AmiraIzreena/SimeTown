import { CAMERA_MIN_CONFIDENCE, type FloodSource, type FloodStatus, type FloodTestPictureId, type WarningSource } from '@/shared/domain';
import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings, type Settings } from '../settings';
import { queueSms } from '../sms';
import { closeEvent, eventForAlert, notePeak, notePeopleWarned } from './events';
import { checkSilentSensors, simulatedHeartbeat, simulateZoneLevel } from './sensors';
import { photoReader, readPhoto, readTestPicture } from './camera-reader';
import { trendEstimate } from './trend';
import { getConfig } from '../../config';
import type { Photo } from '../../ai/classifier';

/**
 * The Banjir agent (proposal 6.5, BR28). Fixed rules on numbers decide the
 * flood level; the "AI" only reads pictures and fills in the message. A wrong
 * guess by the AI can therefore neither create nor hide an emergency.
 *
 *   Warning, two signals agree   → sent at once; the duty officer can edit or cancel
 *   Warning, one signal          → drafted; the officer confirms (5 minutes)
 *   Danger, two signals agree    → sent at once with the safe route; the officer is informed
 *   Danger, one signal           → drafted with a 3-minute window; if nobody answers and the
 *                                  water is still rising, it is sent
 *   Two signals agree it is safe → all clear
 *
 * Every message follows the Calm Alert Flow: what is happening, where, what to
 * do now, and when the next update comes. An update goes out every 15 minutes
 * while an alert is open, even when nothing has changed.
 *
 * Real sensors (Appendix E.2) add four rules to how a zone's sensors are read:
 *   5 Rate of rise    a climb of more than X cm in 10 minutes is a warning signal, even below 75%
 *   6 Sensor health   a faulty sensor (silent, stuck, low battery) cannot count as a signal
 *   7 Debounce        a level must hold for 2 readings in a row to trigger, and the zone is
 *                     clear only once every sensor has stayed below 60% for 30 minutes
 *   8 Independence    all the sensors in a zone are one signal: a second signal must be of
 *                     another type (camera, rain gauge or residents' reports)
 */

export const SIGNAL_FRESH_MS = 10 * 60_000;
const REPORT_FRESH_MS = 30 * 60_000;
const HEAVY_RAIN_MM_HR = 30;
const UPDATE_EVERY_MS = 15 * 60_000;
const WARNING_CONFIRM_MS = 5 * 60_000;
const DANGER_CONFIRM_MS = 3 * 60_000;
const RISE_WINDOW_MS = 10 * 60_000;
export const CLEAR_PCT = 60;
const CLEAR_HOLD_MS = 30 * 60_000;
const SILENT_MS = 5 * 60_000;

const RANK: Record<FloodStatus, number> = { NORMAL: 0, WARNING: 1, DANGER: 2 };
const higher = (a: FloodStatus, b: FloodStatus) => (RANK[a] >= RANK[b] ? a : b);
export const levelOf = (pct: number, s: Pick<Settings, 'flood_warning_pct' | 'flood_danger_pct'>): FloodStatus =>
  pct >= s.flood_danger_pct ? 'DANGER' : pct >= s.flood_warning_pct ? 'WARNING' : 'NORMAL';

export interface SourceReading {
  source: FloodSource;
  level: FloodStatus;
  levelPct: number | null;
  rainMmHr: number | null;
  confidence: number | null;
  trusted: boolean;
  at: Date;
  note: string;
}

/** One sensor as the agent read it this time. */
export interface SensorView {
  id: string | null;
  code: string | null;
  levelPct: number;
  level: FloodStatus;
  faulty: boolean;
  /** Only one fresh reading above normal: it must hold for a second before it counts (rule 7). */
  pending: boolean;
  /** The climb over the last 10 minutes, in cm, when the sensor reports in cm. */
  riseCm: number | null;
  risingFast: boolean;
  at: Date;
}

export interface Assessment {
  readings: SourceReading[];
  /** The highest level at least two independent sources support. */
  agreed: FloodStatus;
  /** The highest level any one trusted source shows. */
  single: FloodStatus;
  /** Two sources say the water is back below the warning line. */
  safeAgreed: boolean;
  rising: boolean;
  levelPct: number | null;
  /** Some healthy sensor is climbing faster than its rate-of-rise threshold (rule 5). */
  risingFast: boolean;
  sensors: SensorView[];
  /** The newest reading from a healthy sensor: the "last verified" time residents see. */
  lastVerifiedAt: Date | null;
}

/**
 * The zone's sensors, read as one signal (rules 5 to 8). Readings from a faulty or
 * silent sensor are left out; what is left is debounced, checked for a fast rise
 * and tested for the 30-minute all-clear hold.
 */
async function sensorSignal(q: Queryable, zoneId: string, now: Date, s: Settings) {
  const [rows, registered] = await Promise.all([
    q.query<{ sensor_id: string | null; level_pct: number; level_cm: number | null; created_at: Date }>(
      `SELECT sensor_id, level_pct, level_cm, created_at FROM flood_signals
        WHERE zone_id = $1 AND source = 'SENSOR' AND created_at <= $2 AND created_at > $2::timestamptz - make_interval(secs => $3::double precision)
        ORDER BY created_at DESC, id DESC`,
      [zoneId, now, CLEAR_HOLD_MS / 1000],
    ),
    q.query<{ id: string; code: string; health: string; last_seen_at: Date | null; rise_cm_10min: number; status: string }>(
      'SELECT id, code, health, last_seen_at, rise_cm_10min, status FROM flood_sensors WHERE zone_id = $1',
      [zoneId],
    ),
  ]);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.sensor_id ?? 'unregistered', [...(groups.get(r.sensor_id ?? 'unregistered') ?? []), r]);

  const views: (SensorView & { clear: boolean; rising: boolean })[] = [];
  for (const [key, series] of groups) {
    const meta = registered.find((m) => m.id === key);
    if (key !== 'unregistered' && (!meta || meta.status !== 'ACTIVE')) continue;
    const fresh = series.filter((r) => now.getTime() - r.created_at.getTime() <= SIGNAL_FRESH_MS);
    if (fresh.length === 0) continue;
    const faulty = Boolean(meta && (meta.health === 'FAULTY' || !meta.last_seen_at || now.getTime() - meta.last_seen_at.getTime() > SILENT_MS));
    const latest = fresh[0]!;
    // Rule 7: the level that held for the last two readings.
    const held = fresh.length >= 2 ? levelOf(Math.min(latest.level_pct, fresh[1]!.level_pct), s) : 'NORMAL';
    const pending = fresh.length === 1 && levelOf(latest.level_pct, s) !== 'NORMAL';
    // Rule 5: the climb over the last 10 minutes.
    const recent = fresh.filter((r) => r.level_cm !== null && now.getTime() - r.created_at.getTime() <= RISE_WINDOW_MS);
    const riseCm = meta && recent.length >= 2 && latest.level_cm !== null ? Math.round((latest.level_cm - Math.min(...recent.map((r) => r.level_cm!))) * 10) / 10 : null;
    const risingFast = Boolean(meta && riseCm !== null && riseCm > meta.rise_cm_10min);
    views.push({
      id: meta?.id ?? null,
      code: meta?.code ?? null,
      levelPct: latest.level_pct,
      level: risingFast ? higher(held, 'WARNING') : held,
      faulty,
      pending,
      riseCm,
      risingFast,
      at: latest.created_at,
      // Rule 7: clear only when nothing in the last 30 minutes reached 60%.
      clear: series.every((r) => r.level_pct < CLEAR_PCT),
      rising: fresh.length >= 2 ? latest.level_pct >= fresh[1]!.level_pct : true,
    });
  }
  if (views.length === 0) return null;
  const healthy = views.filter((v) => !v.faulty);
  const sensors: SensorView[] = views.map((v) => ({ id: v.id, code: v.code, levelPct: v.levelPct, level: v.level, faulty: v.faulty, pending: v.pending, riseCm: v.riseCm, risingFast: v.risingFast, at: v.at }));
  if (healthy.length === 0) {
    const latest = views.reduce((a, b) => (a.at > b.at ? a : b));
    const reading: SourceReading = {
      source: 'SENSOR', level: 'NORMAL', levelPct: latest.levelPct, rainMmHr: null, confidence: null, trusted: false, at: latest.at,
      note: views.length === 1 ? 'Sensor faulty: not counted' : 'Every sensor is faulty: not counted',
    };
    return { reading, clear: false, rising: false, risingFast: false, sensors, lastVerifiedAt: null };
  }
  // Rule 8: however many sensors there are, the zone's sensors are one signal, led by the highest.
  const top = healthy.reduce((a, b) => (RANK[b.level] > RANK[a.level] || (RANK[b.level] === RANK[a.level] && b.levelPct > a.levelPct) ? b : a));
  const notes = [`${top.levelPct}% in the drain`];
  if (top.pending) notes.push('Waiting for a second reading');
  if (top.risingFast) notes.push(`Rising ${top.riseCm} cm in 10 minutes`);
  if (healthy.length > 1) notes.push(`${healthy.length} sensors, counted as one signal`);
  if (healthy.length < views.length) notes.push(`${views.length - healthy.length} faulty, not counted`);
  const reading: SourceReading = { source: 'SENSOR', level: top.level, levelPct: top.levelPct, rainMmHr: null, confidence: null, trusted: true, at: top.at, note: notes.join(' · ') };
  return {
    reading,
    clear: healthy.every((v) => v.clear),
    rising: top.rising,
    risingFast: healthy.some((v) => v.risingFast),
    sensors,
    lastVerifiedAt: healthy.reduce((a, b) => (a.at > b.at ? a : b)).at,
  };
}

/** What each source says right now. Only fresh, trusted readings count. */
export async function assessZone(q: Queryable, zoneId: string, now: Date, s: Settings): Promise<Assessment> {
  const rows = await q.query<{ source: Exclude<FloodSource, 'SENSOR'>; level_pct: number | null; rain_mm_hr: number | null; confidence: number | null; created_at: Date; reports: number }>(
    `SELECT DISTINCT ON (source) source, level_pct, rain_mm_hr, confidence, created_at,
            (SELECT count(*)::int FROM flood_signals r WHERE r.zone_id = $1 AND r.source = 'REPORT' AND r.created_at <= $2 AND r.created_at > $2::timestamptz - make_interval(secs => $4::double precision)) AS reports
       FROM flood_signals
      WHERE zone_id = $1 AND source <> 'SENSOR' AND created_at <= $2
        AND created_at > $2::timestamptz - make_interval(secs => CASE WHEN source = 'REPORT' THEN $4::double precision ELSE $3::double precision END)
      ORDER BY source, created_at DESC`,
    [zoneId, now, SIGNAL_FRESH_MS / 1000, REPORT_FRESH_MS / 1000],
  );
  const sensor = await sensorSignal(q, zoneId, now, s);
  const readings: SourceReading[] = rows.map((r) => {
    switch (r.source) {
      case 'CAMERA': {
        const trusted = (r.confidence ?? 0) >= CAMERA_MIN_CONFIDENCE;
        return {
          source: r.source, level: trusted ? levelOf(r.level_pct!, s) : 'NORMAL', levelPct: r.level_pct, rainMmHr: null, confidence: r.confidence, trusted, at: r.created_at,
          note: trusted ? `${r.level_pct}% on the measuring post` : `Picture unclear (confidence ${Math.round((r.confidence ?? 0) * 100)}%): not counted`,
        };
      }
      case 'RAIN': {
        const heavy = (r.rain_mm_hr ?? 0) >= HEAVY_RAIN_MM_HR;
        // Rain can support a warning, never declare danger on its own.
        return { source: r.source, level: heavy ? 'WARNING' : 'NORMAL', levelPct: null, rainMmHr: r.rain_mm_hr, confidence: null, trusted: true, at: r.created_at, note: `${r.rain_mm_hr} mm an hour${heavy ? ' (heavy)' : ''}` };
      }
      case 'REPORT':
        return { source: r.source, level: 'WARNING', levelPct: null, rainMmHr: null, confidence: null, trusted: true, at: r.created_at, note: `${r.reports} resident report${r.reports === 1 ? '' : 's'} of water` };
    }
  });
  if (sensor) readings.unshift(sensor.reading);
  // One reading per source type, so two signals that agree are always of two different types (rule 8).
  const trusted = readings.filter((r) => r.trusted);
  const support = (level: FloodStatus) => trusted.filter((r) => RANK[r.level] >= RANK[level]).length;
  const agreed: FloodStatus = support('DANGER') >= 2 ? 'DANGER' : support('WARNING') >= 2 ? 'WARNING' : 'NORMAL';
  const single = trusted.reduce<FloodStatus>((max, r) => higher(max, r.level), 'NORMAL');
  // "Safe" needs the two water-level sources: the sensors held below 60% for 30 minutes (rule 7), and the camera agreeing.
  const camera = trusted.find((r) => r.source === 'CAMERA');
  const safeAgreed = Boolean(sensor?.reading.trusted && sensor.clear && camera && camera.levelPct !== null && camera.levelPct < CLEAR_PCT);
  const rising = sensor?.rising ?? false;
  const levelPct = sensor?.reading.trusted ? sensor.reading.levelPct : (camera?.levelPct ?? sensor?.reading.levelPct ?? null);
  return { readings, agreed, single, safeAgreed, rising, levelPct, risingFast: sensor?.risingFast ?? false, sensors: sensor?.sensors ?? [], lastVerifiedAt: sensor?.lastVerifiedAt ?? null };
}

async function log(q: Queryable, zoneId: string, now: Date, step: string, detail: Record<string, unknown> = {}, actorId: string | null = null) {
  await q.query('INSERT INTO flood_agent_log (zone_id, at, step, detail, actor_user_id) VALUES ($1, $2, $3, $4::jsonb, $5)', [zoneId, now, step, JSON.stringify(detail), actorId]);
}

interface ZoneRow {
  id: string;
  name: string;
  township_id: string;
  status: FloodStatus;
  level_pct: number;
  safe_route: string;
  assembly_point: string;
}

const timeIn = (date: Date, tz: string) => date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** The four lines of every message (proposal 6.5, "Guide"). Fixed templates; nothing here is generated freely. */
export function composeMessage(zone: Pick<ZoneRow, 'name' | 'safe_route' | 'assembly_point'>, level: FloodStatus, kind: 'ALERT' | 'UPDATE' | 'ALL_CLEAR', pct: number | null, streets: string[], next: Date | null, tz: string) {
  const where = `${zone.name}${streets.length ? `: ${streets.join(', ')}` : ''}`;
  const water = pct === null ? '' : ` Water is at ${pct}%.`;
  if (kind === 'ALL_CLEAR') {
    return { what: `All clear in ${zone.name}. The water is back to normal.`, where, todo: 'You can return home. Report any damage or blocked drains in Lapor.', nextUpdate: null };
  }
  const what =
    level === 'DANGER'
      ? `${kind === 'UPDATE' ? 'Update: flood danger continues' : 'Flood danger'} in ${zone.name}.${water}`
      : `${kind === 'UPDATE' ? 'Update: flood warning continues' : 'Flood warning'} in ${zone.name}.${water}`;
  const todo =
    level === 'DANGER'
      ? `Leave now by the safe route: ${zone.safe_route} Go to ${zone.assembly_point}. Tap “I’m safe” when you are.`
      : 'Get ready to move: charge your phone, move valuables up, and check on neighbours who may need help.';
  return { what, where, todo, nextUpdate: next ? `Next update by ${timeIn(next, tz)}.` : null };
}

/**
 * Sends a level for a zone: opens, changes or closes its alert, records the
 * official message and tells the right people. Only affected streets get the
 * loud alert; neighbouring zones get a quiet heads-up (proposal 6.5, "Target").
 */
export async function sendLevel(
  tx: Queryable,
  zone: ZoneRow,
  input: { level: FloodStatus; levelPct: number | null; decision: 'TWO_SIGNALS' | 'ONE_SIGNAL' | 'ESCALATED' | 'OFFICER'; signals: unknown; actorId: string | null; draftId?: string; edits?: { what?: string; todo?: string } },
  now: Date,
): Promise<{ messageId: string }> {
  const s = await getSettings(tx);
  const kind = input.level === 'NORMAL' ? 'ALL_CLEAR' : 'ALERT';
  const next = kind === 'ALL_CLEAR' ? null : new Date(now.getTime() + UPDATE_EVERY_MS);
  const streets = (await tx.query<{ street: string }>('SELECT DISTINCT street FROM homes WHERE zone_id = $1 ORDER BY street LIMIT 6', [zone.id])).map((r) => r.street);
  const text = composeMessage(zone, input.level, kind, input.levelPct, streets, next, s.timezone);
  const what = input.edits?.what ?? text.what;
  const todo = input.edits?.todo ?? text.todo;

  await tx.query('UPDATE flood_alerts SET ended_at = $2 WHERE zone_id = $1 AND ended_at IS NULL', [zone.id, now]);
  // Every alert belongs to the zone's flood event, which the all clear closes (Appendix E.2, rule 10).
  let eventId: string | null = null;
  if (input.level !== 'NORMAL') {
    eventId = await eventForAlert(tx, zone.id, input.level, input.levelPct, now);
    await tx.query('INSERT INTO flood_alerts (zone_id, level, started_at, next_update_at, event_id) VALUES ($1, $2, $3, $4, $5)', [zone.id, input.level, now, next, eventId]);
  } else {
    await closeEvent(tx, zone.id, now);
  }
  await tx.query('UPDATE flood_zones SET status = $2, level_pct = coalesce($3, level_pct), updated_at = $4 WHERE id = $1', [zone.id, input.level, input.levelPct, now]);

  let messageId: string;
  if (input.draftId) {
    await tx.query(
      `UPDATE flood_messages SET status = 'SENT', sent_at = $2, decided_by = $3, what = $4, todo = $5, next_update_at = $6, decision = $7 WHERE id = $1`,
      [input.draftId, now, input.actorId, what, todo, next, input.decision],
    );
    messageId = input.draftId;
  } else {
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO flood_messages (zone_id, level, kind, what, where_text, todo, next_update_at, status, decision, signals, created_at, sent_at, decided_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'SENT', $8, $9::jsonb, $10, $10, $11) RETURNING id`,
      [zone.id, input.level, kind, what, text.where, todo, next, input.decision, JSON.stringify(input.signals ?? []), now, input.actorId],
    );
    messageId = row!.id;
  }

  const residents = await tx.query<{ id: string }>(`SELECT u.id FROM users u JOIN homes h ON h.id = u.home_id WHERE h.zone_id = $1 AND u.status = 'ACTIVE'`, [zone.id]);
  const responders = await tx.query<{ id: string }>(
    `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'GUARD') AND status = 'ACTIVE'`,
    [zone.township_id],
  );
  // Carers who look after someone in the zone hear about it too (Akses+).
  const carers = await tx.query<{ id: string }>(
    `SELECT DISTINCT c.carer_id AS id FROM carer_links c JOIN users u ON u.id = c.resident_id JOIN homes h ON h.id = u.home_id
      WHERE h.zone_id = $1 AND c.status = 'ACTIVE'`,
    [zone.id],
  );
  const everyone = [...new Set([...residents, ...responders, ...carers].map((u) => u.id))];
  if (eventId) await notePeopleWarned(tx, eventId, everyone.length);
  const body = [what, todo, text.nextUpdate].filter(Boolean).join(' ');
  if (input.level === 'DANGER') {
    await notify(tx, everyone, { priority: 'URGENT', title: `Flood danger in ${zone.name}`, body, link: '/app/banjir' });
    // BR19: danger also goes by SMS, so people without the app open are reached.
    const texted = await queueSms(tx, everyone, { body: `${what} ${todo}`, reason: 'FLOOD_DANGER', zoneId: zone.id }, now);
    await log(tx, zone.id, now, 'SMS_QUEUED', { people: texted, simulated: true });
    const neighbours = await tx.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN homes h ON h.id = u.home_id JOIN flood_zones z ON z.id = h.zone_id
        WHERE z.township_id = $1 AND z.id <> $2 AND u.status = 'ACTIVE'`,
      [zone.township_id, zone.id],
    );
    await notify(tx, neighbours.map((u) => u.id), { title: `Heads-up: flood danger in ${zone.name}`, body: 'Your area is not affected. Avoid the area and keep roads clear.', link: '/app/banjir' });
  } else if (input.level === 'WARNING') {
    await notify(tx, everyone, { title: `Flood warning in ${zone.name}`, body, link: '/app/banjir' });
  } else {
    await notify(tx, everyone, { title: `All clear in ${zone.name}`, body, link: '/app/banjir' });
  }
  await log(tx, zone.id, now, kind === 'ALL_CLEAR' ? 'ALL_CLEAR_SENT' : 'ALERT_SENT', { level: input.level, decision: input.decision, people: everyone.length }, input.actorId);
  await audit(tx, input.actorId, 'FLOOD_STATUS', 'flood_zone', zone.id, { from: zone.status, to: input.level, levelPct: input.levelPct, decision: input.decision });
  return { messageId };
}

async function lockZone(tx: Queryable, zoneId: string): Promise<ZoneRow> {
  const zone = await one<ZoneRow>(tx, 'SELECT id, name, township_id, status, level_pct, safe_route, assembly_point FROM flood_zones WHERE id = $1 FOR UPDATE', [zoneId]);
  if (!zone) throw notFound('Zone');
  return zone;
}

/**
 * The agent looks at a zone after every new signal. It acts at once only when
 * two independent signals agree; with one signal it drafts and waits for a person.
 */
export async function evaluateZone(tx: Queryable, zoneId: string, now: Date): Promise<Assessment> {
  const s = await getSettings(tx);
  const zone = await lockZone(tx, zoneId);
  const a = await assessZone(tx, zoneId, now, s);
  const signals = a.readings.map((r) => ({ source: r.source, level: r.level, trusted: r.trusted, note: r.note }));
  await log(tx, zoneId, now, 'ASSESSED', { agreed: a.agreed, single: a.single, rising: a.rising, signals });
  let draft = await one<{ id: string; level: FloodStatus }>(tx, `SELECT id, level FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT' FOR UPDATE`, [zoneId]);

  if (RANK[a.agreed] > RANK[zone.status]) {
    // A draft at or below the agreed level is now covered by the alert; a higher one (one signal says
    // danger, two agree on warning) still waits for the officer.
    if (draft && RANK[draft.level] <= RANK[a.agreed]) {
      await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [draft.id]);
      draft = undefined;
    }
    await sendLevel(tx, zone, { level: a.agreed, levelPct: a.levelPct, decision: 'TWO_SIGNALS', signals, actorId: null }, now);
    zone.status = a.agreed;
    if (RANK[a.single] <= RANK[a.agreed]) return a;
  }
  else if (zone.status !== 'NORMAL' && a.safeAgreed) {
    if (draft) await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [draft.id]);
    await sendLevel(tx, zone, { level: 'NORMAL', levelPct: a.levelPct, decision: 'TWO_SIGNALS', signals, actorId: null }, now);
    return a;
  }
  if (a.agreed !== 'NORMAL' && RANK[a.agreed] < RANK[zone.status] && RANK[a.single] < RANK[zone.status]) {
    // Both water-level sources now agree on a lower level: step down openly.
    await sendLevel(tx, zone, { level: a.agreed, levelPct: a.levelPct, decision: 'TWO_SIGNALS', signals, actorId: null }, now);
    return a;
  }
  if (a.levelPct !== null) {
    await tx.query('UPDATE flood_zones SET level_pct = $2, updated_at = $3 WHERE id = $1', [zoneId, a.levelPct, now]);
    await notePeak(tx, zoneId, a.levelPct);
  }

  if (RANK[a.single] > RANK[zone.status]) {
    if (draft && RANK[draft.level] >= RANK[a.single]) return a; // already waiting for the officer
    if (draft) await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [draft.id]);
    const streets = (await tx.query<{ street: string }>('SELECT DISTINCT street FROM homes WHERE zone_id = $1 ORDER BY street LIMIT 6', [zoneId])).map((r) => r.street);
    const text = composeMessage(zone, a.single, 'ALERT', a.levelPct, streets, new Date(now.getTime() + UPDATE_EVERY_MS), s.timezone);
    const deadline = new Date(now.getTime() + (a.single === 'DANGER' ? DANGER_CONFIRM_MS : WARNING_CONFIRM_MS));
    await tx.query(
      `INSERT INTO flood_messages (zone_id, level, kind, what, where_text, todo, status, decision, signals, deadline_at, created_at)
       VALUES ($1, $2, 'ALERT', $3, $4, $5, 'DRAFT', 'ONE_SIGNAL', $6::jsonb, $7, $8)`,
      [zoneId, a.single, text.what, text.where, text.todo, JSON.stringify(signals), deadline, now],
    );
    const officers = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`, [zone.township_id]);
    await notify(tx, officers.map((o) => o.id), {
      priority: 'URGENT',
      title: `Confirm a flood ${a.single === 'DANGER' ? 'danger' : 'warning'} for ${zone.name}`,
      body: `Only one signal so far. ${a.single === 'DANGER' ? 'If nobody answers within 3 minutes and the water is still rising, it is sent.' : 'Please confirm within 5 minutes.'}`,
      link: '/console/banjir',
    });
    await log(tx, zoneId, now, 'DRAFTED', { level: a.single, deadline });
  } else if (draft && RANK[a.single] <= RANK[zone.status]) {
    await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [draft.id]);
    await log(tx, zoneId, now, 'DRAFT_DROPPED', { reason: 'The signal fell back.' });
  }
  return a;
}

/** A new signal from a sensor, a camera reading, the rain gauge or a resident's report, then the agent's look. */
export async function addSignal(
  tx: Queryable,
  input: { zoneId: string; source: FloodSource; levelPct?: number | null; rainMmHr?: number | null; confidence?: number | null; detail?: Record<string, unknown> },
  now: Date,
): Promise<Assessment> {
  await tx.query(
    `INSERT INTO flood_signals (zone_id, source, level_pct, rain_mm_hr, confidence, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [input.zoneId, input.source, input.levelPct ?? null, input.rainMmHr ?? null, input.confidence ?? null, JSON.stringify(input.detail ?? {}), now],
  );
  if (input.source === 'SENSOR') {
    await tx.query(`INSERT INTO flood_readings (zone_id, level_pct, source, created_at) VALUES ($1, $2, 'SENSOR', $3)`, [input.zoneId, input.levelPct, now]);
  }
  return evaluateZone(tx, input.zoneId, now);
}

/** The sensor bridge posts a reading: it is one signal, judged by the agent (BR28). */
export async function ingestSensor(db: Db, input: { zoneId: string; levelPct: number }, now: Date) {
  return db.tx(async (tx) => {
    if (!(await one(tx, 'SELECT 1 FROM flood_zones WHERE id = $1', [input.zoneId]))) throw notFound('Zone');
    const a = await addSignal(tx, { zoneId: input.zoneId, source: 'SENSOR', levelPct: input.levelPct }, now);
    const zone = await one<{ status: FloodStatus }>(tx, 'SELECT status FROM flood_zones WHERE id = $1', [input.zoneId]);
    return { zoneId: input.zoneId, levelPct: input.levelPct, status: zone!.status, agreed: a.agreed };
  });
}

/** Prototype: staff feed the agent from the sensor simulator, the camera test set and the rain gauge. */
export async function simulateSignal(
  db: Db,
  actor: Actor,
  zoneId: string,
  input: { source: 'SENSOR'; levelPct: number } | { source: 'CAMERA'; pictureId: FloodTestPictureId } | { source: 'RAIN'; rainMmHr: number },
  now: Date,
) {
  return db.tx(async (tx) => {
    const zone = await lockZone(tx, zoneId);
    assertTownshipAccess(actor, zone.township_id);
    if (input.source === 'CAMERA') {
      // A labelled test picture through the camera reader. Its result is a number with a confidence; the rules decide what it means.
      const reading = readTestPicture(input.pictureId);
      return addSignal(tx, { zoneId, source: 'CAMERA', levelPct: reading.levelPct, confidence: reading.confidence, detail: { pictureId: input.pictureId, truePct: reading.truePct, reader: reading.reader } }, now);
    }
    if (input.source === 'RAIN') return addSignal(tx, { zoneId, source: 'RAIN', rainMmHr: input.rainMmHr }, now);
    // The zone's simulated sensors move to this level and send signed readings through the real ingestion path.
    if (await simulateZoneLevel(tx, zoneId, input.levelPct, now)) return assessZone(tx, zoneId, now, await getSettings(tx));
    // A zone with no registered sensor: an unsigned test signal, as before sensors were registered.
    return addSignal(tx, { zoneId, source: 'SENSOR', levelPct: input.levelPct }, now);
  });
}

/**
 * A drain photo, standing in for a CCTV frame, read by the configured camera reader (camera-reader.ts):
 * your own model server, or the hosted AI. The reading becomes the zone's camera signal, judged by the
 * same rules as every other. The photo is read, not stored. When no reader is set up, or it cannot
 * answer, nothing is recorded, so a failed read can neither raise nor clear an alert.
 */
export async function readCameraPhoto(db: Db, actor: Actor, zoneId: string, photo: Photo, now: Date) {
  const zone = await one<{ township_id: string }>(db, 'SELECT township_id FROM flood_zones WHERE id = $1', [zoneId]);
  if (!zone) throw notFound('Zone');
  assertTownshipAccess(actor, zone.township_id);
  if (!photoReader()) throw ruleViolation('NO_CAMERA_READER', 'No camera reader is set up. Set AI_PROVIDER for the hosted AI, or FLOOD_MODEL_URL for your own model, or use a test picture.');
  // The model is asked before the transaction opens, so a slow answer never holds the zone locked.
  const reading = await readPhoto(photo);
  if (!reading) throw ruleViolation('CAMERA_UNREADABLE', 'The camera reader could not answer for this photo. Nothing was recorded. Try again, or use a test picture.');
  const assessment = await db.tx(async (tx) => {
    await lockZone(tx, zoneId);
    return addSignal(tx, { zoneId, source: 'CAMERA', levelPct: reading.levelPct, confidence: reading.confidence, detail: { reader: reading.reader, uploaded: true, by: actor.id } }, now);
  });
  return { reading, trusted: reading.levelPct !== null && reading.confidence >= CAMERA_MIN_CONFIDENCE, agreed: assessment.agreed };
}

/**
 * The duty officer sends (optionally edited) or cancels a draft. One tap. Cancelling
 * or editing the agent's draft is an override, so it needs a reason, and the reason
 * is kept in the timeline (BR21).
 */
export async function decideDraft(db: Db, actor: Actor, messageId: string, input: { action: 'SEND' | 'CANCEL'; what?: string; todo?: string; reason?: string }, now: Date) {
  const edited = Boolean(input.what || input.todo);
  if ((input.action === 'CANCEL' || edited) && !input.reason?.trim()) {
    throw ruleViolation('REASON_NEEDED', 'Say why you are cancelling or changing the agent’s draft.', { fields: { reason: 'Give a reason.' } });
  }
  return db.tx(async (tx) => {
    const draft = await one<{ id: string; zone_id: string; level: FloodStatus; status: string; signals: unknown }>(
      tx,
      `SELECT id, zone_id, level, status, signals FROM flood_messages WHERE id = $1 FOR UPDATE`,
      [messageId],
    );
    if (!draft) throw notFound('Draft');
    const zone = await lockZone(tx, draft.zone_id);
    assertTownshipAccess(actor, zone.township_id);
    if (draft.status !== 'DRAFT') throw conflict('ALREADY_DECIDED', 'This draft has already been sent or cancelled.');
    if (input.action === 'CANCEL') {
      await tx.query(`UPDATE flood_messages SET status = 'CANCELLED', decided_by = $2 WHERE id = $1`, [draft.id, actor.id]);
      await log(tx, zone.id, now, 'OFFICER_CANCELLED', { level: draft.level, reason: input.reason }, actor.id);
      await audit(tx, actor.id, 'FLOOD_DRAFT_CANCELLED', 'flood_zone', zone.id, { level: draft.level, reason: input.reason });
      return { status: 'CANCELLED' };
    }
    const a = await assessZone(tx, zone.id, now, await getSettings(tx));
    await log(tx, zone.id, now, 'OFFICER_CONFIRMED', { level: draft.level, edited, reason: input.reason ?? null }, actor.id);
    await sendLevel(tx, zone, { level: draft.level, levelPct: a.levelPct, decision: 'ONE_SIGNAL', signals: draft.signals, actorId: actor.id, draftId: draft.id, edits: { what: input.what, todo: input.todo } }, now);
    return { status: 'SENT' };
  });
}

/**
 * Deadlines and the 15-minute rhythm. Called by the `flood-agent` job and each
 * time the duty officer's screen refreshes.
 *  - A one-signal Danger draft nobody answered is sent if the water is still rising.
 *  - A one-signal Warning draft nobody answered is raised with the admins.
 *  - Every open alert gets its update when due, even if nothing has changed.
 */
export async function runAgentClock(db: Db, now: Date, townshipId: string | null = null) {
  const s = await getSettings(db);
  let escalated = 0;
  let updates = 0;
  // Simulated sensors report on their rhythm first, then any sensor silent for 5 minutes is marked faulty (rule 6).
  const heartbeats = await simulatedHeartbeat(db, now, townshipId);
  const silent = await checkSilentSensors(db, now, townshipId);
  const overdue = await db.query<{ id: string; zone_id: string; level: FloodStatus }>(
    `SELECT m.id, m.zone_id, m.level FROM flood_messages m JOIN flood_zones z ON z.id = m.zone_id
      WHERE m.status = 'DRAFT' AND m.deadline_at <= $1 AND ($2::uuid IS NULL OR z.township_id = $2)`,
    [now, townshipId],
  );
  for (const d of overdue) {
    escalated += await db.tx(async (tx) => {
      const draft = await one<{ status: string; signals: unknown }>(tx, `SELECT status, signals FROM flood_messages WHERE id = $1 FOR UPDATE`, [d.id]);
      if (draft?.status !== 'DRAFT') return 0;
      const zone = await lockZone(tx, d.zone_id);
      const a = await assessZone(tx, zone.id, now, s);
      if (d.level === 'DANGER' && a.single === 'DANGER' && a.rising) {
        await log(tx, zone.id, now, 'ESCALATED', { reason: 'No answer in 3 minutes and the water is still rising.' });
        await sendLevel(tx, zone, { level: 'DANGER', levelPct: a.levelPct, decision: 'ESCALATED', signals: draft.signals, actorId: null, draftId: d.id }, now);
        return 1;
      }
      if (RANK[a.single] < RANK[d.level] && !(d.level === 'DANGER' && a.single === 'DANGER')) {
        // The signal behind the draft has fallen back or gone stale: nothing left to confirm.
        await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [d.id]);
        await log(tx, zone.id, now, 'DRAFT_DROPPED', { reason: 'The signal fell back.' });
        return 0;
      }
      if (d.level === 'WARNING') {
        const flagged = await one(tx, `SELECT 1 FROM flood_agent_log WHERE zone_id = $1 AND step = 'UNANSWERED' AND detail->>'draft' = $2`, [zone.id, d.id]);
        if (!flagged) {
          const admins = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role = 'TOWNSHIP_ADMIN' AND status = 'ACTIVE'`, [zone.township_id]);
          await notify(tx, admins.map((u) => u.id), { priority: 'URGENT', title: `A flood warning for ${zone.name} is waiting`, body: 'The duty officer has not confirmed it within 5 minutes.', link: '/console/banjir' });
          await log(tx, zone.id, now, 'UNANSWERED', { draft: d.id });
        }
      } else if (a.single !== 'DANGER') {
        await tx.query(`UPDATE flood_messages SET status = 'CANCELLED' WHERE id = $1`, [d.id]);
        await log(tx, zone.id, now, 'DRAFT_DROPPED', { reason: 'The water stopped rising.' });
      }
      return 0;
    });
  }
  const due = await db.query<{ id: string; zone_id: string }>(
    `SELECT a.id, a.zone_id FROM flood_alerts a JOIN flood_zones z ON z.id = a.zone_id
      WHERE a.ended_at IS NULL AND a.next_update_at <= $1 AND ($2::uuid IS NULL OR z.township_id = $2)`,
    [now, townshipId],
  );
  for (const alert of due) {
    updates += await db.tx(async (tx) => {
      const current = await one<{ next_update_at: Date | null; level: FloodStatus }>(tx, 'SELECT next_update_at, level FROM flood_alerts WHERE id = $1 AND ended_at IS NULL FOR UPDATE', [alert.id]);
      if (!current?.next_update_at || current.next_update_at > now) return 0;
      const zone = await lockZone(tx, alert.zone_id);
      const a = await assessZone(tx, zone.id, now, s);
      const next = new Date(now.getTime() + UPDATE_EVERY_MS);
      const streets = (await tx.query<{ street: string }>('SELECT DISTINCT street FROM homes WHERE zone_id = $1 ORDER BY street LIMIT 6', [zone.id])).map((r) => r.street);
      const text = composeMessage(zone, current.level, 'UPDATE', a.levelPct ?? zone.level_pct, streets, next, s.timezone);
      await tx.query(
        `INSERT INTO flood_messages (zone_id, level, kind, what, where_text, todo, next_update_at, status, decision, signals, created_at, sent_at)
         VALUES ($1, $2, 'UPDATE', $3, $4, $5, $6, 'SENT', 'SCHEDULED', $7::jsonb, $8, $8)`,
        [zone.id, current.level, text.what, text.where, text.todo, next, JSON.stringify(a.readings.map((r) => ({ source: r.source, level: r.level, note: r.note }))), now],
      );
      await tx.query('UPDATE flood_alerts SET next_update_at = $2 WHERE id = $1', [alert.id, next]);
      const residents = await tx.query<{ id: string }>(`SELECT u.id FROM users u JOIN homes h ON h.id = u.home_id WHERE h.zone_id = $1 AND u.status = 'ACTIVE'`, [zone.id]);
      await notify(tx, residents.map((u) => u.id), { priority: current.level === 'DANGER' ? 'URGENT' : 'NORMAL', title: `Flood update for ${zone.name}`, body: [text.what, text.todo, text.nextUpdate].join(' '), link: '/app/banjir' });
      await log(tx, zone.id, now, 'UPDATE_SENT', { level: current.level });
      return 1;
    });
  }
  return { escalated, updates, heartbeats, silentSensors: silent };
}

/** The duty officer's screen: every zone's signals, the agent's reading, waiting drafts and the decision timeline. */
export async function agentOverview(db: Db, actor: Actor, now: Date) {
  await runAgentClock(db, now, actor.townshipId);
  const s = await getSettings(db);
  const zones = await db.query<ZoneRow & { updated_at: Date }>(
    `SELECT id, name, township_id, status, level_pct, safe_route, assembly_point, updated_at FROM flood_zones WHERE ($1::uuid IS NULL OR township_id = $1) ORDER BY name`,
    [actor.townshipId],
  );
  const result = [];
  for (const zone of zones) {
    const [assessment, draft, timeline, messages, checkins, sensors, event, trend] = await Promise.all([
      assessZone(db, zone.id, now, s),
      one(db, `SELECT id, level, what, where_text, todo, deadline_at, created_at, signals FROM flood_messages WHERE zone_id = $1 AND status = 'DRAFT'`, [zone.id]),
      db.query(`SELECT id, at, step, detail FROM flood_agent_log WHERE zone_id = $1 ORDER BY id DESC LIMIT 12`, [zone.id]),
      db.query(`SELECT id, level, kind, what, todo, decision, sent_at, next_update_at FROM flood_messages WHERE zone_id = $1 AND status = 'SENT' ORDER BY sent_at DESC LIMIT 5`, [zone.id]),
      checkinSummary(db, zone.id, zone.status !== 'NORMAL'),
      db.query(
        `SELECT id, code, site, health, health_reason, last_seen_at, last_level_pct, last_battery, simulated, sim_paused FROM flood_sensors WHERE zone_id = $1 AND status = 'ACTIVE' ORDER BY code`,
        [zone.id],
      ),
      one(
        db,
        `SELECT e.id, e.started_at, e.peak_status, (SELECT count(*)::int FROM sms_outbox o WHERE o.zone_id = e.zone_id AND o.created_at >= e.started_at) AS sms
           FROM flood_events e WHERE e.zone_id = $1 AND e.ended_at IS NULL`,
        [zone.id],
      ),
      trendEstimate(db, zone.id, now, s),
    ]);
    result.push({ ...zone, assessment, draft: draft ?? null, timeline, messages, checkins, sensors, event: event ?? null, trend });
  }
  return { zones: result, warningPct: s.flood_warning_pct, dangerPct: s.flood_danger_pct, integration: await integrationStatus(db, actor) };
}

/**
 * What each flood data source is today, and where a real device or model connects: the readiness the
 * console shows, so it is plain which parts are simulated in the prototype and how each one goes live.
 * Read from the real configuration and data, never assumed.
 */
async function integrationStatus(db: Db, actor: Actor) {
  const config = getConfig();
  const sensors = await one<{ simulated: number; real: number }>(
    db,
    `SELECT count(*) FILTER (WHERE s.simulated)::int AS simulated, count(*) FILTER (WHERE NOT s.simulated)::int AS real
       FROM flood_sensors s JOIN flood_zones z ON z.id = s.zone_id
      WHERE s.status = 'ACTIVE' AND ($1::uuid IS NULL OR z.township_id = $1)`,
    [actor.townshipId],
  );
  return {
    // Real sensors post signed readings to POST /flood/readings, checked against each sensor's own key: always open.
    sensors: { simulated: sensors!.simulated, real: sensors!.real },
    camera: { photoReader: photoReader(), modelServer: Boolean(config.FLOOD_MODEL_URL), hostedAi: config.AI_PROVIDER !== 'none' },
    forecast: { method: 'LINEAR_TREND' as const },
    scheduler: config.APP_ENV === 'development' ? ('DEV_CLOCK' as const) : ('SCHEDULED_JOB' as const),
  };
}

/**
 * Who has checked in during an alert, and who needs help. The priority list of
 * residents who asked to be phoned first is shown only while the zone is under
 * an alert, and only to duty staff (BR32).
 */
async function checkinSummary(q: Queryable, zoneId: string, underAlert: boolean) {
  if (!underAlert) return null;
  const alert = await one<{ id: string }>(q, 'SELECT id FROM flood_alerts WHERE zone_id = $1 AND ended_at IS NULL', [zoneId]);
  if (!alert) return null;
  const [counts, needHelp, priority] = await Promise.all([
    one<{ safe: number; need_help: number; homes: number }>(
      q,
      `SELECT count(*) FILTER (WHERE c.status = 'SAFE')::int AS safe, count(*) FILTER (WHERE c.status = 'NEED_HELP')::int AS need_help,
              (SELECT count(*)::int FROM homes WHERE zone_id = $2) AS homes
         FROM flood_checkins c WHERE c.alert_id = $1`,
      [alert.id, zoneId],
    ),
    q.query(
      `SELECT u.full_name, u.phone, h.house_no, h.building, h.street FROM flood_checkins c JOIN users u ON u.id = c.user_id JOIN homes h ON h.id = u.home_id
        WHERE c.alert_id = $1 AND c.status = 'NEED_HELP' ORDER BY c.created_at`,
      [alert.id],
    ),
    q.query(
      `SELECT u.full_name, u.phone, h.house_no, h.building, h.street, p.priority_note,
              (SELECT c.status FROM flood_checkins c WHERE c.alert_id = $2 AND c.user_id = u.id) AS checked_in
         FROM access_profiles p JOIN users u ON u.id = p.user_id JOIN homes h ON h.id = u.home_id
        WHERE p.priority_help AND h.zone_id = $1 AND u.status = 'ACTIVE' ORDER BY h.street, h.house_no`,
      [zoneId, alert.id],
    ),
  ]);
  return { ...counts!, needHelp, priority };
}

/** "I'm safe" or "I need help" during an alert in the resident's own zone. */
export async function checkIn(db: Db, actor: Actor, status: 'SAFE' | 'NEED_HELP', now: Date) {
  return db.tx(async (tx) => {
    const alert = await one<{ id: string; zone_id: string; township_id: string; name: string }>(
      tx,
      `SELECT a.id, a.zone_id, z.township_id, z.name FROM flood_alerts a JOIN flood_zones z ON z.id = a.zone_id JOIN homes h ON h.zone_id = z.id
        WHERE h.id = $1 AND a.ended_at IS NULL`,
      [actor.homeId],
    );
    if (!alert) throw notFound('Alert');
    await tx.query(
      `INSERT INTO flood_checkins (alert_id, user_id, status, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (alert_id, user_id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at`,
      [alert.id, actor.id, status, now],
    );
    if (status === 'NEED_HELP') {
      const responders = await tx.query<{ id: string }>(`SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'GUARD') AND status = 'ACTIVE'`, [alert.township_id]);
      await notify(tx, responders.map((r) => r.id), { priority: 'URGENT', title: `Help needed in ${alert.name}`, body: `${actor.fullName} asked for help during the flood alert.`, link: '/console/banjir' });
    }
    return { status };
  });
}

/** Lapor feeds the agent: a resident's report of water in a drain is a second opinion, never a decision. */
export async function reportSignal(tx: Queryable, zoneId: string, reportId: string, now: Date) {
  return addSignal(tx, { zoneId, source: 'REPORT', detail: { reportId } }, now);
}

/**
 * "Last verified" for a zone (Appendix E.1): the newest reading from a sensor that is
 * not faulty (or a level the duty officer set), and what it came from. Used by the
 * resident app, the danger takeover and the public status page. Needs `z` as the zone.
 */
export const VERIFIED_COLUMNS = 'v.verified_at, v.verified_by, v.sensors_ok';
export const VERIFIED_JOIN = `LEFT JOIN LATERAL (
    SELECT r.created_at AS verified_at, r.source AS verified_by,
           (SELECT count(*)::int FROM flood_sensors fs2 WHERE fs2.zone_id = z.id AND fs2.status = 'ACTIVE' AND fs2.health = 'OK') AS sensors_ok
      FROM flood_readings r LEFT JOIN flood_sensors fs ON fs.id = r.sensor_id
     WHERE r.zone_id = z.id AND (r.sensor_id IS NULL OR fs.health <> 'FAULTY')
     ORDER BY r.created_at DESC LIMIT 1) v ON true`;

const SOURCE_ORDER: WarningSource[] = ['MANUAL', 'SENSOR', 'CAMERA', 'RAIN', 'REPORT'];

/**
 * The source shown on every warning (Appendix E.1): the signals that backed the
 * latest message sent, read from what that message recorded. A signal counts if it
 * was trusted and reached the message's level (for an all clear, read normal).
 * If none did, as on a scheduled update after the water dropped, every trusted
 * signal is listed, so the message is never shown without a source.
 */
export function messageSources(level: FloodStatus | null, signals: unknown): WarningSource[] {
  if (!level || !Array.isArray(signals)) return [];
  const recorded = signals.filter((x): x is { source: WarningSource; level?: FloodStatus; trusted?: boolean } => typeof x?.source === 'string' && SOURCE_ORDER.includes(x.source));
  if (recorded.some((x) => x.source === 'MANUAL')) return ['MANUAL'];
  const trusted = recorded.filter((x) => x.trusted !== false);
  const backed = trusted.filter((x) => !x.level || (level === 'NORMAL' ? x.level === 'NORMAL' : RANK[x.level] >= RANK[level]));
  const chosen = new Set((backed.length ? backed : trusted).map((x) => x.source));
  return SOURCE_ORDER.filter((x) => chosen.has(x));
}

/** Swaps a row's raw `message_level` and `signals` for its `sources`; a zone back to normal shows none. */
export function withSources<T extends { message_level?: FloodStatus | null; signals?: unknown; status?: FloodStatus }>(row: T) {
  const { message_level, signals, ...rest } = row;
  return { ...rest, sources: row.status === 'NORMAL' ? null : messageSources(message_level ?? null, signals) };
}

/**
 * The one official status page (proposal 6.5): zone levels and the latest
 * official message. No sign-in, and nothing about any person.
 */
export async function publicFloodStatus(db: Db) {
  const townships = await db.query<{ id: string; name: string }>('SELECT id, name FROM townships ORDER BY name');
  const zones = await db.query<{ township_id: string } & Record<string, unknown>>(
    `SELECT z.township_id, z.id, z.name, z.status, z.level_pct, z.safe_route, z.assembly_point, z.updated_at,
            m.kind AS message_kind, m.what, m.where_text, m.todo, m.next_update_at, m.sent_at, m.level AS message_level, m.signals, ${VERIFIED_COLUMNS}
       FROM flood_zones z
       LEFT JOIN LATERAL (SELECT kind, what, where_text, todo, next_update_at, sent_at, level, signals FROM flood_messages
                           WHERE zone_id = z.id AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1) m ON true
       ${VERIFIED_JOIN}
      ORDER BY z.name`,
  );
  const s = await getSettings(db);
  return townships.map((t) => ({ ...t, warningPct: s.flood_warning_pct, dangerPct: s.flood_danger_pct, zones: zones.filter((z) => z.township_id === t.id).map((z) => ({ ...withSources(z as typeof z & { status: FloodStatus }), township_id: undefined })) }));
}
