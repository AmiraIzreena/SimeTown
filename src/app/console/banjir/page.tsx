'use client';

import { useState } from 'react';
import { FloodBadge, LevelGauge } from '@/components/features/flood';
import { Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { BanjirOverview, Zone } from '@/lib/types';

/**
 * The prototype's flood sensor: a slider per zone. Releasing it records a
 * reading exactly as a real sensor would through the ingest endpoint.
 */
function ZoneSensor({ zone, overview, onSaved }: { zone: Zone; overview: BanjirOverview; onSaved: () => void }) {
  const [level, setLevel] = useState(zone.level_pct);
  const [dragging, setDragging] = useState(false);
  const shown = dragging ? level : zone.level_pct;
  const save = useAction((levelPct: number) => api.post<{ status: Zone['status']; changed: boolean }>(`/admin/banjir/zones/${zone.id}/level`, { levelPct }), {
    onSuccess: onSaved,
    success: (r) => (r.changed ? (r.status === 'DANGER' ? `Danger alert sent to everyone in ${zone.name}.` : r.status === 'WARNING' ? `Warning sent to ${zone.name}.` : `All clear sent to ${zone.name}.`) : null),
  });
  const commit = () => {
    setDragging(false);
    if (level !== zone.level_pct) void save.run(level);
  };
  const preview: Zone['status'] = shown >= overview.dangerPct ? 'DANGER' : shown >= overview.warningPct ? 'WARNING' : 'NORMAL';
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{zone.name}</h2>
        <FloodBadge status={dragging ? preview : zone.status} />
      </div>
      <p className="mt-3 font-display text-4xl font-bold tabular-nums text-ink-900">{shown}%</p>
      <div className="mt-3">
        <LevelGauge level={shown} status={dragging ? preview : zone.status} warningPct={overview.warningPct} dangerPct={overview.dangerPct} />
      </div>
      <label className="mt-4 block text-sm font-medium text-ink-700">
        Set the water level
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={shown}
          disabled={save.pending}
          onChange={(event) => {
            setDragging(true);
            setLevel(Number(event.target.value));
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="mt-2 h-11 w-full cursor-pointer accent-brand-600"
        />
      </label>
      <p className="mt-1 text-xs text-ink-500">Last reading {timeAgo(zone.updated_at)}</p>
    </Card>
  );
}

export default function FloodSensorsPage() {
  const overview = useApi<BanjirOverview>('/banjir', { refreshInterval: 15_000 });
  return (
    <>
      <PageHeader title="Flood sensors" description="Simulated drain sensors for the prototype. Crossing the warning line notifies the zone; crossing the danger line takes over residents’ screens with the safe route." />
      <Async state={overview}>
        {(o) =>
          o.zones.length === 0 ? (
            <EmptyState title="No zones set up">Zones are created with the township’s data.</EmptyState>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-500">
                Warning at {o.warningPct}% · Danger at {o.dangerPct}%. Both lines can be changed under Rules.
              </p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {o.zones.map((zone) => (
                  <ZoneSensor key={zone.id} zone={zone} overview={o} onSaved={() => void overview.mutate()} />
                ))}
              </div>
            </>
          )
        }
      </Async>
    </>
  );
}
