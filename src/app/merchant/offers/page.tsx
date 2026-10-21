'use client';

import { Text } from '@/components/ui/localized-text';

import { Accessibility, BadgePercent, Pause, Play, Plus, Square, Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { OFFER_DAYS, offerTerms } from '@/components/features/offers';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress, Stat } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Async, SkeletonPanel, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatPoints, formatRM } from '@/shared/domain';

interface Offer {
  id: string;
  title: string;
  discountSen: number;
  minSpendSen: number;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  monthlyBudgetSen: number;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  usedThisMonthSen: number;
  budgetThisMonthSen: number;
  usable: boolean;
  reason: string | null;
  createdAt: string;
}
interface Data {
  offers: Offer[];
  thisMonth: { offers_used: number; discount_sen: number; fees_sen: number; fees_due_sen: number };
}
interface Summary {
  merchant: { akses_friendly: boolean };
  rules: { successFeeBps: number };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Shop Offers (proposal sections 8 and 13): the shop's own discount for points, with a monthly budget it sets. */
export default function OffersPage() {
  const data = useApi<Data>('/merchant/offers');
  const summary = useApi<Summary>('/merchant/summary');
  const [days, setDays] = useState(127);
  const [ending, setEnding] = useState<Offer | null>(null);
  const refresh = () => void data.mutate();

  const create = useAction((body: Record<string, unknown>) => api.post('/merchant/offers', body), { onSuccess: refresh, success: 'Offer is live. Residents can earn offer-backed points against your budget from now.' });
  const setStatus = useAction((id: string, status: Offer['status']) => api.post(`/merchant/offers/${id}/status`, { status }), {
    onSuccess: () => {
      setEnding(null);
      refresh();
    },
    success: 'Saved.',
  });
  const akses = useAction((value: boolean) => api.post('/merchant/akses-friendly', { aksesFriendly: value }), { onSuccess: () => void summary.mutate(), success: 'Saved.' });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const f = Object.fromEntries(new FormData(element)) as Record<string, string>;
    void create
      .run({
        title: f.title,
        discountSen: parseRM(f.discount ?? '') ?? 0,
        minSpendSen: parseRM(f.minSpend || '0') ?? 0,
        daysMask: days,
        startMinute: toMinutes(f.start || '00:00'),
        endMinute: f.end === '23:59' || !f.end ? 1440 : toMinutes(f.end),
        monthlyBudgetSen: parseRM(f.budget ?? '') ?? 0,
      })
      .then((ok) => ok && element.reset());
  };
  const feePct = (summary.data?.rules.successFeeBps ?? 1000) / 100;
  const live = data.data?.offers.find((o) => o.status !== 'ENDED');

