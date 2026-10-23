'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv, LocalizedImg } from '@/components/ui/localized-elements';
import { AlertTriangle, ArrowRight, Box, CheckCircle2, ChevronLeft, ChevronRight, Clock, History, Inbox, MessageSquareText, PackageCheck, Phone, PhoneCall, ScanLine, ShieldAlert, Store, Undo2 } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { mutate } from 'swr';
import { CameraScan } from '@/components/features/camera-scan';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Drawer } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { Checkbox, Input, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterMenu, FilterSegmented, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Me } from '@/lib/types';
import { formatHour } from '@/shared/lockers';

/**
 * The guardhouse, as guards, staff and admins work it: the figures at the top, one register of every parcel held
 * there (left by a courier with the guard, or a smart locker parcel that could not go into the home's door), each
 * parcel's history, and one handover that takes either kind of code. Guards and the console share it, so both see
 * the same records.
 */

type Source = 'SHELF' | 'LOCKER';
type Status = 'WAITING' | 'RETURN_PENDING' | 'COLLECTED' | 'RETURNED';
type Show = 'ALL' | 'WAITING' | 'OVERDUE' | 'CALL_DUE' | 'RETURN_PENDING' | 'COLLECTED' | 'RETURNED';

interface Row {
  source: Source;
  id: string;
  trackingNo: string | null;
  courier: string;
  place: string;
  house: string;
  recipient: string | null;
  arrivedAt: string;
  leftAt: string | null;
  days: number;
  status: Status;
  overdue: boolean;
  callDue: boolean;
  reason: string | null;
  lastAction: { text: string; at: string } | null;
}
interface Register { items: Row[]; total: number; page: number; pageSize: number; couriers: string[] }
interface Overview {
  held: number; overdue: number; callsDue: number; arrivedToday: number; collected30d: number; returned30d: number;
  averageDaysHeld: number | null; bySource: { shelf: number; locker: number }; capacity: number; disputes30d: number;
  guardhouse: string | null; openFromHour: number | null; openToHour: number | null;
}
interface Detail extends Omit<Row, 'lastAction'> {
  history: { kind: string; text: string; at: string; actor: string | null; actorRole: string | null }[];
}

/** Every view of the guardhouse refreshes together after a change. */
export const refreshGuardhouse = () => mutate((key) => typeof key === 'string' && (key.startsWith('/admin/guardhouse') || key.startsWith('/admin/lockers/storage') || key.startsWith('/admin/lockers/overflow') || key === '/guard/parcels'));

const dayText = (n: number) => (n === 1 ? '1 day' : `${n} days`);
const STATUS: Record<Status, { label: string; tone: 'brand' | 'warning' | 'success' | 'neutral' | 'gold' }> = {
  WAITING: { label: 'Waiting', tone: 'gold' },
  RETURN_PENDING: { label: 'Going back to the courier', tone: 'warning' },
  COLLECTED: { label: 'Collected', tone: 'success' },
  RETURNED: { label: 'Returned to the courier', tone: 'neutral' },
};
const SOURCE: Record<Source, string> = { SHELF: 'Left at the guardhouse', LOCKER: 'From a smart locker' };
const ROLE: Record<string, string> = { GUARD: 'Guard', GUARDHOUSE: 'Guardhouse staff', TOWNSHIP_STAFF: 'Township staff', TOWNSHIP_ADMIN: 'Township admin', HQ_ADMIN: 'HQ admin', RESIDENT: 'Resident', COURIER: 'Courier' };

