'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { BellRing, Flag, Package, CheckCircle2, Clock, DoorOpen, LockKeyhole, MapPin, RefreshCw, Store, Undo2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { EmptyState, SkeletonList } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Input } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatRM } from '@/shared/domain';
import { PARCEL_STATE_LABELS, type ParcelState } from '@/shared/lockers';

interface LockerParcel {
  id: string;
  company: string;
  trackingNo: string;
  size: string;
  state: ParcelState;
  station: { name: string; code: string; location: string };
  compartment: string | null;
  counter: { name: string; location: string; hours: string; instructions: string } | null;
  readyAt: string | null;
  deadlineAt: string | null;
  collectedAt: string | null;
  pin: string | null;
  qr: string | null;
  simulated: boolean;
  needsConfirmation: boolean;
  canExtend: boolean;
  canRenewCode: boolean;
  canReport: boolean;
  reported: boolean;
  referred: boolean;
  canReportLive: boolean;
  keypad: { locked: boolean; staffTold: boolean } | null;
  extensions: number;
}
interface Mine {
  policy: { extensionsEnabled: boolean; extensionHours: number; maxExtensions: number; feeEnabled: boolean; feeSen: number | null };
  parcels: LockerParcel[];
}

const TONE: Partial<Record<ParcelState, 'success' | 'warning' | 'danger' | 'gold' | 'brand'>> = {
  READY_FOR_COLLECTION: 'success', OVERDUE: 'warning', RELOCATION_PENDING: 'danger', RELOCATION_IN_PROGRESS: 'warning', RELOCATED_TO_STORAGE: 'gold',
  COLLECTION_IN_PROGRESS: 'brand', RETURN_PENDING: 'danger', EXCEPTION: 'danger',
};
const newKey = () => crypto.randomUUID();

