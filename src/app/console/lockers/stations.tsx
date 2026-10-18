'use client';

import { Text } from '@/components/ui/localized-text';

import { KeyRound, MonitorPlay, Plus, ScrollText, MapPin } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { LOCKER_SIZE_INFO, LOCKER_SIZES } from '@/shared/lockers';
import { useIsAdmin, type Overview } from './overview';

interface Log {
  commands: { id: string; purpose: string; status: string; error: string | null; created_at: string; compartment: string; requested_by: string | null }[];
  events: { type: string; source: string; payload: Record<string, unknown>; received_at: string }[];
}

export function StationsTab() {
  const data = useApi<Overview>('/admin/lockers');
  const isAdmin = useIsAdmin();
  const [adding, setAdding] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const status = useAction((id: string, s: string) => api.post(`/admin/lockers/stations/${id}/status`, { status: s }), { success: 'Station updated.', onSuccess: () => void data.mutate() });
  const rotate = useAction((id: string) => api.post<{ deviceSecret: string }>(`/admin/lockers/stations/${id}/secret`), { onSuccess: (r) => setSecret(r.deviceSecret) });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink-900"><Text>Locker stations</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Manage station availability and view device activity.</Text></p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add a station</Text></Button>}
      </div>
      <Async state={data} skeleton={<SkeletonList rows={2} />}>
        {(o) => o.stations.length === 0 ? <EmptyState title="No locker stations yet" /> : (
          <ul className="space-y-4">
            {o.stations.map((s) => (
              <li key={s.id}>
                <Card className="overflow-hidden">
                  <div className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words text-base font-semibold text-ink-900">{s.name}</h3>
                      <Badge tone={s.adapter === 'SIMULATED' ? 'neutral' : 'brand'}><Text>{s.adapter === 'SIMULATED' ? 'Simulated' : 'Hardware gateway'}</Text></Badge>
                    </div>
                    <p className="flex items-start gap-2 text-sm text-ink-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{s.location}</p>
                    <dl className="grid gap-4 text-sm sm:grid-cols-3">
                      <div><dt className="text-xs text-ink-500"><Text>Station code</Text></dt><dd className="mt-1 font-mono font-medium text-ink-800">{s.code}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Compartments</Text></dt><dd className="mt-1 font-medium tabular-nums text-ink-800">{s.total}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Last connected</Text></dt><dd className="mt-1 font-medium text-ink-800"><Text>{s.last_seen_at ? timeAgo(s.last_seen_at) : 'Not connected yet'}</Text></dd></div>
                    </dl>
                    <p className="break-all text-xs text-ink-500"><Text>Poster link: </Text>/locker/{s.code}</p>
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ink-100 bg-ink-50/60 px-5 py-4">
                    <Select label="Status" value={s.status} onChange={(event) => void status.run(s.id, event.target.value)} className="w-full sm:w-44">
                      <option value="ONLINE"><Text>Online</Text></option>
                      <option value="MAINTENANCE"><Text>Maintenance</Text></option>
                      <option value="OFFLINE"><Text>Offline</Text></option>
                    </Select>
                    <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setLog(s.id)}><ScrollText className="size-4" aria-hidden /><Text>Command log</Text></Button>
                    {s.adapter === 'SIMULATED' ? (
                      <Button size="sm" variant="secondary" href={`/console/lockers/simulator?station=${s.id}`}><MonitorPlay className="size-4" aria-hidden /><Text>Simulator</Text></Button>
                    ) : isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => void rotate.run(s.id)} pending={rotate.pending}><KeyRound className="size-4" aria-hidden /><Text>New device secret</Text></Button>
                    )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <AddStation open={adding} onClose={() => setAdding(false)} onAdded={(r) => { void data.mutate(); if (r) setSecret(r); }} />
      <CommandLog stationId={log} onClose={() => setLog(null)} />
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Device secret" description="Shown once. Put it in the station gateway’s configuration; it signs every message both ways.">
        <p className="break-all rounded-md bg-ink-50 p-3 font-mono text-sm text-ink-900">{secret}</p>
      </Modal>
    </div>
  );
}

function AddStation({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (secret: string | null) => void }) {
  const [adapter, setAdapter] = useState<'SIMULATED' | 'HTTP_GATEWAY'>('SIMULATED');
  const add = useAction((body: Record<string, unknown>) => api.post<{ deviceSecret: string | null }>('/admin/lockers/stations', body), {
    success: 'Station added.',
    onSuccess: (r) => {
      onAdded(r.deviceSecret);
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const n = (k: string) => Number(f.get(k) || 0);
    void add.run({
      name: String(f.get('name') ?? '').trim(), location: String(f.get('location') ?? '').trim(), adapter,
      gatewayUrl: adapter === 'HTTP_GATEWAY' ? String(f.get('gatewayUrl') ?? '').trim() : undefined,
      layout: { S: n('S'), M: n('M'), L: n('L'), XL: n('XL') }, hasDoorSensor: f.get('door') === 'on', hasPresenceSensor: f.get('presence') === 'on',
    });
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a locker station" wide footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="add-station" pending={add.pending}><Text>Add</Text></Button></>}>
      <form method="post" id="add-station" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" name="name" maxLength={80} required error={add.fields.name} />
        <Input label="Where" name="location" maxLength={160} required error={add.fields.location} />
        <Select label="Connection" value={adapter} onChange={(event) => setAdapter(event.target.value as typeof adapter)}>
          <option value="SIMULATED"><Text>Simulator (no hardware)</Text></option>
          <option value="HTTP_GATEWAY"><Text>Hardware through the SimeTown gateway</Text></option>
        </Select>
        {adapter === 'HTTP_GATEWAY' && <Input label="Gateway address" name="gatewayUrl" type="url" placeholder="https://gateway.example/locker-a" error={add.fields.gatewayUrl} />}
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>Compartments by size</Text></legend>
          <div className="grid gap-3 sm:grid-cols-4">
            {LOCKER_SIZES.map((s) => <Input key={s} label={`${LOCKER_SIZE_INFO[s].label} (${s})`} name={s} type="number" min={0} max={200} defaultValue={s === 'S' ? 10 : s === 'M' ? 6 : s === 'L' ? 3 : 1} />)}
          </div>
        </fieldset>
        <Checkbox label="Has door sensors" name="door" defaultChecked />
        <Checkbox label="Has parcel presence sensors" name="presence" defaultChecked />
      </form>
    </Modal>
  );
}

function CommandLog({ stationId, onClose }: { stationId: string | null; onClose: () => void }) {
  const log = useApi<Log>(stationId ? `/admin/lockers/stations/${stationId}/commands` : null, { refreshInterval: 5_000 });
  return (
    <Modal open={stationId !== null} onClose={onClose} title="Command log" description="The last 50 door commands and station messages." wide>
      {log.data && (
        <div className="space-y-4 text-sm">
          <ul className="space-y-1 text-ink-700">
            {log.data.commands.map((c) => (
              <li key={c.id}><span className="tabular-nums text-ink-500"><Text>{formatDateTime(c.created_at)}</Text></span> · {c.compartment} · {c.purpose} · <strong>{c.status}</strong>{c.requested_by && ` · ${c.requested_by}`}{c.error && <> · <Text>{c.error}</Text></>}</li>
            ))}
          </ul>
          <ul className="space-y-1 text-ink-600">
            {log.data.events.map((e, i) => <li key={i}><span className="tabular-nums text-ink-500"><Text>{formatDateTime(e.received_at)}</Text></span> · {e.source} · {e.type}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
