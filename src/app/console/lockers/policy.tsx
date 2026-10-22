'use client';

import { Text } from '@/components/ui/localized-text';

import { BarChart3, BellRing, CalendarClock, DoorOpen, PhoneCall, Sparkles } from 'lucide-react';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Async, SkeletonForm } from '@/components/ui/feedback';
import { Checkbox, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useIsAdmin } from './overview';

interface Policy {
  first_reminder_hours: number;
  final_reminder_hours: number;
  relocate_after_hours: number;
  overflow_collect_days: number;
  quiet_from_hour: number;
  quiet_to_hour: number;
  extensions_enabled: boolean;
  extension_hours: number;
  max_extensions: number;
  fee_enabled: boolean;
  fee_sen: number | null;
  exceptions_need_second_approval: boolean;
  door_reminder_hours: number;
  counter_call_after_days: number;
}

/**
 * The township's reminder timings. Every home has its own door, so nothing in a door is ever overdue or moved;
 * only parcels at the guardhouse become overdue, and they stay there until collected. No fees are charged.
 */
export function PolicyTab() {
  const policy = useApi<Policy>('/admin/lockers/policy');
  const isAdmin = useIsAdmin();
  const save = useAction((body: Policy) => api.patch('/admin/lockers/policy', body), { success: 'Reminder timings saved.', onSuccess: () => void policy.mutate() });
  return (
    <Async state={policy} skeleton={<SkeletonForm />}>
      {(p) => {
        const submit = (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const f = new FormData(event.currentTarget);
          const n = (k: string) => Number(f.get(k));
          // Settings from the old shared-door model are kept as they are; fees and extensions stay off.
          void save.run({
            ...p,
            door_reminder_hours: n('door_reminder_hours'), overflow_collect_days: n('overflow_collect_days'), counter_call_after_days: n('counter_call_after_days'),
            quiet_from_hour: n('quiet_from_hour'), quiet_to_hour: n('quiet_to_hour'),
            exceptions_need_second_approval: f.get('exceptions_need_second_approval') === 'on',
            extensions_enabled: false, fee_enabled: false, fee_sen: null,
          });
        };
        return (
          <form method="post" onSubmit={submit} className="space-y-6" noValidate>
            <fieldset disabled={!isAdmin} className="space-y-6">
              <Card>
                <CardHeader title="Parcels in a home’s own door" description="The door belongs to the home, so the parcel waits as long as it needs to. It is never overdue and never moved." />
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  <Input label="Gentle reminder after (hours)" name="door_reminder_hours" type="number" min={1} max={720} defaultValue={p.door_reminder_hours}
                    hint="Then once a week until collected." error={save.fields.door_reminder_hours} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Parcels at the guardhouse" description="Parcels left with the guard and locker parcels that did not fit a door: never sent back by themselves. The days each waits are counted and stay in its record; the household sees them too." />
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  <Input label="Overdue after (days)" name="overflow_collect_days" type="number" min={1} max={60} defaultValue={p.overflow_collect_days}
                    hint="From then on, a reminder once a week." error={save.fields.overflow_collect_days} />
                  <Input label="Ask the guard to call after (days)" name="counter_call_after_days" type="number" min={2} max={90} defaultValue={p.counter_call_after_days}
                    hint="Must be more than the overdue days." error={save.fields.counter_call_after_days} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Quiet hours" description="Reminders wait until morning. Security alerts, such as a door opened without a code, are sent at any hour." />
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  <Input label="No reminders from (hour, 0–23)" name="quiet_from_hour" type="number" min={0} max={23} defaultValue={p.quiet_from_hour} error={save.fields.quiet_from_hour} />
                  <Input label="Until (hour, 0–23)" name="quiet_to_hour" type="number" min={0} max={23} defaultValue={p.quiet_to_hour} error={save.fields.quiet_to_hour} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Opening an occupied door" description="Staff sometimes need to take a parcel out of its door: a wrong door, damage, a suspected theft. Each request is recorded with its reason." />
                <div className="p-5">
                  <Checkbox label="A second admin must approve before the door opens" name="exceptions_need_second_approval" defaultChecked={p.exceptions_need_second_approval} />
                </div>
              </Card>
            </fieldset>
            <PlannedCharge />
            <PlannedImprovements />
            {isAdmin ? <Button type="submit" pending={save.pending}><Text>Save reminder timings</Text></Button> : <p className="text-sm text-ink-500"><Text>Only a township admin can change these timings.</Text></p>}
          </form>
        );
      }}
    </Async>
  );
}

/** A planned feature, shown so reviewers can see where it would fit. Nothing here is switched on or charged. */
function PlannedCharge() {
  const steps = [
    { icon: CalendarClock, text: 'The days a parcel waits at the guardhouse are already counted and kept in its record.' },
    { icon: BellRing, text: 'Households would be told the charge in advance, before any parcel becomes overdue.' },
    { icon: PhoneCall, text: 'Collection would never be refused because of an unpaid charge.' },
  ];
  return (
    <Card className="overflow-hidden border-dashed">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-700"><Sparkles className="size-5" aria-hidden /></span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-ink-900"><Text>Late-collection storage charge</Text></h3>
            <p className="mt-1 text-sm text-ink-600"><Text>A possible future integration: a small daily charge for parcels left at the guardhouse well past the collection period, to keep room for everyone.</Text></p>
          </div>
        </div>
        <Badge tone="gold"><Text>Planned · not active</Text></Badge>
      </div>
      <ul className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
        {steps.map((step) => <li key={step.text} className="flex items-start gap-2.5 rounded-lg bg-ink-25 p-3 text-sm text-ink-700"><step.icon className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden /><Text>{step.text}</Text></li>)}
      </ul>
      <p className="border-t border-ink-100 bg-ink-25/60 px-5 py-3 text-xs text-ink-500 sm:px-6"><Text>No charge is collected today. Switching it on would need management approval and a payment provider.</Text></p>
    </Card>
  );
}

/** Improvements agreed for later, shown so reviewers can see what comes next. None of them is built yet. */
function PlannedImprovements() {
  const items = [
    { icon: DoorOpen, title: 'Door alerts open the door’s record', text: 'A case about a door opened without a code will link straight to that door: its parcel, its history and its commands.' },
    { icon: PhoneCall, title: 'One-tap call outcome for guards', text: 'Guards will record “Called: no answer” straight from the parcel list, without opening the notes.' },
    { icon: BarChart3, title: 'Monthly late-collection report for HQ', text: 'A monthly summary per locker bank: parcels that went overdue, days waited, and calls made.' },
  ];
  return (
    <Card className="overflow-hidden border-dashed">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-ink-900"><Text>More planned improvements</Text></h3>
          <p className="mt-1 text-sm text-ink-600"><Text>Agreed for a later release. Nothing here is active yet.</Text></p>
        </div>
        <Badge tone="gold"><Text>Planned · not active</Text></Badge>
      </div>
      <ul className="grid gap-3 p-5 sm:grid-cols-3 sm:px-6">
        {items.map((item) => (
          <li key={item.title} className="rounded-lg bg-ink-25 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-900"><item.icon className="size-4 shrink-0 text-ink-400" aria-hidden /><Text>{item.title}</Text></p>
            <p className="mt-1 text-sm text-ink-600"><Text>{item.text}</Text></p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
