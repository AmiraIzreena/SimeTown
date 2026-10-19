'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, ClipboardCheck, DoorOpen, HeartPulse, LogOut, Route, ScanLine, Siren, TriangleAlert, UserPlus, XCircle } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { AddressPicker } from '@/components/features/address';
import { CameraScan } from '@/components/features/camera-scan';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';

interface GateEntry {
  id: string;
  kind: 'PASS' | 'WALK_IN';
  visitor_name: string;
  vehicle_no: string | null;
  host_reply: 'EXPECTED' | 'NOT_EXPECTED' | 'CALL_ME' | null;
  entered_at: string;
  exited_at: string | null;
  pass_type: string | null;
  house: string;
}
interface GateOverview {
  township: string;
  gate: string | null;
  entries: GateEntry[];
  sos: { id: string; status: 'OPEN' | 'ACKNOWLEDGED'; created_at: string; full_name: string; phone: string | null; address: string }[];
  patrol: { id: string; seq: number; name: string; last_scan_today: string | null }[];
  floodTasks: { zone: string; level: 'WARNING' | 'DANGER'; task: string }[];
  helpTasks: { id: string; full_name: string; phone: string | null; note: string | null; reason: 'PRIORITY' | 'NEED_HELP'; zone_name: string; priority_note: string | null; address: string; created_at: string }[];
}
interface ScanResult {
  visitorName: string;
  vehicleNo: string | null;
  typeLabel: string;
  house: string;
}

const REPLY = {
  EXPECTED: { label: 'Expected', tone: 'success' as const },
  NOT_EXPECTED: { label: 'Not expected', tone: 'warning' as const },
  CALL_ME: { label: 'Call the host', tone: 'brand' as const },
};

