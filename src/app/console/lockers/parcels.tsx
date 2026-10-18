'use client';

import { Text } from '@/components/ui/localized-text';

import { Search } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EXCEPTION_LABELS } from './security';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

interface Row {
  id: string;
  tracking_no: string;
  size: string;
  state: ParcelState;
  registered_at: string;
  deadline_at: string | null;
  failure_reason: string | null;
  station: string;
  compartment: string | null;
  company: string;
  counter: string | null;
}
interface Detail {
  parcel: Row & { exception_note: string | null; overflow_location_id: string | null };
  events: { from_state: string | null; to_state: ParcelState; actor_kind: string; reason: string; at: string; actor: string | null }[];
  custody: { from_kind: string; from_ref: string | null; to_kind: string; to_ref: string | null; note: string | null; at: string; actor: string | null }[];
  commands: { purpose: string; status: string; error: string | null; created_at: string; acked_at: string | null; compartment: string }[];
}

export const STATE_TONE: Partial<Record<ParcelState, 'success' | 'warning' | 'danger' | 'gold' | 'brand' | 'neutral'>> = {
  READY_FOR_COLLECTION: 'success', COLLECTED: 'neutral', OVERDUE: 'warning', RELOCATION_PENDING: 'danger', RELOCATION_IN_PROGRESS: 'warning', RELOCATED_TO_STORAGE: 'gold',
  DELIVERY_FAILED: 'danger', RETURN_PENDING: 'warning', RETURNED: 'neutral', EXCEPTION: 'danger',
};
const CUSTODY: Record<string, string> = { COURIER: 'Courier', LOCKER: 'Locker', STAFF: 'Staff', OVERFLOW: 'Overflow storage', RESIDENT: 'Resident' };

/**
 * The sixteen states, grouped the way staff think about them. A parcel only exists
 * once the courier scans it at our locker; we never see it in transit.
 */
