'use client';

import { Text } from '@/components/ui/localized-text';
import { Archive, PackageCheck, Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CounterHandover } from '@/components/features/counter-handover';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Progress } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonForm, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useIsAdmin } from './overview';

export interface StorageLocation {
  id: string;
  name: string;
  kind: 'COUNTER' | 'PARCEL_ROOM';
  location: string;
  hours: string;
  instructions: string;
  capacity: number;
  held: number;
  incoming: number;
  accepts_deliveries: boolean;
  active: boolean;
}

interface Incoming {
  id: string;
  tracking_no: string;
  company: string;
  counter: string;
}

interface StoredParcel {
  id: string;
  tracking_no: string;
  company: string;
  recipient: string | null;
  house: string;
  state: 'RELOCATED_TO_STORAGE' | 'RETURN_PENDING';
  relocated_at: string | null;
  deadline_at: string | null;
  location_id: string;
  location: string;
  location_active: boolean;
}

/** Courier parcels explicitly redirected to a counter after a locker was full. */
export function DirectCounterDeliveries() {
  const incoming = useApi<Incoming[]>('/admin/lockers/storage/deliveries', { refreshInterval: 10_000 });
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(10);
  const receive = useAction((id: string) => api.post(`/admin/lockers/parcels/${id}/receive`), {
    success: 'Parcel received into storage. The household has its pickup code.',
    onSuccess: () => void incoming.mutate(),
  });
  const arriving = incoming.data ?? [];
  const q = query.trim().toLocaleLowerCase();
  const filtered = arriving.filter((parcel) => !q || [parcel.tracking_no, parcel.company, parcel.counter].some((value) => value.toLocaleLowerCase().includes(q)));

  if (incoming.data && arriving.length === 0) return null;

  return <Card>
    <CardHeader
      title="Courier drop-offs"
      description="A courier selected a counter because a locker was unavailable. Confirm receipt only after the courier hands the parcel to staff."
    />
    <Async state={incoming} skeleton={<SkeletonList rows={2} className="p-5" />}>
      {() => <>
            {arriving.length > 10 && <div className="border-b border-ink-100/80 px-5 py-4 sm:px-6"><SearchField label="Search counter deliveries" placeholder="Tracking, courier or destination" value={query} onChange={(value) => { setQuery(value); setVisible(10); }} /></div>}
            {filtered.length === 0
              ? <div className="px-5 py-4 text-sm text-ink-500"><Text>No matching counter deliveries.</Text></div>
              : <ul className="divide-y divide-ink-100">
            {filtered.slice(0, visible).map((parcel) => <li key={parcel.id} className="grid gap-3 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">{parcel.tracking_no}</p>
                <p className="mt-1 text-sm text-ink-500">{parcel.company} · <Text>Deliver to</Text> {parcel.counter}</p>
              </div>
              <Button size="sm" onClick={() => void receive.run(parcel.id)} pending={receive.pending}><Text>Confirm receipt</Text></Button>
            </li>)}
          </ul>}
          {visible < filtered.length && <div className="border-t border-ink-100 bg-ink-25 px-5 py-3 text-center"><Button size="sm" variant="ghost" onClick={() => setVisible((count) => count + 10)}><Text>Show 10 more</Text> <span className="text-ink-500">({filtered.length - visible})</span></Button></div>}
          </>}
    </Async>
  </Card>;
}

