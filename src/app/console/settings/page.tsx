'use client';

import { Text } from '@/components/ui/localized-text';

import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';

type Settings = Record<string, number | string | boolean>;

/** Each rule: its column, its label, and how the stored number is shown to a person. */
const GROUPS: { title: string; description: string; fields: { key: string; label: string; hint?: string; scale?: number }[] }[] = [
  {
    title: 'Earning and spending',
    description: 'The rule card residents see, and the limits behind it.',
    fields: [
      { key: 'points_per_ringgit', label: 'Points per RM1 paid at a shop' },
      { key: 'issuance_fee_bps', label: 'Service fee charged to the funder (%)', hint: 'Of the value of points given.', scale: 100 },
      { key: 'min_redeem_points', label: 'Smallest amount a resident can use (points)' },
      { key: 'redeem_step_points', label: 'Points are used in steps of' },
      { key: 'max_redeem_bps', label: 'Most of one bill points can cover (%)', scale: 100 },
      { key: 'redeem_confirm_minutes', label: 'Minutes a resident has to confirm' },
    ],
  },
  {
    title: 'Limits and expiry',
    description: 'Limits stop anyone farming points. Expiry keeps the float from growing without end.',
    fields: [
      { key: 'points_daily_person', label: 'Points per person per day' },
      { key: 'points_monthly_person', label: 'Points per person per month' },
      { key: 'points_monthly_home', label: 'Points per home per month' },
      { key: 'expiry_inactive_months', label: 'Months without activity before points expire' },
      { key: 'expiry_max_months', label: 'Longest any point can last (months)' },
    ],
  },
  {
    title: 'Shop Offers',
    description: 'Offer-backed points come only from what shops pledge each month: no pledge, no points.',
    fields: [
      { key: 'offer_points_monthly_home', label: 'Offer-backed points per home per month', hint: 'From verified green actions, for example 800 (RM8).' },
      { key: 'offer_success_fee_bps', label: 'Success fee on an offer used (%)', hint: 'Of the discount, charged to the shop only when an offer is used.', scale: 100 },
    ],
  },
  {
    title: 'Safety and privacy',
    description: 'Flood lines, moderation and the smallest group a sponsor may see.',
    fields: [
      { key: 'flood_warning_pct', label: 'Flood warning line (%)' },
      { key: 'flood_danger_pct', label: 'Flood danger line (%)', hint: 'Agree this level with the drainage team.' },
      { key: 'flag_hide_threshold', label: 'Flags that hide a post' },
      { key: 'min_group_size', label: 'Smallest group shown to a sponsor' },
    ],
  },
];

export default function SettingsPage() {
  const me = useApi<Me>('/me');
  const settings = useApi<Settings>('/admin/settings');
  const canEdit = me.data?.role === 'HQ_ADMIN';
  const save = useAction((body: Settings) => api.patch('/admin/settings', body), { success: 'Rules saved. The change is in the audit trail.', onSuccess: () => void settings.mutate() });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const body: Settings = {};
    for (const field of GROUPS.flatMap((g) => g.fields)) body[field.key] = Math.round(Number(form[field.key]) * (field.scale ?? 1));
    void save.run(body);
  };

  return (
    <>
      <PageHeader title="Rules" description={canEdit ? 'The programme’s adjustable rules. Every change is logged.' : 'The programme’s rules. Only an SDP HQ admin can change them.'} />
      <Async state={settings}>
        {(s) => (
          <form method="post" onSubmit={submit} className="space-y-5" noValidate>
            {s.issuance_paused && (
              <Card className="flex flex-wrap items-center justify-between gap-4 border-accent-200 bg-accent-50 p-5 text-[15px] text-accent-700">
                <p>
                  <strong><Text>Points are paused</Text></strong><Text> because a float check failed. Resume only after the cause has been found and fixed.</Text></p>
                {canEdit && (
                  <Button type="button" variant="danger" onClick={() => void save.run({ issuance_paused: false })} pending={save.pending}><Text>Resume points</Text></Button>
                )}
              </Card>
            )}
            {GROUPS.map((group) => (
              <Card key={group.title}>
                <CardHeader title={group.title} description={group.description} />
                <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.fields.map((field) => (
                    <Input key={field.key} label={field.label} name={field.key} type="number" step="any" defaultValue={Number(s[field.key]) / (field.scale ?? 1)} hint={field.hint} disabled={!canEdit} error={save.fields[field.key]} required />
                  ))}
                </div>
              </Card>
            ))}
            {canEdit && (
              <Button type="submit" size="lg" pending={save.pending}><Text>Save rules</Text></Button>
            )}
          </form>
        )}
      </Async>
    </>
  );
}
