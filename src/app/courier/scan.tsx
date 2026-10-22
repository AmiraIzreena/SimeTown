'use client';

import { Text } from '@/components/ui/localized-text';

import { AlertTriangle, CheckCircle2, DoorOpen, KeyRound, ScanLine, ShieldCheck, XCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { CameraScan } from '@/components/features/camera-scan';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/hooks';
import { LOCKER_SIZE_INFO, LOCKER_SIZES, type LockerSize } from '@/shared/lockers';
import type { NoDoor } from './desk';

export interface Check {
  state: 'VERIFIED' | 'NOT_FOUND' | 'UNVERIFIED' | 'PROVIDER_UNAVAILABLE' | 'RECIPIENT_MISMATCH' | 'NOT_ELIGIBLE' | 'ALREADY_DEPOSITED';
  reason: string | null;
  message: string;
  trackingNo: string;
  company: string;
  simulated: boolean;
  assurance: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  match: { method: string | null; evidence: string[]; masked: { name: string; address: string } | null } | null;
  size: LockerSize | null;
  sizeFromProvider: boolean;
  fallback: boolean;
  resumeParcelId: string | null;
}

const BARCODES = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];
const newKey = () => crypto.randomUUID();

const STATE_LABELS: Record<Check['state'], string> = {
  VERIFIED: 'Verified',
  NOT_FOUND: 'Not found',
  UNVERIFIED: 'Cannot be checked',
  PROVIDER_UNAVAILABLE: 'Courier company not answering',
  RECIPIENT_MISMATCH: 'Recipient not matched',
  NOT_ELIGIBLE: 'Not allowed in a locker',
  ALREADY_DEPOSITED: 'Already delivered',
};
const EVIDENCE: Record<string, string> = { 'SimeTown delivery code': 'SimeTown delivery code', phone: 'Phone', name: 'Name', address: 'Address', postcode: 'Postcode' };

/**
 * Scan the label's own barcode. The barcode only names the shipment: SimeTown
 * asks the courier company about it and matches the household before any door
 * is offered, and shows the courier masked details only.
 */
