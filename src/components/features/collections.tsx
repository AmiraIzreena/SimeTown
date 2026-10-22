'use client';

import { Text } from '@/components/ui/localized-text';
import { ScheduleText } from '@/components/features/collector-schedule';

import { Scale, Truck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatKg } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { BOOK_AHEAD_DAYS, openSlots } from '@/shared/collector-schedule';
import { MATERIALS, MATERIAL_INFO, type Material } from '@/shared/domain';

interface Collector {
  id: string;
  name: string;
  phone: string | null;
  materials: Material[];
  days: string;
  notes: string | null;
}
interface Collection {
  id: string;
  materials: Material[];
  items: string;
  day: string;
  slot: 'MORNING' | 'AFTERNOON';
  status: 'REQUESTED' | 'CONFIRMED' | 'COLLECTED' | 'CANCELLED' | 'MISSED';
  weight_g: number | null;
  collector: string;
  collector_phone: string | null;
  pass_code: string | null;
  gate_scanned: boolean;
  reported_weight_g: number | null;
  in_review: boolean;
  can_report: boolean;
  can_dispute: boolean;
  /** Local demos only: the demo steps are offered for this collection. */
  demo: boolean;
  is_today: boolean;
}

export const COLLECTION_STATUS = {
  REQUESTED: { label: 'Waiting for the collector', tone: 'gold' as const },
  CONFIRMED: { label: 'Confirmed', tone: 'brand' as const },
  COLLECTED: { label: 'Collected', tone: 'success' as const },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' as const },
  MISSED: { label: 'Did not happen', tone: 'warning' as const },
};
const SLOTS = { MORNING: 'Morning', AFTERNOON: 'Afternoon' } as const;

/** Tomorrow's date as the date picker writes it. */
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
};

/** "Tuesday, 27 October" for a YYYY-MM-DD day, in the shape the Malay translation reads. */
const dayLabel = (day: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
};

/**
 * Booked collections from partner collectors, for things too big or too
 * special for a kiosk. A booking is confirmed at once and the collector's gate
 * pass is made for the household. Once the gate scans the collector in, the
 * household types the weight here.
 */
