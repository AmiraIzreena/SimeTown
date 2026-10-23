'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { PackageCheck, Truck } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, SkeletonList } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

/**
 * Smart locker parcels at the guardhouse, shared by the guard's desk and the console: parcels couriers are
 * bringing because they could not go into the household's door, and notes on a locker parcel. Everything held at
 * the guardhouse is listed in the guardhouse register (guardhouse-register.tsx).
 */

export interface CounterLocation {
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
  open_from_hour: number;
  open_to_hour: number;
  open: boolean;
  status: string;
}

interface DropOff {
  id: string;
  tracking_no: string;
  company: string;
  location_id: string;
  counter: string;
  registered_at: string;
  reason: string | null;
  delivery_problem_note: string | null;
}

export interface HeldParcel {
  id: string;
  tracking_no: string;
  company: string;
  recipient: string | null;
  house: string;
  state: 'RELOCATED_TO_STORAGE' | 'RETURN_PENDING';
  ready_at: string | null;
  days: number;
  overdue: boolean;
  call_due: boolean;
  phone: string | null;
  reason: string | null;
  notes: number;
  last_note: string | null;
  location_id: string;
  location: string;
}

interface Note {
  id: string;
  body: string;
  created_at: string;
  author: string | null;
  author_role: string | null;
}

const LOCATIONS = '/admin/lockers/overflow';
const HELD = '/admin/lockers/storage/parcels';
const DROP_OFFS = '/admin/lockers/storage/deliveries';
/** After a change at the guardhouse, every view of it catches up. */
export const refreshCounter = () => Promise.all([mutate(LOCATIONS), mutate(HELD), mutate(DROP_OFFS), mutate((key) => typeof key === 'string' && key.startsWith('/admin/guardhouse'))]);

const ROLE_LABELS: Record<string, string> = { GUARD: 'Guard', GUARDHOUSE: 'Guardhouse staff', TOWNSHIP_STAFF: 'Township staff', TOWNSHIP_ADMIN: 'Township admin', HQ_ADMIN: 'HQ admin' };

/** Parcels a courier is bringing because they could not go into the home's door. Received only once handed over. */
export function CounterDropOffs() {
  const incoming = useApi<DropOff[]>(DROP_OFFS, { refreshInterval: 10_000 });
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(10);
  const receive = useAction((id: string) => api.post(`/admin/lockers/parcels/${id}/receive`), {
    success: 'Received. The household has been told, with their pickup code.',
    onSuccess: () => void refreshCounter(),
  });
  const arriving = incoming.data ?? [];
  const q = query.trim().toLocaleLowerCase();
  const filtered = arriving.filter((parcel) => !q || [parcel.tracking_no, parcel.company, parcel.counter].some((value) => value.toLocaleLowerCase().includes(q)));

  if (incoming.data && arriving.length === 0) return null;

  return <Card className="overflow-hidden border-l-4 border-l-gold-500">
    <CardHeader
      title="Courier drop-offs"
      description="Smart locker parcels a courier is bringing to the guardhouse because they could not go into the household’s door. Confirm receipt only once the parcel is in your hands."
    />
    <Async state={incoming} skeleton={<SkeletonList rows={2} className="p-5" />}>
      {() => <>
        {arriving.length > 10 && <div className="border-b border-ink-100/80 px-5 py-4 sm:px-6"><SearchField label="Search courier drop-offs" placeholder="Tracking number or courier" value={query} onChange={(value) => { setQuery(value); setVisible(10); }} /></div>}
        {filtered.length === 0
          ? <div className="px-5 py-4 text-sm text-ink-500"><Text>No matching drop-offs.</Text></div>
          : <ul className="ops-queue divide-y divide-ink-100">
            {filtered.slice(0, visible).map((parcel, i) => <li key={parcel.id} style={{ '--i': Math.min(i, 10) } as CSSProperties} className="ops-row grid gap-3 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-ink-900">{parcel.tracking_no}</span>
                  <Badge tone="gold"><Truck className="size-3" aria-hidden /><Text>On its way</Text></Badge>
                </p>
                <p className="mt-1 text-sm text-ink-600">{parcel.company} · <Text>{parcel.counter}</Text> · <Text>{`registered ${timeAgo(parcel.registered_at)}`}</Text></p>
                {parcel.reason && <p className="mt-1 text-sm text-ink-500"><Text>Why</Text>: <Text>{parcel.reason}</Text>{parcel.delivery_problem_note && <> · “{parcel.delivery_problem_note}”</>}</p>}
              </div>
              <Button size="sm" onClick={() => void receive.run(parcel.id)} pending={receive.pending}><PackageCheck className="size-4" aria-hidden /><Text>Confirm receipt</Text></Button>
            </li>)}
          </ul>}
        {visible < filtered.length && <div className="border-t border-ink-100 bg-ink-25 px-5 py-3 text-center"><Button size="sm" variant="ghost" onClick={() => setVisible((count) => count + 10)}><Text>Show 10 more</Text> <span className="text-ink-500">({filtered.length - visible})</span></Button></div>}
      </>}
    </Async>
  </Card>;
}

