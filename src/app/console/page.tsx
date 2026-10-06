'use client';

import { Bike, CheckCircle2, ClipboardList, Home, Recycle, ShieldCheck, Store, Zap } from 'lucide-react';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { BarChart, RankBars } from '@/components/ui/charts';
import { Async, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { formatDay, formatKg, formatKm } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { REPORT_CATEGORY_LABELS, formatPoints, formatRM, type ReportCategory } from '@/shared/domain';

interface Insights {
  people: { homes: number; residents: number; waiting: number; active_homes: number };
  planet: { recycled_g: number; drop_offs: number; moved_m: number; readings: number; saver_homes: number };
  reports: { open: number; urgent_new: number; received: number; resolved: number; median_hours: number | null };
  community: { events: number; attendances: number; favours: number; items_shared: number };
  shops: { active_shops: number; sales: number; bill_sen: number; points_given: number; points_accepted: number; fees_sen: number };
  points: { from_shops: number; from_campaigns: number };
  byActivity: { label: string; actions: number }[];
  byCategory: { category: ReportCategory; open: number }[];
  byZone: { zone: string; open: number }[];
  daily: { day: string; actions: number; sales: number }[];
  float: { trustSen: number; walletsSen: number; payablesSen: number; poolsSen: number; communitySen: number };
}

export default function InsightsPage() {
  const insights = useApi<Insights>('/insights', { refreshInterval: 20_000 });
  return (
    <>
      <PageHeader title="Insights" description="What the township achieved in the last 30 days. Totals for groups only, never one person." />
      <Async
        state={insights}
        skeleton={
          <div className="space-y-6">
            <SkeletonStats count={8} />
            <SkeletonList rows={2} />
          </div>
        }
      >
        {(d) => {
          const owed = d.float.walletsSen + d.float.payablesSen + d.float.poolsSen + d.float.communitySen;
          const matched = d.float.trustSen === owed;
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Active homes" value={d.people.active_homes} icon={Home} hint={`of ${d.people.homes} homes · ${d.people.residents} verified residents`} />
                <Stat label="Recycled" value={d.planet.recycled_g} format={formatKg} icon={Recycle} tone="success" hint={`${d.planet.drop_offs} kiosk drop-offs`} />
                <Stat label="Walked and cycled" value={d.planet.moved_m} format={formatKm} icon={Bike} hint="Completed township loops" />
                <Stat label="Open reports" value={d.reports.open} icon={ClipboardList} tone={d.reports.urgent_new ? 'danger' : 'warning'} hint={d.reports.urgent_new ? `${d.reports.urgent_new} urgent and unread` : `${d.reports.resolved} resolved · median ${d.reports.median_hours ?? '–'} h`} />
                <Stat label="Shop sales through KITA+" value={d.shops.bill_sen} format={formatRM} icon={Store} hint={`${d.shops.sales} sales at ${d.shops.active_shops} shops`} />
                <Stat label="Points given" value={d.points.from_shops + d.points.from_campaigns} icon={CheckCircle2} tone="gold" hint={`${formatPoints(d.points.from_shops)} by shops · ${formatPoints(d.points.from_campaigns)} by campaigns`} />
                <Stat label="Points spent locally" value={d.shops.points_accepted} format={formatRM} icon={Store} tone="success" hint="Accepted by township shops" />
                <Stat label="Homes that used less" value={d.planet.saver_homes} icon={Zap} hint={`${d.planet.readings} sets of meter readings`} />
              </div>

              <Card className={matched ? 'border-success-600/30' : 'border-accent-200'}>
                <CardHeader
                  title="Reward float"
                  description="The locked pot that pays shops. It must equal everything it owes, to the sen."
                  action={
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${matched ? 'bg-success-50 text-success-700' : 'bg-accent-50 text-accent-700'}`}>
                      <ShieldCheck className="size-4" aria-hidden />
                      {matched ? 'Matched to the sen' : 'Does not match'}
                    </span>
                  }
                />
                <dl className="grid gap-px bg-ink-100 sm:grid-cols-5">
                  {[
                    ['Float holds', d.float.trustSen, 'font-bold text-ink-900'],
                    ['Points residents hold', d.float.walletsSen, 'text-ink-800'],
                    ['Owed to shops this week', d.float.payablesSen, 'text-ink-800'],
                    ['Prefunded, not yet given', d.float.poolsSen, 'text-ink-800'],
                    ['Community pool', d.float.communitySen, 'text-ink-800'],
                  ].map(([label, value, tone], i) => (
                    <div key={label as string} className="bg-white px-5 py-4">
                      <dt className="text-xs font-medium text-ink-500">
                        {i === 1 ? '= ' : i > 1 ? '+ ' : ''}
                        {label}
                      </dt>
                      <dd className={`mt-1 font-display text-xl tabular-nums ${tone}`}>{formatRM(value as number)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Last 14 days" description="Verified actions and shop sales per day." />
                  <div className="p-5">
                    <BarChart label="Verified actions and shop sales per day" series={[{ name: 'Verified actions', className: 'bg-brand-600' }, { name: 'Shop sales', className: 'bg-gold-500' }]} data={d.daily.map((row) => ({ label: formatDay(row.day), values: [row.actions, row.sales] }))} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Actions by feature" description="Verified actions that earned Impact XP." />
                  <div className="p-5">
                    <RankBars rows={d.byActivity.map((a) => ({ label: a.label, value: a.actions }))} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Where open reports cluster" description="By area and by type." />
                  <div className="grid gap-6 p-5 sm:grid-cols-2">
                    <RankBars tone="bg-accent-500" rows={d.byZone.map((z) => ({ label: z.zone, value: z.open }))} />
                    {d.byCategory.length ? <RankBars tone="bg-warning-600" rows={d.byCategory.map((c) => ({ label: REPORT_CATEGORY_LABELS[c.category], value: c.open }))} /> : <p className="text-sm text-ink-500">No open reports.</p>}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Community" description="Neighbours meeting, helping and sharing." />
                  <dl className="grid grid-cols-2 gap-px bg-ink-100">
                    {[
                      ['Events posted', d.community.events],
                      ['Event attendances', d.community.attendances],
                      ['Favours done', d.community.favours],
                      ['Items given or lent', d.community.items_shared],
                    ].map(([label, value]) => (
                      <div key={label as string} className="bg-white px-5 py-4">
                        <dt className="text-xs font-medium text-ink-500">{label}</dt>
                        <dd className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </div>
            </div>
          );
        }}
      </Async>
    </>
  );
}
