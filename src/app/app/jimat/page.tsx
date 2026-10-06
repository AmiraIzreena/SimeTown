'use client';

import { Droplets, Lightbulb, Sun, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { BarChart } from '@/components/ui/charts';
import { Async, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMonth, rewardMessage } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { ActionRewardView } from '@/lib/types';

interface Overview {
  readings: { month: string; electricity_kwh: number; water_litres: number }[];
  electricityPct: number | null;
  waterPct: number | null;
  leakSuspected: boolean;
  tips: string[];
  solarInterest: boolean;
}

/** This month and last month, as YYYY-MM, in the township's timezone. */
function openMonths(): string[] {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return [key(now), key(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
}

function Change({ label, pct, icon: Icon }: { label: string; pct: number | null; icon: typeof Zap }) {
  const down = pct !== null && pct < 0;
  const Trend = down ? TrendingDown : TrendingUp;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      {pct === null ? (
        <p className="mt-2 text-[15px] text-ink-500">Enter two months to see the change.</p>
      ) : (
        <p className={cn('mt-2 inline-flex items-center gap-2 font-display text-3xl font-bold tabular-nums', down ? 'text-success-700' : pct === 0 ? 'text-ink-800' : 'text-warning-700')}>
          {pct !== 0 && <Trend className="size-6" aria-hidden />}
          {pct > 0 ? '+' : ''}
          {pct}%
        </p>
      )}
      {pct !== null && <p className="mt-1 text-sm text-ink-500">{down ? 'Less than last month' : pct === 0 ? 'Same as last month' : 'More than last month'}</p>}
    </Card>
  );
}

export default function JimatPage() {
  const overview = useApi<Overview>('/jimat');
  const months = openMonths();
  const submit = useAction(
    (body: { month: string; electricityKwh: number; waterLitres: number }) => api.post<{ saved: boolean; reward: ActionRewardView }>('/jimat/readings', body),
    {
      onSuccess: () => void overview.mutate(),
      success: (r) => `${r.saved ? 'You used less than last month. ' : 'Readings saved. '}${rewardMessage(r.reward, '')}`,
    },
  );
  const solar = useAction((interested: boolean) => api.post('/jimat/solar-interest', { interested }), {
    onSuccess: () => void overview.mutate(),
    success: 'Saved.',
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    void submit.run({ month: data.month!, electricityKwh: Math.round(Number(data.kwh)), waterLitres: Math.round(Number(data.m3) * 1000) }).then((ok) => ok && form.reset());
  };

  return (
    <>
      <PageHeader title="Jimat" description="Enter your home’s electricity and water readings once a month and see how they change. Readings are typed in, so they earn Impact XP only." />
      <div className="space-y-6">
        <Async state={overview} skeleton={<Skeleton className="h-64 rounded-lg" />}>
          {(o) => (
            <>
              {o.leakSuspected && (
                <Card className="flex gap-3 border-warning-600/30 bg-warning-50 p-5 text-[15px] text-warning-700">
                  <Droplets className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <p>
                    <strong>Possible leak.</strong> Your water use is well above your recent average. Turn off every tap and watch the meter: if it still moves, call a plumber.
                  </p>
                </Card>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Change label="Electricity vs last month" pct={o.electricityPct} icon={Zap} />
                <Change label="Water vs last month" pct={o.waterPct} icon={Droplets} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Month by month" />
                  <div className="p-5">
                    {o.readings.length === 0 ? (
                      <EmptyState icon={Zap} title="No readings yet">
                        Enter your first month below. The comparison starts with the second.
                      </EmptyState>
                    ) : (
                      <BarChart
                        label="Electricity in kWh and water in cubic metres by month"
                        series={[{ name: 'Electricity (kWh)', className: 'bg-brand-600' }, { name: 'Water (m³ × 10)', className: 'bg-gold-500' }]}
                        data={o.readings.map((r) => ({ label: formatMonth(r.month), values: [r.electricity_kwh, Math.round(r.water_litres / 100)] }))}
                      />
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Tips for you" />
                  <ul className="space-y-3 p-5">
                    {(o.tips.length ? o.tips : ['Enter this month’s readings to get tips for your home.']).map((tip) => (
                      <li key={tip} className="flex gap-3 text-[15px] text-ink-700">
                        <Lightbulb className="mt-0.5 size-5 shrink-0 text-gold-500" aria-hidden />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
        </Async>

        <Card>
          <CardHeader title="Enter readings" description="One entry per home per month, for this month or last month." />
          <form method="post" onSubmit={onSubmit} className="grid gap-4 p-5 sm:grid-cols-4 sm:items-start" noValidate>
            <Select label="Month" name="month" defaultValue={months[0]} error={submit.fields.month}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </Select>
            <Input label="Electricity (kWh)" name="kwh" inputMode="numeric" type="number" min={0} max={100000} step={1} required error={submit.fields.electricityKwh} />
            <Input label="Water (m³)" name="m3" inputMode="decimal" type="number" min={0} max={10000} step={0.1} required error={submit.fields.waterLitres} />
            <Button type="submit" pending={submit.pending} className="sm:mt-[26px]">
              Save readings
            </Button>
          </form>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700">
              <Sun className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Thinking about solar?</h2>
              <p className="mt-0.5 max-w-xl text-sm text-ink-600">
                {overview.data?.solarInterest
                  ? 'You asked to be contacted. The township office can see your name, unit and contact details for this purpose only. You can withdraw at any time.'
                  : 'If you ask, the township office will contact you about solar options. Your details are shared only if you ask.'}
              </p>
            </div>
          </div>
          {overview.data && (
            <Button variant={overview.data.solarInterest ? 'secondary' : 'primary'} onClick={() => void solar.run(!overview.data!.solarInterest)} pending={solar.pending}>
              {overview.data.solarInterest ? 'Withdraw my request' : 'Ask about solar'}
            </Button>
          )}
        </Card>
      </div>
    </>
  );
}
