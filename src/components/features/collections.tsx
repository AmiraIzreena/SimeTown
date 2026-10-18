'use client';

import { Text } from '@/components/ui/localized-text';

import { Truck } from 'lucide-react';
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

/**
 * Booked collections from partner collectors, for things too big or too
 * special for a kiosk. Once a collection is confirmed, the collector's gate
 * pass is made for the household automatically.
 */
export function Collections({ request }: { request: { material: Material; n: number } | null }) {
  const mine = useApi<Collection[]>('/kitar/collections');
  const collectors = useApi<Collector[]>('/kitar/collectors');
  const [open, setOpen] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [collectorId, setCollectorId] = useState('');
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
    success: 'Requested. You will be told when the collector confirms.',
    onSuccess: () => {
      setOpen(false);
      setMaterials([]);
      setCollectorId('');
      void mine.mutate();
    },
  });
  const cancel = useAction((id: string) => api.post(`/kitar/collections/${id}/cancel`), { success: 'Collection cancelled.', onSuccess: () => void mine.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void book.run({
      collectorId,
      materials,
      items: String(form.get('items') ?? '').trim(),
      day: String(form.get('day') ?? ''),
      slot: String(form.get('slot') ?? 'MORNING'),
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
        description="An old fridge, a box of e-waste, a big load of paper? A partner collector comes to your home. The gate gets their pass once they confirm."
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
                    {x.status === 'CONFIRMED' && x.pass_code && <p className="text-sm text-ink-600"><Text>{`Gate pass ${x.pass_code} is ready in Tamu.`}</Text></p>}
                    {x.status === 'COLLECTED' && x.weight_g && <p className="text-sm text-success-700"><Text>{`${formatKg(x.weight_g)} collected`}</Text></p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={COLLECTION_STATUS[x.status].tone}><Text>{COLLECTION_STATUS[x.status].label}</Text></Badge>
                    {(x.status === 'REQUESTED' || x.status === 'CONFIRMED') && (
                      <Button size="sm" variant="ghost" onClick={() => void cancel.run(x.id)} disabled={cancel.pending}><Text>Cancel</Text></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Async>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Book a collection"
        description="Choose what you have, then a collector who takes it."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}><Text>Cancel</Text></Button><Button type="submit" form="book-collection" pending={book.pending} disabled={materials.length === 0 || !collectorId}><Text>Request collection</Text></Button></>}
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
          <Select label="Collector" value={collectorId} onChange={(event) => setCollectorId(event.target.value)} error={book.fields.collectorId} hint={materials.length > 0 && fitting.length === 0 ? 'No collector takes all of these together. Book them separately.' : undefined}>
            <option value=""><Text>Choose…</Text></option>
            {fitting.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.days}</option>)}
          </Select>
          <Textarea label="What should they collect?" name="items" maxLength={300} placeholder="e.g. One old fridge, and two boxes of old cables" required error={book.fields.items} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Day" name="day" type="date" min={tomorrow()} defaultValue={tomorrow()} required error={book.fields.day} />
            <Select label="Time" name="slot" defaultValue="MORNING">
              <option value="MORNING"><Text>Morning</Text></option>
              <option value="AFTERNOON"><Text>Afternoon</Text></option>
            </Select>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
