'use client';

import { MapPin, Navigation } from 'lucide-react';
import { FloodBadge, LevelGauge } from '@/components/features/flood';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { BanjirOverview } from '@/lib/types';

export default function BanjirPage() {
  const overview = useApi<BanjirOverview>('/banjir', { refreshInterval: 15_000 });
  return (
    <>
      <PageHeader title="Banjir" description="Water levels in the township’s drains, by zone. A danger warning for your zone takes over the screen and shows the safe route." />
      <Async state={overview}>
        {(o) =>
          o.zones.length === 0 ? (
            <EmptyState title="No flood zones set up">The township team has not added any zones yet.</EmptyState>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">
                Warning at {o.warningPct}% · Danger at {o.dangerPct}% · updates every few seconds
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {[...o.zones]
                  .sort((a, b) => Number(b.id === o.myZoneId) - Number(a.id === o.myZoneId))
                  .map((zone) => (
                    <Card key={zone.id} className={cn('p-5', zone.status === 'DANGER' && 'border-accent-200 bg-accent-50/50', zone.id === o.myZoneId && zone.status !== 'DANGER' && 'border-brand-300')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[17px] font-semibold">{zone.name}</h2>
                        {zone.id === o.myZoneId && <Badge tone="brand">Your zone</Badge>}
                        <span className="ml-auto">
                          <FloodBadge status={zone.status} />
                        </span>
                      </div>
                      <p className="mt-3 font-display text-4xl font-bold tabular-nums text-ink-900">{zone.level_pct}%</p>
                      <div className="mt-3">
                        <LevelGauge level={zone.level_pct} status={zone.status} warningPct={o.warningPct} dangerPct={o.dangerPct} />
                      </div>
                      <ul className="mt-4 space-y-2 border-t border-ink-100 pt-3 text-sm text-ink-700">
                        <li className="flex gap-2">
                          <Navigation className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                          <span>
                            <span className="sr-only">Safe route: </span>
                            {zone.safe_route}
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
                          <span>
                            <span className="sr-only">Assembly point: </span>
                            {zone.assembly_point}
                          </span>
                        </li>
                      </ul>
                      <p className="mt-3 text-xs text-ink-500">Updated {timeAgo(zone.updated_at)}</p>
                    </Card>
                  ))}
              </div>
            </div>
          )
        }
      </Async>
    </>
  );
}
