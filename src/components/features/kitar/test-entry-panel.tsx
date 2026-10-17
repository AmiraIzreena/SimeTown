'use client';

import { Text } from '@/components/ui/localized-text';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { rewardMessage } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { ActionRewardView } from '@/lib/types';
import { formatPoints, formatRM, type Material } from '@/shared/domain';
import type { KitarLimits, KitarRate, PointsStatus, WalletSummary } from './types';

const MAX_GRAMS = 20_000;
/** The exact weight typed, so the sum in the preview adds up (formatKg rounds to one decimal). */
const kgText = (grams: number) => `${(grams / 1000).toLocaleString('en-MY', { maximumFractionDigits: 3 })} kg`;

/** Why points are off right now, from the same status GET /kitar sends for real bins. */
const POINTS_OFF: Record<Exclude<PointsStatus, 'ON'>, string> = {
  PROGRAMME_PAUSED: 'Points are paused for everyone right now, so this entry earns XP only.',
  NO_PROMISES: 'Shops have no points left to give this month, so this entry earns XP only.',
  HOME_LIMIT: 'Your home has reached its points limit this month, so this entry earns XP only.',
};

/**
 * Kitar test mode (local demos only), inside the "Manual recycle (practice)" dialog: the
 * resident types a weight for the chosen bin and material, sees what it will earn, and
 * saves a practice entry. The server applies the
 * same reward and limit code as a real bin; the preview mirrors it with the real rate,
 * rounding (down to whole points) and limits, so the two agree.
 */
export function TestEntryPanel({ binId, material, rate, limits, status, xpPerTrip, wallet, onSaved }: {
  binId: string;
  material: Material;
  rate?: KitarRate;
  limits?: KitarLimits;
  status?: PointsStatus;
  xpPerTrip: number;
  wallet?: WalletSummary;
  onSaved: () => Promise<unknown>;
}) {
  const t = useT();
  const [kg, setKg] = useState('');
  const [saved, setSaved] = useState(false);
  const grams = Math.round(Number(kg.replace(',', '.')) * 1000);
  const valid = Number.isFinite(grams) && grams >= 1 && grams <= MAX_GRAMS;

  const perKg = rate?.pointsPerKg ?? 0;
  const tripsUsed = limits ? limits.tripsToday >= limits.tripsPerDay || limits.homeTripsMonth >= limits.homeTripsPerMonth : false;
  const worth = valid ? Math.floor((grams * perKg) / 1000) : 0;
  const homeLeft = limits ? Math.max(0, limits.homePointsMax - limits.homePointsMonth) : worth;
  const pointsOn = status === undefined || status === 'ON';
  const points = tripsUsed || !pointsOn ? 0 : Math.min(worth, homeLeft);
  const xp = tripsUsed ? 0 : xpPerTrip;

  const save = useAction(() => api.post<{ test: true; reward: ActionRewardView | null }>('/kitar/test-entry', { machineId: binId, material, weightG: grams }), {
    onSuccess: async () => {
      setKg('');
      await onSaved();
      setSaved(true);
    },
    success: (r) => `${t('Test entry saved.')} ${rewardMessage(r.reward, t('No XP or points this time.'))}`,
  });

  const note = tripsUsed
    ? 'You have used all your trips for now, so this entry earns no XP or points.'
    : !pointsOn && status
      ? POINTS_OFF[status as Exclude<PointsStatus, 'ON'>]
      : perKg === 0
        ? 'This material earns XP only.'
        : valid && worth > homeLeft
          ? t('Your home has {n} points left this month, so the points are capped.', { n: formatPoints(homeLeft) })
          : null;

  return (
    <div>
      <form
        method="post"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save.run();
        }}
      >
        <Input
          label="Weight (kg)"
          value={kg}
          onChange={(event) => { setKg(event.target.value); setSaved(false); }}
          inputMode="decimal"
          placeholder="e.g. 1.2"
          autoComplete="off"
          error={save.fields.weightG ?? (kg !== '' && !valid ? 'Enter a weight more than 0 kg, up to 20 kg.' : undefined)}
        />
        {valid && (
          <p role="status" className="rounded-md bg-brand-50 px-3.5 py-2.5 text-[15px] font-semibold tabular-nums text-ink-900">
            <Text>{t('{kg} × {rate} points per kg = {points} points ({rm}) + {xp} XP', { kg: kgText(grams), rate: perKg, points: formatPoints(points), rm: formatRM(points), xp })}</Text>
          </p>
        )}
        {valid && note && <p className="text-sm text-warning-700"><Text>{note}</Text></p>}
        {valid && <p className="text-xs text-ink-500"><Text>If shops have only a few points left this month, you may get fewer. A Kitar Challenge reward may be added on top.</Text></p>}
        <Button type="submit" pending={save.pending} disabled={!valid} className="w-full sm:w-auto"><Text>Save practice entry</Text></Button>
      </form>

      {saved && wallet && (
        <p role="status" className="mt-3 rounded-md bg-success-50 px-3.5 py-2.5 text-sm font-medium text-success-700">
          <Text>{t('Saved as a test entry. You now have {points} points and {xp} XP.', { points: formatPoints(wallet.totalPoints), xp: formatPoints(wallet.xp) })}</Text>
        </p>
      )}
    </div>
  );
}
