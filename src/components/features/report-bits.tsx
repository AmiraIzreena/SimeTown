
import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';
import { Badge } from '@/components/ui/card';
import { REPORT_CATEGORY_LABELS, type ReportCategory, type ReportStatus, type Urgency } from '@/shared/domain';

export interface Report {
  id: string;
  category: ReportCategory;
  urgency: Urgency;
  ai_category: ReportCategory | null;
  ai_urgency: Urgency | null;
  ai_source: 'MODEL' | 'RULES' | null;
  description: string;
  location_text: string;
  photo_id: string | null;
  status: ReportStatus;
  staff_note: string | null;
  created_at: string;
  updated_at: string;
  zone_name: string | null;
}

export const STATUS_LABELS: Record<ReportStatus, string> = { NEW: 'Received', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', REJECTED: 'Closed, no action' };
const STATUS_TONES = { NEW: 'brand', IN_PROGRESS: 'warning', RESOLVED: 'success', REJECTED: 'neutral' } as const;
const URGENCY_TONES = { LOW: 'neutral', MEDIUM: 'brand', HIGH: 'warning', URGENT: 'danger' } as const;
export const URGENCY_LABELS: Record<Urgency, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };

export const StatusBadge = ({ status }: { status: ReportStatus }) => <Badge tone={STATUS_TONES[status]}><Text>{STATUS_LABELS[status]}</Text></Badge>;
export const UrgencyBadge = ({ urgency }: { urgency: Urgency }) => <Badge tone={URGENCY_TONES[urgency]}><Text>{`${URGENCY_LABELS[urgency]} urgency`}</Text></Badge>;
export const categoryLabel = (category: ReportCategory) => REPORT_CATEGORY_LABELS[category];

/** The reporter's photo, served only to them and to township staff. */
export function ReportPhoto({ report }: { report: Report }) {
  if (!report.photo_id) return null;
  return <LocalizedImg src={`/api/v1/reports/${report.id}/photo`} alt="Photo attached to this report" loading="lazy" className="max-h-72 w-full rounded-lg border border-ink-200 object-cover" />;
}
