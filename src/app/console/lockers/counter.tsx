'use client';

import { Text } from '@/components/ui/localized-text';
import { Clock, Pencil, Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { refreshCounter, type CounterLocation } from '@/components/features/counter-parcels';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { formatHour } from '@/shared/lockers';
import { useIsAdmin } from './overview';

const OPENING_HOURS = Array.from({ length: 24 }, (_, h) => h);
const CLOSING_HOURS = Array.from({ length: 24 }, (_, h) => h + 1);

/** Setting up the guardhouse: its place, opening hours and room. Daily work is on the Guardhouse tab. */
export function StorageLocationsTab() {
  const locations = useApi<CounterLocation[]>('/admin/lockers/overflow');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CounterLocation | null>(null);
  const isAdmin = useIsAdmin();
  const toggle = useAction((id: string, active: boolean) => api.post(`/admin/lockers/overflow/${id}/active`, { active }), {
    success: 'Guardhouse updated.',
    onSuccess: () => void refreshCounter(),
  });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>Guardhouses</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>Where parcels are kept when they are not in a home’s locker door: left by a courier with the guard, or too big for the door. Couriers bring locker parcels only while it is open.</Text></p>
      </div>
      {isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add a guardhouse</Text></Button>}
    </div>
    <Card className="overflow-hidden">
      <Async state={locations} skeleton={<SkeletonList rows={2} className="p-5" />}>
        {(places) => places.length === 0
          ? <div className="p-5"><EmptyState icon={Store} title="No guardhouse set up"><Text>Add the guardhouse with its opening hours and room.</Text></EmptyState></div>
          : <ul className="divide-y divide-ink-100">{places.map((place) => <li key={place.id} className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                {place.name}
                {place.active
                  ? <Badge tone={place.open ? 'success' : 'neutral'}><Text>{place.status}</Text></Badge>
                  : <Badge tone="neutral"><Text>Not taking parcels</Text></Badge>}
                {place.accepts_deliveries && <Badge tone="brand"><Text>Takes couriers’ parcels</Text></Badge>}
              </p>
              <p className="mt-1 text-sm text-ink-500">{place.location}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-600"><Clock className="size-3.5 shrink-0 text-ink-400" aria-hidden /><Text>{place.hours}</Text></p>
              <p className="mt-1 text-sm text-ink-600"><Text>{`${place.held} waiting`}</Text>{place.incoming > 0 && <> · <Text>{`${place.incoming} on the way`}</Text></>} · <Text>{`room for ${place.capacity}`}</Text></p>
            </div>
            {isAdmin && <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button size="sm" variant="secondary" onClick={() => setEditing(place)}><Pencil className="size-4" aria-hidden /><Text>Edit hours and room</Text></Button>
              <Button size="sm" variant="ghost" onClick={() => void toggle.run(place.id, !place.active)} disabled={toggle.pending}><Text>{place.active ? 'Stop taking parcels' : 'Take parcels again'}</Text></Button>
            </div>}
          </li>)}</ul>}
      </Async>
    </Card>
    {!isAdmin && <p className="text-sm text-ink-500"><Text>Only a township admin can change a guardhouse.</Text></p>}
    <CounterForm open={adding} onClose={() => setAdding(false)} />
    <CounterForm open={editing !== null} counter={editing} onClose={() => setEditing(null)} />
  </div>;
}

function HourSelect({ label, name, hours, value, error }: { label: string; name: string; hours: number[]; value: number; error?: string }) {
  return <Select label={label} name={name} defaultValue={String(value)} error={error}>
    {hours.map((h) => <option key={h} value={h}><Text>{formatHour(h)}</Text></option>)}
  </Select>;
}

/** Add a counter, or change an existing one's hours, room and instructions. */
function CounterForm({ open, counter = null, onClose }: { open: boolean; counter?: CounterLocation | null; onClose: () => void }) {
  const editing = counter !== null;
  const save = useAction((body: Record<string, unknown>) => (editing ? api.patch(`/admin/lockers/overflow/${counter!.id}`, body) : api.post('/admin/lockers/overflow', body)), {
    success: editing ? 'Guardhouse updated.' : 'Guardhouse added.',
    onSuccess: () => { void refreshCounter(); onClose(); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    const shared = { openFromHour: Number(value('openFromHour')), openToHour: Number(value('openToHour')), capacity: Number(value('capacity')), instructions: value('instructions') };
    void save.run(editing ? shared : { ...shared, name: value('name'), kind: value('kind'), location: value('location'), acceptsDeliveries: form.get('acceptsDeliveries') === 'on' });
  };
  const formId = editing ? 'edit-counter' : 'add-counter';
  return <Modal open={open} onClose={onClose} title={editing ? `Edit ${counter!.name}` : 'Add a guardhouse'}
    description={editing ? 'Residents and couriers see the new hours at once.' : 'A staffed guardhouse that keeps parcels for households until they collect them.'}
    footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form={formId} pending={save.pending}><Text>{editing ? 'Save changes' : 'Add guardhouse'}</Text></Button></>}>
    {/* Re-mounted for each counter, so the fields start from its saved values. */}
    <form key={counter?.id ?? 'new'} method="post" id={formId} onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {!editing && <>
        <Input label="Name" name="name" maxLength={80} required placeholder="e.g. Main guardhouse" error={save.fields.name} />
        <Select label="Type" name="kind" defaultValue="COUNTER"><option value="COUNTER"><Text>Staffed counter</Text></option><option value="PARCEL_ROOM"><Text>Secured parcel room</Text></option></Select>
        <Input label="Where" name="location" maxLength={160} required className="sm:col-span-2" placeholder="e.g. Main guardhouse, Elmina entrance" error={save.fields.location} />
      </>}
      <HourSelect label="Opens at" name="openFromHour" hours={OPENING_HOURS} value={counter?.open_from_hour ?? 8} error={save.fields.openFromHour} />
      <HourSelect label="Closes at" name="openToHour" hours={CLOSING_HOURS} value={counter?.open_to_hour ?? 22} error={save.fields.openToHour} />
      <Input label="Room for (parcels)" name="capacity" type="number" min={1} max={5000} required defaultValue={counter?.capacity ?? 100} error={save.fields.capacity}
        hint="Staff and guards are told when it is 80% full." />
      <Textarea label="Collection instructions for residents" name="instructions" maxLength={300} required className="sm:col-span-2" defaultValue={counter?.instructions ?? 'Show your pickup code and your IC or passport.'} error={save.fields.instructions} />
      {!editing && <Checkbox label="Couriers can bring parcels here when a locker door cannot be used" name="acceptsDeliveries" defaultChecked className="sm:col-span-2" />}
    </form>
  </Modal>;
}
