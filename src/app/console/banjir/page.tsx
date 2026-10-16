'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';

import { Bot, CloudRain, Gauge, HeartPulse, PhoneCall, Send, ShieldCheck, Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FloodBadge, LevelGauge } from '@/components/features/flood';
import { FloodPicture } from '@/components/features/flood-picture';
import { SimulatedNote } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { CAMERA_MIN_CONFIDENCE, FLOOD_SOURCE_LABELS, FLOOD_TEST_PICTURES, type FloodSource, type FloodStatus } from '@/shared/domain';

interface Reading {
  source: FloodSource;
  level: FloodStatus;
  levelPct: number | null;
  confidence: number | null;
  trusted: boolean;
  at: string;
  note: string;
}
interface AgentZone {
  id: string;
  name: string;
  status: FloodStatus;
  level_pct: number;
  updated_at: string;
  assessment: { readings: Reading[]; agreed: FloodStatus; single: FloodStatus; safeAgreed: boolean; rising: boolean; levelPct: number | null };
  draft: { id: string; level: FloodStatus; what: string; where_text: string; todo: string; deadline_at: string; created_at: string } | null;
  timeline: { id: number; at: string; step: string; detail: Record<string, unknown> }[];
  messages: { id: string; level: FloodStatus; kind: string; what: string; todo: string; decision: string; sent_at: string; next_update_at: string | null }[];
  checkins: null | {
    safe: number;
    need_help: number;
    homes: number;
    needHelp: { full_name: string; phone: string | null; house_no: string | null; building: string | null; street: string }[];
    priority: { full_name: string; phone: string | null; house_no: string | null; building: string | null; street: string; priority_note: string | null; checked_in: string | null }[];
  };
}
interface Agent {
  zones: AgentZone[];
  warningPct: number;
  dangerPct: number;
}

const STEP_WORDS: Record<string, string> = {
  ASSESSED: 'Signals checked',
  DRAFTED: 'Draft waiting for the officer',
  DRAFT_DROPPED: 'Draft dropped',
  ALERT_SENT: 'Alert sent',
  ALL_CLEAR_SENT: 'All clear sent',
  OFFICER_CONFIRMED: 'Officer confirmed',
  OFFICER_CANCELLED: 'Officer cancelled',
  ESCALATED: 'Sent: no answer, water still rising',
  UNANSWERED: 'Unanswered: admins told',
  UPDATE_SENT: '15-minute update sent',
};
const DECISION_WORDS: Record<string, string> = { TWO_SIGNALS: 'two signals agreed', ONE_SIGNAL: 'confirmed by the officer', ESCALATED: 'sent after 3 minutes', OFFICER: 'set by the officer', SCHEDULED: 'scheduled update' };
const house = (h: { house_no: string | null; building: string | null; street: string }) => [h.house_no, h.building, h.street].filter(Boolean).join(', ');

function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return (
    <Badge tone={left < 60 ? 'danger' : 'gold'}>
      <Timer className="size-3.5" aria-hidden />
      <Text>{Math.floor(left / 60)}</Text>:<Text>{String(left % 60).padStart(2, '0')}</Text>
    </Badge>
  );
}

