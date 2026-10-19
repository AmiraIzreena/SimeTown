import type { ReportCategory, ReportStatus, Urgency } from '@/shared/domain';
import { REPORT_CATEGORY_LABELS, STAFF } from '@/shared/domain';
import { suggestReport, type Photo } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { notify } from '../notifications';
import { reportSignal } from '../banjir/agent';
import { recordAction, rewardUserById } from '../rewards';
import { todayIn } from '../settings';

/**
 * Lapor: report a hazard or an access barrier, and follow it until it is closed.
 *
 * The brief's "one reporting channel": every report shows where it is
 * (received, checked by staff, assigned with a target date, fixed with a
 * photo), and a resident with the same problem taps "Me too" on the first
 * report instead of filing another, so staff see how many people it affects.
 */

const isStaff = (actor: Actor) => STAFF.includes(actor.role);
const OPEN: ReportStatus[] = ['NEW', 'IN_PROGRESS'];

export interface ReportInput {
  description: string;
  locationText: string;
  zoneId?: string;
  /** The resident's own choice. When absent, the suggestion is used. */
  category?: ReportCategory;
  photo?: Photo;
}

export async function createReport(db: Db, actor: Actor, input: ReportInput, now: Date) {
  const resident = requireVerifiedResident(actor);
  const suggestion = await suggestReport(input.description, input.photo); // outside the transaction: it may call a remote service
  return db.tx(async (tx) => {
    if (input.zoneId && !(await one(tx, 'SELECT 1 FROM flood_zones WHERE id = $1 AND township_id = $2', [input.zoneId, resident.townshipId]))) {
      throw notFound('Area');
    }
    const photoId = input.photo ? await storePhoto(tx, resident.id, input.photo) : null;
    const category = input.category ?? suggestion.category;
    const report = await one<{ id: string }>(
      tx,
      `INSERT INTO reports (township_id, reporter_id, zone_id, category, urgency, ai_category, ai_urgency, ai_source, description, location_text, photo_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [resident.townshipId, resident.id, input.zoneId ?? null, category, suggestion.urgency, suggestion.category, suggestion.urgency, suggestion.source, input.description, input.locationText, photoId, now],
    );
    // Every new report reaches the township's staff and admins. BR19: urgent safety reports jump the
    // queue, and HQ is told about those too, so a danger is never missed. HQ is not sent routine
    // reports: it covers every township and sees them all in its Lapor list.
    const urgent = suggestion.urgency === 'URGENT';
    const staff = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'ACTIVE' AND ((township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN')) OR ($2 AND role = 'HQ_ADMIN'))`,
      [resident.townshipId, urgent],
    );
    await notify(tx, staff.map((s) => s.id), {
      priority: urgent ? 'URGENT' : 'NORMAL',
      title: urgent ? 'Urgent safety report' : 'New Lapor report',
      body: `${input.locationText}: ${input.description.slice(0, 120)}`,
      link: '/console/reports',
      dedupeKey: `report-new:${report!.id}`,
    });
    // Water in a drain, reported with its area, is a second opinion for the Banjir agent (never a decision on its own).
    if (category === 'DRAINAGE' && input.zoneId) await reportSignal(tx, input.zoneId, report!.id, now);
    await notify(tx, [resident.id], { title: 'Report received', body: input.locationText, link: `/app/lapor/${report!.id}`, dedupeKey: `report-received:${report!.id}` });
    return { id: report!.id, category, urgency: suggestion.urgency, suggestion };
  });
}

async function storePhoto(q: Queryable, ownerId: string, photo: Photo): Promise<string> {
  const upload = await one<{ id: string }>(q, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [
    ownerId,
    photo.mime,
    photo.bytes.length,
    Buffer.from(photo.bytes),
  ]);
  return upload!.id;
}

