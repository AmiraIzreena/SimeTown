'use client';

import { Text } from '@/components/ui/localized-text';
import { CountUp } from '@/components/ui/count-up';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';

import { Bot, Camera, CloudRain, Gauge, HeartPulse, MessageSquareText, PhoneCall, Send, ShieldCheck, Timer, TrendingUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FloodBadge, LevelGauge } from '@/components/features/flood';
import { FloodPicture } from '@/components/features/flood-picture';
import { FloodTrend } from '@/components/features/flood-trend';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { PHOTO_ACCEPT, PHOTO_HINT, usePhotoPick } from '@/lib/image';
import { FLOOD_SOURCE_LABELS, FLOOD_TEST_PICTURES, type FloodStatus } from '@/shared/domain';
import { DECISION_WORDS, STEP_WORDS, type Agent, type AgentZone } from './types';

const house = (h: { house_no: string | null; building: string | null; street: string }) => [h.house_no, h.building, h.street].filter(Boolean).join(', ');

/** The agent joins the parts of a signal's note with " · "; each part is translated on its own. */
export function SignalNote({ note }: { note: string }) {
  return (
    <>
      {note.split(' · ').map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <Text>{part}</Text>
        </span>
      ))}
    </>
  );
}

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

const READER_NAME = { HOSTED_AI: 'hosted AI', MODEL_SERVER: 'your water-level model' } as const;

/**
 * A drain photo standing in for a CCTV frame: read by the camera reader (your own model server, or the
 * hosted AI) and recorded as this zone's camera signal. Later, a CCTV frame grabber sends frames to the
 * same place. Without a reader set up, the control says how to set one up instead of failing silently.
 */