export function Collections({ request }: { request: { material: Material; n: number } | null }) {
  const mine = useApi<Collection[]>('/kitar/collections');
  const [open, setOpen] = useState(false);
  const collectors = useApi<Collector[]>(open ? '/kitar/collectors' : null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [collectorId, setCollectorId] = useState('');
  const [day, setDay] = useState(tomorrow);
  const [slot, setSlot] = useState<'MORNING' | 'AFTERNOON'>('MORNING');
  // The collector comes first, then only the days and times they come. Null: their days are
  // older free text the system cannot read, so the household picks any day and time.
  const chosen = collectors.data?.find((c) => c.id === collectorId);
  const slots = chosen ? openSlots(chosen.days, tomorrow(), BOOK_AHEAD_DAYS) : null;
  const chooseCollector = (id: string) => {
    setCollectorId(id);
    const c = collectors.data?.find((x) => x.id === id);
    const first = c ? openSlots(c.days, tomorrow(), BOOK_AHEAD_DAYS)?.[0] : undefined;
    setDay(first?.day ?? tomorrow());
    setSlot(first?.slot ?? 'MORNING');
  };
  const [weighing, setWeighing] = useState<Collection | null>(null);
  // A tap on "Book a collection" in the guide opens the form with that material chosen.
  const [seen, setSeen] = useState(0);
  if (request && request.n !== seen) {
    setSeen(request.n);
    setMaterials([request.material]);
    setCollectorId('');
    setOpen(true);
  }
  const fitting = (collectors.data ?? []).filter((c) => materials.every((m) => c.materials.includes(m)));
  const book = useAction((body: Record<string, unknown>) => api.post('/kitar/collections', body), {
    success: 'Booked. The gate has the collector’s pass.',
    onSuccess: () => {
      setOpen(false);
      setMaterials([]);
      setCollectorId('');
      void mine.mutate();
    },
  });
  const cancel = useAction((id: string) => api.post(`/kitar/collections/${id}/cancel`), { success: 'Collection cancelled.', onSuccess: () => void mine.mutate() });
  const sendWeight = useAction((id: string, weightG: number) => api.post<{ status: 'COLLECTED' | 'IN_REVIEW' }>(`/kitar/collections/${id}/weight`, { weightG }), {
    success: (r) => (r.status === 'COLLECTED' ? 'Thank you. The weight is recorded.' : 'Thank you. The township office will check the weight.'),
    onSuccess: () => {
      setWeighing(null);
      void mine.mutate();
    },
  });
  // Local demos only: the server refuses these anywhere else.
  const demoToday = useAction((id: string) => api.post(`/kitar/collections/${id}/demo/today`), {
    success: 'Demo: the collection is now today.',
    onSuccess: () => void mine.mutate(),
  });
  const demoScan = useAction((id: string) => api.post(`/kitar/collections/${id}/demo/gate-scan`), {
    success: 'Demo: the gate has scanned the pass.',
    onSuccess: () => void mine.mutate(),
  });
  const came = useAction((id: string) => api.post(`/kitar/collections/${id}/came`), {
    success: 'Thank you. The township office will check and let you know.',
    onSuccess: () => void mine.mutate(),
  });
  const submitWeight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kg = Number(new FormData(event.currentTarget).get('kg'));
    if (kg > 0 && weighing) void sendWeight.run(weighing.id, Math.round(kg * 1000));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void book.run({
      collectorId,
      materials,
      items: String(form.get('items') ?? '').trim(),
      day,
      slot,
    });
  };
  const toggle = (m: Material) => {
    setMaterials((current) => (current.includes(m) ? current.filter((x) => x !== m) : [...current, m]));
    setCollectorId('');
  };

  return (
    <Card>
      <CardHeader
        title="Book a collection"
        description="An old fridge, a box of e-waste, a big load of paper? A partner collector comes to your home. The gate gets their pass as soon as you book."
        action={<Button size="sm" onClick={() => setOpen(true)}><Truck className="size-4" aria-hidden /><Text>Book</Text></Button>}
      />
      <Async state={mine} skeleton={<SkeletonList rows={1} className="p-5" />}>
        {(list) =>
          list.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Truck} title="No collections booked"><Text>Collected weight earns Impact XP, like a drop-off.</Text></EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {list.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink-900">
                      {x.collector} <span className="font-normal text-ink-500">· <Text>{formatDate(x.day)}</Text>, <Text>{SLOTS[x.slot]}</Text></span>
                    </p>
                    <p className="text-sm text-ink-500">
                      {x.materials.map((m) => <Text key={m}>{`${MATERIAL_INFO[m].label}. `}</Text>)}
                      {x.items}
                    </p>
                    {x.status === 'CONFIRMED' && x.pass_code && !x.gate_scanned && <p className="text-sm text-ink-600"><Text>{`Gate pass ${x.pass_code} is ready in Tamu.`}</Text></p>}
                    {x.status === 'COLLECTED' && x.weight_g && <p className="text-sm text-success-700"><Text>{`${formatKg(x.weight_g)} collected`}</Text></p>}
                    {x.in_review && <p className="text-sm text-ink-600"><Text>The township office is checking this collection.</Text></p>}
                    {x.can_report && x.gate_scanned && <p className="text-sm font-semibold text-ink-900"><Text>How much did they take?</Text></p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={x.in_review ? 'gold' : COLLECTION_STATUS[x.status].tone}><Text>{x.in_review ? 'Under review' : COLLECTION_STATUS[x.status].label}</Text></Badge>
                    {x.can_report && (
                      x.gate_scanned
                        ? <Button size="sm" onClick={() => setWeighing(x)}><Scale className="size-4" aria-hidden /><Text>Enter the weight</Text></Button>
                        : <Button size="sm" variant="ghost" onClick={() => setWeighing(x)}><Text>The collector came</Text></Button>
                    )}
                    {x.can_dispute && (
                      <Button size="sm" variant="ghost" onClick={() => void came.run(x.id)} disabled={came.pending}><Text>The collector came</Text></Button>
                    )}
                    {(x.status === 'REQUESTED' || x.status === 'CONFIRMED') && !x.gate_scanned && !x.in_review && (
                      <Button size="sm" variant="ghost" onClick={() => void cancel.run(x.id)} disabled={cancel.pending}><Text>Cancel</Text></Button>
                    )}
                  </div>
                  {x.demo && (
                    <div className="basis-full rounded-lg border border-dashed border-warning-600 bg-warning-50 px-3 py-2.5">
                      <p className="text-xs font-bold uppercase tracking-wide text-warning-700"><Text>Demo only</Text></p>
                      <p className="mt-0.5 text-xs text-warning-700"><Text>For local demos. Only the date and the gate scan are simulated. Everything after works as normal.</Text></p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void demoToday.run(x.id)} disabled={x.is_today || demoToday.pending}><Text>Move this collection to today</Text></Button>
                        <Button size="sm" variant="secondary" onClick={() => void demoScan.run(x.id)} disabled={!x.is_today || demoScan.pending}><Text>Pretend the gate scanned the pass</Text></Button>
                      </div>
                      {!x.is_today && <p className="mt-1.5 text-xs text-warning-700"><Text>Move it to today first. The gate only accepts the pass on the collection day.</Text></p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Async>

      <Modal
        open={weighing !== null}
        onClose={() => setWeighing(null)}
        title="How much did they take?"
        description={weighing?.gate_scanned ? 'Use the weight the collector told you.' : 'The gate did not record the collector, so the township office will check this weight first.'}
        footer={<><Button variant="secondary" onClick={() => setWeighing(null)}><Text>Cancel</Text></Button><Button type="submit" form="collection-weight" pending={sendWeight.pending}><Text>Send</Text></Button></>}
      >
        <form method="post" id="collection-weight" onSubmit={submitWeight}>
          <Input label="Weight (kg)" name="kg" type="number" min={0.1} max={500} step={0.1} required error={sendWeight.fields.weightG} hint="Small weights are recorded straight away. Large ones are checked by the township office first." />
        </form>
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Book a collection"
        description="Choose what you have, then a collector who takes it and a day they come."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}><Text>Cancel</Text></Button><Button type="submit" form="book-collection" pending={book.pending} disabled={materials.length === 0 || !collectorId || slots?.length === 0}><Text>Request collection</Text></Button></>}
      >
        <form method="post" id="book-collection" onSubmit={submit} className="space-y-4" noValidate>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>What is it?</Text></legend>
            <div className="flex flex-wrap gap-2">
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={materials.includes(m)}
                  onClick={() => toggle(m)}
                  className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', materials.includes(m) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300')}
                >
                  <Text>{MATERIAL_INFO[m].label}</Text>
                </button>
              ))}
            </div>
          </fieldset>
          <Select
            label="Collector" value={collectorId} onChange={(event) => chooseCollector(event.target.value)} error={book.fields.collectorId}
            hint={collectors.data && collectors.data.length === 0
              ? 'No partner collectors yet'
              : materials.length > 0 && fitting.length === 0 ? 'No collector takes all of these together. Book them separately.' : undefined}
          >
            <option value=""><Text>Choose…</Text></option>
            {fitting.map((c) => <option key={c.id} value={c.id}>{c.name} · <ScheduleText stored={c.days} /></option>)}
          </Select>
          {!chosen ? (
            <Select label="When" name="when" value="" disabled hint="Choose a collector first.">
              <option value=""><Text>Choose…</Text></option>
            </Select>
          ) : slots ? (
            <Select
              label="When" name="when" value={`${day} ${slot}`} error={book.fields.day}
              onChange={(event) => { const [d, s] = event.target.value.split(' '); setDay(d!); setSlot(s as 'MORNING' | 'AFTERNOON'); }}
              hint={slots.length === 0 ? 'This collector has no days free in the next 30 days.' : undefined}
            >
              {slots.map((o) => <option key={`${o.day} ${o.slot}`} value={`${o.day} ${o.slot}`}><Text>{dayLabel(o.day)}</Text> · <Text>{SLOTS[o.slot]}</Text></option>)}
            </Select>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-ink-600"><Text>Their days are not set in SimeTown yet. Choose a day and time they come.</Text></p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Day" name="day" type="date" min={tomorrow()} required error={book.fields.day} value={day} onChange={(event) => setDay(event.target.value)} />
                <Select label="Time" name="slot" value={slot} onChange={(event) => setSlot(event.target.value as 'MORNING' | 'AFTERNOON')}>
                  <option value="MORNING"><Text>Morning</Text></option>
                  <option value="AFTERNOON"><Text>Afternoon</Text></option>
                </Select>
              </div>
            </div>
          )}
          <Textarea label="What should they collect?" name="items" maxLength={300} placeholder="e.g. One old fridge, and two boxes of old cables" required error={book.fields.items} />
        </form>
      </Modal>
    </Card>
  );
}
