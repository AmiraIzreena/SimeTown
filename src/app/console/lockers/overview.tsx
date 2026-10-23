'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { AlertTriangle, Archive, Clock, Home, LockKeyhole, MonitorPlay, PackageX, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/card';
import { BarChart } from '@/components/ui/charts';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { formatDateTime, formatDay } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { ADMINS } from '@/shared/domain';
import { LOCKER_SIZES } from '@/shared/lockers';

export interface StationSummary {
  id: string;
  name: string;
  code: string;
  location: string;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  adapter: 'SIMULATED' | 'HTTP_GATEWAY';
  last_seen_at: string | null;
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  faulty: number;
  disabled: number;
  /** Parcels in their home's door long enough to have had a reminder. Never moved, never overdue. */
  waiting_long: number;
  /** Doors that belong to a home. */
  assigned: number;
  failed_30d: number;
  avg_collect_hours: number | null;
  free_by_size: Record<string, number> | null;
  keypad_locked_at: string | null;
  keypad_help: number;
  wrong_codes_today: number;
  utilisationPct: number;
}
export interface Overview {
  stations: StationSummary[];
  overflow: { id: string; name: string; capacity: number; held: number; active: boolean; overdue: number; calls_due: number }[];
  trend: { day: string; arrivals: number; collections: number }[];
  alerts: { level: 'danger' | 'warning'; text: string }[];
}

/** Admin-only actions are hidden from township staff; the server refuses them anyway. */
export function useIsAdmin() {
  const me = useApi<Me>('/me');
  return me.data ? ADMINS.includes(me.data.role) : false;
}

const SEGMENTS = [
  { key: 'occupied', label: 'Occupied', className: 'bg-brand-600' },
  { key: 'reserved', label: 'Reserved', className: 'bg-gold-500' },
  { key: 'available', label: 'Available', className: 'bg-success-600' },
  { key: 'faulty', label: 'Faulty', className: 'bg-accent-600' },
  { key: 'disabled', label: 'Disabled', className: 'bg-ink-300' },
] as const;

interface GuardhouseFigures { held: number; overdue: number; callsDue: number; capacity: number; collected30d: number; averageDaysHeld: number | null; bySource: { shelf: number; locker: number }; guardhouse: string | null }

