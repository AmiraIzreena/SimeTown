import type { ReportCategory, ReportStatus, Urgency } from '@/shared/domain';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, STAFF } from '@/shared/domain';
import { matchIssueByModel, suggestReportByRules } from '../../ai/classifier';
import { one, type Db, type Queryable } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { notFound, ruleViolation } from '../../errors';
import { decodeCursor, toPage, type PageQuery } from '../../http/pagination';
import { audit } from '../audit';
import { todayIn } from '../settings';
import { afterJoin, ISSUE_SELECT, issueFacts, publicThreshold, words, type IssueFacts } from './issue-core';
import { applyReportUpdate, checkReportInput, photoResponse, type ReportUpdate } from './service';

/**
 * Lapor issues: reports about the same problem at the same place, grouped. Neighbours see an issue only once enough
 * different residents (reporters and "Me too") are affected, and then only its written title and summary, type,
 * area, status, dates and one report's photo (unless staff hid it): never who reported it or their words. An issue closed with no action disappears
 * from their view at once. Staff get the issues that reached that number, and anything urgent, as "Needs attention",
 * and one update reaches every report in the issue.
 */

const OPEN: ReportStatus[] = ['NEW', 'IN_PROGRESS'];
const isStaff = (actor: Actor) => STAFF.includes(actor.role);

/** What a resident is shown about an issue. */
function present(f: IssueFacts & { following?: boolean; mine?: boolean }, today: string) {
  return {
    id: f.id, category: f.category, zone_name: f.zone_name,
    title: f.title, title_ms: f.title_ms, summary: f.summary, summary_ms: f.summary_ms,
    status: f.status, people: f.people, reports: f.reports, urgent: f.urgent,
    created_at: f.created_at, updated_at: f.updated_at, resolved_at: f.resolved_at, target_date: f.target_date,
    late: OPEN.includes(f.status) && f.target_date !== null && f.target_date < today,
    following: Boolean(f.following), mine: Boolean(f.mine),
    // Changes when staff pick another photo, so the browser does not keep showing the old one.
    photo_version: f.photo_report_id ? f.photo_report_id.slice(0, 8) : null,
  };
}

// ---------------------------------------------------------------------------
// Matching a new report to an open issue
// ---------------------------------------------------------------------------

interface Candidate extends IssueFacts {
  text: string;
  first_place: string;
  mine: boolean;
}

/**
 * Open issues in the township whose reports look like this one: the same type, the same area or shared place and
 * problem words. The model then decides which, if any, is the same problem at the same place; without a model only a
 * strong match counts. Returns the issue to offer the resident ("Add your report to it?"), or null.
 */
export async function findIssueMatch(db: Db, actor: Actor, input: { description: string; locationText: string; zoneId?: string; category?: ReportCategory }, now: Date) {
  const resident = requireVerifiedResident(actor);
  await checkReportInput(db, resident, input);
  const rows = await db.query<Candidate>(
    `${ISSUE_SELECT.replace('FROM report_issue_facts f', `,
            (SELECT string_agg(r.location_text || ' ' || r.description, ' ') FROM reports r WHERE r.issue_id = f.id) AS text,
            (SELECT r.location_text FROM reports r WHERE r.id = f.first_report_id) AS first_place,
            EXISTS (SELECT 1 FROM reports r WHERE r.issue_id = f.id AND r.reporter_id = $2) AS mine
       FROM report_issue_facts f`)}
      WHERE f.township_id = $1 AND f.status IN ('NEW', 'IN_PROGRESS') AND f.updated_at > $3::timestamptz - interval '60 days'
      ORDER BY f.updated_at DESC LIMIT 200`,
    [resident.townshipId, resident.id, now],
  );
  const category = input.category ?? suggestReportByRules(input.description).category;
  const mine = words(`${input.locationText} ${input.description}`);
  const ranked = rows
    .map((issue) => {
      const theirs = words(issue.text);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const sameZone = Boolean(input.zoneId && issue.zone_id === input.zoneId);
      const score = (issue.category === category ? 3 : 0) + (sameZone ? 2 : 0) + Math.min(shared, 3) * 2;
      return { issue, score, shared, sameZone };
    })
    // The same type alone is not enough: it must also share the area or a word.
    .filter(({ score, shared, sameZone }) => score >= 4 && (shared > 0 || sameZone))
    .sort((a, b) => b.score - a.score || b.issue.people - a.issue.people)
    .slice(0, 5);
  if (ranked.length === 0) return null;

  const area = input.zoneId ? (await one<{ name: string }>(db, 'SELECT name FROM flood_zones WHERE id = $1', [input.zoneId]))?.name ?? null : null;
  const picked = await matchIssueByModel(
    { description: input.description, place: input.locationText, area },
    ranked.map(({ issue }) => ({ title: issue.title ?? REPORT_CATEGORY_LABELS[issue.category], type: REPORT_CATEGORY_LABELS[issue.category], area: issue.zone_name, place: issue.first_place })),
  );
  // No model: only a strong match by the rules (same type and two shared words, or the area and words).
  const chosen = picked === undefined ? (ranked[0]!.score >= 7 ? ranked[0]! : null) : picked === null ? null : ranked[picked]!;
  if (!chosen) return null;
  const today = await todayIn(db, now);
  return { issue: present(chosen.issue, today), alreadyYours: chosen.issue.mine };
}

