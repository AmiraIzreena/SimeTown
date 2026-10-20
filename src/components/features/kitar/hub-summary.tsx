'use client';

import { Text } from '@/components/ui/localized-text';

import { Coins, Recycle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Card, Progress, Stat } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Async, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { formatKg } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { formatPoints, formatRM, MATERIAL_INFO, MATERIALS } from '@/shared/domain';
import { MATERIAL_STYLE } from './materials';
import type { KitarOverview, Loaded, WalletSummary } from './types';

/** The next round number to aim for: 100 points (the least a resident can spend), then every 500. */
const nextGoal = (points: number) => (points < 100 ? 100 : (Math.floor(points / 500) + 1) * 500);

/** What points are worth, in whole ringgit where they make whole ringgit (100 points = RM1): RM10, not RM10.00. */
const pointsWorth = (points: number) => `RM${(points / 100).toLocaleString('en-MY', { maximumFractionDigits: 2 })}`;

const RING = { size: 120, radius: 46, stroke: 14, active: 19, gap: 2.5 };

/**
 * Kg by material this month, as an interactive ring. Slices follow the fixed material order and
 * colours (checked as a set for colour-blind safety) and sweep in one after another. Hovering or
 * focusing a slice or its legend row lifts that slice, dims the rest and shows its kg and share in
 * the centre; the centre otherwise shows the month's total. The legend names every slice with its
 * kg, so nothing depends on colour alone. Reduced motion keeps the highlight but drops the sweep.
 */
