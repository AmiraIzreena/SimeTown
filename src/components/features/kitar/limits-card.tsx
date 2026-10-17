'use client';

import { Text } from '@/components/ui/localized-text';

import { PauseCircle } from 'lucide-react';
import { Card, Progress } from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import { formatPoints } from '@/shared/domain';
import type { KitarLimits, PointsStatus } from './types';

/** Why a bin trip earns XP but no points per kg right now. The server sends only the reason, never the shops' amounts. */
const PAUSED: Record<Exclude<PointsStatus, 'ON'>, { title: string; body: string }> = {
  PROGRAMME_PAUSED: {
    title: 'Points are paused for everyone',
    body: 'The township is checking the points account. Recycling still earns XP, and points will start again once the check is done.',
  },
  NO_PROMISES: {
    title: 'Points per kg are paused this month',
    body: 'Township shops have no more points to give this month. Recycling still earns XP, and points start again when shops add new offers.',
  },
  HOME_LIMIT: {
    title: 'Your home has its points for this month',
    body: 'Your home has earned the most points per kg allowed this month. Recycling still earns XP until next month.',
  },
};

/** The banner shows only for a status this page knows; anything else (or no status from an older server) shows nothing. */
export function PointsPausedBanner({ status }: { status?: PointsStatus }) {
  const paused = status && status !== 'ON' ? PAUSED[status] : undefined;
  if (!paused) return null;
  return (
    <Card role="status" className="flex gap-3 border-warning-600/30 bg-warning-50 p-4 text-[15px] text-warning-700">
      <PauseCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold"><Text>{paused.title}</Text></p>
        <p className="mt-0.5"><Text>{paused.body}</Text></p>
      </div>
    </Card>
  );
}

function Row({ label, used, max, unit }: { label: string; used: number; max: number; unit: 'trips' | 'points' }) {
  const t = useT();
  const full = max > 0 && used >= max;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-ink-800"><Text>{label}</Text></span>
        <span className="tabular-nums text-ink-600">
          <Text>{unit === 'trips' ? t('{used} of {max} trips', { used, max }) : t('{used} of {max} points', { used: formatPoints(used), max: formatPoints(max) })}</Text>
        </span>
      </div>
      <Progress value={used} max={max} tone={full ? 'warning' : 'brand'} label={label} />
    </div>
  );
}

/**
 * Trips and the home's points this month, counted the way the server counts them (BR6).
 * Shown in the About tab's "Limits and rules" tile. An older server sends no limits: then only the rule shows.
 */
export function LimitsContent({ limits }: { limits?: KitarLimits }) {
  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-semibold text-ink-900"><Text>Your limits</Text></h3>
      <p className="text-sm leading-relaxed text-ink-500"><Text>Only trips within these limits earn XP and points. The points limit is shared by everyone in your home.</Text></p>
      {limits && (
        <div className="space-y-4">
          <Row label="Your trips today" used={limits.tripsToday} max={limits.tripsPerDay} unit="trips" />
          <Row label="Trips from your home this month" used={limits.homeTripsMonth} max={limits.homeTripsPerMonth} unit="trips" />
          <Row label="Points per kg for your home this month" used={limits.homePointsMonth} max={limits.homePointsMax} unit="points" />
        </div>
      )}
    </div>
  );
}