const SUGGESTIONS = ['Called: no answer.', 'Called: will collect soon.', 'Called: asked us to keep it for a few more days.'];

/** A parcel's notes, newest first, and a form to add one. Visible to staff and guards only. */
export function ParcelNotes({ parcel, onClose }: { parcel: Pick<HeldParcel, 'id' | 'tracking_no' | 'call_due'> | null; onClose: () => void }) {
  const notes = useApi<Note[]>(parcel ? `/admin/lockers/parcels/${parcel.id}/notes` : null);
  const [body, setBody] = useState('');
  const save = useAction((text: string) => api.post(`/admin/lockers/parcels/${parcel!.id}/notes`, { body: text }), {
    success: 'Note added to the parcel’s record.',
    onSuccess: () => { setBody(''); void notes.mutate(); void refreshCounter(); },
  });
  const close = () => { setBody(''); onClose(); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (body.trim()) void save.run(body.trim());
  };
  return <Modal open={parcel !== null} onClose={close} title={parcel ? `Notes · ${parcel.tracking_no}` : 'Notes'} description="Only staff and guards see these notes. Write what was done, for example after calling the household."
    footer={<><Button variant="secondary" onClick={close}><Text>Close</Text></Button><Button type="submit" form="parcel-note" pending={save.pending} disabled={!body.trim()}><Text>Save note</Text></Button></>}>
    <div className="space-y-5">
      <form id="parcel-note" method="post" onSubmit={submit} className="space-y-3" noValidate>
        <Textarea label="New note" value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} rows={3} error={save.fields.body} hint={`${body.length}/500`} />
        {parcel?.call_due && <LocalizedDiv className="flex flex-wrap gap-2" role="group" aria-label="Quick notes">
          {SUGGESTIONS.map((text) => <Button key={text} type="button" size="sm" variant="ghost" onClick={() => setBody(text)}><Text>{text}</Text></Button>)}
        </LocalizedDiv>}
      </form>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>Earlier notes</Text></h3>
        <Async state={notes} skeleton={<SkeletonList rows={2} />}>
          {(list) => list.length === 0
            ? <p className="text-sm text-ink-500"><Text>No notes yet.</Text></p>
            : <ol className="space-y-3">{list.map((note) => <li key={note.id} className="rounded-lg border border-ink-100 bg-ink-25/60 p-3">
              <p className="whitespace-pre-line text-sm text-ink-800">{note.body}</p>
              <p className="mt-1.5 text-xs text-ink-500">{note.author ?? <Text>Former staff member</Text>}{note.author_role && <> · <Text>{ROLE_LABELS[note.author_role] ?? note.author_role}</Text></>} · <Text>{formatDateTime(note.created_at)}</Text></p>
            </li>)}</ol>}
        </Async>
      </section>
    </div>
  </Modal>;
}
