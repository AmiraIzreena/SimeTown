'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton } from '@/components/ui/localized-elements';

import { Clock, Radio, TrendingUp } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { FloodBadge } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { FLOOD_FAULT_LABELS, FLOOD_SENSOR_SITE_LABELS, FLOOD_SOURCE_LABELS, type FloodSensorSite } from '@/shared/domain';
import type { Agent, AgentZone } from './types';
import { SignalNote } from './zone-agent';

/** Where each kind of site sits inside a zone tile: a schematic, not a survey map. */
const PIN: Record<FloodSensorSite, CSSProperties> = {
  LAKE_EDGE: { left: '18%', bottom: '8%' },
  MAIN_DRAIN: { left: '50%', bottom: '22%' },
  LOW_ROAD: { left: '82%', bottom: '8%' },
  OTHER: { left: '82%', bottom: '30%' },
};
const TILE = { NORMAL: 'border-success-600/30 bg-success-50', WARNING: 'border-warning-600/40 bg-warning-50', DANGER: 'border-accent-300 bg-accent-50' } as const;
const WATER = { NORMAL: 'bg-brand-500/20', WARNING: 'bg-warning-600/25', DANGER: 'bg-accent-600/30' } as const;

/** Tab 1: every zone coloured by its level, with its sensors pinned and the time of each one's last reading. */
export function LiveMap({ agent, onOpenZone }: { agent: Agent; onOpenZone: (zoneId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(agent.zones[0]?.id ?? null);
  const zone = agent.zones.find((z) => z.id === selected) ?? null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-500">
          <p><Text>Schematic of the township’s flood zones. Pins show each sensor by where it is placed; the shading shows the water level.</Text></p>
          <p className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success-600" aria-hidden /><Text>Sensor OK</Text></span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent-600" aria-hidden /><Text>Faulty</Text></span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ink-400" aria-hidden /><Text>No reading yet</Text></span>
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {agent.zones.map((z) => (
            <ZoneTile key={z.id} zone={z} selected={z.id === selected} onSelect={() => setSelected(z.id)} />
          ))}
        </div>
      </Card>
      {zone && <ZoneSignals zone={zone} onOpen={() => onOpenZone(zone.id)} />}
    </div>
  );
}

function ZoneTile({ zone, selected, onSelect }: { zone: AgentZone; selected: boolean; onSelect: () => void }) {
  return (
    <LocalizedButton
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${zone.name}: ${zone.status.toLowerCase()}, ${zone.level_pct}%`}
      className={cn('relative h-52 overflow-hidden rounded-xl border-2 p-3 text-left transition-shadow duration-200 hover:shadow-md', TILE[zone.status], selected && 'ring-2 ring-brand-600 ring-offset-2')}
    >
      <span aria-hidden className={cn('absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-soft', WATER[zone.status])} style={{ height: `${zone.level_pct}%` }} />
      <span className="relative flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-snug text-ink-900">{zone.name}</span>
        <FloodBadge status={zone.status} />
      </span>
      <span className="relative mt-1 block font-display text-2xl font-bold tabular-nums text-ink-900"><Text>{zone.level_pct}</Text>%</span>
      {zone.assessment.risingFast && (
        <span className="relative mt-1 inline-flex items-center gap-1 rounded-full bg-accent-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          <TrendingUp className="size-3" aria-hidden /><Text>Rising fast</Text>
        </span>
      )}
      {zone.sensors.map((s) => (
        <span key={s.id} className="absolute flex -translate-x-1/2 flex-col items-center" style={PIN[s.site]}>
          <span aria-hidden className={cn('size-3.5 rounded-full border-2 border-white shadow', s.health === 'OK' ? 'bg-success-600' : s.health === 'FAULTY' ? 'bg-accent-600' : 'bg-ink-400')} />
          <span className="mt-0.5 whitespace-nowrap rounded bg-white/85 px-1 text-center text-[10px] font-medium leading-tight text-ink-700">
            {s.code}
            <span className="block font-normal text-ink-500"><Text>{s.last_seen_at ? timeAgo(s.last_seen_at) : 'never'}</Text></span>
          </span>
        </span>
      ))}
      {zone.sensors.length === 0 && (
        <span className="absolute bottom-3 left-3 text-[11px] text-ink-600"><Text>No sensors registered</Text></span>
      )}
    </LocalizedButton>
  );
}

function ZoneSignals({ zone, onOpen }: { zone: AgentZone; onOpen: () => void }) {
  const a = zone.assessment;
  return (
    <Card>
      <CardHeader title={zone.name} description={a.lastVerifiedAt ? `Last verified ${timeAgo(a.lastVerifiedAt)}` : 'No healthy sensor reading yet'} action={<FloodBadge status={zone.status} />} />
      <div className="space-y-4 p-5 text-sm">
        <div>
          <p className="mb-2 font-semibold text-ink-900"><Text>Signals now</Text></p>
          {a.readings.length === 0 ? (
            <p className="text-ink-500"><Text>No fresh signals in the last 10 minutes.</Text></p>
          ) : (
            <ul className="space-y-1.5">
              {a.readings.map((r) => (
                <li key={r.source} className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn(!r.trusted && 'text-ink-500 line-through')}><span className="font-medium"><Text>{FLOOD_SOURCE_LABELS[r.source]}</Text></span>: <SignalNote note={r.note} /></span>
                  <FloodBadge status={r.level} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 font-semibold text-ink-900"><Text>Sensors</Text></p>
          <ul className="space-y-2">
            {zone.sensors.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink-50 px-3 py-2">
                <span className="flex items-center gap-2">
                  <Radio className="size-4 text-ink-500" aria-hidden />
                  <span className="font-medium">{s.code}</span>
                  <span className="text-ink-500"><Text>{FLOOD_SENSOR_SITE_LABELS[s.site]}</Text></span>
                </span>
                <span className="flex items-center gap-2 text-xs text-ink-600">
                  {s.last_level_pct !== null && <span className="tabular-nums"><Text>{s.last_level_pct}</Text>%</span>}
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /><Text>{s.last_seen_at ? timeAgo(s.last_seen_at) : 'never'}</Text></span>
                  {s.health === 'FAULTY' ? <Badge tone="danger"><Text>{s.health_reason ? FLOOD_FAULT_LABELS[s.health_reason] : 'Faulty'}</Text></Badge> : s.health === 'OK' ? <Badge tone="success"><Text>OK</Text></Badge> : <Badge><Text>Waiting</Text></Badge>}
                </span>
              </li>
            ))}
            {zone.sensors.length === 0 && <li className="text-ink-500"><Text>No sensors registered. Readings come from the test controls only.</Text></li>}
          </ul>
        </div>
        <Button variant="secondary" onClick={onOpen}><Text>Open in the agent queue</Text></Button>
      </div>
    </Card>
  );
}