const REPORT_SELECT = `
  SELECT r.id, r.category, r.urgency, r.ai_category, r.ai_urgency, r.ai_source, r.description, r.location_text, r.photo_id,
         r.status, r.staff_note, r.created_at, r.updated_at, r.resolved_at, z.name AS zone_name, r.reporter_id, r.township_id,
         r.checked_at, r.assigned_to, r.assigned_at, r.target_date::text AS target_date, r.fixed_photo_id,
         1 + (SELECT count(*)::int FROM report_supporters s WHERE s.report_id = r.id) AS affected
    FROM reports r LEFT JOIN flood_zones z ON z.id = r.zone_id`;

interface ReportRow {
  id: string;
  category: ReportCategory;
  status: ReportStatus;
  description: string;
  photo_id: string | null;
  reporter_id: string;
  township_id: string;
  target_date: string | null;
  created_at: Date;
  checked_at: Date | null;
  assigned_to: string | null;
  fixed_photo_id: string | null;
  affected: number;
  [key: string]: unknown;
}

/**
 * What one person may see of a report. Another resident following it sees
 * where it is and the township's updates, never the reporter's own words or photo.
 */
function present(r: ReportRow, actor: Actor, today: string) {
  const mine = r.reporter_id === actor.id;
  const late = OPEN.includes(r.status) && r.target_date !== null && r.target_date < today;
  const { reporter_id: _reporter, township_id: _township, ...rest } = r;
  void _reporter;
  void _township;
  if (isStaff(actor) || mine) return { ...rest, mine, late };
  return { ...rest, description: null, photo_id: null, mine, late };
}

/**
 * Residents see their own reports and the ones they follow with "Me too".
 * Staff see their township's queue.
 */
