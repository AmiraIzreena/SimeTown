'use client';

import { Text } from '@/components/ui/localized-text';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { DataTable } from '@/components/ui/table';
import { STATUS_LABELS, URGENCY_LABELS } from '@/components/features/report-bits';
import { formatDateTime } from '@/lib/format';
import { usePaged } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useMinLoading } from '@/lib/use-min-loading';
import { AUDIT_ACTORS, AUDIT_AREA_LABELS, AUDIT_AREAS, AUDIT_PERIOD_LABELS, AUDIT_PERIODS, type AuditActor, type AuditArea, type AuditPeriod } from '@/shared/audit';
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

type Translator = (text: string) => string;
const reportLabel = (value: { category?: ReportCategory; urgency?: Urgency } | undefined, t: Translator) =>
  value?.category && value.urgency ? `${t(REPORT_CATEGORY_LABELS[value.category])}, ${t(`${URGENCY_LABELS[value.urgency]} urgency`)}` : '?';

/** One value, in the words a person would use: money in RM, rates in %, status codes as words. */
function valueText(key: string, value: unknown, t: Translator): string {
  if (typeof value === 'number') {
    if (/(Sen|_sen)$/.test(key)) return formatRM(value);
    if (key.endsWith('_bps')) return `${value / 100}%`;
    if (/(Pct|_pct)$/.test(key)) return `${value}%`;
    if (key === 'points') return `${value > 0 ? '+' : ''}${formatPoints(value)}`;
    return formatPoints(value);
  }
  if (typeof value === 'boolean') return t(value ? 'Yes' : 'No');
  if (typeof value === 'string') {
    if (key === 'role' && value in ROLE_LABELS) return t(ROLE_LABELS[value as Role]);
    // Only known code fields; free text such as a bank reference is shown exactly as recorded.
    return ['status', 'kind', 'tier', 'decision', 'occupancy'].includes(key) ? t(words(value)) : value;
  }
  if (Array.isArray(value)) return value.map((item) => valueText(key, item, t)).join('; ');
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
    const change = value as { from: unknown; to: unknown };
    return `${valueText(key, change.from, t)} → ${valueText(key, change.to, t)}`;
  }
  return value === null || value === undefined ? '–' : JSON.stringify(value);
}

/** The entry's detail as a short sentence instead of raw JSON. */
function describe(e: Entry, t: Translator): string {
  const d = e.detail;
  switch (e.action) {
    case 'REPORT_STATUS':
      return `${t(String(STATUS_LABELS[d.from as ReportStatus] ?? d.from))} → ${t(String(STATUS_LABELS[d.to as ReportStatus] ?? d.to))}`;
    case 'AI_OVERRIDE':
      return t(`AI suggested ${reportLabel(d.suggested as never, t)} · staff set ${reportLabel(d.set as never, t)}`);
    case 'FLOOD_STATUS':
      return t(`${valueText('status', d.from, t)} → ${valueText('status', d.to, t)} · water at ${d.levelPct}% · ${t(d.source === 'SENSOR' ? 'from sensor' : 'set by staff')}`);
    case 'SETTINGS_CHANGED':
      return Object.entries(d).map(([key, change]) => `${t(words(key.replace(/_(bps|pct)$/, '').toUpperCase()))}: ${valueText(key, change, t)}`).join(' · ');
  }
  const parts = Object.entries(d)
    // The name is already shown in the "On" column.
    .filter(([key, value]) => !((key === 'name' || key === 'title') && value === e.subject))
    .map(([key, value]) => `${t(keyWords(key.replace(/Sen$/, '')))}: ${valueText(key, value, t)}`);
  return parts.length ? parts.join(' · ') : '–';
}

type Area = AuditArea | 'ALL';
type Who = AuditActor | '';
type Period = AuditPeriod | '';
type Sort = 'NEWEST' | 'OLDEST';
type Counts = Record<AuditArea | 'all', number>;

