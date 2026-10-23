'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { DoorOpen, KeyRound, MonitorPlay, Plus, ScrollText, MapPin, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Checkbox, Input, Select } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterSegmented, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { COMPARTMENT_STATE_LABELS, LOCKER_SIZE_INFO, LOCKER_SIZES, type CompartmentState } from '@/shared/lockers';
import { commandFailed, commandPurpose, commandRequester, commandStatus } from '@/components/features/door-commands';
import { useIsAdmin, type Overview } from './overview';

interface Doors {
  station: { id: string; name: string; precincts: string[] };
  homes: { total: number; withDoor: number; withoutDoor: number };
  doors: { id: string; label: string; size: string; state: CompartmentState; fault: string | null; trackingNo: string | null; house: string | null }[];
}

const DOOR_TONE: Record<CompartmentState, 'success' | 'brand' | 'gold' | 'danger' | 'neutral'> = {
  AVAILABLE: 'success', OCCUPIED: 'brand', RESERVED: 'gold', FAULTY: 'danger', DISABLED: 'neutral',
};

interface Log {
  commands: { id: string; purpose: string; status: string; error: string | null; created_at: string; compartment: string; requested_by: string | null; requester_role: string | null; requester_company: string | null; tracking_no: string | null; house: string | null }[];
  events: { type: string; source: string; received_at: string; compartment: string | null; door: string | null; item_present: boolean | null; status: string | null }[];
}

