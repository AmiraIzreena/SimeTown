import type { ReportCategory, ReportStatus, Urgency } from '@/shared/domain';
import { STAFF } from '@/shared/domain';
import { suggestReport, type Photo } from '../../ai/classifier';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { conflict, notFound } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { notify } from '../notifications';
import { recordAction, rewardUserById } from '../rewards';

/** Lapor: report a hazard or an access barrier, and follow it until it is closed. */

const isStaff = (actor: Actor) => STAFF.includes(actor.role);

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
    const category = input.category ?? suggestion.category;
    const report = await one<{ id: string }>(
      tx,
      `INSERT INTO reports (township_id, reporter_id, zone_id, category, urgency, ai_category, ai_urgency, ai_source, description, location_text, photo_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
      [resident.townshipId, resident.id, input.zoneId ?? null, category, suggestion.urgency, suggestion.category, suggestion.urgency, suggestion.source, input.description, input.locationText, photoId, now],
    );
    if (suggestion.urgency === 'URGENT') {
      // BR19: urgent safety reports jump the queue for every staff member on duty.
      const staff = await tx.query<{ id: string }>(
        `SELECT id FROM users WHERE township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN') AND status = 'ACTIVE'`,
        [resident.townshipId],
      );
      await notify(tx, staff.map((s) => s.id), { priority: 'URGENT', title: 'Urgent safety report', body: `${input.locationText}: ${input.description.slice(0, 120)}`, link: '/console/reports' });
    }
    return { id: report!.id, category, urgency: suggestion.urgency, suggestion };
  });
}

const REPORT_SELECT = `
  SELECT r.id, r.category, r.urgency, r.ai_category, r.ai_urgency, r.ai_source, r.description, r.location_text, r.photo_id,
         r.status, r.staff_note, r.created_at, r.updated_at, r.resolved_at, z.name AS zone_name, r.reporter_id, r.township_id
    FROM reports r LEFT JOIN flood_zones z ON z.id = r.zone_id`;

/** Residents see their own reports. Staff see their township's queue, most urgent first within each status. */
export async function listReports(db: Db, actor: Actor, filter: { status?: ReportStatus } & PageQuery) {
  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  const staff = isStaff(actor);
  const rows = await db.query<{ id: string; created_at: Date }>(
    `${REPORT_SELECT}
      WHERE ($1::text IS NULL OR r.status = $1)
        AND ${staff ? '($2::uuid IS NULL OR r.township_id = $2)' : 'r.reporter_id = $2'}
        AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
    [filter.status ?? null, staff ? actor.townshipId : actor.id, after, afterId, filter.limit + 1],
  );
  return toPage(rows, filter.limit, (r) => [r.created_at, r.id]);
}

async function loadVisibleReport(db: Db, actor: Actor, id: string) {
  const report = await one<{ id: string; reporter_id: string; township_id: string; photo_id: string | null }>(db, `${REPORT_SELECT} WHERE r.id = $1`, [id]);
  const allowed = report && (isStaff(actor) ? actor.role === 'HQ_ADMIN' || report.township_id === actor.townshipId : report.reporter_id === actor.id);
  if (!allowed) throw notFound('Report'); // same answer whether it is missing or someone else's
  return report;
}

export const getReport = loadVisibleReport;

/** The photo is served only to the reporter and to staff of that township. */
export async function getReportPhoto(db: Db, actor: Actor, reportId: string): Promise<Response> {
  const report = await loadVisibleReport(db, actor, reportId);
  const upload = report.photo_id ? await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT mime, bytes FROM uploads WHERE id = $1', [report.photo_id]) : undefined;
  if (!upload) throw notFound('Photo');
  return new Response(Buffer.from(upload.bytes), {
    headers: {
      'Content-Type': upload.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export interface ReportUpdate {
  status?: ReportStatus;
  category?: ReportCategory;
  urgency?: Urgency;
  staffNote?: string;
}

/** Staff work the case. Changing what the classifier suggested is always allowed and always logged (BR21). */
export async function updateReport(db: Db, actor: Actor, id: string, update: ReportUpdate, now: Date) {
  return db.tx(async (tx) => {
    const r = await one<{ township_id: string; reporter_id: string; status: ReportStatus; category: string; urgency: string; ai_category: string | null; ai_urgency: string | null }>(
      tx,
      'SELECT township_id, reporter_id, status, category, urgency, ai_category, ai_urgency FROM reports WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!r || (actor.role !== 'HQ_ADMIN' && r.township_id !== actor.townshipId)) throw notFound('Report');
    if ((r.status === 'RESOLVED' || r.status === 'REJECTED') && update.status && update.status !== r.status) {
      throw conflict('REPORT_CLOSED', 'This report is already closed.');
    }
    const category = update.category ?? r.category;
    const urgency = update.urgency ?? r.urgency;
    const status = update.status ?? r.status;
    if (r.ai_category && (category !== r.category || urgency !== r.urgency)) {
      await audit(tx, actor.id, 'AI_OVERRIDE', 'report', id, { suggested: { category: r.ai_category, urgency: r.ai_urgency }, set: { category, urgency } });
    }
    await tx.query(
      `UPDATE reports SET category = $2, urgency = $3, status = $4, staff_note = coalesce($5, staff_note), updated_at = $6,
              resolved_at = CASE WHEN $4 IN ('RESOLVED', 'REJECTED') THEN coalesce(resolved_at, $6) ELSE NULL END
        WHERE id = $1`,
      [id, category, urgency, status, update.staffNote ?? null, now],
    );
    if (status !== r.status) {
      await audit(tx, actor.id, 'REPORT_STATUS', 'report', id, { from: r.status, to: status });
      // XP only once staff have confirmed the report is genuine, so nobody is rewarded for a false one.
      if (status === 'IN_PROGRESS' || status === 'RESOLVED') {
        const reporter = await rewardUserById(tx, r.reporter_id);
        if (reporter) await recordAction(tx, { user: reporter, activity: 'LAPOR_REPORT', ref: id, now });
      }
      const words: Record<ReportStatus, string> = { NEW: 'received', IN_PROGRESS: 'being worked on', RESOLVED: 'resolved', REJECTED: 'closed without action' };
      await notify(tx, [r.reporter_id], { title: `Your report is ${words[status]}`, body: update.staffNote ?? 'Open Lapor to see the details.', link: '/app/lapor' });
    }
    return { ok: true };
  });
}
