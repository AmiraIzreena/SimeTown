'use client';

import { Text } from '@/components/ui/localized-text';

import { FileText } from 'lucide-react';
import { FloodBadge } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { DataTable } from '@/components/ui/table';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { EventRow } from './types';

const minutes = (a: string | null, b: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000) : null);

/** Tab 5: past and open flood events, each with its post-event report and false-alarm review. */
export function EventsTab() {
  const events = useApi<EventRow[]>('/admin/banjir/events', { refreshInterval: 15_000 });
  return (
    <Async state={events}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={FileText} title="No flood events yet"><Text>An event starts with a zone’s first alert and ends with its all clear.</Text></EmptyState>
        ) : (
          <DataTable
            caption="Flood events"
            rows={list}
            keyOf={(e) => e.id}
            columns={[
              { header: 'Zone', cell: (e) => <span className="font-semibold text-ink-900">{e.zone_name}</span> },
              { header: 'Started', cell: (e) => <Text>{formatDateTime(e.started_at)}</Text> },
              { header: 'Length', desktopOnly: true, cell: (e) => (e.ended_at ? <Text>{formatDuration(minutes(e.started_at, e.ended_at) ?? 0)}</Text> : <Badge tone="warning"><Text>Open</Text></Badge>) },
              { header: 'Peak', cell: (e) => <span className="flex items-center gap-2"><FloodBadge status={e.peak_status} />{e.peak_level_pct !== null && <span className="tabular-nums"><Text>{e.peak_level_pct}</Text>%</span>}</span> },
              { header: 'Warning lead time', desktopOnly: true, cell: (e) => (e.first_danger_at ? <Text>{formatDuration(minutes(e.first_warning_at, e.first_danger_at) ?? 0)}</Text> : <span className="text-ink-500"><Text>{e.ended_at ? 'Never reached danger' : 'Not reached danger yet'}</Text></span>) },
              { header: 'People warned', desktopOnly: true, align: 'right', cell: (e) => <Text>{e.people_warned}</Text> },
              {
                header: 'Review',
                cell: (e) => (e.reviewed_at ? <Badge tone={e.false_alarm ? 'warning' : 'success'}><Text>{e.false_alarm ? 'False alarm' : 'Real flood'}</Text></Badge> : <Badge><Text>{e.ended_at ? 'To review' : 'After the all clear'}</Text></Badge>),
              },
              { header: 'Report', cell: (e) => <Button size="sm" variant="secondary" href={`/console/banjir/events/${e.id}`}><FileText className="size-4" aria-hidden /><Text>Open</Text></Button> },
            ]}
          />
        )
      }
    </Async>
  );
}