  return (
    <>
      <PageHeader title="Shop Offers" description="Your own discount for SimeTown points, on your terms, with a monthly budget you set. Residents earn offer-backed points from green actions, up to what shops have promised." />
      <div className="space-y-6">
        <Async state={data} skeleton={<SkeletonStats count={3} />}>
          {(d) => (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Offers used this month" value={d.thisMonth.offers_used} icon={Tag} />
              <Stat label="Discounts given" value={d.thisMonth.discount_sen} format={formatRM} icon={BadgePercent} tone="gold" hint="Your marketing cost" />
              <Stat label="Success fees" value={d.thisMonth.fees_sen} format={formatRM} hint={`${feePct}% of each discount used`} />
              <Stat label="Fees waiting" value={d.thisMonth.fees_due_sen} format={formatRM} tone={d.thisMonth.fees_due_sen ? 'warning' : 'brand'} hint="Taken at your next top-up or settlement" />
            </div>
          )}
        </Async>

        {live && (
          <Card className={cn(live.status === 'ACTIVE' ? 'border-brand-300' : '')}>
            <CardHeader
              title={live.title}
              description={`${formatPoints(live.discountSen)} offer points for ${formatRM(live.discountSen)} off · ${offerTerms(live)}`}
              action={<Badge tone={live.status === 'PAUSED' ? 'neutral' : live.usable ? 'success' : 'gold'}><Text>{live.status === 'PAUSED' ? 'Paused by you' : live.usable ? 'Live now' : live.reason === 'BUDGET_USED' ? 'Paused: budget used' : 'Outside its hours'}</Text></Badge>}
            />
            <div className="space-y-4 p-5">
              <div>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-medium text-ink-800"><Text>Budget used this month</Text></span>
                  <span className="tabular-nums text-ink-500">
                    <Text>{formatRM(live.usedThisMonthSen)}</Text><Text> of </Text><Text>{formatRM(live.budgetThisMonthSen)}</Text>
                  </span>
                </div>
                <Progress value={live.usedThisMonthSen} max={live.budgetThisMonthSen} tone="gold" label="Offer budget used this month" />
                <p className="mt-1.5 text-xs text-ink-500"><Text>The offer pauses by itself when the budget is used up, and starts again next month. You never give more than you set.</Text></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {live.status === 'ACTIVE' ? (
                  <Button variant="secondary" onClick={() => void setStatus.run(live.id, 'PAUSED')} pending={setStatus.pending}>
                    <Pause className="size-4" aria-hidden /><Text>Pause</Text></Button>
                ) : (
                  <Button onClick={() => void setStatus.run(live.id, 'ACTIVE')} pending={setStatus.pending}>
                    <Play className="size-4" aria-hidden /><Text>Resume</Text></Button>
                )}
                <Button variant="ghost" onClick={() => setEnding(live)}>
                  <Square className="size-4" aria-hidden /><Text>End offer</Text></Button>
              </div>
            </div>
          </Card>
        )}

        {data.data && !live && (
          <Card>
            <CardHeader title="Create an offer" description={`You choose the terms. The only fee is ${feePct}% of each discount actually used.`} />
            <form method="post" onSubmit={submit} className="space-y-5 p-5" noValidate>
              {data.data.offers.length === 0 && (
                <p className="flex items-start gap-3 rounded-lg bg-gold-50 p-4 text-sm leading-relaxed text-ink-700">
                  <Tag className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden />
                  <span><strong className="block font-semibold text-ink-900"><Text>No offers yet</Text></strong><Text>An offer brings green-minded residents to your shop. You decide the discount, the days and hours, and the most you will give in a month.</Text></span>
                </p>
              )}
              <Input name="title" label="Offer name" placeholder="e.g. RM3 off afternoon tea" required maxLength={80} error={create.fields.title} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Input name="discount" label="Discount (RM, whole ringgit)" inputMode="numeric" placeholder="3" required error={create.fields.discountSen} hint="The resident gives the same number of points: RM3 = 300 points." />
                <Input name="minSpend" label="Minimum spend (RM, optional)" inputMode="decimal" placeholder="20" error={create.fields.minSpendSen} />
                <Input name="budget" label="Monthly budget (RM)" inputMode="numeric" placeholder="400" required error={create.fields.monthlyBudgetSen} hint="The most you give in discounts in a month." />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800"><Text>Days</Text></legend>
                <div className="flex flex-wrap gap-2">
                  {OFFER_DAYS.map((day, i) => {
                    const on = (days & (1 << i)) !== 0;
                    return (
                      <button key={day} type="button" aria-pressed={on} onClick={() => setDays((d) => (on && d !== 1 << i ? d & ~(1 << i) : d | (1 << i)))} className={cn('min-h-11 min-w-14 rounded-md border px-3 text-sm font-semibold transition-[background-color,border-color,color,scale] duration-200 ease-soft active:scale-[0.97] active:duration-100 motion-reduce:transition-none', on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-500')}>
                        <Text>{day}</Text>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input name="start" type="time" label="From" defaultValue="00:00" hint="Quiet hours bring customers when the shop is slow." />
                <Input name="end" type="time" label="Until" defaultValue="23:59" error={create.fields.endMinute} />
              </div>
              <Button type="submit" size="lg" pending={create.pending}>
                <Plus className="size-4" aria-hidden /><Text>Make the offer live</Text></Button>
            </form>
          </Card>
        )}

        <Async state={data}>
          {(d) =>
            d.offers.filter((o) => o.status === 'ENDED').length === 0 ? null : (
              <Card>
                <CardHeader title="Past offers" />
                <ul className="divide-y divide-ink-100">
                  {d.offers
                    .filter((o) => o.status === 'ENDED')
                    .map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                        <span>
                          <span className="font-medium text-ink-900">{o.title}</span>
                          <span className="block text-sm text-ink-500">
                            <Text>{offerTerms(o)}</Text><Text> · from </Text><Text>{formatDate(o.createdAt)}</Text>
                          </span>
                        </span>
                        <Badge><Text>Ended</Text></Badge>
                      </li>
                    ))}
                </ul>
              </Card>
            )
          }
        </Async>

        {/* A shop setting rather than part of an offer, so it sits last. */}
        <Async state={summary} skeleton={<SkeletonPanel body="lines" />}>
          {(s) => (
            <Card>
              <CardHeader title="Shop settings" />
              <div className="flex items-start gap-3 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                  <Accessibility className="size-5" aria-hidden />
                </span>
                <div className="flex-1">
                  <Switch label="Akses-friendly badge" hint="Show residents that your shop has step-free entry, space for a wheelchair, and staff happy to help." checked={s.merchant.akses_friendly} onChange={(v) => void akses.run(v)} disabled={akses.pending} />
                </div>
              </div>
            </Card>
          )}
        </Async>
      </div>

      <ConfirmDialog open={ending !== null} onClose={() => setEnding(null)} onConfirm={() => ending && void setStatus.run(ending.id, 'ENDED')} title="End this offer?" confirmLabel="End offer" destructive pending={setStatus.pending}>
        <p><Text>This month’s promise still stands for points residents have already earned. You can create a new offer at any time.</Text></p>
      </ConfirmDialog>
    </>
  );
}
