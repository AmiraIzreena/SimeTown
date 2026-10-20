'use client';

import { Text } from '@/components/ui/localized-text';

import {
  CalendarCheck, CheckCircle2, ChevronDown, ClipboardList, Copy, Hand, Pause, Phone, Play, Plus, Printer, Recycle, Scale, ShieldCheck, Truck, XCircle, type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { ScheduleText } from '@/components/features/collector-schedule';
import { COLLECTION_STATUS } from '@/components/features/collections';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { BarChart } from '@/components/ui/charts';
import { CountUp } from '@/components/ui/count-up';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { FilterChips, FilterMenu } from '@/components/ui/filter-bar';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatKg, formatMonth, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import {
  DAY_PRESETS, DAY_PRESET_LABELS, SCHEDULE_TIMES, SCHEDULE_TIME_LABELS, WEEKDAYS, WEEKDAY_LABELS, type DayPreset, type ScheduleTime, type Weekday,
} from '@/shared/collector-schedule';
import { ADMINS, MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

/**
 * The console for booked collections. Bookings confirm themselves, the gate
 * pass is made, the household sends the weight and the nightly job closes the
 * rest. This page leads with the few cases the system cannot settle, each with
 * the action that settles it, and keeps what ran by itself one click away.
 */

type Tab = 'attention' | 'collectors' | 'accepted';
type Slot = 'MORNING' | 'AFTERNOON';
type ReviewReason = 'OVER_LIMIT' | 'NO_GATE_SCAN' | 'COLLECTOR_CAME';

interface Review {
  id: string;
  status: 'CONFIRMED' | 'MISSED';
  day: string;
  slot: Slot;
  materials: Material[];
  items: string;
  reported_weight_g: number | null;
  reported_at: string;
  review_reason: ReviewReason;
  gate_scanned: boolean;
  collector: string;
  township: string;
  house: string;
}
interface Exceptions {
  reviews: Review[];
  homes: { home_id: string; township: string; events: number; house: string }[];
  collectors: { collector_id: string; township: string; collector: string; phone: string | null; events: number }[];
  summary: { upcoming: number; collected: number; by_staff: number; missed: number };
}
interface Collection {
  id: string;
  home_id: string;
  materials: Material[];
  items: string;
  day: string;
  slot: Slot;
  status: keyof typeof COLLECTION_STATUS;
  weight_g: number | null;
  reported_weight_g: number | null;
  reviewed_at: string | null;
  in_review: boolean;
  gate_scanned: boolean;
  collector: string;
  township: string;
  house: string;
}
interface Collector {
  id: string;
  name: string;
  phone: string | null;
  materials: Material[];
  days: string;
  notes: string | null;
  active: boolean;
  township: string;
  collections: number;
  collected_g: number;
}
interface DaySheet {
  collector: string;
  phone: string | null;
  day: string;
  collections: { id: string; slot: Slot; materials: Material[]; items: string; pass_code: string | null; house: string }[];
}
interface Stats {
  months: { month: string; acceptedG: number; kioskG: number; machineG: number; collectionG: number; rejectionPct: number | null }[];
  topRejections: { reason: string; n: number }[];
}

const SLOT_LABEL: Record<Slot, string> = { MORNING: 'Morning', AFTERNOON: 'Afternoon' };

/** Why each case is here, and what settling it does. */
const REASON: Record<ReviewReason, { title: string; why: string; rail: string }> = {
  OVER_LIMIT: { title: 'Weight over the automatic limit', why: 'The gate scanned the collector, but the weight is more than the system accepts on its own.', rail: 'bg-warning-600' },
  NO_GATE_SCAN: { title: 'Weight sent with no gate scan', why: 'The household sent a weight, but the gate has no record of the collector.', rail: 'bg-warning-600' },
  COLLECTOR_CAME: { title: 'Household says the collector came', why: 'The system marked this collection as missed. The household disagrees.', rail: 'bg-accent-500' },
};

/** How the system settled a collection, in one line. */
function handledBy(x: Collection): string {
  if (x.status === 'CANCELLED') return 'Cancelled by the household';
  if (x.status === 'REQUESTED') return 'Waiting to be confirmed';
  if (x.status === 'CONFIRMED') return x.gate_scanned ? 'Collector arrived. Waiting for the weight' : 'Booked. Gate pass ready';
  if (x.status === 'MISSED') return x.reviewed_at ? 'Missed. Checked by staff' : 'Missed. The collector did not come';
  if (x.reviewed_at) return 'Settled by staff';
  if (x.weight_g == null) return 'Closed with no weight';
  return x.reported_weight_g != null ? 'Weight sent by the household' : 'Weight recorded by staff';
}

type Queue = 'ALL' | 'WEIGHTS' | 'DISPUTES' | 'WATCH';
type Item =
  | { kind: 'review'; key: string; r: Review }
  | { kind: 'home'; key: string; h: Exceptions['homes'][number] }
  | { kind: 'collector'; key: string; c: Exceptions['collectors'][number] };
const inQueue = (t: Item, q: Queue) =>
  q === 'ALL'
  || (q === 'WEIGHTS' && t.kind === 'review' && t.r.review_reason !== 'COLLECTOR_CAME')
  || (q === 'DISPUTES' && t.kind === 'review' && t.r.review_reason === 'COLLECTOR_CAME')
  || (q === 'WATCH' && t.kind !== 'review');

export default function RecyclingConsolePage() {
  const me = useApi<Me>('/me');
  const hq = me.data?.role === 'HQ_ADMIN';
  // Adding a collector is set-up work for township admins and SDP HQ; staff run the day to day.
  const canSetUp = me.data ? ADMINS.includes(me.data.role) : false;
  const townships = useApi<{ id: string; name: string }[]>(hq ? '/townships' : null);
  const [townshipId, setTownshipId] = useState('');
  const [tab, setTab] = useState<Tab>('attention');
  const scope = townshipId ? `?townshipId=${townshipId}` : '';
  const exceptions = useApi<Exceptions>(`/admin/kitar/collections/exceptions${scope}`, { refreshInterval: 30_000, keepPreviousData: true });
  const attention = exceptions.data ? exceptions.data.reviews.length + exceptions.data.homes.length + exceptions.data.collectors.length : undefined;

  return (
    <div className="parcel-workspace">
      <PageHeader
        title="Recycling collections"
        description="Bookings, gate passes, weights and missed collections are handled automatically. You only see what the system cannot settle on its own."
        action={hq && townships.data && (
          <FilterMenu<string> label="Township" value={townshipId} onChange={setTownshipId} options={[{ value: '', label: 'All townships' }, ...townships.data.map((t) => ({ value: t.id, label: t.name, raw: true }))]} />
        )}
      />
      <div className="mb-5">
        <Tabs<Tab>
          label="Recycling sections"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'attention', label: 'Needs attention', count: attention },
            { key: 'collectors', label: 'Collectors' },
            { key: 'accepted', label: 'Material accepted' },
          ]}
        />
      </div>
      <div key={tab} className="parcel-view">
        {tab === 'attention' && <Attention state={exceptions} scope={scope} hq={hq} />}
        {tab === 'collectors' && <Collectors scope={scope} hq={hq} canSetUp={canSetUp} townships={townships.data ?? []} townshipId={townshipId} onAdded={() => void exceptions.mutate()} />}
        {tab === 'accepted' && <Accepted scope={scope} />}
      </div>
    </div>
  );
}