// ---------------------------------------------------------------------------
// Residents: the issues around the township
// ---------------------------------------------------------------------------

/** Around the township: issues still being handled, or ones that were fixed. */
export const AROUND_VIEWS = ['open', 'closed'] as const;

/**
 * Lapor → Around the township: the public issues in the resident's township (enough residents affected, and not
 * closed with no action), with filters, per-type counts and the township's headline figures.
 */
export async function townshipIssues(
  db: Db, actor: Actor,
  filter: { view: (typeof AROUND_VIEWS)[number]; category?: ReportCategory; following?: boolean; q?: string } & PageQuery,
  now: Date,
) {
  const resident = requireVerifiedResident(actor);
  const threshold = await publicThreshold(db);
  const params: unknown[] = [resident.townshipId, resident.id, threshold];
  const q = filter.q?.trim();
  if (q) params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  // % and _ are literal; the pattern is the fourth parameter. Only the written wording and the area are searched.
  const SEARCH = q ? `(f.title ILIKE $4 OR f.title_ms ILIKE $4 OR f.summary ILIKE $4 OR f.summary_ms ILIKE $4 OR z.name ILIKE $4)` : 'TRUE';
  const PUBLIC = `f.township_id = $1 AND f.people >= $3 AND f.status <> 'REJECTED'`;
  const FOLLOWS = `EXISTS (SELECT 1 FROM report_supporters s JOIN reports r ON r.id = s.report_id WHERE r.issue_id = f.id AND s.user_id = $2)`;
  const MINE = `EXISTS (SELECT 1 FROM reports r WHERE r.issue_id = f.id AND r.reporter_id = $2)`;
  const FOLLOWING = filter.following ? `(${FOLLOWS} OR ${MINE})` : 'TRUE';
  // The category is one of REPORT_CATEGORIES (checked by the route), so it is written into the SQL; a bind
  // parameter would break the per-type counts, which leave this filter out.
  const CATEGORY = filter.category ? `f.category = '${filter.category}'` : 'TRUE';
  const ONGOING = `f.status IN ('NEW', 'IN_PROGRESS')`;
  const VIEW = filter.view === 'closed' ? `f.status = 'RESOLVED'` : ONGOING;
  const FROM = `FROM report_issue_facts f LEFT JOIN flood_zones z ON z.id = f.zone_id WHERE ${PUBLIC} AND ${SEARCH}`;

  const [after, afterId] = decodeCursor(filter.cursor, 'time');
  const pageParams = [...params];
  let page = '';
  if (after && afterId) {
    pageParams.push(after, afterId);
    page = `AND (f.created_at, f.id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length}::uuid)`;
  }
  pageParams.push(filter.limit + 1);
  const rows = await db.query<IssueFacts & { following: boolean; mine: boolean }>(
    `${ISSUE_SELECT.replace('FROM report_issue_facts f', `, ${FOLLOWS} AS following, ${MINE} AS mine FROM report_issue_facts f`)}
      WHERE ${PUBLIC} AND ${SEARCH} AND ${VIEW} AND ${CATEGORY} AND ${FOLLOWING} ${page}
      ORDER BY f.created_at DESC, f.id DESC LIMIT $${pageParams.length}`,
    pageParams,
  );
  const counts = await one<{ open: number; closed: number; following: number }>(
    db,
    `SELECT count(*) FILTER (WHERE ${ONGOING} AND ${CATEGORY} AND ${FOLLOWING})::int AS open,
            count(*) FILTER (WHERE f.status = 'RESOLVED' AND ${CATEGORY} AND ${FOLLOWING})::int AS closed,
            count(*) FILTER (WHERE ${VIEW} AND ${CATEGORY} AND (${FOLLOWS} OR ${MINE}))::int AS following
       ${FROM}`,
    params,
  );
  // "$2 IS NOT NULL" keeps the resident's parameter in use (and typed) when the "following" filter is off.
  const byCategory = await db.query<{ category: ReportCategory; n: number }>(
    `SELECT f.category, count(*)::int AS n ${FROM} AND ${VIEW} AND ${FOLLOWING} AND $2::uuid IS NOT NULL GROUP BY f.category`,
    params,
  );
  const categories = Object.fromEntries(REPORT_CATEGORIES.map((c) => [c, 0])) as Record<ReportCategory, number>;
  for (const row of byCategory) categories[row.category] = row.n;

  // The township's headline figures, over the public issues (the resident's own included).
  const kpis = await one<{ open: number; fixed30: number; affected: number; median_days: number | null }>(
    db,
    `SELECT count(*) FILTER (WHERE f.status IN ('NEW', 'IN_PROGRESS'))::int AS open,
            count(*) FILTER (WHERE f.status = 'RESOLVED' AND f.resolved_at > $3::timestamptz - interval '30 days')::int AS fixed30,
            coalesce(sum(f.people) FILTER (WHERE f.status IN ('NEW', 'IN_PROGRESS')), 0)::int AS affected,
            round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f.resolved_at - f.created_at) / 86400)
                  FILTER (WHERE f.status = 'RESOLVED' AND f.resolved_at > $3::timestamptz - interval '90 days'))::int AS median_days
       FROM report_issue_facts f WHERE f.township_id = $1 AND f.people >= $2 AND f.status <> 'REJECTED'`,
    [resident.townshipId, threshold, now],
  );

  const today = await todayIn(db, now);
  const result = toPage(rows, filter.limit, (r) => [r.created_at, r.id]);
  return {
    ...result,
    items: result.items.map((r) => present(r, today)),
    counts: counts ?? { open: 0, closed: 0, following: 0 },
    categories,
    threshold,
    kpis: { open: kpis?.open ?? 0, fixed30: kpis?.fixed30 ?? 0, affected: kpis?.affected ?? 0, medianDays: kpis?.median_days ?? null },
  };
}

