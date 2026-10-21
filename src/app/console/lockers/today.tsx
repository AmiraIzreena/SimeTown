'use client';

import Link from 'next/link';
import { ArrowRight, Archive, CheckCircle2, Clock, Inbox, PackageX, Router, ShieldCheck, Truck, UserRound, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Text } from '@/components/ui/localized-text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Async, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { FilterChips } from '@/components/ui/filter-bar';
import { dueText } from '@/components/features/incident-board';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { CATEGORY_LABELS, MODULE_LABELS, PRIORITY_LABELS, type IncidentModule, type IncidentStatus, type Priority } from '@/shared/incidents';
import { type Overview } from './overview';
import { type Task } from './relocations';

interface CaseRow {
  id: string; reference: string; summary: string; kind: string; priority: Priority; status: IncidentStatus; created_at: string;
  owner: string | null; owner_id: string | null; overdue: boolean; unassigned_late: boolean;
  assign_due_at: string | null; resolve_due_at: string | null; module: IncidentModule;
}
type Queue = 'ALL' | 'CRITICAL' | 'LATE' | 'UNASSIGNED' | 'MINE';

const QUEUE_SHOWN = 8;
const LOCKER_CASES = '/console/operations?tab=lockers&view=cases';
const GUARDHOUSE_CASES = '/console/operations?tab=guardhouse&view=cases';
const caseLink = (c: CaseRow) => `${c.module === 'PARCELS' ? GUARDHOUSE_CASES : LOCKER_CASES}&ref=${c.reference}`;
const late = (c: CaseRow) => c.overdue || c.unassigned_late;

/** Worst first: critical, then late, then high priority, then nobody has it; oldest breaks ties. */
function severity(c: CaseRow) {
  return (c.priority === 'CRITICAL' ? 8 : 0) + (late(c) ? 4 : 0) + (c.priority === 'HIGH' ? 2 : 0) + (!c.owner_id ? 1 : 0);
}
const RAIL: Record<'critical' | 'late' | 'high' | 'normal', string> = {
  critical: 'bg-accent-600', late: 'bg-accent-500', high: 'bg-warning-600', normal: 'bg-ink-200',
};
const rail = (c: CaseRow) => (c.priority === 'CRITICAL' ? RAIL.critical : late(c) ? RAIL.late : c.priority === 'HIGH' ? RAIL.high : RAIL.normal);

/**
 * The parcel desk's command centre: headline numbers, one queue of cases worst
 * first, and the health of every station and storage location beside it.
 */
