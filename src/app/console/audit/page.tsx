'use client';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { DataTable } from '@/components/ui/table';
import { STATUS_LABELS, URGENCY_LABELS } from '@/components/features/report-bits';
import { formatDateTime } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { formatPoints, formatRM, REPORT_CATEGORY_LABELS, ROLE_LABELS, type ReportCategory, type ReportStatus, type Role, type Urgency } from '@/shared/domain';

interface Entry {
  id: number;
  action: string;
  entity_type: string;
  subject: string | null;
  detail: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
  actor_role: Role | null;
}

/** Turns SOME_ACTION into "Some action". */
const words = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).toLowerCase().replaceAll('_', ' ');
/** Turns amountSen into "Amount sen". */
const keyWords = (key: string) => words(key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase());

const ACTION_LABELS: Record<string, string> = {
  AI_OVERRIDE: 'AI suggestion corrected',
  REPORT_STATUS: 'Report status changed',
  FLOOD_STATUS: 'Flood status changed',
  SETTINGS_CHANGED: 'Programme rules changed',
  FLOAT_CHECK_FAILED: 'Float check failed',
  ADMIN_ACCOUNT_REQUESTED: 'Admin account requested',
  PASSWORD_RESET_REQUESTED: 'New password link requested',
  INVITE_ISSUED: 'Set-password link issued',
};

const ENTITY_LABELS: Record<string, string> = {
  merchant: 'Shop',
  user: 'Account',
  program_settings: 'Programme rules',
  community_pool: 'Community pool',
  float: 'Reward float',
  account_request: 'Account request',
};

const reportLabel = (value: { category?: ReportCategory; urgency?: Urgency } | undefined) =>
  value?.category && value.urgency ? `${REPORT_CATEGORY_LABELS[value.category]}, ${URGENCY_LABELS[value.urgency].toLowerCase()} urgency` : '?';

/** One value, in the words a person would use: money in RM, rates in %, status codes as words. */
function valueText(key: string, value: unknown): string {
  if (typeof value === 'number') {
    if (/(Sen|_sen)$/.test(key)) return formatRM(value);
    if (key.endsWith('_bps')) return `${value / 100}%`;
    if (/(Pct|_pct)$/.test(key)) return `${value}%`;
    if (key === 'points') return `${value > 0 ? '+' : ''}${formatPoints(value)}`;
    return formatPoints(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (key === 'role' && value in ROLE_LABELS) return ROLE_LABELS[value as Role];
    // Only known code fields; free text such as a bank reference is shown exactly as recorded.
    return key === 'status' ? words(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => valueText(key, item)).join('; ');
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
    const change = value as { from: unknown; to: unknown };
    return `${valueText(key, change.from)} → ${valueText(key, change.to)}`;
  }
  return value === null || value === undefined ? '–' : JSON.stringify(value);
}

/** The entry's detail as a short sentence instead of raw JSON. */
function describe(e: Entry): string {
  const d = e.detail;
  switch (e.action) {
    case 'REPORT_STATUS':
      return `${STATUS_LABELS[d.from as ReportStatus] ?? d.from} → ${STATUS_LABELS[d.to as ReportStatus] ?? d.to}`;
    case 'AI_OVERRIDE':
      return `AI suggested ${reportLabel(d.suggested as never)} · staff set ${reportLabel(d.set as never)}`;
    case 'FLOOD_STATUS':
      return `${valueText('status', d.from)} → ${valueText('status', d.to)} · water at ${d.levelPct}% · ${d.source === 'SENSOR' ? 'from sensor' : 'set by staff'}`;
    case 'SETTINGS_CHANGED':
      return Object.entries(d).map(([key, change]) => `${words(key.replace(/_(bps|pct)$/, '').toUpperCase())}: ${valueText(key, change)}`).join(' · ');
  }
  const parts = Object.entries(d)
    // The name is already shown in the "On" column.
    .filter(([key, value]) => !((key === 'name' || key === 'title') && value === e.subject))
    .map(([key, value]) => `${keyWords(key.replace(/Sen$/, ''))}: ${valueText(key, value)}`);
  return parts.length ? parts.join(' · ') : '–';
}

export default function AuditPage() {
  const log = usePaged<Entry>('/admin/audit?limit=30');
  return (
    <>
      <PageHeader title="Audit trail" description="Who did what: approvals, money recorded, corrections to AI suggestions, settings changes. Entries cannot be edited." />
      {log.error ? (
        <ErrorState error={log.error} onRetry={() => void log.reload()} />
      ) : log.isLoading ? (
        <SkeletonList rows={5} />
      ) : log.items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <DataTable
          caption="Audit trail"
          rows={log.items}
          keyOf={(e) => e.id}
          columns={[
            { header: 'When', cell: (e) => formatDateTime(e.created_at) },
            { header: 'Who', cell: (e) => (e.actor_name ? `${e.actor_name}${e.actor_role ? ` (${ROLE_LABELS[e.actor_role]})` : ''}` : 'System') },
            { header: 'What', cell: (e) => <span className="font-medium text-ink-900">{ACTION_LABELS[e.action] ?? words(e.action)}</span> },
            {
              header: 'On',
              desktopOnly: true,
              cell: (e) => {
                const kind = ENTITY_LABELS[e.entity_type] ?? words(e.entity_type);
                return e.subject ? (
                  <>
                    <span className="block text-ink-900">{e.subject}</span>
                    <span className="block text-xs text-ink-500">{kind}</span>
                  </>
                ) : (
                  kind
                );
              },
            },
            { header: 'Details', desktopOnly: true, cell: (e) => <span className="wrap-break-word text-sm text-ink-600">{describe(e)}</span> },
          ]}
        />
      )}
      {log.hasMore && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => void log.loadMore()} pending={log.loadingMore}>
            Show more
          </Button>
        </div>
      )}
    </>
  );
}
