'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { AlertTriangle, ArrowRight, CheckCircle2, DoorOpen, Flag, Loader2, MapPin, Package, RotateCcw, ScanLine, Users, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AddressPicker } from '@/components/features/address';
import { CameraScan } from '@/components/features/camera-scan';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { CourierParcelWalkthrough } from '@/components/features/parcel-walkthroughs';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { COURIER_PROBLEMS, DELIVERY_PROBLEM_LABELS, LOCKER_SIZE_INFO, LOCKER_SIZES, type CourierProblem, type DeliveryProblem, type LockerSize, type ParcelState } from '@/shared/lockers';
import { ScanShipment } from './scan';

interface Station {
  id: string;
  name: string;
  code: string;
  location: string;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  adapter: string;
  free: Partial<Record<LockerSize, number>> | null;
}
interface Home {
  account: {
    company: string;
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    kind: 'COURIER' | 'MANAGER';
    managedBy: 'TOWNSHIP' | 'COMPANY' | 'FEDERATED';
    blocked: string | null;
    verification: 'NONE' | 'SIMULATED' | 'GATEWAY';
  };
  stations: Station[];
}
interface Status {
  id: string;
  state: ParcelState;
  trackingNo: string;
  size: LockerSize;
  station: string;
  compartment: string | null;
  hasSensors: boolean;
  simulated: boolean;
  failureReason: string | null;
  command: { id: string; status: 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'TIMED_OUT'; error: string | null } | null;
}
/** The guardhouse the courier can take the parcel to, and whether it is open now. */
interface CounterOption {
  id: string;
  name: string;
  location: string;
  hours: string;
  open: boolean;
  status: string;
}
/** Why the household's own door cannot take the parcel, and where it can go instead. */
export interface NoDoor {
  problem: DeliveryProblem;
  otherStation: { id: string; name: string; location: string; allowed: boolean } | null;
  counters: CounterOption[];
}
type Opened = { kind: 'OPENING' } | ({ kind: 'NO_DOOR' } & NoDoor);

const newKey = () => crypto.randomUUID();
const BARCODES = ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix', 'pdf417'];

