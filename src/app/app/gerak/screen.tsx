'use client';

import { Text } from '@/components/ui/localized-text';

import { Bike, CheckCircle2, Circle, Footprints, Route } from 'lucide-react';
import { useState } from 'react';
import { CampaignCard } from '@/components/features/rewards';
import { CodeEntry } from '@/components/features/scan';
import { Tracker } from '@/components/features/tracker';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { formatKm, rewardMessage } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { ActionRewardView, Campaign } from '@/lib/types';

interface Overview {
  loops: { id: string; name: string; description: string; mode: 'WALK' | 'CYCLE'; distance_m: number; checkpoints: { id: string; seq: number; name: string; scanned_today: boolean }[] }[];
  monthMetres: number;
  monthLoops: number;
  allLoops: number;
}
interface CheckIn {
  checkpoint: string;
  loop: string;
  loopCompleted: boolean;
  remaining: number;
  reward: ActionRewardView;
}

export function GerakScreen({ scanned }: { scanned: string }) {
  const overview = useApi<Overview>('/gerak');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [code, setCode] = useState(scanned);

  const scan = useAction(() => api.post<CheckIn>('/gerak/checkins', { code: code.trim() }), {
    onSuccess: () => {
      setCode('');
      void overview.mutate();
      void campaigns.mutate();
    },
    success: (r) =>
      r.loopCompleted ? `${r.loop} complete! ${rewardMessage(r.reward, '')}` : `${r.checkpoint} scanned. ${r.remaining} more to finish ${r.loop}. ${rewardMessage(r.reward, '')}`,
  });
  const mobility = campaigns.data?.filter((c) => c.activity.startsWith('GERAK')) ?? [];

  return (
    <>
      <PageHeader title="Gerak" description="Walk, run, cycle or wheel a township loop. Track it on the map and the checkpoints tick themselves, or scan the posters on the way." />
      <div className="space-y-6">
        <Async state={overview} skeleton={<SkeletonStats count={3} />}>
          {(o) => (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label="Distance this month" value={o.monthMetres} format={formatKm} icon={Route} />
              <Stat label="Loops this month" value={o.monthLoops} icon={Bike} />
              <div className="col-span-2 lg:col-span-1">
                <Stat label="Loops in total" value={o.allLoops} icon={Footprints} tone="gold" />
              </div>
            </div>
          )}
        </Async>

        <Tracker
          onFinished={() => {
            void overview.mutate();
            void campaigns.mutate();
          }}
        />

        <Card>
          <CardHeader title="Or scan a checkpoint poster" description="The backup when GPS is weak. Scan every checkpoint of a loop on the same day." />
          <div className="p-5">
            <CodeEntry label="Checkpoint code" value={code} onChange={setCode} onSubmit={() => void scan.run()} pending={scan.pending} error={scan.fields.code} action="Check in" />
          </div>
        </Card>

        {mobility.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {mobility.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}

        <section aria-labelledby="loops-title">
          <h2 id="loops-title" className="mb-3 text-lg font-semibold"><Text>Township loops</Text></h2>
          <Async state={overview} skeleton={<SkeletonList rows={2} />}>
            {(o) =>
              o.loops.length === 0 ? (
                <EmptyState icon={Route} title="No loops yet"><Text>The township team has not set up any walking or cycling loops.</Text></EmptyState>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {o.loops.map((loop) => {
                    const done = loop.checkpoints.filter((c) => c.scanned_today).length;
                    return (
                      <Card key={loop.id} className="p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="brand"><Text>{loop.mode === 'CYCLE' ? 'Cycling' : 'Walking'}</Text></Badge>
                          <Badge><Text>{formatKm(loop.distance_m)}</Text></Badge>
                          {done === loop.checkpoints.length && <Badge tone="success"><Text>Done today</Text></Badge>}
                        </div>
                        <h3 className="mt-3 text-[17px] font-semibold">{loop.name}</h3>
                        <p className="mt-1 text-[15px] text-ink-600">{loop.description}</p>
                        <ol className="mt-4 space-y-2">
                          {loop.checkpoints.map((cp) => (
                            <li key={cp.id} className="flex items-center gap-2.5 text-[15px]">
                              {cp.scanned_today ? <CheckCircle2 className="size-5 shrink-0 text-success-600" aria-hidden /> : <Circle className="size-5 shrink-0 text-ink-300" aria-hidden />}
                              <span className={cp.scanned_today ? 'text-ink-900' : 'text-ink-600'}>{cp.name}</span>
                              <span className="sr-only"><Text>{cp.scanned_today ? '(scanned today)' : '(not scanned yet)'}</Text></span>
                            </li>
                          ))}
                        </ol>
                      </Card>
                    );
                  })}
                </div>
              )
            }
          </Async>
        </section>
      </div>
    </>
  );
}
