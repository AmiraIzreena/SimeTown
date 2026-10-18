'use client';

import { Text } from '@/components/ui/localized-text';

import { type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
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
}

/** The township's own rules for deadlines and reminders. The starting values are proposals, not a verified policy. */
export function PolicyTab() {
  const policy = useApi<Policy>('/admin/lockers/policy');
  const isAdmin = useIsAdmin();
  const save = useAction((body: Policy) => api.patch('/admin/lockers/policy', body), { success: 'Policy saved.', onSuccess: () => void policy.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const feeRm = String(f.get('fee_rm') ?? '').trim();
    void save.run({
      first_reminder_hours: n('first_reminder_hours'), final_reminder_hours: n('final_reminder_hours'), relocate_after_hours: n('relocate_after_hours'),
      overflow_collect_days: n('overflow_collect_days'), quiet_from_hour: n('quiet_from_hour'), quiet_to_hour: n('quiet_to_hour'),
      extensions_enabled: f.get('extensions_enabled') === 'on', extension_hours: n('extension_hours'), max_extensions: n('max_extensions'),
      fee_enabled: f.get('fee_enabled') === 'on', fee_sen: feeRm ? Math.round(Number(feeRm) * 100) : null,
      exceptions_need_second_approval: f.get('exceptions_need_second_approval') === 'on',
    });
  };
  return (
    <Async state={policy} skeleton={<SkeletonForm />}>
      {(p) => (
        <form method="post" onSubmit={submit} className="space-y-6" noValidate>
          <Card>
            <CardHeader title="Collection deadlines" description="Proposed starting values. Expiry never opens a locker: it sends reminders, then creates a relocation task for staff." />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Input label="First reminder after (hours)" name="first_reminder_hours" type="number" min={1} defaultValue={p.first_reminder_hours} />
              <Input label="Last reminder after (hours)" name="final_reminder_hours" type="number" min={2} defaultValue={p.final_reminder_hours} />
              <Input label="Due to move after (hours)" name="relocate_after_hours" type="number" min={3} defaultValue={p.relocate_after_hours} />
              <Input label="Days to collect from overflow storage" name="overflow_collect_days" type="number" min={1} defaultValue={p.overflow_collect_days} />
              <Input label="No reminders from (hour, 0–23)" name="quiet_from_hour" type="number" min={0} max={23} defaultValue={p.quiet_from_hour} />
              <Input label="Until (hour, 0–23)" name="quiet_to_hour" type="number" min={0} max={23} defaultValue={p.quiet_to_hour} />
            </div>
          </Card>
          <Card>
            <CardHeader title="More time and storage fees" description="Off unless management switches them on. A fee is shown before the resident agrees, is never charged by SimeTown, and never stops a parcel being collected." />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Checkbox label="Residents may ask for more time" name="extensions_enabled" defaultChecked={p.extensions_enabled} className="sm:col-span-3" />
              <Input label="Extra hours each time" name="extension_hours" type="number" min={1} defaultValue={p.extension_hours} />
              <Input label="Times per parcel" name="max_extensions" type="number" min={0} max={5} defaultValue={p.max_extensions} />
              <div />
              <Checkbox label="A storage fee applies to extra time" name="fee_enabled" defaultChecked={p.fee_enabled} className="sm:col-span-3" />
              <Input label="Fee (RM)" name="fee_rm" type="number" min={0} step={0.5} defaultValue={p.fee_sen ? String(p.fee_sen / 100) : ''} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Opening an occupied door" description="Staff sometimes need to take a parcel out of its locker: a wrong door, damage, a suspected theft. Each request is recorded with its reason." />
            <div className="p-5">
              <Checkbox label="A second admin must approve before the door opens" name="exceptions_need_second_approval" defaultChecked={p.exceptions_need_second_approval} />
            </div>
          </Card>
          {isAdmin ? <Button type="submit" pending={save.pending}><Text>Save policy</Text></Button> : <p className="text-sm text-ink-500"><Text>Only a township admin can change the policy.</Text></p>}
        </form>
      )}
    </Async>
  );
}