/** The figures above the register. */
export function GuardhouseOverview() {
  const data = useApi<Overview>('/admin/guardhouse/overview', { refreshInterval: 20_000 });
  return (
    <Async state={data} skeleton={<SkeletonStats count={6} />}>
      {(o) => {
        const tiles: { label: string; value: string; hint: string; icon: typeof Box; tone: 'ok' | 'warning' | 'danger' | 'neutral'; href?: string }[] = [
          { label: 'Held now', value: String(o.held), hint: o.capacity ? `${o.held} of ${o.capacity} places used · ${o.bySource.locker} from lockers` : 'No guardhouse set up', icon: Store, tone: o.capacity && o.held >= o.capacity ? 'danger' : o.capacity && o.held >= Math.ceil(o.capacity * 0.8) ? 'warning' : 'neutral' },
          { label: 'Overdue', value: String(o.overdue), hint: o.overdue ? 'Reminded once a week' : 'None overdue', icon: Clock, tone: o.overdue ? 'warning' : 'ok' },
          { label: 'Calls to make', value: String(o.callsDue), hint: o.callsDue ? 'Call, then add a note' : 'No calls due', icon: PhoneCall, tone: o.callsDue ? 'danger' : 'ok' },
          { label: 'Arrived today', value: String(o.arrivedToday), hint: 'Logged or received today', icon: Inbox, tone: 'neutral' },
          { label: 'Collected, 30 days', value: String(o.collected30d), hint: o.averageDaysHeld != null ? `After ${o.averageDaysHeld} days on average` : 'No collections yet', icon: PackageCheck, tone: 'ok' },
          { label: 'Disputed handovers, 30 days', value: String(o.disputes30d), hint: o.disputes30d ? 'Open the cases in Lapor' : 'None reported', icon: ShieldAlert, tone: o.disputes30d ? 'danger' : 'ok', href: o.disputes30d ? '/console/reports?tab=parcels&disputed=1' : undefined },
        ];
        return (
          <LocalizedDiv role="region" aria-label="Guardhouse at a glance" className="space-y-3">
            {o.guardhouse && o.openFromHour != null && o.openToHour != null && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-600"><Store className="size-4 text-ink-400" aria-hidden /><span className="font-semibold text-ink-800">{o.guardhouse}</span><span aria-hidden>·</span><Text>{`Open ${formatHour(o.openFromHour)} to ${formatHour(o.openToHour)}`}</Text></p>
            )}
            <div className="ops-kpis grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {tiles.map((t, i) => {
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
                      <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
                    </span>
                    <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">{t.value}</span>
                    <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs"><span className="line-clamp-2 min-w-0"><Text>{t.hint}</Text></span>{t.href && <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />}</span>
                  </>
                );
                const className = cn('ops-kpi glass-surface relative block overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`);
                return t.href
                  ? <a key={t.label} href={t.href} style={{ '--i': i } as CSSProperties} className={className}>{body}</a>
                  : <div key={t.label} style={{ '--i': i } as CSSProperties} className={className}>{body}</div>;
              })}
            </div>
          </LocalizedDiv>
        );
      }}
    </Async>
  );
}

