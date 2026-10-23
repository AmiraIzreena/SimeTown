'use client';

import Link from 'next/link';
import { AlertTriangle, Archive, ArrowRight, CheckCircle2, Clock, Inbox, KeyRound, PhoneCall, Router, ShieldCheck, Store, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { Text } from '@/components/ui/localized-text';
import { Card, CardHeader } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { type Overview } from './overview';

interface RegisterRow { source: 'SHELF' | 'LOCKER'; id: string; trackingNo: string | null; courier: string; house: string; days: number; overdue: boolean; callDue: boolean }
interface Register { items: RegisterRow[]; total: number }
interface GuardhouseOverview { held: number; overdue: number; callsDue: number; capacity: number; guardhouse: string | null }
interface DropOff { id: string; tracking_no: string; company: string; counter: string; registered_at: string }
interface CaseRow { id: string; priority: string; owner_id: string | null; overdue: boolean; unassigned_late: boolean }

/** One thing someone needs to do now, worst first. */
interface Task { key: string; rank: number; tone: 'danger' | 'warning' | 'brand'; icon: LucideIcon; title: string; detail: string; action: string; onClick?: () => void; href?: string }

/**
 * The parcel desk's day: the figures that need attention, one list of what to do now (households to call, overdue
 * parcels at the guardhouse, parcels couriers are bringing, doors and keypads to check), the health of every locker
 * bank and the guardhouse, and how many parcel cases are open in Lapor.
 */
export function TodayTab({ onGuardhouse, onParcels, onStations, onPerformance, casesHref }: {
  onGuardhouse: () => void; onParcels: () => void; onStations: () => void; onPerformance: () => void; casesHref: string;
}) {
  const overview = useApi<Overview>('/admin/lockers', { refreshInterval: 15_000 });
  const guardhouse = useApi<GuardhouseOverview>('/admin/guardhouse/overview', { refreshInterval: 20_000 });
  const calls = useApi<Register>('/admin/guardhouse/parcels?show=CALL_DUE&sort=LONGEST', { refreshInterval: 20_000 });
  const overdue = useApi<Register>('/admin/guardhouse/parcels?show=OVERDUE&sort=LONGEST', { refreshInterval: 20_000 });
  const dropOffs = useApi<DropOff[]>('/admin/lockers/storage/deliveries', { refreshInterval: 15_000 });
  const cases = useApi<{ incidents: CaseRow[] }>('/admin/incidents?modules=PARCELS,LOCKERS,COURIERS&status=ACTIVE', { refreshInterval: 30_000 });
  const ready = overview.data && guardhouse.data && dropOffs.data && cases.data;

  const tasks: Task[] = [];
  for (const p of calls.data?.items ?? []) {
    tasks.push({ key: `call:${p.id}`, rank: 0, tone: 'danger', icon: PhoneCall, title: `Call the household · ${p.house}`, detail: `${p.trackingNo ?? p.courier} · waiting ${p.days} days`, action: 'Open', onClick: onGuardhouse });
  }
  for (const p of (overdue.data?.items ?? []).filter((x) => !x.callDue)) {
    tasks.push({ key: `overdue:${p.id}`, rank: 2, tone: 'warning', icon: Clock, title: `Overdue at the guardhouse · ${p.house}`, detail: `${p.trackingNo ?? p.courier} · waiting ${p.days} days`, action: 'Open', onClick: onGuardhouse });
  }
  for (const d of dropOffs.data ?? []) {
    tasks.push({ key: `drop:${d.id}`, rank: 1, tone: 'brand', icon: Truck, title: `Courier bringing a parcel · ${d.company}`, detail: `${d.tracking_no} · to ${d.counter} · ${timeAgo(d.registered_at)}`, action: 'Receive', onClick: onGuardhouse });
  }
  for (const s of overview.data?.stations ?? []) {
    if (s.status !== 'ONLINE') tasks.push({ key: `offline:${s.id}`, rank: 0, tone: 'danger', icon: Router, title: `${s.name} is ${s.status === 'MAINTENANCE' ? 'in maintenance' : 'offline'}`, detail: 'Couriers cannot use it until it is back online.', action: 'Check', onClick: onStations });
    if (s.keypad_locked_at) tasks.push({ key: `keypad:${s.id}`, rank: 1, tone: 'danger', icon: KeyRound, title: `${s.name}: keypad locked`, detail: s.keypad_help ? `${s.keypad_help} resident(s) asked for it to be unlocked` : 'Too many wrong codes. Residents can still open their doors from the app.', action: 'Check', onClick: onPerformance });
    if (s.faulty > 0) tasks.push({ key: `faulty:${s.id}`, rank: 3, tone: 'warning', icon: Wrench, title: `${s.name}: ${s.faulty === 1 ? '1 door needs checking' : `${s.faulty} doors need checking`}`, detail: 'Reported damaged, jammed or with something inside.', action: 'Check', onClick: onStations });
  }
  tasks.sort((a, b) => a.rank - b.rank);
  const shown = tasks.slice(0, 10);

  return (
    <div className="ops-today space-y-6">
      {ready ? <Kpis overview={overview.data!} guardhouse={guardhouse.data!} dropOffs={dropOffs.data!.length} cases={cases.data!.incidents} onGuardhouse={onGuardhouse} onParcels={onParcels} onStations={onStations} casesHref={casesHref} /> : <SkeletonStats count={6} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)] xl:items-start">
        <Card className="ops-panel min-w-0 overflow-hidden">
          <CardHeader
            title="Needs action now"
            description="Households to call first, then parcels on their way, overdue parcels and doors to check."
            action={<span className="ops-live inline-flex items-center gap-2 text-xs font-semibold text-ink-500"><span aria-hidden className="live-dot" /><Text>Live</Text></span>}
          />
          {!ready || !calls.data || !overdue.data ? <SkeletonList rows={4} className="p-5" /> : shown.length ? (
            <>
              <ul className="ops-queue divide-y divide-ink-100/80">
                {shown.map((t, i) => (
                  <li key={t.key} style={{ '--i': i } as CSSProperties} className="ops-row relative">
                    <span aria-hidden className={cn('absolute inset-y-2 left-0 w-1 rounded-r-full', t.tone === 'danger' ? 'bg-accent-500' : t.tone === 'warning' ? 'bg-warning-600' : 'bg-brand-400')} />
                    <div className="flex items-center gap-3 py-3.5 pl-6 pr-5 sm:pr-6">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', t.tone === 'danger' ? 'bg-accent-50 text-accent-700' : t.tone === 'warning' ? 'bg-warning-50 text-warning-700' : 'bg-brand-50 text-brand-700')}><t.icon className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink-900"><Text>{t.title}</Text></span>
                        <span className="block truncate text-xs text-ink-500"><Text>{t.detail}</Text></span>
                      </span>
                      <button type="button" onClick={t.onClick} className="ops-link shrink-0 text-sm font-semibold text-brand-700"><Text>{t.action}</Text><ArrowRight className="size-3.5" aria-hidden /></button>
                    </div>
                  </li>
                ))}
              </ul>
              {tasks.length > shown.length && <p className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm text-ink-500 sm:px-6"><Text>{`${tasks.length - shown.length} more in the guardhouse register and station details`}</Text></p>}
            </>
          ) : (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="ops-ok grid size-12 place-items-center rounded-full bg-success-50 text-success-700"><ShieldCheck className="size-6" aria-hidden /></span>
              <p className="mt-3 font-semibold text-ink-900"><Text>Nothing needs action</Text></p>
              <p className="mt-1 text-sm text-ink-500"><Text>No calls due, nothing overdue, and every locker is working.</Text></p>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card className="ops-panel overflow-hidden">
            <CardHeader title="Locker network" description="Every locker bank and the guardhouse, as of now." />
            <Async state={overview} skeleton={<SkeletonList rows={3} className="p-5" />}>
              {(data) => data.stations.length === 0 ? (
                <div className="p-5"><EmptyState icon={Archive} title="No locker stations yet"><Text>Add one under Manage › Stations.</Text></EmptyState></div>
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
                          <span className={cn('text-xs font-semibold tabular-nums', full ? 'text-accent-700' : 'text-ink-500')}><Text>{`${s.occupied} of ${s.total} in use`}</Text></span>
                        </div>
                        <div className="ml-5 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <span className={cn('ops-bar block h-full rounded-full', full ? 'bg-accent-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, s.utilisationPct)}%` }} />
                        </div>
                        {(offline || s.keypad_locked_at || s.faulty > 0 || s.waiting_long > 0) && (
                          <p className="ml-5 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                            {offline && <span className="text-accent-700"><Text>{s.status === 'MAINTENANCE' ? 'Maintenance' : 'Offline'}</Text></span>}
                            {s.keypad_locked_at && <span className="text-accent-700"><Text>Keypad locked</Text></span>}
                            {s.faulty > 0 && <span className="text-warning-700"><Text>{`${s.faulty} to check`}</Text></span>}
                            {s.waiting_long > 0 && <span className="text-ink-600"><Text>{`${s.waiting_long} waiting 2+ days`}</Text></span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {guardhouse.data && guardhouse.data.capacity > 0 && (() => {
                    const g = guardhouse.data;
                    const pct = Math.round((g.held / g.capacity) * 100);
                    return (
                      <li style={{ '--i': data.stations.length } as CSSProperties} className="ops-row px-5 py-3.5 sm:px-6">
                        <div className="flex items-center gap-3">
                          <Store className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{g.guardhouse ?? <Text>Guardhouse</Text>}</span>
                          <span className={cn('text-xs font-semibold tabular-nums', pct >= 100 ? 'text-accent-700' : 'text-ink-500')}>{g.held}/{g.capacity}</span>
                        </div>
                        <div className="ml-6 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <span className={cn('ops-bar block h-full rounded-full', pct >= 100 ? 'bg-accent-500' : 'bg-gold-500')} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </li>
                    );
                  })()}
                </ul>
                <div className="border-t border-ink-100/80 bg-ink-25/60 px-5 py-3 text-sm sm:px-6">
                  <button type="button" onClick={onPerformance} className="ops-link font-semibold text-brand-700"><Text>Performance & station details</Text><ArrowRight className="size-3.5" aria-hidden /></button>
                </div>
              </>}
            </Async>
          </Card>

          <Card className="ops-panel overflow-hidden">
            <CardHeader title="Parcel cases" description="Reports about parcels, lockers and couriers are worked in Lapor, with every other report." />
            <Async state={cases} skeleton={<SkeletonList rows={1} className="p-5" />}>
              {(c) => {
                const open = c.incidents.length;
                const critical = c.incidents.filter((x) => x.priority === 'CRITICAL').length;
                const late = c.incidents.filter((x) => x.overdue || x.unassigned_late).length;
                const untaken = c.incidents.filter((x) => !x.owner_id).length;
                return (
                  <div className="space-y-3 p-5 sm:px-6">
                    {open === 0
                      ? <p className="flex items-center gap-2 text-sm text-ink-600"><CheckCircle2 className="size-4 text-success-600" aria-hidden /><Text>No open parcel cases.</Text></p>
                      : <dl className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-ink-25 p-2"><dt className="text-xs text-ink-500"><Text>Open</Text></dt><dd className="font-display text-xl font-bold tabular-nums text-ink-900">{open}</dd></div>
                        <div className="rounded-lg bg-ink-25 p-2"><dt className="text-xs text-ink-500"><Text>Critical</Text></dt><dd className={cn('font-display text-xl font-bold tabular-nums', critical ? 'text-accent-700' : 'text-ink-900')}>{critical}</dd></div>
                        <div className="rounded-lg bg-ink-25 p-2"><dt className="text-xs text-ink-500"><Text>Late</Text></dt><dd className={cn('font-display text-xl font-bold tabular-nums', late ? 'text-warning-700' : 'text-ink-900')}>{late}</dd></div>
                      </dl>}
                    {untaken > 0 && <p className="text-xs font-semibold text-warning-700"><Text>{untaken === 1 ? '1 case not taken yet' : `${untaken} cases not taken yet`}</Text></p>}
                    <Link href={casesHref} className="ops-link inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><Text>Open parcel cases in Lapor</Text><ArrowRight className="size-3.5" aria-hidden /></Link>
                  </div>
                );
              }}
            </Async>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpis({ overview, guardhouse, dropOffs, cases, onGuardhouse, onParcels, onStations, casesHref }: {
  overview: Overview; guardhouse: GuardhouseOverview; dropOffs: number; cases: CaseRow[];
  onGuardhouse: () => void; onParcels: () => void; onStations: () => void; casesHref: string;
}) {
  const inDoors = overview.stations.reduce((sum, s) => sum + s.occupied, 0);
  const toCheck = overview.stations.reduce((sum, s) => sum + s.faulty + (s.keypad_locked_at ? 1 : 0) + (s.status !== 'ONLINE' ? 1 : 0), 0);
  const tiles: { label: string; value: number; hint: string; icon: LucideIcon; tone: 'danger' | 'warning' | 'ok' | 'neutral'; onClick?: () => void; href?: string }[] = [
    { label: 'At the guardhouse', value: guardhouse.held, hint: guardhouse.overdue ? `${guardhouse.overdue} overdue` : 'None overdue', icon: Store, tone: guardhouse.overdue ? 'warning' : 'neutral', onClick: onGuardhouse },
    { label: 'Calls to make', value: guardhouse.callsDue, hint: guardhouse.callsDue ? 'Households waiting 14+ days' : 'No calls due', icon: PhoneCall, tone: guardhouse.callsDue ? 'danger' : 'ok', onClick: onGuardhouse },
    { label: 'Couriers bringing parcels', value: dropOffs, hint: dropOffs ? 'Receive them at the guardhouse' : 'None on the way', icon: Truck, tone: dropOffs ? 'warning' : 'ok', onClick: onGuardhouse },
    { label: 'In locker doors', value: inDoors, hint: 'Reminded after 2 days, then weekly', icon: Archive, tone: 'neutral', onClick: onParcels },
    { label: 'Doors and stations to check', value: toCheck, hint: toCheck ? 'Faulty doors, locked keypads, offline stations' : 'All working', icon: AlertTriangle, tone: toCheck ? 'danger' : 'ok', onClick: onStations },
    { label: 'Open parcel cases', value: cases.length, hint: 'Worked in Lapor', icon: Inbox, tone: cases.some((c) => c.priority === 'CRITICAL') ? 'danger' : cases.length ? 'warning' : 'ok', href: casesHref },
  ];
  return (
    <div className="ops-kpis grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((t, i) => {
        const body = (
          <>
            <span className="flex items-start justify-between gap-3">
              <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
              <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
            </span>
            <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums"><CountUp value={t.value} delay={i * 60} /></span>
            <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="line-clamp-2 min-w-0"><Text>{t.hint}</Text></span>
              <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />
            </span>
          </>
        );
        const className = cn('ops-kpi glass-surface group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`);
        return t.href
          ? <Link key={t.label} href={t.href} style={{ '--i': i } as CSSProperties} className={className}>{body}</Link>
          : <button key={t.label} type="button" onClick={t.onClick} style={{ '--i': i } as CSSProperties} className={className}>{body}</button>;
      })}
    </div>
  );
}
