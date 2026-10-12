'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, Cpu, Power, QrCode as QrIcon, Recycle, UserRound, XCircle } from 'lucide-react';
import { use, useState } from 'react';
import { SimulatedNote } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKg, rewardMessage } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { ActionRewardView } from '@/lib/types';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

interface Screen {
  machine: { id: string; name: string; status: 'ONLINE' | 'FULL' | 'OFFLINE'; kiosk: string; location: string };
  screen: { code: string; expiresInMs: number };
  session: null | {
    id: string;
    mode: 'SCREEN_QR' | 'MEMBER_QR' | 'GUEST';
    greeting: string | null;
    acceptedCount: number;
    rejectedCount: number;
    acceptedG: number;
    items: { seq: number; material: Material; weight_g: number; accepted: boolean; reason: string | null }[];
  };
}
interface Finished {
  acceptedCount: number;
  rejectedCount: number;
  acceptedG: number;
  reward: ActionRewardView | null;
  claimCode: string | null;
  claimDays: number | null;
}
type Outcome = 'ACCEPT' | 'WRONG_MATERIAL' | 'NOT_TAKEN';

/**
 * Prototype: the smart recycling machine's own screen, on a tablet. The buttons
 * on the right stand in for its camera, barcode reader and scale. Each item is
 * sent as a record signed with the machine's key, through the same checks a
 * real machine's records go through.
 */
