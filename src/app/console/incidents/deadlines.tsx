'use client';

import { Text } from '@/components/ui/localized-text';

import { PlayCircle } from 'lucide-react';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Async, SkeletonForm } from '@/components/ui/feedback';
import { Checkbox, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { ADMINS } from '@/shared/domain';
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '@/shared/incidents';

interface Policy {
  targets: Record<Priority, { assign: number; resolve: number; working: boolean }>;
  workday_start: number;
  workday_end: number;
  workdays: number[];
  holidays: string[];
  dispute_days: number;
}
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** How quickly each priority must be taken and resolved. Proposed starting values, not SDP's agreed service levels. */
export function Deadlines() {
  const data = useApi<{ policy: Policy }>('/admin/incidents/policy');
  const me = useApi<Me>('/me');
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const save = useAction((body: Policy) => api.patch('/admin/incidents/policy', body), { success: 'Deadlines saved.', onSuccess: () => void data.mutate() });
  const run = useAction(() => api.post<{ unassignedEscalated: number; overdueEscalated: number; closed: number }>('/admin/incidents/run-checks'), {
    success: (r) => `Checked: ${r.unassignedEscalated + r.overdueEscalated} escalated, ${r.closed} closed.`,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const targets = Object.fromEntries(PRIORITIES.map((p) => [p, { assign: n(`${p}-assign`), resolve: n(`${p}-resolve`), working: f.get(`${p}-working`) === 'on' }])) as Policy['targets'];
    void save.run({
      targets, workday_start: n('workday_start'), workday_end: n('workday_end'), dispute_days: n('dispute_days'),
      workdays: WEEKDAYS.map((_, i) => i + 1).filter((d) => f.get(`day-${d}`) === 'on'),
      holidays: String(f.get('holidays') ?? '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)),
    });
  };
  return (
    <Async state={data} skeleton={<SkeletonForm />}>
      {({ policy: p }) => (
        <form method="post" onSubmit={submit} className="space-y-6" noValidate>
          <Card>
            <CardHeader title="Targets by priority" description="In minutes. Proposed starting values: the township decides its own. “Working time only” skips evenings, weekends and holidays." />
            <div className="space-y-4 p-5">
              {PRIORITIES.map((pr) => (
                <div key={pr} className="grid items-end gap-3 sm:grid-cols-4">
                  <p className="font-semibold text-ink-900"><Text>{PRIORITY_LABELS[pr]}</Text></p>
                  <Input label="Taken within (minutes)" name={`${pr}-assign`} type="number" min={1} defaultValue={p.targets[pr].assign} />
                  <Input label="Resolved within (minutes)" name={`${pr}-resolve`} type="number" min={2} defaultValue={p.targets[pr].resolve} />
                  <Checkbox label="Working time only" name={`${pr}-working`} defaultChecked={p.targets[pr].working} />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Working hours, holidays and reopening" />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Input label="Working day starts (hour)" name="workday_start" type="number" min={0} max={23} defaultValue={p.workday_start} />
              <Input label="Working day ends (hour)" name="workday_end" type="number" min={1} max={24} defaultValue={p.workday_end} />
              <Input label="Days to reopen a resolved report" name="dispute_days" type="number" min={1} max={60} defaultValue={p.dispute_days} />
              <fieldset className="sm:col-span-3">
                <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>Working days</Text></legend>
                <div className="flex flex-wrap gap-4">{WEEKDAYS.map((d, i) => <Checkbox key={d} label={d} name={`day-${i + 1}`} defaultChecked={p.workdays.includes(i + 1)} />)}</div>
              </fieldset>
              <Input label="Holidays (YYYY-MM-DD, separated by commas)" name="holidays" defaultValue={p.holidays.join(', ')} className="sm:col-span-3" />
            </div>
          </Card>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={save.pending}><Text>Save deadlines</Text></Button>
              <Button type="button" variant="secondary" onClick={() => void run.run()} pending={run.pending}><PlayCircle className="size-4" aria-hidden /><Text>Run the deadline checks now</Text></Button>
            </div>
          ) : <p className="text-sm text-ink-500"><Text>Only a township admin can change the deadlines.</Text></p>}
          <p className="text-sm text-ink-500"><Text>The scheduler runs the deadline checks every 5 minutes (the “incidents” job); the button runs them at once, for a demonstration.</Text></p>
        </form>
      )}
    </Async>
  );
}
