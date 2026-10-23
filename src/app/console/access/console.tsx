'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedNav } from '@/components/ui/localized-elements';

import {
  Activity, ArrowRight, CheckCircle2, CircleHelp, ClipboardCheck, Clock3, FlaskConical, Hand, Megaphone, OctagonAlert, Play, Plus, Route, Search, ShieldCheck, ShieldQuestion, Trash2, Undo2, Users, Wrench, type LucideIcon,
} from 'lucide-react';
import { useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AvailabilityBadge, PhotoField, PriorityBadge, VerificationBadge, categoryLabel, formWith } from '@/components/features/access-bits';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Drawer, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import {
  ACCESS_CATEGORIES, ACCESS_CATEGORY_INFO, ACCESS_STATUS_LABELS, AVAILABILITY_LABELS, PARTY_KINDS, PARTY_KIND_LABELS, VERIFICATION_LABELS,
  pickRule, resolveParty, type AccessCategory, type AccessIncidentStatus, type AccessPolicy, type Availability, type PartyKind, type RoutingRule, type Verification,
} from '@/shared/akses';
import { ADMINS, PLACE_KINDS, PLACE_KIND_LABELS, type PlaceKind } from '@/shared/domain';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/shared/incidents';

/**
 * The SDP console for accessibility. Reports are routed, followed up and
 * escalated without anyone here; this page leads with what needs a person (an
 * incident nobody could be found for, a disputed or unconfirmed fix, a place
 * to verify) and keeps the full record one click away.
 */

interface IncidentRow {
  id: string;
  reference: string;
  category: AccessCategory;
  priority: Priority;
  status: AccessIncidentStatus;
  blocks_access: boolean;
  party_id: string | null;
  party_name: string | null;
  party_kind: PartyKind | null;
  party_integration: 'IN_APP' | 'SIMULATED' | null;
  exception_reason: string | null;
  reporter_count: number;
  ack_due_at: string | null;
  resolve_due_at: string | null;
  verify_due_at: string | null;
  acknowledged_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  resolution_submitted_at: string | null;
  resolved_at: string | null;
  reopen_count: number;
  created_at: string;
  place_id: string;
  place_name: string;
  place_kind: PlaceKind;
  place_location: string;
  escalation_reason?: string | null;
  escalation_note?: string | null;
}
interface Overview {
  metrics: Record<'places' | 'verified' | 'pending_verification' | 'blocked_places' | 'active' | 'critical' | 'overdue' | 'resolved_week' | 'inspections_due', number>;
  attention: IncidentRow[];
  suggestions: { id: string; name: string; kind: PlaceKind; location: string; note: string | null; verification: Verification; created_at: string; suggested_by: string | null; duplicate_id: string | null; duplicate_name: string | null; listing_reports: number }[];
  inspections: { id: string; name: string; kind: PlaceKind; next_inspection_at: string; party_name: string | null }[];
  recent: IncidentRow[];
  automation: { incidents_30d: number; auto_routed_30d: number; fallback_30d: number; dispatch_retrying: number; dispatch_failed: number };
}
interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  location: string;
  verification: Verification;
  availability: Availability;
  last_verified_at: string | null;
  next_inspection_at: string | null;
  party_id: string | null;
  party_name: string | null;
  party_integration: 'IN_APP' | 'SIMULATED' | null;
  archived_at: string | null;
  suggested_by: string | null;
  incidents: { reference: string }[];
}
interface Party {
  id: string;
  name: string;
  kind: PartyKind;
  integration: 'IN_APP' | 'SIMULATED';
  contact: string | null;
  active: boolean;
  simulate_failures: number;
  members: { id: string; full_name: string; role: string }[];
}
interface Detail {
  incident: IncidentRow & { routing: { rule?: { source: string; target: { type: string; kind?: string } }; manual?: { reason: string } }; place_verification: Verification; place_availability: Availability };
  reports: { id: string; description: string | null; photo_id: string | null; created_at: string; reporter: string }[];
  resolutions: { id: string; source: string; action_taken: string; photo_id: string | null; telemetry: boolean; outcome: 'PENDING' | 'ACCEPTED' | 'REJECTED'; decision_basis: string | null; submitted_at: string; submitted_by: string | null; clear: number; still_blocked: number }[];
  escalations: { reason: string; level: 'REMINDER' | 'ESCALATION'; note: string | null; at: string }[];
  dispatches: { kind: string; status: string; attempts: number; external_ref: string | null; last_error: string | null; created_at: string }[];
  events: { id: string; kind: string; visibility: 'INTERNAL' | 'PUBLIC'; body: string | null; data: Record<string, unknown>; actor_kind: string; at: string; actor: string | null }[];
  historyIntact: boolean;
}

const REASON_LABELS: Record<string, string> = {
  UNROUTED: 'No team could be found', NOT_ACKNOWLEDGED: 'Not acknowledged in time', OVERDUE: 'Past its target', CRITICAL: 'Critical problem',
  DISPUTED: 'Fix disputed', RECURRING: 'Keeps happening', VERIFICATION_STALLED: 'Fix not confirmed', DISPATCH_FAILED: 'Could not reach the team’s system',
};
const EVENT_LABELS: Record<string, string> = {
  REPORTED: 'Reported', STATUS: 'Status changed', ASSIGNED: 'Assigned', REPORT_ADDED: 'Another report', CONFIRMED: 'Problem confirmed', ACKNOWLEDGED: 'Acknowledged',
  RESOLUTION_SUBMITTED: 'Fix submitted', CONFIRMED_CLEAR: 'Resident confirmed clear', DISPUTED: 'Resident disputed', RESOLUTION_REJECTED: 'Fix rejected', RESOLVED: 'Resolved',
  REOPENED: 'Reopened', ESCALATED: 'Escalated', REMINDER: 'Reminder sent', DISPATCHED: 'Sent to the team’s system', OVERRIDE: 'Admin override', VERIFICATION_REQUIRED: 'Listing questioned',
};
const SOURCE_LABELS: Record<string, string> = { IN_APP: 'In SimeTown', SIMULATED_INTEGRATION: 'Simulated integration', STAFF_ON_BEHALF: 'Admin on the team’s behalf' };

const overdue = (i: IncidentRow) => Boolean(i.resolve_due_at && new Date(i.resolve_due_at) < new Date() && !i.resolution_submitted_at && i.status !== 'RESOLVED');

type TabKey = 'overview' | 'incidents' | 'places' | 'setup';

/** Why an item is on the to-do list, in plain words, and what to press. */
const REASON_HELP: Record<string, { why: string; action: string }> = {
  UNROUTED: { why: 'The app does not know who runs this place, so it did not guess.', action: 'Choose a team' },
  NOT_ACKNOWLEDGED: { why: 'The team was reminded but has not responded.', action: 'Chase up' },
  OVERDUE: { why: 'It is past the time it should have been fixed.', action: 'Chase up' },
  VERIFICATION_STALLED: { why: 'The team says it is fixed, but no resident has confirmed. Someone should look.', action: 'Check the fix' },
  DISPUTED: { why: 'Residents say the fix did not work.', action: 'Review' },
  RECURRING: { why: 'This place keeps having problems. It may need a lasting fix.', action: 'Review' },
  CRITICAL: { why: 'A serious problem. Keep an eye on it.', action: 'Review' },
  DISPATCH_FAILED: { why: 'The outside team’s system could not be reached.', action: 'Review' },
};

const HOW_STEPS = [
  { icon: Megaphone, title: 'A resident reports a problem', text: 'With a photo, from Akses+.' },
  { icon: Route, title: 'It goes to the right team', text: 'Security, the township office, a JMB or a contractor, by your rules.' },
  { icon: Wrench, title: 'The team fixes it', text: 'And adds a photo of the result.' },
  { icon: CheckCircle2, title: 'Residents confirm', text: 'Only then does the place show as available again.' },
];

/** The four steps every report follows, and where staff come in. Can be hidden once understood. */
function HowItWorks({ onHide }: { onHide: () => void }) {
  return (
    <Card className="ops-panel mb-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-4 sm:px-6">
        <h2 className="text-[15px] font-semibold text-ink-900"><Text>How it works</Text></h2>
        <Button size="sm" variant="ghost" onClick={onHide}><Text>Hide</Text></Button>
      </div>
      <ol className="grid gap-3 px-5 pb-4 pt-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {HOW_STEPS.map((s, n) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700" aria-hidden><s.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink-900"><span className="tabular-nums text-brand-700">{n + 1}.</span> <Text>{s.title}</Text></span>
              <span className="block text-xs leading-relaxed text-ink-500"><Text>{s.text}</Text></span>
            </span>
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-2 border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm text-ink-700 sm:px-6">
        <Hand className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
        <Text>You only step in when something gets stuck: no team found, nobody responding, or residents say it is still not fixed. Those appear under To do.</Text>
      </p>
    </Card>
  );
}

const HOW_KEY = 'akses-console-how-hidden';
const howListeners = new Set<() => void>();
const subscribeHow = (listener: () => void) => {
  howListeners.add(listener);
  return () => howListeners.delete(listener);
};
const readHow = () => {
  try {
    return window.localStorage.getItem(HOW_KEY) === '1';
  } catch {
    return false;
  }
};

/** Where an issue is, in the five plain stages residents and staff both understand. */
type Stage = 'NEEDS_YOU' | 'WITH_TEAM' | 'FIXING' | 'CHECKING' | 'FIXED';
function stageOf(i: IncidentRow): Stage {
  if (i.status === 'RESOLVED') return 'FIXED';
  if (i.status === 'ESCALATED' || !i.party_id) return 'NEEDS_YOU';
  if (i.resolution_submitted_at) return 'CHECKING';
  if (i.acknowledged_at || i.status === 'IN_PROGRESS') return 'FIXING';
  return 'WITH_TEAM';
}
const STAGE_LABELS: Record<Stage, string> = { NEEDS_YOU: 'Needs you', WITH_TEAM: 'With the team', FIXING: 'Being fixed', CHECKING: 'Checking the fix', FIXED: 'Fixed' };
const STAGE_TONE: Record<Stage, 'danger' | 'brand' | 'gold' | 'success' | 'neutral'> = { NEEDS_YOU: 'danger', WITH_TEAM: 'neutral', FIXING: 'brand', CHECKING: 'gold', FIXED: 'success' };

/** Worst first: critical, then stuck or late, then high priority; oldest breaks ties. */
const severity = (i: IncidentRow) =>
  (i.priority === 'CRITICAL' ? 8 : 0) + (stageOf(i) === 'NEEDS_YOU' || overdue(i) ? 4 : 0) + (i.priority === 'HIGH' ? 2 : 0);
const railOf = (i: IncidentRow) =>
  i.status === 'RESOLVED' ? 'bg-success-600' : i.priority === 'CRITICAL' ? 'bg-accent-600' : stageOf(i) === 'NEEDS_YOU' || overdue(i) ? 'bg-accent-500' : i.priority === 'HIGH' ? 'bg-warning-600' : 'bg-ink-200';