/** The register: search, filters, sort, a page at a time, and each parcel's history. */
export function GuardhouseRegister({ compact = false }: { compact?: boolean }) {
  const me = useApi<Me>('/me');
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const [show, setShow] = useState<Show>('WAITING');
  const [source, setSource] = useState<'ALL' | Source>('ALL');
  const [courier, setCourier] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'LONGEST' | 'NEWEST'>('LONGEST');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ source: Source; id: string } | null>(null);
  const params = new URLSearchParams({ show, sort, page: String(page) });
  if (q) params.set('q', q);
  if (source !== 'ALL') params.set('source', source);
  if (courier !== 'ALL') params.set('courier', courier);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const list = useApi<Register>(`/admin/guardhouse/parcels?${params.toString()}`, { refreshInterval: 20_000, keepPreviousData: true });
  const overview = useApi<Overview>('/admin/guardhouse/overview');
  const filtered = Boolean(q || source !== 'ALL' || courier !== 'ALL' || from || to || show !== 'WAITING' || sort !== 'LONGEST');
  const reset = () => { setQuery(''); setShow('WAITING'); setSource('ALL'); setCourier('ALL'); setFrom(''); setTo(''); setSort('LONGEST'); setPage(1); };
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const o = overview.data;

  return (
    <section className="space-y-4" aria-labelledby="guardhouse-register">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="guardhouse-register" className="font-display text-xl font-bold text-ink-900"><Text>Guardhouse register</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Every parcel held at the guardhouse: when it arrived, how long it has waited, and what was done. Parcels stay until collected and are never sent back for waiting.</Text></p>
        </div>
      </div>
      <FilterBar
        search={<SearchField label="Search the register" placeholder="Tracking number, resident, house or courier" value={query} onChange={change(setQuery)} />}
        chips={<>
          <FilterChips<Show> label="Show" value={show} onChange={change(setShow)} options={[
            { key: 'WAITING', label: 'Waiting', count: o?.held },
            { key: 'OVERDUE', label: 'Overdue', count: o?.overdue, alert: true },
            { key: 'CALL_DUE', label: 'Call the household', count: o?.callsDue, alert: true },
            { key: 'RETURN_PENDING', label: 'Going back to the courier' },
            { key: 'COLLECTED', label: 'Collected' },
            { key: 'RETURNED', label: 'Returned' },
            { key: 'ALL', label: 'All records' },
          ]} />
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100/80 pt-3">
            <FilterMenu<'ALL' | Source> label="Arrived" value={source} onChange={change(setSource)} options={[
              { value: 'ALL', label: 'Any way' }, { value: 'LOCKER', label: 'From a smart locker' }, { value: 'SHELF', label: 'Left at the guardhouse' },
            ]} />
            <FilterMenu label="Courier" value={courier} onChange={change(setCourier)} options={[
              { value: 'ALL', label: 'Any courier' }, ...(list.data?.couriers ?? []).map((c) => ({ value: c, label: c, raw: true })),
            ]} />
            <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-600">
              <Text>From</Text>
              <input type="date" value={from} max={to || undefined} onChange={(e) => change(setFrom)(e.target.value)} className="h-9 rounded-full border border-ink-200 bg-white px-3 text-[13px] text-ink-800 focus-visible:outline-2 focus-visible:outline-brand-600" />
            </label>
            <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-600">
              <Text>To</Text>
              <input type="date" value={to} min={from || undefined} onChange={(e) => change(setTo)(e.target.value)} className="h-9 rounded-full border border-ink-200 bg-white px-3 text-[13px] text-ink-800 focus-visible:outline-2 focus-visible:outline-brand-600" />
            </label>
            <span className="ml-auto"><FilterSegmented<'LONGEST' | 'NEWEST'> label="Sort" value={sort} onChange={change(setSort)} options={[{ key: 'LONGEST', label: 'Longest waiting' }, { key: 'NEWEST', label: 'Newest first' }]} /></span>
          </div>
        </>}
        summary={list.data && <FilterSummary live shown={list.data.items.length ? Math.min(list.data.total, (list.data.page - 1) * list.data.pageSize + list.data.items.length) : 0} total={list.data.total} noun="parcels" onClear={filtered ? reset : undefined} />}
      />
      <Async state={list} skeleton={<SkeletonList rows={4} />}>
        {(r) => r.items.length === 0 ? (
          <Card className="p-5">
            <EmptyState icon={filtered ? Inbox : PackageCheck} title={filtered ? 'No parcels match' : 'No parcels waiting'}>
              <Text>{filtered ? 'Try another search or filter, or clear the filters.' : 'Every parcel at the guardhouse has been collected.'}</Text>
            </EmptyState>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div aria-hidden className={cn('hidden gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-6 pr-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500', compact ? '' : 'xl:grid xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.1fr)_8rem_7rem_minmax(0,1.2fr)_1.25rem]')}>
              <span><Text>Parcel</Text></span><span><Text>Household</Text></span><span><Text>Arrived</Text></span><span><Text>At the guardhouse</Text></span><span><Text>Last action</Text></span><span />
            </div>
            <ul className="ops-queue divide-y divide-ink-100/80">
              {r.items.map((row, i) => <RegisterRow key={`${row.source}:${row.id}`} row={row} index={i} compact={compact} onOpen={() => setOpen({ source: row.source, id: row.id })} />)}
            </ul>
            {r.total > r.pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-25/60 px-5 py-3 text-sm">
                <span className="text-ink-500"><Text>{`Page ${r.page} of ${Math.ceil(r.total / r.pageSize)}`}</Text></span>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={r.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="size-4" aria-hidden /><Text>Previous</Text></Button>
                  <Button size="sm" variant="secondary" disabled={r.page * r.pageSize >= r.total} onClick={() => setPage((p) => p + 1)}><Text>Next</Text><ChevronRight className="size-4" aria-hidden /></Button>
                </span>
              </div>
            )}
          </Card>
        )}
      </Async>
      <ParcelHistory target={open} role={me.data?.role} onClose={() => setOpen(null)} />
    </section>
  );
}