/**
 * While a resident writes a report: public open issues that look like the same problem, so they can tap "Me too"
 * instead. Only the written title, type, area and how many residents are affected are shown.
 */
export async function similarIssues(db: Db, actor: Actor, input: { category?: ReportCategory; zoneId?: string; text: string }, now: Date) {
  const resident = requireVerifiedResident(actor);
  const threshold = await publicThreshold(db);
  const rows = await db.query<IssueFacts & { text: string; following: boolean; mine: boolean }>(
    `${ISSUE_SELECT.replace('FROM report_issue_facts f', `,
            (SELECT string_agg(r.location_text || ' ' || r.description, ' ') FROM reports r WHERE r.issue_id = f.id) AS text,
            EXISTS (SELECT 1 FROM report_supporters s JOIN reports r ON r.id = s.report_id WHERE r.issue_id = f.id AND s.user_id = $2) AS following,
            EXISTS (SELECT 1 FROM reports r WHERE r.issue_id = f.id AND r.reporter_id = $2) AS mine
       FROM report_issue_facts f`)}
      WHERE f.township_id = $1 AND f.people >= $3 AND f.status IN ('NEW', 'IN_PROGRESS') AND f.updated_at > $4::timestamptz - interval '60 days'
      ORDER BY f.updated_at DESC LIMIT 200`,
    [resident.townshipId, resident.id, threshold, now],
  );
  const mine = words(input.text);
  const today = await todayIn(db, now);
  return rows
    .map((issue) => {
      const theirs = words(issue.text);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      const sameZone = Boolean(input.zoneId && issue.zone_id === input.zoneId);
      const score = (input.category && issue.category === input.category ? 3 : 0) + (sameZone ? 2 : 0) + Math.min(shared, 3) * 2;
      return { issue, score, shared, sameZone };
    })
    .filter(({ score, shared, sameZone, issue }) => !issue.mine && score >= 4 && (shared > 0 || sameZone))
    .sort((a, b) => b.score - a.score || b.issue.people - a.issue.people)
    .slice(0, 3)
    .map(({ issue }) => present(issue, today));
}

/**
 * "Me too" on an issue: the resident follows it and counts as affected. It earns no XP. Reporting residents are
 * already counted, and a closed issue cannot be joined. Turning it off removes them from every report in the issue.
 */