export function ScanShipment({ station, onDelivering, onFallback }: {
  station: { id: string; name: string };
  onDelivering: (parcelId: string, noDoor: NoDoor | null) => void;
  onFallback: (trackingNo: string) => void;
}) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Check | null>(null);
  const [size, setSize] = useState<LockerSize | null>(null);
  const [repeat, setRepeat] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const check = useAction((text: string) => api.post<Check>('/courier/shipments/check', { stationId: station.id, code: text }), {
    onSuccess: (r) => {
      setResult(r);
      setSize(r.size);
    },
  });
  const deliver = useAction(
    () => api.post<({ kind: 'OPENING' | 'RESUME' } | ({ kind: 'NO_DOOR' } & NoDoor)) & { parcelId: string }>('/courier/shipments/deliver', { stationId: station.id, code: result!.trackingNo, size: size ?? undefined, idempotencyKey: newKey() }),
    { onSuccess: (r) => onDelivering(r.parcelId, r.kind === 'NO_DOOR' ? { problem: r.problem, otherStation: r.otherStation, counters: r.counters } : null) },
  );
  const run = (text: string) => {
    const clean = text.trim();
    if (clean.length < 4) return;
    // The same code read twice in a row by the camera is one scan.
    const seen = last.current && last.current.code === clean && Date.now() - last.current.at < 4_000;
    last.current = { code: clean, at: Date.now() };
    setRepeat(Boolean(seen));
    if (seen) return;
    setResult(null);
    void check.run(clean);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(code);
  };
  const ok = result?.state === 'VERIFIED' && !result.resumeParcelId;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Scan the label" description="Scan the barcode or QR code already on the shipping label. A handheld scanner works too: it types the number and presses Enter." />
        <form method="post" onSubmit={submit} className="space-y-4 p-5" noValidate>
          <CameraScan onCode={(text) => { setCode(text.trim().slice(0, 120)); run(text); }} label="Scan the label" formats={BARCODES} />
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Tracking number" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={120} autoComplete="off" spellCheck={false} autoFocus className="min-w-0 flex-1 basis-56" />
            <Button type="submit" pending={check.pending} disabled={code.trim().length < 4}><ScanLine className="size-4" aria-hidden /><Text>Check shipment</Text></Button>
          </div>
          {repeat && <p className="text-sm text-ink-600" role="status"><Text>Already scanned. The result is below.</Text></p>}
          <p className="flex items-start gap-2 text-sm text-ink-500"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden /><Text>The barcode only names the shipment. SimeTown checks it with your courier company and the township’s records before any door opens.</Text></p>
        </form>
      </Card>

      {result && (
        <Card className="overflow-hidden" aria-live="polite">
          <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b p-5', ok ? 'border-success-600/30 bg-success-50' : result.state === 'ALREADY_DEPOSITED' || result.state === 'NOT_FOUND' ? 'border-accent-200 bg-accent-50' : 'border-warning-600/30 bg-warning-50')}>
            <div className="flex items-start gap-3">
              {ok ? <CheckCircle2 className="size-7 shrink-0 text-success-700" aria-hidden /> : result.state === 'ALREADY_DEPOSITED' || result.state === 'NOT_FOUND' ? <XCircle className="size-7 shrink-0 text-accent-600" aria-hidden /> : <AlertTriangle className="size-7 shrink-0 text-warning-700" aria-hidden />}
              <div>
                <p className="font-display text-lg font-bold text-ink-900"><Text>{STATE_LABELS[result.state]}</Text></p>
                <p className="text-sm text-ink-600">{result.trackingNo} · {result.company}{result.simulated && <> · <Text>simulated company</Text></>}</p>
              </div>
            </div>
            {result.assurance && result.state === 'VERIFIED' && (
              <Badge tone={result.assurance === 'HIGH' ? 'success' : 'gold'}><Text>{result.assurance === 'HIGH' ? 'High assurance' : 'Medium assurance'}</Text></Badge>
            )}
          </div>
          <div className="space-y-4 p-5">
            <p className="text-[15px] text-ink-800"><Text>{result.message}</Text></p>
            {result.match?.masked && (
              <div className="rounded-lg border border-ink-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Recipient (masked)</Text></p>
                <p className="mt-1 font-semibold text-ink-900">{result.match.masked.name}</p>
                <p className="text-sm text-ink-600">{result.match.masked.address}</p>
                {result.match.evidence.length > 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-600"><Text>Matched on:</Text>{result.match.evidence.map((e) => <Badge key={e} tone="neutral"><Text>{EVIDENCE[e] ?? e}</Text></Badge>)}</p>
                )}
              </div>
            )}
            {ok && (
              <>
                {result.assurance === 'MEDIUM' && <p className="text-sm text-ink-600"><Text>Your courier company confirmed the shipment, but cannot say which courier carries it. This is recorded with the delivery.</Text></p>}
                {result.sizeFromProvider && result.size ? (
                  <p className="text-[15px] text-ink-800"><Text>{`Size ${result.size} (${LOCKER_SIZE_INFO[result.size].label}), from the courier company’s record.`}</Text></p>
                ) : (
                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold text-ink-900"><Text>Parcel size</Text></legend>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {LOCKER_SIZES.map((s) => (
                        <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)} className={cn('rounded-lg border p-3 text-left transition-colors', size === s ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300')}>
                          <span className="block font-semibold text-ink-900"><Text>{LOCKER_SIZE_INFO[s].label}</Text> <span className="text-ink-500">({s})</span></span>
                          <span className="block text-xs text-ink-500"><Text>{LOCKER_SIZE_INFO[s].hint}</Text></span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <Button onClick={() => void deliver.run()} pending={deliver.pending} disabled={!size}><DoorOpen className="size-4" aria-hidden /><Text>Open the door</Text></Button>
              </>
            )}
            {result.resumeParcelId && <Button onClick={() => onDelivering(result.resumeParcelId!, null)}><DoorOpen className="size-4" aria-hidden /><Text>Carry on with this delivery</Text></Button>}
            {result.fallback && (
              <Button variant="secondary" onClick={() => onFallback(result.trackingNo)}><KeyRound className="size-4" aria-hidden /><Text>Use the resident’s delivery code</Text></Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