function MaterialRing({ grams }: { grams: Partial<Record<string, number>> }) {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const slices = MATERIALS.map((m) => ({ material: m, grams: grams[m] ?? 0 })).filter((s) => s.grams > 0);
  const total = slices.reduce((sum, s) => sum + s.grams, 0);
  const { size, radius, stroke, gap } = RING;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  // Where each slice starts along the ring, worked out before drawing.
  const lengths = slices.map((s) => (s.grams / total) * circumference);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, l) => sum + l, 0));
  const shown = slices.find((s) => s.material === active);
  if (slices.length === 0) return <p className="mt-4 text-sm text-ink-500"><Text>Nothing recycled yet this month</Text></p>;
  return (
    <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
      <div className="relative size-32 shrink-0" onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90 overflow-visible" aria-hidden>
          <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} className="stroke-ink-100" />
          {slices.map((s, i) => {
            const length = lengths[i]!;
            // One slice fills the ring; several are parted by a small gap, never shrinking a slice to nothing.
            const visible = slices.length > 1 ? Math.max(length - gap, 0.75) : length;
            const on = active === s.material;
            return (
              <circle
                key={s.material}
                cx={centre}
                cy={centre}
                r={radius}
                fill="none"
                stroke={MATERIAL_STYLE[s.material].chart}
                strokeWidth={on ? RING.active : stroke}
                strokeDasharray={`${visible} ${circumference - visible}`}
                strokeDashoffset={-starts[i]!}
                className={cn('material-slice cursor-pointer', active && !on && 'is-dim')}
                style={{ ['--len' as string]: visible, ['--i' as string]: i }}
                onPointerEnter={() => setActive(s.material)}
              />
            );
          })}
        </svg>
        {/* The centre: the month's total, or the slice being looked at. */}
        <div aria-live="polite" className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <span key={active ?? 'total'} className="material-ring-centre">
            <span className="block font-display text-lg font-bold leading-tight tabular-nums text-ink-900"><Text>{formatKg(shown?.grams ?? total)}</Text></span>
            <span className="block max-w-20 truncate text-[11px] text-ink-500">
              <Text>{shown ? `${Math.round((shown.grams / total) * 100)}% · ${t(MATERIAL_INFO[shown.material].label)}` : t('this month')}</Text>
            </span>
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-0.5" aria-label={t('Recycled this month, by material')}>
        {slices.map((s) => {
          const on = active === s.material;
          return (
            <li key={s.material}>
              <button
                type="button"
                onPointerEnter={() => setActive(s.material)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(s.material)}
                onBlur={() => setActive(null)}
                aria-pressed={on}
                className={cn(
                  'material-legend flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-[background-color,opacity] duration-200 focus-visible:outline-2 focus-visible:outline-brand-600',
                  on && 'bg-ink-50',
                  active && !on && 'opacity-50',
                )}
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-full transition-transform duration-200" style={{ backgroundColor: MATERIAL_STYLE[s.material].chart, transform: on ? 'scale(1.35)' : undefined }} />
                <span className="min-w-0 flex-1 truncate text-ink-700"><Text>{MATERIAL_INFO[s.material].label}</Text></span>
                <span className="shrink-0 font-semibold tabular-nums text-ink-900"><Text>{formatKg(s.grams)}</Text></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Recycled this month": the standard KPI tile look (tone bar, icon tile), with the ring beside its legend. */
function RecycledThisMonth({ overview: o }: { overview: KitarOverview }) {
  return (
    <div className="kpi-tile is-success glass-surface relative h-full overflow-hidden rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500"><Text>Recycled this month</Text></p>
        <span className="kpi-tile-icon grid size-8 shrink-0 place-items-center rounded-lg">
          <Recycle className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums"><CountUp value={o.monthGrams} format={formatKg} /></p>
      <p className="kpi-tile-hint mt-2 text-xs"><Text>{o.street ? `${o.street}, this month` : 'Your street, this month'}</Text>: <Text>{formatKg(o.streetMonthGrams)}</Text></p>
      {o.monthGramsByMaterial && <MaterialRing grams={o.monthGramsByMaterial} />}
    </div>
  );
}

/** Progress to the next points goal; sits under the points and XP tiles so the row has no gap. */
function NextGoal({ points }: { points: number }) {
  const t = useT();
  const goal = nextGoal(points);
  const start = goal === 100 ? 0 : goal - 500;
  return (
    <Card className="flex h-full flex-col justify-center p-5">
      <p className="text-[15px] font-semibold text-ink-900"><Text>{t('Next goal: {points} points (worth {rm} in shop offers)', { points: formatPoints(goal), rm: pointsWorth(goal) })}</Text></p>
      <div className="mt-3">
        <Progress value={points - start} max={goal - start} tone="gold" label={t('Progress to your next points goal')} />
      </div>
      <p className="mt-2 text-sm text-ink-600"><Text>{t('{n} more points to go.', { n: formatPoints(goal - points) })}</Text></p>
    </Card>
  );
}

/**
 * The top of the Kitar hub, as in the prototype: what points and XP are, the resident's balance and
 * level (from the wallet), the next points goal, and what they recycled this month. On a wide screen
 * points and XP sit side by side with the goal under them, and the recycled card spans both rows,
 * so the grid has no empty space.
 */
export function HubSummary({ overview, wallet }: { overview: Loaded<KitarOverview>; wallet: Loaded<WalletSummary> }) {
  return (
    <div className="space-y-4">
      <Card className="border-brand-200 bg-brand-50 p-5 text-[15px] text-brand-900">
        <p className="font-semibold"><Text>Points are savings. XP is progress.</Text></p>
        <p className="mt-1 text-brand-800"><Text>Points take money off your bill at township shops (100 points = RM1). They cannot be turned into cash. XP has no money value: it shows the good you have done.</Text></p>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        {/* One Async per cell: Async wraps its content in a div, and each needs its own grid cell. */}
        <Async state={wallet} skeleton={<Skeleton className="h-26 rounded-xl" />}>
          {(w) => <Stat label="Your points" value={w.totalPoints} format={formatPoints} hint={`= ${formatRM(w.totalPoints)}`} icon={Coins} tone="gold" />}
        </Async>
        <Async state={wallet} skeleton={<Skeleton className="h-26 rounded-xl" />}>
          {(w) => <Stat label="Your XP" value={w.xp} format={formatPoints} hint={<><Text>Level </Text><Text>{w.level.level}</Text> · <Text>{w.level.name}</Text></>} icon={Sparkles} />}
        </Async>
        <div className="col-span-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 [&>div]:h-full">
          <Async state={overview} skeleton={<Skeleton className="h-full min-h-26 rounded-xl" />}>
            {(o) => <RecycledThisMonth overview={o} />}
          </Async>
        </div>
        <div className="col-span-2 [&>div]:h-full">
          <Async state={wallet} skeleton={<Skeleton className="h-24 rounded-xl" />}>
            {(w) => <NextGoal points={w.totalPoints} />}
          </Async>
        </div>
      </div>
    </div>
  );
}
