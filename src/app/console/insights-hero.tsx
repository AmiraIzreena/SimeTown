'use client';

import { Text } from '@/components/ui/localized-text';

import { Home, Recycle, Store, Sparkles, type LucideIcon } from 'lucide-react';
import { CountUp } from '@/components/ui/count-up';
import { LineChart } from '@/components/ui/line-chart';
import { formatKg } from '@/lib/format';
import { useLang, useT } from '@/lib/i18n';
import { formatPoints, formatRM } from '@/shared/domain';

interface HeroData {
  people: { homes: number; residents: number; active_homes: number };
  planet: { recycled_g: number; drop_offs: number };
  shops: { bill_sen: number; sales: number; active_shops: number };
  points: { from_shops: number; from_campaigns: number };
  daily: { day: string; actions: number }[];
}

/**
 * The Insights hero: one hero figure (active homes, with a meter against all homes), three
 * headline figures, and the last 14 days of verified actions as a sparkline with a hover readout.
 * Every number is the same live data the rest of the page shows; nothing is estimated.
 */
export function InsightsHero({ d }: { d: HeroData }) {
  const t = useT();
  const share = d.people.homes > 0 ? Math.round((d.people.active_homes / d.people.homes) * 100) : 0;
  const total14 = d.daily.reduce((sum, row) => sum + row.actions, 0);
  return (
    <section aria-label={t('Township impact, last 30 days')} className="insights-hero relative overflow-hidden rounded-2xl p-6 text-white shadow-lg sm:p-8">
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200"><Home className="size-3.5" aria-hidden /><Text>Active homes · last 30 days</Text></p>
          <p className="mt-3 font-display text-[56px] font-bold leading-none tracking-tight tabular-nums">
            <CountUp value={d.people.active_homes} duration={1400} />
          </p>
          <p className="mt-2 text-sm text-brand-100/85"><Text>{`of ${d.people.homes} homes · ${d.people.residents} verified residents`}</Text></p>
          {/* Meter: the share of homes active, on a lighter track of the same colour. */}
          <div className="mt-5 max-w-sm">
            <div className="flex items-baseline justify-between text-xs text-brand-100/80"><Text>Homes taking part</Text><span className="font-semibold tabular-nums text-white">{share}%</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label={t('Homes taking part')}>
              <div className="hero-meter h-full rounded-full bg-brand-300" style={{ width: `${share}%` }} />
            </div>
          </div>
        </div>
        <div className="grid gap-6">
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
            <HeroFigure icon={Recycle} label="Recycled" value={d.planet.recycled_g} format={formatKg} hint={`${d.planet.drop_offs} drop-offs`} />
            <HeroFigure icon={Store} label="Shop sales through SimeTown" value={d.shops.bill_sen} format={formatRM} hint={`${d.shops.sales} sales at ${d.shops.active_shops} shops`} />
            <HeroFigure icon={Sparkles} label="Points given" value={d.points.from_shops + d.points.from_campaigns} hint={`${formatPoints(d.points.from_shops)} by shops · ${formatPoints(d.points.from_campaigns)} by campaigns`} />
          </dl>
          <Sparkline rows={d.daily} total={total14} />
        </div>
      </div>
    </section>
  );
}

function HeroFigure({ icon: Icon, label, value, format, hint }: { icon: LucideIcon; label: string; value: number; format?: (n: number) => string; hint: string }) {
  return (
    <div className="hero-figure bg-brand-950/35 px-4 py-4">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-brand-100/80"><Icon className="size-3.5 shrink-0" aria-hidden /><Text>{label}</Text></dt>
      <dd className="mt-1.5 font-display text-[26px] font-bold leading-none tracking-tight tabular-nums text-white"><CountUp value={value} format={format}  /></dd>
      <dd className="mt-1.5 line-clamp-2 text-[11px] text-brand-100/70"><Text>{hint}</Text></dd>
    </div>
  );
}

/** 14 days of verified actions as an interactive line chart: hover or arrow keys to read any day. */
function Sparkline({ rows, total }: { rows: { day: string; actions: number }[]; total: number }) {
  const t = useT();
  const lang = useLang();
  if (rows.length < 2) return null;
  const labels = rows.map((r) => new Date(`${r.day}T00:00:00Z`).toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-brand-100/80">
        <span><Text>Verified actions, last 14 days</Text></span>
        <span className="font-semibold tabular-nums text-white"><Text>{`${total} in total`}</Text></span>
      </div>
      <LineChart
        className="mt-2"
        tone="dark"
        height={150}
        tickCount={5}
        data={rows.map((r) => r.actions)}
        labels={labels}
        name={t('Verified actions')}
        color="#FFB06A"
        label={t(`Verified actions per day, last 14 days: ${rows.map((r) => r.actions).join(', ')}`)}
      />
    </div>
  );
}
