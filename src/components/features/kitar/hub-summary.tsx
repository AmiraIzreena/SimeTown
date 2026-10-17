'use client';

import { Text } from '@/components/ui/localized-text';

import { Coins, Recycle, Sparkles } from 'lucide-react';
import { Card, Progress, Stat } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Async, Skeleton } from '@/components/ui/feedback';
import { formatKg } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { formatPoints, formatRM, MATERIAL_INFO, MATERIALS } from '@/shared/domain';
import { MATERIAL_STYLE } from './materials';
import type { KitarOverview, Loaded, WalletSummary } from './types';

/** The next round number to aim for: 100 points (the least a resident can spend), then every 500. */
const nextGoal = (points: number) => (points < 100 ? 100 : (Math.floor(points / 500) + 1) * 500);

/** What points are worth, in whole ringgit where they make whole ringgit (100 points = RM1): RM10, not RM10.00. */
const pointsWorth = (points: number) => `RM${(points / 100).toLocaleString('en-MY', { maximumFractionDigits: 2 })}`;

const RING = { size: 120, radius: 46, stroke: 16, gap: 2.5 };

/**
 * Kg by material this month, as a ring. Slices follow the fixed material order and
 * colours, with a small gap between them; a material with 0 kg has no slice. The
 * legend under it names every slice with its kg, so nothing depends on colour alone.
 */
function MaterialRing({ grams }: { grams: Partial<Record<string, number>> }) {
  const t = useT();
  const slices = MATERIALS.map((m) => ({ material: m, grams: grams[m] ?? 0 })).filter((s) => s.grams > 0);
  const total = slices.reduce((sum, s) => sum + s.grams, 0);
  const { size, radius, stroke, gap } = RING;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  // Where each slice starts along the ring, worked out before drawing.
  const lengths = slices.map((s) => (s.grams / total) * circumference);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, l) => sum + l, 0));
  return (
    <div className="mt-4 flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="size-28 -rotate-90" aria-hidden>
        <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} className="stroke-ink-100" />
        {slices.map((s, i) => {
          const length = lengths[i]!;
          // One slice fills the ring; several are parted by a small gap, never shrinking a slice to nothing.
          const visible = slices.length > 1 ? Math.max(length - gap, 0.75) : length;
          return (
            <circle key={s.material} cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} stroke={MATERIAL_STYLE[s.material].chart} strokeDasharray={`${visible} ${circumference - visible}`} strokeDashoffset={-starts[i]!}>
              <title>{`${t(MATERIAL_INFO[s.material].label)}: ${formatKg(s.grams)}`}</title>
            </circle>
          );
        })}
      </svg>
      {slices.length === 0 ? (
        <p className="text-sm text-ink-500"><Text>Nothing recycled yet this month</Text></p>
      ) : (
        <ul className="w-full space-y-1.5" aria-label={t('Recycled this month, by material')}>
          {slices.map((s) => (
            <li key={s.material} className="flex items-center gap-2 text-sm">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: MATERIAL_STYLE[s.material].chart }} />
              <span className="min-w-0 flex-1 truncate text-ink-700"><Text>{MATERIAL_INFO[s.material].label}</Text></span>
              <span className="shrink-0 font-semibold tabular-nums text-ink-900"><Text>{formatKg(s.grams)}</Text></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Recycled this month": the same layout as the other stats, with the ring of kg by material under it. */
function RecycledThisMonth({ overview: o }: { overview: KitarOverview }) {
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500"><Text>Recycled this month</Text></p>
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
          <Recycle className="size-[18px]" aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums"><CountUp value={o.monthGrams} format={formatKg} /></p>
      <p className="mt-2 text-sm text-ink-500"><Text>{o.street ? `${o.street}, this month` : 'Your street, this month'}</Text>: <Text>{formatKg(o.streetMonthGrams)}</Text></p>
      {o.monthGramsByMaterial && <MaterialRing grams={o.monthGramsByMaterial} />}
    </Card>
  );
}

/**
 * The top of the Kitar hub, as in the prototype: what points and XP are, the
 * resident's balance and level (from the wallet), and what they recycled this month.
 */
export function HubSummary({ overview, wallet }: { overview: Loaded<KitarOverview>; wallet: Loaded<WalletSummary> }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <Card className="border-brand-200 bg-brand-50 p-5 text-[15px] text-brand-900">
        <p className="font-semibold"><Text>Points are savings. XP is progress.</Text></p>
        <p className="mt-1 text-brand-800"><Text>Points take money off your bill at township shops (100 points = RM1). They cannot be turned into cash. XP has no money value: it shows the good you have done.</Text></p>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {/* One Async per stat: Async wraps its content in a div, and each stat needs its own grid cell. */}
        <Async state={wallet} skeleton={<Skeleton className="h-[104px] rounded-lg" />}>
          {(w) => <Stat label="Your points" value={w.totalPoints} format={formatPoints} hint={`= ${formatRM(w.totalPoints)}`} icon={Coins} tone="gold" />}
        </Async>
        <Async state={wallet} skeleton={<Skeleton className="h-[104px] rounded-lg" />}>
          {(w) => <Stat label="Your XP" value={w.xp} format={formatPoints} hint={<><Text>Level </Text><Text>{w.level.level}</Text> · <Text>{w.level.name}</Text></>} icon={Sparkles} />}
        </Async>
        <div className="col-span-2 lg:col-span-1">
          <Async state={overview} skeleton={<Skeleton className="h-[104px] rounded-lg" />}>
            {(o) => <RecycledThisMonth overview={o} />}
          </Async>
        </div>
      </div>

      {wallet.data && (() => {
        const points = wallet.data.totalPoints;
        const goal = nextGoal(points);
        const start = goal === 100 ? 0 : goal - 500;
        return (
          <Card className="p-5">
            <p className="text-[15px] font-semibold text-ink-900"><Text>{t('Next goal: {points} points (worth {rm} in shop offers)', { points: formatPoints(goal), rm: pointsWorth(goal) })}</Text></p>
            <div className="mt-3">
              <Progress value={points - start} max={goal - start} tone="gold" label={t('Progress to your next points goal')} />
            </div>
            <p className="mt-2 text-sm text-ink-600"><Text>{t('{n} more points to go.', { n: formatPoints(goal - points) })}</Text></p>
          </Card>
        );
      })()}
    </div>
  );
}