function ZoneAgent({ zone, agent, onChange }: { zone: AgentZone; agent: Agent; onChange: () => void }) {
  const [sensor, setSensor] = useState(zone.assessment.readings.find((r) => r.source === 'SENSOR')?.levelPct ?? zone.level_pct);
  const [what, setWhat] = useState(zone.draft?.what ?? '');
  const [todo, setTodo] = useState(zone.draft?.todo ?? '');
  const signal = useAction((body: Record<string, unknown>) => api.post(`/admin/banjir/zones/${zone.id}/signals`, body), { onSuccess: onChange });
  const decide = useAction((action: 'SEND' | 'CANCEL') => api.post(`/admin/banjir/drafts/${zone.draft!.id}`, action === 'SEND' ? { action, what: what || undefined, todo: todo || undefined } : { action }), {
    onSuccess: onChange,
    success: 'Done. It is on the timeline.',
  });
  const [manual, setManual] = useState(String(zone.level_pct));
  const override = useAction(() => api.post<{ status: FloodStatus; changed: boolean }>(`/admin/banjir/zones/${zone.id}/level`, { levelPct: Number(manual) }), {
    onSuccess: onChange,
    success: (r) => (r.changed ? `${r.status === 'DANGER' ? 'Danger alert' : r.status === 'WARNING' ? 'Warning' : 'All clear'} sent to ${zone.name}.` : 'Level recorded. The status did not change.'),
  });
  const a = zone.assessment;
  const verdict =
    a.agreed !== 'NORMAL'
      ? `Two signals agree: ${a.agreed.toLowerCase()}.`
      : a.single !== 'NORMAL'
        ? `Only one signal shows ${a.single.toLowerCase()}. A person must confirm.`
        : a.safeAgreed
          ? 'Sensor and camera agree the water is normal.'
          : 'Watching. Nothing above normal.';

  return (
    <Card className={cn(zone.status === 'DANGER' && 'border-accent-200', zone.status === 'WARNING' && 'border-warning-600/30')}>
      <CardHeader
        title={zone.name}
        description={`Updated ${timeAgo(zone.updated_at)}`}
        action={
          <span className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold tabular-nums"><Text>{zone.level_pct}</Text>%</span>
            <FloodBadge status={zone.status} />
          </span>
        }
      />
      <div className="space-y-5 p-5">
        <LevelGauge level={zone.level_pct} status={zone.status} warningPct={agent.warningPct} dangerPct={agent.dangerPct} />

        <div className="rounded-lg bg-ink-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Bot className="size-4 text-brand-700" aria-hidden /><Text>Agent: </Text><Text>{verdict}</Text> {a.rising && a.single !== 'NORMAL' && <Badge tone="warning"><Text>Rising</Text></Badge>}
          </p>
          {a.readings.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500"><Text>No fresh signals in the last 10 minutes.</Text></p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {a.readings.map((r) => (
                <li key={r.source} className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn(!r.trusted && 'text-ink-500 line-through decoration-ink-300')}>
                    <span className="font-medium"><Text>{FLOOD_SOURCE_LABELS[r.source]}</Text></span>: {r.note}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-500">
                    <Text>{timeAgo(r.at)}</Text>
                    <FloodBadge status={r.level} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {zone.draft && (
          <div className="animate-rise space-y-3 rounded-lg border-2 border-gold-300 bg-gold-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-lg font-bold text-ink-900"><Text>Confirm a </Text><Text>{zone.draft.level === 'DANGER' ? 'danger' : 'warning'}</Text><Text> alert?</Text></p>
              <Countdown until={zone.draft.deadline_at} />
            </div>
            <p className="text-sm text-ink-700"><Text>{zone.draft.level === 'DANGER' ? 'One signal only. If nobody answers and the water is still rising, it is sent when the time runs out.' : 'One signal only. Confirm within 5 minutes; if not, the admins are told.'}</Text></p>
            <Textarea label="What is happening" value={what || zone.draft.what} onChange={(event) => setWhat(event.target.value)} rows={2} />
            <p className="text-sm text-ink-700">
              <strong><Text>Where:</Text></strong> <Text>{zone.draft.where_text}</Text>
            </p>
            <Textarea label="What to do now" value={todo || zone.draft.todo} onChange={(event) => setTodo(event.target.value)} rows={2} />
            <div className="flex flex-wrap gap-2">
              <Button variant={zone.draft.level === 'DANGER' ? 'danger' : 'primary'} onClick={() => void decide.run('SEND')} pending={decide.pending}>
                <Send className="size-4" aria-hidden /><Text>Send now</Text></Button>
              <Button variant="secondary" onClick={() => void decide.run('CANCEL')} disabled={decide.pending}>
                <X className="size-4" aria-hidden /><Text>Cancel</Text></Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-900"><Text>Test signals</Text></p>
          <label className="block text-sm font-medium text-ink-700">
            <span className="flex items-center gap-1.5">
              <Gauge className="size-4" aria-hidden /><Text> Drain water-level sensor: </Text><Text>{sensor}</Text>%
            </span>
            <LocalizedInput
              type="range"
              min={0}
              max={100}
              value={sensor}
              disabled={signal.pending}
              onChange={(event) => setSensor(Number(event.target.value))}
              onPointerUp={() => void signal.run({ source: 'SENSOR', levelPct: sensor })}
              onKeyUp={(event) => (event.key === 'Enter' || event.key.startsWith('Arrow')) && void signal.run({ source: 'SENSOR', levelPct: sensor })}
              className="mt-1 h-11 w-full cursor-pointer accent-brand-600"
            />
          </label>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-700"><Text>CCTV test pictures, read by the image model</Text></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {FLOOD_TEST_PICTURES.map((p) => (
                <LocalizedButton key={p.id} type="button" disabled={signal.pending} onClick={() => void signal.run({ source: 'CAMERA', pictureId: p.id })} className="group overflow-hidden rounded-md border border-ink-200 text-left transition-colors duration-200 hover:border-brand-500" title={p.label}>
                  <FloodPicture pct={p.truePct} night={p.night} glare={p.id.startsWith('glare')} className="block h-auto w-full" />
                  <span className="block px-1.5 py-1 text-[11px] leading-tight text-ink-600"><Text>{p.label}</Text></span>
                </LocalizedButton>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink-700">
              <CloudRain className="size-4" aria-hidden /><Text> Rain gauge:</Text></span>
            {[0, 15, 45, 80].map((mm) => (
              <Button key={mm} size="sm" variant="secondary" disabled={signal.pending} onClick={() => void signal.run({ source: 'RAIN', rainMmHr: mm })}>
                <Text>{mm}</Text><Text> mm/h</Text></Button>
            ))}
          </div>
        </div>

        <form
          method="post"
          className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-ink-300 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void override.run();
          }}
        >
          <label className="min-w-0 flex-1 basis-56 text-sm font-medium text-ink-700"><Text>Duty officer: set the level by hand (sent at once)</Text><LocalizedInput type="number" min={0} max={100} value={manual} onChange={(event) => setManual(event.target.value)} className="control mt-1.5" />
          </label>
          <Button type="submit" variant="secondary" pending={override.pending} disabled={manual === '' || Number(manual) < 0 || Number(manual) > 100}><Text>Set level</Text></Button>
        </form>

        {zone.checkins && (
          <div className="space-y-3 rounded-lg border border-ink-200 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <ShieldCheck className="size-4 text-success-700" aria-hidden />
              <Text>{zone.checkins.safe}</Text><Text> checked in safe · </Text><Text>{zone.checkins.need_help}</Text><Text> need help · </Text><Text>{zone.checkins.homes}</Text><Text> homes in the zone</Text></p>
            {zone.checkins.needHelp.map((p, i) => (
              <p key={i} className="flex items-center gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-700">
                <HeartPulse className="size-4 shrink-0" aria-hidden />
                {p.full_name}, <Text>{house(p)}</Text> {p.phone && `· ${p.phone}`}
              </p>
            ))}
            {zone.checkins.priority.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Priority help list: phone these homes first</Text></p>
                <ul className="space-y-1.5">
                  {zone.checkins.priority.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <PhoneCall className="size-4 text-brand-700" aria-hidden />
                      <span className="font-medium">{p.full_name}</span>, <Text>{house(p)}</Text> {p.phone && `· ${p.phone}`}
                      {p.priority_note && <span className="text-ink-500">· <Text>{p.priority_note}</Text></span>}
                      {p.checked_in && <Badge tone={p.checked_in === 'SAFE' ? 'success' : 'danger'}><Text>{p.checked_in === 'SAFE' ? 'Safe' : 'Needs help'}</Text></Badge>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-500"><Text>Shown to duty staff only while this zone is under an alert, with the residents’ consent (BR32).</Text></p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Decision timeline</Text></p>
            <ol className="space-y-1.5 border-l-2 border-ink-200 pl-3 text-sm">
              {zone.timeline.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <span className="font-medium text-ink-900"><Text>{STEP_WORDS[t.step] ?? t.step}</Text></span>
                  {typeof t.detail.level === 'string' && <span className="text-ink-600"> · <Text>{String(t.detail.level).toLowerCase()}</Text></span>}
                  {typeof t.detail.decision === 'string' && <span className="text-ink-600"> · <Text>{DECISION_WORDS[String(t.detail.decision)]}</Text></span>}
                  <span className="block text-xs text-ink-500"><Text>{timeAgo(t.at)}</Text></span>
                </li>
              ))}
              {zone.timeline.length === 0 && <li className="text-ink-500"><Text>Nothing yet.</Text></li>}
            </ol>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-900"><Text>Messages sent</Text></p>
            <ul className="space-y-2 text-sm">
              {zone.messages.map((m) => (
                <li key={m.id} className="rounded-md bg-ink-50 p-2.5">
                  <p className="font-medium text-ink-900"><Text>{m.what}</Text></p>
                  <p className="text-xs text-ink-500">
                    <Text>{timeAgo(m.sent_at)}</Text> · <Text>{DECISION_WORDS[m.decision]}</Text>
                  </p>
                </li>
              ))}
              {zone.messages.length === 0 && <li className="text-ink-500"><Text>None yet.</Text></li>}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function FloodAgentPage() {
  const agent = useApi<Agent>('/admin/banjir/agent', { refreshInterval: 5_000 });
  const trusted = FLOOD_TEST_PICTURES.filter((p) => p.confidence >= CAMERA_MIN_CONFIDENCE);
  const mae = trusted.reduce((sum, p) => sum + Math.abs(p.readPct - p.truePct), 0) / trusted.length;
  return (
    <>
      <PageHeader title="Flood agent" description="Numbers and fixed rules decide the flood level; the AI only reads pictures and fills in the message. Two signals must agree before the highest alert goes out by itself." />
      <div className="space-y-6">
        <SimulatedNote><Text>Test mode: sensor, CCTV and rain readings are entered here by hand. The agent’s rules, drafts, timers and messages run as normal.</Text></SimulatedNote>
        <Async state={agent}>
          {(a) =>
            a.zones.length === 0 ? (
              <EmptyState title="No zones set up" />
            ) : (
              <div className="grid gap-6 xl:grid-cols-2">
                {a.zones.map((zone) => (
                  <ZoneAgent key={`${zone.id}:${zone.draft?.id ?? 'none'}`} zone={zone} agent={a} onChange={() => void agent.mutate()} />
                ))}
              </div>
            )
          }
        </Async>
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
      </div>
    </>
  );
}
