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
 * Where the water is heading, said plainly and labelled as an estimate: it never raises or clears an
 * alert. Only a climb towards a line is shown prominently; steady or falling water is a quiet line.
 */
export function FloodTrend({ trend, className }: { trend: FloodTrendView | null | undefined; className?: string }) {
  if (!trend) return null;
  const towardsLine = trend.direction === 'RISING' && trend.nextLine && trend.minutes !== null;
  const Icon = trend.direction === 'RISING' ? TrendingUp : trend.direction === 'FALLING' ? TrendingDown : Minus;
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        towardsLine ? (trend.nextLine === 'DANGER' ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700') : 'bg-ink-50 text-ink-600',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {towardsLine ? (
          <Text>{trend.nextLine === 'DANGER' ? `Estimate: at this rate the water could reach the danger line in ${minutesText(trend.minutes!)}.` : `Estimate: at this rate the water could reach the warning line in ${minutesText(trend.minutes!)}.`}</Text>
        ) : trend.direction === 'RISING' ? (
          <Text>{`Estimate: the water is rising, about ${Math.round(trend.ratePctPerHour)} points an hour.`}</Text>
        ) : trend.direction === 'FALLING' ? (
          <Text>Estimate: the water is going down.</Text>
        ) : (
          <Text>Estimate: the water level is steady.</Text>
        )}
        <span className="block text-xs opacity-80"><Text>From the last 30 minutes of sensor readings. An estimate, not an alert.</Text></span>
      </span>
    </p>
  );
}
