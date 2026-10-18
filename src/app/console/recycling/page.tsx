'use client';

import { Text } from '@/components/ui/localized-text';

import { Pause, Play, Plus, Recycle, Scale, Truck, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { COLLECTION_STATUS } from '@/components/features/collections';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { BarChart } from '@/components/ui/charts';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatKg, formatMonth } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

type Tab = 'queue' | 'collectors' | 'accepted';
interface Collection {
  id: string;
  materials: Material[];
  items: string;
  day: string;
  slot: 'MORNING' | 'AFTERNOON';
  status: keyof typeof COLLECTION_STATUS;
  weight_g: number | null;
  collector: string;
  house: string;
}
interface Collector {
  id: string;
  name: string;
  phone: string | null;
  materials: Material[];
  days: string;
  notes: string | null;
  active: boolean;
  collections: number;
  collected_g: number;
}
interface Stats {
  months: { month: string; acceptedG: number; kioskG: number; machineG: number; collectionG: number; rejectionPct: number | null }[];
  topRejections: { reason: string; n: number }[];
}

export default function RecyclingConsolePage() {
  const [tab, setTab] = useState<Tab>('queue');
  return (
    <>
      <PageHeader title="Recycling collections" description="Partner collectors, the collections residents booked, and how much material the township gets accepted each month." />
      <Tabs<Tab>
        label="Recycling"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'queue', label: 'Collections' },
          { key: 'collectors', label: 'Collectors' },
          { key: 'accepted', label: 'Material accepted' },
        ]}
      />
      <TabPanel>
        {tab === 'queue' && <Queue />}
        {tab === 'collectors' && <Collectors />}
        {tab === 'accepted' && <Accepted />}
      </TabPanel>
    </>
  );
}

