'use client';

import { Text } from '@/components/ui/localized-text';
import { CheckCircle2, DoorOpen, ScanLine, Truck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CameraScan } from '@/components/features/camera-scan';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { type Overview } from './overview';

export interface Task {
  id: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'CANCELLED';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  tracking_verified: boolean;
  parcel_id: string;
  tracking_no: string;
  deadline_at: string | null;
  station_id: string;
  station: string;
  adapter: 'SIMULATED' | 'HTTP_GATEWAY';
  has_sensors: boolean;
  compartment: string | null;
  company: string;
  destination: string | null;
  assigned: string | null;
  case_reference: string | null;
}
const STATUS = {
  OPEN: { label: 'Awaiting transfer', tone: 'danger' as const },
  IN_PROGRESS: { label: 'Transfer in progress', tone: 'warning' as const },
  DONE: { label: 'Transferred', tone: 'success' as const },
  FAILED: { label: 'Transfer stopped', tone: 'danger' as const },
  CANCELLED: { label: 'Collected first', tone: 'neutral' as const },
};
const BARCODES = ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix', 'pdf417'];
const STEPS = ['Choose storage & open locker', 'Scan and verify parcel', 'Close locker & confirm storage'];

export function RelocationsTab({ taskId, onClearTask }: { taskId?: string | null; onClearTask?: () => void }) {
  const tasks = useApi<Task[]>('/admin/lockers/relocations', { refreshInterval: 5_000 });
  const overview = useApi<Overview>('/admin/lockers', { refreshInterval: 10_000 });
  const overflow = useApi<{ id: string; name: string; capacity: number; held: number; incoming: number; active: boolean }[]>('/admin/lockers/overflow');
  const [stationId, setStationId] = useState('ALL');
  const [query, setQuery] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold text-ink-900"><Text>Parcels awaiting transfer</Text></h2>
        <p className="mt-1 text-sm text-ink-500"><Text>These parcels are still in locker compartments and must be transferred to a staffed storage location.</Text></p>
      </div>
      {taskId && <Button size="sm" variant="secondary" onClick={onClearTask}><Text>Show all transfers</Text></Button>}
      <Async state={overview} skeleton={<SkeletonList rows={1} />}>
        {(data) => data.stations.length === 0
          ? <EmptyState title="No locker stations yet"><Text>Add a station before creating parcel-transfer tasks.</Text></EmptyState>
          : <Async state={tasks} skeleton={<SkeletonList rows={3} />}>
              {(rows) => {
                if (taskId) {
                  const selected = rows.find((task) => task.id === taskId);
                  return selected
                    ? <ul><TaskCard task={selected} overflow={overflow.data ?? []} onChange={() => void tasks.mutate()} /></ul>
                    : <EmptyState icon={Truck} title="Transfer not found" />;
                }
                const activeRows = rows.filter((task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS');
                const shownStations = stationId === 'ALL'
                  ? [...data.stations].sort((a, b) => {
                      const aCount = activeRows.filter((task) => task.station_id === a.id).length;
                      const bCount = activeRows.filter((task) => task.station_id === b.id).length;
                      return Number(bCount > 0) - Number(aCount > 0) || a.name.localeCompare(b.name);
                    })
                  : data.stations.filter((station) => station.id === stationId);
                const stationRows = stationId === 'ALL' ? rows : rows.filter((task) => task.station_id === stationId);
                const history = stationRows.filter((task) => task.status !== 'OPEN' && task.status !== 'IN_PROGRESS' && matchesTask(task, query));
                return <div className="space-y-6">
                  <QueueToolbar stations={data.stations} activeTasks={activeRows} selected={stationId} onSelect={(id) => { setStationId(id); setExpandedTaskId(null); }} query={query} onQuery={setQuery} />
                  <section>
                    <h2 className="mb-4 font-display text-lg font-bold text-ink-900"><Text>Locker stations</Text></h2>
                    <div className="space-y-7">
                      {shownStations.map((station) => {
                        const allStationTasks = activeRows.filter((task) => task.station_id === station.id);
                        const visibleTasks = allStationTasks.filter((task) => matchesTask(task, query));
                        return <StationQueue key={station.id} station={station} tasks={visibleTasks} total={allStationTasks.length} hasSearch={query.trim().length > 0}
                          overflow={overflow.data ?? []} onChange={() => void tasks.mutate()} expandedTaskId={expandedTaskId}
                          onToggle={(id) => setExpandedTaskId((current) => current === id ? null : id)} />;
                      })}
                    </div>
                  </section>
                  {history.length > 0 && <details className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-semibold text-ink-800 sm:px-6">
                      <Text>Recent transfer history</Text>
                      <Badge tone="neutral">{history.length}</Badge>
                    </summary>
                    <ul className="divide-y divide-ink-100 border-t border-ink-100">
                      {history.map((task) => <HistoryRow key={task.id} task={task} />)}
                    </ul>
                  </details>}
                </div>;
              }}
            </Async>}
      </Async>
    </div>
  );
}

function QueueToolbar({ stations, activeTasks, selected, onSelect, query, onQuery }: {
  stations: Overview['stations']; activeTasks: Task[]; selected: string; onSelect: (id: string) => void; query: string; onQuery: (value: string) => void;
}) {
  const countAt = (id: string) => activeTasks.filter((task) => task.station_id === id).length;
  const scoped = selected === 'ALL' ? activeTasks : activeTasks.filter((task) => task.station_id === selected);
  const shown = scoped.filter((task) => matchesTask(task, query)).length;
  return <FilterBar
    search={<SearchField label="Search transfers" placeholder="Tracking number, courier, door or staff" value={query} onChange={onQuery} />}
    chips={<FilterChips label="Source locker station" value={selected} onChange={onSelect} options={[
      { key: 'ALL', label: 'All locker stations', count: activeTasks.length, alert: true },
      ...stations.map((station) => ({ key: station.id, label: station.name, count: countAt(station.id), alert: true })),
    ]} />}
    summary={<FilterSummary live shown={shown} total={activeTasks.length} noun="awaiting transfer" onClear={selected !== 'ALL' || query.trim() ? () => { onSelect('ALL'); onQuery(''); } : undefined} />}
  />;
}

const matchesTask = (task: Task, query: string) => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [task.tracking_no, task.company, task.compartment, task.assigned, task.destination].some((value) => value?.toLocaleLowerCase().includes(q));
};

