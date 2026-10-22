'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { BellRing, CalendarClock, Flag, Package, CheckCircle2, Clock, DoorOpen, History, LockKeyhole, MapPin, RefreshCw, Store, Undo2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Skeleton, SkeletonCard } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Input } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatHour, PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

export interface CounterInfo {
  id: string;
  name: string;
  location: string;
  instructions: string;
  openFromHour: number;
  openToHour: number;
  hours: string;
  open: boolean;
}

interface LockerParcel {
  id: string;
  company: string;
  trackingNo: string;
  size: string;
  state: ParcelState;
  station: { name: string; code: string; location: string };
  compartment: string | null;
  counter: (Omit<CounterInfo, 'id'>) | null;
  reason: string | null;
  readyAt: string | null;
  days: number;
  overdue: boolean;
  collectedAt: string | null;
  pin: string | null;
  qr: string | null;
  simulated: boolean;
  needsConfirmation: boolean;
  canRenewCode: boolean;
  canReport: boolean;
  reported: boolean;
  referred: boolean;
  canReportLive: boolean;
  keypad: { locked: boolean; staffTold: boolean } | null;
}

/** The household's locker view: its own door, the guardhouse (open now or not), its parcels and its late collections. */
export interface MyLockers {
  timeZone: string;
  policy: { overdueAfterDays: number; doorReminderHours: number; callAfterDays: number };
  door: { label: string; size: string; station: string; location: string; code: string } | null;
  counters: CounterInfo[];
  lateCollections: { id: string; company: string; trackingNo: string; collectedAt: string; days: number; counter: string | null }[];
  parcels: LockerParcel[];
}

export const MY_LOCKERS = '/lockers/my-parcels';

const TONE: Partial<Record<ParcelState, 'success' | 'warning' | 'danger' | 'gold' | 'brand'>> = {
  READY_FOR_COLLECTION: 'success', OVERDUE: 'warning', RELOCATION_PENDING: 'warning', RELOCATION_IN_PROGRESS: 'warning', RELOCATED_TO_STORAGE: 'gold',
  COLLECTION_IN_PROGRESS: 'brand', RETURN_PENDING: 'danger', EXCEPTION: 'danger',
};
const newKey = () => crypto.randomUUID();
const dayCount = (days: number) => (days === 1 ? '1 day' : `${days} days`);

/**
 * Whether the guardhouse is open now, in words a resident can act on: "Guardhouse closed",
 * with the opening hours beneath. Refreshed with the parcels, so it changes over at opening and closing time.
 */
export function CounterStatus({ counter, className }: { counter: CounterInfo; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('counter-status flex items-start gap-3 rounded-xl border p-4 transition-colors duration-300', counter.open ? 'border-success-600/25 bg-success-50/70' : 'border-ink-200 bg-ink-25', className)}>
      <span aria-hidden className={cn('relative mt-1 grid size-3 shrink-0 place-items-center')}>
        <span className={cn('status-dot', counter.open ? 'is-ok is-pulsing' : 'is-idle')} />
      </span>
      <div className="min-w-0">
        <p className={cn('font-display text-base font-bold', counter.open ? 'text-success-700' : 'text-ink-900')}><Text>{counter.open ? 'Guardhouse open' : 'Guardhouse closed'}</Text></p>
        <p className="text-sm font-medium text-ink-700"><Text>{`Open ${formatHour(counter.openFromHour)} to ${formatHour(counter.openToHour)}`}</Text></p>
        <p className="mt-0.5 text-xs text-ink-500">{counter.name}</p>
      </div>
    </div>
  );
}

/** The home's own locker door, or how it gets one. */
function DoorCard({ door }: { door: MyLockers['door'] }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-brand-700 shadow-xs"><DoorOpen className="size-5" /></span>
      <div className="min-w-0">
        <p className="font-display text-base font-bold text-ink-900">{door ? <Text>{`Your locker door: ${door.label}`}</Text> : <Text>Your own locker door</Text>}</p>
        {door
          ? <p className="text-sm text-ink-700">{door.station} · <Text>{`size ${door.size}`}</Text><br /><span className="text-ink-500">{door.location} · <Text>open 24 hours</Text></span></p>
          : <p className="text-sm text-ink-600"><Text>Your home gets its own private door with its first locker parcel, and keeps it.</Text></p>}
      </div>
    </div>
  );
}