export function TodayTab({ onMove, onParcels, onStations, onPerformance, allCases = false }: {
  onMove: (id: string) => void; onParcels: () => void; onStations: () => void; onPerformance: () => void; allCases?: boolean;
}) {
  const cases = useApi<{ incidents: CaseRow[]; me: string }>(allCases ? '/admin/incidents?modules=PARCELS,LOCKERS,COURIERS&status=ACTIVE' : '/admin/incidents?modules=LOCKERS,COURIERS&status=ACTIVE', { refreshInterval: 15_000 });
  const moves = useApi<Task[]>('/admin/lockers/relocations', { refreshInterval: 5_000 });
  const overview = useApi<Overview>('/admin/lockers', { refreshInterval: 10_000 });
  const [queue, setQueue] = useState<Queue>('ALL');

  const activeMoves = (moves.data ?? []).filter((task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS');
  const ready = cases.data && moves.data && overview.data;

  return (
    <div className="ops-today space-y-6">
      {ready ? (
        <Kpis
          cases={cases.data!.incidents}
          moves={activeMoves.length}
          overview={overview.data!}
          onQueue={(q) => { setQueue(q); document.getElementById('ops-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          onMoves={() => document.getElementById('ops-moves')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onParcels={onParcels}
          onPerformance={onPerformance}
        />
      ) : <SkeletonStats count={5} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.9fr)] xl:items-start">
        <Card id="ops-queue" className="ops-panel min-w-0 scroll-mt-24 overflow-hidden">
          <CardHeader
            title="Case queue"
            description="Open parcel cases, worst first. Take a case or open it to work on it."
            action={<span className="ops-live inline-flex items-center gap-2 text-xs font-semibold text-ink-500"><span aria-hidden className="live-dot" /><Text>Live</Text></span>}
          />
          <Async state={cases} skeleton={<SkeletonList rows={4} className="p-5" />}>
            {(data) => {
              const all = [...data.incidents].sort((a, b) => severity(b) - severity(a) || a.created_at.localeCompare(b.created_at));
              const count = {
                ALL: all.length,
                CRITICAL: all.filter((c) => c.priority === 'CRITICAL').length,
                LATE: all.filter(late).length,
                UNASSIGNED: all.filter((c) => !c.owner_id).length,
                MINE: all.filter((c) => c.owner_id === data.me).length,
              };
              const shown = all.filter((c) => queue === 'ALL' || (queue === 'CRITICAL' && c.priority === 'CRITICAL') || (queue === 'LATE' && late(c)) || (queue === 'UNASSIGNED' && !c.owner_id) || (queue === 'MINE' && c.owner_id === data.me));
              return <>
                <div className="border-b border-ink-100/80 px-5 py-3 sm:px-6">
                  <FilterChips<Queue> label="Filter the queue" size="sm" value={queue} onChange={setQueue} options={[
                    { key: 'ALL', label: 'All open', count: count.ALL },
                    { key: 'CRITICAL', label: 'Critical', count: count.CRITICAL, alert: true },
                    { key: 'LATE', label: 'Past deadline', count: count.LATE, alert: true },
                    { key: 'UNASSIGNED', label: 'Unassigned', count: count.UNASSIGNED },
                    { key: 'MINE', label: 'Mine', count: count.MINE },
                  ]} />
                </div>
                <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_10.5rem_9rem_6.5rem] gap-4 border-b border-ink-100/80 bg-ink-25/70 py-2 pl-7 pr-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                  <span><Text>Case</Text></span><span><Text>Time limit</Text></span><span><Text>Handled by</Text></span><span />
                </div>
                {shown.length ? (
                  <ul key={queue} className="ops-queue divide-y divide-ink-100/80">
                    {shown.slice(0, QUEUE_SHOWN).map((c, i) => <QueueRow key={c.id} c={c} index={i} />)}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center px-6 py-12 text-center">
                    <span className="ops-ok grid size-12 place-items-center rounded-full bg-success-50 text-success-700"><ShieldCheck className="size-6" aria-hidden /></span>
                    <p className="mt-3 font-semibold text-ink-900"><Text>{queue === 'ALL' ? 'No open cases' : 'Nothing in this queue'}</Text></p>
                    <p className="mt-1 text-sm text-ink-500"><Text>New cases appear here as soon as they are reported.</Text></p>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6">
                  <span className="text-ink-500">{shown.length > QUEUE_SHOWN ? <><Text>Showing</Text> {QUEUE_SHOWN} <Text>of</Text> {shown.length}</> : <><span className="tabular-nums">{shown.length}</span> <Text>cases</Text></>}</span>
                  <span className="flex flex-wrap gap-x-5 gap-y-1">
                    {allCases && <Link href={GUARDHOUSE_CASES} className="ops-link font-semibold text-brand-700"><Text>Guardhouse cases</Text><ArrowRight className="size-3.5" aria-hidden /></Link>}
                    <Link href={LOCKER_CASES} className="ops-link font-semibold text-brand-700"><Text>Smart locker cases</Text><ArrowRight className="size-3.5" aria-hidden /></Link>
                  </span>
                </div>
              </>;
            }}
          </Async>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card id="ops-moves" className="ops-panel scroll-mt-24 overflow-hidden">
            <CardHeader title="Transfers to storage" description="Overdue parcels to move from a locker to the parcel counter." />
            <Async state={moves} skeleton={<SkeletonList rows={2} className="p-5" />}>
              {() => activeMoves.length ? (
                <ul className="ops-queue divide-y divide-ink-100/80">
                  {activeMoves.map((task, i) => (
                    <li key={task.id} style={{ '--i': i } as CSSProperties} className="ops-row flex items-center gap-3 px-5 py-3.5 sm:px-6">
                      <span aria-hidden className={cn('status-dot shrink-0', task.status === 'IN_PROGRESS' ? 'is-warning is-pulsing' : 'is-danger')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] font-semibold text-ink-900">{task.tracking_no}</span>
                        <span className="block truncate text-xs text-ink-500">{task.station}{task.compartment && <> · <Text>{`door ${task.compartment}`}</Text></>}{task.assigned && <> · {task.assigned}</>}</span>
                      </span>
                      <Button size="sm" variant={task.status === 'IN_PROGRESS' ? 'secondary' : 'primary'} onClick={() => onMove(task.id)}><Text>{task.status === 'IN_PROGRESS' ? 'Continue' : 'Start'}</Text></Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2.5 px-5 py-5 text-sm text-ink-600 sm:px-6"><CheckCircle2 className="size-4 text-success-600" aria-hidden /><Text>No parcels need moving.</Text></p>
              )}
            </Async>
          </Card>

          <Card className="ops-panel overflow-hidden">
            <CardHeader title="Locker network" description="Every station and storage location, as of now." />
            <Async state={overview} skeleton={<SkeletonList rows={3} className="p-5" />}>
              {(data) => data.stations.length === 0 ? (
                <div className="p-5 sm:px-6">
                  <p className="text-sm text-ink-500"><Text>No locker stations yet</Text></p>
                  <Button className="mt-3" size="sm" variant="secondary" onClick={onStations}><Text>Add a station</Text></Button>
                </div>
              ) : <>
                <ul className="ops-queue divide-y divide-ink-100/80">
                  {data.stations.map((s, i) => {
                    const offline = s.status !== 'ONLINE';
                    const full = s.utilisationPct >= 85;
                    return (
                      <li key={s.id} style={{ '--i': i } as CSSProperties} className="ops-row px-5 py-3.5 sm:px-6">
                        <div className="flex items-center gap-3">
                          <span aria-hidden className={cn('status-dot shrink-0', offline ? (s.status === 'MAINTENANCE' ? 'is-warning' : 'is-danger is-pulsing') : 'is-ok')} />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{s.name}</span>
                          <span className={cn('text-xs font-semibold tabular-nums', full ? 'text-accent-700' : 'text-ink-500')}>{s.utilisationPct}%</span>
                        </div>
                        <div className="ml-5 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <span className={cn('ops-bar block h-full rounded-full', full ? 'bg-accent-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, s.utilisationPct)}%` }} />
                        </div>
                        {(offline || s.keypad_locked_at || s.faulty > 0 || s.overdue > 0) && (
                          <p className="ml-5 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                            {offline && <span className="text-accent-700"><Text>{s.status === 'MAINTENANCE' ? 'Maintenance' : 'Offline'}</Text></span>}
                            {s.keypad_locked_at && <span className="text-accent-700"><Text>Keypad locked</Text></span>}
                            {s.faulty > 0 && <span className="text-warning-700">{s.faulty} <Text>faulty</Text></span>}
                            {s.overdue > 0 && <span className="text-warning-700">{s.overdue} <Text>overdue</Text></span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {data.overflow.filter((o) => o.active).map((o, i) => {
                    const pct = o.capacity ? Math.round((o.held / o.capacity) * 100) : 0;
                    return (
                      <li key={o.id} style={{ '--i': data.stations.length + i } as CSSProperties} className="ops-row px-5 py-3.5 sm:px-6">
                        <div className="flex items-center gap-3">
                          <Archive className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{o.name}</span>
                          <span className={cn('text-xs font-semibold tabular-nums', pct >= 100 ? 'text-accent-700' : 'text-ink-500')}>{o.held}/{o.capacity}</span>
                        </div>
                        <div className="ml-6 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <span className={cn('ops-bar block h-full rounded-full', pct >= 100 ? 'bg-accent-500' : 'bg-gold-500')} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6">
                  <button type="button" onClick={onPerformance} className="ops-link font-semibold text-brand-700"><Text>Performance & station details</Text><ArrowRight className="size-3.5" aria-hidden /></button>
                </div>
              </>}
            </Async>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ c, index }: { c: CaseRow; index: number }) {
  const due = dueText(c);
  return (
    <li style={{ '--i': index } as CSSProperties} className="ops-row group relative">
      <span aria-hidden className={cn('ops-rail absolute inset-y-2 left-0 w-1 rounded-r-full', rail(c))} />
      <div className="grid gap-3 py-4 pl-7 pr-5 sm:pr-6 lg:grid-cols-[minmax(0,1fr)_10.5rem_9rem_6.5rem] lg:items-center lg:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-mono font-semibold text-ink-500">{c.reference}</span>
            <span className="text-ink-300">·</span>
            <span className="font-medium text-ink-500"><Text>{MODULE_LABELS[c.module]}</Text></span>
            {(c.priority === 'CRITICAL' || c.priority === 'HIGH') && (
              <span className={cn('rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-wide', c.priority === 'CRITICAL' ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700')}><Text>{PRIORITY_LABELS[c.priority]}</Text></span>
            )}
          </div>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink-900"><Text>{CATEGORY_LABELS[c.kind] ?? c.kind}</Text></p>
          <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-ink-600"><Text>{c.summary}</Text></p>
        </div>
        <div className="flex items-center gap-2 text-xs lg:block">
          {due ? <span className={cn('inline-flex items-center gap-1.5 font-semibold', due.late ? 'text-accent-700' : 'text-ink-600')}><Clock className="size-3.5" aria-hidden /><Text>{due.text}</Text></span> : <span className="text-ink-500">–</span>}
          <span className="text-ink-500 lg:mt-0.5 lg:block"><Text>{`opened ${timeAgo(c.created_at)}`}</Text></span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <UserRound className="size-3.5 shrink-0 text-ink-400" aria-hidden />
          {c.owner ? <span className="truncate text-ink-700">{c.owner}</span> : <span className="font-semibold text-warning-700"><Text>Unassigned</Text></span>}
        </div>
        <div className="lg:text-right">
          <Button size="sm" variant={c.owner ? 'ghost' : 'secondary'} href={caseLink(c)} className="ops-action w-full lg:w-auto"><Text>{c.owner ? 'Open' : 'Take'}</Text></Button>
        </div>
      </div>
    </li>
  );
}

function Kpis({ cases, moves, overview, onQueue, onMoves, onParcels, onPerformance }: {
  cases: CaseRow[]; moves: number; overview: Overview;
  onQueue: (q: Queue) => void; onMoves: () => void; onParcels: () => void; onPerformance: () => void;
}) {
  const unassigned = cases.filter((c) => !c.owner_id).length;
  const lateCount = cases.filter(late).length;
  const critical = cases.filter((c) => c.priority === 'CRITICAL').length;
  const overdueParcels = overview.stations.reduce((sum, s) => sum + s.overdue, 0);
  const online = overview.stations.filter((s) => s.status === 'ONLINE').length;
  const troubled = overview.stations.filter((s) => s.status !== 'ONLINE' || s.keypad_locked_at || s.faulty > 0).length;
  const tiles: { label: string; value: number; suffix?: string; hint: string; icon: LucideIcon; tone: 'danger' | 'warning' | 'ok' | 'neutral'; onClick: () => void }[] = [
    { label: 'Open cases', value: cases.length, hint: unassigned ? `${unassigned} not taken yet` : 'All taken', icon: Inbox, tone: unassigned ? 'warning' : 'neutral', onClick: () => onQueue(unassigned ? 'UNASSIGNED' : 'ALL') },
    { label: 'Past deadline', value: lateCount, hint: critical ? `${critical} critical` : 'None critical', icon: Clock, tone: lateCount ? 'danger' : 'ok', onClick: () => onQueue('LATE') },
    { label: 'Transfers waiting', value: moves, hint: moves ? 'Locker to parcel counter' : 'Nothing to move', icon: Truck, tone: moves ? 'warning' : 'ok', onClick: onMoves },
    { label: 'Overdue in lockers', value: overdueParcels, hint: 'Reminders run automatically', icon: PackageX, tone: overdueParcels ? 'warning' : 'ok', onClick: onParcels },
    { label: 'Stations online', value: online, suffix: `/${overview.stations.length}`, hint: troubled ? `${troubled} need attention` : 'All healthy', icon: Router, tone: troubled ? 'danger' : 'ok', onClick: onPerformance },
  ];
  return (
    <div className="ops-kpis grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <button key={t.label} type="button" onClick={t.onClick} style={{ '--i': i } as CSSProperties} className={cn('ops-kpi glass-surface group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`)}>
          <span className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
            <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
          </span>
          <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
            <CountUp value={t.value} delay={i * 60} />{t.suffix && <span className="text-lg font-semibold text-ink-500">{t.suffix}</span>}
          </span>
          <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="line-clamp-2 min-w-0"><Text>{t.hint}</Text></span>
            <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}
