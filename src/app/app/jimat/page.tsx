'use client';

import { Text } from '@/components/ui/localized-text';

import { Droplets, Lightbulb, Sun, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BillReader } from '@/components/features/bill-reader';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
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
  readings: { month: string; electricity_kwh: number | null; water_litres: number | null; electricity_source: string | null; water_source: string | null }[];
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
        <Text>{label}</Text>
      </div>
      {pct === null ? (
        <p className="mt-2 text-[15px] text-ink-500"><Text>Enter two months to see the change.</Text></p>
      ) : (
        <p className={cn('mt-2 inline-flex items-center gap-2 font-display text-3xl font-bold tabular-nums', down ? 'text-success-700' : pct === 0 ? 'text-ink-800' : 'text-warning-700')}>
          {pct !== 0 && <Trend className="size-6" aria-hidden />}
          <Text>{pct > 0 ? '+' : ''}</Text>
          <Text>{pct}</Text>%
        </p>
      )}
      {pct !== null && <p className="mt-1 text-sm text-ink-500"><Text>{down ? 'Less than last month' : pct === 0 ? 'Same as last month' : 'More than last month'}</Text></p>}
    </Card>
  );
}

export default function JimatPage() {
  const akses = useAksesMode();
  const overview = useApi<Overview>('/jimat');
  const months = openMonths();
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [guidedStep, setGuidedStep] = useState(0);
  const [guidedMonth, setGuidedMonth] = useState(months[0]!);
  const [guidedKwh, setGuidedKwh] = useState('');
  const [guidedM3, setGuidedM3] = useState('');
  const [guidedError, setGuidedError] = useState('');
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
  const nextGuided = () => {
    if (guidedStep === 1 && (!guidedKwh || !Number.isFinite(Number(guidedKwh)) || Number(guidedKwh) < 0)) {
      setGuidedError('Please enter a valid electricity reading.');
      return;
    }
    setGuidedError('');
    setGuidedStep((step) => step + 1);
  };
  const saveGuided = () => {
    if (!guidedM3 || !Number.isFinite(Number(guidedM3)) || Number(guidedM3) < 0) {
      setGuidedError('Please enter a valid water reading.');
      return;
    }
    void submit.run({ month: guidedMonth, electricityKwh: Math.round(Number(guidedKwh)), waterLitres: Math.round(Number(guidedM3) * 1000) }).then((ok) => {
      if (ok) {
        setGuidedOpen(false);
        setGuidedStep(0);
        setGuidedKwh('');
        setGuidedM3('');
      }
    });
  };

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader title="Jimat" description="Read your electricity and water bills from a photo or PDF, or type the readings, and see how your home’s use changes. Savings read from bills can earn offer-backed points." />
      <div className="space-y-6">
        <Async state={overview} skeleton={<Skeleton className="h-64 rounded-lg" />}>
          {(o) => (
            <>
              {o.leakSuspected && (
                <Card className="flex gap-3 border-warning-600/30 bg-warning-50 p-5 text-[15px] text-warning-700">
                  <Droplets className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <p>
                    <strong><Text>Possible leak.</Text></strong><Text> Your water use is well above your recent average. Turn off every tap and watch the meter: if it still moves, call a plumber.</Text></p>
                </Card>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Change label="Electricity vs last month" pct={o.electricityPct} icon={Zap} />
                <Change label="Water vs last month" pct={o.waterPct} icon={Droplets} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Month by month" />
                  <div className="energy-chart p-5">
                    {o.readings.length === 0 ? (
                      <EmptyState icon={Zap} title="No readings yet"><Text>Enter your first month below. The comparison starts with the second.</Text></EmptyState>
                    ) : (
                      <BarChart
                        label="Electricity in kWh and water in cubic metres by month"
                        series={[{ name: 'Electricity (kWh)', className: 'bg-brand-600' }, { name: 'Water (m³ × 10)', className: 'bg-gold-500' }]}
                        data={o.readings.map((r) => ({ label: formatMonth(r.month), values: [r.electricity_kwh ?? 0, Math.round((r.water_litres ?? 0) / 100)] }))}
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
                        <Text>{tip}</Text>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
        </Async>

        <BillReader onSaved={() => void overview.mutate()} accessible={akses.guided} />

        <Card>
          <CardHeader title="Or type your readings" description="One entry per home per month, for this month or last month. Typed readings earn Impact XP only." />
          {akses.guided ? (
            <div className="p-5">
              <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => { setGuidedStep(0); setGuidedOpen(true); }}><Text>Enter readings one at a time</Text></Button>
            </div>
          ) : (
          <form method="post" onSubmit={onSubmit} className="grid gap-4 p-5 sm:grid-cols-4 sm:items-start" noValidate>
            <Select label="Month" name="month" defaultValue={months[0]} error={submit.fields.month}>
              {months.map((m) => (
                <option key={m} value={m}>
                  <Text>{formatMonth(m)}</Text>
                </option>
              ))}
            </Select>
            <Input label="Electricity (kWh)" name="kwh" inputMode="numeric" type="number" min={0} max={100000} step={1} required error={submit.fields.electricityKwh} />
            <Input label="Water (m³)" name="m3" inputMode="decimal" type="number" min={0} max={10000} step={0.1} required error={submit.fields.waterLitres} />
            <Button type="submit" pending={submit.pending} className="sm:mt-[26px]"><Text>Save readings</Text></Button>
          </form>
          )}
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700">
              <Sun className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold"><Text>Thinking about solar?</Text></h2>
              <p className="mt-0.5 max-w-xl text-sm text-ink-600">
                <Text>{overview.data?.solarInterest
                  ? 'You asked to be contacted. The township office can see your name, unit and contact details for this purpose only. You can withdraw at any time.'
                  : 'If you ask, the township office will contact you about solar options. Your details are shared only if you ask.'}</Text>
              </p>
            </div>
          </div>
          {overview.data && (
            <Button variant={overview.data.solarInterest ? 'secondary' : 'primary'} onClick={() => void solar.run(!overview.data!.solarInterest)} pending={solar.pending}>
              <Text>{overview.data.solarInterest ? 'Withdraw my request' : 'Ask about solar'}</Text>
            </Button>
          )}
        </Card>
      </div>
      {akses.guided && (
        <AksesWizard open={guidedOpen} title="Enter your readings" step={guidedStep} total={3} onClose={() => setGuidedOpen(false)} onBack={() => setGuidedStep((step) => step - 1)} onNext={nextGuided} onSubmit={saveGuided} pending={submit.pending} submitLabel="Save readings">
          {guidedStep === 0 ? (
            <Select label="Month" labelClassName="!text-3xl !font-semibold" value={guidedMonth} onChange={(event) => setGuidedMonth(event.target.value)}>
              {months.map((month) => <option key={month} value={month}><Text>{formatMonth(month)}</Text></option>)}
            </Select>
          ) : guidedStep === 1 ? (
            <Input label="Electricity (kWh)" labelClassName="!text-3xl !font-semibold" type="number" min={0} max={100000} step={1} inputMode="numeric" value={guidedKwh} onChange={(event) => { setGuidedKwh(event.target.value); setGuidedError(''); }} error={guidedError || submit.fields.electricityKwh} />
          ) : (
            <Input label="Water (m³)" labelClassName="!text-3xl !font-semibold" type="number" min={0} max={10000} step={0.1} inputMode="decimal" value={guidedM3} onChange={(event) => { setGuidedM3(event.target.value); setGuidedError(''); }} error={guidedError || submit.fields.waterLitres} />
          )}
        </AksesWizard>
      )}
    </AksesPage>
  );
}