/** The shape the locker view loads into: the two status cards, then a parcel card. */
function LockersSkeleton() {
  return (
    <LocalizedDiv role="status" aria-label="Loading" aria-busy="true" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => <SkeletonCard key={i} className="flex items-start gap-3 p-4"><Skeleton className="size-10 shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-48" /></div></SkeletonCard>)}
      </div>
      <SkeletonCard className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 p-5"><div className="flex-1"><Skeleton className="h-5 w-40" /><Skeleton className="mt-2 h-3 w-28" /></div><Skeleton className="h-5 w-24 rounded-full" /></div>
        <div className="flex items-center gap-5 p-5"><Skeleton className="size-[124px] shrink-0" /><div className="flex-1 space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-32" /></div></div>
      </SkeletonCard>
    </LocalizedDiv>
  );
}

/** Locker parcels kept at the guardhouse because they could not go into the home's door. */
const atGuardhouse = (p: { state: ParcelState }) => p.state === 'RELOCATED_TO_STORAGE' || p.state === 'RETURN_PENDING';

/**
 * Locker parcels for the household: where each is, the QR code and PIN, and how long it has waited. The Parcel
 * lockers tab shows the home's own door and what is in it; the Guardhouse tab shows the locker parcels kept there.
 */
export function LockerParcels({ view = 'doors' }: { view?: 'doors' | 'guardhouse' }) {
  return (
    <Suspense fallback={<LockersSkeleton />}>
      <LockerParcelList view={view} />
    </Suspense>
  );
}