function RegisterRow({ row, index, compact, onOpen }: { row: Row; index: number; compact: boolean; onOpen: () => void }) {
  const waiting = row.status === 'WAITING' || row.status === 'RETURN_PENDING';
  const daysTone = row.callDue ? 'text-accent-700' : row.overdue && waiting ? 'text-warning-700' : 'text-ink-800';
  return (
    <li style={{ '--i': Math.min(index, 12) } as CSSProperties} className="ops-row relative">
      <span aria-hidden className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', row.callDue ? 'bg-accent-500' : row.overdue && waiting ? 'bg-warning-600' : 'bg-transparent')} />
      <button type="button" onClick={onOpen} className={cn(
        'grid w-full gap-2 py-3.5 pl-6 pr-5 text-left transition-colors duration-150 hover:bg-ink-25/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600',
        compact ? '' : 'xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.1fr)_8rem_7rem_minmax(0,1.2fr)_1.25rem] xl:items-center xl:gap-4',
      )}>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold text-ink-900">{row.trackingNo || <Text>No tracking number</Text>}</span>
            {row.callDue && <Badge tone="danger"><PhoneCall className="size-3" aria-hidden /><Text>Call due</Text></Badge>}
            {row.overdue && waiting && <Badge tone="warning"><Text>Overdue</Text></Badge>}
            {!waiting || row.status === 'RETURN_PENDING' ? <Badge tone={STATUS[row.status].tone}><Text>{STATUS[row.status].label}</Text></Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-500">{row.courier} · <Text>{SOURCE[row.source]}</Text>{row.source === 'SHELF' && <> · <Text>{`shelf ${row.place}`}</Text></>}</span>
        </span>
        <span className="min-w-0 text-sm">
          <span className="block truncate font-medium text-ink-800">{row.house}</span>
          {row.recipient && <span className="block truncate text-xs text-ink-500">{row.recipient}</span>}
        </span>
        <span className="text-xs text-ink-600 xl:text-sm"><Text>{formatDate(row.arrivedAt)}</Text></span>
        <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', daysTone)}><Clock className="size-3.5" aria-hidden /><Text>{row.days === 0 ? 'Under a day' : dayText(row.days)}</Text></span>
        <span className="min-w-0 text-xs text-ink-500">
          {row.lastAction ? <><span className="line-clamp-1 text-ink-700"><Text>{row.lastAction.text}</Text></span><span><Text>{timeAgo(row.lastAction.at)}</Text></span></> : '–'}
        </span>
        <ChevronRight className="hidden size-4 text-ink-400 xl:block" aria-hidden />
      </button>
    </li>
  );
}

const HISTORY_ICON: Record<string, typeof Box> = { LOGGED: Inbox, REMINDER: Clock, OVERDUE: AlertTriangle, CALL_REQUESTED: PhoneCall, NOTE: MessageSquareText, COLLECTED: CheckCircle2, RETURNED: Undo2, PROBLEM: ShieldAlert, EVENT: History };

/** One parcel's history, and what can be done next. */
function ParcelHistory({ target, role, onClose }: { target: { source: Source; id: string } | null; role?: string; onClose: () => void }) {
  const detail = useApi<Detail>(target ? `/admin/guardhouse/parcels/${target.source.toLowerCase()}/${target.id}` : null);
  const [note, setNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const done = () => { void detail.mutate(); void refreshGuardhouse(); };
  const shelf = target?.source === 'SHELF';
  const addNote = useAction(() => api.post(shelf ? `/guard/parcels/${target!.id}/notes` : `/admin/lockers/parcels/${target!.id}/notes`, { body: note.trim() }), {
    success: 'Note added to the parcel’s history.', onSuccess: () => { setNote(''); done(); },
  });
  const sendBack = useAction(() => api.post(shelf ? `/guard/parcels/${target!.id}/return` : `/admin/lockers/parcels/${target!.id}/return`, { reason: reason.trim() }), {
    success: 'Done. The household has been told.', onSuccess: () => { setReturning(false); setReason(''); done(); },
  });
  const keep = useAction(() => api.post(`/admin/lockers/parcels/${target!.id}/keep`), { success: 'Kept at the guardhouse.', onSuccess: done });
  const taken = useAction(() => api.post(`/admin/lockers/parcels/${target!.id}/returned`), { success: 'Recorded as returned to the courier.', onSuccess: done });
  const close = () => { setNote(''); setReason(''); setReturning(false); onClose(); };
  // HQ reads every township's register; guards and township staff act at their own guardhouse.
  const canAct = role !== undefined && role !== 'HQ_ADMIN';
  const d = detail.data;
  return (
    <Drawer open={target !== null} side="right" onClose={close} title={d ? (d.trackingNo || 'Parcel') : 'Parcel'} description={d ? `${d.courier} · ${d.house}` : undefined}>
      <Async state={detail} skeleton={<SkeletonList rows={4} />}>
        {(p) => {
          const waiting = p.status === 'WAITING';
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={STATUS[p.status].tone}><Text>{STATUS[p.status].label}</Text></Badge>
                {p.overdue && (waiting || p.status === 'RETURN_PENDING') && <Badge tone="warning"><Text>Overdue</Text></Badge>}
                {p.callDue && <Badge tone="danger"><Text>Call due</Text></Badge>}
                <Badge tone="neutral"><Text>{SOURCE[p.source]}</Text></Badge>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-ink-25 p-4 text-sm">
                <div><dt className="text-xs text-ink-500"><Text>Arrived</Text></dt><dd className="mt-0.5 font-medium text-ink-800"><Text>{formatDateTime(p.arrivedAt)}</Text></dd></div>
                <div><dt className="text-xs text-ink-500"><Text>{p.leftAt ? 'Waited' : 'At the guardhouse'}</Text></dt><dd className={cn('mt-0.5 font-semibold', p.overdue ? 'text-warning-700' : 'text-ink-800')}><Text>{p.days === 0 ? 'Under a day' : dayText(p.days)}</Text></dd></div>
                <div><dt className="text-xs text-ink-500"><Text>{p.source === 'SHELF' ? 'Shelf' : 'Guardhouse'}</Text></dt><dd className="mt-0.5 font-medium text-ink-800">{p.place}</dd></div>
                <div><dt className="text-xs text-ink-500"><Text>Household</Text></dt><dd className="mt-0.5 font-medium text-ink-800">{p.recipient ?? p.house}</dd></div>
                {p.reason && <div className="col-span-2"><dt className="text-xs text-ink-500"><Text>Why it is here</Text></dt><dd className="mt-0.5 font-medium text-ink-800"><Text>{p.reason}</Text></dd></div>}
                {p.leftAt && <div className="col-span-2"><dt className="text-xs text-ink-500"><Text>Left the guardhouse</Text></dt><dd className="mt-0.5 font-medium text-ink-800"><Text>{formatDateTime(p.leftAt)}</Text></dd></div>}
              </dl>
              {p.callDue && <p className="flex items-start gap-2 rounded-lg bg-accent-50 p-3 text-sm text-accent-700"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden /><Text>The guard has been asked to call this household. Add a note once you have called.</Text></p>}

              <section>
                <h3 className="mb-3 text-sm font-semibold text-ink-900"><Text>History</Text></h3>
                <ol className="relative space-y-3 border-l border-ink-200 pl-5">
                  {p.history.map((h, i) => {
                    const Icon = HISTORY_ICON[h.kind] ?? History;
                    return (
                      <li key={i} className="relative">
                        <span aria-hidden className="absolute left-[-1.85rem] top-0 grid size-6 place-items-center rounded-full border border-ink-200 bg-white text-ink-500"><Icon className="size-3.5" /></span>
                        <p className="text-sm text-ink-800"><Text>{h.text}</Text></p>
                        <p className="mt-0.5 text-xs text-ink-500"><Text>{formatDateTime(h.at)}</Text>{h.actor && <> · {h.actor}{h.actorRole && !h.actor.endsWith(`(${ROLE[h.actorRole] ?? h.actorRole})`) && <> (<Text>{ROLE[h.actorRole] ?? h.actorRole}</Text>)</>}</>}{!h.actor && h.kind !== 'NOTE' && <> · <Text>SimeTown</Text></>}</p>
                      </li>
                    );
                  })}
                </ol>
              </section>

              {canAct && (waiting || p.status === 'RETURN_PENDING') && (
                <section className="space-y-3 border-t border-ink-100 pt-4">
                  <form method="post" onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim()) void addNote.run(); }} className="space-y-2" noValidate>
                    <Textarea label={p.callDue ? 'Note after calling' : 'Add a note'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} error={addNote.fields.body} />
                    <Button type="submit" size="sm" pending={addNote.pending} disabled={!note.trim()}><MessageSquareText className="size-4" aria-hidden /><Text>Save note</Text></Button>
                  </form>
                  <p className="text-xs text-ink-500"><Text>To hand it over, ask the resident for the code and use “Hand over a parcel”.</Text></p>
                  <div className="flex flex-wrap gap-2">
                    {waiting && <Button size="sm" variant="ghost" onClick={() => setReturning(true)}><Undo2 className="size-4" aria-hidden /><Text>Send back to the courier</Text></Button>}
                    {p.status === 'RETURN_PENDING' && <>
                      <Button size="sm" variant="secondary" onClick={() => void keep.run()} pending={keep.pending}><Text>Keep it at the guardhouse</Text></Button>
                      <Button size="sm" variant="secondary" onClick={() => void taken.run()} pending={taken.pending}><Text>The courier has taken it back</Text></Button>
                    </>}
                  </div>
                </section>
              )}
            </div>
          );
        }}
      </Async>
      <ConfirmDialog open={returning} onClose={() => setReturning(false)} onConfirm={() => { if (reason.trim().length >= 3) void sendBack.run(); }} pending={sendBack.pending}
        title="Send this parcel back to the courier?" confirmLabel="Send back">
        <div className="space-y-3">
          <p className="text-[15px] text-ink-700"><Text>Only when the household or the courier asks. Parcels are never sent back just for waiting. The household is told.</Text></p>
          <Input label="Who asked, and why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. The household asked: wrong item ordered" error={sendBack.fields.reason} />
        </div>
      </ConfirmDialog>
    </Drawer>
  );
}