function Queue() {
  const list = useApi<Collection[]>('/admin/kitar/collections', { refreshInterval: 30_000 });
  const [weighing, setWeighing] = useState<Collection | null>(null);
  const confirm = useAction((id: string) => api.post<{ passCode: string }>(`/admin/kitar/collections/${id}/confirm`), {
    success: (r) => `Confirmed. Gate pass ${r.passCode} made for the household.`,
    onSuccess: () => void list.mutate(),
  });
  const missed = useAction((id: string) => api.post(`/admin/kitar/collections/${id}/missed`), { success: 'Marked as missed. The household has been told.', onSuccess: () => void list.mutate() });
  const collected = useAction((id: string, weightG: number) => api.post(`/admin/kitar/collections/${id}/collected`, { weightG }), {
    success: 'Recorded. The household earns Impact XP.',
    onSuccess: () => {
      setWeighing(null);
      void list.mutate();
    },
  });
  const submitWeight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kg = Number(new FormData(event.currentTarget).get('kg'));
    if (kg > 0) void collected.run(weighing!.id, Math.round(kg * 1000));
  };
  return (
    <>
      <Async state={list} skeleton={<SkeletonList rows={3} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={Truck} title="No collections booked yet" />
          ) : (
            <ul className="space-y-3">
              {rows.map((x) => (
                <li key={x.id}>
                  <Card className={cn('flex flex-wrap items-center justify-between gap-4 p-5', !['REQUESTED', 'CONFIRMED'].includes(x.status) && 'opacity-75')}>
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                        {x.collector}
                        <Badge tone={COLLECTION_STATUS[x.status].tone}><Text>{COLLECTION_STATUS[x.status].label}</Text></Badge>
                      </p>
                      <p className="text-sm text-ink-600">
                        <Text>{formatDate(x.day)}</Text> · <Text>{x.slot === 'MORNING' ? 'Morning' : 'Afternoon'}</Text> · <Text>{x.house}</Text>
                      </p>
                      <p className="text-sm text-ink-500">
                        {x.materials.map((m) => <Text key={m}>{`${MATERIAL_INFO[m].label}. `}</Text>)}
                        {x.items}
                      </p>
                      {x.weight_g && <p className="text-sm text-success-700"><Text>{`${formatKg(x.weight_g)} collected`}</Text></p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {x.status === 'REQUESTED' && <Button size="sm" onClick={() => void confirm.run(x.id)} pending={confirm.pending}><Text>Confirm</Text></Button>}
                      {x.status === 'CONFIRMED' && <Button size="sm" variant="success" onClick={() => setWeighing(x)}><Scale className="size-4" aria-hidden /><Text>Record weight</Text></Button>}
                      {(x.status === 'REQUESTED' || x.status === 'CONFIRMED') && (
                        <Button size="sm" variant="ghost" onClick={() => void missed.run(x.id)} disabled={missed.pending}><XCircle className="size-4" aria-hidden /><Text>Did not happen</Text></Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      <Modal
        open={weighing !== null}
        onClose={() => setWeighing(null)}
        title="Record the collected weight"
        description="The collector’s weighed total. It earns the household Impact XP."
        footer={<><Button variant="secondary" onClick={() => setWeighing(null)}><Text>Cancel</Text></Button><Button type="submit" form="collection-weight" pending={collected.pending}><Text>Save</Text></Button></>}
      >
        <form method="post" id="collection-weight" onSubmit={submitWeight}>
          <Input label="Weight (kg)" name="kg" type="number" min={0.1} max={500} step={0.1} required />
        </form>
      </Modal>
    </>
  );
}

function Collectors() {
  const list = useApi<Collector[]>('/admin/kitar/collectors');
  const [open, setOpen] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const create = useAction((body: Record<string, unknown>) => api.post('/admin/kitar/collectors', body), {
    success: 'Collector added. Residents can book them now.',
    onSuccess: () => {
      setOpen(false);
      setMaterials([]);
      void list.mutate();
    },
  });
  const toggleActive = useAction((id: string, active: boolean) => api.post(`/admin/kitar/collectors/${id}/active`, { active }), { onSuccess: () => void list.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void create.run({
      name: String(form.get('name') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim() || undefined,
      days: String(form.get('days') ?? '').trim(),
      notes: String(form.get('notes') ?? '').trim() || undefined,
      materials,
    });
  };
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /><Text>Add a collector</Text></Button>
      </div>
      <Async state={list} skeleton={<SkeletonList rows={3} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={Truck} title="No partner collectors yet" />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {rows.map((c) => (
                <li key={c.id}>
                  <Card className={cn('space-y-3 p-5', !c.active && 'opacity-70')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-display text-lg font-bold text-ink-900">{c.name}</p>
                        <p className="text-sm text-ink-500"><Text>{c.days}</Text>{c.phone && ` · ${c.phone}`}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive.run(c.id, !c.active)} disabled={toggleActive.pending}>
                        {c.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                        <Text>{c.active ? 'Pause' : 'Resume'}</Text>
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.materials.map((m) => <Badge key={m} tone="brand"><Text>{MATERIAL_INFO[m].label}</Text></Badge>)}
                    </div>
                    <p className="text-sm text-ink-600"><Text>{`${c.collections} collections · ${formatKg(c.collected_g)}`}</Text></p>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a collector"
        description="A licensed recycler or collector who comes to homes in the township."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}><Text>Cancel</Text></Button><Button type="submit" form="new-collector" pending={create.pending} disabled={materials.length === 0}><Text>Add</Text></Button></>}
      >
        <form method="post" id="new-collector" onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Name" name="name" maxLength={80} required error={create.fields.name} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Phone (optional)" name="phone" maxLength={30} />
            <Input label="When they come" name="days" maxLength={80} placeholder="e.g. Tue and Sat mornings" required error={create.fields.days} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>What they take</Text></legend>
            <div className="flex flex-wrap gap-2">
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={materials.includes(m)}
                  onClick={() => setMaterials((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
                  className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', materials.includes(m) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300')}
                >
                  <Text>{MATERIAL_INFO[m].label}</Text>
                </button>
              ))}
            </div>
          </fieldset>
          <Input label="Notes (optional)" name="notes" maxLength={200} />
        </form>
      </Modal>
    </>
  );
}

function Accepted() {
  const stats = useApi<Stats>('/admin/kitar/stats');
  return (
    <Async state={stats} skeleton={<SkeletonStats count={2} />}>
      {(s) => {
        const last = s.months[s.months.length - 1];
        const before = s.months[s.months.length - 2];
        const change = last && before && before.acceptedG > 0 ? Math.round(((last.acceptedG - before.acceptedG) / before.acceptedG) * 100) : null;
        return (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Accepted this month" value={last?.acceptedG ?? 0} format={formatKg} icon={Recycle} hint={change != null ? `${change >= 0 ? '+' : ''}${change}% on last month` : 'Kiosks, machines and collections'} />
              <Stat label="Machine rejection rate" value={last?.rejectionPct != null ? `${last.rejectionPct}%` : '–'} icon={XCircle} tone="warning" hint="Items the smart machines turned away" />
              <Stat label="Collected from homes this month" value={last?.collectionG ?? 0} format={formatKg} icon={Truck} tone="gold" />
            </div>
            <Card>
              <CardHeader title="Material accepted by month" description="The brief’s test: more material accepted for recycling." />
              <div className="p-5">
                <BarChart
                  label="Kilograms accepted by month"
                  data={s.months.map((m) => ({ label: formatMonth(m.month), values: [Math.round(m.kioskG / 1000), Math.round(m.machineG / 1000), Math.round(m.collectionG / 1000)] }))}
                  series={[
                    { name: 'Kiosks (kg)', className: 'bg-brand-600' },
                    { name: 'Smart machines (kg)', className: 'bg-gold-500' },
                    { name: 'Collections (kg)', className: 'bg-success-600' },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Why machines turned items away" description="Last 90 days. Use these to improve the guide and the signs at each machine." />
              {s.topRejections.length === 0 ? (
                <div className="p-5"><EmptyState icon={XCircle} title="No items turned away" /></div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {s.topRejections.map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                      <span className="text-ink-800"><Text>{r.reason}</Text></span>
                      <span className="font-semibold tabular-nums text-ink-900">{r.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </Async>
  );
}