function CameraPhoto({ zoneId, reader, onDone }: { zoneId: string; reader: 'HOSTED_AI' | 'MODEL_SERVER' | null; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pickPhoto = usePhotoPick();
  const [result, setResult] = useState<{ reading: { levelPct: number | null; confidence: number; reader: string }; trusted: boolean } | null>(null);
  const upload = useAction(
    (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return api.post<{ reading: { levelPct: number | null; confidence: number; reader: string }; trusted: boolean }>(`/admin/banjir/zones/${zoneId}/camera-photo`, form);
    },
    { onSuccess: (r) => { setResult(r); onDone(); } },
  );
  return (
    <div className="rounded-lg border border-dashed border-ink-300 p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-700">
        <Camera className="size-4" aria-hidden /><Text>Upload a drain photo (a CCTV stand-in)</Text>
        {reader ? <Badge tone="brand"><Text>{`Read by ${READER_NAME[reader]}`}</Text></Badge> : <Badge><Text>No reader set up</Text></Badge>}
      </p>
      {reader ? (
        <>
          <p className="mt-1 text-xs text-ink-500"><Text>A photo of the measuring post, as a CCTV camera would take it. The reading becomes this zone’s camera signal; the rules decide what it means. The photo is not stored.</Text> <Text>{PHOTO_HINT}</Text>.</p>
          <LocalizedInput
            ref={input}
            type="file"
            accept={PHOTO_ACCEPT}
            disabled={upload.pending}
            onChange={(event) => {
              const file = pickPhoto(event.target);
              if (file) void upload.run(file).finally(() => { if (input.current) input.current.value = ''; });
            }}
            className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
          {upload.pending && <p className="mt-2 text-sm text-ink-600" aria-live="polite"><Text>Reading the photo…</Text></p>}
          {result && !upload.pending && (
            <p className={cn('mt-2 rounded-md px-3 py-2 text-sm', result.trusted ? 'bg-success-50 text-success-700' : 'bg-ink-50 text-ink-600')} aria-live="polite">
              <Text>{result.reading.levelPct === null ? 'The reader could not see the water line.' : `Read as ${result.reading.levelPct}%, ${Math.round(result.reading.confidence * 100)}% sure.`}</Text>{' '}
              <Text>{result.trusted ? 'Used as the camera signal.' : 'Too unsure: recorded, but not trusted as a signal.'}</Text>
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs text-ink-500"><Text>To read real photos, set AI_PROVIDER (hosted AI) or FLOOD_MODEL_URL (your own model, such as a CNN) in the server settings. Until then, use the test pictures above.</Text></p>
      )}
    </div>
  );
}

/** One zone in the agent queue: its signals, the draft waiting for the officer, the test controls and the timeline. */
export function ZoneAgent({ zone, agent, onChange }: { zone: AgentZone; agent: Agent; onChange: () => void }) {
  const [sensor, setSensor] = useState(zone.assessment.readings.find((r) => r.source === 'SENSOR')?.levelPct ?? zone.level_pct);
  const [what, setWhat] = useState(zone.draft?.what ?? '');
  const [todo, setTodo] = useState(zone.draft?.todo ?? '');
  const [reason, setReason] = useState('');
  const signal = useAction((body: Record<string, unknown>) => api.post(`/admin/banjir/zones/${zone.id}/signals`, body), { onSuccess: onChange });
  const edited = Boolean(zone.draft && ((what && what !== zone.draft.what) || (todo && todo !== zone.draft.todo)));
  const decide = useAction(
    (action: 'SEND' | 'CANCEL') =>
      api.post(`/admin/banjir/drafts/${zone.draft!.id}`, {
        action,
        ...(action === 'SEND' && edited ? { what: what || undefined, todo: todo || undefined } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    { onSuccess: onChange, success: 'Done. It is on the timeline.' },
  );
  const [manual, setManual] = useState(String(zone.level_pct));
  const override = useAction(() => api.post<{ status: FloodStatus; changed: boolean }>(`/admin/banjir/zones/${zone.id}/level`, { levelPct: Number(manual) }), {
    onSuccess: onChange,
    success: (r) => (r.changed ? `${r.status === 'DANGER' ? 'Danger alert' : r.status === 'WARNING' ? 'Warning' : 'All clear'} sent to ${zone.name}.` : 'Level recorded. The status did not change.'),
  });
  const a = zone.assessment;
  const simulated = zone.sensors.filter((s) => s.simulated);
  const verdict =
    a.agreed !== 'NORMAL'
      ? `Two signals agree: ${a.agreed.toLowerCase()}.`
      : a.single !== 'NORMAL'
        ? `Only one signal shows ${a.single.toLowerCase()}. A person must confirm.`
        : a.safeAgreed
          ? 'Sensor and camera agree the water is normal.'
          : 'Watching. Nothing above normal.';

  return (
    <Card id={`zone-${zone.id}`} className={cn('scroll-mt-24', zone.status === 'DANGER' && 'border-accent-200', zone.status === 'WARNING' && 'border-warning-600/30')}>
      <CardHeader
        title={zone.name}
        description={`Updated ${timeAgo(zone.updated_at)}`}
        action={
          <span className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold tabular-nums"><CountUp value={zone.level_pct} format={(n) => `${n}%`} /></span>
            <FloodBadge status={zone.status} />
          </span>
        }
      />
      <div className="space-y-5 p-5">
        <LevelGauge level={zone.level_pct} status={zone.status} warningPct={agent.warningPct} dangerPct={agent.dangerPct} />
        <FloodTrend trend={zone.trend} />

        <div className="rounded-lg bg-ink-50 p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
            <Bot className="size-4 text-brand-700" aria-hidden /><Text>Agent: </Text><Text>{verdict}</Text>
            {a.rising && a.single !== 'NORMAL' && <Badge tone="warning"><Text>Rising</Text></Badge>}
            {a.risingFast && <Badge tone="danger"><TrendingUp className="size-3.5" aria-hidden /><Text>Rising fast</Text></Badge>}
          </p>
          {a.readings.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500"><Text>No fresh signals in the last 10 minutes.</Text></p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {a.readings.map((r) => (
                <li key={r.source} className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn(!r.trusted && 'text-ink-500 line-through decoration-ink-300')}>
                    <span className="font-medium"><Text>{FLOOD_SOURCE_LABELS[r.source]}</Text></span>: <SignalNote note={r.note} />
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-500">
                    <Text>{timeAgo(r.at)}</Text>
                    <FloodBadge status={r.level} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {zone.event && zone.event.sms > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-600">
              <MessageSquareText className="size-3.5" aria-hidden /><Text>{zone.event.sms}</Text><Text> danger SMS recorded for this event (simulated: no SMS provider in the prototype).</Text>
            </p>
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
            <Textarea
              label="Reason"
              hint="Needed to cancel the draft or change its words. Kept in the timeline (BR21)."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              error={decide.fields.reason}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant={zone.draft.level === 'DANGER' ? 'danger' : 'primary'} onClick={() => void decide.run('SEND')} pending={decide.pending} disabled={edited && reason.trim().length < 3}>
                <Send className="size-4" aria-hidden /><Text>{edited ? 'Send with my changes' : 'Send now'}</Text></Button>
              <Button variant="secondary" onClick={() => void decide.run('CANCEL')} disabled={decide.pending || reason.trim().length < 3}>
                <X className="size-4" aria-hidden /><Text>Cancel</Text></Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-900"><Text>Test signals</Text></p>
          <label className="block text-sm font-medium text-ink-700">
            <span className="flex items-center gap-1.5">
              <Gauge className="size-4" aria-hidden />
              <Text>{simulated.length ? ' Water level at the simulated sensors: ' : ' Drain water-level sensor: '}</Text><Text>{sensor}</Text>%
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
            {simulated.length > 0 && (
              <span className="block text-xs font-normal text-ink-500">
                <Text>{simulated.length}</Text><Text> simulated sensors send signed readings through the real ingestion endpoint: every 60 seconds, or every 15 above the warning line. A level counts once it holds for two readings.</Text>
              </span>
            )}
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
          <CameraPhoto zoneId={zone.id} reader={agent.integration.camera.photoReader} onDone={onChange} />
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
                  {typeof t.detail.reason === 'string' && t.detail.reason && <span className="block text-xs text-ink-600">“{String(t.detail.reason)}”</span>}
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