type Match =
  | { source: 'SHELF'; id: string; house: string; courier: string; trackingNo: string | null; shelf: string; hasPhoto: boolean; loggedAt: string; days: number }
  | { source: 'LOCKER'; locationId: string; parcelId: string; house: string; courier: string; trackingNo: string; recipient: string | null; days: number; overdue: boolean };

/**
 * Handing a parcel over at the guardhouse, whichever kind of code the resident shows: the collection code of a
 * parcel left with the guard, or the pickup code of a smart locker parcel kept there. The code must match, and
 * for a locker parcel the person's ID is checked; the code then stops working.
 */
/** Hand over a parcel. In a two-column layout it fills its column, so the result area sits beside the Log a parcel form. */
export function GuardhouseHandover({ fill = false }: { fill?: boolean }) {
  const [code, setCode] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [collectedBy, setCollectedBy] = useState('');
  const [idOk, setIdOk] = useState(false);
  const reset = () => { setMatches(null); setCollectedBy(''); setIdOk(false); };
  const check = useAction((text: string) => api.post<{ matches: Match[] }>('/admin/guardhouse/check', { code: text.trim() }), { onSuccess: (r) => { setMatches(r.matches); setIdOk(false); } });
  const handOver = useAction((m: Match) => (m.source === 'SHELF'
    ? api.post(`/guard/parcels/${m.id}/collect`, { code: code.trim(), collectedBy: collectedBy.trim() || undefined })
    : api.post(`/admin/lockers/overflow/${m.locationId}/handover`, { credential: code.trim(), idChecked: idOk })), {
    success: 'Handed over. The household has been told.',
    onSuccess: () => { reset(); setCode(''); void refreshGuardhouse(); },
  });
  return (
    <Card className={cn('ops-panel', fill && 'flex h-full flex-col')}>
      <CardHeader title="Hand over a parcel" description="Scan the resident’s QR code or type the code they show you. It works for parcels left at the guardhouse and for smart locker parcels kept here." />
      <div className={cn('space-y-4 p-5', fill && 'flex flex-1 flex-col')}>
        <CameraScan onCode={(text) => { setCode(text); reset(); void check.run(text); }} label="Scan the QR code" />
        <form method="post" className="flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); reset(); void check.run(code); }}>
          <Input label="Code" value={code} onChange={(e) => { setCode(e.target.value); reset(); }} maxLength={120} autoComplete="off" inputMode="text" className="min-w-0 flex-1 basis-40" />
          <Button type="submit" disabled={code.trim().length < 6} pending={check.pending}><ScanLine className="size-4" aria-hidden /><Text>Check code</Text></Button>
        </form>
        {matches && (
          <LocalizedDiv className="space-y-3" aria-live="polite">
            {matches.length > 1 && <p className="text-sm font-semibold text-warning-700"><Text>This code matches two parcels. Check which one the resident is collecting.</Text></p>}
            {matches.map((m) => (
              <div key={m.source === 'SHELF' ? m.id : m.parcelId} className="space-y-3 rounded-lg bg-success-50 p-4">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-success-700">
                  <CheckCircle2 className="size-5" aria-hidden /><Text>Code is right</Text>
                  <Badge tone="neutral"><Text>{m.source === 'SHELF' ? 'Left at the guardhouse' : 'From a smart locker'}</Text></Badge>
                  <span className="text-sm font-medium text-ink-600"><Text>{m.days === 1 ? 'Waited 1 day' : `Waited ${m.days} days`}</Text></span>
                  {m.source === 'LOCKER' && m.overdue && <Badge tone="warning"><Text>Overdue</Text></Badge>}
                </p>
                <p className="text-[15px] text-ink-800">
                  {m.trackingNo ?? ''}{m.trackingNo ? ' · ' : ''}{m.courier}<br />
                  <Text>Household</Text>: <strong>{m.source === 'LOCKER' ? (m.recipient ?? m.house) : m.house}</strong>
                  {m.source === 'SHELF' && <><br /><Text>{`Shelf ${m.shelf}`}</Text></>}
                </p>
                {m.source === 'SHELF' && m.hasPhoto && <LocalizedImg src={`/api/v1/parcels/${m.id}/photo`} alt="Photo of the parcel taken when it was logged" loading="lazy" className="max-h-40 rounded-md border border-ink-200 object-cover" />}
                {m.source === 'SHELF'
                  ? <Input label="Collected by (optional)" value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} maxLength={80} hint="If someone else collects for the household." />
                  : <Checkbox label="I have checked the person’s ID" checked={idOk} onChange={(e) => setIdOk(e.target.checked)} />}
                <Button variant="success" disabled={m.source === 'LOCKER' && !idOk} pending={handOver.pending} onClick={() => void handOver.run(m)}><PackageCheck className="size-4" aria-hidden /><Text>Hand over</Text></Button>
              </div>
            ))}
          </LocalizedDiv>
        )}
        {!matches && (
          // Where the parcel appears once a code is checked: the shelf, the household and how long it waited.
          <div className={cn('handover-waiting grid place-items-center rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-5 py-8 text-center', fill && 'flex-1')}>
            <div className="max-w-xs">
              <span className="handover-waiting-icon mx-auto grid size-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-100"><ScanLine className="size-6" aria-hidden /></span>
              <p className="mt-3 font-semibold text-ink-900"><Text>Waiting for a code</Text></p>
              <p className="mt-1 text-sm text-ink-600"><Text>The parcel, its shelf and how long it waited show here. Hand it over only when the code is right.</Text></p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