// --- Needs attention ---------------------------------------------------------------------------

function Attention({ state, scope, hq }: { state: ReturnType<typeof useApi<Exceptions>>; scope: string; hq: boolean }) {
  const [queue, setQueue] = useState<Queue>('ALL');
  const [approving, setApproving] = useState<Review | null>(null);
  const [confirming, setConfirming] = useState<{ kind: 'reject' | 'missed'; r: Review } | { kind: 'pause'; c: Exceptions['collectors'][number] } | null>(null);
  const [homeOpen, setHomeOpen] = useState<Exceptions['homes'][number] | null>(null);
  const [showHandled, setShowHandled] = useState(false);
  // The read-only list loads only once it is opened, or when a home's collections are asked for.
  const recent = useApi<Collection[]>(showHandled || homeOpen ? `/admin/kitar/collections${scope}` : null, { keepPreviousData: true });
  const refresh = () => {
    setApproving(null);
    setConfirming(null);
    void state.mutate();
    void recent.mutate();
  };
  const review = useAction((id: string, body: { decision: 'ACCEPT' | 'REJECT'; weightG?: number }) => api.post(`/admin/kitar/collections/${id}/review`, body), {
    success: 'Done. The household has been told.',
    onSuccess: refresh,
  });
  const missed = useAction((id: string) => api.post(`/admin/kitar/collections/${id}/missed`), { success: 'Marked as missed. The household has been told.', onSuccess: refresh });
  const pause = useAction((id: string) => api.post(`/admin/kitar/collectors/${id}/active`, { active: false }), {
    success: 'Collector paused. Households can no longer book them.',
    onSuccess: refresh,
  });
  const submitApprove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kg = Number(new FormData(event.currentTarget).get('kg'));
    if (kg > 0 && approving) void review.run(approving.id, { decision: 'ACCEPT', weightG: Math.round(kg * 1000) });
  };

  return (
    <div className="space-y-6">
      <Async state={state} skeleton={<SkeletonStats count={4} />}>
        {(o) => {
          const open = o.reviews.length + o.homes.length + o.collectors.length;
          const tiles: { label: string; value: number; hint: string; icon: LucideIcon; tone: 'danger' | 'warning' | 'ok' | 'neutral' }[] = [
            { label: 'Needs attention', value: open, hint: open ? 'Only what the system could not settle' : 'Nothing waiting', icon: Hand, tone: o.reviews.length ? 'danger' : open ? 'warning' : 'ok' },
            { label: 'Booked ahead', value: o.summary.upcoming, hint: 'Confirmed, gate pass ready', icon: CalendarCheck, tone: 'neutral' },
            { label: 'Collected in 30 days', value: o.summary.collected, hint: `${o.summary.collected - o.summary.by_staff} with no staff action`, icon: CheckCircle2, tone: 'ok' },
            { label: 'Missed in 30 days', value: o.summary.missed, hint: 'Households were asked to book again', icon: XCircle, tone: o.summary.missed ? 'warning' : 'ok' },
          ];
          return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((t, n) => (
                <div key={t.label} style={{ '--i': n } as CSSProperties} className={cn('ops-kpi glass-surface relative overflow-hidden rounded-xl border p-4 shadow-sm', `is-${t.tone}`)}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
                    <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
                  </span>
                  <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums"><CountUp value={t.value} delay={n * 60} /></span>
                  <span className="ops-kpi-hint mt-2 block line-clamp-2 text-xs"><Text>{t.hint}</Text></span>
                </div>
              ))}
            </div>
          );
        }}
      </Async>

      <Card className="ops-panel min-w-0 overflow-hidden">
        <CardHeader
          title="Needs attention"
          description="Weights to check, disputed missed collections, and homes or collectors to watch. Oldest first."
          action={<span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-500"><span aria-hidden className="live-dot" /><Text>Live</Text></span>}
        />
        <Async state={state} skeleton={<SkeletonList rows={3} className="p-5" />}>
          {(o) => {
            const items: Item[] = [
              ...o.reviews.map((r) => ({ kind: 'review' as const, key: r.id, r })),
              ...o.collectors.map((c) => ({ kind: 'collector' as const, key: c.collector_id, c })),
              ...o.homes.map((h) => ({ kind: 'home' as const, key: h.home_id, h })),
            ];
            const count = (q: Queue) => items.filter((t) => inQueue(t, q)).length;
            const shown = items.filter((t) => inQueue(t, queue));
            if (items.length === 0) {
              return (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <span className="ops-ok grid size-12 place-items-center rounded-full bg-success-50 text-success-700"><ShieldCheck className="size-6" aria-hidden /></span>
                  <p className="mt-3 font-semibold text-ink-900"><Text>Nothing needs your attention. The system is handling collections.</Text></p>
                </div>
              );
            }
            return <>
              <div className="border-b border-ink-100/80 px-5 py-3 sm:px-6">
                <FilterChips<Queue> label="Filter the list" size="sm" value={queue} onChange={setQueue} options={[
                  { key: 'ALL', label: 'All', count: count('ALL') },
                  { key: 'WEIGHTS', label: 'Weights to check', count: count('WEIGHTS'), alert: true },
                  { key: 'DISPUTES', label: 'Disputes', count: count('DISPUTES'), alert: true },
                  { key: 'WATCH', label: 'To watch', count: count('WATCH') },
                ]} />
              </div>
              <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem] gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                <span><Text>Collection</Text></span><span><Text>Why it is here</Text></span><span />
              </div>
              {shown.length ? (
                <ul key={queue} className="ops-queue divide-y divide-ink-100/80">
                  {shown.map((t, n) => (
                    <li key={t.key} style={{ '--i': Math.min(n, 12) } as CSSProperties} className="ops-row relative">
                      <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', t.kind === 'review' ? REASON[t.r.review_reason].rail : 'bg-gold-500')} />
                      <div className="grid gap-2 py-4 pl-7 pr-5 sm:pr-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem] lg:items-center lg:gap-4">
                        {t.kind === 'review' ? <>
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-ink-900">{t.r.collector}</p>
                            <p className="truncate text-sm text-ink-600"><Text>{t.r.house}</Text>{hq && <> · {t.r.township}</>}</p>
                            <p className="truncate text-xs text-ink-500"><Text>{formatDate(t.r.day)}</Text> · <Text>{SLOT_LABEL[t.r.slot]}</Text> · {t.r.items}</p>
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-accent-700"><Text>{REASON[t.r.review_reason].title}</Text></p>
                            <p className="line-clamp-2 text-ink-600"><Text>{REASON[t.r.review_reason].why}</Text></p>
                            <p className="mt-0.5 text-xs text-ink-400">
                              {t.r.reported_weight_g ? <Text>{`${formatKg(t.r.reported_weight_g)} from the household`}</Text> : <Text>No weight sent</Text>}
                              {' · '}<Text>{t.r.gate_scanned ? 'Gate scanned' : 'No gate scan'}</Text>
                              {' · '}<Text>{timeAgo(t.r.reported_at)}</Text>
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <Button size="sm" variant="success" onClick={() => setApproving(t.r)}><Scale className="size-4" aria-hidden /><Text>Approve weight</Text></Button>
                            {t.r.review_reason === 'NO_GATE_SCAN' && (
                              <Button size="sm" variant="secondary" onClick={() => setConfirming({ kind: 'missed', r: t.r })}><Text>Mark missed</Text></Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setConfirming({ kind: 'reject', r: t.r })}>
                              <Text>{t.r.review_reason === 'COLLECTOR_CAME' ? 'Keep as missed' : 'Reject'}</Text>
                            </Button>
                          </div>
                        </> : t.kind === 'collector' ? <>
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-ink-900">{t.c.collector}</p>
                            <p className="truncate text-sm text-ink-600"><Text>Collector</Text>{hq && <> · {t.c.township}</>}{t.c.phone && <> · {t.c.phone}</>}</p>
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-warning-700"><Text>{`${t.c.events} missed collections in 30 days`}</Text></p>
                            <p className="line-clamp-2 text-ink-600"><Text>Households can still book them. Contact them, or pause them until it is sorted.</Text></p>
                          </div>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            {t.c.phone && <Button size="sm" variant="secondary" href={`tel:${t.c.phone}`}><Phone className="size-4" aria-hidden /><Text>Call</Text></Button>}
                            <Button size="sm" variant="ghost" onClick={() => setConfirming({ kind: 'pause', c: t.c })}><Pause className="size-4" aria-hidden /><Text>Pause collector</Text></Button>
                          </div>
                        </> : <>
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-ink-900"><Text>{t.h.house}</Text></p>
                            <p className="truncate text-sm text-ink-600"><Text>Household</Text>{hq && <> · {t.h.township}</>}</p>
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-warning-700"><Text>{`${t.h.events} large weights or reward limit hits in 30 days`}</Text></p>
                            <p className="line-clamp-2 text-ink-600"><Text>Rewards still stop at the household limits. Check their recent collections for anything unusual.</Text></p>
                          </div>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <Button size="sm" variant="secondary" onClick={() => setHomeOpen(t.h)}><Text>See collections</Text></Button>
                          </div>
                        </>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-6 py-10 text-center text-sm text-ink-500"><Text>Nothing in this list.</Text></p>
              )}
              <div className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm text-ink-500 sm:px-6"><Text>{`${shown.length} to check`}</Text></div>
            </>;
          }}
        </Async>
      </Card>

      <Card className="ops-panel min-w-0 overflow-hidden">
        <button
          type="button"
          aria-expanded={showHandled}
          onClick={() => setShowHandled((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
        >
          <span>
            <span className="block font-semibold text-ink-900"><Text>Handled automatically</Text></span>
            <span className="block text-sm text-ink-500"><Text>Recent collections and how the system settled each one. Read-only.</Text></span>
          </span>
          <ChevronDown className={cn('size-5 shrink-0 text-ink-400 transition-transform', showHandled && 'rotate-180')} aria-hidden />
        </button>
        {showHandled && (
          <Async state={recent} skeleton={<SkeletonList rows={4} className="p-5" />}>
            {(rows) => <HandledList rows={rows.filter((x) => !x.in_review)} hq={hq} />}
          </Async>
        )}
      </Card>

      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title="Approve the weight"
        description="Check it with the collector if you can. The household earns Impact XP and any campaign points, within their limits."
        footer={<><Button variant="secondary" onClick={() => setApproving(null)}><Text>Cancel</Text></Button><Button type="submit" form="approve-weight" pending={review.pending}><Text>Approve</Text></Button></>}
      >
        <form method="post" id="approve-weight" onSubmit={submitApprove} key={approving?.id}>
          <Input
            label="Weight (kg)" name="kg" type="number" min={0.1} max={500} step={0.1} required
            defaultValue={approving?.reported_weight_g ? approving.reported_weight_g / 1000 : undefined}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming?.kind === 'pause' ? 'Pause this collector?' : confirming?.kind === 'missed' ? 'Mark as missed?' : confirming?.r.review_reason === 'COLLECTOR_CAME' ? 'Keep as missed?' : 'Reject this weight?'}
        confirmLabel={confirming?.kind === 'pause' ? 'Pause collector' : confirming?.kind === 'missed' ? 'Mark missed' : confirming?.r.review_reason === 'COLLECTOR_CAME' ? 'Keep as missed' : 'Reject'}
        destructive
        pending={review.pending || missed.pending || pause.pending}
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.kind === 'pause') void pause.run(confirming.c.collector_id);
          else if (confirming.kind === 'missed') void missed.run(confirming.r.id);
          else void review.run(confirming.r.id, { decision: 'REJECT' });
        }}
      >
        <Text>
          {confirming?.kind === 'pause'
            ? 'Households will not be able to book them until you resume them in Collectors. Bookings already made stay as they are.'
            : confirming?.kind === 'missed'
              ? 'The collection is closed as missed with no points, and the household is asked to book again.'
              : 'The collection is closed with no points, and the household is told.'}
        </Text>
      </ConfirmDialog>

      <Modal open={homeOpen !== null} onClose={() => setHomeOpen(null)} title="Recent collections" description={homeOpen?.house}>
        <Async state={recent} skeleton={<SkeletonList rows={3} />}>
          {(rows) => <HandledList rows={rows.filter((x) => x.home_id === homeOpen?.home_id)} hq={hq} />}
        </Async>
      </Modal>
    </div>
  );
}

/** Read-only: what happened to each collection, with no actions. */
function HandledList({ rows, hq }: { rows: Collection[]; hq: boolean }) {
  if (rows.length === 0) return <p className="px-6 py-8 text-center text-sm text-ink-500"><Text>No collections yet.</Text></p>;
  return (
    <ul className="divide-y divide-ink-100/80 border-t border-ink-100/80">
      {rows.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">{x.collector} <span className="font-normal text-ink-500">· <Text>{x.house}</Text>{hq && <> · {x.township}</>}</span></p>
            <p className="truncate text-xs text-ink-500">
              <Text>{formatDate(x.day)}</Text> · <Text>{SLOT_LABEL[x.slot]}</Text> · <Text>{handledBy(x)}</Text>
              {x.weight_g ? <> · <Text>{formatKg(x.weight_g)}</Text></> : null}
            </p>
          </div>
          <Badge tone={COLLECTION_STATUS[x.status].tone}><Text>{COLLECTION_STATUS[x.status].label}</Text></Badge>
        </li>
      ))}
    </ul>
  );
}