function StationQueue({ station, tasks, total, hasSearch, overflow, onChange, expandedTaskId, onToggle }: {
  station: Overview['stations'][number]; tasks: Task[]; total: number; hasSearch: boolean;
  overflow: { id: string; name: string; capacity: number; held: number; incoming: number; active: boolean }[]; onChange: () => void;
  expandedTaskId: string | null; onToggle: (id: string) => void;
}) {
  const [visible, setVisible] = useState(8);
  const shown = tasks.slice(0, visible);
  const expanded = tasks.find((task) => task.id === expandedTaskId);
  return <section aria-labelledby={`station-${station.id}`}>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`station-${station.id}`} className="font-display text-base font-bold text-ink-900">{station.name}</h3>
          <Badge tone={station.status === 'ONLINE' ? 'success' : station.status === 'MAINTENANCE' ? 'warning' : 'danger'}><Text>{station.status === 'ONLINE' ? 'Online' : station.status === 'MAINTENANCE' ? 'Maintenance' : 'Offline'}</Text></Badge>
        </div>
        <p className="mt-1 text-sm text-ink-500">{station.location}</p>
      </div>
      <p className="text-sm font-medium text-ink-600">
        <Text>{total === 1 ? '1 parcel awaiting transfer' : `${total} parcels awaiting transfer`}</Text>
        {hasSearch && tasks.length !== total && <span className="text-ink-400"> · <Text>{`${tasks.length} matching`}</Text></span>}
      </p>
    </div>
    {tasks.length > 0
      ? <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-ink-100">{shown.map((task) => <QueueRow key={task.id} task={task} expanded={expandedTaskId === task.id} onToggle={() => onToggle(task.id)} />)}</ul>
            {visible < tasks.length && <div className="border-t border-ink-100 bg-ink-25 px-5 py-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setVisible((count) => count + 10)}><Text>Show 10 more</Text> <span className="text-ink-500">({tasks.length - visible})</span></Button>
            </div>}
          </Card>
          {expanded && <ul className="mt-4"><TaskCard task={expanded} overflow={overflow} onChange={onChange} stationContext /></ul>}
        </>
      : <div className="flex items-center gap-3 rounded-xl border border-dashed border-ink-200 bg-white px-5 py-4 text-ink-600">
          <span className={`grid size-9 shrink-0 place-items-center rounded-full ${hasSearch && total > 0 ? 'bg-ink-100 text-ink-500' : 'bg-success-50 text-success-700'}`}><CheckCircle2 className="size-5" aria-hidden /></span>
          <div><p className="text-sm font-semibold text-ink-800"><Text>{hasSearch && total > 0 ? 'No matching transfers' : 'No parcels awaiting transfer'}</Text></p><p className="mt-0.5 text-sm text-ink-500"><Text>{hasSearch && total > 0 ? 'Try a different tracking number, courier, door or staff name.' : 'No parcels are awaiting transfer from this station.'}</Text></p></div>
        </div>}
  </section>;
}