export default function AuditPage() {
  const t = useT();
  const [area, setArea] = useState<Area>('ALL');
  const [who, setWho] = useState<Who>('');
  const [period, setPeriod] = useState<Period>('');
  const [sort, setSort] = useState<Sort>('NEWEST');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());

  const params = new URLSearchParams({ limit: '30', ...(search ? { q: search } : {}), ...(area !== 'ALL' ? { area } : {}), ...(who ? { actor: who } : {}), ...(period ? { period } : {}), ...(sort !== 'NEWEST' ? { sort } : {}) }).toString();
  const path = `/admin/audit?${params}`;
  const log = usePaged<Entry, { counts: Counts }>(path);
  const typing = q.trim() !== search;
  // Only the results show a skeleton, for at least 600ms per new search or filter, so nothing flashes.
  const loading = useMinLoading(`${path}${typing ? '~' : ''}`, log.isLoading || typing);
  const counts = loading ? undefined : log.first?.counts;
  const filtered = area !== 'ALL' || Boolean(who || period || q) || sort !== 'NEWEST';
  const clear = () => { setArea('ALL'); setWho(''); setPeriod(''); setSort('NEWEST'); setQ(''); };

  return (
    <div className='space-y-4'>
      <PageHeader title='Audit trail' description='Who did what: approvals, money recorded, corrections to AI suggestions, settings changes. Entries cannot be edited.' />
      <FilterBar
        search={<SearchField value={q} onChange={setQ} label='Search the audit trail' placeholder='Person, item, action or reference, e.g. Nurul, Kopi Hijau or TEST-KOPI-002' />}
        chips={
          <FilterChips<Area>
            label='Area'
            value={area}
            onChange={setArea}
            options={[
              { key: 'ALL', label: 'All activity', count: counts?.all },
              ...AUDIT_AREAS.map((key) => ({ key, label: AUDIT_AREA_LABELS[key], count: counts?.[key] })),
            ]}
          />
        }
        controls={
          <>
            <FilterMenu<Who> label='Who' value={who} onChange={setWho} options={[
              { value: '', label: 'Anyone' },
              ...AUDIT_ACTORS.map((value) => ({ value, label: value === 'SYSTEM' ? 'System (automatic)' : ROLE_LABELS[value] })),
            ]} />
            <FilterMenu<Period> label='When' value={period} onChange={setPeriod} options={[
              { value: '', label: 'Any time' },
              ...AUDIT_PERIODS.map((value) => ({ value, label: AUDIT_PERIOD_LABELS[value] })),
            ]} />
            <FilterMenu<Sort> label='Sort' value={sort} onChange={setSort} options={[
              { value: 'NEWEST', label: 'Newest first' },
              { value: 'OLDEST', label: 'Oldest first' },
            ]} />
          </>
        }
        summary={counts ? <FilterSummary shown={area === 'ALL' ? counts.all : counts[area]} total={counts.all} noun='entries' onClear={filtered ? clear : undefined} /> : undefined}
      />
      {log.error ? (
        <ErrorState error={log.error} onRetry={() => void log.reload()} />
      ) : loading ? (
        <SkeletonList rows={5} />
      ) : log.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={Search} title='No entries match'><Text>Try another name, area or time period.</Text></EmptyState>
        ) : (
          <EmptyState title='Nothing recorded yet' />
        )
      ) : (
        <div className='content-in'>
        <DataTable
          caption='Audit trail'
          rows={log.items}
          keyOf={(e) => e.id}
          columns={[
            { header: 'When', cell: (e) => formatDateTime(e.created_at) },
            { header: 'Who', cell: (e) => (e.actor_name ? `${e.actor_name}${e.actor_role ? ` (${t(ROLE_LABELS[e.actor_role])})` : ''}` : t('System')) },
            { header: 'What', cell: (e) => <span className='font-medium text-ink-900'><Text>{ACTION_LABELS[e.action] ?? words(e.action)}</Text></span> },
            {
              header: 'On',
              desktopOnly: true,
              cell: (e) => {
                const kind = ENTITY_LABELS[e.entity_type] ?? words(e.entity_type);
                return e.subject ? (
                  <>
                    <span className='block text-ink-900'>{e.subject}</span>
                    <span className='block text-xs text-ink-500'><Text>{kind}</Text></span>
                  </>
                ) : (
                  kind
                );
              },
            },
            { header: 'Details', desktopOnly: true, cell: (e) => <span className='wrap-break-word text-sm text-ink-600'>{describe(e, t)}</span> },
          ]}
        />
        </div>
      )}
      {!loading && log.hasMore && (
        <div className='mt-1 text-center'>
          <Button variant='secondary' onClick={() => void log.loadMore()} pending={log.loadingMore}><Text>Show more</Text></Button>
        </div>
      )}
    </div>
  );
}
