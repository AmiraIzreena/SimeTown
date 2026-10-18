'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, PackageCheck, ScanLine } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CameraScan } from '@/components/features/camera-scan';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/field';
import { ErrorState, SkeletonForm } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';

interface Location {
  id: string;
  name: string;
  active: boolean;
}
interface Checked {
  parcelId: string;
  trackingNo: string;
  company: string;
  house: string;
  recipient: string | null;
}

/**
 * Handing over a locker parcel kept at a staffed counter or the guardhouse.
 * The pickup code must be right and the person's ID checked; the code then
 * stops working.
 */
export function CounterHandover({ title = 'Hand over a locker parcel', onDone }: { title?: string; onDone?: () => void }) {
  const locations = useApi<Location[]>('/admin/lockers/overflow');
  const [locationId, setLocationId] = useState('');
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [idOk, setIdOk] = useState(false);
  const active = locations.data?.filter((l) => l.active) ?? [];
  const chosen = active.find((l) => l.id === locationId) ?? active[0] ?? null;
  const check = useAction(() => api.post<Checked>(`/admin/lockers/overflow/${chosen!.id}/check`, { credential: code.trim() }), {
    onSuccess: (r) => {
      setChecked(r);
      setIdOk(false);
    },
  });
  const handOver = useAction(() => api.post(`/admin/lockers/overflow/${chosen!.id}/handover`, { credential: code.trim(), idChecked: idOk }), {
    success: 'Handed over. The household has been told.',
    onSuccess: () => {
      setChecked(null);
      setCode('');
      onDone?.();
    },
  });
  if (!locations.data && locations.error) return <ErrorState error={locations.error} onRetry={() => void locations.mutate()} />;
  if (!locations.data) return <SkeletonForm />;
  if (active.length === 0) return null;
  return (
    <Card>
      <CardHeader title={title} description="Scan the resident’s pickup QR code or type their PIN, then check their ID." />
      <div className="space-y-4 p-5">
        {active.length > 1 && (
          <Select label="Counter" value={chosen?.id ?? ''} onChange={(event) => { setLocationId(event.target.value); setChecked(null); }}>
            {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <CameraScan onCode={(text) => { setCode(text); setChecked(null); }} label="Scan the pickup QR code" />
        <form
          method="post"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void check.run();
          }}
        >
          <Input label="Pickup PIN" value={code} onChange={(event) => { setCode(event.target.value); setChecked(null); }} maxLength={120} autoComplete="off" className="min-w-0 flex-1 basis-40" />
          <Button type="submit" disabled={!chosen || code.trim().length < 6} pending={check.pending}><ScanLine className="size-4" aria-hidden /><Text>Check code</Text></Button>
        </form>
        {checked && (
          <div className="space-y-3 rounded-lg bg-success-50 p-4" aria-live="polite">
            <p className="flex items-center gap-2 font-semibold text-success-700"><CheckCircle2 className="size-5" aria-hidden /><Text>Code is right</Text></p>
            <p className="text-[15px] text-ink-800">{checked.trackingNo} · {checked.company}<br /><Text>Resident</Text>: <strong>{checked.recipient ?? checked.house}</strong>{checked.recipient && <><br /><Text>{checked.house}</Text></>}</p>
            <Checkbox label="I have checked the person’s ID" checked={idOk} onChange={(event) => setIdOk(event.target.checked)} />
            <Button variant="success" disabled={!idOk} pending={handOver.pending} onClick={() => void handOver.run()}><PackageCheck className="size-4" aria-hidden /><Text>Hand over</Text></Button>
          </div>
        )}
      </div>
    </Card>
  );
}