// --- Collectors --------------------------------------------------------------------------------

/** Collectors have no account: the day's list to copy into a message or print. */
function DaySheetModal({ collector, onClose }: { collector: Collector | null; onClose: () => void }) {
  const sheet = useApi<DaySheet>(collector ? `/admin/kitar/collectors/${collector.id}/today` : null);
  const toast = useToast();
  const asText = (s: DaySheet) =>
    [`${s.collector}: ${s.day}`, ...s.collections.map((x, i) => `${i + 1}. ${SLOT_LABEL[x.slot]} · ${x.house} · ${x.materials.map((m) => MATERIAL_INFO[m].label).join(', ')} · ${x.items}${x.pass_code ? ` · Gate pass ${x.pass_code}` : ''}`)].join('\n');
  const copy = async (s: DaySheet) => {
    try {
      await navigator.clipboard.writeText(asText(s));
      toast.show('Copied. Paste it into a message to the collector.', 'success');
    } catch {
      toast.show('Could not copy. Select the list and copy it instead.', 'error');
    }
  };
  return (
    <Modal open={collector !== null} onClose={onClose} title="Today’s collections" description={collector?.name}>
      <Async state={sheet} skeleton={<SkeletonList rows={2} />}>
        {(s) => (
          <div className="space-y-4">
            <p className="text-sm text-ink-600"><Text>{formatDate(s.day)}</Text>{s.phone && ` · ${s.phone}`}</p>
            {s.collections.length === 0 ? (
              <EmptyState icon={Truck} title="No collections today" />
            ) : (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-800">
                {s.collections.map((x) => (
                  <li key={x.id}>
                    <span className="font-semibold"><Text>{SLOT_LABEL[x.slot]}</Text> · <Text>{x.house}</Text></span>
                    <span className="block text-ink-600">
                      {x.materials.map((m) => <Text key={m}>{`${MATERIAL_INFO[m].label}. `}</Text>)}
                      {x.items}
                    </span>
                    {x.pass_code && <span className="block text-ink-600"><Text>{`Gate pass ${x.pass_code}`}</Text></span>}
                  </li>
                ))}
              </ol>
            )}
            {s.collections.length > 0 && (
              <div className="no-print flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void copy(s)}><Copy className="size-4" aria-hidden /><Text>Copy</Text></Button>
                <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /><Text>Print</Text></Button>
              </div>
            )}
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Collectors({ scope, hq, canSetUp, townships, townshipId, onAdded }: {
  scope: string;
  hq: boolean;
  canSetUp: boolean;
  townships: { id: string; name: string }[];
  townshipId: string;
  onAdded: () => void;
}) {
  const list = useApi<Collector[]>(`/admin/kitar/collectors${scope}`);
  const [open, setOpen] = useState(false);
  const [sheetFor, setSheetFor] = useState<Collector | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  // When they work: a preset, or days picked one by one, and a time. Defaults: every day, both times.
  const [preset, setPreset] = useState<DayPreset>('EVERY_DAY');
  const [chosenDays, setChosenDays] = useState<Weekday[]>([]);
  const [time, setTime] = useState<ScheduleTime>('BOTH');
  const scheduleDays: Weekday[] = preset === 'CHOOSE' ? chosenDays : [...DAY_PRESETS[preset]];
  const create = useAction((body: Record<string, unknown>) => api.post('/admin/kitar/collectors', body), {
    success: 'Collector added. Households can book them now.',
    onSuccess: () => {
      setOpen(false);
      setMaterials([]);
      setPreset('EVERY_DAY');
      setChosenDays([]);
      setTime('BOTH');
      void list.mutate();
      onAdded();
    },
  });
  const toggleActive = useAction((id: string, active: boolean) => api.post(`/admin/kitar/collectors/${id}/active`, { active }), { onSuccess: () => { void list.mutate(); onAdded(); } });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void create.run({
      name: String(form.get('name') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim() || undefined,
      schedule: { days: scheduleDays, time },
      notes: String(form.get('notes') ?? '').trim() || undefined,
      townshipId: hq ? String(form.get('townshipId') ?? '') || undefined : undefined,
      materials,
    });
  };
  return (
    <>
      {canSetUp && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /><Text>Add a collector</Text></Button>
        </div>
      )}
      <Async state={list} skeleton={<SkeletonList rows={3} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={Truck} title="No partner collectors yet" />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {rows.map((c) => (
                <li key={c.id}>
                  <Card className={cn('space-y-3 p-5', !c.active && 'opacity-70')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-lg font-bold text-ink-900">{c.name}</p>
                        <p className="text-sm text-ink-500"><ScheduleText stored={c.days} />{c.phone && ` · ${c.phone}`}{hq && ` · ${c.township}`}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive.run(c.id, !c.active)} disabled={toggleActive.pending}>
                        {c.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                        <Text>{c.active ? 'Pause' : 'Resume'}</Text>
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.materials.map((m) => <Badge key={m} tone="brand"><Text>{MATERIAL_INFO[m].label}</Text></Badge>)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-ink-600"><Text>{`${c.collections} collections · ${formatKg(c.collected_g)}`}</Text></p>
                      <Button size="sm" variant="secondary" onClick={() => setSheetFor(c)}><ClipboardList className="size-4" aria-hidden /><Text>Today’s collections</Text></Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      <DaySheetModal collector={sheetFor} onClose={() => setSheetFor(null)} />
      <Modal
        open={canSetUp && open}
        onClose={() => setOpen(false)}
        title="Add a collector"
        description="A licensed recycler or collector who comes to homes in the township."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}><Text>Cancel</Text></Button><Button type="submit" form="new-collector" pending={create.pending} disabled={materials.length === 0 || scheduleDays.length === 0}><Text>Add</Text></Button></>}
      >
        <form method="post" id="new-collector" onSubmit={submit} className="space-y-4" noValidate>
          {hq && (
            <Select label="Township" name="townshipId" defaultValue={townshipId} required error={create.fields.townshipId}>
              <option value="" disabled><Text>Choose a township</Text></option>
              {townships.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          <Input label="Name" name="name" maxLength={80} required error={create.fields.name} />
          <Input label="Phone (optional)" name="phone" maxLength={30} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Days" value={preset} onChange={(event) => setPreset(event.target.value as DayPreset)}>
              {(Object.keys(DAY_PRESET_LABELS) as DayPreset[]).map((p) => <option key={p} value={p}><Text>{DAY_PRESET_LABELS[p]}</Text></option>)}
            </Select>
            <Select label="Time" value={time} onChange={(event) => setTime(event.target.value as ScheduleTime)}>
              {SCHEDULE_TIMES.map((t) => <option key={t} value={t}><Text>{SCHEDULE_TIME_LABELS[t]}</Text></option>)}
            </Select>
          </div>
          {preset === 'CHOOSE' && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>Which days</Text></legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={chosenDays.includes(d)}
                    onClick={() => setChosenDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                    className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', chosenDays.includes(d) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300')}
                  >
                    <Text>{WEEKDAY_LABELS[d]}</Text>
                  </button>
                ))}
              </div>
              {chosenDays.length === 0 && <p className="mt-1.5 text-sm text-ink-500"><Text>Choose at least one day.</Text></p>}
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>What they take</Text></legend>
            <div className="flex flex-wrap gap-2">
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={materials.includes(m)}
                  onClick={() => setMaterials((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
                  className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', materials.includes(m) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300')}
                >
                  <Text>{MATERIAL_INFO[m].label}</Text>
                </button>
              ))}
            </div>
          </fieldset>
          <Input label="Notes (optional)" name="notes" maxLength={200} />
        </form>
      </Modal>
    </>
  );
}

// --- Material accepted -------------------------------------------------------------------------

function Accepted({ scope }: { scope: string }) {
  const stats = useApi<Stats>(`/admin/kitar/stats${scope}`);
  return (
    <Async state={stats} skeleton={<SkeletonStats count={2} />}>
      {(s) => {
        const last = s.months[s.months.length - 1];
        const before = s.months[s.months.length - 2];
        const change = last && before && before.acceptedG > 0 ? Math.round(((last.acceptedG - before.acceptedG) / before.acceptedG) * 100) : null;
        return (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Accepted this month" value={last?.acceptedG ?? 0} format={formatKg} icon={Recycle} hint={change != null ? `${change >= 0 ? '+' : ''}${change}% on last month` : 'Kiosks, machines and collections'} />
              <Stat label="Machine rejection rate" value={last?.rejectionPct != null ? `${last.rejectionPct}%` : '–'} icon={XCircle} tone="warning" hint="Items the smart machines turned away" />
              <Stat label="Collected from homes this month" value={last?.collectionG ?? 0} format={formatKg} icon={Truck} tone="gold" />
            </div>
            <Card>
              <CardHeader title="Material accepted by month" description="The brief’s test: more material accepted for recycling." />
              <div className="p-5">
                <BarChart
                  label="Kilograms accepted by month"
                  data={s.months.map((m) => ({ label: formatMonth(m.month), values: [Math.round(m.kioskG / 1000), Math.round(m.machineG / 1000), Math.round(m.collectionG / 1000)] }))}
                  series={[
                    { name: 'Kiosks (kg)', className: 'bg-brand-600' },
                    { name: 'Smart machines (kg)', className: 'bg-gold-500' },
                    { name: 'Collections (kg)', className: 'bg-success-600' },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Why machines turned items away" description="Last 90 days. Use these to improve the guide and the signs at each machine." />
              {s.topRejections.length === 0 ? (
                <div className="p-5"><EmptyState icon={XCircle} title="No items turned away" /></div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {s.topRejections.map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                      <span className="text-ink-800"><Text>{r.reason}</Text></span>
                      <span className="font-semibold tabular-nums text-ink-900">{r.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </Async>
  );
}
