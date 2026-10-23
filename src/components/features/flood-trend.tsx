'use client';

import { Text } from '@/components/ui/localized-text';

import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/** The early-warning estimate from the recent trend (server/modules/banjir/trend.ts). Advisory only. */
export interface FloodTrendView {
  direction: 'RISING' | 'STEADY' | 'FALLING';
  ratePctPerHour: number;
  nextLine: 'WARNING' | 'DANGER' | null;
  minutes: number | null;
}

const minutesText = (m: number) => (m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${m % 60} min`);

/**
 * Where the water is heading, said plainly and labelled as an estimate: it never raises or clears an alert.
 * A dashed outline and an "Estimate" tag set it apart from official messages. Its colour says how much it
 * matters: green going down, calm grey steady, gold rising, and orange or red only when heading for a line.
 */
export function FloodTrend({ trend, className }: { trend: FloodTrendView | null | undefined; className?: string }) {
  if (!trend) return null;
  const towardsLine = trend.direction === 'RISING' && trend.nextLine && trend.minutes !== null;
  const Icon = trend.direction === 'RISING' ? TrendingUp : trend.direction === 'FALLING' ? TrendingDown : Minus;
  const tone = towardsLine
    ? trend.nextLine === 'DANGER' ? 'is-danger' : 'is-warning'
    : trend.direction === 'RISING' ? 'is-rising' : trend.direction === 'FALLING' ? 'is-falling' : 'is-steady';
  return (
    <div className={cn('flood-trend flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-sm', tone, className)}>
      <span className="flood-trend-icon grid size-7 shrink-0 place-items-center rounded-lg"><Icon className="size-4" aria-hidden /></span>
      <span className="min-w-0">
        <span className="flood-trend-tag mr-1.5 inline-block rounded px-1.5 py-px align-[1px] text-[10px] font-bold uppercase tracking-[0.1em]"><Text>Estimate</Text></span>
        <span className="font-medium">
          {towardsLine ? (
            <Text>{trend.nextLine === 'DANGER' ? `At this rate the water could reach the danger line in ${minutesText(trend.minutes!)}.` : `At this rate the water could reach the warning line in ${minutesText(trend.minutes!)}.`}</Text>
          ) : trend.direction === 'RISING' ? (
            <Text>{`The water is rising, about ${Math.round(trend.ratePctPerHour)} points an hour.`}</Text>
          ) : trend.direction === 'FALLING' ? (
            <Text>The water is going down.</Text>
          ) : (
            <Text>The water level is steady.</Text>
          )}
        </span>
        <span className="mt-0.5 block text-xs opacity-80"><Text>From the last 30 minutes of sensor readings. An estimate, not an alert.</Text></span>
      </span>
    </div>
  );
}
