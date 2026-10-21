import type { ReportCategory, ReportStatus } from '@/shared/domain';
import { REPORT_CATEGORY_LABELS } from '@/shared/domain';
import { writeIssueWording, type IssueWording } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { log } from '../../logger';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { hasRudeWords, looksLikeJunk } from './text-check';

/**
 * The parts of Lapor issues that reporting itself needs: the issue's figures, its public wording, and telling the
 * township office when an issue reaches the number of residents that makes it public and "Needs attention".
 */

export interface IssueFacts {
  id: string;
  township_id: string;
  category: ReportCategory;
  zone_id: string | null;
  zone_name: string | null;
  title: string | null;
  title_ms: string | null;
  summary: string | null;
  summary_ms: string | null;
  title_source: 'MODEL' | 'STAFF' | null;
  status: ReportStatus;
  urgent: boolean;
  reports: number;
  people: number;
  first_report_id: string;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  target_date: string | null;
  assigned_to: string | null;
}

export const ISSUE_SELECT = `
  SELECT f.id, f.township_id, f.category, f.zone_id, z.name AS zone_name, f.title, f.title_ms, f.summary, f.summary_ms, f.title_source,
         f.status, f.urgent, f.reports, f.people, f.first_report_id, f.created_at, f.updated_at, f.resolved_at,
         f.target_date::text AS target_date, f.assigned_to
    FROM report_issue_facts f LEFT JOIN flood_zones z ON z.id = f.zone_id`;

export const issueFacts = (q: Queryable, id: string) => one<IssueFacts>(q, `${ISSUE_SELECT} WHERE f.id = $1`, [id]);

export const publicThreshold = async (q: Queryable) => (await getSettings(q)).issue_public_threshold;

/** Place and problem words, for matching reports by their wording (common street words do not count). */
export const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w)));
const STOP_WORDS = new Set(['jalan', 'near', 'outside', 'beside', 'front', 'there', 'with', 'from', 'this', 'that', 'have', 'been', 'dekat', 'depan', 'tepi', 'sebelah', 'tidak', 'sudah', 'lagi']);

/**
 * A model-written line made safe to show: one line, no phone numbers or emails, a sensible length, and no rude or
 * nonsense text. Anything that fails is dropped, and the app falls back to "<type> in <area>".
 */
export function cleanWording(w: IssueWording): IssueWording | null {
  const line = (text: string, max: number) => {
    const cleaned = text
      .replace(/\s+/g, ' ')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
      .replace(/\+?\d[\d\s-]{7,}\d/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned.length < 3 || hasRudeWords(cleaned) || looksLikeJunk(cleaned, 'place')) return null;
    return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
  };
  const title = line(w.title, 80);
  const titleMs = line(w.titleMs, 80);
  const summary = line(w.summary, 200);
  const summaryMs = line(w.summaryMs, 200);
  return title && titleMs && summary && summaryMs ? { title, titleMs, summary, summaryMs } : null;
}

/** The township office and its admins, who work the "Needs attention" list. */
async function townshipTeam(q: Queryable, townshipId: string) {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE status = 'ACTIVE' AND township_id = $1 AND role IN ('TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN')`,
    [townshipId],
  );
  return rows.map((r) => r.id);
}

/**
 * Called after someone joins an issue (a report added to it, or "Me too"). When the number of residents has just
 * reached the threshold, the issue becomes public and the township office is told once that it needs attention.
 */
export async function afterJoin(tx: Queryable, issueId: string, peopleBefore: number) {
  const facts = await issueFacts(tx, issueId);
  if (!facts) return;
  const threshold = await publicThreshold(tx);
  if (peopleBefore >= threshold || facts.people < threshold) return;
  await audit(tx, null, 'ISSUE_PUBLIC', 'report_issue', issueId, { people: facts.people, threshold });
  await notify(tx, await townshipTeam(tx, facts.township_id), {
    title: `A Lapor issue now affects ${facts.people} residents`,
    body: facts.title ?? `${REPORT_CATEGORY_LABELS[facts.category]}${facts.zone_name ? ` in ${facts.zone_name}` : ''}`,
    link: '/console/reports?tab=attention',
    dedupeKey: `issue-attention:${issueId}`,
  });
}

/**
 * Rewrites an issue's public title and summary from its reports, after a new one joins. Best effort, outside any
 * transaction (it may call the model); a title staff wrote is never replaced.
 */
export async function refreshIssueWording(db: Db, issueId: string) {
  try {
    const facts = await issueFacts(db, issueId);
    if (!facts || facts.title_source === 'STAFF') return;
    const reports = await db.query<{ description: string; place: string }>(
      'SELECT description, location_text AS place FROM reports WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 8',
      [issueId],
    );
    const written = await writeIssueWording({ type: REPORT_CATEGORY_LABELS[facts.category], area: facts.zone_name, reports });
    const wording = written && cleanWording(written);
    if (!wording) return;
    await db.query(
      `UPDATE report_issues SET title = $2, title_ms = $3, summary = $4, summary_ms = $5, title_source = 'MODEL'
        WHERE id = $1 AND title_source IS DISTINCT FROM 'STAFF'`,
      [issueId, wording.title, wording.titleMs, wording.summary, wording.summaryMs],
    );
  } catch (error) {
    log.warn('Issue wording not refreshed', { issueId, error: String(error) });
  }
}