export async function listReports(db: Db, actor: Actor, filter: { status?: ReportStatus } & PageQuery, now: Date) {
  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  const staff = isStaff(actor);
  const rows = await db.query<ReportRow>(
    `${REPORT_SELECT}
      WHERE ($1::text IS NULL OR r.status = $1)
        AND ${staff ? '($2::uuid IS NULL OR r.township_id = $2)' : '(r.reporter_id = $2 OR EXISTS (SELECT 1 FROM report_supporters s WHERE s.report_id = r.id AND s.user_id = $2))'}
        AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
    [filter.status ?? null, staff ? actor.townshipId : actor.id, after, afterId, filter.limit + 1],
  );
  const today = await todayIn(db, now);
  const page = toPage(rows, filter.limit, (r) => [r.created_at, r.id]);
  return { ...page, items: page.items.map((r) => present(r, actor, today)) };
}

async function loadVisibleReport(db: Queryable, actor: Actor, id: string) {
  const report = await one<ReportRow>(db, `${REPORT_SELECT} WHERE r.id = $1`, [id]);
  const allowed =
    report &&
    (isStaff(actor)
      ? actor.role === 'HQ_ADMIN' || report.township_id === actor.townshipId
      : report.reporter_id === actor.id || Boolean(await one(db, 'SELECT 1 FROM report_supporters WHERE report_id = $1 AND user_id = $2', [id, actor.id])));
  if (!allowed) throw notFound('Report'); // same answer whether it is missing or someone else's
  return report;
}

export async function getReport(db: Db, actor: Actor, id: string, now: Date) {
  return present(await loadVisibleReport(db, actor, id), actor, await todayIn(db, now));
}

const photoResponse = (upload: { mime: string; bytes: Uint8Array }) =>
  new Response(Buffer.from(upload.bytes), {
    headers: {
      'Content-Type': upload.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  });

/** The reporter's photo is served only to them and to staff of that township. */
export async function getReportPhoto(db: Db, actor: Actor, reportId: string): Promise<Response> {
  const report = await loadVisibleReport(db, actor, reportId);
  if (!isStaff(actor) && report.reporter_id !== actor.id) throw notFound('Photo');
  const upload = report.photo_id ? await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [report.photo_id]) : undefined;
  if (!upload) throw notFound('Photo');
  return photoResponse(upload);
}

/** The "fixed" photo staff took, for everyone following the report. */
export async function getFixedPhoto(db: Db, actor: Actor, reportId: string): Promise<Response> {
  const report = await loadVisibleReport(db, actor, reportId);
  const upload = report.fixed_photo_id ? await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [report.fixed_photo_id]) : undefined;
  if (!upload) throw notFound('Photo');
  return photoResponse(upload);
}

export interface ReportUpdate {
  status?: ReportStatus;
  category?: ReportCategory;
  urgency?: Urgency;
  staffNote?: string;
  /** The team or contractor fixing it. An empty string clears it. */
  assignedTo?: string;
  /** "2026-11-05", or null to clear. Residents are told this date. */
  targetDate?: string | null;
}

/** Everyone who should hear about a report: the reporter and the residents following it. */
async function followers(q: Queryable, reportId: string, reporterId: string): Promise<string[]> {
  const rows = await q.query<{ user_id: string }>('SELECT user_id FROM report_supporters WHERE report_id = $1', [reportId]);
  return [reporterId, ...rows.map((r) => r.user_id)];
}

/** Staff work the case. Changing what the classifier suggested is always allowed and always logged (BR21). */
export async function updateReport(db: Db, actor: Actor, id: string, update: ReportUpdate, now: Date) {
  return db.tx(async (tx) => {
    const r = await one<{
      township_id: string; reporter_id: string; status: ReportStatus; category: ReportCategory; urgency: string; ai_category: string | null; ai_urgency: string | null;
      assigned_to: string | null; target_date: string | null; location_text: string;
    }>(
      tx,
      `SELECT township_id, reporter_id, status, category, urgency, ai_category, ai_urgency, assigned_to, target_date::text AS target_date, location_text
         FROM reports WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!r || (actor.role !== 'HQ_ADMIN' && r.township_id !== actor.townshipId)) throw notFound('Report');
    const closed = r.status === 'RESOLVED' || r.status === 'REJECTED';
    if (closed && update.status && update.status !== r.status) {
      throw conflict('REPORT_CLOSED', 'This report is already closed.');
    }
    const category = update.category ?? r.category;
    const urgency = update.urgency ?? r.urgency;
    const status = update.status ?? r.status;
    const assignedTo = update.assignedTo === undefined ? r.assigned_to : update.assignedTo.trim() || null;
    const targetDate = update.targetDate === undefined ? r.target_date : update.targetDate;
    if (targetDate && targetDate !== r.target_date && targetDate < (await todayIn(tx, now))) {
      throw ruleViolation('TARGET_IN_PAST', 'The target date cannot be in the past.');
    }
    if (r.ai_category && (category !== r.category || urgency !== r.urgency)) {
      await audit(tx, actor.id, 'AI_OVERRIDE', 'report', id, { suggested: { category: r.ai_category, urgency: r.ai_urgency }, set: { category, urgency } });
    }
    await tx.query(
      `UPDATE reports SET category = $2, urgency = $3, status = $4, staff_note = coalesce($5, staff_note), updated_at = $6,
              resolved_at = CASE WHEN $4 IN ('RESOLVED', 'REJECTED') THEN coalesce(resolved_at, $6) ELSE NULL END,
              checked_at = CASE WHEN $4 IN ('IN_PROGRESS', 'RESOLVED') THEN coalesce(checked_at, $6) ELSE checked_at END,
              assigned_to = $7,
              assigned_at = CASE WHEN $7::text IS NULL THEN NULL WHEN assigned_to IS DISTINCT FROM $7 THEN $6 ELSE assigned_at END,
              target_date = $8::date
        WHERE id = $1`,
      [id, category, urgency, status, update.staffNote ?? null, now, assignedTo, targetDate],
    );
    const people = await followers(tx, id, r.reporter_id);
    const where = `${REPORT_CATEGORY_LABELS[r.category]} at ${r.location_text}`;
    if (status !== r.status) {
      await audit(tx, actor.id, 'REPORT_STATUS', 'report', id, { from: r.status, to: status });
      // XP only once staff have confirmed the report is genuine, so nobody is rewarded for a false one.
      // Only the first reporter earns it: a "Me too" never does.
      if (status === 'IN_PROGRESS' || status === 'RESOLVED') {
        const reporter = await rewardUserById(tx, r.reporter_id);
        if (reporter) await recordAction(tx, { user: reporter, activity: 'LAPOR_REPORT', ref: id, now });
      }
      const words: Record<ReportStatus, string> = { NEW: 'received', IN_PROGRESS: 'being worked on', RESOLVED: 'resolved', REJECTED: 'closed without action' };
      await notify(tx, people, { title: `Your report is ${words[status]}`, body: update.staffNote ?? 'Open Lapor to see the details.', link: `/app/lapor/${id}`, dedupeKey: `report-status:${id}:${status}:${now.getTime()}` });
    } else if (targetDate && targetDate !== r.target_date && OPEN.includes(status)) {
      await notify(tx, people, {
        title: assignedTo ? `${assignedTo} will fix it` : 'A fix date is set',
        body: `${where}: expected by ${targetDate}.`,
        link: `/app/lapor/${id}`,
        dedupeKey: `report-target:${id}:${targetDate}:${now.getTime()}`,
      });
    }
    if (assignedTo !== r.assigned_to || targetDate !== r.target_date) {
      await audit(tx, actor.id, 'REPORT_ASSIGNED', 'report', id, { assignedTo, targetDate });
    }
    return { ok: true };
  });
}

