'use client';

import { Text } from '@/components/ui/localized-text';

import { Cpu, MonitorSmartphone, Plus, Printer, QrCode as QrIcon, Route } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatKg, formatKm, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

type Tab = 'machines' | 'kiosks' | 'loops' | 'patrol';
interface Machine {
  id: string;
  name: string;
  status: 'ONLINE' | 'FULL' | 'OFFLINE';
  last_seen_at: string | null;
  kiosk: string;
  sessions_today: number;
  grams_today: number;
}
interface PatrolPoint {
  id: string;
  seq: number;
  name: string;
  code: string;
}
interface Kiosk {
  id: string;
  name: string;
  location: string;
  code: string;
  total_g: number;
}
interface Loop {
  id: string;
  name: string;
  description: string;
  mode: 'WALK' | 'CYCLE';
  distance_m: number;
  checkpoints: { id: string; seq: number; name: string; code: string }[];
}
/** A poster to print: the QR opens the app with the code filled in. */
interface Poster {
  title: string;
  subtitle: string;
  code: string;
  path: string;
}

export default function PlacesPage() {
  const [tab, setTab] = useState<Tab>('machines');
  const [poster, setPoster] = useState<Poster | null>(null);
  return (
    <>
      <PageHeader title="Kiosks, bins & trails" description="Kiosk bins, kiosks, trail checkpoints and patrol points. Each printed code proves someone was there." />
      <Tabs<Tab>
        label="Places"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'machines', label: 'Kiosk bins' },
          { key: 'kiosks', label: 'Kitar kiosks' },
          { key: 'loops', label: 'Gerak loops' },
          { key: 'patrol', label: 'Patrol points' },
        ]}
      />
      <TabPanel>
        {tab === 'machines' ? (
          <Machines />
        ) : tab === 'kiosks' ? (
          <Kiosks onPoster={setPoster} />
        ) : tab === 'loops' ? (
          <Loops onPoster={setPoster} />
        ) : (
          <Patrol onPoster={setPoster} />
        )}
      </TabPanel>

      <Modal open={poster !== null} onClose={() => setPoster(null)} title={poster?.title ?? ''} description={poster?.subtitle}>
        {poster && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <QrCode value={`${window.location.origin}${poster.path}${poster.code}`} label={`QR code for ${poster.title}`} size={240} />
            <p className="font-display text-3xl font-bold tracking-[0.18em] text-ink-900"><Text>{poster.code}</Text></p>
            <p className="text-sm text-ink-500"><Text>Scan with your phone camera, or type the code in SimeTown.</Text></p>
            <Button variant="secondary" className="no-print" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /><Text>Print poster</Text></Button>
          </div>
        )}
      </Modal>
    </>
  );
}

