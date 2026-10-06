'use client';

import { Camera, Recycle, Scale, Users } from 'lucide-react';
import { useState } from 'react';
import { CampaignCard } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKg, rewardMessage, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/image';
import type { ActionRewardView, Campaign } from '@/lib/types';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

interface Overview {
  monthGrams: number;
  allGrams: number;
  dropOffs: number;
  street: string | null;
  streetMonthGrams: number;
  recent: { id: string; material: Material; weight_g: number; created_at: string; kiosk: string }[];
  kiosks: { id: string; name: string; location: string }[];
  photoCheck: boolean;
}

export function KitarScreen({ scanned }: { scanned: string }) {
  const overview = useApi<Overview>('/kitar');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [material, setMaterial] = useState<Material | null>(null);
  const [kioskCode, setKioskCode] = useState(scanned);
  const [weight, setWeight] = useState('');

  const identify = useAction(
    async (file: File) => {
      const form = new FormData();
      form.set('photo', await shrinkPhoto(file), 'item.jpg');
      return api.post<{ material: Material | null }>('/kitar/identify', form);
    },
    {
      onSuccess: (r) => r.material && setMaterial(r.material),
      success: (r) => (r.material ? `Looks like ${MATERIAL_INFO[r.material].label}. Change it below if that is wrong.` : 'We could not tell from the photo. Please pick the material from the list.'),
    },
  );
  const grams = Math.round(Number(weight) * 1000);
  const drop = useAction(() => api.post<{ kiosk: string; reward: ActionRewardView }>('/kitar/dropoffs', { kioskCode: kioskCode.trim(), material, weightG: grams }), {
    onSuccess: () => {
      setMaterial(null);
      setWeight('');
      void overview.mutate();
      void campaigns.mutate();
    },
    success: (r) => `Recorded at ${r.kiosk}. ${rewardMessage(r.reward, 'Thank you for recycling.')}`,
  });
  const ready = material !== null && kioskCode.trim().length >= 6 && grams >= 1 && grams <= 20_000;
  const recycling = campaigns.data?.filter((c) => c.activity === 'KITAR_DROPOFF') ?? [];

  return (
    <>
      <PageHeader title="Kitar" description="Check what the item is made of, drop it at a township kiosk and scan the kiosk’s code. Every drop-off earns Impact XP." />
      <div className="space-y-6">
        <Async state={overview} skeleton={<SkeletonStats count={3} />}>
          {(o) => (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label="You, this month" value={o.monthGrams} format={formatKg} icon={Recycle} />
              <Stat label={o.street ? `${o.street}, this month` : 'Your street, this month'} value={o.streetMonthGrams} format={formatKg} icon={Users} />
              <div className="col-span-2 lg:col-span-1">
                <Stat label="You, all time" value={o.allGrams} format={formatKg} hint={`${o.dropOffs} drop-offs`} icon={Scale} tone="gold" />
              </div>
            </div>
          )}
        </Async>

        {recycling.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {recycling.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}

        <Card>
          <CardHeader title="Record a drop-off" description="Three short steps." />
          <div className="space-y-7 p-5">
            <fieldset>
              <legend className="mb-3 flex w-full flex-wrap items-center justify-between gap-3 text-[15px] font-semibold text-ink-900">
                <span>1. What is it?</span>
                {overview.data?.photoCheck && (
                  <label className={cn('inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 shadow-xs transition-colors duration-200 hover:border-ink-300', identify.pending && 'pointer-events-none opacity-60')}>
                    <Camera className="size-4" aria-hidden />
                    {identify.pending ? 'Checking…' : 'Check with a photo'}
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => event.target.files?.[0] && void identify.run(event.target.files[0])} />
                  </label>
                )}
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MATERIALS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={material === m}
                    onClick={() => setMaterial(m)}
                    className={cn(
                      'min-h-12 rounded-md border px-3 py-2 text-left text-sm font-medium transition-[border-color,background-color,color] duration-200',
                      material === m ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
                    )}
                  >
                    {MATERIAL_INFO[m].label}
                  </button>
                ))}
              </div>
              {material && <p className="mt-3 animate-fade-in rounded-md bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800">{MATERIAL_INFO[material].tip}</p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="2. Kiosk code" value={kioskCode} onChange={(event) => setKioskCode(event.target.value.toUpperCase())} placeholder="e.g. KABC2345XY" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} error={drop.fields.kioskCode} hint="Scan the kiosk’s poster, or type the code on it." />
              <Input label="3. Weight (kg)" value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" placeholder="e.g. 0.5" error={drop.fields.weightG ?? (grams > 20_000 ? 'One drop-off can be up to 20 kg.' : undefined)} hint="Use the scale at the kiosk." />
            </div>
            <Button size="lg" onClick={() => void drop.run()} pending={drop.pending} disabled={!ready}>
              Record drop-off
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your recent drop-offs" />
          <Async state={overview}>
            {(o) =>
              o.recent.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Recycle} title="No drop-offs yet">
                    Kiosks: {o.kiosks.map((k) => `${k.name} (${k.location})`).join('; ') || 'none set up yet'}.
                  </EmptyState>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {o.recent.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[15px]">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{MATERIAL_INFO[d.material].label}</p>
                        <p className="text-sm text-ink-500">
                          {d.kiosk} · {timeAgo(d.created_at)}
                        </p>
                      </div>
                      <span className="font-semibold text-ink-800 tabular-nums">{formatKg(d.weight_g)}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>
      </div>
    </>
  );
}
