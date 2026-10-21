'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg } from '@/components/ui/localized-elements';

import { AlertTriangle, ArrowRight, CheckCircle2, Flag, Hand, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { REPORT_CATEGORY_LABELS, type ReportCategory } from '@/shared/domain';
import {
  AWAITING_LABELS, CATEGORY_LABELS, INCIDENT_STATUS_LABELS, MODULE_LABELS, PRIORITY_LABELS, RESOLUTION_CATEGORIES, RESOLUTION_LABELS,
  type Awaiting, type IncidentModule, type IncidentStatus, type Priority, type ResolutionCategory,
} from '@/shared/incidents';
import { PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

interface Row {
  id: string; reference: string; module: IncidentModule; kind: string; priority: Priority; status: IncidentStatus; summary: string; created_at: string; updated_at: string;
  assign_due_at: string | null; resolve_due_at: string | null; escalated_at: string | null; awaiting: Awaiting | null; owner: string | null; owner_id: string | null;
  station: string | null; overdue: boolean; unassigned_late: boolean;
}
interface LaporRow { id: string; category: string; status: string; location_text: string; created_at: string; assigned_to: string | null; target_date: string | null; overdue: boolean }
interface Board {
  metrics: { open: number; unassigned: number; mine: number; investigating: number; awaiting: number; overdue: number; critical: number; resolved_30d: number; courierReferrals30d: number; laporOpen: number; laporLate: number };
  incidents: Row[];
  lapor: LaporRow[];
  staff: { id: string; full_name: string; role: string }[];
  me: string;
  isAdmin: boolean;
}

const PRIORITY_TONE: Record<Priority, 'danger' | 'warning' | 'brand' | 'neutral'> = { CRITICAL: 'danger', HIGH: 'warning', NORMAL: 'brand', LOW: 'neutral' };
const STATUS_TONE: Record<IncidentStatus, 'gold' | 'brand' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  OPEN: 'gold', ASSIGNED: 'brand', INVESTIGATING: 'brand', AWAITING_EXTERNAL_PARTY: 'warning', RESOLVED: 'success', REOPENED: 'danger', CLOSED: 'neutral',
};

/** The case's time limit in words: how long is left to take or resolve it, or that it is late. */
export function dueText(r: Pick<Row, 'status' | 'unassigned_late' | 'overdue' | 'owner_id' | 'resolve_due_at' | 'assign_due_at'>) {
  if (r.status === 'RESOLVED' || r.status === 'CLOSED') return null;
  if (r.unassigned_late) return { late: true, text: 'Not taken in time' };
  if (r.overdue) return { late: true, text: 'Past its deadline' };
  const due = r.owner_id ? r.resolve_due_at : r.assign_due_at;
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
  return { late: false, text: r.owner_id ? `Resolve within ${h > 0 ? `${h} h ` : ''}${m} min` : `Take within ${h > 0 ? `${h} h ` : ''}${m} min` };
}

/** The areas a case belongs to, as the board's filter offers them. Smart locker cases include the courier platform's. */
export const CASE_AREAS = ['LOCKERS,COURIERS', 'LOCKERS', 'PARCELS', 'GUARDHOUSE', 'COURIERS', 'FACILITIES', 'COMMUNITY', 'KITAR', 'GERAK', 'LAPOR'] as const;
export const PARCEL_MODULES: IncidentModule[] = ['PARCELS', 'LOCKERS', 'COURIERS'];
// Console Lapor → Gate & community cases also holds the Kitar and Gerak reports residents send from those pages.
export const COMMUNITY_MODULES: IncidentModule[] = ['GUARDHOUSE', 'FACILITIES', 'COMMUNITY', 'KITAR', 'GERAK'];
export type CaseArea = (typeof CASE_AREAS)[number];
const AREA_LABELS: Record<CaseArea, string> = { 'LOCKERS,COURIERS': 'Smart lockers & couriers', ...MODULE_LABELS };

/**
 * The township's cases: counts, filters, the list, and each case in full.
 * Only the central Incidents page shows it; the Smart lockers and Parcels
 * pages show a CaseSummary that links here with the filter already set.
 * Courier referrals are counted apart, never as cases; Lapor's reports are
 * listed read-only with a link to Lapor.
 */
type CaseView = 'OPEN' | 'UNASSIGNED' | 'MINE' | 'LATE' | 'RESOLVED' | 'ALL';
const ACTIVE_STATUS_ORDER: IncidentStatus[] = ['OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_PARTY', 'REOPENED'];
const ALL_STATUSES: IncidentStatus[] = [...ACTIVE_STATUS_ORDER, 'RESOLVED', 'CLOSED'];

export function IncidentBoard({ modules, showLapor = false, openRef, initialArea = '', initialDisputed = false, initialOverdue = false }: {
  modules?: IncidentModule[];
  showLapor?: boolean; openRef?: string | null; initialArea?: '' | CaseArea; initialDisputed?: boolean; initialOverdue?: boolean;
}) {
  const allowedAreas = CASE_AREAS.filter((area) => modules ? area.split(',').every((part) => modules.includes(part as IncidentModule)) : area !== 'LAPOR' || showLapor);
  const [disputed, setDisputed] = useState(initialDisputed && (!modules || modules.includes('PARCELS')));
  const [view, setView] = useState<CaseView>(initialDisputed ? 'ALL' : initialOverdue ? 'LATE' : 'OPEN');
  const [statusDetail, setStatusDetail] = useState<'' | IncidentStatus>('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [staffOwner, setStaffOwner] = useState('');
  const [module, setModule] = useState<'' | CaseArea>(initialDisputed && allowedAreas.includes('PARCELS') ? 'PARCELS' : allowedAreas.includes(initialArea as CaseArea) ? initialArea : '');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const [selected, setSelected] = useState<string | null>(openRef ?? null);
  // A view sets the status, owner and deadline filters together; the selects narrow it further.
  const status = statusDetail || (view === 'ALL' ? 'ALL' : view === 'RESOLVED' ? 'RESOLVED' : 'ACTIVE');
  const owner = view === 'UNASSIGNED' ? 'UNASSIGNED' : view === 'MINE' ? 'ME' : staffOwner;
  const overdue = view === 'LATE';
  const filtered = view !== 'OPEN' || !!statusDetail || !!priority || !!staffOwner || (module !== '' && !initialArea) || q.trim() !== '' || disputed;
  const clearFilters = () => { setView('OPEN'); setStatusDetail(''); setPriority(''); setStaffOwner(''); if (!initialArea) setModule(''); setQ(''); setDisputed(false); };
  const params = new URLSearchParams({ status });
  if (disputed) params.set('disputedHandovers30d', 'true');
  if (module.includes(',')) params.set('modules', module);
  else if (module) params.set('module', module);
  else if (modules) params.set('modules', modules.join(','));
  if (priority) params.set('priority', priority);
  if (owner) params.set('owner', owner);
  if (overdue) params.set('overdue', 'true');
  if (search) params.set('q', search);
  // Keep the form and its focus mounted when only the result query changes.
  const board = useApi<Board>(`/admin/incidents?${params.toString()}`, { refreshInterval: 15_000, keepPreviousData: true });

  return (
    <div className="space-y-6">
      <Async state={board} skeleton={<SkeletonList rows={4} />}>
        {(b) => (
          <div className="space-y-6">
            <FilterBar
              search={<SearchField label="Search cases" placeholder="Case number or words in the summary" value={q} onChange={setQ} />}
              chips={<>
                {disputed && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gold-50 px-3 py-2">
                    <p className="text-sm font-semibold text-gold-700"><Text>Disputed handovers · reported in the last 30 days</Text></p>
                    <Button size="sm" variant="ghost" onClick={() => { setDisputed(false); setView('OPEN'); }}><Text>Show all parcel cases</Text></Button>
                  </div>
                )}
                <FilterChips<CaseView> label="Case queue" value={view} onChange={(next) => { setView(next); setStatusDetail(''); if (next === 'UNASSIGNED' || next === 'MINE') setStaffOwner(''); }} options={[
                  { key: 'OPEN', label: 'Open', count: b.metrics.open },
                  { key: 'UNASSIGNED', label: 'Unassigned', count: b.metrics.unassigned, alert: true },
                  { key: 'MINE', label: 'Mine', count: b.metrics.mine },
                  { key: 'LATE', label: 'Past deadline', count: b.metrics.overdue, alert: true },
                  { key: 'RESOLVED', label: 'Resolved' },
                  { key: 'ALL', label: 'All' },
                ]} />
                {view !== 'RESOLVED' && (
                  <div className="border-t border-ink-100/80 pt-3">
                    <FilterChips<'' | IncidentStatus> label="Status" size="sm" value={statusDetail} onChange={setStatusDetail} options={[
                      { key: '', label: 'Any status' },
                      ...(view === 'ALL' ? ALL_STATUSES : ACTIVE_STATUS_ORDER).map((s) => ({ key: s, label: INCIDENT_STATUS_LABELS[s] })),
                    ]} />
                  </div>
                )}
              </>}
              controls={<>
                <FilterMenu<'' | Priority> label="Priority" value={priority} onChange={setPriority} options={[
                  { value: '', label: 'Any' },
                  ...(['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
                ]} />
                <FilterMenu label="Handled by" value={staffOwner} onChange={(next) => { setStaffOwner(next); if (view === 'UNASSIGNED' || view === 'MINE') setView('OPEN'); }} options={[
                  { value: '', label: 'Anyone' },
                  ...b.staff.map((s) => ({ value: s.id, label: s.full_name, raw: true })),
                ]} />
                {allowedAreas.length > 1 && (
                  <FilterMenu<'' | CaseArea> label="Area" value={module} onChange={setModule} options={[
                    { value: '', label: 'Everything' },
                    ...allowedAreas.map((a) => ({ value: a, label: AREA_LABELS[a] })),
                  ]} />
                )}
              </>}
              summary={<FilterSummary live shown={b.incidents.length} noun="cases" onClear={filtered ? clearFilters : undefined} />}
            />
            <Card className="overflow-hidden">
              <CardHeader
                title="Cases"
                description="Select a case to view its history, update progress or assign someone."
                action={<span className="text-right text-xs leading-5 text-ink-500">
                  <span className="block"><Text>{`${b.metrics.resolved_30d} resolved in the last 30 days`}</Text></span>
                  {!modules?.every((m) => COMMUNITY_MODULES.includes(m)) && <span className="block"><Text>{`${b.metrics.courierReferrals30d} sent to courier companies, not counted`}</Text></span>}
                </span>}
              />
              <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_240px] gap-6 border-b border-ink-100 bg-ink-50/70 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500 lg:grid">
                <span><Text>Case details</Text></span><span><Text>Status & responsibility</Text></span>
              </div>
              {board.error ? <ErrorState error={board.error} onRetry={() => void board.mutate()} /> : board.isLoading ? <SkeletonList rows={3} className="p-5" /> : b.incidents.length === 0 ? (
                module !== 'LAPOR' && <div className="p-5"><EmptyState icon={ShieldCheck} title="No cases here"><Text>Nothing matches these filters.</Text></EmptyState></div>
              ) : (
                <ul className="ops-queue divide-y divide-ink-100">
                  {b.incidents.map((r, index) => {
                    const due = dueText(r);
                    const active = r.status !== 'RESOLVED' && r.status !== 'CLOSED';
                    return (
                      <li key={r.id} style={{ '--i': Math.min(index, 12) } as CSSProperties} className="ops-row relative">
                        {active && <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', r.priority === 'CRITICAL' ? 'bg-accent-600' : due?.late ? 'bg-accent-500' : r.priority === 'HIGH' ? 'bg-warning-600' : 'bg-ink-200')} />}
                        <button type="button" onClick={() => setSelected(r.id)} className="grid w-full gap-4 px-5 py-5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-6">
                          <span className="min-w-0 space-y-2">
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-semibold tabular-nums text-ink-500">{r.reference}</span>
                              <Badge tone={PRIORITY_TONE[r.priority]}><Text>{PRIORITY_LABELS[r.priority]}</Text></Badge>
                              {r.escalated_at && <Badge tone="danger"><Text>Escalated</Text></Badge>}
                            </span>
                            <span className="block text-[15px] font-semibold text-ink-900"><Text>{CATEGORY_LABELS[r.kind] ?? r.kind}</Text></span>
                            <span className="block break-words text-sm leading-relaxed text-ink-600"><Text>{r.summary}</Text></span>
                            <span className="block text-xs text-ink-500">
                              <Text>{MODULE_LABELS[r.module]}</Text> · <Text>{`opened ${timeAgo(r.created_at)}`}</Text> · <Text>{`updated ${timeAgo(r.updated_at)}`}</Text>
                            </span>
                          </span>
                          <span className="flex flex-col items-start gap-2 border-t border-ink-100 pt-3 text-sm lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                            <Badge tone={STATUS_TONE[r.status]}><Text>{r.status === 'AWAITING_EXTERNAL_PARTY' && r.awaiting ? `Waiting for ${AWAITING_LABELS[r.awaiting]}` : INCIDENT_STATUS_LABELS[r.status]}</Text></Badge>
                            <span className="inline-flex items-center gap-1 text-ink-600"><UserRound className="size-3.5" aria-hidden />{r.owner ?? <Text>Unassigned</Text>}</span>
                            {due && <span className={cn('text-xs font-semibold', due.late ? 'text-accent-700' : 'text-ink-500')}><Text>{due.text}</Text></span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {showLapor && b.lapor.length > 0 && (
              <Card>
                <CardHeader
                  title="Lapor community reports"
                  description={`Handled in Lapor's own queue and shown here for one view of everything open: ${b.metrics.laporOpen} open, ${b.metrics.laporLate} past their target date.`}
                  action={<Button size="sm" variant="secondary" href="/console/reports"><Text>Open Lapor</Text></Button>}
                />
                <ul className="divide-y divide-ink-100">
                  {b.lapor.slice(0, 10).map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0"><Text>{REPORT_CATEGORY_LABELS[l.category as ReportCategory] ?? l.category}</Text> · <span className="text-ink-600">{l.location_text}</span></span>
                      <span className="flex items-center gap-2 text-ink-600">
                        {l.assigned_to && <span>{l.assigned_to}</span>}
                        {l.overdue && <Badge tone="danger"><Text>Late</Text></Badge>}
                        <Text>{timeAgo(l.created_at)}</Text>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {selected && <CaseDetail modules={modules} id={selected} staff={b.staff} me={b.me} isAdmin={b.isAdmin} onClose={() => setSelected(null)} onChange={() => void board.mutate()} />}
          </div>
        )}
      </Async>
    </div>
  );
}

/**
 * A module page's view of its cases: the counts and one link to that module's
 * case board, already filtered.
 */
export function CaseSummary({ title, description, area, linkLabel }: { title: string; description?: string; area: Exclude<CaseArea, 'LAPOR'>; linkLabel: string }) {
  const query = `${area.includes(',') ? 'modules' : 'module'}=${area}&status=ACTIVE`;
  const board = useApi<Pick<Board, 'metrics'>>(`/admin/incidents?${query}`, { refreshInterval: 30_000 });
  const href = area === 'PARCELS' ? '/console/operations?tab=guardhouse&view=cases' : '/console/operations?tab=lockers&view=cases';
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0 space-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink-900"><Text>{title}</Text></h2>
        {description && <p className="text-sm text-ink-500"><Text>{description}</Text></p>}
        <Async state={board} skeleton={<SkeletonList rows={1} />}>
          {({ metrics: m }) => m.open === 0 ? <p className="text-sm text-ink-600"><Text>No open cases.</Text></p> : (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-700">
              <span className="font-semibold text-ink-900"><Text>{`${m.open} open`}</Text></span>
              {m.overdue > 0 && <>· <Badge tone="danger"><Text>{`${m.overdue} overdue`}</Text></Badge></>}
              {m.critical > 0 && <>· <Badge tone="danger"><Text>{`${m.critical} critical`}</Text></Badge></>}
              {m.unassigned > 0 && <>· <Text>{`${m.unassigned} nobody has taken`}</Text></>}
            </p>
          )}
        </Async>
      </div>
      <Button size="sm" variant="secondary" href={href}><Text>{linkLabel}</Text><ArrowRight className="size-4" aria-hidden /></Button>
    </Card>
  );
}

interface Detail {
  incident: Row & {
    description: string | null; responsibility: string; reporter: string | null; reporter_role: string | null; home: string | null; company: string | null;
    resident_outcome: string | null; actions_taken: string | null; resolution_category: string | null; details: { evidence?: string[]; occurrences?: number };
    /** The reporter's screenshot or photo (Kitar and Gerak reports). */
    photo_id: string | null;
  };
  events: { id: number; kind: string; visibility: 'INTERNAL' | 'RESIDENT'; body: string | null; at: string; actor: string | null; data: Record<string, unknown> }[];
  escalations: { reason: string; note: string | null; at: string; raised_by: string | null }[];
  parcel: (Record<string, unknown> & { kind: 'LOCKER' | 'GUARD' }) | null;
  historyIntact: boolean;
  can: { claim: boolean; work: boolean; assign: boolean; escalate: boolean; messageResident: boolean };
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Reported', ASSIGNED: 'Taken', REASSIGNED: 'Moved to someone else', STATUS: 'Status changed', NOTE: 'Note', RESIDENT_UPDATE: 'Update to the resident',
  INFO_REQUESTED: 'Question to the resident', RESIDENT_REPLY: 'The resident replied', ESCALATED: 'Escalated', RESOLVED: 'Resolved', REOPENED: 'Reopened', CLOSED: 'Closed',
  RECLASSIFIED: 'Reclassified', REPEATED: 'Happened again',
};

/** One case: what happened, the related records, its history, and what the person handling it can do next. */
function CaseDetail({ modules, id, staff, isAdmin, onClose, onChange }: { modules?: IncidentModule[]; id: string; staff: Board['staff']; me: string; isAdmin: boolean; onClose: () => void; onChange: () => void }) {
  const router = useRouter();
  // A notification links to the case by its reference (INC-000123); everything else uses its id.
  const detail = useApi<Detail>(/^INC-\d+$/.test(id) ? `/admin/incidents/by-reference/${id}` : `/admin/incidents/${id}`);
  const [action, setAction] = useState<'' | 'note' | 'update' | 'ask' | 'escalate' | 'resolve' | 'assign' | 'wait'>('');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState('');
  const [actions, setActions] = useState('');
  const [category, setCategory] = useState<ResolutionCategory>('FIXED');
  const [ownerId, setOwnerId] = useState('');
  const [awaiting, setAwaiting] = useState<'COURIER' | 'CONTRACTOR' | 'OTHER'>('COURIER');
  const done = () => {
    setAction('');
    setText('');
    setOutcome('');
    setActions('');
    void detail.mutate();
    onChange();
  };
  const post = useAction((path: string, body: unknown = {}) => api.post(`/admin/incidents/${detail.data?.incident.id ?? id}/${path}`, body), { success: 'Saved.', onSuccess: done });
  const d = detail.data;
  const i = d?.incident;
  const outsideScope = Boolean(i && modules && !modules.includes(i.module));
  useEffect(() => {
    if (outsideScope && i) {
      const destination = i.module === 'PARCELS'
        ? '/console/operations?tab=guardhouse&view=cases'
        : i.module === 'LOCKERS' || i.module === 'COURIERS'
          ? '/console/operations?tab=lockers&view=cases'
          : '/console/reports?tab=cases';
      router.replace(`${destination}&ref=${encodeURIComponent(i.reference)}`);
    }
  }, [outsideScope, i, router]);
  if (outsideScope) return <SkeletonList rows={2} />;

  return (
    <Modal open onClose={onClose} wide className="overflow-hidden" title={i ? `${CATEGORY_LABELS[i.kind] ?? i.kind} · ${i.reference}` : '…'} description={i ? `${MODULE_LABELS[i.module]} · ${INCIDENT_STATUS_LABELS[i.status]}` : undefined}>
      {!d || !i ? <SkeletonList rows={3} /> : (
        <div className="space-y-5">
          {!d.historyIntact && <p role="alert" className="flex items-center gap-2 rounded-lg bg-accent-50 p-3 text-sm font-semibold text-accent-700"><ShieldAlert className="size-4" aria-hidden /><Text>History does not check out</Text></p>}
          <section className="rounded-lg border border-ink-200 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone={PRIORITY_TONE[i.priority]}><Text>{PRIORITY_LABELS[i.priority]}</Text></Badge>
              <Badge tone={STATUS_TONE[i.status]}><Text>{INCIDENT_STATUS_LABELS[i.status]}</Text></Badge>
              <Badge tone="neutral"><Text>{i.responsibility === 'MIXED' ? 'Township records to check' : i.responsibility === 'UNCERTAIN' ? 'Needs working out' : 'Township'}</Text></Badge>
            </div>
            <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>Issue summary</Text></h3>
            <p className="text-[15px] leading-relaxed text-ink-800"><Text>{i.summary}</Text></p>
            {i.description && <blockquote className="mt-3 border-l-2 border-brand-300 bg-ink-50 p-3 text-sm leading-relaxed"><Text>{i.description}</Text></blockquote>}
            {i.photo_id && (
              <a href={`/api/v1/incident-photos/${i.reference}`} target="_blank" rel="noopener noreferrer" className="mt-3 block w-fit overflow-hidden rounded-lg border border-ink-200 bg-white shadow-xs hover:shadow-md">
                <LocalizedImg src={`/api/v1/incident-photos/${i.reference}`} alt="The resident's screenshot or photo" className="max-h-64 w-auto object-contain" loading="lazy" />
              </a>
            )}
            <dl className="mt-4 grid gap-x-6 gap-y-4 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2">
              <CaseField label="Handled by" value={i.owner ?? 'Nobody has taken it yet'} />
              <CaseField label="Deadline" value={i.status === 'RESOLVED' || i.status === 'CLOSED' ? INCIDENT_STATUS_LABELS[i.status] : (i.owner_id ? i.resolve_due_at : i.assign_due_at) ? formatDateTime((i.owner_id ? i.resolve_due_at : i.assign_due_at)!) : 'Not set'} />
              <CaseField label="Reported by" value={i.reporter ?? 'Raised by SimeTown'} />
              <CaseField label="Reported at" value={formatDateTime(i.created_at)} />
              {i.home && <CaseField label="Household" value={i.home} />}
              {i.station && <CaseField label="Station" value={i.station} />}
            </dl>
            {(i.overdue || i.unassigned_late) && i.status !== 'RESOLVED' && i.status !== 'CLOSED' && <p className="mt-3 text-sm font-semibold text-accent-700"><Text>{i.unassigned_late ? 'Not taken in time' : 'Past its deadline'}</Text></p>}
          </section>
          <div className="space-y-3">
            {i.details?.evidence && i.details.evidence.length > 0 && (
              <div className="rounded-md border border-ink-200 p-3 text-sm">
                <p className="font-semibold text-ink-900"><Text>What the records showed the resident</Text></p>
                <ul className="mt-1 list-disc pl-5 text-ink-700">{i.details.evidence.map((e) => <li key={e}><Text>{e}</Text></li>)}</ul>
              </div>
            )}
          </div>

          {d.escalations.length > 0 && (
            <div className="space-y-1 rounded-md bg-accent-50 p-3 text-sm text-accent-700">
              {d.escalations.map((e, n) => <p key={n} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><span><Text>{formatDateTime(e.at)}</Text> · <Text>{e.note ?? e.reason}</Text></span></p>)}
            </div>
          )}

          <section className="rounded-lg border border-ink-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink-900"><Text>Case actions</Text></h3>
            <div className="flex flex-wrap gap-2">
            {d.can.claim && <Button onClick={() => void post.run('claim')} pending={post.pending}><Hand className="size-4" aria-hidden /><Text>I’ll handle this</Text></Button>}
            {d.can.work && i.status !== 'INVESTIGATING' && <Button size="sm" variant="secondary" onClick={() => void post.run('status', { status: 'INVESTIGATING' })} disabled={post.pending}><Text>Investigating</Text></Button>}
            {d.can.work && <Button size="sm" variant="secondary" onClick={() => setAction('wait')}><Text>Waiting for someone</Text></Button>}
            {d.can.work && <Button size="sm" onClick={() => setAction('resolve')}><CheckCircle2 className="size-4" aria-hidden /><Text>Resolve</Text></Button>}
            <Button size="sm" variant="ghost" onClick={() => setAction('note')}><Text>Add a note</Text></Button>
            {d.can.work && d.can.messageResident && <Button size="sm" variant="ghost" onClick={() => setAction('update')}><Text>Update the resident</Text></Button>}
            {d.can.work && d.can.messageResident && <Button size="sm" variant="ghost" onClick={() => setAction('ask')}><Text>Ask the resident</Text></Button>}
            {d.can.escalate && <Button size="sm" variant="ghost" onClick={() => setAction('escalate')}><Flag className="size-4" aria-hidden /><Text>Ask an admin</Text></Button>}
            {isAdmin && d.can.assign && <Button size="sm" variant="ghost" onClick={() => setAction('assign')}><UserRound className="size-4" aria-hidden /><Text>{i.owner_id ? 'Reassign' : 'Assign'}</Text></Button>}
          </div>
          </section>

          {action && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-4">
              {action === 'resolve' ? (
                <>
                  <Select label="What happened" value={category} onChange={(event) => setCategory(event.target.value as ResolutionCategory)}>
                    {RESOLUTION_CATEGORIES.map((c) => <option key={c} value={c}><Text>{RESOLUTION_LABELS[c]}</Text></option>)}
                  </Select>
                  {i.reporter && <Textarea label="What the resident is told" value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={1000} />}
                  <Textarea label="Actions taken" value={actions} onChange={(event) => setActions(event.target.value)} maxLength={1000} />
                  <Textarea label="Internal note (optional)" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
                  <p className="text-sm text-ink-600"><Text>Resolving records the outcome only. It does not open a locker, issue a code or change the parcel; use their own steps for that.</Text></p>
                  <Button size="sm" onClick={() => void post.run('resolve', { category, outcome: (outcome.trim() || actions.trim()), actionsTaken: actions.trim(), internalNote: text.trim() || undefined })}
                    pending={post.pending} disabled={actions.trim().length < 3 || (Boolean(i.reporter) && outcome.trim().length < 5)}><Text>Resolve</Text></Button>
                </>
              ) : action === 'assign' ? (
                <>
                  <Select label="Give it to" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                    <option value="">{' '}</option>
                    {staff.filter((s) => s.id !== i.owner_id).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </Select>
                  {i.owner_id && <Textarea label="Why it is moving" value={text} onChange={(event) => setText(event.target.value)} maxLength={300} />}
                  <Button size="sm" onClick={() => void post.run('assign', { ownerId, reason: text.trim() || undefined })} pending={post.pending} disabled={!ownerId || (Boolean(i.owner_id) && text.trim().length < 3)}><Text>Save</Text></Button>
                </>
              ) : action === 'wait' ? (
                <>
                  <Select label="Waiting for" value={awaiting} onChange={(event) => setAwaiting(event.target.value as typeof awaiting)}>
                    <option value="COURIER"><Text>The courier company</Text></option>
                    <option value="CONTRACTOR"><Text>A contractor</Text></option>
                    <option value="OTHER"><Text>Someone else</Text></option>
                  </Select>
                  <Textarea label="Note (optional)" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} />
                  <Button size="sm" onClick={() => void post.run('status', { status: 'AWAITING_EXTERNAL_PARTY', awaiting, note: text.trim() || undefined })} pending={post.pending}><Text>Save</Text></Button>
                </>
              ) : (
                <>
                  <Textarea
                    label={action === 'note' ? 'Note (staff only)' : action === 'update' ? 'Message to the resident' : action === 'ask' ? 'Question for the resident' : 'What an admin should do'}
                    value={text} onChange={(event) => setText(event.target.value)} maxLength={2000}
                  />
                  <Button size="sm" pending={post.pending} disabled={text.trim().length < (action === 'note' ? 2 : 5)}
                    onClick={() => void post.run(action === 'note' ? 'note' : action === 'update' ? 'update-resident' : action === 'ask' ? 'request-info' : 'escalate',
                      action === 'note' || action === 'update' ? { body: text.trim() } : action === 'ask' ? { question: text.trim() } : { note: text.trim() })}>
                    <Text>{action === 'note' ? 'Save note' : action === 'escalate' ? 'Ask an admin' : 'Send'}</Text>
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setAction('')}><Text>Cancel</Text></Button>
            </div>
          )}
          {d.parcel && <RelatedParcel parcel={d.parcel} />}
          {i.resident_outcome && <section className="rounded-lg border border-success-200 bg-success-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>Resolution</Text></h3>
            <p className="text-sm"><Text>{i.resident_outcome}</Text></p>
            {i.actions_taken && <p className="mt-2 text-sm text-ink-600"><Text>{i.actions_taken}</Text></p>}
          </section>}
          <details className="rounded-lg border border-ink-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink-900"><Text>Case activity</Text> ({d.events.length})</summary>
            <p className={cn('my-3 flex items-center gap-1 text-xs', d.historyIntact ? 'text-success-700' : 'text-accent-700')}>
              {d.historyIntact ? <ShieldCheck className="size-3.5" aria-hidden /> : <ShieldAlert className="size-3.5" aria-hidden />}
              <Text>{d.historyIntact ? 'History intact' : 'History does not check out'}</Text>
            </p>
            <ol className="space-y-4 border-l border-ink-200 pl-4 text-sm">
              {[...d.events].reverse().map((e) => <li key={e.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong><Text>{EVENT_LABELS[e.kind] ?? e.kind}</Text></strong>
                  {e.visibility === 'RESIDENT' && <Badge tone="neutral"><Text>Resident sees this</Text></Badge>}
                  {e.kind === 'STATUS' && typeof e.data.to === 'string' && <Text>{INCIDENT_STATUS_LABELS[e.data.to as IncidentStatus] ?? e.data.to}</Text>}
                </div>
                <p className="text-xs text-ink-500"><Text>{formatDateTime(e.at)}</Text>{e.actor && <> · {e.actor}</>}</p>
                {e.body && <p className="whitespace-pre-wrap break-words leading-relaxed text-ink-700"><Text>{e.body}</Text></p>}
              </li>)}
            </ol>
          </details>
        </div>
      )}
    </Modal>
  );
}

function CaseField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-ink-500"><Text>{label}</Text></dt><dd className="mt-1 break-words text-sm text-ink-900"><Text>{value}</Text></dd></div>;
}

function RelatedParcel({ parcel: p }: { parcel: Record<string, unknown> & { kind: 'LOCKER' | 'GUARD' } }) {
  const s = (k: string) => (p[k] == null ? null : String(p[k]));
  if (p.kind === 'GUARD') {
    return (
      <div className="rounded-lg border border-ink-200 p-4 text-sm text-ink-700">
        <p className="mb-1 font-semibold text-ink-900"><Text>The guardhouse parcel</Text></p>
        <dl className="mb-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <CaseField label="Courier" value={s('courier') ?? '–'} />
          <CaseField label="Tracking number" value={s('tracking_no') ?? '–'} />
          <CaseField label="Shelf" value={s('shelf') ?? '–'} />
          <CaseField label="Parcel status" value={s('status') === 'COLLECTED' ? 'Collected' : s('status') === 'WAITING' ? 'Waiting for collection' : s('status') === 'RETURNED' ? 'Returned to courier' : s('status') ?? '–'} />
        </dl>
        <p><Text>{`Logged by ${s('logged_by') ?? '–'}, ${formatDateTime(s('logged_at')!)}`}</Text></p>
        {s('collected_at') && <p><Text>{`Handed over by ${s('handed_over_by') ?? '–'}${s('collected_by_name') ? ` to ${s('collected_by_name')}` : ''}, ${formatDateTime(s('collected_at')!)}`}</Text></p>}
      </div>
    );
  }
  const history = (p.history as { to_state: string; reason: string; at: string; actor: string | null; actor_kind: string }[]) ?? [];
  const doors = (p.doors as { purpose: string; status: string; created_at: string; requested_by: string | null; error: string | null }[]) ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 p-4 text-sm text-ink-700">
      <p className="font-semibold text-ink-900"><Text>The locker parcel</Text></p>
      <dl className="grid gap-x-6 gap-y-3 py-2 sm:grid-cols-2">
        <CaseField label="Courier" value={s('company') ?? '–'} />
        <CaseField label="Tracking number" value={s('tracking_no') ?? '–'} />
        <CaseField label="Station" value={s('station') ?? '–'} />
        <CaseField label="Door" value={s('compartment') ?? '–'} />
        <CaseField label="Parcel status" value={PARCEL_STATE_LABELS[s('state') as ParcelState] ?? s('state') ?? '–'} />
        {s('assurance') && <CaseField label="Verification" value={`${s('assurance')!.toLowerCase()} assurance`} />}
      </dl>
      {doors.length > 0 && (
        <details className="border-t border-ink-100 pt-3">
          <summary className="cursor-pointer font-semibold text-ink-700"><Text>Door commands</Text> ({doors.length})</summary>
          <ul className="mt-3 space-y-3 break-words leading-relaxed">{doors.map((k, n) => <li key={n}><Text>{formatDateTime(k.created_at)}</Text> · {k.purpose} · <strong>{k.status}</strong>{k.requested_by ? ` · ${k.requested_by}` : <> · <Text>keypad or system</Text></>}{k.error && <> · <Text>{k.error}</Text></>}</li>)}</ul>
        </details>
      )}
      {history.length > 0 && (
        <details className="border-t border-ink-100 pt-3">
          <summary className="cursor-pointer font-semibold text-ink-700"><Text>Parcel history</Text> ({history.length})</summary>
          <ul className="mt-3 space-y-3 break-words leading-relaxed">{history.map((h, n) => <li key={n}><Text>{formatDateTime(h.at)}</Text> · <Text>{PARCEL_STATE_LABELS[h.to_state as ParcelState] ?? h.to_state}</Text> · <Text>{h.reason}</Text>{h.actor && ` · ${h.actor}`}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