function Kiosks({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const kiosks = useApi<Kiosk[]>('/admin/kitar/kiosks');
  const create = useAction((body: { name: string; location: string }) => api.post('/admin/kitar/kiosks', body), { success: 'Kiosk added.', onSuccess: () => void kiosks.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = Object.fromEntries(new FormData(element)) as Record<string, string>;
    void create.run({ name: form.name!, location: form.location! }).then((ok) => ok && element.reset());
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add a kiosk" />
        <form method="post" onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-start" noValidate>
          <Input label="Name" name="name" maxLength={80} required error={create.fields.name} />
          <Input label="Where it is" name="location" maxLength={160} required error={create.fields.location} />
          <Button type="submit" pending={create.pending} className="sm:mt-[26px]">
            <Plus className="size-4" aria-hidden /><Text>Add</Text></Button>
        </form>
      </Card>
      <Async state={kiosks}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No kiosks yet"><Text>Add the first recycling kiosk above.</Text></EmptyState>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {list.map((k) => (
                <Card key={k.id} className="flex items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink-900">{k.name}</p>
                    <p className="text-sm text-ink-600"><Text>{k.location}</Text></p>
                    <p className="mt-1 text-sm text-ink-500"><Text>{formatKg(k.total_g)}</Text><Text> collected</Text></p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => onPoster({ title: k.name, subtitle: `Kitar recycling kiosk · ${k.location}`, code: k.code, path: '/app/kitar?kiosk=' })}>
                    <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
    </div>
  );
}

function Loops({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const loops = useApi<Loop[]>('/admin/gerak/loops');
  const [creating, setCreating] = useState(false);
  const create = useAction((body: Record<string, unknown>) => api.post('/admin/gerak/loops', body), {
    success: 'Loop created. Print a poster for each checkpoint.',
    onSuccess: () => {
      setCreating(false);
      void loops.mutate();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void create.run({
      name: form.name,
      description: form.description,
      mode: form.mode,
      distanceM: Math.round(Number(form.km) * 1000),
      checkpoints: (form.checkpoints ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
    });
  };
  const f = create.fields;
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /><Text>New loop</Text></Button>
      </div>
      <Async state={loops}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No loops yet" action={<Button onClick={() => setCreating(true)}><Text>New loop</Text></Button>}><Text>Create a walking or cycling loop with two or more checkpoints.</Text></EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {list.map((loop) => (
                <Card key={loop.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand"><Text>{loop.mode === 'CYCLE' ? 'Cycling' : 'Walking'}</Text></Badge>
                    <Badge><Text>{formatKm(loop.distance_m)}</Text></Badge>
                  </div>
                  <h2 className="mt-3 text-[17px] font-semibold">{loop.name}</h2>
                  <p className="mt-1 text-[15px] text-ink-600">{loop.description}</p>
                  <ol className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
                    {loop.checkpoints.map((cp) => (
                      <li key={cp.id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                        <span className="min-w-0 truncate">
                          <span className="mr-2 text-ink-500 tabular-nums"><Text>{cp.seq}</Text>.</span>
                          {cp.name}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => onPoster({ title: cp.name, subtitle: `${loop.name} · checkpoint ${cp.seq} of ${loop.checkpoints.length}`, code: cp.code, path: '/app/gerak?code=' })}>
                          <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
                      </li>
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          )
        }
      </Async>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New loop"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}><Text>Cancel</Text></Button>
            <Button type="submit" form="create-loop" pending={create.pending}><Text>Create loop</Text></Button>
          </>
        }
      >
        <form method="post" id="create-loop" onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Name" name="name" maxLength={80} required error={f.name} />
          <Textarea label="Description" name="description" maxLength={300} required error={f.description} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="For" name="mode" defaultValue="WALK">
              <option value="WALK"><Text>Walking</Text></option>
              <option value="CYCLE"><Text>Cycling</Text></option>
            </Select>
            <Input label="Distance (km)" name="km" type="number" min={0.1} max={100} step={0.1} required error={f.distanceM} />
          </div>
          <Textarea label="Checkpoints, one per line, in order" name="checkpoints" rows={4} required error={f.checkpoints} hint="Between 2 and 12. A resident must scan all of them on the same day." />
        </form>
      </Modal>
    </div>
  );
}

const MACHINE_TONE = { ONLINE: 'success', FULL: 'warning', OFFLINE: 'neutral' } as const;

function Machines() {
  const machines = useApi<Machine[]>('/admin/kitar/machines', { refreshInterval: 10_000 });
  return (
    <Async state={machines}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={Cpu} title="No kiosk bins yet"><Text>An admin puts a bin at a kiosk. Its signing key is made on the server and never shown here.</Text></EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {list.map((m) => (
              <Card key={m.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-md bg-brand-50 text-brand-700">
                    <Cpu className="size-5" aria-hidden />
                  </span>
                  <Badge tone={MACHINE_TONE[m.status]}><Text>{m.status === 'ONLINE' ? 'Online' : m.status === 'FULL' ? 'Bin full' : 'Offline'}</Text></Badge>
                </div>
                <p className="mt-3 text-[17px] font-semibold text-ink-900">{m.name}</p>
                <p className="text-sm text-ink-600"><Text>At </Text><Text>{m.kiosk}</Text><Text>{m.last_seen_at ? ` · last record ${timeAgo(m.last_seen_at)}` : ''}</Text></p>
                <p className="mt-2 text-sm text-ink-500"><Text>Last 24 hours: </Text><Text>{m.sessions_today}</Text><Text> session</Text><Text>{m.sessions_today === 1 ? '' : 's'}</Text> · <Text>{formatKg(m.grams_today)}</Text>
                </p>
                <Button href={`/console/machine/${m.id}`} variant="secondary" size="sm" className="mt-4">
                  <MonitorSmartphone className="size-4" aria-hidden /><Text>Open the bin screen</Text></Button>
              </Card>
            ))}
          </div>
        )
      }
    </Async>
  );
}

function Patrol({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const points = useApi<PatrolPoint[]>('/admin/patrol-points');
  return (
    <Async state={points}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={Route} title="No patrol points yet" />
        ) : (
          <Card>
            <ol className="divide-y divide-ink-100">
              {list.map((pt) => (
                <li key={pt.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                  <span>
                    <span className="mr-2 text-ink-500 tabular-nums"><Text>{pt.seq}</Text>.</span>
                    {pt.name}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => onPoster({ title: pt.name, subtitle: `Patrol point ${pt.seq}`, code: pt.code, path: '/guard?patrol=' })}>
                    <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
                </li>
              ))}
            </ol>
          </Card>
        )
      }
    </Async>
  );
}
