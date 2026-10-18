'use client';

import { Text } from '@/components/ui/localized-text';
import { DoorOpen, Plus, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { useIsAdmin, type Overview } from './overview';

interface ExceptionRequest {
  id: string; kind: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DONE' | 'CANCELLED'; requested_at: string; decided_at: string | null; decision_note: string | null;
  tracking_no: string; parcel_state: string; station: string; compartment: string; requested_by: string; requested_by_id: string; decided_by: string | null; command_status: string | null;
}
interface ParcelOption { id: string; tracking_no: string; state: string; station: string; compartment: string | null; company: string }
interface AccessSessionItem { id: string; parcel_id: string; status: 'PENDING' | 'OPENED' | 'COMPLETED' | 'CANCELLED'; tracking_no: string; compartment: string; command_status: string | null }
interface AccessSession {
  id: string; station_id: string; station: string; reason: string; status: 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  requested_by: string; requested_by_name: string; requested_at: string; decided_by_name: string | null; decided_at: string | null; expires_at: string | null; canOperate: boolean; items: AccessSessionItem[];
}

export const EXCEPTION_LABELS: Record<string, string> = {
  WRONG_COMPARTMENT: 'Wrong compartment', WRONG_RECIPIENT: 'Wrong household', INTERRUPTED_DEPOSIT: 'Interrupted deposit', RETRIEVAL: 'Remove parcel manually',
  DAMAGED: 'Damaged parcel', SUSPECTED_THEFT: 'Suspected theft', HARDWARE: 'Hardware fault', UNCOLLECTED: 'Uncollected parcel',
};
const REQUEST_STATUS = {
  PENDING: { label: 'Waiting for a second admin', tone: 'gold' as const }, APPROVED: { label: 'Approved: door opening', tone: 'brand' as const },
  REJECTED: { label: 'Rejected', tone: 'neutral' as const }, DONE: { label: 'Done: parcel taken out', tone: 'success' as const }, CANCELLED: { label: 'Cancelled', tone: 'neutral' as const },
};
const SESSION_STATUS = {
  PENDING: { label: 'Waiting for a second admin', tone: 'gold' as const }, APPROVED: { label: 'Approved: not started', tone: 'brand' as const },
  ACTIVE: { label: 'In progress', tone: 'warning' as const }, COMPLETED: { label: 'Completed', tone: 'success' as const },
  REJECTED: { label: 'Rejected', tone: 'neutral' as const }, EXPIRED: { label: 'Expired', tone: 'neutral' as const }, CANCELLED: { label: 'Cancelled', tone: 'neutral' as const },
};

/** Emergency-only access: one parcel request, or one controlled multi-parcel session. */
export function SecurityTab() {
  const exceptions = useApi<ExceptionRequest[]>('/admin/lockers/exceptions', { refreshInterval: 15_000 });
  const sessions = useApi<AccessSession[]>('/admin/lockers/access-sessions', { refreshInterval: 15_000 });
  const me = useApi<Me>('/me');
  const isAdmin = useIsAdmin();
  const [reporting, setReporting] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [scans, setScans] = useState<Record<string, string>>({});
  const decide = useAction((id: string, approve: boolean) => api.post<{ status: string }>(`/admin/lockers/exceptions/${id}/decision`, { approve }), {
    success: (result: { status: string }) => (result.status === 'APPROVED' ? 'Approved. The door is opening for the staff member.' : 'Rejected.'),
    onSuccess: () => void exceptions.mutate(),
  });
  const decideSession = useAction((id: string, approve: boolean) => api.post(`/admin/lockers/access-sessions/${id}/decision`, { approve }), {
    success: 'Decision recorded. No door was opened.', onSuccess: () => void sessions.mutate(),
  });
  const openItem = useAction((sessionId: string, itemId: string) => api.post(`/admin/lockers/access-sessions/${sessionId}/items/${itemId}/open`, { idempotencyKey: crypto.randomUUID() }), {
    success: 'Door command sent. Remove and scan this parcel before continuing.', onSuccess: () => void sessions.mutate(),
  });
  const completeItem = useAction((sessionId: string, itemId: string) => api.post(`/admin/lockers/access-sessions/${sessionId}/items/${itemId}/complete`, { trackingNo: scans[itemId] ?? '' }), {
    success: 'Parcel confirmed.', onSuccess: () => void sessions.mutate(),
  });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>Emergency door access</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>Use this only when the normal parcel or storage process cannot be completed. For routine overdue parcels, use Parcel movement.</Text></p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" href="/console/operations?tab=lockers&view=parcels"><Text>Request one door opening</Text></Button>
        <Button size="sm" onClick={() => setStartingSession(true)}><Plus className="size-4" aria-hidden /><Text>Start a maintenance access session</Text></Button>
        <Button size="sm" variant="ghost" onClick={() => setReporting(true)}><Text>Report a locker problem</Text></Button>
      </div>
    </div>

    <Card className="flex items-start gap-3 border-brand-200 bg-brand-50/60 p-5">
      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
      <div><p className="font-semibold text-ink-900"><Text>Normal work does not need emergency approval</Text></p>
        <p className="mt-1 text-sm text-ink-600"><Text>Move overdue parcels through Parcel movement. Use a maintenance session only when several occupied doors must be opened because of the same fault or incident.</Text></p></div>
    </Card>

    <Card className="overflow-hidden">
      <CardHeader title="Maintenance access sessions" description="One second-admin approval covers the selected parcels for 30 minutes. Doors still open one at a time, and each removed parcel must be scanned." />
      <Async state={sessions} skeleton={<div className="p-5"><SkeletonList rows={2} /></div>}>
        {(rows) => rows.length === 0 ? (
          <div className="p-5"><EmptyState icon={DoorOpen} title="No maintenance access sessions"><Text>Start one only when several parcels are affected by the same problem.</Text></EmptyState></div>
        ) : <ul className="divide-y divide-ink-100">
          {rows.map((session) => {
            const next = session.items.find((item) => item.status === 'PENDING');
            return <li key={session.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">{session.station}<Badge tone={SESSION_STATUS[session.status].tone}><Text>{SESSION_STATUS[session.status].label}</Text></Badge></p>
                  <p className="text-sm text-ink-700">{session.reason}</p>
                  <p className="text-xs text-ink-500"><Text>{`Requested by ${session.requested_by_name}, ${formatDateTime(session.requested_at)}`}</Text>{session.expires_at && session.status !== 'COMPLETED' && <> · <Text>{`expires ${formatDateTime(session.expires_at)}`}</Text></>}</p>
                </div>
                {session.status === 'PENDING' && isAdmin && me.data?.id !== session.requested_by && <div className="flex gap-2">
                  <Button size="sm" onClick={() => void decideSession.run(session.id, true)} pending={decideSession.pending}><Text>Approve session</Text></Button>
                  <Button size="sm" variant="ghost" onClick={() => void decideSession.run(session.id, false)} disabled={decideSession.pending}><Text>Reject</Text></Button>
                </div>}
                {session.status === 'PENDING' && me.data?.id === session.requested_by && <p className="text-sm text-ink-500"><Text>Another admin must approve your session.</Text></p>}
              </div>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {session.items.map((item) => <li key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div><p className="font-mono text-sm font-semibold text-ink-900">{item.tracking_no}</p><p className="text-xs text-ink-500"><Text>{`Door ${item.compartment}`}</Text> · <Text>{item.status === 'PENDING' ? 'Waiting' : item.status === 'OPENED' ? 'Door opened: scan parcel' : item.status === 'COMPLETED' ? 'Parcel confirmed' : 'Cancelled'}</Text></p></div>
                  {session.canOperate && (session.status === 'APPROVED' || session.status === 'ACTIVE') && item.status === 'PENDING' && <Button size="sm" variant="secondary" disabled={item.id !== next?.id || openItem.pending} onClick={() => void openItem.run(session.id, item.id)}><Text>Open this door</Text></Button>}
                  {session.canOperate && item.status === 'OPENED' && <div className="flex flex-wrap items-end gap-2">
                    <Input label="Scan tracking number" value={scans[item.id] ?? ''} onChange={(event) => setScans((current) => ({ ...current, [item.id]: event.target.value }))} className="min-w-56" />
                    <Button size="sm" disabled={!scans[item.id]?.trim()} pending={completeItem.pending} onClick={() => void completeItem.run(session.id, item.id)}><Text>Confirm parcel</Text></Button>
                  </div>}
                </li>)}
              </ul>
            </li>;
          })}
        </ul>}
      </Async>
    </Card>

    <Card>
      <CardHeader title="Exceptional door-opening requests" description="For one stuck, misplaced or unsafe parcel. Submit the request from Parcels; a second admin approves it before the door opens." />
      <Async state={exceptions} skeleton={<div className="p-5"><SkeletonList rows={2} /></div>}>
        {(rows) => rows.length === 0 ? <p className="p-5 text-sm text-ink-500"><Text>No exceptional door-opening requests.</Text></p> : (
          <ul className="divide-y divide-ink-100">{rows.map((request) => <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900"><Text>{EXCEPTION_LABELS[request.kind] ?? request.kind}</Text> <Badge tone={REQUEST_STATUS[request.status].tone}><Text>{REQUEST_STATUS[request.status].label}</Text></Badge></p>
              <p className="text-sm text-ink-700">{request.tracking_no} · {request.station} · <Text>{`door ${request.compartment}`}</Text> · {request.reason}</p>
              <p className="text-xs text-ink-500"><Text>{`Asked by ${request.requested_by}, ${formatDateTime(request.requested_at)}`}</Text>{request.decided_by && <> · <Text>{`decided by ${request.decided_by}`}</Text></>}</p>
            </div>
            {request.status === 'PENDING' && isAdmin && me.data?.id !== request.requested_by_id && <div className="flex gap-2">
              <Button size="sm" onClick={() => void decide.run(request.id, true)} pending={decide.pending}><Text>Approve and open</Text></Button>
              <Button size="sm" variant="ghost" onClick={() => void decide.run(request.id, false)} disabled={decide.pending}><Text>Reject</Text></Button>
            </div>}
            {request.status === 'PENDING' && me.data?.id === request.requested_by_id && <p className="text-sm text-ink-500"><Text>Another admin must approve your request.</Text></p>}
          </li>)}</ul>
        )}
      </Async>
    </Card>
    <Report open={reporting} onClose={() => setReporting(false)} onDone={() => undefined} />
    <NewAccessSession open={startingSession} onClose={() => setStartingSession(false)} onDone={() => void sessions.mutate()} />
  </div>;
}

function NewAccessSession({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const stations = useApi<Overview>(open ? '/admin/lockers' : null);
  const [stationId, setStationId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const parcels = useApi<ParcelOption[]>(open && stationId ? `/admin/lockers/parcels?stationId=${stationId}` : null);
  const eligible = (parcels.data ?? []).filter((parcel) => parcel.compartment && ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'DEPOSIT_IN_PROGRESS', 'EXCEPTION'].includes(parcel.state));
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = eligible.filter((parcel) => terms.every((term) => `${parcel.tracking_no} ${parcel.company} ${parcel.compartment}`.toLocaleLowerCase().includes(term)));
  const save = useAction(() => api.post('/admin/lockers/access-sessions', { stationId, parcelIds: selected, reason }), {
    success: 'Session requested. A second admin has been notified.',
    onSuccess: () => { setStationId(''); setSelected([]); setSearch(''); setReason(''); onClose(); onDone(); },
  });
  return <Modal open={open} onClose={onClose} wide title="Start a maintenance access session" description="Choose parcels affected by the same problem at one station. Approval lasts 30 minutes and does not open any door." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button disabled={!stationId || selected.length < 2 || reason.trim().length < 5} pending={save.pending} onClick={() => void save.run()}><Text>Request session approval</Text></Button></>}>
    <div className="space-y-4">
      <Async state={stations} skeleton={<SkeletonList rows={1} />}>
      {() => <Select label="Locker station" value={stationId} onChange={(event) => { setStationId(event.target.value); setSelected([]); }}>
        <option value=""><Text>Choose a locker station</Text></option>
        {stations.data?.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
      </Select>}
      </Async>
      <Textarea label="Why is emergency access needed?" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} required />
      {stationId && <>
        <SearchField label="Find affected parcels" placeholder="Tracking number, company or door" value={search} onChange={setSearch} />
        <p className="text-sm text-ink-500"><Text>{`${selected.length} parcels selected`}</Text></p>
        <Async state={parcels} skeleton={<SkeletonList rows={2} />}>
        {() => visible.length === 0 ? <EmptyState title="No eligible parcels at this station"><Text>Only parcels currently inside a locker can be selected.</Text></EmptyState> : <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-200">
          {visible.map((parcel) => <li key={parcel.id} className="p-3"><Checkbox checked={selected.includes(parcel.id)} onChange={() => setSelected((current) => current.includes(parcel.id) ? current.filter((id) => id !== parcel.id) : [...current, parcel.id])} label={<span><span className="font-mono font-semibold">{parcel.tracking_no}</span> · {parcel.company} · <Text>{`door ${parcel.compartment}`}</Text></span>} /></li>)}
        </ul>}
        </Async>
      </>}
    </div>
  </Modal>;
}

function Report({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const stations = useApi<Overview>('/admin/lockers');
  const save = useAction((body: Record<string, unknown>) => api.post('/admin/lockers/incidents', body), {
    success: 'Recorded.', onSuccess: () => { onClose(); onDone(); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.run({ summary: String(form.get('summary') ?? '').trim(), severity: form.get('severity'), stationId: String(form.get('stationId') ?? '') || undefined });
  };
  return <Modal open={open} onClose={onClose} title="Report a locker incident" footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="report-incident" pending={save.pending}><Text>Record</Text></Button></>}>
    <form method="post" id="report-incident" onSubmit={submit} className="grid gap-4" noValidate>
      <Textarea label="What happened" name="summary" maxLength={300} required error={save.fields.summary} />
      <Select label="Station (optional)" name="stationId" defaultValue=""><option value="">{' '}</option>{stations.data?.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</Select>
      <Select label="How serious" name="severity" defaultValue="MEDIUM"><option value="LOW"><Text>Low</Text></option><option value="MEDIUM"><Text>Medium</Text></option><option value="HIGH"><Text>High: tell staff now</Text></option></Select>
    </form>
  </Modal>;
}