const PRIORITY_TAG = (p: Priority) =>
  p === 'CRITICAL' || p === 'HIGH'
    ? <span className={cn('rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-wide', p === 'CRITICAL' ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700')}><Text>{PRIORITY_LABELS[p]}</Text></span>
    : null;

/** The time column: when it must be fixed by, or when it was. */
function TimeCell({ i }: { i: IncidentRow }) {
  const late = overdue(i);
  return (
    <div className="flex items-center gap-2 text-xs lg:block">
      {i.status === 'RESOLVED' && i.resolved_at ? (
        <span className="font-semibold text-success-700"><Text>{`Fixed ${timeAgo(i.resolved_at)}`}</Text></span>
      ) : i.resolve_due_at ? (
        <span className={cn('inline-flex items-center gap-1.5 font-semibold', late ? 'text-accent-700' : 'text-ink-600')}><Clock3 className="size-3.5" aria-hidden /><Text>{late ? 'Past its target' : `Fix by ${formatDateTime(i.resolve_due_at)}`}</Text></span>
      ) : <span className="text-ink-500">–</span>}
      <span className="text-ink-500 lg:mt-0.5 lg:block"><Text>{`opened ${timeAgo(i.created_at)}`}</Text></span>
    </div>
  );
}

const PLACE_DOT: Record<Availability, string> = { AVAILABLE: 'is-ok', REPORTED_BLOCKED: 'is-warning', CONFIRMED_BLOCKED: 'is-danger is-pulsing', RESOLUTION_PENDING: 'is-warning', UNKNOWN: 'is-idle' };

export function AccessConsole({ initialRef }: { initialRef: string | null }) {
  const me = useApi<Me>('/me');
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const [tab, setTab] = useState<TabKey>(initialRef ? 'incidents' : 'overview');
  const [openRef, setOpenRef] = useState<string | null>(initialRef);
  const [inspecting, setInspecting] = useState<{ id: string; name: string } | null>(null);
  // A KPI tile opens a list already filtered. The key remounts the list so the filter applies.
  const [issueView, setIssueView] = useState<{ stage: StageFilter; n: number }>({ stage: 'OPEN', n: 0 });
  const [placeView, setPlaceView] = useState<{ avail: AvailFilter; partyId: string; n: number }>({ avail: 'ALL', partyId: '', n: 0 });
  const howHidden = useSyncExternalStore(subscribeHow, readHow, () => false);
  const showHow = (show: boolean) => {
    try {
      window.localStorage.setItem(HOW_KEY, show ? '0' : '1');
    } catch {
      // Private mode: the choice lasts until the page reloads.
    }
    howListeners.forEach((l) => l());
  };
  const overview = useApi<Overview>('/admin/access/overview', { refreshInterval: 30_000, keepPreviousData: true });
  const places = useApi<Place[]>('/access-places', { refreshInterval: 60_000, keepPreviousData: true });
  const run = useAction(() => api.post<Record<string, number>>('/admin/access/run-checks'), {
    onSuccess: () => {
      void overview.mutate();
      void places.mutate();
    },
    success: (r) => `Checked: ${r.reminders ?? 0} reminders, ${(r.escalations ?? 0) + (r.verificationStalled ?? 0)} escalations, ${r.dispatched ?? 0} messages sent.`,
  });
  const todo = overview.data ? overview.data.attention.length + overview.data.suggestions.length : undefined;
  const openIssues = (stage: StageFilter) => {
    setIssueView((v) => ({ stage, n: v.n + 1 }));
    setTab('incidents');
  };
  const openPlaces = (avail: AvailFilter, partyId = '') => {
    setPlaceView((v) => ({ avail, partyId, n: v.n + 1 }));
    setTab('places');
  };

  return (
    <div className="parcel-workspace">
      <PageHeader
        title="Access places"
        description="Residents report problems with ramps, lifts, toilets and OKU parking. The app sends each one to the team responsible and follows it up for you."
        action={
          <>
            {howHidden && <Button variant="ghost" onClick={() => showHow(true)}><CircleHelp className="size-4" aria-hidden /><Text>How it works</Text></Button>}
            {isAdmin && <Button variant="secondary" onClick={() => void run.run()} pending={run.pending}><Play className="size-4" aria-hidden /><Text>Run checks now</Text></Button>}
          </>
        }
      />
      {!howHidden && <HowItWorks onHide={() => showHow(false)} />}
      <div className="mb-5">
        <Tabs<TabKey>
          label="Access places sections"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'overview', label: 'To do', count: todo },
            { key: 'incidents', label: 'All issues', count: overview.data?.metrics.active },
            { key: 'places', label: 'Places', count: overview.data?.metrics.places },
            { key: 'setup', label: 'Configuration' },
          ]}
        />
      </div>
      <div key={tab} className="parcel-view">
        {tab === 'overview' && <TodayTab state={overview} places={places} onOpen={setOpenRef} onInspect={setInspecting} onIssues={openIssues} onPlaces={openPlaces} />}
        {tab === 'incidents' && <IncidentsTab key={issueView.n} initialStage={issueView.stage} onOpen={setOpenRef} />}
        {tab === 'places' && <PlacesTab key={placeView.n} initialAvail={placeView.avail} initialParty={placeView.partyId} isAdmin={isAdmin} onInspect={setInspecting} onChanged={() => { void places.mutate(); void overview.mutate(); }} />}
        {tab === 'setup' && <ConfigurationTab isAdmin={isAdmin} onPlaces={(f) => openPlaces('ALL', f.partyId)} />}
      </div>
      <IncidentDrawer reference={openRef} onClose={() => setOpenRef(null)} isAdmin={isAdmin} onChanged={() => { void overview.mutate(); void places.mutate(); }} />
      <InspectModal place={inspecting} onClose={() => setInspecting(null)} onDone={() => { void overview.mutate(); void places.mutate(); }} />
    </div>
  );
}

// --- To do: the command centre ----------------------------------------------------------------------

type Queue = 'ALL' | 'NO_TEAM' | 'STUCK' | 'PLACES';
const QUEUE_SHOWN = 8;

/** One to-do item: an incident automation could not settle, or a place nobody has verified. */
type TodoItem =
  | { kind: 'incident'; key: string; i: IncidentRow; reason: string; score: number }
  | { kind: 'place'; key: string; s: Overview['suggestions'][number]; score: number };