/** Staff attach the "fixed" photo everyone following the report can see. */
export async function setFixedPhoto(db: Db, actor: Actor, id: string, photo: Photo, now: Date) {
  return db.tx(async (tx) => {
    const r = await one<{ township_id: string }>(tx, 'SELECT township_id FROM reports WHERE id = $1 FOR UPDATE', [id]);
    if (!r || (actor.role !== 'HQ_ADMIN' && r.township_id !== actor.townshipId)) throw notFound('Report');
    const photoId = await storePhoto(tx, actor.id, photo);
    await tx.query('UPDATE reports SET fixed_photo_id = $2, updated_at = $3 WHERE id = $1', [id, photoId, now]);
    return { ok: true };
  });
}

/**
 * "Me too": the resident follows a report about the same problem instead of
 * filing a second one. Staff see how many people it affects; everyone following
 * hears each step. It earns no XP, so there is nothing to gain by tapping it idly.
 */
export async function setMeToo(db: Db, actor: Actor, id: string, on: boolean, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    const r = await one<{ reporter_id: string; status: ReportStatus }>(tx, 'SELECT reporter_id, status FROM reports WHERE id = $1 AND township_id = $2', [id, resident.townshipId]);
    if (!r) throw notFound('Report');
    if (r.reporter_id === resident.id) throw ruleViolation('OWN_REPORT', 'This is your own report.');
    if (on) {
      if (!OPEN.includes(r.status)) throw ruleViolation('REPORT_CLOSED', 'This report is already closed.');
      await tx.query('INSERT INTO report_supporters (report_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, resident.id, now]);
    } else {
      await tx.query('DELETE FROM report_supporters WHERE report_id = $1 AND user_id = $2', [id, resident.id]);
    }
    const n = await one<{ affected: number }>(tx, 'SELECT 1 + count(*)::int AS affected FROM report_supporters WHERE report_id = $1', [id]);
    return { affected: n!.affected, following: on };
  });
}

const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)));
const STOP_WORDS = new Set(['jalan', 'near', 'outside', 'beside', 'front', 'there', 'with', 'from', 'this', 'that', 'have', 'been', 'dekat', 'depan', 'tepi', 'sebelah']);

/**
 * Open reports that look like the one a resident is about to send: the same
 * type, the same area or the same place words. Only the type, place and how many
 * people it affects are shown, never anyone's own words.
 */
