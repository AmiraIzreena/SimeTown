'use client';

import { Text } from '@/components/ui/localized-text';

import { Check, Clock, Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, Progress } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate, formatKg, formatKm } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { Campaign, SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

/** Seconds left before a request expires, ticking once a second. */
function useCountdown(until: string | null): number {
  const [left, setLeft] = useState(() => (until ? Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)) : 0));
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setLeft(Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return left;
}

/**
 * BR12: points are never taken without the resident saying yes on their own
 * phone. This card is that moment.
 */
export function PendingRedemption({ sale, onDecided }: { sale: SaleView; onDecided: () => void }) {
  const left = useCountdown(sale.expiresAt);
  const decide = useAction((accept: boolean) => api.post<SaleView>(`/wallet/sales/${sale.id}/decision`, { accept }), {
    onSuccess: onDecided,
    success: (result) =>
      result.status === 'COMPLETED'
        ? `Done. You used ${formatPoints(result.redeemPoints + result.offerPoints)} points and pay ${formatRM(result.cashSen)}.${result.pointsEarned ? ` +${result.pointsEarned} points earned.` : ''}`
        : result.status === 'EXPIRED'
          ? 'That request had expired. Ask the cashier to try again.'
          : 'Declined. No points were used.',
  });
  return (
    <Card className="animate-rise border-gold-300 bg-gold-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gold-700"><Text>Confirm at the counter</Text></p>
          <p className="mt-1 font-display text-xl font-bold text-ink-900">
            <Text>{sale.offerPoints > 0 && sale.redeemPoints === 0
              ? `Use the offer “${sale.offerTitle}” at ${sale.merchantName}?`
              : `Use ${formatPoints(sale.redeemPoints + sale.offerPoints)} points at ${sale.merchantName}?`}</Text>
          </p>
          <p className="mt-1 text-[15px] text-ink-700"><Text>Bill </Text><Text>{formatRM(sale.billSen)}</Text>
            <Text>{sale.offerPoints > 0 && ` · Shop Offer ${formatRM(sale.offerPoints)} off (${formatPoints(sale.offerPoints)} offer-backed points)`}</Text>
            <Text>{sale.redeemPoints > 0 && ` · points cover ${formatRM(sale.redeemPoints)}`}</Text><Text> · you pay </Text><strong><Text>{formatRM(sale.cashSen)}</Text></strong>
          </p>
        </div>
        <Badge tone="gold">
          <Clock className="size-3.5" aria-hidden />
          <Text>{Math.floor(left / 60)}</Text>:<Text>{String(left % 60).padStart(2, '0')}</Text>
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => decide.run(true)} pending={decide.pending}>
          <Check className="size-4" aria-hidden /><Text>Confirm</Text></Button>
        <Button variant="secondary" onClick={() => decide.run(false)} disabled={decide.pending}>
          <X className="size-4" aria-hidden /><Text>Decline</Text></Button>
      </div>
    </Card>
  );
}

const goalText = (c: Campaign, value: number) =>
  c.goal_metric === 'COUNT' ? `${value}` : c.quantity_unit === 'g' ? formatKg(value) : c.quantity_unit === 'm' ? formatKm(value) : `${value}`;

/** A live challenge, always naming who paid for the reward. */
export function CampaignCard({ campaign: c }: { campaign: Campaign }) {
  const progress = c.my_progress ?? 0;
  const earned = c.my_rewards ?? 0;
  const complete = earned >= c.per_person_cap;
  const toward = c.goal_metric === 'COUNT' && c.goal_target === 1 ? null : progress % c.goal_target;
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700">
          <Megaphone className="size-[18px]" aria-hidden />
        </span>
        <Badge tone={complete ? 'success' : 'gold'}><Text>{complete ? 'Reward earned' : `${formatPoints(c.reward_points)} points`}</Text></Badge>
      </div>
      <h3 className="mt-3 text-base font-semibold">{c.title}</h3>
      <p className="mt-1 flex-1 text-sm text-ink-600">{c.description}</p>
      {!complete && toward !== null && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs font-medium text-ink-600">
            <span><Text>{goalText(c, toward)}</Text></span>
            <span><Text>{goalText(c, c.goal_target)}</Text></span>
          </div>
          <Progress value={toward} max={c.goal_target} tone="gold" label={`Progress in ${c.title}`} />
        </div>
      )}
      <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500"><Text>Funded by </Text><span className="font-semibold text-ink-700"><Text>{c.funder}</Text></span><Text> · ends </Text><Text>{formatDate(c.ends_at)}</Text>
        <Text>{c.pool_left_sen < c.reward_points && ' · reward pool used up'}</Text>
      </p>
    </Card>
  );
}