export function OverviewTab({ showAlerts = true }: { showAlerts?: boolean }) {
  const data = useApi<Overview>('/admin/lockers', { refreshInterval: 10_000 });
  // The guardhouse holds parcels left by couriers and locker parcels that could not go into a door: both count.
  const guardhouse = useApi<GuardhouseFigures>('/admin/guardhouse/overview', { refreshInterval: 20_000 });
  const unlock = useAction((id: string) => api.post(`/admin/lockers/stations/${id}/keypad-unlock`), { success: 'Keypad unlocked.', onSuccess: () => void data.mutate() });
  return (
    <Async state={data} skeleton={<SkeletonStats count={4} />}>
      {(o) => {
        const sum = (k: 'total' | 'available' | 'occupied' | 'waiting_long' | 'assigned' | 'failed_30d') => o.stations.reduce((a, s) => a + s[k], 0);
        const g = guardhouse.data;
        return (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Doors given to homes" value={sum('assigned')} icon={Home} hint={`${sum('total')} doors in all · ${sum('occupied')} holding a parcel`} />
              <Stat label="Waiting 2+ days in a door" value={sum('waiting_long')} icon={Clock} tone="neutral" hint="Reminded weekly; never moved" />
              <Stat label="At the guardhouse" value={g?.held ?? 0} icon={Store} tone={g?.overdue ? 'danger' : 'brand'} hint={g ? (g.overdue ? `${g.overdue} overdue · ${g.callsDue} to call` : 'None overdue') : '–'} />
              <Stat label="Failed delivery attempts, 30 days" value={sum('failed_30d')} icon={PackageX} tone="gold" hint="Not delivered, or door did not open" />
            </div>
            {showAlerts && o.alerts.length > 0 && (
              <Card className="space-y-2 p-5" role="status">
                {o.alerts.map((a, i) => (
                  <p key={i} className={cn('flex items-center gap-2 text-[15px] font-medium', a.level === 'danger' ? 'text-accent-700' : 'text-warning-700')}>
                    <AlertTriangle className="size-4 shrink-0" aria-hidden /><Text>{a.text}</Text>
                  </p>
                ))}
              </Card>
            )}
            {o.stations.length === 0 ? (
              <EmptyState icon={Archive} title="No locker stations yet"><Text>Add one under Stations.</Text></EmptyState>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {o.stations.map((s) => (
                  <Card key={s.id} className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-ink-900">
                          {s.name}
                          <Badge tone={s.status === 'ONLINE' ? 'success' : 'danger'}><Text>{s.status === 'ONLINE' ? 'Online' : s.status === 'OFFLINE' ? 'Offline' : 'Maintenance'}</Text></Badge>
                          {s.adapter === 'SIMULATED' && <Badge tone="neutral"><Text>Simulated</Text></Badge>}
                        </p>
                        <p className="text-sm text-ink-500">{s.location} · <Text>{`code ${s.code}`}</Text></p>
                      </div>
                      <p className="shrink-0 text-right"><span className="font-display text-3xl font-bold tabular-nums text-ink-900">{s.utilisationPct}%</span><span className="block text-xs text-ink-500"><Text>in use</Text></span></p>
                    </div>
                    <LocalizedDiv className="flex h-3 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`${s.occupied} occupied, ${s.reserved} reserved, ${s.available} available, ${s.faulty} faulty, ${s.disabled} disabled`}>
                      {SEGMENTS.map((seg) => s[seg.key] > 0 && <span key={seg.key} className={seg.className} style={{ width: `${(s[seg.key] / Math.max(1, s.total)) * 100}%` }} />)}
                    </LocalizedDiv>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700">
                      {SEGMENTS.map((seg) => (
                        <li key={seg.key} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn('size-2.5 rounded-sm', seg.className)} /><Text>{seg.label}</Text> <strong className="tabular-nums">{s[seg.key]}</strong></li>
                      ))}
                    </ul>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p className="text-ink-600"><Text>{`Doors given to homes: ${s.assigned} of ${s.total}`}</Text>{s.waiting_long > 0 && <> · <Text>{`${s.waiting_long} waiting 2+ days`}</Text></>}</p>
                      <p className="text-ink-600"><Text>{s.avg_collect_hours != null ? `Collected after ${s.avg_collect_hours} h on average` : 'No collections in 30 days'}</Text></p>
                      <p className="text-ink-600 sm:col-span-2"><Text>Free by size: </Text>{LOCKER_SIZES.map((z) => `${z} ${s.free_by_size?.[z] ?? 0}`).join(' · ')}</p>
                    </div>
                    {s.keypad_locked_at && (
                      <div className="space-y-2 rounded-lg bg-accent-50 p-4" role="alert">
                        <p className="flex items-center gap-2 font-semibold text-accent-700"><LockKeyhole className="size-4" aria-hidden /><Text>{`Keypad locked since ${formatDateTime(s.keypad_locked_at)}`}</Text></p>
                        <p className="text-sm text-ink-700"><Text>Too many wrong pickup codes were typed here in a day, which can mean someone is guessing PINs. Residents can still open their doors from the app. Check the station, then unlock it.</Text></p>
                        {s.keypad_help > 0 && <p className="text-sm font-semibold text-accent-700"><Text>{s.keypad_help === 1 ? 'A resident at the station has asked for it to be unlocked.' : `${s.keypad_help} residents at the station have asked for it to be unlocked.`}</Text></p>}
                        <Button size="sm" variant="secondary" onClick={() => void unlock.run(s.id)} pending={unlock.pending}><Text>Unlock keypad</Text></Button>
                      </div>
                    )}
                    {!s.keypad_locked_at && s.wrong_codes_today > 0 && <p className="text-sm text-ink-600"><Text>{`Wrong pickup codes in the last day: ${s.wrong_codes_today}`}</Text></p>}
                    {s.adapter === 'SIMULATED' && (
                      <Button size="sm" variant="secondary" href={`/console/lockers/simulator?station=${s.id}`}><MonitorPlay className="size-4" aria-hidden /><Text>Open the simulator</Text></Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card>
                <CardHeader title="Arrivals and collections, 14 days" description="Parcels ready to collect, and parcels collected, each day." />
                <div className="p-5">
                  <BarChart
                    label="Arrivals and collections by day"
                    data={o.trend.map((d) => ({ label: formatDay(d.day), values: [d.arrivals, d.collections] }))}
                    series={[{ name: 'Arrivals', className: 'bg-brand-600' }, { name: 'Collections', className: 'bg-success-600' }]}
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Guardhouse" description="Parcels left with the guard, and locker parcels that could not go into a home’s door." />
                {g ? (
                  <div className="space-y-4 p-5">
                    <div>
                      <p className="flex items-center justify-between gap-2 text-[15px] font-semibold text-ink-900">{g.guardhouse ?? <Text>Guardhouse</Text>}<span className="tabular-nums text-ink-600">{g.held} / {g.capacity}</span></p>
                      <div className="occupancy-bar mt-2"><span className={g.capacity && g.held >= g.capacity ? 'bg-accent-600' : 'bg-gold-500'} style={{ width: `${g.capacity ? Math.min(100, (g.held / g.capacity) * 100) : 0}%` }} /></div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-xs text-ink-500"><Text>Left by couriers</Text></dt><dd className="font-semibold tabular-nums text-ink-900">{g.bySource.shelf}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>From smart lockers</Text></dt><dd className="font-semibold tabular-nums text-ink-900">{g.bySource.locker}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Overdue</Text></dt><dd className={cn('font-semibold tabular-nums', g.overdue ? 'text-warning-700' : 'text-ink-900')}>{g.overdue}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Calls to make</Text></dt><dd className={cn('font-semibold tabular-nums', g.callsDue ? 'text-accent-700' : 'text-ink-900')}>{g.callsDue}</dd></div>
                      <div className="col-span-2"><dt className="text-xs text-ink-500"><Text>Collected, 30 days</Text></dt><dd className="font-semibold text-ink-900"><span className="tabular-nums">{g.collected30d}</span>{g.averageDaysHeld != null && <span className="font-normal text-ink-600"> · <Text>{`after ${g.averageDaysHeld} days on average`}</Text></span>}</dd></div>
                    </dl>
                  </div>
                ) : <div className="p-5"><EmptyState icon={Store} title="No guardhouse set up yet"><Text>Add one under Manage › Guardhouses.</Text></EmptyState></div>}
              </Card>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