function QueueRow({ task, expanded, onToggle }: { task: Task; expanded: boolean; onToggle: () => void }) {
  const step = task.status === 'OPEN' ? 'Choose storage & open locker' : task.tracking_verified ? 'Close locker & confirm storage' : 'Scan and verify parcel';
  return <li className="grid gap-4 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-900">{task.tracking_no}</span>
        <Badge tone={STATUS[task.status].tone}><Text>{STATUS[task.status].label}</Text></Badge>
        {task.compartment && <Badge tone="neutral"><Text>{`Door ${task.compartment}`}</Text></Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-700">{task.company}{task.destination && <> · {task.destination}</>}</p>
      <p className="mt-1 text-sm text-ink-500"><Text>Current step</Text>: <Text>{step}</Text> · <Text>Assigned staff</Text>: <Text>{task.assigned ?? 'Unassigned'}</Text> · {formatDateTime(task.created_at)}</p>
    </div>
    <Button size="sm" variant={expanded ? 'ghost' : 'secondary'} onClick={onToggle}><Text>{expanded ? 'Hide details' : 'Continue transfer'}</Text></Button>
  </li>;
}

function TaskCard({ task: t, overflow, onChange, stationContext = false }: { task: Task; overflow: { id: string; name: string; capacity: number; held: number; incoming: number; active: boolean }[]; onChange: () => void; stationContext?: boolean }) {
  const [dest, setDest] = useState('');
  const [tracking, setTracking] = useState('');
  const [empty, setEmpty] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [failNote, setFailNote] = useState('');
  const [failReason, setFailReason] = useState<'MISSING' | 'DAMAGED' | 'OTHER'>('MISSING');
  const run = useAction((path: string, body: unknown) => api.post<{ command?: { status: string; error: string | null }; incident?: { reference: string } }>(`/admin/lockers/relocations/${t.id}/${path}`, body), {
    success: (r) => r.incident ? `Case ${r.incident.reference} created.` : r.command?.status === 'FAILED' ? null : 'Done.',
    onSuccess: onChange,
  });
  const shut = useAction(() => api.post(`/lockers/parcels/${t.parcel_id}/simulate-close`, { itemPresent: false }), { success: 'Door shut, compartment empty.', onSuccess: onChange });
  const live = t.status === 'OPEN' || t.status === 'IN_PROGRESS';
  const currentStep = t.status === 'OPEN' ? 0 : t.tracking_verified ? 2 : 1;

  return (
    <li>
      <Card className="overflow-hidden">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>{stationContext ? 'Source door' : 'Source locker'}</Text></p>
              <h3 className="mt-1 font-display text-xl font-bold text-ink-900">
                {stationContext ? <Text>{t.compartment ? `Door ${t.compartment}` : 'Door not recorded'}</Text> : <>{t.station}{t.compartment && <span className="font-medium text-ink-500"> · {t.compartment}</span>}</>}
              </h3>
            </div>
            <Badge tone={STATUS[t.status].tone}><Text>{STATUS[t.status].label}</Text></Badge>
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TaskDetail label="Tracking number">{t.tracking_no}</TaskDetail>
            <TaskDetail label="Courier company">{t.company}</TaskDetail>
            <TaskDetail label="Storage destination"><Text>{t.destination ?? 'Not selected yet'}</Text></TaskDetail>
            <TaskDetail label="Assigned staff"><Text>{t.assigned ?? 'Unassigned'}</Text></TaskDetail>
          </dl>

          <p className="mt-4 text-xs text-ink-500"><Text>{`Created ${formatDateTime(t.created_at)}`}</Text></p>
          {t.failure_reason && <p className="mt-2 text-sm font-medium text-accent-700"><Text>{t.failure_reason}</Text></p>}
          {t.case_reference && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-accent-800"><Text>Transfer stopped and case created</Text></p>
              <p className="mt-0.5 text-sm text-accent-700"><Text>{`${t.case_reference} is ready for investigation under Smart locker cases.`}</Text></p>
            </div>
            <Button size="sm" variant="secondary" href={`/console/operations?tab=lockers&view=cases&ref=${encodeURIComponent(t.case_reference)}`}><Text>Open case</Text></Button>
          </div>}
        </div>

        {live && <ol className="grid border-y border-ink-100 bg-ink-25 sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const complete = index < currentStep;
            const current = index === currentStep;
            return <li key={step} aria-current={current ? 'step' : undefined} className={`flex min-w-0 items-center gap-3 px-5 py-4 sm:px-6 ${current ? 'bg-brand-50 text-brand-800' : complete ? 'text-success-700' : 'text-ink-500'}`}>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${current ? 'bg-brand-700 text-white' : complete ? 'bg-success-50' : 'bg-ink-100 text-ink-600'}`}>
                {complete ? <CheckCircle2 className="size-4" aria-hidden /> : index + 1}
              </span>
              <span className={`text-sm leading-5 ${current ? 'font-semibold' : 'font-medium'}`}><Text>{step}</Text></span>
            </li>;
          })}
        </ol>}

        <div className="space-y-5 px-5 py-5 sm:px-6">
          {!live && <TaskOutcome task={t} />}

          {t.status === 'OPEN' && (
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-end gap-3">
                <Select label="Storage destination" value={dest} onChange={(event) => setDest(event.target.value)} className="min-w-0 flex-1 basis-56">
                  <option value=""><Text>Choose…</Text></option>
                  {overflow.filter((o) => o.active).map((o) => <option key={o.id} value={o.id} disabled={o.held + o.incoming >= o.capacity}>{o.name} (<Text>{`${o.held + o.incoming} of ${o.capacity} committed`}</Text>)</option>)}
                </Select>
                <Button disabled={!dest} pending={run.pending} onClick={() => void run.run('start', { destinationId: dest, idempotencyKey: crypto.randomUUID() })}><DoorOpen className="size-4" aria-hidden /><Text>Start and open the door</Text></Button>
              </div>
            </div>
          )}

          {t.status === 'IN_PROGRESS' && !t.tracking_verified && (
            <div className="space-y-4 rounded-lg border border-ink-200 bg-white p-4">
              <CameraScan onCode={(text) => setTracking(text.trim().toUpperCase())} label="Scan the parcel" formats={BARCODES} />
              <div className="flex flex-wrap items-end gap-3">
                <Input label="Tracking number on the parcel" value={tracking} onChange={(event) => setTracking(event.target.value.toUpperCase())} maxLength={40} className="min-w-0 flex-1 basis-56" />
                <Button disabled={tracking.trim().length < 6} pending={run.pending} onClick={() => void run.run('verify', { trackingNo: tracking })}><ScanLine className="size-4" aria-hidden /><Text>Verify parcel</Text></Button>
              </div>
              <p className="text-sm text-ink-500"><Text>Scan or enter the tracking number shown above. A different parcel will be rejected.</Text></p>
            </div>
          )}

          {t.status === 'IN_PROGRESS' && t.tracking_verified && (
            <div className="space-y-4 rounded-lg border border-success-200 bg-success-50/50 p-4">
              <p className="flex items-start gap-2 text-[15px] font-semibold text-success-700"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden /><Text>Right parcel verified. Close the locker, then place the parcel at the storage destination shown above.</Text></p>
              {t.adapter === 'SIMULATED' && t.has_sensors && <Button size="sm" variant="secondary" onClick={() => void shut.run()} pending={shut.pending}><Text>Simulated station: shut the empty door</Text></Button>}
              {!t.has_sensors && <Checkbox label="The compartment is empty and the door is shut" checked={empty} onChange={(event) => setEmpty(event.target.checked)} />}
              <Checkbox label="I have placed the parcel at the storage location shown above" checked={placed} onChange={(event) => setPlaced(event.target.checked)} />
              <Button disabled={!placed || (!t.has_sensors && !empty)} pending={run.pending} onClick={() => void run.run('complete', { emptyConfirmed: empty })}><Truck className="size-4" aria-hidden /><Text>Confirm stored & notify resident</Text></Button>
            </div>
          )}

          {live && (
            <details className="rounded-md border border-ink-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink-700"><Text>Stop transfer and create a case</Text></summary>
              <div className="mt-3 space-y-4">
                <p className="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm leading-5 text-accent-800"><Text>This ends the transfer, holds the parcel as an exception, takes the compartment out of service, and alerts the case team.</Text></p>
                <Select label="Why must this transfer stop?" value={failReason} onChange={(event) => setFailReason(event.target.value as typeof failReason)}>
                  <option value="MISSING"><Text>The parcel was not in the locker</Text></option>
                  <option value="DAMAGED"><Text>The parcel is damaged</Text></option>
                  <option value="OTHER"><Text>Something else</Text></option>
                </Select>
                <Textarea label="What did you find?" value={failNote} onChange={(event) => setFailNote(event.target.value)} maxLength={300} />
                <Button size="sm" variant="danger" disabled={failNote.trim().length < 3} pending={run.pending} onClick={() => void run.run('fail', { reason: failReason, note: failNote })}><Text>Stop transfer & create case</Text></Button>
              </div>
            </details>
          )}
        </div>
      </Card>
    </li>
  );
}

function TaskDetail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg bg-ink-50 px-3 py-2.5">
    <dt className="text-xs font-medium text-ink-500"><Text>{label}</Text></dt>
    <dd className="mt-1 break-words text-sm font-semibold text-ink-900">{children}</dd>
  </div>;
}

function TaskOutcome({ task }: { task: Task }) {
  if (task.status === 'DONE') return <div className="flex items-start gap-3 rounded-lg border border-success-200 bg-success-50 p-4">
    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-700" aria-hidden />
    <div>
      <p className="font-semibold text-success-800"><Text>Moved to storage</Text></p>
      <p className="mt-1 text-sm text-success-700"><Text>Completed</Text>{task.completed_at && <> {formatDateTime(task.completed_at)}</>} · <Text>{task.destination ?? 'Storage destination not recorded'}</Text></p>
    </div>
  </div>;
  if (task.status === 'FAILED') return <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
    <p className="font-semibold text-accent-800"><Text>Transfer stopped</Text></p>
    <p className="mt-1 text-sm text-accent-700"><Text>{task.failure_reason ?? 'Held for investigation'}</Text></p>
  </div>;
  return <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
    <p className="font-semibold text-ink-800"><Text>Parcel collected before transfer</Text></p>
    <p className="mt-1 text-sm text-ink-600"><Text>The transfer was cancelled because it was no longer needed.</Text></p>
  </div>;
}

function HistoryRow({ task }: { task: Task }) {
  const destination = task.status === 'DONE' ? task.destination ?? 'Storage destination not recorded' : null;
  return <li className="grid gap-4 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-900">{task.tracking_no}</span>
        <Badge tone={STATUS[task.status].tone}><Text>{STATUS[task.status].label}</Text></Badge>
      </div>
      <p className="mt-1 text-sm text-ink-700">{task.station}{task.compartment && ` · ${task.compartment}`} · {task.company}</p>
      <p className="mt-1 text-sm text-ink-500">
        {task.status === 'DONE' && <><Text>Moved to</Text> {destination}</>}
        {task.status === 'FAILED' && <Text>{task.failure_reason ?? 'Held for investigation'}</Text>}
        {task.status === 'CANCELLED' && <Text>Parcel collected before transfer</Text>}
        {task.completed_at && <> · {formatDateTime(task.completed_at)}</>}
        {task.assigned && <> · <Text>Handled by</Text> {task.assigned}</>}
      </p>
    </div>
    {task.case_reference && <Button size="sm" variant="secondary" href={`/console/operations?tab=lockers&view=cases&ref=${encodeURIComponent(task.case_reference)}`}><Text>Open case</Text></Button>}
  </li>;
}
