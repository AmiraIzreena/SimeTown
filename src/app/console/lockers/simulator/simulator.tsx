'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowLeft, DoorClosed, DoorOpen, KeyRound, Power, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useAction, useApi } from '@/lib/hooks';
import { COMPARTMENT_STATE_LABELS, PARCEL_STATE_LABELS, type CompartmentState, type ParcelState } from '@/shared/lockers';

interface Compartment {
  id: string;
  label: string;
  size: string;
  state: CompartmentState;
  door: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  item_present: boolean | null;
  fault: string | null;
  sim_fail_next: boolean;
  tracking_no: string | null;
  parcel_state: ParcelState | null;
}
interface View {
  station: { id: string; name: string; code: string; status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE'; location: string };
  compartments: Compartment[];
  executed: { id: string; purpose: string; executed_at: string; compartment: string }[];
}

/** What the server made of a simulated door event. */
const OUTCOMES: Record<string, string> = {
  DEPOSITED: 'Deposit confirmed: the household has been told.',
  COLLECTED: 'Collection confirmed: the compartment is free again.',
  CLOSED_EMPTY: 'Door shut with nothing inside: not a delivery.',
  STILL_INSIDE: 'Door shut with the parcel still inside: not a collection.',
  UNEXPECTED_OPEN: 'Door opened without an unlock: staff have been alerted.',
  TAKEN_OUT: 'Taken out by staff under an approved exception: the compartment is free again.',
  OPENED: 'Door open.',
  CLOSED: 'Door shut.',
};

const STATE_STYLE: Record<CompartmentState, string> = {
  AVAILABLE: 'border-success-600/40 bg-success-50',
  RESERVED: 'border-gold-500/60 bg-gold-50',
  OCCUPIED: 'border-brand-600/50 bg-brand-50',
  FAULTY: 'border-accent-600/60 bg-accent-50',
  DISABLED: 'border-ink-300 bg-ink-100',
};

/**
 * The locker simulator stands in for a station's controller: every button
 * here sends the same door, sensor, fault and keypad events a real station
 * would, through the same server logic.
 */
export function Simulator({ stationId }: { stationId: string }) {
  const view = useApi<View>(stationId ? `/admin/lockers/simulator/${stationId}` : null, { refreshInterval: 1500 });
  const [selected, setSelected] = useState<string | null>(null);
  const [credential, setCredential] = useState('');
  const send = useAction((body: Record<string, unknown>) => api.post<{ outcome?: string; compartment?: string; opened?: boolean }>(`/admin/lockers/simulator/${stationId}`, body), {
    success: (r) => (r.compartment ? `Keypad accepted: door ${r.compartment} opens.` : r.outcome ? OUTCOMES[r.outcome] ?? null : r.opened === false ? 'The controller refused the replayed command. No door opened, and staff see an incident.' : null),
    onSuccess: () => void view.mutate(),
  });
  const admin = useAction((id: string, action: string) => api.post(`/admin/lockers/compartments/${id}`, { action }), { onSuccess: () => void view.mutate() });
  if (!stationId) return <EmptyState title="Choose a simulated station from the Smart lockers page" />;
  const c = view.data?.compartments.find((x) => x.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title={view.data ? `Simulator: ${view.data.station.name}` : 'Simulator'}
        description="This screen plays the locker hardware. Open and shut doors, put parcels in or take them out, jam a door, take the station offline, or type a PIN on the keypad. The server treats each event exactly as it would from a real station."
        action={<Button variant="secondary" href="/console/operations?tab=lockers"><ArrowLeft className="size-4" aria-hidden /><Text>Smart lockers</Text></Button>}
      />
      <Async state={view} skeleton={<SkeletonList rows={3} />}>
        {(v) => (
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-600"><Text>{`Station code ${v.station.code}`}</Text> · {v.station.location}</p>
                <Button
                  size="sm"
                  variant={v.station.status === 'ONLINE' ? 'secondary' : 'success'}
                  onClick={() => void send.run({ type: 'STATION', status: v.station.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE' })}
                  pending={send.pending}
                >
                  <Power className="size-4" aria-hidden /><Text>{v.station.status === 'ONLINE' ? 'Take the station offline' : 'Bring the station online'}</Text>
                </Button>
              </div>
              <div className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6', v.station.status !== 'ONLINE' && 'opacity-60')}>
                {v.compartments.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setSelected(x.id)}
                    aria-pressed={selected === x.id}
                    className={cn(
                      'relative flex flex-col items-start rounded-md border-2 p-2 text-left transition-shadow',
                      STATE_STYLE[x.state],
                      x.size === 'S' ? 'min-h-16' : x.size === 'M' ? 'min-h-24' : x.size === 'L' ? 'min-h-32' : 'min-h-40',
                      selected === x.id && 'ring-2 ring-brand-500 ring-offset-2',
                    )}
                  >
                    <span className="flex w-full items-center justify-between text-sm font-bold text-ink-900">{x.label}{x.door === 'OPEN' ? <DoorOpen className="size-4 text-brand-700" aria-label="Door open" /> : <DoorClosed className="size-4 text-ink-500" aria-label="Door shut" />}</span>
                    <span className="text-[11px] text-ink-600">{x.size} · <Text>{COMPARTMENT_STATE_LABELS[x.state]}</Text></span>
                    {x.tracking_no && <span className="mt-auto truncate text-[11px] font-medium text-ink-800">{x.tracking_no}</span>}
                    {x.sim_fail_next && <span className="text-[11px] font-semibold text-accent-700"><Text>Will jam</Text></span>}
                  </button>
                ))}
              </div>
              <ul className="mt-4 flex flex-wrap gap-3 text-xs text-ink-600">
                {(Object.keys(STATE_STYLE) as CompartmentState[]).map((s) => <li key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn('size-3 rounded-sm border-2', STATE_STYLE[s])} /><Text>{COMPARTMENT_STATE_LABELS[s]}</Text></li>)}
              </ul>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Keypad" description="What a resident types or scans at the station." />
                <form
                  method="post"
                  className="flex flex-wrap items-end gap-2 p-5"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void send.run({ type: 'KEYPAD', credential: credential.trim() }).then((r) => r && setCredential(''));
                  }}
                >
                  <Input label="PIN or QR text" value={credential} onChange={(event) => setCredential(event.target.value)} maxLength={120} autoComplete="off" className="min-w-0 flex-1 basis-40" />
                  <Button type="submit" disabled={credential.trim().length < 6} pending={send.pending}><KeyRound className="size-4" aria-hidden /><Text>Enter</Text></Button>
                </form>
              </Card>
              {view.data && view.data.executed.length > 0 && (
                <Card>
                  <CardHeader title="Replay a used command" description="What an attacker who captured an unlock command would try. The controller carries out each command once, so it refuses." />
                  <ul className="divide-y divide-ink-100">
                    {view.data.executed.map((k) => (
                      <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                        <span className="text-ink-700"><Text>{`Door ${k.compartment}`}</Text> · {k.purpose} · <span className="tabular-nums text-ink-500"><Text>{formatDateTime(k.executed_at)}</Text></span></span>
                        <Button size="sm" variant="ghost" onClick={() => void send.run({ type: 'REPLAY', commandId: k.id })} disabled={send.pending}><Text>Replay</Text></Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card>
                <CardHeader title={c ? `Door ${c.label}` : 'Choose a door'} description={c ? COMPARTMENT_STATE_LABELS[c.state] : 'Tap a compartment on the left.'} />
                {c && (
                  <div className="space-y-3 p-5">
                    {c.fault && <p className="text-sm text-accent-700"><Text>{c.fault}</Text></p>}
                    {c.parcel_state && <p className="text-sm text-ink-600">{c.tracking_no} · <Text>{PARCEL_STATE_LABELS[c.parcel_state]}</Text></p>}
                    <p className="text-sm text-ink-600"><Text>{c.door === 'OPEN' ? 'Door open' : c.door === 'CLOSED' ? 'Door shut' : 'Door state unknown'}</Text> · <Text>{c.item_present ? 'Something inside' : 'Empty'}</Text></p>
                    <div className="grid gap-2">
                      {c.door === 'OPEN' ? (
                        <>
                          <Button size="sm" onClick={() => void send.run({ type: 'DOOR', compartmentId: c.id, door: 'CLOSED', itemPresent: true })} pending={send.pending}><Text>Shut with a parcel inside</Text></Button>
                          <Button size="sm" variant="secondary" onClick={() => void send.run({ type: 'DOOR', compartmentId: c.id, door: 'CLOSED', itemPresent: false })} disabled={send.pending}><Text>Shut it empty</Text></Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void send.run({ type: 'DOOR', compartmentId: c.id, door: 'OPEN', itemPresent: Boolean(c.item_present) })} disabled={send.pending}><Text>Force the door open (no unlock)</Text></Button>
                      )}
                    </div>
                    <div className="grid gap-2 border-t border-ink-100 pt-3">
                      <Button size="sm" variant="secondary" onClick={() => void send.run({ type: 'FAIL_NEXT', compartmentId: c.id, on: !c.sim_fail_next })} disabled={send.pending}><Text>{c.sim_fail_next ? 'Stop the jam' : 'Jam the next unlock'}</Text></Button>
                      {c.state === 'AVAILABLE' && <Button size="sm" variant="secondary" onClick={() => void send.run({ type: 'FAULT', compartmentId: c.id, on: true })} disabled={send.pending}><Wrench className="size-4" aria-hidden /><Text>Report a fault</Text></Button>}
                      {c.state === 'FAULTY' && <Button size="sm" variant="secondary" onClick={() => void admin.run(c.id, 'CLEAR_FAULT')} disabled={admin.pending}><Text>Inspected: clear the fault</Text></Button>}
                      {c.state === 'AVAILABLE' && <Button size="sm" variant="ghost" onClick={() => void admin.run(c.id, 'DISABLE')} disabled={admin.pending}><Text>Take out of use</Text></Button>}
                      {c.state === 'DISABLED' && <Button size="sm" variant="ghost" onClick={() => void admin.run(c.id, 'ENABLE')} disabled={admin.pending}><Text>Bring back into use</Text></Button>}
                    </div>
                    <Badge tone="neutral"><Text>Simulated station</Text></Badge>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