export default function MachineScreenPage({ params }: { params: Promise<{ machineId: string }> }) {
  const { machineId } = use(params);
  const screen = useApi<Screen>(`/admin/kitar/machines/${machineId}/screen`, { refreshInterval: 2_000 });
  const [memberCode, setMemberCode] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('ACCEPT');
  const [finished, setFinished] = useState<Finished | null>(null);
  const refresh = () => void screen.mutate();

  const start = useAction((body: { mode: 'MEMBER_QR' | 'GUEST'; memberCode?: string }) => api.post(`/admin/kitar/machines/${machineId}/start`, body), {
    onSuccess: () => {
      setFinished(null);
      setMemberCode('');
      refresh();
    },
  });
  const drop = useAction((material: Material) => api.post<{ accepted: boolean; reason: string | null }>(`/admin/kitar/machines/${machineId}/items`, { material, outcome }), {
    onSuccess: refresh,
    success: (r) => (r.accepted ? null : `Not counted: ${r.reason}`),
  });
  const finish = useAction(() => api.post<Finished>(`/admin/kitar/machines/${machineId}/finish`), {
    onSuccess: (r) => {
      setFinished(r);
      refresh();
    },
  });
  const status = useAction((next: Screen['machine']['status']) => api.post(`/admin/kitar/machines/${machineId}/status`, { status: next }), { onSuccess: refresh, success: 'Machine status updated.' });

  return (
    <>
      <PageHeader title="Smart machine screen" description="What the recycling machine shows on its own screen. Open this on a tablet beside the kiosk for the demo." />
      <Async state={screen}>
        {(s) => {
          const joinUrl = `${window.location.origin}/app/kitar/machine?m=${s.machine.id}&c=${s.screen.code}`;
          return (
            <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
              <div className="overflow-hidden rounded-2xl border-8 border-ink-800 bg-gradient-to-b from-brand-900 to-brand-950 text-white shadow-lg">
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-3 text-sm">
                  <span className="flex items-center gap-2 font-semibold">
                    <Recycle className="size-4" aria-hidden />
                    {s.machine.name}
                  </span>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', s.machine.status === 'ONLINE' ? 'bg-success-600' : 'bg-warning-600')}><Text>{s.machine.status}</Text></span>
                </div>
                <div className="flex min-h-[26rem] flex-col items-center justify-center px-6 py-8 text-center">
                  {s.machine.status !== 'ONLINE' ? (
                    <>
                      <Power className="size-14 text-brand-200" aria-hidden />
                      <p className="mt-4 text-2xl font-bold"><Text>{s.machine.status === 'FULL' ? 'This machine is full' : 'Out of service'}</Text></p>
                      <p className="mt-2 text-brand-100"><Text>Please use the kiosk at </Text><Text>{s.machine.location}</Text>.</p>
                    </>
                  ) : s.session ? (
                    <>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-200"><Text>{s.session.mode === 'GUEST' ? 'Guest' : 'Recycling'}</Text></p>
                      <p className="mt-1 text-3xl font-bold"><Text>{s.session.greeting ? `Hello, ${s.session.greeting}!` : 'Hello, guest!'}</Text></p>
                      <p className="mt-2 text-brand-100"><Text>Drop your items in one by one.</Text></p>
                      <div className="mt-6 grid w-full max-w-sm grid-cols-3 gap-3">
                        {[
                          ['Accepted', String(s.session.acceptedCount)],
                          ['Returned', String(s.session.rejectedCount)],
                          ['Weight', formatKg(s.session.acceptedG)],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-white/10 p-3">
                            <p className="text-xs text-brand-200"><Text>{label}</Text></p>
                            <p className="font-display text-2xl font-bold tabular-nums"><Text>{value}</Text></p>
                          </div>
                        ))}
                      </div>
                      <ol className="mt-5 w-full max-w-sm space-y-1.5 text-left text-sm">
                        {s.session.items.slice(-5).map((item) => (
                          <li key={item.seq} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-1.5">
                            <span className="flex items-center gap-2">
                              {item.accepted ? <CheckCircle2 className="size-4 text-success-50" aria-hidden /> : <XCircle className="size-4 text-accent-200" aria-hidden />}
                              <Text>{MATERIAL_INFO[item.material].label}</Text>
                            </span>
                            <span className="tabular-nums text-brand-100"><Text>{item.accepted ? `${item.weight_g} g` : 'returned'}</Text></span>
                          </li>
                        ))}
                      </ol>
                      <Button variant="light" size="lg" className="mt-6" onClick={() => void finish.run()} pending={finish.pending}><Text>Finish</Text></Button>
                    </>
                  ) : finished ? (
                    <>
                      <CheckCircle2 className="size-14 text-success-50" aria-hidden />
                      <p className="mt-3 text-2xl font-bold"><Text>Thank you!</Text></p>
                      <p className="mt-1 text-brand-100">
                        <Text>{finished.acceptedCount}</Text><Text> item</Text><Text>{finished.acceptedCount === 1 ? '' : 's'}</Text> · <Text>{formatKg(finished.acceptedG)}</Text> · <Text>{finished.rejectedCount}</Text><Text> returned</Text></p>
                      {finished.claimCode ? (
                        <div className="mt-5 flex flex-col items-center gap-2 rounded-xl bg-white p-4 text-ink-900">
                          <QrCode value={finished.claimCode} size={150} label={`Claim code ${finished.claimCode}`} />
                          <p className="font-display text-2xl font-bold tracking-[0.2em]"><Text>{finished.claimCode}</Text></p>
                          <p className="max-w-[16rem] text-xs text-ink-600"><Text>Join SimeTown and claim this within </Text><Text>{finished.claimDays}</Text><Text> days for Impact XP.</Text></p>
                        </div>
                      ) : (
                        <p className="mt-4 max-w-sm rounded-lg bg-white/10 px-4 py-3 text-sm"><Text>{rewardMessage(finished.reward, 'Recorded in your SimeTown app.')}</Text></p>
                      )}
                      <Button variant="ghost" className="mt-5 text-white hover:bg-white/10" onClick={() => setFinished(null)}><Text>Next person</Text></Button>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold"><Text>Scan with SimeTown to start</Text></p>
                      <div className="mt-5 rounded-2xl bg-white p-3">
                        <QrCode value={joinUrl} size={210} label="Code to start recycling at this machine" />
                      </div>
                      <div className="mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/15" aria-hidden>
                        <div className="h-full bg-gold-300 transition-[width] duration-1000 ease-linear" style={{ width: `${Math.max(0, Math.min(100, (s.screen.expiresInMs / 30_000) * 100))}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-brand-200"><Text>A new code every 30 seconds</Text></p>
                      <div className="mt-6 flex flex-wrap justify-center gap-2 text-sm">
                        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
                          <QrIcon className="size-4" aria-hidden /><Text> Or show your SimeTown QR to the camera</Text></span>
                        <button type="button" onClick={() => void start.run({ mode: 'GUEST' })} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold hover:bg-white/20">
                          <UserRound className="size-4" aria-hidden /><Text> Recycle as guest</Text></button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <SimulatedNote><Text>The machine is simulated. These controls stand in for its camera, barcode reader and scale. The records they make, and the signature checks, are the ones a real machine’s would go through.</Text></SimulatedNote>
                <Card>
                  <CardHeader title="Camera: read a SimeTown QR" description="Stands in for the machine reading a resident’s code." />
                  <form
                    method="post"
                    className="flex flex-wrap items-end gap-3 p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void start.run({ mode: 'MEMBER_QR', memberCode: memberCode.trim() });
                    }}
                  >
                    <Input label="Member code" value={memberCode} onChange={(event) => setMemberCode(event.target.value.toUpperCase())} maxLength={12} autoComplete="off" className="min-w-0 flex-1 basis-40" error={start.fields.memberCode} />
                    <Button type="submit" disabled={memberCode.trim().length < 6 || Boolean(s.session)} pending={start.pending}><Text>Read code</Text></Button>
                  </form>
                </Card>
                <Card>
                  <CardHeader title="Drop an item" description="Camera, barcode and weight must agree, or the item is returned." action={<Badge tone={s.session ? 'success' : 'neutral'}><Text>{s.session ? 'Session open' : 'Start a session first'}</Text></Badge>} />
                  <div className="space-y-4 p-5">
                    <Select label="What the sensors report" value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
                      <option value="ACCEPT"><Text>All agree: item accepted</Text></option>
                      <option value="WRONG_MATERIAL"><Text>Camera sees a different material</Text></option>
                      <option value="NOT_TAKEN"><Text>Machine cannot take this item</Text></option>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      {MATERIALS.map((m) => (
                        <Button key={m} variant="secondary" size="sm" className="justify-start" disabled={!s.session || drop.pending} onClick={() => void drop.run(m)}>
                          <Cpu className="size-4" aria-hidden />
                          <Text>{MATERIAL_INFO[m].label}</Text>
                        </Button>
                      ))}
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Machine status" description="Bin-full and offline alerts go to township staff." />
                  <div className="flex flex-wrap gap-2 p-5">
                    {(['ONLINE', 'FULL', 'OFFLINE'] as const).map((st) => (
                      <Button key={st} size="sm" variant={s.machine.status === st ? 'primary' : 'secondary'} onClick={() => void status.run(st)} disabled={status.pending || s.machine.status === st}>
                        <Text>{st === 'ONLINE' ? 'Online' : st === 'FULL' ? 'Bin full' : 'Offline'}</Text>
                      </Button>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          );
        }}
      </Async>
    </>
  );
}