/** Time left to collect, refreshed every minute. */
function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { late: true, text: 'Deadline passed' };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return { late: h < 12, text: h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h left to collect` : `${h} h ${m} min left to collect` };
}

/** Locker parcels for the household: where each is, the QR code and PIN, and how long is left. */
export function LockerParcels() {
  return (
    <Suspense fallback={null}>
      <LockerParcelList />
    </Suspense>
  );
}

function LockerParcelList() {
  const search = useSearchParams();
  const station = (search.get('station') ?? '').toUpperCase();
  const parcelId = search.get('parcel');
  const scrolledTo = useRef<string | null>(null);
  const mine = useApi<Mine>('/lockers/my-parcels', { refreshInterval: 5_000 });
  const [reporting, setReporting] = useState<LockerParcel | null>(null);
  useEffect(() => {
    if (parcelId && mine.data && scrolledTo.current !== parcelId) {
      const target = document.getElementById(`parcel-${parcelId}`);
      if (target) { target.scrollIntoView({ block: 'center' }); scrolledTo.current = parcelId; }
    }
  }, [parcelId, mine.data]);
  if (!mine.data) return <SkeletonList rows={2} />;
  const live = mine.data.parcels.filter((p) => !['COLLECTED', 'RETURNED'].includes(p.state));
  const completed = mine.data.parcels.filter((p) => ['COLLECTED', 'RETURNED'].includes(p.state));
  const done = completed.filter((p, index) => index < 5 || p.id === parcelId);
  if (mine.data.parcels.length === 0) {
    return <EmptyState icon={Package} title="Nothing in the lockers"><Text>When a courier puts a parcel in a locker for your home, you are told at once and the code appears here.</Text></EmptyState>;
  }
  return (
    <LocalizedDiv className="space-y-4" aria-label="Parcel lockers">
      {live.length === 0 && <p className="text-[15px] text-ink-600"><Text>Nothing waiting in the lockers right now.</Text></p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {live.map((p) => <div key={p.id} id={`parcel-${p.id}`} className={`scroll-mt-20 rounded-xl ${parcelId === p.id ? 'ring-2 ring-brand-400' : ''}`}><LockerCard parcel={p} policy={mine.data!.policy} atStation={station} onChange={() => void mine.mutate()} /></div>)}
      </div>
      {done.length > 0 && (
        <Card>
          <CardHeader title="Collected from the lockers" description="The most recent, from the last 30 days." />
          <ul className="divide-y divide-ink-100">
            {done.map((p) => (
              <li key={p.id} id={`parcel-${p.id}`} className={`flex scroll-mt-20 flex-wrap items-center justify-between gap-3 px-5 py-3 ${parcelId === p.id ? 'bg-brand-50' : ''}`}>
                <span className="text-[15px] text-ink-900">{p.company} <span className="text-ink-500">· {p.trackingNo}</span></span>
                <span className="inline-flex items-center gap-1.5 text-sm text-ink-600">
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

function LockerCard({ parcel: p, policy, atStation, onChange }: { parcel: LockerParcel; policy: Mine['policy']; atStation: string; onChange: () => void }) {
  const countdown = useCountdown(p.deadlineAt);
  const [code, setCode] = useState(atStation === p.station.code ? atStation : '');
  const [extendOpen, setExtendOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const open = useAction(() => api.post<{ compartment: string; command: { status: string; error: string | null } }>(`/lockers/parcels/${p.id}/open`, { stationCode: code.trim(), idempotencyKey: newKey() }), {
    success: (r) => (r.command.status === 'FAILED' ? null : `Door ${r.compartment} is opening.`),
    onSuccess: onChange,
  });
  const close = useAction((itemPresent: boolean) => api.post(`/lockers/parcels/${p.id}/simulate-close`, { itemPresent }), { onSuccess: onChange });
  const confirm = useAction(() => api.post(`/lockers/parcels/${p.id}/confirm`), { success: 'Collected. Thank you.', onSuccess: onChange });
  const extend = useAction(() => api.post(`/lockers/parcels/${p.id}/extend`, { agreeFee: policy.feeEnabled }), {
    success: 'You have more time to collect.',
    onSuccess: () => {
      setExtendOpen(false);
      onChange();
    },
  });
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
        <Badge tone={TONE[p.state] ?? 'neutral'}><Text>{PARCEL_STATE_LABELS[p.state]}</Text></Badge>
      </div>
      <div className="space-y-4 p-5">
        {atCounter && p.counter ? (
          <div className="rounded-lg bg-gold-50 p-4 text-[15px] text-ink-800">
            <p className="flex items-center gap-2 font-semibold text-gold-700"><Store className="size-4" aria-hidden /><Text>{`Now at ${p.counter.name}`}</Text></p>
            <p className="mt-1"><Text>{p.counter.location}</Text> · <Text>{p.counter.hours}</Text></p>
            <p className="mt-1 text-sm"><Text>{p.counter.instructions}</Text></p>
            {p.state === 'RETURN_PENDING' && <p className="mt-2 text-sm font-semibold text-accent-700"><Text>It is due to go back to the courier. Collect it before they take it.</Text></p>}
          </div>
        ) : (
          <p className="flex items-start gap-2 text-[15px] text-ink-800">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
            <span><strong>{p.station.name}</strong>{p.compartment && <> · <Text>{`door ${p.compartment}`}</Text></>}<br /><span className="text-sm text-ink-500">{p.station.location}</span></span>
          </p>
        )}
        {countdown && (
          <p className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', countdown.late ? 'text-accent-700' : 'text-ink-700')}>
            <Clock className="size-4" aria-hidden /><Text>{countdown.text}</Text>
            {p.deadlineAt && <span className="font-normal text-ink-500"> · <Text>{`by ${formatDateTime(p.deadlineAt)}`}</Text></span>}
          </p>
        )}
        {p.state === 'RELOCATION_PENDING' && <p className="text-sm text-accent-700"><Text>Past the deadline: staff will move it to the parcel counter soon. You can still collect it from the locker until then.</Text></p>}

        {p.pin && p.qr && (
          <div className="flex flex-wrap items-center gap-5">
            <QrCode value={p.qr} size={124} label="Pickup QR code" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>{atCounter ? 'Show at the counter' : 'Locker PIN'}</Text></p>
              <p className="parcel-code text-3xl font-bold text-ink-900">{p.pin}</p>
              <p className="mt-1 max-w-56 text-xs text-ink-500"><Text>{atCounter ? 'Staff check this code and your ID.' : 'Type it on the locker keypad or show the QR code. It works once.'}</Text></p>
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
        {p.canExtend && (
          <Button size="sm" variant="ghost" onClick={() => setExtendOpen(true)}><Clock className="size-4" aria-hidden /><Text>{`Need more time? Add ${policy.extensionHours} hours`}</Text></Button>
        )}
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
      <ConfirmDialog
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        onConfirm={() => void extend.run()}
        title="More time to collect"
        confirmLabel={policy.feeEnabled ? 'Agree and extend' : 'Extend'}
        pending={extend.pending}
      >
        <p className="text-[15px] text-ink-700">
          <Text>{`Your deadline moves by ${policy.extensionHours} hours.`}</Text> <Text>{policy.maxExtensions === 1 ? 'You can do this once per parcel.' : `You can do this up to ${policy.maxExtensions} times per parcel.`}</Text>
          {policy.feeEnabled && policy.feeSen && <> <Text>{`A storage fee of ${formatRM(policy.feeSen)} applies, as set by the township. SimeTown does not take payment, and the fee never stops you collecting your parcel.`}</Text></>}
        </p>
      </ConfirmDialog>
    </Card>
  );
}
