'use client';

import { Text } from '@/components/ui/localized-text';

import { useState } from 'react';
import { SimulatedNote } from '@/components/features/preview';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useApi } from '@/lib/hooks';
import { CAMERA_MIN_CONFIDENCE, FLOOD_TEST_PICTURES } from '@/shared/domain';
import { EventsTab } from './events-tab';
import { HelpTab } from './help-tab';
import { LiveMap } from './live-map';
import { SensorsTab } from './sensors-tab';
import type { Agent } from './types';
import { ZoneAgent } from './zone-agent';

type TabKey = 'map' | 'queue' | 'sensors' | 'help' | 'events';

/** The camera test set: accuracy reported only as measured here. */
function CameraTestSet() {
  const trusted = FLOOD_TEST_PICTURES.filter((p) => p.confidence >= CAMERA_MIN_CONFIDENCE);
  const mae = trusted.reduce((sum, p) => sum + Math.abs(p.readPct - p.truePct), 0) / trusted.length;
  return (
    <Card>
      <CardHeader title="Camera reading: our own test set" description={`Accuracy is reported only as measured here. Readings below ${CAMERA_MIN_CONFIDENCE * 100}% confidence are not trusted as a signal.`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 text-left text-xs text-ink-500">
            <tr>
              <th className="px-5 py-2 font-medium"><Text>Picture</Text></th>
              <th className="px-3 py-2 font-medium"><Text>True level</Text></th>
              <th className="px-3 py-2 font-medium"><Text>Model read</Text></th>
              <th className="px-3 py-2 font-medium"><Text>Error</Text></th>
              <th className="px-3 py-2 font-medium"><Text>Confidence</Text></th>
              <th className="px-3 py-2 font-medium"><Text>Used as a signal</Text></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {FLOOD_TEST_PICTURES.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-2"><Text>{p.label}</Text></td>
                <td className="px-3 py-2 tabular-nums"><Text>{p.truePct}</Text>%</td>
                <td className="px-3 py-2 tabular-nums"><Text>{p.readPct}</Text>%</td>
                <td className="px-3 py-2 tabular-nums"><Text>{Math.abs(p.readPct - p.truePct)}</Text><Text> pts</Text></td>
                <td className="px-3 py-2 tabular-nums"><Text>{Math.round(p.confidence * 100)}</Text>%</td>
                <td className="px-3 py-2">{p.confidence >= CAMERA_MIN_CONFIDENCE ? <Badge tone="success"><Text>Yes</Text></Badge> : <Badge><Text>No: too unsure</Text></Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-ink-100 px-5 py-3 text-sm text-ink-600"><Text>Mean error on trusted pictures: </Text><strong><Text>{mae.toFixed(1)}</Text><Text> percentage points</Text></strong> (<Text>{trusted.length}</Text><Text> of </Text><Text>{FLOOD_TEST_PICTURES.length}</Text><Text> pictures trusted).</Text></p>
    </Card>
  );
}

/**
 * The Flood dashboard (proposal Appendix E.3): five tabs over one live picture of
 * every zone. The agent's rules, drafts, timers and messages run as normal; in
 * the prototype the sensors are simulated, but their readings are signed and
 * go through the real ingestion endpoint.
 */
export default function FloodDashboardPage() {
  const agent = useApi<Agent>('/admin/banjir/agent', { refreshInterval: 5_000 });
  const [tab, setTab] = useState<TabKey>('map');
  const zones = agent.data?.zones ?? [];
  const drafts = zones.filter((z) => z.draft).length;
  const faulty = zones.flatMap((z) => z.sensors).filter((s) => s.health === 'FAULTY').length;
  const alerts = zones.filter((z) => z.status !== 'NORMAL').length;

  const openZone = (zoneId: string) => {
    setTab('queue');
    window.setTimeout(() => document.getElementById(`zone-${zoneId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };

  return (
    <>
      <PageHeader title="Flood dashboard" description="Numbers and fixed rules decide the flood level; the AI only reads pictures and fills in the message. Two signals of different types must agree before an alert goes out by itself." />
      <div className="space-y-6">
        <SimulatedNote><Text>Test mode: the sensors are simulated and the CCTV and rain readings are entered by hand. Sensor readings are still signed and go through the real ingestion endpoint; the agent’s rules, drafts, timers and messages run as normal. SMS is recorded, not sent.</Text></SimulatedNote>
        <Tabs<TabKey>
          label="Flood dashboard"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'map', label: 'Live map', count: alerts },
            { key: 'queue', label: 'Agent queue', count: drafts },
            { key: 'sensors', label: 'Sensors', count: faulty },
            { key: 'help', label: 'Priority help' },
            { key: 'events', label: 'Events and reports' },
          ]}
        />
        <Async state={agent}>
          {(a) =>
            a.zones.length === 0 ? (
              <EmptyState title="No zones set up" />
            ) : (
              <>
                {tab === 'map' && <TabPanel><LiveMap agent={a} onOpenZone={openZone} /></TabPanel>}
                {tab === 'queue' && (
                  <TabPanel>
                    <div className="space-y-6">
                      <div className="grid gap-6 xl:grid-cols-2">
                        {a.zones.map((zone) => (
                          <ZoneAgent key={`${zone.id}:${zone.draft?.id ?? 'none'}`} zone={zone} agent={a} onChange={() => void agent.mutate()} />
                        ))}
                      </div>
                      <CameraTestSet />
                    </div>
                  </TabPanel>
                )}
                {tab === 'sensors' && <TabPanel><SensorsTab zones={a.zones} /></TabPanel>}
                {tab === 'help' && <TabPanel><HelpTab /></TabPanel>}
                {tab === 'events' && <TabPanel><EventsTab /></TabPanel>}
              </>
            )
          }
        </Async>
      </div>
    </>
  );
}
