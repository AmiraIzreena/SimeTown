'use client';

import { Text } from '@/components/ui/localized-text';

import { Cpu, Eye, EyeOff, Footprints, MapPin, MonitorSmartphone, Plus, Printer, QrCode as QrIcon, Recycle, Route, ShieldCheck, X } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConsolePlacesWalkthrough } from '@/components/features/gerak-walkthroughs';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { TownshipMap, type MapCheckpoint, type MapLoop } from '@/components/features/township-map';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatKg, formatKm, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { useMinLoading } from '@/lib/use-min-loading';
import { ADMINS, ROLE_LABELS } from '@/shared/domain';

type Tab = 'machines' | 'kiosks' | 'loops' | 'patrol';
interface Machine {
  id: string;
  name: string;
  status: 'ONLINE' | 'FULL' | 'OFFLINE';
  last_seen_at: string | null;
  kiosk: string;
  sessions_today: number;
  grams_today: number;
}
interface PatrolPoint {
  id: string;
  seq: number;
  name: string;
  code: string;
}
interface Kiosk {
  id: string;
  name: string;
  location: string;
  code: string;
  township: string;
  total_g: number;
}
interface Loop {
  id: string;
  name: string;
  description: string;
  mode: 'WALK' | 'CYCLE';
  distance_m: number;
  /** Shown to residents on Gerak. A hidden loop cannot be scanned or tracked. */
  active: boolean;
  /** The route is drawn on the map, which tracking and distance on the loops need. */
  mapped: boolean;
  path: [number, number][];
  /** The latest show or hide, from the audit log; null when it never changed in the console. */
  lastChange: { action: 'LOOP_SHOWN' | 'LOOP_HIDDEN'; at: string; by: string | null; role: Me['role'] | null; reason: string | null } | null;
  checkpoints: { id: string; seq: number; name: string; code: string; located: boolean; lat: number | null; lng: number | null; radius_m: number }[];
}

/** Which resident feature each kind of place belongs to, so Kitar, Gerak and the guards' rounds are never confused. */
const MODULES = {
  KITAR: { name: 'Kitar', what: 'Recycling', icon: Recycle, href: '/app/kitar', tone: 'success' as const },
  GERAK: { name: 'Gerak', what: 'Walking & cycling', icon: Footprints, href: '/app/gerak', tone: 'brand' as const },
  GUARDS: { name: 'Guards', what: 'Security rounds', icon: ShieldCheck, href: null, tone: 'neutral' as const },
};
type ModuleKey = keyof typeof MODULES;
const TAB_MODULE: Record<Tab, ModuleKey> = { machines: 'KITAR', kiosks: 'KITAR', loops: 'GERAK', patrol: 'GUARDS' };