export async function setIssueMeToo(db: Db, actor: Actor, issueId: string, on: boolean, now: Date) {
  const resident = requireVerifiedResident(actor);
  return db.tx(async (tx) => {
    await tx.query('SELECT 1 FROM report_issues WHERE id = $1 FOR UPDATE', [issueId]);
    const issue = await issueFacts(tx, issueId);
    if (!issue || issue.township_id !== resident.townshipId) throw notFound('Issue');
    if (await one(tx, 'SELECT 1 FROM reports WHERE issue_id = $1 AND reporter_id = $2', [issueId, resident.id])) {
      throw ruleViolation('OWN_REPORT', 'You reported this problem, so you already hear every update.');
    }
    if (on) {
      if (!OPEN.includes(issue.status)) throw ruleViolation('REPORT_CLOSED', 'This problem is already fixed or closed.');
      await tx.query('INSERT INTO report_supporters (report_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [issue.first_report_id, resident.id, now]);
      await afterJoin(tx, issueId, issue.people);
    } else {
      await tx.query('DELETE FROM report_supporters s USING reports r WHERE r.id = s.report_id AND r.issue_id = $1 AND s.user_id = $2', [issueId, resident.id]);
    }
    return { affected: (await issueFacts(tx, issueId))!.people, following: on };
  });
}

// ---------------------------------------------------------------------------
// Staff: Needs attention
// ---------------------------------------------------------------------------

/** HQ may look at any township, or all of them; everyone else only at their own. */
const scopeOf = (actor: Actor) => (actor.role === 'HQ_ADMIN' ? null : actor.townshipId);

/**
 * The issues that need the township office: still open, and either reached the public threshold or urgent. Urgent
 * first, then late, then the most residents affected. Each comes with its reports (staff see residents' words and
 * photos), and the count of issues still below the threshold.
 */
export async function attentionIssues(db: Db, actor: Actor, now: Date) {
  const township = scopeOf(actor);
  const threshold = await publicThreshold(db);
  const today = await todayIn(db, now);
  const rows = await db.query<IssueFacts>(
    `${ISSUE_SELECT}
      WHERE ($1::uuid IS NULL OR f.township_id = $1) AND f.status IN ('NEW', 'IN_PROGRESS') AND (f.people >= $2 OR f.urgent)
      ORDER BY f.urgent DESC, (f.target_date IS NOT NULL AND f.target_date < $3::date) DESC, f.people DESC, f.created_at
      LIMIT 100`,
    [township, threshold, today],
  );
  const reports = rows.length
    ? await db.query<{
      id: string; issue_id: string; description: string; location_text: string; urgency: Urgency; status: ReportStatus; photo_id: string | null; created_at: Date; affected: number;
    }>(
      `SELECT r.id, r.issue_id, r.description, r.location_text, r.urgency, r.status, r.photo_id, r.created_at,
              1 + (SELECT count(*)::int FROM report_supporters s WHERE s.report_id = r.id) AS affected
         FROM reports r WHERE r.issue_id = ANY($1::uuid[]) ORDER BY r.created_at`,
      [rows.map((r) => r.id)],
    )
    : [];
  const below = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM report_issue_facts f
      WHERE ($1::uuid IS NULL OR f.township_id = $1) AND f.status IN ('NEW', 'IN_PROGRESS') AND f.people < $2 AND NOT f.urgent`,
    [township, threshold],
  );
  return {
    threshold,
    belowThreshold: below?.n ?? 0,
    items: rows.map((f) => ({
      ...present(f, today),
      title_source: f.title_source,
      assigned_to: f.assigned_to,
      reached: f.people >= threshold,
      photo_report_id: f.photo_report_id,
      photo_choice: f.photo_choice,
      photo_hidden: f.photo_hidden,
      members: reports.filter((r) => r.issue_id === f.id).map(({ issue_id: _issue, ...r }) => (void _issue, r)),
    })),
  };
}

export interface IssueUpdate extends ReportUpdate {
  /** The public title, corrected by staff; an empty string goes back to the written one. */
  title?: string;
  titleMs?: string;
  /** The report whose photo neighbours see; null goes back to the first photo. */
  photoReportId?: string | null;
  photoHidden?: boolean;
}

/**
 * Staff update a whole issue at once: the status, type, urgency, team, date and note reach every report in it that
 * is still open (each reporter and follower is told, as for a single report). A corrected title is kept from then
 * on, and logged.
 */
export async function updateIssue(db: Db, actor: Actor, issueId: string, update: IssueUpdate, now: Date) {
  if (!isStaff(actor)) throw notFound('Issue');
  return db.tx(async (tx: Queryable) => {
    const issue = await one<{ township_id: string; title: string | null; title_ms: string | null }>(tx, 'SELECT township_id, title, title_ms FROM report_issues WHERE id = $1 FOR UPDATE', [issueId]);
    if (!issue || (actor.role !== 'HQ_ADMIN' && issue.township_id !== actor.townshipId)) throw notFound('Issue');
    const { title, titleMs, photoReportId, photoHidden, ...reportUpdate } = update;
    if (photoReportId !== undefined || photoHidden !== undefined) {
      if (photoReportId && !(await one(tx, 'SELECT 1 FROM reports WHERE id = $1 AND issue_id = $2 AND photo_id IS NOT NULL', [photoReportId, issueId]))) {
        throw ruleViolation('NO_SUCH_PHOTO', 'Choose a photo from one of the reports in this problem.');
      }
      const before = await one<{ photo_report_id: string | null; photo_hidden: boolean }>(tx, 'SELECT photo_report_id, photo_hidden FROM report_issues WHERE id = $1', [issueId]);
      const next = { photoReportId: photoReportId === undefined ? before!.photo_report_id : photoReportId, photoHidden: photoHidden ?? before!.photo_hidden };
      if (next.photoReportId !== before!.photo_report_id || next.photoHidden !== before!.photo_hidden) {
        await tx.query('UPDATE report_issues SET photo_report_id = $2, photo_hidden = $3 WHERE id = $1', [issueId, next.photoReportId, next.photoHidden]);
        await audit(tx, actor.id, 'ISSUE_PHOTO', 'report_issue', issueId, { from: { photoReportId: before!.photo_report_id, photoHidden: before!.photo_hidden }, to: next });
      }
    }
    if (title !== undefined || titleMs !== undefined) {
      const nextTitle = title === undefined ? issue.title : title.trim() || null;
      const nextMs = titleMs === undefined ? issue.title_ms : titleMs.trim() || null;
      await tx.query(
        `UPDATE report_issues SET title = $2, title_ms = $3, title_source = CASE WHEN $2::text IS NULL THEN NULL ELSE 'STAFF' END, updated_at = $4 WHERE id = $1`,
        [issueId, nextTitle, nextMs, now],
      );
      await audit(tx, actor.id, 'ISSUE_TITLE', 'report_issue', issueId, { from: { title: issue.title, titleMs: issue.title_ms }, to: { title: nextTitle, titleMs: nextMs } });
    }
    if (Object.values(reportUpdate).some((v) => v !== undefined)) {
      const members = await tx.query<{ id: string }>(`SELECT id FROM reports WHERE issue_id = $1 AND status IN ('NEW', 'IN_PROGRESS') ORDER BY created_at`, [issueId]);
      if (members.length === 0) throw ruleViolation('REPORT_CLOSED', 'Every report in this issue is already closed.');
      for (const member of members) await applyReportUpdate(tx, actor, member.id, reportUpdate, now);
      if (reportUpdate.category) await tx.query('UPDATE report_issues SET category = $2 WHERE id = $1', [issueId, reportUpdate.category]);
    }
    return { ok: true };
  });
}

/**
 * The photo neighbours see on a public issue: staff's pick, or the first report's photo, unless staff hid it.
 * Residents get it only from a public issue in their own township (as on Reports around the township); staff of
 * the township, and HQ, from any issue.
 */
export async function getIssuePhoto(db: Db, actor: Actor, issueId: string): Promise<Response> {
  const facts = await issueFacts(db, issueId);
  if (!facts || (actor.role !== 'HQ_ADMIN' && facts.township_id !== actor.townshipId)) throw notFound('Photo');
  if (!isStaff(actor)) {
    requireVerifiedResident(actor);
    if (facts.people < (await publicThreshold(db)) || facts.status === 'REJECTED') throw notFound('Photo');
  }
  const upload = facts.photo_report_id
    ? await one<{ mime: string; bytes: Uint8Array }>(db, 'SELECT u.mime, u.bytes FROM reports r JOIN uploads u ON u.id = r.photo_id WHERE r.id = $1', [facts.photo_report_id])
    : undefined;
  if (!upload) throw notFound('Photo');
  return photoResponse(upload);
}

/** For tests and the console: one issue's figures as staff see them. */
export async function getIssue(q: Queryable, actor: Actor, issueId: string) {
  const facts = await issueFacts(q, issueId);
  if (!facts || (actor.role !== 'HQ_ADMIN' && facts.township_id !== actor.townshipId)) throw notFound('Issue');
  return facts;
}