export function GateScreen({ initialPatrol }: { initialPatrol: string }) {
  const me = useApi<Me>('/me');
  const gate = useApi<GateOverview>('/guard', { refreshInterval: 5_000 });
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: true; pass: ScanResult } | { ok: false; message: string } | null>(null);
  const [patrolCode, setPatrolCode] = useState(initialPatrol);

  const scan = useCallback(
    async (raw: string) => {
      setResult(null);
      try {
        const pass = await api.post<ScanResult>('/guard/scan', { code: raw.trim() });
        setResult({ ok: true, pass });
        setCode('');
        void gate.mutate();
      } catch (error) {
        setResult({ ok: false, message: error instanceof ApiError ? (error.status === 404 ? 'No such pass for this township.' : error.message) : 'Please try again.' });
      }
    },
    [gate],
  );
  const walkIn = useAction((body: { visitorName: string; vehicleNo?: string; homeId: string }) => api.post<{ house: string; notified: number }>('/guard/walk-ins', body), {
    onSuccess: () => void gate.mutate(),
    success: (r) => (r.notified ? `Logged. ${r.notified} resident${r.notified === 1 ? '' : 's'} at ${r.house} asked to reply.` : `Logged. Nobody at ${r.house} has the app: call the house.`),
  });
  const exit = useAction((id: string) => api.post(`/guard/entries/${id}/exit`), { onSuccess: () => void gate.mutate() });
  const reached = useAction((id: string) => api.post(`/banjir/help-tasks/${id}/reached`), { onSuccess: () => void gate.mutate(), success: 'Marked reached. The duty officer can see it.' });
  const sos = useAction((id: string, close: boolean) => api.post(`/guard/sos/${id}`, { close }), { onSuccess: () => void gate.mutate() });
  const patrol = useAction((value: string) => api.post<{ point: string }>('/guard/patrol', { code: value }), {
    onSuccess: () => {
      setPatrolCode('');
      void gate.mutate();
    },
    success: (r) => `${r.point}: checked.`,
  });

  const submitWalkIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const done = await walkIn.run({
      visitorName: String(form.get('visitorName') ?? '').trim(),
      vehicleNo: String(form.get('vehicleNo') ?? '').trim() || undefined,
      homeId: String(form.get('homeId') ?? ''),
    });
    if (done) formElement.reset();
  };

  return (
    <>
      <PageHeader title={gate.data?.gate ?? 'Main gate'} description="Scan visitor passes, log walk-ins and answer SOS calls. Record a name, vehicle number and house only: never an identity card." />
      <div className="space-y-6">
        {gate.data?.sos.map((s) => (
          <Card key={s.id} role="alert" className={cn('flex flex-wrap items-center justify-between gap-4 p-5', s.status === 'OPEN' ? 'border-accent-300 bg-accent-50' : 'border-warning-600/30 bg-warning-50')}>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-600 text-white">
                <Siren className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-display text-lg font-bold text-ink-900"><Text>SOS · </Text>{s.address}</p>
                <p className="text-sm text-ink-700">
                  {s.full_name}
                  {s.phone && ` · ${s.phone}`} · <Text>{timeAgo(s.created_at)}</Text> · <Text>{s.status === 'OPEN' ? 'waiting' : 'on the way'}</Text>
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {s.status === 'OPEN' && (
                <Button variant="danger" onClick={() => sos.run(s.id, false)} pending={sos.pending}><Text>On my way</Text></Button>
              )}
              <Button variant="secondary" onClick={() => sos.run(s.id, true)} disabled={sos.pending}><Text>Close</Text></Button>
            </div>
          </Card>
        ))}

        {gate.data?.helpTasks.map((task) => (
          <Card key={task.id} role="alert" className="flex flex-wrap items-center justify-between gap-4 border-accent-300 bg-accent-50 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-600 text-white">
                <HeartPulse className="size-5" aria-hidden />
              </span>
              <div className="text-sm text-ink-700">
                <p className="font-display text-lg font-bold text-ink-900"><Text>Reach </Text>{task.full_name}</p>
                <p>{task.address}{task.phone && <> · <a className="font-semibold text-brand-700 underline" href={`tel:${task.phone}`}>{task.phone}</a></>}</p>
                <p>
                  <Text>{task.zone_name}</Text> · <Text>{task.reason === 'NEED_HELP' ? 'Asked for help' : 'On the priority help list'}</Text> · <Text>{timeAgo(task.created_at)}</Text>
                </p>
                {task.priority_note && <p className="text-ink-600"><Text>{task.priority_note}</Text></p>}
                {task.note && <p className="font-medium text-ink-900"><Text>{task.note}</Text></p>}
              </div>
            </div>
            <Button variant="danger" onClick={() => void reached.run(task.id)} pending={reached.pending}><Text>Reached them</Text></Button>
          </Card>
        ))}

        {gate.data && gate.data.floodTasks.length > 0 && (
          <Card className="border-warning-600/30 bg-warning-50">
            <CardHeader title="Flood task list" description="While a flood warning is on." />
            <ul className="space-y-2 p-5 text-[15px] text-ink-800">
              {gate.data.floodTasks.map((task, i) => (
                <li key={i} className="flex items-start gap-2">
                  <TriangleAlert className={cn('mt-0.5 size-4 shrink-0', task.level === 'DANGER' ? 'text-accent-600' : 'text-warning-600')} aria-hidden />
                  <span>
                    <strong><Text>{task.zone}</Text>:</strong> <Text>{task.task}</Text>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Scan a visitor pass" description="Point the camera at the QR code, or type the code under it." />
            <div className="space-y-4 p-5">
              <CameraScan onCode={(text) => void scan(text)} />
              <form
                method="post"
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void scan(code);
                }}
              >
                <Input label="Pass code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. PAB12CD3" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={24} className="min-w-0 flex-1 basis-48" />
                <Button type="submit" disabled={code.trim().length < 6}>
                  <ScanLine className="size-4" aria-hidden /><Text>Check pass</Text></Button>
              </form>
              {result && (
                <div aria-live="polite" className={cn('animate-rise rounded-lg p-5', result.ok ? 'bg-success-50' : 'bg-accent-50')}>
                  {result.ok ? (
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="gate-result-icon size-8 shrink-0 text-success-700" aria-hidden />
                      <div>
                        <p className="font-display text-xl font-bold text-success-700"><Text>Let in: </Text>{result.pass.visitorName}</p>
                        <p className="text-[15px] text-ink-800">
                          <Text>{result.pass.typeLabel}</Text><Text> · to </Text><Text>{result.pass.house}</Text>
                          {result.pass.vehicleNo && ` · ${result.pass.vehicleNo}`}
                        </p>
                        <p className="mt-1 text-sm text-ink-600"><Text>The host has been told they arrived.</Text></p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <XCircle className="size-8 shrink-0 text-accent-600" aria-hidden />
                      <div>
                        <p className="font-display text-xl font-bold text-accent-700"><Text>Pass not valid</Text></p>
                        <p className="text-[15px] text-ink-800"><Text>{result.message}</Text><Text> Log them as a walk-in instead.</Text></p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Walk-in visitor" description="No pass? Record name, vehicle and house. The household replies in SimeTown." />
            <form method="post" onSubmit={submitWalkIn} className="space-y-4 p-5" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input name="visitorName" label="Visitor name" required maxLength={80} error={walkIn.fields.visitorName} />
                <Input name="vehicleNo" label="Vehicle number" maxLength={12} autoCapitalize="characters" error={walkIn.fields.vehicleNo} />
              </div>
              <AddressPicker key={me.data?.townshipId ?? 'none'} townshipId={me.data?.townshipId ?? null} error={walkIn.fields.homeId} />
              <Button type="submit" pending={walkIn.pending}>
                <UserPlus className="size-4" aria-hidden /><Text>Ask the household</Text></Button>
            </form>
          </Card>
        </div>

        <Card>
          <CardHeader title="Gate log, last 24 hours" description="Kept for 90 days, then deleted." />
          <Async state={gate} skeleton={<SkeletonList rows={3} className="p-5" />}>
            {(g) =>
              g.entries.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={DoorOpen} title="No visitors yet today" />
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {g.entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink-900">
                          {e.visitor_name} {e.vehicle_no && <span className="font-normal text-ink-500">· {e.vehicle_no}</span>}
                        </p>
                        <p className="text-sm text-ink-500">
                          <Text>{e.kind === 'PASS' ? 'Pass' : 'Walk-in'}</Text> · <Text>{e.house}</Text><Text> · in </Text><Text>{formatDateTime(e.entered_at)}</Text>
                          <Text>{e.exited_at && ` · out ${formatDateTime(e.exited_at)}`}</Text>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {e.kind === 'WALK_IN' && (e.host_reply ? <Badge tone={REPLY[e.host_reply].tone}><Text>{REPLY[e.host_reply].label}</Text></Badge> : <Badge tone="gold"><Text>Waiting for the host</Text></Badge>)}
                        {!e.exited_at && (
                          <Button size="sm" variant="secondary" onClick={() => exit.run(e.id)} disabled={exit.pending}>
                            <LogOut className="size-4" aria-hidden /><Text>Left</Text></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>

        <Card>
          <CardHeader title="Patrol round" description="Scan the code at each point on the round. Today’s checks are shown." />
          <div className="space-y-4 p-5">
            <Async state={gate}>
              {(g) => (
                <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {g.patrol.map((p) => (
                    <li key={p.id} className={cn('flex items-center gap-3 rounded-lg border p-3', p.last_scan_today ? 'border-success-600/30 bg-success-50' : 'border-ink-200')}>
                      {p.last_scan_today ? <ClipboardCheck className="size-5 text-success-700" aria-hidden /> : <Route className="size-5 text-ink-400" aria-hidden />}
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">
                          <Text>{p.seq}</Text>. {p.name}
                        </span>
                        <span className="block text-xs text-ink-500"><Text>{p.last_scan_today ? `Checked ${timeAgo(p.last_scan_today)}` : 'Not yet today'}</Text></span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Async>
            <form
              method="post"
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void patrol.run(patrolCode.trim());
              }}
            >
              <Input label="Patrol point code" value={patrolCode} onChange={(event) => setPatrolCode(event.target.value.toUpperCase())} autoComplete="off" maxLength={16} className="min-w-0 flex-1 basis-48" error={patrol.fields.code} />
              <Button type="submit" pending={patrol.pending} disabled={patrolCode.trim().length < 6}><Text>Check point</Text></Button>
            </form>
          </div>
        </Card>
      </div>
    </>
  );
}
