import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';
import { Check, Eye, Users } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { REPORT_CATEGORY_LABELS, type ReportCategory, type ReportStatus, type Urgency } from '@/shared/domain';

export interface Report {
  id: string;
  category: ReportCategory;
  urgency: Urgency;
  ai_category: ReportCategory | null;
  ai_urgency: Urgency | null;
  ai_source: 'MODEL' | 'RULES' | null;
  /** Null when the report is someone else's, followed with "Me too". */
  description: string | null;
  location_text: string;
  photo_id: string | null;
  status: ReportStatus;
  staff_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  zone_name: string | null;
  checked_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  target_date: string | null;
  fixed_photo_id: string | null;
  affected: number;
  mine: boolean;
  late: boolean;
  /** The issue this report is grouped into: how many residents it affects, and how many make it public. */
  issue_id?: string;
  issue_people?: number;
  issue_reports?: number;
  issue_threshold?: number;
}

/** A Lapor issue as residents see it: the written title and summary, never anyone's own words. */
export interface Issue {
  id: string;
  category: ReportCategory;
  zone_name: string | null;
  title: string | null;
  title_ms: string | null;
  summary: string | null;
  summary_ms: string | null;
  status: ReportStatus;
  people: number;
  reports: number;
  urgent: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  target_date: string | null;
  late: boolean;
  following: boolean;
  mine: boolean;
}

export const STATUS_LABELS: Record<ReportStatus, string> = { NEW: 'Received', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', REJECTED: 'Closed, no action' };
const STATUS_TONES = { NEW: 'brand', IN_PROGRESS: 'warning', RESOLVED: 'success', REJECTED: 'neutral' } as const;
const URGENCY_TONES = { LOW: 'neutral', MEDIUM: 'brand', HIGH: 'warning', URGENT: 'danger' } as const;
export const URGENCY_LABELS: Record<Urgency, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };

export const StatusBadge = ({ status }: { status: ReportStatus }) => <Badge tone={STATUS_TONES[status]}><Text>{STATUS_LABELS[status]}</Text></Badge>;
export const UrgencyBadge = ({ urgency }: { urgency: Urgency }) => <Badge tone={URGENCY_TONES[urgency]}><Text>{`${URGENCY_LABELS[urgency]} urgency`}</Text></Badge>;
export const categoryLabel = (category: ReportCategory) => REPORT_CATEGORY_LABELS[category];

/** "3 residents affected": how many people have this problem, the reporter included. */
export function AffectedBadge({ affected }: { affected: number }) {
  if (affected < 2) return null;
  return (
    <Badge tone="gold">
      <Users className="mr-1 inline size-3.5" aria-hidden />
      <Text>{`${affected} residents affected`}</Text>
    </Badge>
  );
}

/** An issue's title in the reader's language; without a written one, its type and area. */
export function IssueTitle({ issue }: { issue: Pick<Issue, 'category' | 'zone_name' | 'title' | 'title_ms'> }) {
  const lang = useLang();
  const written = lang === 'ms' ? issue.title_ms ?? issue.title : issue.title;
  if (written) return <>{written}</>;
  return <><Text>{REPORT_CATEGORY_LABELS[issue.category]}</Text>{issue.zone_name && <> · <Text>{issue.zone_name}</Text></>}</>;
}

/** An issue's one-line summary in the reader's language, or nothing. */
export function IssueSummary({ issue, className }: { issue: Pick<Issue, 'summary' | 'summary_ms'>; className?: string }) {
  const lang = useLang();
  const written = lang === 'ms' ? issue.summary_ms ?? issue.summary : issue.summary;
  return written ? <p className={className}>{written}</p> : null;
}

/** On a resident's own report: whether neighbours can see it yet, or how many residents it has so far. */
export function IssueReach({ report }: { report: Pick<Report, 'issue_people' | 'issue_threshold'> }) {
  const { issue_people: people, issue_threshold: threshold } = report;
  if (people === undefined || threshold === undefined) return null;
  return people >= threshold ? (
    <Badge tone="success"><Eye className="mr-1 inline size-3.5" aria-hidden /><Text>Neighbours can see this</Text></Badge>
  ) : (
    <Badge tone="neutral"><Users className="mr-1 inline size-3.5" aria-hidden /><Text>{`${people} of ${threshold} residents`}</Text></Badge>
  );
}

export const LateBadge = ({ late }: { late: boolean }) => (late ? <Badge tone="danger"><Text>Late</Text></Badge> : null);

/** The reporter's photo, served only to them and to township staff. */
export function ReportPhoto({ report }: { report: Pick<Report, 'id' | 'photo_id'> }) {
  if (!report.photo_id) return null;
  return <LocalizedImg src={`/api/v1/reports/${report.id}/photo`} alt="Photo attached to this report" loading="lazy" className="max-h-72 w-full rounded-lg border border-ink-200 object-cover" />;
}

/** The photo staff took of the fix, for everyone following the report. */
export function FixedPhoto({ report }: { report: Report }) {
  if (!report.fixed_photo_id) return null;
  return (
    <figure className="space-y-1.5">
      <LocalizedImg src={`/api/v1/reports/${report.id}/fixed-photo?v=${report.fixed_photo_id}`} alt="Photo of the fix" loading="lazy" className="max-h-72 w-full rounded-lg border border-success-600/30 object-cover" />
      <figcaption className="text-xs text-ink-500"><Text>Photo of the fix, from the township team</Text></figcaption>
    </figure>
  );
}

/**
 * Where the report is, like a parcel being tracked: received, checked by staff,
 * assigned with a target date, fixed. Every step is a notification too.
 */
export function ReportProgress({ report }: { report: Report }) {
  const rejected = report.status === 'REJECTED';
  const fixed = report.status === 'RESOLVED';
  const assigned = Boolean(report.assigned_to || report.target_date);
  const steps: { key: string; label: string; done: boolean; detail: string | null }[] = [
    { key: 'received', label: 'Reported', done: true, detail: formatDateTime(report.created_at) },
    { key: 'checked', label: 'Checked by staff', done: Boolean(report.checked_at) || fixed, detail: report.checked_at ? formatDateTime(report.checked_at) : null },
    {
      key: 'assigned',
      label: report.assigned_to ? `Assigned to ${report.assigned_to}` : 'Assigned to a team',
      done: assigned || fixed,
      detail: report.target_date ? `Target: ${formatDate(report.target_date)}` : null,
    },
    { key: 'fixed', label: rejected ? 'Closed without action' : 'Fixed', done: fixed || rejected, detail: report.resolved_at ? formatDateTime(report.resolved_at) : null },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="report-progress">
      {steps.map((step, i) => (
        <li key={step.key} className={cn('report-progress-step', step.done && 'is-done', i === current && 'is-current', i === current && report.late && 'is-late')}>
          <span className="report-progress-dot" aria-hidden>{step.done ? <Check className="size-3.5" /> : null}</span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-ink-900"><Text>{step.label}</Text></span>
            {step.detail && <span className="block text-sm text-ink-500"><Text>{step.detail}</Text></span>}
            {i === current && report.late && <span className="block text-sm font-semibold text-accent-700"><Text>Past the target date. It shows as late to the township team.</Text></span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