function TodayTab({ state, places, onOpen, onInspect, onIssues, onPlaces }: {
  state: ReturnType<typeof useApi<Overview>>;
  places: ReturnType<typeof useApi<Place[]>>;
  onOpen: (ref: string) => void;
  onInspect: (p: { id: string; name: string }) => void;
  onIssues: (stage: StageFilter) => void;
  onPlaces: (avail: AvailFilter) => void;
}) {
  const [queue, setQueue] = useState<Queue>('ALL');
  return (
    <div className="space-y-6">
      <Async state={state} skeleton={<SkeletonStats count={5} />}>
        {(o) => {
          const tiles: { label: string; value: number; hint: string; icon: LucideIcon; tone: 'danger' | 'warning' | 'ok' | 'neutral'; onClick: () => void }[] = [
            { label: 'Needs you', value: o.attention.length + o.suggestions.length, hint: o.attention.length + o.suggestions.length ? 'Only what automation could not settle' : 'Nothing stuck', icon: Hand, tone: o.attention.length ? 'danger' : o.suggestions.length ? 'warning' : 'ok', onClick: () => document.getElementById('access-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
            { label: 'Open issues', value: o.metrics.active, hint: o.metrics.overdue ? `${o.metrics.overdue} overdue` : 'All on time', icon: Activity, tone: o.metrics.overdue ? 'warning' : 'neutral', onClick: () => onIssues('OPEN') },
            { label: 'Places blocked now', value: o.metrics.blocked_places, hint: `of ${o.metrics.places} places`, icon: OctagonAlert, tone: o.metrics.blocked_places ? 'danger' : 'ok', onClick: () => onPlaces('BLOCKED') },
            { label: 'Places to check', value: o.metrics.pending_verification, hint: o.metrics.pending_verification ? 'Waiting for an inspection' : 'All checked', icon: ShieldQuestion, tone: o.metrics.pending_verification ? 'warning' : 'ok', onClick: () => onPlaces('ALL') },
            { label: 'Fixed this week', value: o.metrics.resolved_week, hint: 'Confirmed by residents or staff', icon: CheckCircle2, tone: 'ok', onClick: () => onIssues('FIXED') },
          ];
          return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {tiles.map((t, n) => (
                <button key={t.label} type="button" onClick={t.onClick} style={{ '--i': n } as CSSProperties} className={cn('ops-kpi glass-surface group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`)}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
                    <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
                  </span>
                  <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums"><CountUp value={t.value} delay={n * 60} /></span>
                  <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="line-clamp-2 min-w-0"><Text>{t.hint}</Text></span>
                    <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />
                  </span>
                </button>
              ))}
            </div>
          );
        }}
      </Async>

      <div className="space-y-6">
        <Card id="access-queue" className="ops-panel min-w-0 scroll-mt-24 overflow-hidden">
          <CardHeader
            title="To do"
            description="Only what the app could not route safely on its own, worst first. Everything else is already with its team, or with the default team."
            action={<span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-500"><span aria-hidden className="live-dot" /><Text>Live</Text></span>}
          />
          <Async state={state} skeleton={<SkeletonList rows={4} className="p-5" />}>
            {(o) => {
              const items: TodoItem[] = [
                ...o.attention.map((i) => ({ kind: 'incident' as const, key: i.id, i, reason: i.escalation_reason ?? (i.party_id ? 'OVERDUE' : 'UNROUTED'), score: severity(i) })),
                ...o.suggestions.map((s) => ({ kind: 'place' as const, key: s.id, s, score: 0 })),
              ].sort((a, b) => b.score - a.score);
              const inQueue = (t: TodoItem) =>
                queue === 'ALL' || (queue === 'PLACES' && t.kind === 'place') || (t.kind === 'incident' && (queue === 'NO_TEAM' ? !t.i.party_id : queue === 'STUCK' && Boolean(t.i.party_id)));
              const count = (q: Queue) => items.filter((t) => q === 'ALL' || (q === 'PLACES' && t.kind === 'place') || (t.kind === 'incident' && (q === 'NO_TEAM' ? !t.i.party_id : q === 'STUCK' && Boolean(t.i.party_id)))).length;
              const shown = items.filter(inQueue);
              return <>
                <div className="border-b border-ink-100/80 px-5 py-3 sm:px-6">
                  <FilterChips<Queue> label="Filter the to-do list" size="sm" value={queue} onChange={setQueue} options={[
                    { key: 'ALL', label: 'All', count: count('ALL') },
                    { key: 'NO_TEAM', label: 'No team found', count: count('NO_TEAM'), alert: true },
                    { key: 'STUCK', label: 'Stuck with a team', count: count('STUCK'), alert: true },
                    { key: 'PLACES', label: 'Places to check', count: count('PLACES') },
                  ]} />
                </div>
                <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8.5rem] gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                  <span><Text>Problem</Text></span><span><Text>Why it is here</Text></span><span />
                </div>
                {shown.length ? (
                  <ul key={queue} className="ops-queue divide-y divide-ink-100/80">
                    {shown.slice(0, QUEUE_SHOWN).map((t, n) => (
                      <li key={t.key} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row relative">
                        <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', t.kind === 'place' ? 'bg-gold-500' : railOf(t.i))} />
                        <div className="grid gap-2 py-4 pl-7 pr-5 sm:pr-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8.5rem] lg:items-center lg:gap-4">
                          {t.kind === 'incident' ? <>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                <span className="font-mono font-semibold text-ink-500">{t.i.reference}</span>
                                {PRIORITY_TAG(t.i.priority)}
                              </div>
                              <p className="mt-1 truncate text-[15px] font-semibold text-ink-900"><Text>{categoryLabel(t.i.category)}</Text></p>
                              <p className="truncate text-sm text-ink-600">{t.i.place_name}</p>
                            </div>
                            <div className="min-w-0 text-sm">
                              <p className="font-semibold text-accent-700"><Text>{REASON_LABELS[t.reason] ?? 'Escalated'}</Text></p>
                              <p className="line-clamp-2 text-ink-600"><Text>{REASON_HELP[t.reason]?.why ?? ''}</Text></p>
                              <p className="mt-0.5 text-xs text-ink-500">{t.i.party_name ? <Text>{`With ${t.i.party_name}`}</Text> : <Text>No team yet</Text>} · <Text>{`opened ${timeAgo(t.i.created_at)}`}</Text></p>
                            </div>
                            <div className="lg:text-right">
                              <Button size="sm" variant="secondary" className="w-full lg:w-auto" onClick={() => onOpen(t.i.reference)}><Text>{REASON_HELP[t.reason]?.action ?? 'Review'}</Text></Button>
                            </div>
                          </> : <>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                <span className="font-medium text-ink-500"><Text>{PLACE_KIND_LABELS[t.s.kind]}</Text></span>
                                {t.s.duplicate_name && <span className="rounded bg-warning-50 px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-warning-700"><Text>Possible duplicate</Text></span>}
                              </div>
                              <p className="mt-1 truncate text-[15px] font-semibold text-ink-900">{t.s.name}</p>
                              <p className="truncate text-sm text-ink-600">{t.s.location}</p>
                            </div>
                            <div className="min-w-0 text-sm">
                              <p className="font-semibold text-warning-700"><Text>{t.s.verification === 'PENDING_VERIFICATION' ? 'New place to check' : 'Listing may be wrong'}</Text></p>
                              <p className="line-clamp-2 text-ink-600">
                                <Text>{t.s.verification === 'PENDING_VERIFICATION' ? 'A resident suggested this place. It shows as unverified until someone checks it on site.' : 'Residents say this listing is wrong. Check it on site.'}</Text>
                              </p>
                              {t.s.duplicate_name && <p className="mt-0.5 text-xs text-ink-500"><Text>{`May duplicate “${t.s.duplicate_name}”`}</Text></p>}
                            </div>
                            <div className="lg:text-right">
                              <Button size="sm" variant="secondary" className="w-full lg:w-auto" onClick={() => onInspect({ id: t.s.id, name: t.s.name })}><Text>Check on site</Text></Button>
                            </div>
                          </>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center px-6 py-12 text-center">
                    <span className="ops-ok grid size-12 place-items-center rounded-full bg-success-50 text-success-700"><ShieldCheck className="size-6" aria-hidden /></span>
                    <p className="mt-3 font-semibold text-ink-900"><Text>{queue === 'ALL' ? 'All clear' : 'Nothing in this list'}</Text></p>
                    <p className="mt-1 text-sm text-ink-500"><Text>Every open issue is with its team and on time.</Text></p>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6">
                  <span className="text-ink-500">{shown.length > QUEUE_SHOWN ? <><Text>Showing</Text> {QUEUE_SHOWN} <Text>of</Text> {shown.length}</> : <Text>{`${shown.length} to do`}</Text>}</span>
                  <button type="button" onClick={() => onIssues('OPEN')} className="ops-link font-semibold text-brand-700"><Text>All open issues</Text><ArrowRight className="size-3.5" aria-hidden /></button>
                </div>
              </>;
            }}
          </Async>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="ops-panel flex min-w-0 flex-col overflow-hidden">
            <CardHeader title="Places right now" description="Every place, blocked first." />
            <Async state={places} skeleton={<SkeletonList rows={4} className="p-5" />}>
              {(list) => {
                const order: Availability[] = ['CONFIRMED_BLOCKED', 'REPORTED_BLOCKED', 'RESOLUTION_PENDING', 'UNKNOWN', 'AVAILABLE'];
                const sorted = [...list].sort((a, b) => order.indexOf(a.availability) - order.indexOf(b.availability));
                return <>
                  <ul className="ops-queue flex-1 divide-y divide-ink-100/80">
                    {sorted.slice(0, 5).map((p, n) => (
                      <li key={p.id} style={{ '--i': n } as CSSProperties} className="ops-row flex items-center gap-3 px-5 py-3 sm:px-6">
                        <span aria-hidden className={cn('status-dot shrink-0', PLACE_DOT[p.availability])} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-900">{p.name}</span>
                          <span className="block truncate text-xs text-ink-500"><Text>{PLACE_KIND_LABELS[p.kind]}</Text>{p.verification !== 'VERIFIED' && <> · <Text>{VERIFICATION_LABELS[p.verification]}</Text></>}</span>
                        </span>
                        <span className={cn('shrink-0 text-xs font-semibold', p.availability === 'CONFIRMED_BLOCKED' ? 'text-accent-700' : p.availability === 'AVAILABLE' ? 'text-success-700' : 'text-warning-700')}>
                          <Text>{AVAILABILITY_LABELS[p.availability]}</Text>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6">
                    <button type="button" onClick={() => onPlaces('ALL')} className="ops-link font-semibold text-brand-700"><Text>{`All ${list.length} places`}</Text><ArrowRight className="size-3.5" aria-hidden /></button>
                  </div>
                </>;
              }}
            </Async>
          </Card>

          <Card className="ops-panel min-w-0 overflow-hidden">
            <CardHeader title="Automation" description="What ran without anyone here." />
            <Async state={state} skeleton={<SkeletonList rows={3} className="p-5" />}>
              {(o) => {
                const pct = o.automation.incidents_30d ? Math.round((o.automation.auto_routed_30d / o.automation.incidents_30d) * 100) : 100;
                return (
                  <ul className="ops-queue divide-y divide-ink-100/80 text-sm">
                    <li style={{ '--i': 0 } as CSSProperties} className="ops-row px-5 py-3.5 sm:px-6">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className={cn('status-dot shrink-0', pct >= 80 ? 'is-ok' : 'is-warning')} />
                        <span className="min-w-0 flex-1 font-semibold text-ink-900"><Text>Sent to a team automatically</Text></span>
                        <span className="text-xs font-semibold tabular-nums text-ink-500">{o.automation.auto_routed_30d}/{o.automation.incidents_30d}</span>
                      </div>
                      <div className="ml-5 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <span className="ops-bar block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                      {/* Honest about how it works: the place's own team when known, otherwise the default team. */}
                      <p className="ml-5 mt-1.5 text-xs text-ink-500">
                        <Text>Last 30 days</Text>
                        {o.automation.fallback_30d > 0 && <Text>{` · ${o.automation.fallback_30d} to the default team`}</Text>}
                      </p>
                      <p className="ml-5 mt-0.5 text-xs text-ink-500"><Text>To the team that runs the place when the app knows it; otherwise to the default team. Only when neither can take it does it wait in To do.</Text></p>
                    </li>
                    <li style={{ '--i': 1 } as CSSProperties} className="ops-row flex items-center gap-3 px-5 py-3.5 sm:px-6">
                      <span aria-hidden className={cn('status-dot shrink-0', o.automation.dispatch_failed ? 'is-danger is-pulsing' : o.automation.dispatch_retrying ? 'is-warning' : 'is-ok')} />
                      <span className="min-w-0 flex-1 font-semibold text-ink-900"><Text>Messages to outside teams</Text></span>
                      <span className={cn('text-xs font-semibold', o.automation.dispatch_failed ? 'text-accent-700' : o.automation.dispatch_retrying ? 'text-warning-700' : 'text-success-700')}>
                        <Text>{o.automation.dispatch_failed ? `${o.automation.dispatch_failed} failed` : o.automation.dispatch_retrying ? `${o.automation.dispatch_retrying} retrying` : 'All delivered'}</Text>
                      </span>
                    </li>
                    <li style={{ '--i': 2 } as CSSProperties} className="ops-row flex items-center gap-3 px-5 py-3.5 sm:px-6">
                      <span aria-hidden className={cn('status-dot shrink-0', o.metrics.inspections_due ? 'is-warning' : 'is-ok')} />
                      <span className="min-w-0 flex-1 font-semibold text-ink-900"><Text>Routine inspections</Text></span>
                      <span className={cn('text-xs font-semibold', o.metrics.inspections_due ? 'text-warning-700' : 'text-success-700')}>
                        <Text>{o.metrics.inspections_due ? `${o.metrics.inspections_due} due` : 'Up to date'}</Text>
                      </span>
                    </li>
                    {o.inspections.slice(0, 3).map((p, n) => (
                      <li key={p.id} style={{ '--i': 3 + n } as CSSProperties} className="ops-row flex items-center gap-3 py-2.5 pl-10 pr-5 sm:pr-6">
                        <span className="min-w-0 flex-1 truncate text-ink-700">{p.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => onInspect({ id: p.id, name: p.name })}><Text>{`Due ${formatDate(p.next_inspection_at)}`}</Text></Button>
                      </li>
                    ))}
                  </ul>
                );
              }}
            </Async>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- All issues ----------------------------------------------------------------------------------

type StageFilter = 'OPEN' | Stage | 'ALL';
type Sort = 'WORST' | 'NEWEST' | 'OLDEST';

function IncidentsTab({ initialStage, onOpen }: { initialStage: StageFilter; onOpen: (ref: string) => void }) {
  const [stage, setStage] = useState<StageFilter>(initialStage);
  const [priority, setPriority] = useState<'' | Priority>('');
  const [partyId, setPartyId] = useState('');
  const [sort, setSort] = useState<Sort>('WORST');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim().toLowerCase());
  const parties = useApi<{ parties: Party[] }>('/admin/access/parties');
  // One list, counted and filtered here, so every chip shows an accurate count.
  const list = useApi<IncidentRow[]>('/admin/access/incidents?status=ALL', { refreshInterval: 30_000, keepPreviousData: true });
  const rows = list.data ?? [];
  const base = rows.filter((i) => (!priority || i.priority === priority) && (!partyId || i.party_id === partyId)
    && (!search || `${i.reference} ${i.place_name} ${i.place_location}`.toLowerCase().includes(search)));
  const inStage = (i: IncidentRow, s: StageFilter) => s === 'ALL' || (s === 'OPEN' ? i.status !== 'RESOLVED' : stageOf(i) === s);
  const count = (s: StageFilter) => base.filter((i) => inStage(i, s)).length;
  const shown = base.filter((i) => inStage(i, stage)).sort((a, b) =>
    sort === 'NEWEST' ? b.created_at.localeCompare(a.created_at) : sort === 'OLDEST' ? a.created_at.localeCompare(b.created_at) : severity(b) - severity(a) || a.created_at.localeCompare(b.created_at));
  const filtered = stage !== 'OPEN' || Boolean(priority || partyId || q || sort !== 'WORST');
  return (
    <div className="space-y-4">
      <FilterBar
        search={<SearchField value={q} onChange={setQ} label="Search issues" placeholder="Reference, place or location, e.g. ACC-000012 or Surau" />}
        chips={
          <FilterChips<StageFilter>
            label="Stage"
            value={stage}
            onChange={setStage}
            options={[
              { key: 'OPEN', label: 'All open', count: count('OPEN') },
              { key: 'NEEDS_YOU', label: STAGE_LABELS.NEEDS_YOU, count: count('NEEDS_YOU'), alert: true },
              { key: 'WITH_TEAM', label: STAGE_LABELS.WITH_TEAM, count: count('WITH_TEAM') },
              { key: 'FIXING', label: STAGE_LABELS.FIXING, count: count('FIXING') },
              { key: 'CHECKING', label: STAGE_LABELS.CHECKING, count: count('CHECKING') },
              { key: 'FIXED', label: STAGE_LABELS.FIXED, count: count('FIXED') },
            ]}
          />
        }
        controls={
          <>
            <FilterMenu<'' | Priority> label="Priority" value={priority} onChange={setPriority} options={[{ value: '', label: 'Any' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]} />
            <FilterMenu label="Service provider" value={partyId} onChange={setPartyId} options={[{ value: '', label: 'Any' }, ...(parties.data?.parties ?? []).map((p) => ({ value: p.id, label: p.name, raw: true }))]} />
            <FilterMenu<Sort> label="Sort" value={sort} onChange={setSort} options={[{ value: 'WORST', label: 'Worst first' }, { value: 'NEWEST', label: 'Newest' }, { value: 'OLDEST', label: 'Oldest' }]} />
          </>
        }
        summary={list.data && <FilterSummary live shown={shown.length} total={rows.length} noun="issues" onClear={filtered ? () => { setStage('OPEN'); setPriority(''); setPartyId(''); setSort('WORST'); setQ(''); } : undefined} />}
      />
      <Async state={list} skeleton={<SkeletonList rows={4} />}>
        {() =>
          shown.length === 0 ? (
            <EmptyState icon={Search} title="No issues match"><Text>Try another stage, team or search.</Text></EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div aria-hidden className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_10.5rem_9rem] gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                <span><Text>Issue</Text></span><span><Text>Assigned to</Text></span><span><Text>Time limit</Text></span><span className="text-right"><Text>Stage</Text></span>
              </div>
              <ul className="ops-queue divide-y divide-ink-100/80">
                {shown.map((i, n) => {
                  const s = stageOf(i);
                  return (
                    <li key={i.id} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row relative">
                      <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', railOf(i))} />
                      <button type="button" onClick={() => onOpen(i.reference)} className="grid w-full gap-1.5 py-3 pl-7 pr-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_10.5rem_9rem] lg:items-center lg:gap-4">
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="font-mono font-semibold text-ink-500">{i.reference}</span>
                            {PRIORITY_TAG(i.priority)}
                            {i.reporter_count > 1 && <span className="text-ink-500"><Text>{`${i.reporter_count} reporter(s)`}</Text></span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[15px] font-semibold text-ink-900"><Text>{categoryLabel(i.category)}</Text>: {i.place_name}</span>
                          <span className="block truncate text-xs text-ink-500">{i.place_location}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-sm">
                          {i.party_integration === 'SIMULATED' ? <FlaskConical className="size-3.5 shrink-0 text-gold-700" aria-hidden /> : <Users className="size-3.5 shrink-0 text-ink-400" aria-hidden />}
                          {i.party_name ? <span className="truncate text-ink-700">{i.party_name}</span> : <span className="font-semibold text-accent-700"><Text>No team yet</Text></span>}
                        </span>
                        <TimeCell i={i} />
                        <span className="lg:text-right"><Badge tone={STAGE_TONE[s]}><Text>{STAGE_LABELS[s]}</Text></Badge></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )
        }
      </Async>
    </div>
  );
}

// --- One incident ---------------------------------------------------------------------------------

const PROGRESS_STEPS = ['Reported', 'With the team', 'Being fixed', 'Checking the fix', 'Fixed'] as const;

/** Which of the five plain steps an incident is at. An escalated one stays where it got stuck. */
function progressStep(i: IncidentRow): number {
  if (i.status === 'RESOLVED') return 4;
  if (i.resolution_submitted_at) return 3;
  if (i.acknowledged_at || i.status === 'IN_PROGRESS') return 2;
  if (i.party_id) return 1;
  return 0;
}

function Progress({ incident }: { incident: IncidentRow }) {
  const at = progressStep(incident);
  const stuck = incident.status === 'ESCALATED';
  return (
    <ol className="grid grid-cols-5 gap-1">
      {PROGRESS_STEPS.map((label, n) => {
        const done = n < at || (n === at && incident.status === 'RESOLVED');
        const current = n === at && incident.status !== 'RESOLVED';
        return (
          <li key={label} aria-current={current ? 'step' : undefined} className="text-center">
            <span className={cn('block h-1.5 rounded-full', done ? 'bg-success-600' : current ? (stuck ? 'bg-accent-600' : 'bg-brand-600') : 'bg-ink-200')} />
            <span className={cn('mt-1.5 block text-xs leading-tight', current ? 'font-semibold text-ink-900' : done ? 'text-ink-600' : 'text-ink-500')}>
              <Text>{label}</Text>
              {current && stuck && <span className="block text-accent-700"><Text>Stuck</Text></span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One sentence on what happens next, so nobody has to read the history to know. */
function nextStep(i: IncidentRow, lastReason: string | undefined): string {
  const team = i.party_name ?? '';
  if (i.status === 'RESOLVED') return 'Fixed and confirmed. Residents can reopen it if the problem comes back.';
  if (!i.party_id) return 'Choose the team that runs this place. The app could not work it out, so it did not guess.';
  if (i.status === 'ESCALATED') {
    const why = REASON_HELP[lastReason ?? '']?.why;
    return `${why ? `${why} ` : ''}You can give it to another team, check it on site, or close it.`;
  }
  if (i.resolution_submitted_at) return 'Waiting for residents to confirm the fix. If nobody does in time, you will be asked to check it.';
  if (i.acknowledged_at) return `${team} is fixing it. When they send a photo of the fix, residents are asked to confirm.`;
  return `Waiting for ${team} to accept it. They are reminded automatically if they do not.`;
}

function IncidentDrawer({ reference, onClose, isAdmin, onChanged }: { reference: string | null; onClose: () => void; isAdmin: boolean; onChanged: () => void }) {
  const detail = useApi<Detail>(reference ? `/admin/access/incidents/${reference}` : null);
  const parties = useApi<{ parties: Party[] }>(reference ? '/admin/access/parties' : null);
  const [form, setForm] = useState<null | 'assign' | 'accept' | 'reject' | 'confirm' | 'close' | 'fix'>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const done = () => {
    setForm(null);
    setPhoto(null);
    void detail.mutate();
    onChanged();
  };
  const id = detail.data?.incident.id ?? '';
  const assign = useAction((partyId: string, reason: string) => api.post(`/admin/access/incidents/${id}/assign`, { partyId, reason }), { onSuccess: done, success: 'Assigned. The team has been told.' });
  const verify = useAction((accept: boolean, note: string) => api.post(`/admin/access/incidents/${id}/verify`, { accept, note }), { onSuccess: done, success: 'Recorded.' });
  const override = useAction((action: 'CONFIRM_BLOCKED' | 'RESOLVE', reason: string) => api.post(`/admin/access/incidents/${id}/override`, { action, reason }), { onSuccess: done, success: 'Recorded in the audit trail.' });
  const ack = useAction(() => api.post(`/access-work/${id}/acknowledge`), { onSuccess: done, success: 'Acknowledged.' });
  const fix = useAction(async (actionTaken: string) => api.post(`/access-work/${id}/resolve`, await formWith({ actionTaken }, photo)), { onSuccess: done, success: 'Fix submitted. It is verified before it counts.' });
  const simulate = useAction((type: 'ACKNOWLEDGED' | 'RESOLVED', telemetry = false) => api.post<{ applied: boolean; reason?: string }>(`/admin/access/incidents/${id}/simulate`, { type, telemetry }), {
    onSuccess: done,
    success: (r) => (r.applied ? 'The simulated provider answered.' : `Ignored by the workflow: ${r.reason ?? ''}`),
  });

  const submitText = (event: FormEvent<HTMLFormElement>, name: string) => {
    event.preventDefault();
    return String(new FormData(event.currentTarget).get(name) ?? '');
  };

  return (
    <Drawer open={reference !== null} onClose={onClose} side="right" title={reference ?? ''} description="Incident record">
      <Async state={detail}>
        {(d) => {
          const i = d.incident;
          const pending = d.resolutions.find((r) => r.outcome === 'PENDING');
          const open = i.status !== 'RESOLVED';
          return (
            <div className="space-y-5 text-[15px]">
              <section className="space-y-2">
                <h3 className="text-lg font-semibold text-ink-900"><Text>{categoryLabel(i.category)}</Text>: {i.place_name}</h3>
                <p className="text-sm text-ink-500"><Text>{PLACE_KIND_LABELS[i.place_kind]}</Text> · {i.place_location}</p>
                <p className="flex flex-wrap gap-2"><PriorityBadge value={i.priority} />{overdue(i) && <Badge tone="danger"><Text>Overdue</Text></Badge>}{i.status === 'ESCALATED' && <Badge tone="danger"><Text>Needs you</Text></Badge>}</p>
              </section>

              <Progress incident={i} />

              <p className="flex gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
                <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span><Text>{nextStep(i, d.escalations[0]?.reason)}</Text></span>
              </p>

              {open && (
                <section className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {pending && <Button size="sm" variant="success" onClick={() => setForm('accept')}><ShieldCheck className="size-4" aria-hidden /><Text>It is fixed (I checked)</Text></Button>}
                    {pending && <Button size="sm" variant="secondary" onClick={() => setForm('reject')}><Text>Not fixed</Text></Button>}
                    {isAdmin && !i.party_id && <Button size="sm" onClick={() => setForm('assign')}><Text>Choose a team</Text></Button>}
                    {isAdmin && i.party_id && (i.status === 'ESCALATED' || i.status === 'ASSIGNED' || i.status === 'REOPENED') && <Button size="sm" variant="secondary" onClick={() => setForm('assign')}><Text>Give to another team</Text></Button>}
                  </div>
                  <details className="group rounded-lg border border-ink-200 text-sm">
                    <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-ink-700"><Text>More options</Text></summary>
                    <div className="flex flex-wrap gap-2 border-t border-ink-100 p-3">
                      {i.party_id && i.party_integration === 'IN_APP' && !i.acknowledged_at && !i.resolution_submitted_at && <Button size="sm" variant="secondary" onClick={() => void ack.run()} pending={ack.pending}><Text>Acknowledge for the team</Text></Button>}
                      {i.party_id && i.party_integration === 'IN_APP' && !i.resolution_submitted_at && <Button size="sm" variant="secondary" onClick={() => setForm('fix')}><Text>Submit fix for the team</Text></Button>}
                      {i.blocks_access && !i.confirmed_at && <Button size="sm" variant="secondary" onClick={() => setForm('confirm')}><Text>I saw it is blocked</Text></Button>}
                      {isAdmin && <Button size="sm" variant="ghost" onClick={() => setForm('close')}><Text>Close as resolved</Text></Button>}
                    </div>
                  </details>
                  {isAdmin && i.party_integration === 'SIMULATED' && (
                    <div className="rounded-lg border border-dashed border-gold-500/60 bg-gold-50 p-3 text-sm">
                      <p className="flex items-center gap-2 font-semibold text-gold-700"><FlaskConical className="size-4" aria-hidden /><Text>Demo: play the outside company</Text></p>
                      <p className="mt-1 text-ink-600"><Text>This team uses its own system, which is not connected yet. Press these to answer as that system would.</Text></p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void simulate.run('ACKNOWLEDGED')} disabled={simulate.pending}><Text>They accept the job</Text></Button>
                        <Button size="sm" variant="secondary" onClick={() => void simulate.run('RESOLVED', true)} disabled={simulate.pending}><Text>They report it working again</Text></Button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="rounded-lg border border-ink-200 p-3 text-sm">
                <p className="font-semibold text-ink-900"><Text>Who is handling it</Text></p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  {i.party_name ?? <Text>Nobody yet</Text>}
                  {i.party_kind && <Badge tone="neutral"><Text>{PARTY_KIND_LABELS[i.party_kind]}</Text></Badge>}
                  {i.party_integration === 'SIMULATED' && <Badge tone="gold"><FlaskConical className="size-3.5" aria-hidden /><Text>Simulated integration</Text></Badge>}
                </p>
                {i.exception_reason && <p className="mt-1 text-accent-700"><Text>{i.exception_reason}</Text></p>}
                {i.resolve_due_at && i.status !== 'RESOLVED' && <p className="mt-1 text-ink-600"><Text>{`Should be fixed by ${formatDateTime(i.resolve_due_at)}`}</Text></p>}
                <p className="mt-1 flex flex-wrap gap-2"><VerificationBadge value={i.place_verification} /><AvailabilityBadge value={i.place_availability} /></p>
              </section>

              <section>
                <p className="mb-2 text-sm font-semibold text-ink-900"><Text>{`What residents reported (${d.reports.length})`}</Text></p>
                <ul className="space-y-2">
                  {d.reports.map((r) => (
                    <li key={r.id} className="rounded-lg border border-ink-200 p-3 text-sm">
                      <p className="text-ink-500">{r.reporter} · <Text>{timeAgo(r.created_at)}</Text></p>
                      {r.description && <p className="text-ink-800">{r.description}</p>}
                      {r.photo_id && <a href={`/api/v1/access-photos/${r.photo_id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline"><Text>Photo</Text></a>}
                    </li>
                  ))}
                </ul>
              </section>

              {d.resolutions.length > 0 && (
                <section>
                  <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Fixes the team submitted</Text></p>
                  <ul className="space-y-2">
                    {d.resolutions.map((r) => (
                      <li key={r.id} className="rounded-lg border border-ink-200 p-3 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <Badge tone={r.outcome === 'ACCEPTED' ? 'success' : r.outcome === 'REJECTED' ? 'danger' : 'gold'}><Text>{r.outcome === 'ACCEPTED' ? 'Verified' : r.outcome === 'REJECTED' ? 'Rejected' : 'Waiting for verification'}</Text></Badge>
                          <span className="text-ink-500"><Text>{SOURCE_LABELS[r.source] ?? r.source}</Text> · <Text>{timeAgo(r.submitted_at)}</Text></span>
                        </p>
                        <p className="mt-1 text-ink-800">{r.action_taken}</p>
                        <p className="text-ink-500"><Text>{`${r.clear} confirmed clear · ${r.still_blocked} still blocked`}</Text>{r.telemetry && <> · <Text>Back in service (system report)</Text></>}</p>
                        {r.decision_basis && <p className="text-ink-600"><Text>{r.decision_basis}</Text></p>}
                        {r.photo_id && <a href={`/api/v1/access-photos/${r.photo_id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline"><Text>Evidence photo</Text></a>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <details className="rounded-lg border border-ink-200 text-sm">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-ink-700"><Text>Full record: reminders, messages and history</Text></summary>
                <div className="space-y-5 border-t border-ink-100 p-3">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-ink-600">
                    <dt><Text>Acknowledge by</Text></dt><dd>{i.acknowledged_at ? <Text>Done</Text> : i.ack_due_at ? formatDateTime(i.ack_due_at) : '–'}</dd>
                    <dt><Text>Problem confirmed</Text></dt><dd><Text>{i.confirmed_at ? `Yes (${i.confirmed_by === 'CORROBORATION' ? 'several residents' : i.confirmed_by === 'STAFF' ? 'staff on site' : 'the team'})` : 'Not yet'}</Text></dd>
                    <dt><Text>How it was routed</Text></dt><dd><Text>{i.routing.manual ? `Assigned by an admin: ${i.routing.manual.reason}` : i.routing.rule ? `Routed by a ${i.routing.rule.source === 'DEFAULT' ? 'default' : 'township'} rule.` : '–'}</Text></dd>
                  </dl>
                  {d.escalations.length > 0 && (
                    <section>
                      <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Reminders and escalations</Text></p>
                      <ul className="space-y-1 text-sm">
                        {d.escalations.map((e, n) => (
                          <li key={n} className="flex flex-wrap gap-2">
                            <Badge tone={e.level === 'ESCALATION' ? 'danger' : 'neutral'}><Text>{e.level === 'ESCALATION' ? 'Escalation' : 'Reminder'}</Text></Badge>
                            <span className="text-ink-700"><Text>{REASON_LABELS[e.reason] ?? e.reason}</Text></span>
                            <span className="text-ink-500"><Text>{timeAgo(e.at)}</Text></span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
    
                  {d.dispatches.length > 0 && (
                    <section>
                      <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Messages to the team’s system (simulated)</Text></p>
                      <ul className="space-y-1 text-sm">
                        {d.dispatches.map((m, n) => (
                          <li key={n} className="text-ink-700">
                            <Badge tone={m.status === 'SENT' ? 'success' : m.status === 'FAILED' ? 'danger' : 'gold'}><Text>{m.status === 'SENT' ? 'Delivered' : m.status === 'FAILED' ? 'Failed' : 'Waiting'}</Text></Badge>{' '}
                            <Text>{`${m.attempts} attempt(s)`}</Text>{m.external_ref ? ` · ${m.external_ref}` : ''}{m.last_error ? ` · ${m.last_error}` : ''}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
    
                  <section>
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900">
                      <Text>History</Text>
                      <Badge tone={d.historyIntact ? 'success' : 'danger'}><Text>{d.historyIntact ? 'Unaltered' : 'History does not verify'}</Text></Badge>
                    </p>
                    <ol className="space-y-2 border-l-2 border-ink-200 pl-3 text-sm">
                      {d.events.map((e) => (
                        <li key={e.id}>
                          <p className="text-ink-500">
                            <Text>{formatDateTime(e.at)}</Text> · <Text>{EVENT_LABELS[e.kind] ?? e.kind}</Text> · {e.actor ?? <Text>{e.actor_kind === 'INTEGRATION' ? 'Team’s system' : 'Automatic'}</Text>}
                            {e.visibility === 'PUBLIC' && <> · <Text>shown to residents</Text></>}
                          </p>
                          {e.kind === 'STATUS' ? (
                            <p className="text-ink-800"><Text>{ACCESS_STATUS_LABELS[e.data.from as AccessIncidentStatus] ?? String(e.data.from)}</Text> → <Text>{ACCESS_STATUS_LABELS[e.data.to as AccessIncidentStatus] ?? String(e.data.to)}</Text></p>
                          ) : e.body ? (
                            <p className="text-ink-800"><Text>{e.body}</Text></p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              </details>

              <Modal open={form !== null} onClose={() => setForm(null)} title={form === 'assign' ? 'Choose a team' : form === 'accept' ? 'It is fixed' : form === 'reject' ? 'Not fixed' : form === 'confirm' ? 'I saw it is blocked' : form === 'fix' ? 'Submit the fix for the team' : 'Close as resolved'}
                footer={<Button type="submit" form="access-action" pending={assign.pending || verify.pending || override.pending || fix.pending}><Text>Save</Text></Button>}>
                <form
                  id="access-action"
                  method="post"
                  className="space-y-4"
                  onSubmit={(event) => {
                    const data = new FormData(event.currentTarget);
                    const text = submitText(event, form === 'fix' ? 'actionTaken' : 'reason');
                    if (form === 'assign') void assign.run(String(data.get('partyId') ?? ''), text);
                    else if (form === 'accept') void verify.run(true, text);
                    else if (form === 'reject') void verify.run(false, text);
                    else if (form === 'confirm') void override.run('CONFIRM_BLOCKED', text);
                    else if (form === 'close') void override.run('RESOLVE', text);
                    else if (form === 'fix') void fix.run(text);
                  }}
                >
                  {form === 'assign' && (
                    <Select name="partyId" label="Team" required error={assign.fields.partyId}>
                      {(parties.data?.parties ?? []).filter((p) => p.active && p.id !== i.party_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  )}
                  {form === 'fix' ? (
                    <>
                      <Textarea name="actionTaken" label="What was done?" required minLength={5} maxLength={500} rows={3} error={fix.fields.actionTaken} />
                      <PhotoField label="Photo of the result" name={photo?.name ?? null} onChange={setPhoto} />
                    </>
                  ) : (
                    <Textarea name="reason" label={form === 'accept' || form === 'reject' ? 'What did the inspection find?' : 'Reason (kept in the audit trail)'} required minLength={5} maxLength={300} rows={3} error={assign.fields.reason ?? verify.fields.note ?? override.fields.reason} />
                  )}
                </form>
              </Modal>
            </div>
          );
        }}
      </Async>
    </Drawer>
  );
}

// --- Inspections ---------------------------------------------------------------------------------

function InspectModal({ place, onClose, onDone }: { place: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<'VERIFIED' | 'NOT_VERIFIED' | 'VERIFICATION_REQUIRED'>('VERIFIED');
  const inspect = useAction(async (note: string) => api.post(`/admin/access-places/${place!.id}/inspect`, await formWith({ outcome, note }, photo)), {
    onSuccess: () => {
      setPhoto(null);
      onClose();
      onDone();
    },
    success: 'Inspection recorded.',
  });
  return (
    <Modal open={place !== null} onClose={onClose} title="Record an inspection" description={place?.name} footer={<Button type="submit" form="access-inspect" pending={inspect.pending}><Text>Save inspection</Text></Button>}>
      <form id="access-inspect" method="post" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void inspect.run(String(new FormData(event.currentTarget).get('note') ?? '')); }}>
        <Select label="Finding" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
          <option value="VERIFIED"><Text>Verified accessible</Text></option>
          <option value="NOT_VERIFIED"><Text>Not verified accessible</Text></option>
          <option value="VERIFICATION_REQUIRED"><Text>Needs another check</Text></option>
        </Select>
        <Textarea name="note" label="What was checked" required minLength={3} maxLength={500} rows={3} error={inspect.fields.note} placeholder="e.g. Gradient 1:12, width 1.2 m, handrails both sides" />
        <PhotoField label="Photo (optional)" name={photo?.name ?? null} onChange={setPhoto} />
      </form>
    </Modal>
  );
}

// --- Places ----------------------------------------------------------------------------------------

type AvailFilter = 'ALL' | 'BLOCKED' | 'CHECKING' | 'AVAILABLE' | 'UNKNOWN';
const inAvail = (p: Place, a: AvailFilter) =>
  a === 'ALL' || (a === 'BLOCKED' ? p.availability === 'REPORTED_BLOCKED' || p.availability === 'CONFIRMED_BLOCKED' : a === 'CHECKING' ? p.availability === 'RESOLUTION_PENDING' : p.availability === a);

function PlacesTab({ initialAvail, initialParty, isAdmin, onInspect, onChanged }: { initialAvail: AvailFilter; initialParty: string; isAdmin: boolean; onInspect: (p: { id: string; name: string }) => void; onChanged: () => void }) {
  const [avail, setAvail] = useState<AvailFilter>(initialAvail);
  const [verification, setVerification] = useState<'' | Verification>('');
  const [partyId, setPartyId] = useState(initialParty);
  const [listing, setListing] = useState<'LISTED' | 'ARCHIVED'>('LISTED');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim().toLowerCase());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const places = useApi<Place[]>(`/access-places${listing === 'ARCHIVED' ? '?archived=true' : ''}`, { keepPreviousData: true });
  const parties = useApi<{ parties: Party[] }>('/admin/access/parties');
  const create = useAction((body: Record<string, unknown>) => api.post('/admin/access-places', body), { onSuccess: () => { setAdding(false); void places.mutate(); onChanged(); }, success: 'Added as verified.' });
  const all = places.data ?? [];
  const base = all.filter((p) => (!verification || p.verification === verification) && (!partyId || (partyId === 'NONE' ? !p.party_id : p.party_id === partyId))
    && (!search || `${p.name} ${p.location}`.toLowerCase().includes(search)));
  const count = (a: AvailFilter) => base.filter((p) => inAvail(p, a)).length;
  const rows = base.filter((p) => inAvail(p, avail));
  const filtered = avail !== 'ALL' || Boolean(verification || partyId || q) || listing !== 'LISTED';
  const open = all.find((p) => p.id === openId) ?? null;
  return (
    <div className="space-y-4">
      <FilterBar
        search={<SearchField value={q} onChange={setQ} label="Search places" placeholder="Place name or location, e.g. Surau or Block A" />}
        chips={
          <FilterChips<AvailFilter>
            label="Today"
            value={avail}
            onChange={setAvail}
            options={[
              { key: 'ALL', label: 'All places', count: count('ALL') },
              { key: 'BLOCKED', label: 'Blocked now', count: count('BLOCKED'), alert: true },
              { key: 'CHECKING', label: 'Fix being checked', count: count('CHECKING') },
              { key: 'AVAILABLE', label: AVAILABILITY_LABELS.AVAILABLE, count: count('AVAILABLE') },
              { key: 'UNKNOWN', label: 'Not checked yet', count: count('UNKNOWN') },
            ]}
          />
        }
        controls={
          <>
            <FilterMenu<'' | Verification> label="Verified" value={verification} onChange={setVerification} options={[{ value: '', label: 'Any' }, ...(['VERIFIED', 'PENDING_VERIFICATION', 'VERIFICATION_REQUIRED', 'NOT_VERIFIED'] as const).map((v) => ({ value: v, label: VERIFICATION_LABELS[v] }))]} />
            <FilterMenu label="Service provider" value={partyId} onChange={setPartyId} options={[{ value: '', label: 'Any' }, { value: 'NONE', label: 'Not assigned' }, ...(parties.data?.parties ?? []).map((p) => ({ value: p.id, label: p.name, raw: true }))]} />
            <FilterMenu<'LISTED' | 'ARCHIVED'> label="Show" value={listing} onChange={setListing} options={[{ value: 'LISTED', label: 'Listed' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add a checked place</Text></Button>
          </>
        }
        summary={places.data && <FilterSummary shown={rows.length} total={all.length} noun="places" onClear={filtered ? () => { setAvail('ALL'); setVerification(''); setPartyId(''); setListing('LISTED'); setQ(''); } : undefined} />}
      />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
        <Text>Each place has two badges.</Text>
        <VerificationBadge value="VERIFIED" />
        <Text>means staff checked it is accessible. It only changes after an inspection.</Text>
        <AvailabilityBadge value="AVAILABLE" />
        <Text>means it can be used today. It changes with reports and fixes.</Text>
      </p>
      <Async state={places} skeleton={<SkeletonList rows={4} />}>
        {() =>
          rows.length === 0 ? (
            <EmptyState icon={Search} title="No places match"><Text>Try another filter or search.</Text></EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div aria-hidden className="hidden grid-cols-[minmax(0,1.4fr)_11rem_12rem_minmax(0,1fr)] gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                <span><Text>Place</Text></span><span><Text>Today</Text></span><span><Text>Verified</Text></span><span><Text>Service provider</Text></span>
              </div>
              <ul className="ops-queue divide-y divide-ink-100/80">
                {rows.map((p, n) => (
                  <li key={p.id} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row relative">
                    <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', p.availability === 'CONFIRMED_BLOCKED' ? 'bg-accent-600' : p.availability === 'REPORTED_BLOCKED' ? 'bg-warning-600' : p.verification !== 'VERIFIED' ? 'bg-gold-500' : 'bg-ink-200')} />
                    <button type="button" onClick={() => setOpenId(p.id)} className="grid w-full gap-1.5 py-3 pl-7 pr-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 lg:grid-cols-[minmax(0,1.4fr)_11rem_12rem_minmax(0,1fr)] lg:items-center lg:gap-4">
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-ink-900">{p.name}</span>
                        <span className="block truncate text-xs text-ink-500"><Text>{PLACE_KIND_LABELS[p.kind]}</Text> · {p.location}</span>
                      </span>
                      <span><AvailabilityBadge value={p.availability} /></span>
                      <span className="min-w-0">
                        <VerificationBadge value={p.verification} />
                        <span className="mt-0.5 block text-xs text-ink-500"><Text>{p.last_verified_at ? `Last verified ${formatDate(p.last_verified_at)}` : 'Never verified'}</Text></span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-sm">
                        {p.party_integration === 'SIMULATED' ? <FlaskConical className="size-3.5 shrink-0 text-gold-700" aria-hidden /> : <Users className="size-3.5 shrink-0 text-ink-400" aria-hidden />}
                        {p.party_name ? <span className="truncate text-ink-700">{p.party_name}</span> : <span className="font-semibold text-warning-700"><Text>Not recorded</Text></span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </Async>
      <PlaceModal place={open} parties={parties.data?.parties ?? []} isAdmin={isAdmin} onClose={() => setOpenId(null)} onInspect={(p) => { setOpenId(null); onInspect(p); }} onChanged={() => { void places.mutate(); onChanged(); }} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a place you have checked" footer={<Button type="submit" form="access-add" pending={create.pending}><Text>Add</Text></Button>}>
        <form id="access-add" method="post" className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
          void create.run({ name: f.name, kind: f.kind, location: f.location, ...(f.note ? { note: f.note } : {}), partyId: f.partyId || null });
        }}>
          <Input name="name" label="Name" required maxLength={100} error={create.fields.name} />
          <Select name="kind" label="Kind" defaultValue="RAMP">{PLACE_KINDS.map((k) => <option key={k} value={k}><Text>{PLACE_KIND_LABELS[k]}</Text></option>)}</Select>
          <Input name="location" label="Where it is" required maxLength={160} error={create.fields.location} />
          <Select name="partyId" label="Service provider" defaultValue="">
            <option value=""><Text>Not recorded</Text></option>
            {(parties.data?.parties ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
          <Textarea name="note" label="Notes (optional)" maxLength={300} rows={2} />
        </form>
      </Modal>
    </div>
  );
}

/** One place: its two states, who runs it, and the few things staff can do with it. */
function PlaceModal({ place, parties, isAdmin, onClose, onInspect, onChanged }: {
  place: Place | null; parties: Party[]; isAdmin: boolean; onClose: () => void; onInspect: (p: { id: string; name: string }) => void; onChanged: () => void;
}) {
  const [archiving, setArchiving] = useState(false);
  const setParty = useAction((partyId: string | null) => api.post(`/admin/access-places/${place!.id}/party`, { partyId }), { onSuccess: onChanged, success: 'Saved.' });
  const archive = useAction((reason: string) => api.post(`/admin/access-places/${place!.id}/archive`, { reason }), { onSuccess: () => { setArchiving(false); onClose(); onChanged(); }, success: 'Archived. Its history is kept.' });
  const restore = useAction(() => api.post(`/admin/access-places/${place!.id}/restore`), { onSuccess: () => { onClose(); onChanged(); }, success: 'Restored.' });
  return (
    <Modal open={place !== null} onClose={() => { setArchiving(false); onClose(); }} title={place?.name ?? ''} description={place ? `${PLACE_KIND_LABELS[place.kind]} · ${place.location}` : undefined}
      footer={place && !place.archived_at && <Button onClick={() => onInspect({ id: place.id, name: place.name })}><ClipboardCheck className="size-4" aria-hidden /><Text>Record inspection</Text></Button>}>
      {place && (
        <div className="space-y-5 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-100/80 p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Today</Text></dt>
              <dd className="mt-1.5"><AvailabilityBadge value={place.availability} /></dd>
              <dd className="mt-1 text-xs text-ink-500"><Text>It changes with reports and fixes.</Text></dd>
            </div>
            <div className="rounded-lg border border-ink-100/80 p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Verified</Text></dt>
              <dd className="mt-1.5"><VerificationBadge value={place.verification} /></dd>
              <dd className="mt-1 text-xs text-ink-500">
                <Text>{place.last_verified_at ? `Last verified ${formatDate(place.last_verified_at)}` : 'Never verified'}</Text>
                {place.next_inspection_at && <> · <Text>{`Next inspection ${formatDate(place.next_inspection_at)}`}</Text></>}
              </dd>
            </div>
          </dl>
          {place.incidents.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-ink-700">
              <OctagonAlert className="size-4 text-warning-700" aria-hidden />
              <Text>Open issues here:</Text> {place.incidents.map((x) => <span key={x.reference} className="font-mono font-semibold">{x.reference}</span>)}
            </p>
          )}
          {isAdmin && !place.archived_at ? (
            <Select label="Service provider" hint="Issues at this place are assigned to this provider, unless an assignment rule says otherwise." value={place.party_id ?? ''} onChange={(event) => void setParty.run(event.target.value || null)}>
              <option value=""><Text>Not recorded</Text></option>
              {parties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          ) : (
            <p className="text-ink-700"><Text>Service provider</Text>: {place.party_name ?? <Text>Not recorded</Text>}</p>
          )}
          {place.suggested_by && <p className="text-xs text-ink-500"><Text>{`Suggested by ${place.suggested_by}`}</Text></p>}
          {isAdmin && (
            <div className="border-t border-ink-100/80 pt-4">
              {place.archived_at ? (
                <Button size="sm" variant="ghost" onClick={() => void restore.run()} pending={restore.pending}><Undo2 className="size-4" aria-hidden /><Text>Restore</Text></Button>
              ) : archiving ? (
                <form method="post" className="space-y-3" onSubmit={(event) => { event.preventDefault(); void archive.run(String(new FormData(event.currentTarget).get('reason') ?? '')); }}>
                  <p className="text-ink-600"><Text>It leaves the directory, but its record, inspections and incidents are kept. You can restore it.</Text></p>
                  <Textarea name="reason" label="Reason" required minLength={5} maxLength={300} rows={2} error={archive.fields.reason} />
                  <div className="flex gap-2">
                    <Button size="sm" type="submit" variant="danger" pending={archive.pending}><Text>Archive</Text></Button>
                    <Button size="sm" variant="ghost" onClick={() => setArchiving(false)}><Text>Cancel</Text></Button>
                  </div>
                </form>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setArchiving(true)}><Trash2 className="size-4" aria-hidden /><Text>Archive this place</Text></Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// --- Configuration ---------------------------------------------------------------------------------

type ConfigSection = 'providers' | 'rules' | 'levels' | 'simulation';
interface ConfigData {
  parties: (Party & { places: number; open_issues: number })[];
  people: { id: string; full_name: string; role: string }[];
  changes: Record<'providers' | 'rules' | 'levels', { at: string; by: string | null } | null>;
}

const CHANNEL_LABEL = (p: Pick<Party, 'integration'>) => (p.integration === 'SIMULATED' ? 'External system' : 'SimeTown app');
const ROLE_NAMES: Record<string, string> = { GUARD: 'Guard', GUARDHOUSE: 'Guardhouse staff', TOWNSHIP_STAFF: 'Township staff', TOWNSHIP_ADMIN: 'Township admin' };

/** Minutes as people say them: 30 min, 4 hours, 3 working days. */
function duration(minutes: number, working: boolean): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (working && hours >= 9 && hours % 9 === 0) return hours === 9 ? '1 working day' : `${hours / 9} working days`;
  return hours === 1 ? '1 hour' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** "Last changed by …" under each section, with the audit log one click away. */
function Governance({ change, isAdmin }: { change: { at: string; by: string | null } | null; isAdmin: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-xs text-ink-500 sm:px-6">
      <span><Text>{change ? `Last changed by ${change.by ?? 'the system'} on ${formatDateTime(change.at)}` : 'Using the standard configuration. No changes yet.'}</Text></span>
      {isAdmin && <a href="/console/audit" className="ops-link font-semibold text-brand-700"><Text>View audit trail</Text><ArrowRight className="size-3.5" aria-hidden /></a>}
    </div>
  );
}

function SectionHead({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div className="min-w-0 max-w-2xl">
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>{title}</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>{description}</Text></p>
      </div>
      {action}
    </div>
  );
}

const HEAD = 'border-b border-ink-100/80 bg-ink-25/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500';

function ConfigurationTab({ isAdmin, onPlaces }: { isAdmin: boolean; onPlaces: (filter: { partyId: string }) => void }) {
  const [section, setSection] = useState<ConfigSection>('providers');
  const [providerId, setProviderId] = useState<string | null>(null);
  const data = useApi<ConfigData>('/admin/access/parties', { keepPreviousData: true });
  const rules = useApi<RoutingRule[]>('/admin/access/rules', { keepPreviousData: true });
  const places = useApi<Place[]>('/access-places', { keepPreviousData: true });
  const parties = data.data?.parties ?? [];
  const custom = (rules.data ?? []).filter((r) => r.source === 'TOWNSHIP');

  // Configuration checks: problems that would stop issues reaching anyone, each with a way to fix it.
  const checks: { text: string; fix: string; onFix: () => void }[] = [];
  const unassigned = (places.data ?? []).filter((p) => !p.party_id).length;
  if (unassigned) checks.push({ text: `${unassigned} place(s) have no service provider. Issues there need a manual decision.`, fix: 'Assign providers', onFix: () => onPlaces({ partyId: 'NONE' }) });
  for (const p of parties.filter((x) => x.active && x.integration === 'IN_APP' && x.members.length === 0)) {
    checks.push({ text: `${p.name} has no responders, so it cannot receive issues.`, fix: 'Add responders', onFix: () => { setSection('providers'); setProviderId(p.id); } });
  }
  for (const r of custom) {
    const target = r.target.type === 'PARTY' ? parties.find((p) => p.id === (r.target as { partyId: string }).partyId) : undefined;
    if (target && !target.active) checks.push({ text: `An assignment rule sends issues to ${target.name}, which is inactive.`, fix: 'Review rules', onFix: () => setSection('rules') });
  }

  const nav: { key: ConfigSection; label: string; hint: string; icon: LucideIcon; count?: number; admin?: boolean }[] = [
    { key: 'providers', label: 'Service providers', hint: 'Who maintains each facility', icon: Users, count: parties.length },
    { key: 'rules', label: 'Assignment rules', hint: 'Which provider gets which issue', icon: Route, count: custom.length || undefined },
    { key: 'levels', label: 'Service levels', hint: 'Response and resolution times', icon: Clock3 },
    { key: 'simulation', label: 'Simulation', hint: 'Prototype controls only', icon: FlaskConical, admin: true },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start">
      {/* Stays in view below the top bar while the section beside it scrolls. */}
      <aside className="lg:sticky lg:top-[5.5rem] lg:self-start">
        <Card className="overflow-hidden">
          <p className="hidden border-b border-ink-100/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:block"><Text>Configuration</Text></p>
          <LocalizedNav aria-label="Configuration sections" className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
            {nav.filter((n) => !n.admin || isAdmin).map((n) => {
              const on = section === n.key;
              return (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => { setSection(n.key); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-brand-600',
                    on ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-ink-50',
                    n.key === 'simulation' && 'lg:mt-2',
                  )}
                >
                  {on && <span aria-hidden className="absolute inset-y-2 left-0 hidden w-1 rounded-r-full bg-brand-600 lg:block" />}
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', on ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500')}><n.icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Text>{n.label}</Text>
                      {n.key === 'simulation' && <span className="rounded bg-gold-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-gold-700"><Text>Demo</Text></span>}
                    </span>
                    <span className="hidden text-xs text-ink-500 lg:block"><Text>{n.hint}</Text></span>
                  </span>
                  {n.count !== undefined && <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-600 ring-1 ring-ink-100">{n.count}</span>}
                </button>
              );
            })}
          </LocalizedNav>
        </Card>
      </aside>

      <div className="min-w-0 space-y-6">
        {data.data && places.data && rules.data && section !== 'simulation' && (
          checks.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-success-700">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              <Text>Configuration complete. Every place has a service provider, and every provider can receive issues.</Text>
            </p>
          ) : (
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.text} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-600/25 bg-warning-50 px-4 py-3 text-sm">
                  <span className="flex items-center gap-2.5 text-ink-800"><OctagonAlert className="size-4 shrink-0 text-warning-700" aria-hidden /><Text>{c.text}</Text></span>
                  {isAdmin && <Button size="sm" variant="secondary" onClick={c.onFix}><Text>{c.fix}</Text></Button>}
                </li>
              ))}
            </ul>
          )
        )}

        {section === 'providers' && <ProvidersSection state={data} isAdmin={isAdmin} onOpen={setProviderId} />}
        {section === 'rules' && <RulesSection rules={rules} parties={parties} places={places.data ?? []} change={data.data?.changes.rules ?? null} isAdmin={isAdmin} />}
        {section === 'levels' && <LevelsSection change={data.data?.changes.levels ?? null} isAdmin={isAdmin} />}
        {section === 'simulation' && isAdmin && <SimulationSection parties={parties} onChanged={() => void data.mutate()} />}
      </div>

      <ProviderPanel
        provider={parties.find((p) => p.id === providerId) ?? null}
        people={data.data?.people ?? []}
        places={(places.data ?? []).filter((p) => p.party_id === providerId)}
        isAdmin={isAdmin}
        onClose={() => setProviderId(null)}
        onChanged={() => void data.mutate()}
      />
    </div>
  );
}

function ProvidersSection({ state, isAdmin, onOpen }: { state: ReturnType<typeof useApi<ConfigData>>; isAdmin: boolean; onOpen: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [external, setExternal] = useState(false);
  const create = useAction((body: Record<string, unknown>) => api.post<{ id: string }>('/admin/access/parties', body), {
    onSuccess: (r) => { setAdding(false); void state.mutate(); onOpen(r.id); },
    success: 'Service provider added.',
  });
  return (
    <Card className="ops-panel overflow-hidden">
      <SectionHead
        title="Service providers"
        description="The organisations responsible for maintaining facilities. Issues are assigned to them automatically, based on the assignment rules."
        action={isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add service provider</Text></Button>}
      />
      <Async state={state} skeleton={<SkeletonList rows={3} className="p-5" />}>
        {(d) => (
          <div className="mt-5">
            <div aria-hidden className={cn(HEAD, 'hidden grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_6.5rem_5rem_6.5rem_6.5rem] gap-4 px-5 py-2 sm:px-6 lg:grid')}>
              <span><Text>Provider</Text></span><span><Text>Channel</Text></span><span className="text-right"><Text>Responders</Text></span><span className="text-right"><Text>Places</Text></span><span className="text-right"><Text>Open issues</Text></span><span><Text>Status</Text></span>
            </div>
            <ul className="ops-queue divide-y divide-ink-100/80">
              {d.parties.map((p, n) => (
                <li key={p.id} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row">
                  <button type="button" onClick={() => onOpen(p.id)} className="grid w-full gap-1.5 px-5 py-3.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_6.5rem_5rem_6.5rem_6.5rem] lg:items-center lg:gap-4">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-snug text-ink-900">{p.name}</span>
                      <span className="block text-xs text-ink-500"><Text>{PARTY_KIND_LABELS[p.kind]}</Text></span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-700 lg:block">
                      <span className="block"><Text>{CHANNEL_LABEL(p)}</Text></span>
                      {p.integration === 'SIMULATED' && <span className="inline-block rounded bg-gold-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-gold-700 lg:mt-0.5"><Text>Simulated</Text></span>}
                    </span>
                    <span className={cn('tabular-nums lg:text-right', p.integration === 'IN_APP' && p.members.length === 0 ? 'font-semibold text-warning-700' : 'text-ink-700')}>
                      {p.integration === 'IN_APP' ? p.members.length : <span className="text-xs text-ink-500"><Text>Own system</Text></span>}
                      <span className="lg:hidden"> <Text>responders</Text></span>
                    </span>
                    <span className="tabular-nums text-ink-700 lg:text-right">{p.places}<span className="lg:hidden"> <Text>places</Text></span></span>
                    <span className="tabular-nums text-ink-700 lg:text-right">{p.open_issues}<span className="lg:hidden"> <Text>open issues</Text></span></span>
                    <span className="flex items-center gap-2 text-ink-700">
                      <span aria-hidden className={cn('status-dot', p.active ? 'is-ok' : 'is-idle')} />
                      <Text>{p.active ? 'Active' : 'Inactive'}</Text>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Async>
      <Governance change={state.data?.changes.providers ?? null} isAdmin={isAdmin} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add service provider" footer={<Button type="submit" form="access-party" pending={create.pending}><Text>Add service provider</Text></Button>}>
        <form id="access-party" method="post" className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
          void create.run({ name: f.name, kind: f.kind, integration: external ? 'SIMULATED' : 'IN_APP', ...(f.contact ? { contact: f.contact } : {}) });
        }}>
          <Input name="name" label="Organisation name" required maxLength={100} error={create.fields.name} placeholder="e.g. Harmoni Elmina JMB" />
          <Select name="kind" label="Type">{PARTY_KINDS.map((k) => <option key={k} value={k}><Text>{PARTY_KIND_LABELS[k]}</Text></option>)}</Select>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-ink-900"><Text>How it receives issues</Text></legend>
            {[
              { value: false, title: 'SimeTown app', text: 'Its staff use SimeTown. You choose who responds after adding it.' },
              { value: true, title: 'External system', text: 'It uses its own job system. The connection is simulated in this prototype.' },
            ].map((o) => (
              <label key={o.title} className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 has-checked:border-brand-500 has-checked:bg-brand-50/50">
                <input type="radio" name="channel" checked={external === o.value} onChange={() => setExternal(o.value)} className="mt-1 size-4 accent-brand-600" />
                <span><span className="block text-sm font-semibold text-ink-900"><Text>{o.title}</Text></span><span className="block text-sm text-ink-500"><Text>{o.text}</Text></span></span>
              </label>
            ))}
          </fieldset>
          <Input name="contact" label="Contact (optional)" maxLength={160} placeholder="e.g. Management office, Block A" />
        </form>
      </Modal>
    </Card>
  );
}

/** One provider: who responds for it, which places it covers, and whether it is active. */
function ProviderPanel({ provider, people, places, isAdmin, onClose, onChanged }: {
  provider: (Party & { places: number; open_issues: number }) | null; people: ConfigData['people']; places: Place[]; isAdmin: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [person, setPerson] = useState('');
  const update = useAction((body: Record<string, unknown>) => api.post(`/admin/access/parties/${provider!.id}`, body), { onSuccess: () => { setPerson(''); onChanged(); }, success: 'Saved.' });
  const p = provider;
  return (
    <Drawer open={p !== null} onClose={onClose} side="right" title={p?.name ?? ''} description={p ? PARTY_KIND_LABELS[p.kind] : undefined}>
      {p && (
        <div className="space-y-6 text-sm">
          <dl className="grid grid-cols-3 gap-3">
            {[{ label: 'Places', value: p.places }, { label: 'Open issues', value: p.open_issues }, { label: 'Responders', value: p.integration === 'IN_APP' ? p.members.length : '–' }].map((s) => (
              <div key={s.label} className="rounded-lg border border-ink-100/80 p-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>{s.label}</Text></dt>
                <dd className="mt-1 font-display text-xl font-bold tabular-nums text-ink-900">{s.value}</dd>
              </div>
            ))}
          </dl>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>How it receives issues</Text></h3>
            <p className="mt-1.5 font-semibold text-ink-900"><Text>{CHANNEL_LABEL(p)}</Text></p>
            <p className="text-ink-600">
              <Text>{p.integration === 'SIMULATED' ? 'Issues are sent to this provider’s own job system, without the resident’s name or address. The connection is simulated in this prototype.' : 'Its responders are notified in SimeTown. They acknowledge the issue, fix it and submit a photo as evidence.'}</Text>
            </p>
            {p.contact && <p className="mt-1 text-ink-500">{p.contact}</p>}
          </section>

          {p.integration === 'IN_APP' && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Responders</Text></h3>
              <p className="mt-1 text-ink-600"><Text>People who receive this provider’s issues. They use their existing SimeTown account.</Text></p>
              {p.members.length === 0 ? (
                <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 font-medium text-warning-700"><Text>No responders yet. Issues for this provider will need a manual decision.</Text></p>
              ) : (
                <ul className="mt-2 divide-y divide-ink-100/80 rounded-lg border border-ink-100/80">
                  {p.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span><span className="font-medium text-ink-900">{m.full_name}</span> <span className="text-xs text-ink-500"><Text>{ROLE_NAMES[m.role] ?? m.role}</Text></span></span>
                      {isAdmin && <Button size="sm" variant="ghost" onClick={() => void update.run({ removeMember: m.id })} disabled={update.pending}><Text>Remove</Text></Button>}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <form method="post" className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (person) void update.run({ addMember: person }); }}>
                  <Select label="Add a responder" value={person} onChange={(event) => setPerson(event.target.value)} className="min-w-0 flex-1 basis-52">
                    <option value=""><Text>Choose a person</Text></option>
                    {people.filter((u) => !p.members.some((m) => m.id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </Select>
                  <Button type="submit" size="sm" variant="secondary" disabled={!person} pending={update.pending}><Text>Add</Text></Button>
                </form>
              )}
            </section>
          )}

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Places covered</Text></h3>
            {places.length === 0 ? (
              <p className="mt-1.5 text-ink-500"><Text>None yet. Assign it to places from the Places tab.</Text></p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {places.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 text-ink-700"><span aria-hidden className={cn('status-dot', PLACE_DOT[x.availability])} />{x.name} <span className="text-xs text-ink-500"><Text>{PLACE_KIND_LABELS[x.kind]}</Text></span></li>
                ))}
              </ul>
            )}
          </section>

          {isAdmin && (
            <section className="border-t border-ink-100/80 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Status</Text></h3>
              <p className="mt-1 text-ink-600">
                <Text>{p.active ? 'Active. New issues can be assigned to this provider.' : 'Inactive. New issues for its places go to To do for a manual decision.'}</Text>
              </p>
              <Button className="mt-2" size="sm" variant={p.active ? 'ghost' : 'secondary'} onClick={() => void update.run({ active: !p.active })} pending={update.pending}><Text>{p.active ? 'Deactivate provider' : 'Activate provider'}</Text></Button>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * The last rule: the default team. A problem no rule can place (nobody recorded for the place, no team of the
 * right kind, or more than one) goes here at once instead of waiting, marked so its owner gets recorded. Changing
 * it also sends anything already waiting there.
 */
function DefaultTeamCard({ policy, parties, isAdmin }: { policy: ReturnType<typeof useApi<AccessPolicy>>; parties: Party[]; isAdmin: boolean }) {
  const save = useAction((defaultPartyId: string | null) => api.post<AccessPolicy>('/admin/access/policy', { defaultPartyId }), {
    onSuccess: (p) => void policy.mutate(p, { revalidate: false }),
    success: 'Default team saved. Anything waiting for a team was sent there.',
  });
  const current = parties.find((p) => p.id === policy.data?.defaultPartyId);
  const empty = current && current.integration === 'IN_APP' && current.members.length === 0;
  return (
    <Card className="ops-panel overflow-hidden">
      <SectionHead
        title="Last rule: default team"
        description="When no rule can place an issue (nobody is recorded for the place, or no single team fits), it goes to this team at once instead of waiting. They are asked to record who runs the place, so it routes on its own next time."
      />
      <div className="space-y-3 px-5 pb-5 pt-4 sm:px-6">
        {isAdmin ? (
          <Select
            label="Default team"
            value={policy.data?.defaultPartyId ?? ''}
            disabled={save.pending || !policy.data}
            onChange={(event) => void save.run(event.target.value || null)}
            hint="Usually township operations. Choose None to send such issues to To do for an admin instead."
          >
            <option value=""><Text>None: wait in To do for an admin</Text></option>
            {parties.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        ) : (
          <p className="text-sm text-ink-700"><Text>{current ? `Default team: ${current.name}` : 'No default team: such issues wait in To do for an admin.'}</Text></p>
        )}
        {empty && (
          <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700"><Text>{`${current!.name} has nobody set up to act for it, so issues cannot go there. Add a responder in Organisations.`}</Text></p>
        )}
      </div>
    </Card>
  );
}

function RulesSection({ rules, parties, places, change, isAdmin }: {
  rules: ReturnType<typeof useApi<RoutingRule[]>>; parties: Party[]; places: Place[]; change: { at: string; by: string | null } | null; isAdmin: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [testCategory, setTestCategory] = useState<AccessCategory>('OBSTRUCTION');
  const [testPlace, setTestPlace] = useState('');
  const save = useAction((body: Record<string, unknown>) => api.post<RoutingRule[]>('/admin/access/rules', body), { onSuccess: (r) => { setAdding(false); void rules.mutate(r, { revalidate: false }); }, success: 'Rule saved. It applies to new issues.' });
  const remove = useAction((id: string) => api.post<RoutingRule[]>(`/admin/access/rules/${id}/delete`), { onSuccess: (r) => void rules.mutate(r, { revalidate: false }), success: 'Rule removed. The standard rule applies again.' });
  const target = (r: RoutingRule) =>
    r.target.type === 'PLACE' ? 'The facility’s service provider' : r.target.type === 'PARTY' ? parties.find((p) => p.id === (r.target as { partyId: string }).partyId)?.name ?? 'A named provider' : PARTY_KIND_LABELS[r.target.kind];

  const policy = useApi<AccessPolicy>('/admin/access/policy');
  // Test routing: the same rules the server applies, run here on a sample issue, then the default team last.
  const place = places.find((p) => p.id === testPlace) ?? places[0];
  const canTake = (p: Party | undefined) => Boolean(p && p.active && (p.integration !== 'IN_APP' || p.members.length > 0));
  const result = place && rules.data ? (() => {
    const rule = pickRule(rules.data, testCategory, place.kind);
    const decided = resolveParty(rule, place.party_id, parties.map((p) => ({ id: p.id, kind: p.kind, active: p.active })));
    const party = 'partyId' in decided ? parties.find((p) => p.id === decided.partyId) : undefined;
    const noResponders = party && party.integration === 'IN_APP' && party.members.length === 0;
    const reason = 'exception' in decided ? decided.exception : noResponders ? `${party!.name} has no responders.` : null;
    if (canTake(party)) return { rule, party, reason: null, fallback: false };
    const fallback = parties.find((p) => p.id === policy.data?.defaultPartyId);
    if (canTake(fallback)) return { rule, party: fallback, reason, fallback: true };
    return { rule, party: undefined, reason, fallback: false };
  })() : null;

  return (
    <div className="space-y-6">
      <Card className="ops-panel overflow-hidden">
        <SectionHead title="Test assignment" description="Choose an issue and a place to see who would receive it, and why." />
        <div className="grid gap-3 px-5 pb-5 pt-4 sm:grid-cols-2 sm:px-6">
          <Select label="Issue type" value={testCategory} onChange={(event) => setTestCategory(event.target.value as AccessCategory)}>
            {ACCESS_CATEGORIES.map((c) => <option key={c} value={c}><Text>{ACCESS_CATEGORY_INFO[c].label}</Text></option>)}
          </Select>
          <Select label="Place" value={place?.id ?? ''} onChange={(event) => setTestPlace(event.target.value)}>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        {result && (
          <div className={cn('flex items-start gap-3 border-t px-5 py-4 text-sm sm:px-6', result.party ? 'border-success-600/20 bg-success-50' : 'border-warning-600/20 bg-warning-50')}>
            {result.party ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden /> : <OctagonAlert className="mt-0.5 size-5 shrink-0 text-warning-700" aria-hidden />}
            <div>
              <p className="font-semibold text-ink-900">
                {result.party ? <><Text>Assigned to</Text> {result.party.name}</> : <Text>Not assigned. It goes to To do for a manual decision.</Text>}
                {' · '}<Text>Priority</Text>: <Text>{PRIORITY_LABELS[result.rule.priority]}</Text>
              </p>
              <p className="mt-0.5 text-ink-600">
                <Text>{result.fallback ? 'Sent to the default team, because the rule could not place it.' : result.rule.source === 'TOWNSHIP' ? 'Based on a custom rule.' : 'Based on the standard rule.'}</Text>{' '}
                {result.reason && <Text>{result.reason}</Text>}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card className="ops-panel overflow-hidden">
        <SectionHead
          title="Assignment rules"
          description="Each issue type is assigned automatically. A rule for a specific facility type takes priority over a general one, and custom rules take priority over the standard ones."
          action={isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add rule</Text></Button>}
        />
        <Async state={rules} skeleton={<SkeletonList rows={4} className="p-5" />}>
          {(list) => (
            <div className="mt-5">
              <div aria-hidden className={cn(HEAD, 'hidden grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.3fr)_6rem_6rem_5rem] gap-4 px-5 py-2 sm:px-6 lg:grid')}>
                <span><Text>Issue type</Text></span><span><Text>Facility</Text></span><span><Text>Assigned to</Text></span><span><Text>Priority</Text></span><span><Text>Source</Text></span><span />
              </div>
              <ul className="ops-queue divide-y divide-ink-100/80">
                {list.map((r, n) => (
                  <li key={r.id ?? `d${n}`} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row grid gap-1.5 px-5 py-3 text-sm sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.3fr)_6rem_6rem_5rem] lg:items-center lg:gap-4">
                    <span className="font-medium text-ink-900"><Text>{ACCESS_CATEGORY_INFO[r.category].label}</Text></span>
                    <span className="text-ink-600"><Text>{r.placeKind ? PLACE_KIND_LABELS[r.placeKind] : 'All facilities'}</Text></span>
                    <span className="text-ink-700"><Text>{target(r)}</Text></span>
                    <span>{PRIORITY_TAG(r.priority) ?? <span className="text-ink-600"><Text>{PRIORITY_LABELS[r.priority]}</Text></span>}</span>
                    <span><Badge tone={r.source === 'TOWNSHIP' ? 'brand' : 'neutral'}><Text>{r.source === 'TOWNSHIP' ? 'Custom' : 'Standard'}</Text></Badge></span>
                    <span className="lg:text-right">{isAdmin && r.id && <Button size="sm" variant="ghost" onClick={() => void remove.run(r.id!)}><Text>Remove</Text></Button>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Async>
        <Governance change={change} isAdmin={isAdmin} />
      </Card>

      <DefaultTeamCard policy={policy} parties={parties} isAdmin={isAdmin} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add assignment rule" description="If a rule already exists for the same issue and facility, it is replaced." footer={<Button type="submit" form="access-rule" pending={save.pending}><Text>Save rule</Text></Button>}>
        <form id="access-rule" method="post" className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
          void save.run({ category: f.category, placeKind: f.placeKind || null, target: f.partyId ? 'PARTY' : 'PLACE', partyId: f.partyId || null, priority: f.priority });
        }}>
          <Select name="category" label="When the issue is">{ACCESS_CATEGORIES.map((c) => <option key={c} value={c}><Text>{ACCESS_CATEGORY_INFO[c].label}</Text></option>)}</Select>
          <Select name="placeKind" label="At" defaultValue=""><option value=""><Text>All facilities</Text></option>{PLACE_KINDS.map((k) => <option key={k} value={k}><Text>{PLACE_KIND_LABELS[k]}</Text></option>)}</Select>
          <Select name="partyId" label="Assign to" defaultValue="" hint="Choose the facility’s own provider unless one organisation handles this issue everywhere, such as security for parking."><option value=""><Text>The facility’s service provider</Text></option>{parties.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="priority" label="Priority" defaultValue="NORMAL">{PRIORITIES.map((p) => <option key={p} value={p}><Text>{PRIORITY_LABELS[p]}</Text></option>)}</Select>
        </form>
      </Modal>
    </div>
  );
}

function LevelsSection({ change, isAdmin }: { change: { at: string; by: string | null } | null; isAdmin: boolean }) {
  const policy = useApi<AccessPolicy>('/admin/access/policy');
  const [editing, setEditing] = useState(false);
  const save = useAction((body: Partial<AccessPolicy>) => api.post<AccessPolicy>('/admin/access/policy', body), { onSuccess: (p) => { setEditing(false); void policy.mutate(p, { revalidate: false }); }, success: 'Service levels saved.' });
  return (
    <Card className="ops-panel overflow-hidden">
      <SectionHead
        title="Service levels"
        description="How quickly providers must acknowledge and resolve issues. A reminder is sent when a deadline passes; if it is still not handled, the issue moves to To do."
        action={<span className="flex flex-wrap items-center gap-2">
          <Badge tone="gold"><Text>Proposed, pending SDP approval</Text></Badge>
          {isAdmin && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Text>Edit</Text></Button>}
        </span>}
      />
      <Async state={policy} skeleton={<SkeletonList rows={4} className="p-5" />}>
        {(p) => (
          <form method="post" className="mt-5" onSubmit={(event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            const num = (k: string) => Number(f.get(k));
            void save.run({
              targets: Object.fromEntries(PRIORITIES.map((pr) => [pr, { ack: Math.round(num(`ack-${pr}`) * 60), resolve: Math.round(num(`resolve-${pr}`) * 60), working: f.get(`working-${pr}`) === 'on' }])) as AccessPolicy['targets'],
              confirmations: Object.fromEntries(PRIORITIES.map((pr) => [pr, num(`confirm-${pr}`)])) as AccessPolicy['confirmations'],
              verifyHours: num('verifyHours'), disputeDays: num('disputeDays'), corroboration: num('corroboration'),
            });
          }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className={HEAD}>
                  <tr>
                    <th className="px-5 py-2 font-semibold sm:px-6"><Text>Priority</Text></th>
                    <th className="px-3 py-2 font-semibold"><Text>Acknowledge within</Text></th>
                    <th className="px-3 py-2 font-semibold"><Text>Resolve within</Text></th>
                    <th className="px-3 py-2 font-semibold"><Text>Time counted</Text></th>
                    <th className="px-3 py-2 font-semibold"><Text>Confirmations to close</Text></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100/80">
                  {PRIORITIES.map((pr) => {
                    const t = p.targets[pr];
                    return (
                      <tr key={pr}>
                        <td className="px-5 py-3 sm:px-6">{PRIORITY_TAG(pr) ?? <span className="font-medium text-ink-700"><Text>{PRIORITY_LABELS[pr]}</Text></span>}</td>
                        {editing ? <>
                          <td className="px-3 py-2"><Input label={`${PRIORITY_LABELS[pr]}: acknowledge within (hours)`} labelClassName="sr-only" name={`ack-${pr}`} type="number" min={0.1} step={0.1} defaultValue={t.ack / 60} /></td>
                          <td className="px-3 py-2"><Input label={`${PRIORITY_LABELS[pr]}: resolve within (hours)`} labelClassName="sr-only" name={`resolve-${pr}`} type="number" min={0.25} step={0.25} defaultValue={t.resolve / 60} /></td>
                          <td className="px-3 py-2"><Checkbox label="Business hours only" name={`working-${pr}`} defaultChecked={t.working} /></td>
                          <td className="px-3 py-2"><Input label={`${PRIORITY_LABELS[pr]}: confirmations`} labelClassName="sr-only" name={`confirm-${pr}`} type="number" min={1} max={5} defaultValue={p.confirmations[pr]} /></td>
                        </> : <>
                          <td className="px-3 py-3 tabular-nums text-ink-800"><Text>{duration(t.ack, t.working)}</Text></td>
                          <td className="px-3 py-3 tabular-nums text-ink-800"><Text>{duration(t.resolve, t.working)}</Text></td>
                          <td className="px-3 py-3 text-ink-600"><Text>{t.working ? 'Business hours' : 'Around the clock'}</Text></td>
                          <td className="px-3 py-3 tabular-nums text-ink-800">{p.confirmations[pr]}</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-ink-100/80 px-5 py-4 sm:px-6">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Verification</Text></h3>
              {editing ? (
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <Input name="verifyHours" type="number" min={1} max={336} label="Wait for confirmation (hours)" hint="Then staff are asked to inspect the fix." defaultValue={p.verifyHours} />
                  <Input name="corroboration" type="number" min={2} max={10} label="Reports that confirm a problem" hint="Separate residents reporting the same issue." defaultValue={p.corroboration} />
                  <Input name="disputeDays" type="number" min={1} max={60} label="Reopening period (days)" hint="Residents can reopen a resolved issue within this time." defaultValue={p.disputeDays} />
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
                  <li><Text>{`A reported fix waits up to ${p.verifyHours} hours for resident confirmation, then staff are asked to inspect it.`}</Text></li>
                  <li><Text>{`A problem is treated as confirmed when ${p.corroboration} separate residents report it, or the provider acknowledges it.`}</Text></li>
                  <li><Text>{`Residents can reopen a resolved issue within ${p.disputeDays} days.`}</Text></li>
                </ul>
              )}
            </div>
            {editing && (
              <div className="flex gap-2 border-t border-ink-100/80 px-5 py-3 sm:px-6">
                <Button type="submit" size="sm" pending={save.pending}><Text>Save service levels</Text></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><Text>Cancel</Text></Button>
              </div>
            )}
          </form>
        )}
      </Async>
      <Governance change={change} isAdmin={isAdmin} />
    </Card>
  );
}

/** Prototype-only controls that stand in for systems not yet connected. Kept apart from the real configuration. */
function SimulationSection({ parties, onChanged }: { parties: Party[]; onChanged: () => void }) {
  const update = useAction((id: string, simulateFailures: number) => api.post(`/admin/access/parties/${id}`, { simulateFailures }), { onSuccess: onChanged, success: 'Saved.' });
  const external = parties.filter((p) => p.integration === 'SIMULATED');
  return (
    <Card className="ops-panel overflow-hidden">
      <SectionHead title="Simulation" description="Controls for demonstrating external systems that are not connected yet. They are not part of the production configuration." />
      <p className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-gold-500/40 bg-gold-50 px-3 py-2.5 text-sm text-ink-700 sm:mx-6">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden />
        <Text>To make a provider accept or complete a job, open the issue and use the simulation panel there.</Text>
      </p>
      {external.length === 0 ? (
        <p className="p-5 text-sm text-ink-500 sm:px-6"><Text>No provider uses an external system.</Text></p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-100/80 border-t border-ink-100/80">
          {external.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm sm:px-6">
              <span className="min-w-0">
                <span className="block font-semibold text-ink-900">{p.name}</span>
                <span className="block text-ink-600"><Text>{p.simulate_failures ? `The next ${p.simulate_failures} message(s) will fail, to show automatic retries.` : 'Messages are delivered normally.'}</Text></span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void update.run(p.id, Math.min(10, p.simulate_failures + 2))} disabled={update.pending}><Text>Simulate an outage</Text></Button>
                {p.simulate_failures > 0 && <Button size="sm" variant="ghost" onClick={() => void update.run(p.id, 0)} disabled={update.pending}><Text>Restore</Text></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