export function CourierDesk({ initialStation }: { initialStation: string }) {
  const home = useApi<Home>('/courier');
  const [stationCode, setStationCode] = useState(initialStation);
  const [delivery, setDelivery] = useState<{ id: string; noDoor: NoDoor | null } | null>(null);
  const [notVerified, setNotVerified] = useState(false);
  // The resident's delivery code, when the company is not connected or its system is down. Holds the tracking number scanned.
  const [fallback, setFallback] = useState<string | null>(null);
  const station = home.data?.stations.find((s) => s.code === stationCode) ?? null;

  return (
    <>
      <PageHeader action={<CourierParcelWalkthrough />} title="Deliver to a locker" description="Choose the station and scan the parcel’s label. Your courier company and SimeTown check the shipment and the household, then the locker opens the right door. The delivery counts only once the door is shut with the parcel inside." />
      <Async state={home} skeleton={<SkeletonList rows={2} />}>
        {(h) =>
          h.account.kind === 'MANAGER' ? (
            <Card className="space-y-3 p-6">
              <p className="font-display text-lg font-bold text-ink-900"><Text>{`You manage ${h.account.company}’s couriers`}</Text></p>
              <p className="text-[15px] text-ink-600"><Text>Manager accounts add, suspend and reconfirm couriers. They cannot open lockers.</Text></p>
              <Button href="/courier/team"><Users className="size-4" aria-hidden /><Text>Open your team</Text></Button>
            </Card>
          ) : h.account.blocked ? (
            <Card className="p-6">
              <p className="font-display text-lg font-bold text-ink-900"><Text>{h.account.status === 'PENDING' ? 'Your courier account is waiting for approval' : 'You cannot deliver to the lockers right now'}</Text></p>
              <p className="mt-1 text-[15px] text-ink-600"><Text>{h.account.blocked}</Text></p>
              {h.account.status === 'PENDING' && <p className="mt-1 text-[15px] text-ink-600"><Text>The township office checks every courier account and chooses the stations you may use. You will be told when it is approved.</Text></p>}
            </Card>
          ) : !station ? (
            <div className="space-y-4">
              {stationCode && <p className="rounded-md bg-accent-50 px-4 py-3 text-sm text-accent-700"><Text>You do not have access to that station. Choose one below.</Text></p>}
              {h.stations.length === 0 ? (
                <EmptyState icon={MapPin} title="No stations yet"><Text>The township office has not given you any stations yet.</Text></EmptyState>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {h.stations.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setStationCode(s.code)} className="lift flex w-full items-start justify-between gap-3 rounded-lg border border-ink-200 bg-white p-5 text-left shadow-xs">
                        <span>
                          <span className="block font-display text-lg font-bold text-ink-900">{s.name}</span>
                          <span className="block text-sm text-ink-500">{s.location}</span>
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {LOCKER_SIZES.map((size) => <Badge key={size} tone={(s.free?.[size] ?? 0) > 0 ? 'success' : 'neutral'}><Text>{`${size}: ${s.free?.[size] ?? 0} free`}</Text></Badge>)}
                          </span>
                        </span>
                        {s.status === 'ONLINE' ? <ArrowRight className="mt-1 size-5 text-ink-400" aria-hidden /> : <Badge tone="danger"><Text>{s.status === 'OFFLINE' ? 'Offline' : 'Maintenance'}</Text></Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : delivery ? (
            <Delivery key={delivery.id} parcelId={delivery.id} initialNoDoor={delivery.noDoor} onDone={() => { setDelivery(null); setFallback(null); void home.mutate(); }} />
          ) : h.account.verification !== 'NONE' && fallback === null ? (
            <div className="space-y-5">
              <StationBar station={station} company={h.account.company} onChangeStation={() => setStationCode('')} simulated={h.account.verification === 'SIMULATED'} />
              <ScanShipment station={station} onDelivering={(id, noDoor) => setDelivery({ id, noDoor })} onFallback={(tracking) => setFallback(tracking)} />
            </div>
          ) : (
            <RegisterParcel
              station={station}
              company={h.account.company}
              notVerified={notVerified}
              initialTracking={fallback ?? ''}
              codeOnly={h.account.verification !== 'NONE'}
              onBack={h.account.verification !== 'NONE' ? () => setFallback(null) : undefined}
              onChangeStation={() => setStationCode('')}
              onRegistered={(id, verified, noDoor) => {
                setNotVerified(!verified);
                if (verified) setDelivery({ id, noDoor });
              }}
            />
          )
        }
      </Async>
    </>
  );
}

function StationBar({ station, company, simulated, onChangeStation }: { station: Station; company: string; simulated?: boolean; onChangeStation: () => void }) {
  const [reporting, setReporting] = useState(false);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 size-5 text-brand-700" aria-hidden />
        <div>
          <p className="font-semibold text-ink-900">{station.name}</p>
          <p className="text-sm text-ink-500">{station.location} · {company}{simulated && <> · <Text>shipments checked with a simulated company</Text></>}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setReporting(true)}><Flag className="size-4" aria-hidden /><Text>Report a problem</Text></Button>
        <Button size="sm" variant="ghost" onClick={onChangeStation}><Text>Change station</Text></Button>
      </div>
      <ReportProblemDialog open={reporting} onClose={() => setReporting(false)} context="COURIER_STATION" stationId={station.id} subtitle={station.name} />
    </Card>
  );
}

/**
 * The fallback: the courier gives the resident's SimeTown delivery code (or,
 * for a company not connected to SimeTown, the address and the name on the
 * label). Recorded as a low-assurance delivery.
 */
function RegisterParcel({ station, company, notVerified, initialTracking, codeOnly, onBack, onChangeStation, onRegistered }: {
  station: Station; company: string; notVerified: boolean; initialTracking: string; codeOnly: boolean; onBack?: () => void;
  onChangeStation: () => void; onRegistered: (id: string, verified: boolean, noDoor: NoDoor | null) => void;
}) {
  const me = useApi<Me>('/me');
  const [tracking, setTracking] = useState(initialTracking);
  const [size, setSize] = useState<LockerSize | null>(null);
  const [mode, setMode] = useState<'code' | 'address'>('code');
  // Registering also opens the household's own door at once, or says why it cannot be used and where the parcel can go.
  const register = useAction(
    async (body: Record<string, unknown>) => {
      const r = await api.post<{ id: string; verified: boolean }>('/courier/parcels', body);
      if (!r.verified) return { ...r, noDoor: null };
      try {
        const opened = await api.post<Opened>(`/courier/parcels/${r.id}/open`, { idempotencyKey: newKey() });
        return { ...r, noDoor: opened.kind === 'NO_DOOR' ? opened : null };
      } catch {
        // Registered, but no door yet (for example the station just went offline): the next screen offers the way on.
        return { ...r, noDoor: null };
      }
    },
    {
      onSuccess: (r) => {
        if (r.verified) setTracking('');
        onRegistered(r.id, r.verified, r.noDoor);
      },
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recipient = mode === 'code' ? { memberCode: String(form.get('memberCode') ?? '').trim() } : { homeId: String(form.get('homeId') ?? ''), name: String(form.get('labelName') ?? '').trim() };
    void register.run({ stationId: station.id, trackingNo: tracking.trim(), size, recipient });
  };
  return (
    <div className="space-y-5">
      <StationBar station={station} company={company} onChangeStation={onChangeStation} />
      {onBack && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-50 p-4 text-[15px] text-ink-800">
          <p><Text>Your courier company’s system did not answer, so this delivery uses the resident’s SimeTown delivery code. It is recorded as a lower-assurance delivery.</Text></p>
          <Button size="sm" variant="secondary" onClick={onBack}><Text>Back to scanning</Text></Button>
        </div>
      )}
      {notVerified && (
        <p role="alert" className="flex gap-2 rounded-lg bg-accent-50 p-4 text-[15px] text-accent-700">
          <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span><Text>The recipient could not be verified at that address, so the parcel was not put in a locker. It has been recorded as not delivered: follow your company’s return procedure.</Text></span>
        </p>
      )}
      <Card>
        <CardHeader title="1. Scan the parcel" description="Scan the barcode on the label, or type the tracking number." />
        <div className="space-y-4 p-5">
          <CameraScan onCode={(text) => setTracking(text.trim().toUpperCase().slice(0, 40))} label="Scan the barcode" formats={BARCODES} />
          <Input label="Tracking number" value={tracking} onChange={(event) => setTracking(event.target.value.toUpperCase())} maxLength={40} autoComplete="off" spellCheck={false} placeholder="e.g. JT6420019931" error={register.fields.trackingNo} />
        </div>
      </Card>
      <Card>
        <CardHeader title="2. Parcel size" description="The household’s own door opens. If the parcel is too big for it, you are told where to take it." />
        <div className="grid gap-2 p-5 sm:grid-cols-4">
          {LOCKER_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={size === s}
              onClick={() => setSize(s)}
              className={cn('rounded-lg border p-3 text-left transition-colors', size === s ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300')}
            >
              <span className="block font-semibold text-ink-900"><Text>{LOCKER_SIZE_INFO[s].label}</Text> <span className="text-ink-500">({s})</span></span>
              <span className="block text-xs text-ink-500"><Text>{LOCKER_SIZE_INFO[s].hint}</Text></span>
              <span className="mt-1 block text-xs font-medium text-success-700"><Text>{`${station.free?.[s] ?? 0} free`}</Text></span>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="3. Recipient" description="Use the resident’s SimeTown delivery code if the label has it; otherwise choose the address and type the name on the label. You will not see who lives there." />
        <form method="post" onSubmit={submit} className="space-y-4 p-5" noValidate>
          {!codeOnly && (
            <LocalizedDiv className="flex gap-2" role="group" aria-label="How to identify the recipient">
              <Button size="sm" variant={mode === 'code' ? 'primary' : 'secondary'} onClick={() => setMode('code')}><Text>Delivery code</Text></Button>
              <Button size="sm" variant={mode === 'address' ? 'primary' : 'secondary'} onClick={() => setMode('address')}><Text>Address and name</Text></Button>
            </LocalizedDiv>
          )}
          {mode === 'code' ? (
            <Input label="SimeTown delivery code" name="memberCode" maxLength={12} autoCapitalize="characters" placeholder="e.g. BP8BDQ3E" hint="Residents can add it to their delivery address." />
          ) : (
            <>
              <AddressPicker key={me.data?.townshipId ?? 'none'} townshipId={me.data?.townshipId ?? null} />
              <Input label="Name on the label" name="labelName" maxLength={80} />
            </>
          )}
          <Button type="submit" pending={register.pending} disabled={tracking.trim().length < 6 || !size}>
            <ScanLine className="size-4" aria-hidden /><Text>Register and open the door</Text></Button>
        </form>
      </Card>
    </div>
  );
}

/** What the courier is told when the household's own door cannot take the parcel. */
const NO_DOOR_TITLES: Record<DeliveryProblem, string> = {
  TOO_BIG: 'Too big for the household’s door',
  DOOR_FULL: 'The household’s door already has a parcel',
  DOOR_DID_NOT_OPEN: 'The household’s door did not open',
  DOOR_DAMAGED: 'The household’s door is out of use',
  PARCEL_DAMAGED: 'The parcel is damaged',
  NO_DOOR: 'No door is free for this household yet',
  OTHER_STATION: 'The household’s door is at another locker',
  COUNTER_CLOSED: 'The guardhouse is closed',
  OTHER: 'The household’s door cannot be used',
};

/** Follows one delivery from "unlocking" to "delivered", and offers the right next step when anything goes wrong. */
function Delivery({ parcelId, initialNoDoor, onDone }: { parcelId: string; initialNoDoor: NoDoor | null; onDone: () => void }) {
  const status = useApi<Status>(`/courier/parcels/${parcelId}`, { refreshInterval: 1500 });
  const [noDoor, setNoDoor] = useState<NoDoor | null>(initialNoDoor);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const open = useAction((key: string) => api.post<Opened>(`/courier/parcels/${parcelId}/open`, { idempotencyKey: key }), {
    onSuccess: (r) => {
      setNoDoor(r.kind === 'NO_DOOR' ? r : null);
      void status.mutate();
    },
  });
  const close = useAction((itemPresent: boolean) => api.post(`/lockers/parcels/${parcelId}/simulate-close`, { itemPresent }), { onSuccess: () => void status.mutate() });
  const confirm = useAction(() => api.post(`/courier/parcels/${parcelId}/confirm`), { onSuccess: () => void status.mutate() });
  const report = useAction(
    async (body: { reason: CourierProblem; note?: string }, shutFirst: boolean) => {
      // On a simulated station the open door is shut first, as the courier would do at a real one.
      if (shutFirst) await api.post(`/lockers/parcels/${parcelId}/simulate-close`, { itemPresent: false });
      return api.post<{ problem: DeliveryProblem; counters: CounterOption[] }>(`/courier/parcels/${parcelId}/problem`, body);
    },
    {
      success: 'Thank you. The township office has the details.',
      onSuccess: (r) => {
        setReporting(false);
        setNoDoor({ problem: r.problem, otherStation: null, counters: r.counters });
        void status.mutate();
      },
    },
  );
  const moveTo = useAction((stationId: string) => api.post(`/courier/parcels/${parcelId}/station`, { stationId }), {
    onSuccess: () => {
      setNoDoor(null);
      void open.run(newKey());
    },
  });
  const counter = useAction((locationId: string) => api.post<{ counter: string }>(`/courier/parcels/${parcelId}/counter`, { locationId }), {
    success: (r) => `Hand it to the guard at ${r.counter}. It counts as delivered once they receive it.`,
    onSuccess: onDone,
  });
  const fail = useAction((body: { reason: string; problem?: DeliveryProblem }) => api.post(`/courier/parcels/${parcelId}/fail`, body), {
    success: 'Recorded as not delivered today. Keep the parcel for your next round; the household has been told.',
    onSuccess: onDone,
  });

  return (
    <Async state={status} skeleton={<SkeletonList rows={1} />}>
      {(s) => {
        const failed = s.command && (s.command.status === 'FAILED' || s.command.status === 'TIMED_OUT') && s.state === 'VERIFIED';
        const openCounters = noDoor?.counters.filter((c) => c.open) ?? [];
        const canReport = !noDoor && (s.state === 'DEPOSIT_IN_PROGRESS' || (s.state === 'LOCKER_RESERVED' && s.command?.status === 'ACKED') || failed);
        return (
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-5">
                <div>
                  <p className="text-sm text-ink-500">{s.station} · {s.trackingNo}</p>
                  <p className="font-display text-xl font-bold text-ink-900"><Text>{s.compartment ? `Door ${s.compartment}` : noDoor ? 'To the guardhouse' : 'The household’s door'}</Text></p>
                </div>
                <Badge tone="brand"><Text>{`Size ${s.size}`}</Text></Badge>
              </div>
              <div className="p-5" aria-live="polite">
                {s.state === 'READY_FOR_COLLECTION' ? (
                  <Line icon={CheckCircle2} tone="text-success-700" title="Delivered" text={`Door ${s.compartment} is shut with the parcel inside. The household has been told.`} />
                ) : s.state === 'DELIVERY_FAILED' ? (
                  <Line icon={XCircle} tone="text-accent-600" title="Not delivered today" text={s.failureReason ?? ''} />
                ) : noDoor ? (
                  <Line icon={AlertTriangle} tone="text-warning-700" title={NO_DOOR_TITLES[noDoor.problem]}
                    text={noDoor.problem === 'OTHER_STATION' ? 'Deliver it at the household’s own locker, or take it to the guardhouse.' : openCounters.length ? 'Take it to the guardhouse and hand it to the guard. Nothing has been marked as delivered.' : 'The guardhouse is closed now. Keep the parcel and bring it on your next round.'} />
                ) : s.state === 'DEPOSIT_IN_PROGRESS' ? (
                  <div className="space-y-4">
                    <Line icon={DoorOpen} tone="text-brand-700" title={`Door ${s.compartment} is open`} text="Put the parcel in and shut the door firmly." />
                    {s.simulated && s.hasSensors && (
                      <div className="flex flex-wrap gap-2 rounded-md bg-ink-50 p-3">
                        <span className="w-full text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Simulated station</Text></span>
                        <Button size="sm" onClick={() => void close.run(true)} pending={close.pending}><Text>Shut the door with the parcel inside</Text></Button>
                        <Button size="sm" variant="secondary" onClick={() => void close.run(false)} disabled={close.pending}><Text>Shut it empty</Text></Button>
                      </div>
                    )}
                    {!s.hasSensors && <Button onClick={() => void confirm.run()} pending={confirm.pending}><Text>The parcel is in and the door is shut</Text></Button>}
                  </div>
                ) : s.state === 'LOCKER_RESERVED' && s.command?.status === 'ACKED' ? (
                  <div className="space-y-3">
                    <Line icon={AlertTriangle} tone="text-warning-700" title="The door was shut with nothing inside" text="Open it again and put the parcel in, or say what is wrong." />
                    <Button onClick={() => void open.run(newKey())} pending={open.pending}><RotateCcw className="size-4" aria-hidden /><Text>Open the door again</Text></Button>
                  </div>
                ) : failed ? (
                  <div className="space-y-3">
                    <Line icon={XCircle} tone="text-accent-600" title="The door did not open" text={`${s.command!.error ?? 'The station did not answer.'} Nothing was delivered; the township office has been told.`} />
                    <Button onClick={() => void open.run(newKey())} pending={open.pending}><RotateCcw className="size-4" aria-hidden /><Text>Try again</Text></Button>
                  </div>
                ) : s.state === 'VERIFIED' && !s.command ? (
                  <div className="space-y-3">
                    <Line icon={Package} tone="text-brand-700" title="Registered and verified" text="Open the household’s door to deliver it." />
                    <Button onClick={() => void open.run(newKey())} pending={open.pending}><DoorOpen className="size-4" aria-hidden /><Text>Open the door</Text></Button>
                  </div>
                ) : (
                  <Line icon={Loader2} tone="animate-spin text-brand-700" title="Unlocking…" text="Wait for the door to open." />
                )}
              </div>
              {canReport && !reporting && (
                <div className="border-t border-ink-100 bg-ink-25/60 px-5 py-3">
                  <button type="button" onClick={() => setReporting(true)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                    <Flag className="size-4" aria-hidden /><Text>It will not go into this door</Text>
                  </button>
                </div>
              )}
            </Card>

            {reporting && (
              <ProblemSheet
                failedToOpen={Boolean(failed)}
                pending={report.pending}
                error={report.fields.note}
                onCancel={() => setReporting(false)}
                onSend={(body) => void report.run(body, s.state === 'DEPOSIT_IN_PROGRESS' && s.simulated && s.hasSensors)}
              />
            )}

            {noDoor && noDoor.problem === 'OTHER_STATION' && noDoor.otherStation && (
              <Card className="space-y-3 p-5">
                <p className="text-sm text-ink-500"><Text>The household’s locker</Text></p>
                <p><span className="font-semibold text-ink-900">{noDoor.otherStation.name}</span> <span className="text-sm text-ink-500">· {noDoor.otherStation.location}</span></p>
                {noDoor.otherStation.allowed
                  ? <Button size="sm" onClick={() => void moveTo.run(noDoor.otherStation!.id)} pending={moveTo.pending}><MapPin className="size-4" aria-hidden /><Text>I am at this locker: open the door</Text></Button>
                  : <p className="text-sm text-ink-600"><Text>You do not have access to that locker. Take the parcel to the guardhouse instead.</Text></p>}
              </Card>
            )}

            {noDoor && (
              <Card>
                <CardHeader title="Guardhouse" description="Bring parcels only while the guardhouse is open. The guard receives it and the household is told why." />
                <div className="space-y-2 p-5">
                  {noDoor.counters.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 p-3">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink-900">{c.name}</span><Badge tone={c.open ? 'success' : 'neutral'}><Text>{c.status}</Text></Badge></span>
                        <span className="block text-sm text-ink-500">{c.location} · <Text>{c.hours}</Text></span>
                      </span>
                      <Button size="sm" onClick={() => void counter.run(c.id)} pending={counter.pending} disabled={!c.open}><Text>I am at the guardhouse</Text></Button>
                    </div>
                  ))}
                  {noDoor.counters.length === 0 && <p className="text-sm text-ink-600"><Text>The guardhouse has no room right now.</Text></p>}
                  {openCounters.length === 0 && (
                    <div className="space-y-3 rounded-lg bg-warning-50 p-4">
                      <p className="text-[15px] text-ink-800"><Text>Keep the parcel and bring it on your next round. The household will be told it is coming later.</Text></p>
                      <Button size="sm" variant="secondary" pending={fail.pending}
                        onClick={() => void fail.run(noDoor.counters.length
                          ? { reason: 'The guardhouse was closed; bringing it on the next round', problem: 'COUNTER_CLOSED' }
                          : { reason: 'The guardhouse had no room; bringing it on the next round', problem: noDoor.problem })}>
                        <Text>Keep it for my next round</Text>
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {s.state === 'READY_FOR_COLLECTION' || s.state === 'DELIVERY_FAILED' ? (
              <Button onClick={onDone}><Package className="size-4" aria-hidden /><Text>Next parcel</Text></Button>
            ) : (
              (noDoor || failed || s.state === 'VERIFIED' || s.state === 'LOCKER_RESERVED') && !reporting && (
                <Card className="space-y-3 p-5">
                  <Textarea label="Could not deliver today? Say why (optional)" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} />
                  <Button variant="secondary" pending={fail.pending}
                    onClick={() => void fail.run({ reason: reason.trim() || (noDoor ? NO_DOOR_TITLES[noDoor.problem] : 'Could not be delivered to a locker'), problem: noDoor?.problem })}>
                    <Text>Record as not delivered today</Text>
                  </Button>
                </Card>
              )
            )}
          </div>
        );
      }}
    </Async>
  );
}

/** "What happened?": suggested reasons, or the courier's own words. */
function ProblemSheet({ failedToOpen, pending, error, onCancel, onSend }: {
  failedToOpen: boolean; pending: boolean; error?: string; onCancel: () => void; onSend: (body: { reason: CourierProblem; note?: string }) => void;
}) {
  const [choice, setChoice] = useState<CourierProblem | null>(failedToOpen ? 'DOOR_DID_NOT_OPEN' : null);
  const [note, setNote] = useState('');
  const needsNote = choice === 'OTHER';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (choice && (!needsNote || note.trim())) onSend({ reason: choice, note: note.trim() || undefined });
  };
  return (
    <Card>
      <CardHeader title="What happened?" description="Choose the closest reason. The township office checks the door when needed, and you are shown where to take the parcel." />
      <form method="post" onSubmit={submit} className="space-y-4 p-5" noValidate>
        <fieldset>
          <legend className="sr-only"><Text>Reason</Text></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COURIER_PROBLEMS.map((code) => (
              <label key={code} className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-[15px] transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-600',
                choice === code ? 'border-brand-600 bg-brand-50 text-ink-900' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300')}>
                <input type="radio" name="reason" value={code} checked={choice === code} onChange={() => setChoice(code)} className="size-4 accent-brand-600" />
                <Text>{code === 'OTHER' ? 'Something else' : DELIVERY_PROBLEM_LABELS[code]}</Text>
              </label>
            ))}
          </div>
        </fieldset>
        <Textarea label={needsNote ? 'What happened?' : 'Anything to add? (optional)'} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} required={needsNote} error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={pending} disabled={!choice || (needsNote && !note.trim())}><Text>Send</Text></Button>
          <Button type="button" variant="ghost" onClick={onCancel}><Text>Cancel</Text></Button>
        </div>
      </form>
    </Card>
  );
}

function Line({ icon: Icon, tone, title, text }: { icon: typeof CheckCircle2; tone: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className={cn('size-7 shrink-0', tone)} aria-hidden />
      <div>
        <p className="font-display text-lg font-bold text-ink-900"><Text>{title}</Text></p>
        {text && <p className="text-[15px] text-ink-700"><Text>{text}</Text></p>}
      </div>
    </div>
  );
}