/** Resident handover and the complete, database-backed storage inventory. */
export function CounterTab() {
  const locations = useApi<StorageLocation[]>('/admin/lockers/overflow');
  const stored = useApi<StoredParcel[]>('/admin/lockers/storage/parcels', { refreshInterval: 10_000 });
  const [locationId, setLocationId] = useState('ALL');
  const [status, setStatus] = useState<'ALL' | StoredParcel['state']>('ALL');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState<Record<string, number>>({});
  const rows = stored.data ?? [];
  const q = query.trim().toLocaleLowerCase();
  const matching = rows.filter((parcel) => (status === 'ALL' || parcel.state === status)
    && (!q || [parcel.tracking_no, parcel.company, parcel.house, parcel.recipient].some((value) => value?.toLocaleLowerCase().includes(q))));
  const filtered = matching.filter((parcel) => locationId === 'ALL' || parcel.location_id === locationId);

  return <div className="space-y-6">
    <Async state={locations} skeleton={<SkeletonForm />}>
      {(places) => places.some((place) => place.active)
        ? <CounterHandover title="Verify pickup code" onDone={() => { void stored.mutate(); void locations.mutate(); }} />
        : <Card className="p-5"><EmptyState icon={PackageCheck} title="No active collection location"><Text>Ask an administrator to open a storage location before handing over a parcel.</Text></EmptyState></Card>}
    </Async>

    <Async state={locations} skeleton={<SkeletonList rows={1} />}>
      {(places) => <Async state={stored} skeleton={<SkeletonList rows={4} />}>
        {() => <section className="space-y-5">
          <div>
            <h2 className="font-display text-xl font-bold text-ink-900"><Text>Parcels awaiting collection</Text></h2>
            <p className="mt-1 text-sm text-ink-500"><Text>These parcels are stored at staffed locations and are waiting to be collected by residents.</Text></p>
          </div>
          <FilterBar
            search={<SearchField label="Search parcels" placeholder="Tracking number, resident, address or courier" value={query} onChange={setQuery} />}
            chips={<>
              <FilterChips label="Storage locations" value={locationId} onChange={setLocationId} options={[
                { key: 'ALL', label: 'All storage locations', count: matching.length },
                ...places.map((place) => ({ key: place.id, label: place.name, count: matching.filter((parcel) => parcel.location_id === place.id).length })),
              ]} />
              <div className="border-t border-ink-100/80 pt-3">
                <FilterChips<typeof status> label="Collection status" size="sm" value={status} onChange={setStatus} options={[
                  { key: 'ALL', label: 'All collection statuses' },
                  { key: 'RELOCATED_TO_STORAGE', label: 'Ready for collection', count: rows.filter((parcel) => parcel.state === 'RELOCATED_TO_STORAGE').length },
                  { key: 'RETURN_PENDING', label: 'Waiting for the courier to take back', count: rows.filter((parcel) => parcel.state === 'RETURN_PENDING').length },
                ]} />
              </div>
            </>}
            summary={<FilterSummary live shown={filtered.length} total={rows.length} noun="parcels in storage" onClear={locationId !== 'ALL' || status !== 'ALL' || q ? () => { setLocationId('ALL'); setStatus('ALL'); setQuery(''); } : undefined} />}
          />
          {places.length === 0
            ? <Card className="p-5"><EmptyState icon={Archive} title="No storage locations configured"><Text>Add a storage location under Manage before moving parcels out of lockers.</Text></EmptyState></Card>
            : <div className="space-y-5">
                  {places.filter((place) => locationId === 'ALL' || place.id === locationId).map((place) => {
                    const allAtPlace = rows.filter((parcel) => parcel.location_id === place.id);
                    const atPlace = filtered.filter((parcel) => parcel.location_id === place.id);
                    const limit = visible[place.id] ?? 10;
                    return <Card key={place.id} className={`overflow-hidden border-l-4 ${allAtPlace.length > 0 ? 'border-l-brand-500' : 'border-l-ink-200'}`}>
                      <section aria-labelledby={`storage-${place.id}`}>
                      <div className="flex flex-wrap items-center justify-between gap-5 px-5 py-5 sm:px-6">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${allAtPlace.length > 0 ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500'}`}><Store className="size-5" aria-hidden /></span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                            <h3 id={`storage-${place.id}`} className="font-display text-base font-bold text-ink-900">{place.name}</h3>
                            <Badge tone={place.active ? 'success' : 'neutral'}><Text>{place.active ? 'Open' : 'Closed'}</Text></Badge>
                            </div>
                            <p className="mt-1 text-sm text-ink-600">{place.location}</p>
                            <p className="mt-0.5 text-sm text-ink-500">{place.hours}</p>
                          </div>
                        </div>
                        <div className="w-full sm:w-48">
                          <div className="mb-2 flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-ink-800"><Text>{allAtPlace.length === 1 ? '1 parcel stored' : `${allAtPlace.length} parcels stored`}</Text></span>
                            <span className="text-xs text-ink-500"><Text>{`${place.capacity} capacity`}</Text></span>
                          </div>
                          <Progress value={allAtPlace.length} max={place.capacity} label="Storage occupancy" tone={allAtPlace.length >= place.capacity ? 'danger' : 'brand'} />
                        </div>
                      </div>
                      <div className="border-t border-ink-100">
                      {atPlace.length === 0
                        ? <div className="flex items-start gap-3 bg-ink-25/60 px-5 py-4 sm:px-6">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success-50 text-success-700"><PackageCheck className="size-4" aria-hidden /></span>
                            <div><p className="text-sm font-semibold text-ink-800"><Text>{allAtPlace.length > 0 ? 'No matching parcels' : 'No parcels awaiting collection'}</Text></p>
                            <p className="mt-0.5 text-sm text-ink-500"><Text>{allAtPlace.length > 0 ? 'Try a different tracking number, resident, address or courier.' : 'This storage location is clear.'}</Text></p></div>
                          </div>
                        : <>
                            <ul className="divide-y divide-ink-100">{atPlace.slice(0, limit).map((parcel) => <StoredParcelRow key={parcel.id} parcel={parcel} />)}</ul>
                            {limit < atPlace.length && <div className="border-t border-ink-100 bg-ink-25 px-5 py-3 text-center">
                              <Button size="sm" variant="ghost" onClick={() => setVisible((current) => ({ ...current, [place.id]: limit + 10 }))}><Text>Show 10 more</Text> <span className="text-ink-500">({atPlace.length - limit})</span></Button>
                            </div>}
                          </>}
                      </div>
                      </section>
                    </Card>;
                  })}
              </div>}
        </section>}
      </Async>}
    </Async>
  </div>;
}

function StoredParcelRow({ parcel }: { parcel: StoredParcel }) {
  return <li className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-900">{parcel.tracking_no}</span>
        <Badge tone={parcel.state === 'RETURN_PENDING' ? 'warning' : 'success'}><Text>{parcel.state === 'RETURN_PENDING' ? 'Return pending' : 'Ready for collection'}</Text></Badge>
      </div>
      <p className="mt-1 text-sm text-ink-500">{parcel.company}{parcel.relocated_at && <> · <Text>{`Stored ${formatDateTime(parcel.relocated_at)}`}</Text></>}</p>
    </div>
    <div className="min-w-0 text-sm">
      <p className="font-medium text-ink-800"><Text>Resident</Text>: {parcel.recipient ?? <Text>Household member</Text>}</p>
      <p className="mt-1 text-ink-500">{parcel.house}</p>
    </div>
    {parcel.deadline_at && <div className="text-sm text-ink-500 lg:text-right"><Text>Collect by</Text><br /><span className="font-medium text-ink-800">{formatDateTime(parcel.deadline_at)}</span></div>}
  </li>;
}

/** Administrative setup, deliberately separated from daily parcel handling. */
export function StorageLocationsTab() {
  const locations = useApi<StorageLocation[]>('/admin/lockers/overflow');
  const [adding, setAdding] = useState(false);
  const isAdmin = useIsAdmin();
  const toggle = useAction((id: string, active: boolean) => api.post(`/admin/lockers/overflow/${id}/active`, { active }), { onSuccess: () => void locations.mutate() });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>Storage locations</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>Configure the staffed counters and secured rooms used when parcels leave a locker.</Text></p>
      </div>
      {isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add a location</Text></Button>}
    </div>
    <Card className="overflow-hidden">
      <Async state={locations} skeleton={<SkeletonList rows={3} className="p-5" />}>
        {(places) => places.length === 0
          ? <div className="p-5"><EmptyState icon={Store} title="No storage locations configured"><Text>Add the first staffed counter or secured parcel room.</Text></EmptyState></div>
          : <ul className="divide-y divide-ink-100">{places.map((place) => <li key={place.id} className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                  {place.name}
                  <Badge tone={place.active ? 'success' : 'neutral'}><Text>{place.active ? 'Open' : 'Closed'}</Text></Badge>
                  <Badge tone="neutral"><Text>{place.kind === 'COUNTER' ? 'Staffed counter' : 'Secured parcel room'}</Text></Badge>
                  {place.accepts_deliveries && <Badge tone="brand"><Text>Accepts redirected deliveries</Text></Badge>}
                </p>
                <p className="mt-1 text-sm text-ink-500">{place.location} · {place.hours}</p>
                <p className="mt-1 text-sm text-ink-600"><Text>{`${place.held} stored`}</Text>{place.incoming > 0 && <> · <Text>{`${place.incoming} incoming`}</Text></>} · <Text>{`${place.capacity} capacity`}</Text></p>
              </div>
              {isAdmin && <Button size="sm" variant="secondary" onClick={() => void toggle.run(place.id, !place.active)} disabled={toggle.pending}><Text>{place.active ? 'Close location' : 'Reopen location'}</Text></Button>}
            </li>)}</ul>}
      </Async>
    </Card>
    <AddStorageLocation open={adding} onClose={() => setAdding(false)} onAdded={() => void locations.mutate()} />
  </div>;
}

function AddStorageLocation({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const add = useAction((body: Record<string, unknown>) => api.post('/admin/lockers/overflow', body), {
    success: 'Storage location added.',
    onSuccess: () => { onAdded(); onClose(); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    void add.run({ name: value('name'), kind: value('kind'), location: value('location'), hours: value('hours'), instructions: value('instructions'), capacity: Number(value('capacity')), acceptsDeliveries: form.get('acceptsDeliveries') === 'on' });
  };
  return <Modal open={open} onClose={onClose} title="Add a storage location" description="Register a staffed counter or secured parcel room used by the locker storage workflow." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="add-storage-location" pending={add.pending}><Text>Add location</Text></Button></>}>
    <form method="post" id="add-storage-location" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Input label="Name" name="name" maxLength={80} required error={add.fields.name} />
      <Select label="Type" name="kind" defaultValue="COUNTER"><option value="COUNTER"><Text>Staffed counter</Text></option><option value="PARCEL_ROOM"><Text>Secured parcel room</Text></option></Select>
      <Input label="Location" name="location" maxLength={160} required className="sm:col-span-2" error={add.fields.location} />
      <Input label="Opening hours" name="hours" maxLength={120} required placeholder="e.g. Mon to Sat, 9am to 6pm" error={add.fields.hours} />
      <Input label="Capacity (parcels)" name="capacity" type="number" min={1} required error={add.fields.capacity} />
      <Textarea label="Collection instructions for residents" name="instructions" maxLength={300} required className="sm:col-span-2" placeholder="e.g. Bring your pickup code and IC or passport." error={add.fields.instructions} />
      <Checkbox label="Allow couriers to redirect parcels here when a locker cannot accept them" name="acceptsDeliveries" className="sm:col-span-2" />
    </form>
  </Modal>;
}