export async function similarReports(db: Db, actor: Actor, input: { category?: ReportCategory; zoneId?: string; text: string }, now: Date) {
  const resident = requireVerifiedResident(actor);
  const rows = await db.query<{
    id: string; category: ReportCategory; zone_id: string | null; zone_name: string | null; location_text: string; description: string;
    status: ReportStatus; created_at: Date; affected: number; following: boolean; target_date: string | null;
  }>(
    `SELECT r.id, r.category, r.zone_id, z.name AS zone_name, r.location_text, r.description, r.status, r.created_at, r.target_date::text AS target_date,
            1 + (SELECT count(*)::int FROM report_supporters s WHERE s.report_id = r.id) AS affected,
            EXISTS (SELECT 1 FROM report_supporters s WHERE s.report_id = r.id AND s.user_id = $2) AS following
       FROM reports r LEFT JOIN flood_zones z ON z.id = r.zone_id
      WHERE r.township_id = $1 AND r.reporter_id <> $2 AND r.status IN ('NEW', 'IN_PROGRESS')
        AND r.created_at > $3::timestamptz - interval '60 days'
      ORDER BY r.created_at DESC LIMIT 200`,
    [resident.townshipId, resident.id, now],
  );
  const mine = words(input.text);
  return rows
    .map((r) => {
      const theirs = words(`${r.location_text} ${r.description}`);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const score = (input.category && r.category === input.category ? 3 : 0) + (input.zoneId && r.zone_id === input.zoneId ? 2 : 0) + Math.min(shared, 3) * 2;
      return { r, score, shared };
    })
    // The same type alone is not enough: it must also share the area or a place word.
    .filter(({ score, shared, r }) => score >= 4 && (shared > 0 || (input.zoneId && r.zone_id === input.zoneId)))
    .sort((a, b) => b.score - a.score || b.r.affected - a.r.affected)
    .slice(0, 3)
    .map(({ r }) => ({
      id: r.id, category: r.category, zone_name: r.zone_name, location_text: r.location_text, status: r.status,
      created_at: r.created_at, affected: r.affected, following: r.following, target_date: r.target_date,
    }));
}

/**
 * The brief's test for one reporting channel: fewer follow-ups and faster
 * resolution. Duplicate reports avoided are the "Me too" taps; resolution is
 * the time from report to fixed.
 */
export async function reportStats(db: Db, actor: Actor, now: Date) {
  const townshipId = actor.townshipId;
  const today = await todayIn(db, now);
  const [totals, byCategory] = await Promise.all([
    one<{ open: number; late: number; with_target: number; me_too: number; checked_hours: number | null; fixed_days: number | null; resolved: number }>(
      db,
      `SELECT count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS'))::int AS open,
              count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS') AND target_date < $2::date)::int AS late,
              count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS') AND target_date IS NOT NULL)::int AS with_target,
              (SELECT count(*)::int FROM report_supporters s JOIN reports x ON x.id = s.report_id
                WHERE ($1::uuid IS NULL OR x.township_id = $1) AND s.created_at > $3::timestamptz - interval '90 days') AS me_too,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM checked_at - created_at) / 3600)
                FILTER (WHERE checked_at IS NOT NULL AND created_at > $3::timestamptz - interval '90 days'))::numeric, 1)::float AS checked_hours,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 86400)
                FILTER (WHERE status = 'RESOLVED' AND resolved_at > $3::timestamptz - interval '90 days'))::numeric, 1)::float AS fixed_days,
              count(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at > $3::timestamptz - interval '90 days')::int AS resolved
         FROM reports WHERE ($1::uuid IS NULL OR township_id = $1)`,
      [townshipId, today, now],
    ),
    db.query<{ category: ReportCategory; resolved: number; median_days: number | null; open: number }>(
      `SELECT category,
              count(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at > $2::timestamptz - interval '90 days')::int AS resolved,
              count(*) FILTER (WHERE status IN ('NEW', 'IN_PROGRESS'))::int AS open,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 86400)
                FILTER (WHERE status = 'RESOLVED' AND resolved_at > $2::timestamptz - interval '90 days'))::numeric, 1)::float AS median_days
         FROM reports WHERE ($1::uuid IS NULL OR township_id = $1) GROUP BY category ORDER BY open DESC, category`,
      [townshipId, now],
    ),
  ]);
  const t = totals!;
  return {
    open: t.open,
    late: t.late,
    withTargetPct: t.open ? Math.round((t.with_target / t.open) * 100) : null,
    duplicatesAvoided: t.me_too,
    medianHoursToCheck: t.checked_hours,
    medianDaysToFix: t.fixed_days,
    resolved90d: t.resolved,
    byCategory,
  };
}