/** A short line at the top of each tab: which feature these places belong to, and who uses them. */
function ModuleNote({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const m = MODULES[module];
  return (
    <p className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 bg-white/70 px-4 py-3 text-sm text-ink-600">
      <Badge tone={m.tone}><m.icon className="size-3.5" aria-hidden /><Text>{m.name}</Text></Badge>
      <span className="min-w-0 flex-1"><Text>{children}</Text></span>
    </p>
  );
}
/** A poster to print: the QR opens the app with the code filled in. */
interface Poster {
  title: string;
  subtitle: string;
  code: string;
  path: string;
}

export default function PlacesPage() {
  const [tab, setTab] = useState<Tab>('machines');
  const [poster, setPoster] = useState<Poster | null>(null);
  return (
    <>
      <PageHeader action={<ConsolePlacesWalkthrough />} title="Kiosks, trails & patrol points" description="Places for three different features: Kitar recycling kiosks and bins, Gerak walking and cycling loops, and the guards’ patrol points. Each printed code proves someone was there." />
      <PlacesSummary onPick={setTab} />
      <Tabs<Tab>
        label="Places"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'machines', label: 'Kitar · Kiosk bins' },
          { key: 'kiosks', label: 'Kitar · Recycling kiosks' },
          { key: 'loops', label: 'Gerak · Loops' },
          { key: 'patrol', label: 'Guards · Patrol points' },
        ]}
      />
      <TabPanel>
        {tab === 'machines' ? (
          <>
            <ModuleNote module={TAB_MODULE.machines}><Text>Smart bins with a scale at each Kitar kiosk. Residents recycle here from the Kitar page; each bin sends the weight by itself.</Text></ModuleNote>
            <Machines />
          </>
        ) : tab === 'kiosks' ? (
          <>
            <ModuleNote module={TAB_MODULE.kiosks}><Text>Where residents bring recycling. A kiosk poster opens the Kitar page. These are not Gerak checkpoints.</Text></ModuleNote>
            <Kiosks onPoster={setPoster} />
          </>
        ) : tab === 'loops' ? (
          <>
            <ModuleNote module={TAB_MODULE.loops}><Text>The walking and cycling loops residents see on Gerak. A checkpoint poster opens the Gerak page. Changes here change Gerak.</Text></ModuleNote>
            <Loops onPoster={setPoster} />
          </>
        ) : (
          <>
            <ModuleNote module={TAB_MODULE.patrol}><Text>Points guards scan on their security rounds. Residents never see these, and they earn no points or XP.</Text></ModuleNote>
            <Patrol onPoster={setPoster} />
          </>
        )}
      </TabPanel>

      <Modal open={poster !== null} onClose={() => setPoster(null)} title={poster?.title ?? ''} description={poster?.subtitle}>
        {poster && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <QrCode value={`${window.location.origin}${poster.path}${poster.code}`} label={`QR code for ${poster.title}`} size={240} />
            <p className="font-display text-3xl font-bold tracking-[0.18em] text-ink-900"><Text>{poster.code}</Text></p>
            <p className="text-sm text-ink-500"><Text>Scan with your phone camera, or type the code in SimeTown.</Text></p>
            <Button variant="secondary" className="no-print" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /><Text>Print poster</Text></Button>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * One tile per tab, each opening it: kiosk bins online (amber when any is full or offline), recycling
 * kiosks with what they collected, loops with their checkpoints, and patrol points. Same data as the tabs.
 */
function PlacesSummary({ onPick }: { onPick: (tab: Tab) => void }) {
  const machines = useApi<Machine[]>('/admin/kitar/machines', { refreshInterval: 10_000 });
  const kiosks = useApi<Kiosk[]>('/admin/kitar/kiosks');
  const loops = useApi<Loop[]>('/admin/gerak/loops');
  const points = useApi<PatrolPoint[]>('/admin/patrol-points');
  const loading = useMinLoading('places-summary', !machines.data || !kiosks.data || !loops.data || !points.data);
  if (loading) return <div className="mb-6"><SkeletonStats count={4} /></div>;
  const m = machines.data!;
  const online = m.filter((x) => x.status === 'ONLINE').length;
  const full = m.filter((x) => x.status === 'FULL').length;
  const offline = m.length - online - full;
  // Only loops residents can use count, so this matches the Gerak page; hidden ones are noted beside it.
  const live = loops.data!.filter((l) => l.active);
  const hidden = loops.data!.length - live.length;
  const checkpoints = live.reduce((sum, l) => sum + l.checkpoints.length, 0);
  // Grouped by feature, with the feature named above its tiles.
  const group = (module: ModuleKey, children: ReactNode, span = '') => (
    <div className={cn('space-y-2', span)}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
        {(() => { const Icon = MODULES[module].icon; return <Icon className="size-3.5" aria-hidden />; })()}
        <Text>{MODULES[module].name}</Text> · <Text>{MODULES[module].what}</Text>
      </p>
      <div className={cn('grid gap-4', span ? 'sm:grid-cols-2' : '')}>{children}</div>
    </div>
  );
  return (
    <div className="mb-6 grid gap-x-4 gap-y-5 lg:grid-cols-4">
      {group('KITAR', <>
        <Stat label="Kiosk bins online" value={online} icon={Cpu} tone={full || offline ? 'warning' : 'success'} hint={`of ${m.length} · ${full} full · ${offline} offline`} onClick={() => onPick('machines')} />
        <Stat label="Recycling kiosks" value={kiosks.data!.length} icon={Recycle} hint={`${formatKg(kiosks.data!.reduce((sum, k) => sum + k.total_g, 0))} collected`} onClick={() => onPick('kiosks')} />
      </>, 'lg:col-span-2')}
      {group('GERAK', <Stat label="Loops live on Gerak" value={live.length} icon={Footprints} hint={hidden ? `${checkpoints} checkpoints · ${hidden} hidden` : `${checkpoints} checkpoints`} onClick={() => onPick('loops')} />)}
      {group('GUARDS', <Stat label="Patrol points" value={points.data!.length} icon={Route} tone="neutral" hint="Scanned by guards on their rounds" onClick={() => onPick('patrol')} />)}
    </div>
  );
}

function Kiosks({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const kiosks = useApi<Kiosk[]>('/admin/kitar/kiosks');
  // SDP HQ works across townships, so it says which one the kiosk is in.
  const me = useApi<Me>('/me');
  const hq = me.data?.role === 'HQ_ADMIN';
  // Adding a kiosk is set-up work for township admins and SDP HQ, like adding a bin.
  const canSetUp = me.data ? ADMINS.includes(me.data.role) : false;
  const townships = useApi<{ id: string; name: string }[]>(hq ? '/townships' : null);
  const create = useAction((body: { name: string; location: string; townshipId?: string }) => api.post('/admin/kitar/kiosks', body), { success: 'Kiosk added.', onSuccess: () => void kiosks.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = Object.fromEntries(new FormData(element)) as Record<string, string>;
    void create.run({ name: form.name!, location: form.location!, townshipId: hq ? form.townshipId || undefined : undefined }).then((ok) => ok && element.reset());
  };
  return (
    <div className="space-y-5">
      {canSetUp && (
        <Card>
          <CardHeader title="Add a kiosk" />
          <form method="post" onSubmit={submit} className={hq ? 'grid gap-4 p-5 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-start' : 'grid gap-4 p-5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-start'} noValidate>
            {hq && (
              <Select label="Township" name="townshipId" defaultValue="" required error={create.fields.townshipId}>
                <option value="" disabled><Text>Choose a township</Text></option>
                {(townships.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            <Input label="Name" name="name" maxLength={80} required error={create.fields.name} />
            <Input label="Where it is" name="location" maxLength={160} required error={create.fields.location} />
            <Button type="submit" pending={create.pending} className="sm:mt-[26px]">
              <Plus className="size-4" aria-hidden /><Text>Add</Text></Button>
          </form>
        </Card>
      )}
      <Async state={kiosks}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No kiosks yet">{canSetUp && <Text>Add the first recycling kiosk above.</Text>}</EmptyState>
          ) : (
            <div className="stagger-in grid gap-4 md:grid-cols-2">
              {list.map((k) => (
                <Card key={k.id} className="flex items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ink-900">{k.name}</p>
                    <p className="text-sm text-ink-600"><Text>{k.location}</Text>{hq && ` · ${k.township}`}</p>
                    <p className="mt-1 text-sm text-ink-500"><Text>{formatKg(k.total_g)}</Text><Text> collected</Text></p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => onPoster({ title: k.name, subtitle: `Recycling kiosk · ${k.location}`, code: k.code, path: '/app/kitar?kiosk=' })}>
                    <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
    </div>
  );
}

/**
 * The Gerak loops on the same map residents see (Google Maps when it is set up, the built-in map otherwise),
 * for staff to review. Live loops are drawn as residents see them; hidden ones can be added to preview them
 * before showing them again. "View on map" on a card highlights and frames that loop.
 */
function LoopsMap({ loops, focusId, focusKey, onClear }: { loops: Loop[]; focusId: string | null; focusKey: number; onClear: () => void }) {
  const [withHidden, setWithHidden] = useState(false);
  const focused = loops.find((l) => l.id === focusId) ?? null;
  // A hidden loop appears only when asked for: with the switch, or when its own card asked to view it.
  const shown = loops.filter((l) => l.active || withHidden || l.id === focusId);
  const mapLoops: MapLoop[] = shown.filter((l) => l.path.length > 1).map((l) => ({ id: l.id, name: l.name, mode: l.mode, path: l.path }));
  const mapCheckpoints: MapCheckpoint[] = shown.flatMap((l) =>
    l.checkpoints.filter((cp) => cp.lat !== null && cp.lng !== null).map((cp) => ({ id: cp.id, loop_id: l.id, name: cp.name, lat: cp.lat!, lng: cp.lng!, radius_m: cp.radius_m })),
  );
  const hiddenCount = loops.filter((l) => !l.active).length;
  return (
    <Card id="loops-map" className="scroll-mt-24">
      <CardHeader
        title="Loops on the map"
        description="What residents see on Gerak. Use View on map on a loop to check its route and checkpoints before printing posters or showing it again."
      />
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-600" role="status">
            {focused ? (
              <>
                <Text>Showing </Text><span className="truncate font-semibold text-ink-900">{focused.name}</span>
                {!focused.active && <Badge tone="warning"><EyeOff className="size-3.5" aria-hidden /><Text>Hidden from residents</Text></Badge>}
              </>
            ) : (
              <Text>{withHidden ? 'All loops, including hidden ones' : 'Loops live on Gerak'}</Text>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {hiddenCount > 0 && (
              <Checkbox label={hiddenCount === 1 ? 'Include the hidden loop' : `Include ${hiddenCount} hidden loops`} checked={withHidden} onChange={(event) => setWithHidden(event.target.checked)} />
            )}
            {focused && (
              <Button variant="secondary" size="sm" onClick={onClear}><X className="size-4" aria-hidden /><Text>Show all loops</Text></Button>
            )}
          </div>
        </div>
        <TownshipMap loops={mapLoops} checkpoints={mapCheckpoints} focusLoopId={focusId} viewKey={`${focusKey}:${withHidden}`} />
      </div>
    </Card>
  );
}

/**
 * Show a loop to residents again, or hide it: says plainly what changes for residents, and asks for a
 * reason, which is kept in the audit log. Township admins and SDP HQ only (the server checks it too).
 */
function LoopVisibilityDialog({ loop, onClose, onDone }: { loop: Loop | null; onClose: () => void; onDone: (loopId: string) => void }) {
  const [reason, setReason] = useState('');
  const showing = loop ? !loop.active : false;
  const save = useAction(
    () => api.post(`/admin/gerak/loops/${loop!.id}/visibility`, { active: !loop!.active, reason: reason.trim() }),
    {
      success: showing ? 'The loop is live on Gerak again.' : 'The loop is hidden from residents.',
      onSuccess: () => {
        const id = loop!.id;
        setReason('');
        onDone(id);
      },
    },
  );
  return (
    <Modal
      open={loop !== null}
      onClose={() => { setReason(''); onClose(); }}
      title={showing ? 'Show this loop to residents?' : 'Hide this loop from residents?'}
      description={loop?.name}
      footer={
        <>
          <Button variant="secondary" onClick={() => { setReason(''); onClose(); }}><Text>Cancel</Text></Button>
          <Button variant={showing ? 'primary' : 'danger'} pending={save.pending} disabled={reason.trim().length < 3} onClick={() => void save.run()}>
            {showing ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
            <Text>{showing ? 'Show to residents' : 'Hide from residents'}</Text>
          </Button>
        </>
      }
    >
      {loop && (
        <div className="space-y-4 text-[15px] text-ink-700">
          <ul className="list-disc space-y-1.5 pl-5">
            {showing ? (
              <>
                <li><Text>It appears on the Gerak page and map for every resident at once.</Text></li>
                <li><Text>Its checkpoint posters can be scanned, and tracked trips count it, including distance on the loop.</Text></li>
                <li><Text>Print its posters from this page once it is live.</Text></li>
              </>
            ) : (
              <>
                <li><Text>It disappears from the Gerak page and map for every resident at once.</Text></li>
                <li><Text>Its posters stop working, and trips no longer count it. What residents already earned stays.</Text></li>
              </>
            )}
          </ul>
          {showing && !loop.mapped && (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700"><Text>This loop has no drawn route, so only its posters will work until the route is drawn.</Text></p>
          )}
          <Textarea label="Reason" hint="Kept in the audit log with your name." value={reason} onChange={(event) => setReason(event.target.value)} rows={3} error={save.fields.reason} />
        </div>
      )}
    </Modal>
  );
}

/**
 * One Gerak loop for staff: whether residents see it, whether its route is drawn on the map (tracking and
 * distance on the loops need it), and each checkpoint with its poster. A hidden loop shows no posters.
 */
function LoopCard({ loop, onPoster, onView, onToggle, focused }: { loop: Loop; onPoster: (poster: Poster) => void; onView: () => void; onToggle?: () => void; focused: boolean }) {
  const unplaced = loop.checkpoints.filter((cp) => !cp.located).length;
  const change = loop.lastChange;
  return (
    <Card className={cn('flex flex-col p-5 transition-[box-shadow,border-color] duration-200', !loop.active && 'border-dashed bg-ink-25/60', focused && 'border-brand-300 ring-2 ring-brand-500')}>
      <div className="flex flex-wrap items-center gap-2">
        {loop.active ? <Badge tone="success"><Text>Live on Gerak</Text></Badge> : <Badge><EyeOff className="size-3.5" aria-hidden /><Text>Hidden</Text></Badge>}
        <Badge tone="brand"><Text>{loop.mode === 'CYCLE' ? 'Cycling' : 'Walking'}</Text></Badge>
        <Badge><Text>{formatKm(loop.distance_m)}</Text></Badge>
        {loop.mapped ? <Badge><MapPin className="size-3.5" aria-hidden /><Text>Route on the map</Text></Badge> : <Badge tone="warning"><Text>Route not drawn</Text></Badge>}
      </div>
      <h2 className="mt-3 text-[17px] font-semibold">{loop.name}</h2>
      <p className="mt-1 text-[15px] text-ink-600">{loop.description}</p>
      {loop.active && (!loop.mapped || unplaced > 0) && (
        <p className="mt-3 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <Text>{!loop.mapped ? 'Without a drawn route, trips cannot tick checkpoints by GPS or count distance on this loop; only posters work.' : unplaced === 1 ? '1 checkpoint has no map location, so GPS cannot tick it.' : `${unplaced} checkpoints have no map location, so GPS cannot tick them.`}</Text>
        </p>
      )}
      <ol className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
        {loop.checkpoints.map((cp) => (
          <li key={cp.id} style={{ '--i': cp.seq } as CSSProperties} className="value-line -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-[15px]">
            <span className="min-w-0 truncate">
              <span className="mr-2 text-ink-500 tabular-nums"><Text>{cp.seq}</Text>.</span>
              {cp.name}
            </span>
            {loop.active && (
              <Button variant="ghost" size="sm" onClick={() => onPoster({ title: cp.name, subtitle: `${loop.name} · checkpoint ${cp.seq} of ${loop.checkpoints.length}`, code: cp.code, path: '/app/gerak?code=' })}>
                <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
            )}
          </li>
        ))}
      </ol>
      {/* Who last showed or hid it, and why, from the audit log. */}
      {change ? (
        <p className="mt-3 text-xs text-ink-500">
          <Text>{change.action === 'LOOP_SHOWN' ? 'Shown to residents' : 'Hidden'}</Text>
          <Text>{` ${formatDateTime(change.at)}`}</Text>
          {change.by && <><Text>{' by '}</Text><span className="font-medium text-ink-700">{change.by}</span>{change.role && <Text>{` (${ROLE_LABELS[change.role]})`}</Text>}</>}
          {change.reason && <span className="block"><Text>Reason: </Text>“<Text>{change.reason}</Text>”</span>}
        </p>
      ) : !loop.active ? (
        <p className="mt-3 text-xs text-ink-500"><Text>Hidden in a data update, before changes were made here.</Text></p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-4">
        <Button variant="secondary" size="sm" onClick={onView} disabled={!loop.mapped} title={loop.mapped ? undefined : 'This loop has no drawn route yet.'}>
          <MapPin className="size-4" aria-hidden /><Text>View on map</Text></Button>
        {onToggle && (
          <Button variant={loop.active ? 'ghost' : 'secondary'} size="sm" onClick={onToggle}>
            {loop.active ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            <Text>{loop.active ? 'Hide from residents' : 'Show to residents'}</Text>
          </Button>
        )}
      </div>
    </Card>
  );
}

function Loops({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const loops = useApi<Loop[]>('/admin/gerak/loops');
  const me = useApi<Me>('/me');
  // Showing or hiding a loop changes what every resident sees, so it is for township admins and SDP HQ.
  const canToggle = me.data ? ADMINS.includes(me.data.role) : false;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [toggling, setToggling] = useState<Loop | null>(null);
  const viewOnMap = (id: string) => {
    setFocusId(id);
    setFocusKey((n) => n + 1);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('loops-map')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };
  const [creating, setCreating] = useState(false);
  const create = useAction((body: Record<string, unknown>) => api.post('/admin/gerak/loops', body), {
    success: 'Loop created. Print a poster for each checkpoint.',
    onSuccess: () => {
      setCreating(false);
      void loops.mutate();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void create.run({
      name: form.name,
      description: form.description,
      mode: form.mode,
      distanceM: Math.round(Number(form.km) * 1000),
      checkpoints: (form.checkpoints ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
    });
  };
  const f = create.fields;
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /><Text>New loop</Text></Button>
      </div>
      <Async state={loops}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No loops yet" action={<Button onClick={() => setCreating(true)}><Text>New loop</Text></Button>}><Text>Create a walking or cycling loop with two or more checkpoints.</Text></EmptyState>
          ) : (
            <div className="space-y-8">
              <LoopsMap loops={list} focusId={focusId} focusKey={focusKey} onClear={() => setFocusId(null)} />
              <div className="stagger-in grid gap-4 lg:grid-cols-2">
                {list.filter((l) => l.active).map((loop) => (
                  <LoopCard key={loop.id} loop={loop} onPoster={onPoster} onView={() => viewOnMap(loop.id)} onToggle={canToggle ? () => setToggling(loop) : undefined} focused={focusId === loop.id} />
                ))}
              </div>
              {list.some((l) => !l.active) && (
                <section aria-labelledby="hidden-loops" className="space-y-3">
                  <div>
                    <h2 id="hidden-loops" className="text-base font-semibold text-ink-900"><Text>Hidden from residents</Text></h2>
                    <p className="text-sm text-ink-500"><Text>Kept for the record. Residents do not see these on Gerak, and their checkpoints cannot be scanned or tracked, so there are no posters to print.</Text></p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {list.filter((l) => !l.active).map((loop) => (
                      <LoopCard key={loop.id} loop={loop} onPoster={onPoster} onView={() => viewOnMap(loop.id)} onToggle={canToggle ? () => setToggling(loop) : undefined} focused={focusId === loop.id} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        }
      </Async>

      <LoopVisibilityDialog
        loop={toggling}
        onClose={() => setToggling(null)}
        onDone={(loopId) => {
          setToggling(null);
          void loops.mutate();
          setFocusId(loopId);
          setFocusKey((n) => n + 1);
        }}
      />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New loop"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}><Text>Cancel</Text></Button>
            <Button type="submit" form="create-loop" pending={create.pending}><Text>Create loop</Text></Button>
          </>
        }
      >
        <form method="post" id="create-loop" onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Name" name="name" maxLength={80} required error={f.name} />
          <Textarea label="Description" name="description" maxLength={300} required error={f.description} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="For" name="mode" defaultValue="WALK">
              <option value="WALK"><Text>Walking</Text></option>
              <option value="CYCLE"><Text>Cycling</Text></option>
            </Select>
            <Input label="Distance (km)" name="km" type="number" min={0.1} max={100} step={0.1} required error={f.distanceM} />
          </div>
          <Textarea label="Checkpoints, one per line, in order" name="checkpoints" rows={4} required error={f.checkpoints} hint="Between 2 and 12. A resident must scan all of them on the same day." />
        </form>
      </Modal>
    </div>
  );
}

const MACHINE_TONE = { ONLINE: 'success', FULL: 'warning', OFFLINE: 'neutral' } as const;

function Machines() {
  const machines = useApi<Machine[]>('/admin/kitar/machines', { refreshInterval: 10_000 });
  return (
    <Async state={machines}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={Cpu} title="No kiosk bins yet"><Text>An admin puts a bin at a kiosk. Its signing key is made on the server and never shown here.</Text></EmptyState>
        ) : (
          <div className="stagger-in grid gap-4 md:grid-cols-2">
            {list.map((m) => (
              <Card key={m.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-md bg-brand-50 text-brand-700">
                    <Cpu className="size-5" aria-hidden />
                  </span>
                  <Badge tone={MACHINE_TONE[m.status]}><span aria-hidden className={cn('status-dot', m.status === 'ONLINE' ? 'is-ok' : m.status === 'FULL' ? 'is-warning is-pulsing' : 'is-idle')} /><Text>{m.status === 'ONLINE' ? 'Online' : m.status === 'FULL' ? 'Bin full' : 'Offline'}</Text></Badge>
                </div>
                <p className="mt-3 text-[17px] font-semibold text-ink-900">{m.name}</p>
                <p className="text-sm text-ink-600"><Text>At </Text><Text>{m.kiosk}</Text><Text>{m.last_seen_at ? ` · last record ${timeAgo(m.last_seen_at)}` : ''}</Text></p>
                <p className="mt-2 text-sm text-ink-500"><Text>Last 24 hours: </Text><Text>{m.sessions_today}</Text><Text> session</Text><Text>{m.sessions_today === 1 ? '' : 's'}</Text> · <Text>{formatKg(m.grams_today)}</Text>
                </p>
                <Button href={`/console/machine/${m.id}`} variant="secondary" size="sm" className="mt-4">
                  <MonitorSmartphone className="size-4" aria-hidden /><Text>Open kiosk bin screen</Text></Button>
              </Card>
            ))}
          </div>
        )
      }
    </Async>
  );
}

function Patrol({ onPoster }: { onPoster: (poster: Poster) => void }) {
  const points = useApi<PatrolPoint[]>('/admin/patrol-points');
  return (
    <Async state={points}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={Route} title="No patrol points yet" />
        ) : (
          <Card>
            <ol className="divide-y divide-ink-100">
              {list.map((pt) => (
                <li key={pt.id} style={{ '--i': pt.seq } as CSSProperties} className="value-line flex items-center justify-between gap-3 px-5 py-3 text-[15px]">
                  <span>
                    <span className="mr-2 text-ink-500 tabular-nums"><Text>{pt.seq}</Text>.</span>
                    {pt.name}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => onPoster({ title: pt.name, subtitle: `Patrol point ${pt.seq}`, code: pt.code, path: '/guard?patrol=' })}>
                    <QrIcon className="size-4" aria-hidden /><Text>Poster</Text></Button>
                </li>
              ))}
            </ol>
          </Card>
        )
      }
    </Async>
  );
}