export function StationsTab() {
  const data = useApi<Overview>('/admin/lockers');
  const isAdmin = useIsAdmin();
  const [adding, setAdding] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [doors, setDoors] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const status = useAction((id: string, s: string) => api.post(`/admin/lockers/stations/${id}/status`, { status: s }), { success: 'Station updated.', onSuccess: () => void data.mutate() });
  const rotate = useAction((id: string) => api.post<{ deviceSecret: string }>(`/admin/lockers/stations/${id}/secret`), { onSuccess: (r) => setSecret(r.deviceSecret) });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink-900"><Text>Locker stations</Text></h2>
          <p className="mt-1 text-sm text-ink-500"><Text>Manage station availability and view device activity.</Text></p>
        </div>
        {isAdmin && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add a station</Text></Button>}
      </div>
      <Async state={data} skeleton={<SkeletonList rows={2} />}>
        {(o) => o.stations.length === 0 ? <EmptyState title="No locker stations yet" /> : (
          <ul className="space-y-4">
            {o.stations.map((s) => (
              <li key={s.id}>
                <Card className="overflow-hidden">
                  <div className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words text-base font-semibold text-ink-900">{s.name}</h3>
                      <Badge tone={s.adapter === 'SIMULATED' ? 'neutral' : 'brand'}><Text>{s.adapter === 'SIMULATED' ? 'Simulated' : 'Hardware gateway'}</Text></Badge>
                    </div>
                    <p className="flex items-start gap-2 text-sm text-ink-600"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{s.location}</p>
                    <dl className="grid gap-4 text-sm sm:grid-cols-3">
                      <div><dt className="text-xs text-ink-500"><Text>Station code</Text></dt><dd className="mt-1 font-mono font-medium text-ink-800">{s.code}</dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Doors given to homes</Text></dt><dd className="mt-1 font-medium tabular-nums text-ink-800">{s.assigned} <span className="text-ink-500">/ {s.total}</span></dd></div>
                      <div><dt className="text-xs text-ink-500"><Text>Last connected</Text></dt><dd className="mt-1 font-medium text-ink-800"><Text>{s.last_seen_at ? timeAgo(s.last_seen_at) : 'Not connected yet'}</Text></dd></div>
                    </dl>
                    <p className="break-all text-xs text-ink-500"><Text>Poster link: </Text>/locker/{s.code}</p>
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ink-100 bg-ink-50/60 px-5 py-4">
                    <Select label="Status" value={s.status} onChange={(event) => void status.run(s.id, event.target.value)} className="w-full sm:w-44">
                      <option value="ONLINE"><Text>Online</Text></option>
                      <option value="MAINTENANCE"><Text>Maintenance</Text></option>
                      <option value="OFFLINE"><Text>Offline</Text></option>
                    </Select>
                    <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setDoors(s.id)}><DoorOpen className="size-4" aria-hidden /><Text>Doors</Text></Button>
                    <Button size="sm" variant="secondary" onClick={() => setLog(s.id)}><ScrollText className="size-4" aria-hidden /><Text>Command log</Text></Button>
                    {s.adapter === 'SIMULATED' ? (
                      <Button size="sm" variant="secondary" href={`/console/lockers/simulator?station=${s.id}`}><MonitorPlay className="size-4" aria-hidden /><Text>Simulator</Text></Button>
                    ) : isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => void rotate.run(s.id)} pending={rotate.pending}><KeyRound className="size-4" aria-hidden /><Text>New device secret</Text></Button>
                    )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <AddStation open={adding} onClose={() => setAdding(false)} onAdded={(r) => { void data.mutate(); if (r) setSecret(r); }} />
      <CommandLog stationId={log} onClose={() => setLog(null)} />
      <DoorList stationId={doors} isAdmin={isAdmin} onClose={() => setDoors(null)} onChanged={() => void data.mutate()} />
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Device secret" description="Shown once. Put it in the station gateway’s configuration; it signs every message both ways.">
        <p className="break-all rounded-md bg-ink-50 p-3 font-mono text-sm text-ink-900">{secret}</p>
      </Modal>
    </div>
  );
}

function AddStation({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (secret: string | null) => void }) {
  const [adapter, setAdapter] = useState<'SIMULATED' | 'HTTP_GATEWAY'>('SIMULATED');
  const add = useAction((body: Record<string, unknown>) => api.post<{ deviceSecret: string | null }>('/admin/lockers/stations', body), {
    success: 'Station added.',
    onSuccess: (r) => {
      onAdded(r.deviceSecret);
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const n = (k: string) => Number(f.get(k) || 0);
    const precincts = String(f.get('precincts') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    void add.run({
      precincts,
      name: String(f.get('name') ?? '').trim(), location: String(f.get('location') ?? '').trim(), adapter,
      gatewayUrl: adapter === 'HTTP_GATEWAY' ? String(f.get('gatewayUrl') ?? '').trim() : undefined,
      layout: { S: n('S'), M: n('M'), L: n('L'), XL: n('XL') }, hasDoorSensor: f.get('door') === 'on', hasPresenceSensor: f.get('presence') === 'on',
    });
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a locker station" wide footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="add-station" pending={add.pending}><Text>Add</Text></Button></>}>
      <form method="post" id="add-station" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" name="name" maxLength={80} required error={add.fields.name} />
        <Input label="Where" name="location" maxLength={160} required error={add.fields.location} />
        <Select label="Connection" value={adapter} onChange={(event) => setAdapter(event.target.value as typeof adapter)}>
          <option value="SIMULATED"><Text>Simulator (no hardware)</Text></option>
          <option value="HTTP_GATEWAY"><Text>Hardware through the SimeTown gateway</Text></option>
        </Select>
        {adapter === 'HTTP_GATEWAY' && <Input label="Gateway address" name="gatewayUrl" type="url" placeholder="https://gateway.example/locker-a" error={add.fields.gatewayUrl} />}
        <Input label="Precincts served" name="precincts" maxLength={400} className="sm:col-span-2" placeholder="e.g. Elmina Valley 1, Elmina Valley 2"
          hint="Separate with commas. Each home in these precincts gets its own door with its first parcel. Leave empty to serve every home." error={add.fields.precincts} />
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-semibold text-ink-900"><Text>Doors by size</Text></legend>
          <p className="mb-3 text-sm text-ink-500"><Text>One door per home, size M or larger. Plan one door for every home in the precincts served.</Text></p>
          <div className="grid gap-3 sm:grid-cols-4">
            {LOCKER_SIZES.map((s) => <Input key={s} label={`${LOCKER_SIZE_INFO[s].label} (${s})`} name={s} type="number" min={0} max={200} defaultValue={s === 'M' ? 20 : 0} />)}
          </div>
        </fieldset>
        <Checkbox label="Has door sensors" name="door" defaultChecked />
        <Checkbox label="Has parcel presence sensors" name="presence" defaultChecked />
      </form>
    </Modal>
  );
}

type Command = Log['commands'][number];
/** Openings by staff: moving a parcel to the guardhouse, staff door access, and approved exceptional openings. */
const STAFF_PURPOSES = ['RELOCATE', 'MAINTENANCE', 'EXCEPTION'];
type LogView = 'COMMANDS' | 'MESSAGES';
type CommandFilter = 'ALL' | 'DEPOSIT' | 'COLLECT' | 'STAFF' | 'PROBLEM';

/** A station message in plain words. Pickup codes are never shown. */
function messageText(e: Log['events'][number]): string {
  const door = e.compartment ? `Door ${e.compartment}` : 'A door';
  switch (e.type) {
    case 'DOOR': return `${door} ${e.door === 'OPEN' ? 'opened' : 'closed'}${e.item_present === true ? ', parcel inside' : e.item_present === false ? ', empty' : ''}`;
    case 'ACK': return 'The station confirmed a door command';
    case 'HEARTBEAT': return 'Station check-in';
    case 'PICKUP': return 'A pickup code was entered on the keypad';
    case 'STATION': return e.status === 'OFFLINE' ? 'The station went offline' : 'The station came online';
    case 'FAULT': return `${door}: fault reported`;
    default: return e.type;
  }
}

const TZ = 'Asia/Kuala_Lumpur';
const dayKey = (value: string) => new Date(value).toLocaleDateString('en-CA', { timeZone: TZ });
const timeOf = (value: string) => new Date(value).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
function dayHeading(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  return key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDate(`${key}T12:00:00+08:00`);
}
/** Items in order, grouped by the township day they happened. */
function byDay<T>(items: T[], at: (item: T) => string): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(at(item));
    if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

function CommandLog({ stationId, onClose }: { stationId: string | null; onClose: () => void }) {
  const log = useApi<Log>(stationId ? `/admin/lockers/stations/${stationId}/commands` : null, { refreshInterval: 5_000 });
  const [view, setView] = useState<LogView>('COMMANDS');
  const [filter, setFilter] = useState<CommandFilter>('ALL');
  const [query, setQuery] = useState('');
  const close = () => { setView('COMMANDS'); setFilter('ALL'); setQuery(''); onClose(); };
  return (
    <Modal open={stationId !== null} onClose={close} title="Command log" description="The last 50 times a door was opened, who asked for it, and what the station reported." wide>
      <Async state={log} skeleton={<SkeletonList rows={5} />}>
        {(d) => {
          const q = query.trim().toLocaleLowerCase();
          const kind = (c: Command) => filter === 'ALL' || (filter === 'PROBLEM' ? commandFailed(c) : filter === 'STAFF' ? STAFF_PURPOSES.includes(c.purpose) : c.purpose === filter);
          const shown = d.commands.filter((c) => kind(c) && (!q || [c.compartment, c.requested_by ?? '', c.requester_company ?? '', c.tracking_no ?? '', c.house ?? ''].some((v) => v.toLocaleLowerCase().includes(q))));
          const problems = d.commands.filter(commandFailed).length;
          return <div className="space-y-4">
            <FilterSegmented<LogView> label="Show" value={view} onChange={setView} options={[
              { key: 'COMMANDS', label: 'Door openings', count: d.commands.length },
              { key: 'MESSAGES', label: 'Station messages', count: d.events.length },
            ]} />

            {view === 'COMMANDS' ? <>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-lg bg-ink-25 p-3"><dt className="text-xs text-ink-500"><Text>Opened for couriers</Text></dt><dd className="mt-1 font-display text-lg font-bold tabular-nums text-ink-900">{d.commands.filter((c) => c.purpose === 'DEPOSIT' && c.status === 'ACKED').length}</dd></div>
                <div className="rounded-lg bg-ink-25 p-3"><dt className="text-xs text-ink-500"><Text>Opened for residents</Text></dt><dd className="mt-1 font-display text-lg font-bold tabular-nums text-ink-900">{d.commands.filter((c) => c.purpose === 'COLLECT' && c.status === 'ACKED').length}</dd></div>
                <div className={cn('rounded-lg p-3', problems ? 'bg-accent-50' : 'bg-ink-25')}><dt className="text-xs text-ink-500"><Text>Did not open</Text></dt><dd className={cn('mt-1 font-display text-lg font-bold tabular-nums', problems ? 'text-accent-700' : 'text-ink-900')}>{problems}</dd></div>
              </dl>
              <FilterBar
                search={<SearchField label="Search the log" placeholder="Door, name, courier company, tracking number or house" value={query} onChange={setQuery} />}
                chips={<FilterChips<CommandFilter> label="Show openings" size="sm" value={filter} onChange={setFilter} options={[
                  { key: 'ALL', label: 'All', count: d.commands.length },
                  { key: 'DEPOSIT', label: 'Courier deliveries', count: d.commands.filter((c) => c.purpose === 'DEPOSIT').length },
                  { key: 'COLLECT', label: 'Resident collections', count: d.commands.filter((c) => c.purpose === 'COLLECT').length },
                  { key: 'STAFF', label: 'Staff and guardhouse', count: d.commands.filter((c) => STAFF_PURPOSES.includes(c.purpose)).length },
                  { key: 'PROBLEM', label: 'Did not open', count: problems, alert: true },
                ]} />}
                summary={<FilterSummary shown={shown.length} total={d.commands.length} noun="door openings" onClear={q || filter !== 'ALL' ? () => { setQuery(''); setFilter('ALL'); } : undefined} />}
              />
              {shown.length === 0
                ? <EmptyState icon={Search} title={d.commands.length ? 'No door openings match' : 'No door openings yet'}><Text>{d.commands.length ? 'Try another search or filter.' : 'Each time a door is opened, it is listed here.'}</Text></EmptyState>
                : <LocalizedDiv role="region" aria-label="Door openings" tabIndex={0} className="max-h-[52vh] overflow-y-auto rounded-lg border border-ink-100 focus-visible:outline-2 focus-visible:outline-brand-600">
                  <div aria-hidden className="sticky top-0 z-[1] hidden grid-cols-[4.25rem_3rem_minmax(0,1.25fr)_minmax(0,1fr)_7.5rem] gap-4 border-b border-ink-100 bg-ink-25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 md:grid">
                    <span><Text>Time</Text></span><span><Text>Door</Text></span><span><Text>Opened for</Text></span><span><Text>Parcel</Text></span><span className="text-right"><Text>Result</Text></span>
                  </div>
                  {byDay(shown, (c) => c.created_at).map((g) => <section key={g.key} aria-label={dayHeading(g.key)}>
                    <h3 className="border-b border-ink-100 bg-white/95 px-4 py-1.5 text-xs font-semibold text-ink-600"><Text>{dayHeading(g.key)}</Text></h3>
                    <ul className="divide-y divide-ink-100">
                      {g.items.map((c) => {
                        const who = commandRequester(c);
                        const P = commandPurpose(c.purpose);
                        const S = commandStatus(c.status);
                        return <li key={c.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-3 text-sm md:grid-cols-[4.25rem_3rem_minmax(0,1.25fr)_minmax(0,1fr)_7.5rem] md:items-center">
                          <span className="tabular-nums text-ink-500"><Text>{timeOf(c.created_at)}</Text></span>
                          <span className="font-mono font-semibold text-ink-900 md:order-none">{c.compartment}</span>
                          <span className="col-start-2 min-w-0 md:col-start-auto">
                            <span className="flex items-center gap-1.5 font-medium text-ink-800"><P.icon className="size-3.5 shrink-0 text-ink-400" aria-hidden /><Text>{P.label}</Text></span>
                            <span className="block text-ink-700">{who.name}</span>
                            <span className="block text-xs text-ink-500"><Text>{who.role}</Text></span>
                          </span>
                          <span className="col-start-2 min-w-0 text-xs md:col-start-auto">
                            {c.tracking_no ? <span className="block truncate font-mono text-ink-700">{c.tracking_no}</span> : <span className="text-ink-400">–</span>}
                            {c.house && <span className="block text-ink-500">{c.house}</span>}
                          </span>
                          <span className="col-start-2 flex flex-col items-start gap-0.5 md:col-start-auto md:items-end">
                            <Badge tone={S.tone}><Text>{S.label}</Text></Badge>
                            {c.error && <span className="text-xs text-accent-700"><Text>{c.error}</Text></span>}
                          </span>
                        </li>;
                      })}
                    </ul>
                  </section>)}
                </LocalizedDiv>}
            </> : d.events.length === 0
              ? <EmptyState icon={ScrollText} title="No station messages yet"><Text>Door sensors, check-ins and keypad entries from the station are listed here.</Text></EmptyState>
              : <LocalizedDiv role="region" aria-label="Station messages" tabIndex={0} className="max-h-[60vh] overflow-y-auto rounded-lg border border-ink-100 focus-visible:outline-2 focus-visible:outline-brand-600">
                {byDay(d.events, (e) => e.received_at).map((g) => <section key={g.key} aria-label={dayHeading(g.key)}>
                  <h3 className="sticky top-0 border-b border-ink-100 bg-ink-25 px-4 py-1.5 text-xs font-semibold text-ink-600"><Text>{dayHeading(g.key)}</Text></h3>
                  <ul className="divide-y divide-ink-100">
                    {g.items.map((e, i) => <li key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 text-sm">
                      <span className="tabular-nums text-ink-500"><Text>{timeOf(e.received_at)}</Text></span>
                      <span className="min-w-0 truncate text-ink-800"><Text>{messageText(e)}</Text></span>
                      <Badge tone="neutral"><Text>{e.source === 'SIMULATOR' ? 'Simulator' : 'Station'}</Text></Badge>
                    </li>)}
                  </ul>
                </section>)}
              </LocalizedDiv>}
          </div>;
        }}
      </Async>
    </Modal>
  );
}

type DoorFilter = 'ALL' | 'HOME' | 'FREE' | 'CHECK';

/** A bank's doors and the home each belongs to. Admins free the empty door of a home that moved out. */
function DoorList({ stationId, isAdmin, onClose, onChanged }: { stationId: string | null; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const data = useApi<Doors>(stationId ? `/admin/lockers/stations/${stationId}/doors` : null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DoorFilter>('ALL');
  const [releasing, setReleasing] = useState<Doors['doors'][number] | null>(null);
  const release = useAction((id: string) => api.post(`/admin/lockers/compartments/${id}/release`), {
    success: 'Door freed. The next home that needs one gets it with its first parcel.',
    onSuccess: () => { setReleasing(null); void data.mutate(); onChanged(); },
  });
  const close = () => { setQuery(''); setFilter('ALL'); onClose(); };
  return <Modal open={stationId !== null} onClose={close} wide title={data.data ? `Doors · ${data.data.station.name}` : 'Doors'}
    description="Each home has its own door here, given automatically with its first parcel. It keeps the door while it lives there.">
    <Async state={data} skeleton={<SkeletonList rows={4} />}>
      {(d) => {
        const q = query.trim().toLocaleLowerCase();
        const matches = (door: Doors['doors'][number]) => (filter === 'ALL' || (filter === 'HOME' && door.house) || (filter === 'FREE' && !door.house) || (filter === 'CHECK' && (door.state === 'FAULTY' || door.state === 'DISABLED')))
          && (!q || [door.label, door.house ?? '', door.trackingNo ?? ''].some((v) => v.toLocaleLowerCase().includes(q)));
        const shown = d.doors.filter(matches);
        return <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-ink-25 p-3"><dt className="text-xs text-ink-500"><Text>Precincts served</Text></dt><dd className="mt-1 text-sm font-medium text-ink-800"><Text>{d.station.precincts.length ? d.station.precincts.join(', ') : 'Every home'}</Text></dd></div>
            <div className="rounded-lg bg-ink-25 p-3"><dt className="text-xs text-ink-500"><Text>Homes with a door</Text></dt><dd className="mt-1 font-display text-lg font-bold tabular-nums text-ink-900">{d.homes.withDoor} <span className="text-sm font-medium text-ink-500">/ {d.homes.total}</span></dd></div>
            <div className="rounded-lg bg-ink-25 p-3"><dt className="text-xs text-ink-500"><Text>Free doors</Text></dt><dd className="mt-1 font-display text-lg font-bold tabular-nums text-ink-900">{d.doors.filter((door) => !door.house && door.state === 'AVAILABLE').length}</dd></div>
          </dl>
          {d.homes.withoutDoor > d.doors.filter((door) => !door.house && door.state === 'AVAILABLE').length && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-700" role="status">
            <Text>{`${d.homes.withoutDoor} homes do not have a door yet, and there are not enough free doors for all of them. Add doors, or free the doors of homes that moved out.`}</Text>
          </p>}
          <FilterBar
            search={<SearchField label="Search doors" placeholder="Door, house or tracking number" value={query} onChange={setQuery} />}
            chips={<FilterChips<DoorFilter> label="Show doors" size="sm" value={filter} onChange={setFilter} options={[
              { key: 'ALL', label: 'All doors', count: d.doors.length },
              { key: 'HOME', label: 'Given to a home', count: d.doors.filter((door) => door.house).length },
              { key: 'FREE', label: 'Free', count: d.doors.filter((door) => !door.house).length },
              { key: 'CHECK', label: 'Needs checking', count: d.doors.filter((door) => door.state === 'FAULTY' || door.state === 'DISABLED').length, alert: true },
            ]} />}
            summary={<FilterSummary shown={shown.length} total={d.doors.length} noun="doors" onClear={q || filter !== 'ALL' ? () => { setQuery(''); setFilter('ALL'); } : undefined} />}
          />
          {shown.length === 0
            ? <EmptyState icon={Search} title="No doors match"><Text>Try another door, house or filter.</Text></EmptyState>
            : <ul className="max-h-[50vh] divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100">
              {shown.map((door) => <li key={door.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="font-mono text-sm font-semibold text-ink-900">{door.label} <span className="font-sans text-xs font-medium text-ink-500">{door.size}</span></span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium text-ink-800">{door.house ?? <span className="text-ink-500"><Text>Free for the next home</Text></span>}</span>
                  {door.trackingNo && <span className="block truncate font-mono text-xs text-ink-500">{door.trackingNo}</span>}
                  {door.fault && <span className="block truncate text-xs text-accent-700"><Text>{door.fault}</Text></span>}
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge tone={DOOR_TONE[door.state]}><Text>{COMPARTMENT_STATE_LABELS[door.state]}</Text></Badge>
                  {isAdmin && door.house && !door.trackingNo && <Button size="sm" variant="ghost" onClick={() => setReleasing(door)}><Text>Free this door</Text></Button>}
                </span>
              </li>)}
            </ul>}
        </div>;
      }}
    </Async>
    <ConfirmDialog open={releasing !== null} onClose={() => setReleasing(null)} onConfirm={() => releasing && void release.run(releasing.id)} pending={release.pending}
      title={releasing ? `Free door ${releasing.label}?` : 'Free this door?'} confirmLabel="Free the door">
      <Text>{releasing?.house ? `Do this only when ${releasing.house} has moved out. The home will get another free door with its next parcel.` : 'Do this only when the home has moved out.'}</Text>
    </ConfirmDialog>
  </Modal>;
}
