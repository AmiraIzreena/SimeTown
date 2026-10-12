'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, Cpu, QrCode as QrIcon, Recycle, Scale, Ticket, UserRound, Users } from 'lucide-react';
import { LiveMachineSession } from '@/components/features/machine-session';
import { Badge } from '@/components/ui/card';
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
  machines: { id: string; name: string; status: 'ONLINE' | 'FULL' | 'OFFLINE'; location: string }[];
  photoCheck: boolean;
}

const MACHINE_STATUS = { ONLINE: { label: 'Open', tone: 'success' as const }, FULL: { label: 'Full: use the kiosk', tone: 'warning' as const }, OFFLINE: { label: 'Offline', tone: 'neutral' as const } };

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
  const [claimCode, setClaimCode] = useState('');
  const claim = useAction(() => api.post<{ grams: number; reward: ActionRewardView | null }>('/kitar/claim', { code: claimCode.trim() }), {
    onSuccess: () => {
      setClaimCode('');
      void overview.mutate();
    },
    success: (r) => `Claimed ${formatKg(r.grams)}. ${rewardMessage(r.reward, 'Thank you for recycling.')} Guest recycling earns XP only.`,
  });
  const recycling = campaigns.data?.filter((c) => c.activity === 'KITAR_DROPOFF') ?? [];

  return (
    <>
      <PageHeader title="Kitar" description="Recycle at a smart machine that recognises, counts and weighs each item, or drop off at a kiosk. Every drop-off earns Impact XP." />
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

        <LiveMachineSession onDone={() => void overview.mutate()} />

        <Card>
          <CardHeader title="Smart recycling machine" description="A 30-second stop: nothing to type. Machine drop-offs can also earn offer-backed points." />
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.2fr]">
            <Async state={overview} skeleton={<SkeletonStats count={1} />}>
              {(o) =>
                o.machines.length === 0 ? (
                  <p className="text-sm text-ink-500"><Text>No smart machines in this township yet. Use a kiosk below.</Text></p>
                ) : (
                  <ul className="space-y-2">
                    {o.machines.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 p-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                            <Cpu className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[15px] font-semibold text-ink-900">{m.name}</span>
                            <span className="block truncate text-sm text-ink-500"><Text>{m.location}</Text></span>
                          </span>
                        </span>
                        <Badge tone={MACHINE_STATUS[m.status].tone}><Text>{MACHINE_STATUS[m.status].label}</Text></Badge>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Async>
            <ol className="space-y-3 text-[15px] text-ink-700">
              <li className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">1</span>
                <span>
                  <strong className="text-ink-900"><Text>Scan the machine’s screen</Text></strong><Text> with your phone camera. Its code changes every 30 seconds, so a photo of an old code is useless.</Text></span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">
                  <QrIcon className="size-4" aria-hidden />
                </span>
                <span>
                  <strong className="text-ink-900"><Text>Or show your SimeTown QR</Text></strong><Text> to the machine’s camera (Points & XP, “Show my code”). It works on a phone with no data, or on a printed card.</Text></span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-200 text-sm font-bold text-ink-700">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <span>
                  <strong className="text-ink-900"><Text>Visitors recycle as a guest</Text></strong><Text> and get a claim code that a resident can claim within 14 days, for XP only.</Text></span>
              </li>
            </ol>
          </div>
          <form
            method="post"
            className="flex flex-wrap items-end gap-3 border-t border-ink-100 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void claim.run();
            }}
          >
            <Input label="Claim guest recycling" value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="8-letter code from the machine" autoComplete="off" spellCheck={false} maxLength={16} className="min-w-0 flex-1 basis-56" error={claim.fields.code} hint="Recycled before you joined, or with a guest? Enter the code the machine gave." />
            <Button type="submit" variant="secondary" pending={claim.pending} disabled={claimCode.trim().length < 6} className="mb-[26px]">
              <Ticket className="size-4" aria-hidden /><Text>Claim</Text></Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="No machine nearby? Record a kiosk drop-off" description="Three short steps. The weight you enter earns Impact XP; a machine’s weighing is needed for offer-backed points." />
          <div className="space-y-7 p-5">
            <fieldset>
              <legend className="mb-3 flex w-full flex-wrap items-center justify-between gap-3 text-[15px] font-semibold text-ink-900">
                <span><Text>1. What is it?</Text></span>
                {overview.data?.photoCheck && (
                  <label className={cn('inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 shadow-xs transition-colors duration-200 hover:border-ink-300', identify.pending && 'pointer-events-none opacity-60')}>
                    <Camera className="size-4" aria-hidden />
                    <Text>{identify.pending ? 'Checking…' : 'Check with a photo'}</Text>
                    <LocalizedInput type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => event.target.files?.[0] && void identify.run(event.target.files[0])} />
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
                    <Text>{MATERIAL_INFO[m].label}</Text>
                  </button>
                ))}
              </div>
              {material && <p className="mt-3 animate-fade-in rounded-md bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800"><Text>{MATERIAL_INFO[material].tip}</Text></p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="2. Kiosk code" value={kioskCode} onChange={(event) => setKioskCode(event.target.value.toUpperCase())} placeholder="e.g. KABC2345XY" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} error={drop.fields.kioskCode} hint="Scan the kiosk’s poster, or type the code on it." />
              <Input label="3. Weight (kg)" value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" placeholder="e.g. 0.5" error={drop.fields.weightG ?? (grams > 20_000 ? 'One drop-off can be up to 20 kg.' : undefined)} hint="Use the scale at the kiosk." />
            </div>
            <Button size="lg" onClick={() => void drop.run()} pending={drop.pending} disabled={!ready}><Text>Record drop-off</Text></Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your recent drop-offs" />
          <Async state={overview}>
            {(o) =>
              o.recent.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Recycle} title="No drop-offs yet"><Text>Kiosks: </Text><Text>{o.kiosks.map((k) => `${k.name} (${k.location})`).join('; ') || 'none set up yet'}</Text>.
                  </EmptyState>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {o.recent.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[15px]">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900"><Text>{MATERIAL_INFO[d.material].label}</Text></p>
                        <p className="text-sm text-ink-500">
                          <Text>{d.kiosk}</Text> · <Text>{timeAgo(d.created_at)}</Text>
                        </p>
                      </div>
                      <span className="font-semibold text-ink-800 tabular-nums"><Text>{formatKg(d.weight_g)}</Text></span>
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