const STATE_GROUPS: { key: string; label: string; states: readonly ParcelState[] }[] = [
  { key: 'ACTION', label: 'Needs action', states: ['EXCEPTION', 'OVERDUE', 'RELOCATION_PENDING'] },
  // One courier visit at the station, usually under a minute. Anything left here is a stuck drop-off.
  { key: 'DROPOFF', label: 'Courier dropping off', states: ['REGISTERED', 'VERIFIED', 'LOCKER_RESERVED', 'DEPOSIT_IN_PROGRESS', 'DEPOSITED'] },
  { key: 'LOCKER', label: 'In the locker', states: ['READY_FOR_COLLECTION', 'COLLECTION_IN_PROGRESS'] },
  { key: 'COUNTER', label: 'At the counter', states: ['RELOCATION_IN_PROGRESS', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING'] },
  // Out of our hands: collected, taken back by the courier, or refused at the scan.
  { key: 'CLOSED', label: 'Closed', states: ['COLLECTED', 'RETURNED', 'DELIVERY_FAILED'] },
];

export function ParcelsTab() {
  const [group, setGroup] = useState<string>('ALL');
  const [state, setState] = useState<ParcelState | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const [open, setOpen] = useState<string | null>(null);
  const active = STATE_GROUPS.find((g) => g.key === group);
  const states = state !== 'ALL' ? [state] : active?.states ?? [];
  const params = new URLSearchParams({ ...(states.length ? { state: states.join(',') } : {}), ...(search ? { q: search } : {}) }).toString();
  const list = useApi<Row[]>(`/admin/lockers/parcels${params ? `?${params}` : ''}`, { refreshInterval: 10_000, keepPreviousData: true });
  const filtered = group !== 'ALL' || q.trim() !== '';
  const pickGroup = (key: string) => {
    setGroup(key);
    setState('ALL');
  };
  return (
    <div className="space-y-4">
      <FilterBar
        search={<SearchField label="Search by tracking number" value={q} onChange={setQ} maxLength={40} />}
        chips={<>
          <FilterChips label="Filter by state" value={group} onChange={pickGroup} options={[{ key: 'ALL', label: 'All' }, ...STATE_GROUPS.map((g) => ({ key: g.key, label: g.label }))]} />
          {active && active.states.length > 1 && (
            <div className="border-t border-ink-100/80 pt-3">
              <FilterChips<ParcelState | 'ALL'> label="Narrow down" size="sm" value={state} onChange={setState} options={[{ key: 'ALL', label: 'All' }, ...active.states.map((s) => ({ key: s, label: PARCEL_STATE_LABELS[s] }))]} />
            </div>
          )}
        </>}
        summary={list.data && <FilterSummary live shown={list.data.length} noun="parcels" onClear={filtered ? () => { pickGroup('ALL'); setQ(''); } : undefined} />}
      />
      <Async state={list} skeleton={<SkeletonList rows={4} />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={Search} title="No parcels match"><Text>Try another state or tracking number.</Text></EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <div aria-hidden className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9.5rem_11rem] gap-4 border-b border-ink-100/80 bg-ink-25/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 lg:grid">
                <span><Text>Parcel</Text></span><span><Text>Where</Text></span><span><Text>Registered</Text></span><span className="text-right"><Text>State</Text></span>
              </div>
              <ul className="ops-queue divide-y divide-ink-100/80">
                {rows.map((r, i) => (
                  <li key={r.id} style={{ '--i': Math.min(i, 12) } as CSSProperties} className="ops-row">
                    <button type="button" onClick={() => setOpen(r.id)} className="grid w-full gap-1.5 px-5 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9.5rem_11rem] lg:items-center lg:gap-4">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[14px] font-semibold text-ink-900">{r.tracking_no}</span>
                        <span className="block truncate text-xs text-ink-500">{r.company} · <Text>{`size ${r.size}`}</Text></span>
                      </span>
                      <span className="min-w-0 truncate text-sm text-ink-700">{r.counter ?? `${r.station}${r.compartment ? ` · ${r.compartment}` : ''}`}{r.failure_reason && <span className="block truncate text-xs text-ink-500"><Text>{r.failure_reason}</Text></span>}</span>
                      <span className="text-xs tabular-nums text-ink-500 lg:text-sm"><Text>{formatDateTime(r.registered_at)}</Text></span>
                      <span className="lg:text-right"><Badge tone={STATE_TONE[r.state] ?? 'brand'}><Text>{PARCEL_STATE_LABELS[r.state]}</Text></Badge></span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </Async>
      <ParcelDetail id={open} onClose={() => setOpen(null)} onChanged={() => void list.mutate()} />
    </div>
  );
}

function ParcelDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<Detail>(id ? `/admin/lockers/parcels/${id}` : null);
  const overflow = useApi<{ id: string; name: string; active: boolean }[]>(id ? '/admin/lockers/overflow' : null);
  const [note, setNote] = useState('');
  const [dest, setDest] = useState('');
  const act = useAction((path: string, body: unknown = {}) => api.post(`/admin/lockers/parcels/${id}/${path}`, body), {
    success: 'Done. The record is updated.',
    onSuccess: () => {
      onChanged();
      void detail.mutate();
    },
  });
  const [kind, setKind] = useState<string>('RETRIEVAL');
  const [why, setWhy] = useState('');
  const ask = useAction(() => api.post<{ status: string }>(`/admin/lockers/parcels/${id}/exception`, { kind, reason: why.trim() }), {
    success: (r) => (r.status === 'PENDING' ? 'Asked. A second admin must approve before the door opens.' : 'The door is opening.'),
    onSuccess: () => {
      setWhy('');
      onChanged();
      void detail.mutate();
    },
  });
  const takeOut = useAction(() => api.post(`/lockers/parcels/${id}/simulate-close`, { itemPresent: false }), { success: 'Taken out. The compartment is free again.', onSuccess: () => { onChanged(); void detail.mutate(); } });
  const p = detail.data?.parcel;
  const inLocker = p && ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'DEPOSIT_IN_PROGRESS', 'EXCEPTION'].includes(p.state) && p.compartment;
  return (
    <Modal open={id !== null} onClose={onClose} title={p ? p.tracking_no : ''} description={p ? `${p.company} · ${PARCEL_STATE_LABELS[p.state]}` : undefined} wide>
      {detail.data && p && (
        <div className="space-y-5">
          {p.exception_note && <p className="rounded-md bg-accent-50 p-3 text-sm text-accent-700">{p.exception_note}</p>}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>State history</Text></h3>
            <ol className="space-y-1.5 text-sm">
              {detail.data.events.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 text-ink-700">
                  <span className="tabular-nums text-ink-500"><Text>{formatDateTime(e.at)}</Text></span>
                  <strong><Text>{PARCEL_STATE_LABELS[e.to_state]}</Text></strong>
                  <span>· <Text>{e.reason}</Text></span>
                  <span className="text-ink-500">· {e.actor ?? <Text>{e.actor_kind === 'DEVICE' ? 'Station' : 'SimeTown'}</Text>}</span>
                </li>
              ))}
            </ol>
          </section>
          {detail.data.custody.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>Custody chain</Text></h3>
              <ol className="space-y-1.5 text-sm text-ink-700">
                {detail.data.custody.map((c, i) => (
                  <li key={i}>
                    <span className="tabular-nums text-ink-500"><Text>{formatDateTime(c.at)}</Text></span> · <Text>{CUSTODY[c.from_kind]}</Text> → <Text>{CUSTODY[c.to_kind]}</Text>{c.to_ref && c.to_kind !== 'RESIDENT' && c.to_kind !== 'STAFF' && ` (${c.to_ref})`}{c.actor && ` · ${c.actor}`}{c.note && <> · <Text>{c.note}</Text></>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {detail.data.commands.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink-900"><Text>Door commands</Text></h3>
              <ul className="space-y-1 text-sm text-ink-700">
                {detail.data.commands.map((c, i) => (
                  <li key={i}><span className="tabular-nums text-ink-500"><Text>{formatDateTime(c.created_at)}</Text></span> · {c.compartment} · {c.purpose} · <strong>{c.status}</strong>{c.error && <> · <Text>{c.error}</Text></>}</li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
            {p.state === 'VERIFIED' && p.overflow_location_id && <Button size="sm" onClick={() => void act.run('receive')} pending={act.pending}><Text>Received from the courier at the counter</Text></Button>}
            {p.state === 'RELOCATED_TO_STORAGE' && <Button size="sm" variant="secondary" onClick={() => void act.run('return')} pending={act.pending}><Text>Send back to the courier</Text></Button>}
            {p.state === 'RETURN_PENDING' && <Button size="sm" variant="secondary" onClick={() => void act.run('returned')} pending={act.pending}><Text>The courier has taken it back</Text></Button>}
          </div>
          {inLocker && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-4">
              <p className="text-sm font-semibold text-ink-900"><Text>Request staff access to this locker</Text></p>
              <p className="text-sm text-ink-600"><Text>Use this only when a parcel must be removed manually. Another administrator must approve the request. The resident’s current pickup code will be cancelled.</Text></p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Reason for opening" value={kind} onChange={(event) => setKind(event.target.value)}>
                  {Object.entries(EXCEPTION_LABELS).map(([k, label]) => <option key={k} value={k}><Text>{label}</Text></option>)}
                </Select>
                <Textarea label="Details" value={why} onChange={(event) => setWhy(event.target.value)} maxLength={300} />
              </div>
              <Button size="sm" variant="secondary" onClick={() => void ask.run()} pending={ask.pending} disabled={why.trim().length < 5}><Text>Request approval to open</Text></Button>
            </div>
          )}
          {p.state === 'EXCEPTION' && p.compartment && detail.data.commands.some((c) => c.purpose === 'EXCEPTION' && c.status === 'ACKED') && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-ink-50 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Simulated station</Text></span>
              <Button size="sm" onClick={() => void takeOut.run()} pending={takeOut.pending}><Text>Take the parcel out and shut the door</Text></Button>
            </div>
          )}
          {p.state === 'EXCEPTION' && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-4">
              <p className="text-sm font-semibold text-ink-900"><Text>Settle this exception (admins)</Text></p>
              <Textarea label="What happened" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
              <Select label="Found and placed in storage at" value={dest} onChange={(event) => setDest(event.target.value)}>
                <option value=""><Text>Not placed in storage</Text></option>
                {overflow.data?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!dest || note.trim().length < 3} onClick={() => void act.run('resolve', { outcome: 'RELOCATED_TO_STORAGE', note, overflowId: dest })}><Text>Placed in storage</Text></Button>
                <Button size="sm" variant="secondary" disabled={note.trim().length < 3} onClick={() => void act.run('resolve', { outcome: 'RETURN_PENDING', note })}><Text>Return to the courier</Text></Button>
                <Button size="sm" variant="secondary" disabled={note.trim().length < 3} onClick={() => void act.run('resolve', { outcome: 'COLLECTED', note })}><Text>Already with the household</Text></Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