function LockerParcelList({ view }: { view: 'doors' | 'guardhouse' }) {
  const search = useSearchParams();
  const station = (search.get('station') ?? '').toUpperCase();
  const parcelId = search.get('parcel');
  const scrolledTo = useRef<string | null>(null);
  const mine = useApi<MyLockers>(MY_LOCKERS, { refreshInterval: 5_000 });
  const [reporting, setReporting] = useState<LockerParcel | null>(null);
  useEffect(() => {
    if (parcelId && mine.data && scrolledTo.current !== parcelId) {
      const target = document.getElementById(`parcel-${parcelId}`);
      if (target) { target.scrollIntoView({ block: 'center' }); scrolledTo.current = parcelId; }
    }
  }, [parcelId, mine.data]);
  if (!mine.data) return <LockersSkeleton />;
  const data = mine.data;
  const live = data.parcels.filter((p) => !['COLLECTED', 'RETURNED'].includes(p.state) && (view === 'guardhouse' ? atGuardhouse(p) : !atGuardhouse(p)));
  if (view === 'guardhouse') {
    // Above the parcels the guard keeps on the shelf: whether the guardhouse is open, then the locker parcels kept there.
    return (
      <LocalizedDiv className="space-y-4" aria-label="Smart locker parcels at the guardhouse">
        {data.counters.length > 0 && <div className="stagger-in grid gap-3 sm:grid-cols-2">{data.counters.map((c) => <CounterStatus key={c.id} counter={c} />)}</div>}
        {live.length > 0 && <div className="stagger-in grid gap-4 2xl:grid-cols-2">
          {live.map((p) => <div key={p.id} id={`parcel-${p.id}`} className={`scroll-mt-20 rounded-xl ${parcelId === p.id ? 'ring-2 ring-brand-400' : ''}`}><LockerCard parcel={p} policy={data.policy} atStation={station} onChange={() => void mine.mutate()} /></div>)}
        </div>}
      </LocalizedDiv>
    );
  }
  const completed = data.parcels.filter((p) => ['COLLECTED', 'RETURNED'].includes(p.state));
  const done = completed.filter((p, index) => index < 5 || p.id === parcelId);
  const atTheGuardhouse = data.parcels.filter((p) => atGuardhouse(p)).length;
  return (
    <LocalizedDiv className="space-y-4" aria-label="Parcel lockers">
      <DoorCard door={data.door} />
      {live.length === 0 && completed.length === 0 ? (
        <EmptyState icon={Package} title="Nothing in your locker"><Text>When a courier puts a parcel in your home’s locker door, you are told at once and the code appears here.</Text></EmptyState>
      ) : live.length === 0 && <p className="text-[15px] text-ink-600"><Text>Nothing in your locker right now.</Text></p>}
      {atTheGuardhouse > 0 && <p className="flex items-center gap-2 rounded-lg bg-gold-50 p-3 text-sm text-gold-700"><Store className="size-4 shrink-0" aria-hidden /><Text>{atTheGuardhouse === 1 ? 'You also have a parcel at the guardhouse. See the Guardhouse tab.' : `You also have ${atTheGuardhouse} parcels at the guardhouse. See the Guardhouse tab.`}</Text></p>}
      {/* One column beside the How to collect guide; two only on very wide screens. */}
      <div className="stagger-in grid gap-4 2xl:grid-cols-2">
        {live.map((p) => <div key={p.id} id={`parcel-${p.id}`} className={`scroll-mt-20 rounded-xl ${parcelId === p.id ? 'ring-2 ring-brand-400' : ''}`}><LockerCard parcel={p} policy={data.policy} atStation={station} onChange={() => void mine.mutate()} /></div>)}
      </div>
      {done.length > 0 && (
        <Card>
          <CardHeader title="Collected" description="The most recent, from the last 30 days." />
          <ul className="divide-y divide-ink-100">
            {done.map((p) => (
              <li key={p.id} id={`parcel-${p.id}`} className={`flex scroll-mt-20 flex-wrap items-center justify-between gap-3 px-5 py-3 ${parcelId === p.id ? 'bg-brand-50' : ''}`}>
                <span className="text-[15px] text-ink-900">{p.company} <span className="text-ink-500">· {p.trackingNo}</span></span>
                <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-ink-600">
                  {p.state === 'COLLECTED' ? <CheckCircle2 className="size-4 text-success-700" aria-hidden /> : <Undo2 className="size-4 text-ink-400" aria-hidden />}
                  <Text>{PARCEL_STATE_LABELS[p.state]}</Text>{p.collectedAt && <> · <Text>{formatDateTime(p.collectedAt)}</Text></>}
                  {p.reported ? (
                    <Badge tone="warning"><Text>Reported</Text></Badge>
                  ) : p.referred ? (
                    <Badge tone="neutral"><Text>Sent to the courier</Text></Badge>
                  ) : p.canReport && (
                    <Button size="sm" variant="ghost" onClick={() => setReporting(p)}><Flag className="size-4" aria-hidden /><Text>Report</Text></Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ReportProblemDialog
        open={reporting !== null}
        onClose={() => setReporting(null)}
        context="LOCKER_DONE"
        lockerParcelId={reporting?.id}
        subtitle={reporting ? `${reporting.company} · ${reporting.trackingNo}` : undefined}
        onFiled={() => void mine.mutate()}
      />
    </LocalizedDiv>
  );
}

/** The household's own record of parcels collected late from the guardhouse, as staff see it. Shown on the Guardhouse tab. */
export function MyLateCollections() {
  const mine = useApi<MyLockers>(MY_LOCKERS, { refreshInterval: 30_000 });
  if (!mine.data || mine.data.lateCollections.length === 0) return null;
  return <LateCollections late={mine.data.lateCollections} overdueAfterDays={mine.data.policy.overdueAfterDays} />;
}

function LateCollections({ late, overdueAfterDays }: { late: MyLockers['lateCollections']; overdueAfterDays: number }) {
  return (
    <Card>
      <CardHeader title="My late collections" description={`Parcels collected from the guardhouse more than ${dayCount(overdueAfterDays)} after they arrived, in the last 12 months.`} />
      <ul className="divide-y divide-ink-100">
        {late.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <span className="min-w-0">
              <span className="block text-[15px] text-ink-900">{l.company} <span className="text-ink-500">· {l.trackingNo}</span></span>
              <span className="block text-sm text-ink-500"><Text>{`Collected ${formatDate(l.collectedAt)}`}</Text>{l.counter && <> · {l.counter}</>}</span>
            </span>
            <Badge tone="warning"><History className="size-3" aria-hidden /><Text>{`${dayCount(l.days)} uncollected`}</Text></Badge>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 border-t border-ink-100 bg-ink-25/60 px-5 py-3 text-xs text-ink-500">
        <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span><Text>No charges apply. A late-collection storage charge is being considered for the future; you would be told well in advance.</Text></span>
      </p>
    </Card>
  );
}

function LockerCard({ parcel: p, policy, atStation, onChange }: { parcel: LockerParcel; policy: MyLockers['policy']; atStation: string; onChange: () => void }) {
  const [code, setCode] = useState(atStation === p.station.code ? atStation : '');
  const [renewOpen, setRenewOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const open = useAction(() => api.post<{ compartment: string; command: { status: string; error: string | null } }>(`/lockers/parcels/${p.id}/open`, { stationCode: code.trim(), idempotencyKey: newKey() }), {
    success: (r) => (r.command.status === 'FAILED' ? null : `Door ${r.compartment} is opening.`),
    onSuccess: onChange,
  });
  const close = useAction((itemPresent: boolean) => api.post(`/lockers/parcels/${p.id}/simulate-close`, { itemPresent }), { onSuccess: onChange });
  const confirm = useAction(() => api.post(`/lockers/parcels/${p.id}/confirm`), { success: 'Collected. Thank you.', onSuccess: onChange });
  const renew = useAction(() => api.post(`/lockers/parcels/${p.id}/new-code`), {
    success: 'Here is your new code. The old one no longer works.',
    onSuccess: () => {
      setRenewOpen(false);
      onChange();
    },
  });
  const askHelp = useAction(() => api.post(`/lockers/parcels/${p.id}/keypad-help`), {
    success: 'Staff have been told. You can still open your door from here.',
    onSuccess: onChange,
  });
  const inLocker = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING'].includes(p.state);
  const atCounter = p.state === 'RELOCATED_TO_STORAGE' || p.state === 'RETURN_PENDING';

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 p-5">
        <div>
          <p className="font-display text-lg font-bold text-ink-900"><Text>{`From ${p.company}`}</Text></p>
          <p className="text-sm text-ink-500">{p.trackingNo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {atCounter && p.overdue && <Badge tone="warning"><Text>Overdue</Text></Badge>}
          <Badge tone={TONE[p.state] ?? 'neutral'}><Text>{atCounter && p.state === 'RELOCATED_TO_STORAGE' ? 'At the guardhouse' : inLocker ? 'In your locker' : PARCEL_STATE_LABELS[p.state]}</Text></Badge>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {atCounter && p.counter ? (
          <div className="space-y-2 rounded-lg bg-gold-50 p-4 text-[15px] text-ink-800">
            <p className="flex items-center gap-2 font-semibold text-gold-700"><Store className="size-4" aria-hidden /><Text>{`At ${p.counter.name}`}</Text></p>
            {p.reason && <p className="text-sm"><Text>{p.reason}</Text></p>}
            <p className="text-sm"><Text>{p.counter.location}</Text> · <span className={cn('font-semibold', p.counter.open ? 'text-success-700' : 'text-ink-700')}><Text>{p.counter.open ? 'Open now' : 'Closed now'}</Text></span> · <Text>{`Open ${formatHour(p.counter.openFromHour)} to ${formatHour(p.counter.openToHour)}`}</Text></p>
            <p className="text-sm"><Text>{p.counter.instructions}</Text></p>
            {p.state === 'RETURN_PENDING' && <p className="text-sm font-semibold text-accent-700"><Text>It is due to go back to the courier. Collect it before they take it.</Text></p>}
          </div>
        ) : (
          <p className="flex items-start gap-2 text-[15px] text-ink-800">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
            <span><strong>{p.station.name}</strong>{p.compartment && <> · <Text>{`door ${p.compartment}`}</Text></>}<br /><span className="text-sm text-ink-500">{p.station.location} · <Text>open 24 hours</Text></span></span>
          </p>
        )}
        {p.readyAt && (inLocker || atCounter) && (
          <p className={cn('inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold', atCounter && p.overdue ? 'text-warning-700' : 'text-ink-700')}>
            <Clock className="size-4" aria-hidden />
            <Text>{p.days === 0 ? 'Under a day' : atCounter ? `${dayCount(p.days)} uncollected` : `Waiting ${dayCount(p.days)}`}</Text>
            <span className="font-normal text-ink-500"> · <Text>{`since ${formatDateTime(p.readyAt)}`}</Text></span>
          </p>
        )}
        {atCounter && p.state === 'RELOCATED_TO_STORAGE' && (
          <p className="text-sm text-ink-600"><Text>{p.overdue
            ? 'Please collect it soon: the guardhouse keeps it for you, and you are reminded once a week. The days it waits are kept in your parcel record.'
            : `It stays here until you collect it. After ${dayCount(policy.overdueAfterDays)} it is marked overdue and you are reminded once a week.`}</Text></p>
        )}

        {p.pin && p.qr && (
          <div className="flex flex-wrap items-center gap-5">
            <QrCode value={p.qr} size={124} label="Pickup QR code" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>{atCounter ? 'Show to the guard' : 'Locker PIN'}</Text></p>
              <p className="parcel-code text-3xl font-bold text-ink-900">{p.pin}</p>
              <p className="mt-1 max-w-56 text-xs text-ink-500"><Text>{atCounter ? 'The guard checks this code and your ID.' : 'Type it on the locker keypad or show the QR code. It works once.'}</Text></p>
              {p.canRenewCode && <Button size="sm" variant="ghost" className="mt-1 -ml-3" onClick={() => setRenewOpen(true)}><RefreshCw className="size-4" aria-hidden /><Text>Get a new code</Text></Button>}
            </div>
          </div>
        )}

        {inLocker && p.keypad?.locked && (
          <div className="space-y-2 rounded-lg bg-warning-50 p-4" role="status">
            <p className="flex items-center gap-2 font-semibold text-warning-700"><LockKeyhole className="size-4" aria-hidden /><Text>The keypad at this locker is locked for safety</Text></p>
            <p className="text-sm text-ink-700"><Text>Too many wrong codes were typed there. You can still open your door below with the station code.</Text></p>
            {p.keypad.staffTold ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-800"><CheckCircle2 className="size-4 text-success-700" aria-hidden /><Text>Staff have been told and will unlock it.</Text></p>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void askHelp.run()} pending={askHelp.pending}><BellRing className="size-4" aria-hidden /><Text>Ask staff to unlock it</Text></Button>
            )}
          </div>
        )}
        {inLocker && (
          <div className="space-y-2 rounded-lg border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900"><Text>At the locker? Open the door from here</Text></p>
            <div className="flex flex-wrap items-end gap-2">
              <Input label="Station code (under its QR code)" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={12} autoComplete="off" className="min-w-0 flex-1 basis-40" />
              <Button onClick={() => void open.run()} pending={open.pending} disabled={code.trim().length < 6}><DoorOpen className="size-4" aria-hidden /><Text>Open my door</Text></Button>
            </div>
          </div>
        )}
        {p.state === 'COLLECTION_IN_PROGRESS' && (
          <div className="space-y-2 rounded-lg bg-brand-50 p-4">
            <p className="font-semibold text-brand-800"><Text>{`Door ${p.compartment} is open. Take your parcel and shut the door.`}</Text></p>
            {p.simulated && !p.needsConfirmation && (
              <div className="flex flex-wrap gap-2">
                <span className="w-full text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Simulated station</Text></span>
                <Button size="sm" onClick={() => void close.run(false)} pending={close.pending}><Text>Take it and shut the door</Text></Button>
                <Button size="sm" variant="secondary" onClick={() => void close.run(true)} disabled={close.pending}><Text>Shut it with the parcel still inside</Text></Button>
              </div>
            )}
            {p.needsConfirmation && <Button size="sm" onClick={() => void confirm.run()} pending={confirm.pending}><Text>I have my parcel and the door is shut</Text></Button>}
          </div>
        )}
        {p.canReportLive && (
          p.reported
            ? <Badge tone="warning"><Text>Reported to the township office</Text></Badge>
            : <Button size="sm" variant="ghost" onClick={() => setReporting(true)}><Flag className="size-4" aria-hidden /><Text>Report a problem</Text></Button>
        )}
        <ReportProblemDialog open={reporting} onClose={() => setReporting(false)} context="LOCKER_WAITING" lockerParcelId={p.id} subtitle={`${p.company} · ${p.trackingNo}`} onFiled={onChange} />
      </div>
      <ConfirmDialog
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        onConfirm={() => void renew.run()}
        title="Get a new pickup code?"
        confirmLabel="Get a new code"
        pending={renew.pending}
      >
        <p className="text-[15px] text-ink-700"><Text>Your current PIN and QR code stop working straight away. Do this if someone else may have seen or been sent them. Others in your home are told.</Text></p>
      </ConfirmDialog>
    </Card>
  );
}
