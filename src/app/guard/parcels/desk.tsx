'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg, LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, CheckCircle2, Package, PackageCheck, ScanLine, Undo2, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AddressPicker } from '@/components/features/address';
import { CameraScan } from '@/components/features/camera-scan';
import { CounterHandover } from '@/components/features/counter-handover';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/image';
import type { Me } from '@/lib/types';

interface Waiting {
  id: string;
  house: string;
  courier: string;
  trackingNo: string | null;
  shelf: string;
  hasPhoto: boolean;
  loggedAt: string;
  days: number;
}
interface Checked {
  id: string;
  house: string;
  courier: string;
  trackingNo: string | null;
  shelf: string;
  note: string | null;
  hasPhoto: boolean;
  loggedAt: string;
}

const COURIERS = ['Shopee Express', 'J&T Express', 'Pos Laju', 'Ninja Van', 'DHL', 'GDex', 'City-Link', 'Lalamove', 'Grab'];
/** Waiting this long, a parcel can go back to the courier. */
const RETURN_AFTER_DAYS = 14;

export function ParcelDesk() {
  const me = useApi<Me>('/me');
  const shelf = useApi<{ waiting: Waiting[] }>('/guard/parcels', { refreshInterval: 15_000 });
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<{ ok: true; parcel: Checked; code: string } | { ok: false; message: string } | null>(null);
  const [collectedBy, setCollectedBy] = useState('');
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [courierChoice, setCourierChoice] = useState('');
  const [otherCourier, setOtherCourier] = useState('');
  const [toReturn, setToReturn] = useState<Waiting | null>(null);

  const log = useAction(
    async (data: FormData) => {
      const file = data.get('photo');
      if (file instanceof File && file.size > 0) data.set('photo', await shrinkPhoto(file), 'photo.jpg');
      else data.delete('photo');
      return api.post<{ house: string; notified: number }>('/guard/parcels', data);
    },
    {
      success: (r) => (r.notified ? `Logged for ${r.house}. The household has the collection code.` : `Logged for ${r.house}. Nobody there has the app: call the house.`),
      onSuccess: () => void shelf.mutate(),
    },
  );
  const check = async (raw: string) => {
    setChecked(null);
    try {
      const parcel = await api.post<Checked>('/guard/parcels/check', { code: raw.trim() });
      setChecked({ ok: true, parcel, code: raw.trim() });
    } catch (error) {
      setChecked({ ok: false, message: error instanceof ApiError ? (error.status === 404 ? 'No parcel is waiting with this code.' : error.message) : 'Please try again.' });
    }
  };
  const handOver = useAction((id: string, value: string) => api.post(`/guard/parcels/${id}/collect`, { code: value, collectedBy: collectedBy.trim() || undefined }), {
    success: 'Handed over. The household has been told.',
    onSuccess: () => {
      setChecked(null);
      setCode('');
      setCollectedBy('');
      void shelf.mutate();
    },
  });
  const sendBack = useAction((id: string) => api.post(`/guard/parcels/${id}/return`), {
    success: 'Marked as returned to the courier. The household has been told.',
    onSuccess: () => {
      setToReturn(null);
      void shelf.mutate();
    },
  });

  const submitLog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const done = await log.run(new FormData(formElement));
    if (done) {
      formElement.reset();
      setPhotoName(null);
      setCourierChoice('');
      setOtherCourier('');
    }
  };

  return (
    <>
      <PageHeader title="Parcels" description="Log each parcel with its shelf and a photo. The household gets a one-time code; hand a parcel over only against that code." />
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Hand over a parcel" description="Scan the resident’s QR code or type the six digits they show you." />
            <div className="space-y-4 p-5">
              <CameraScan onCode={(text) => void check(text)} />
              <form
                method="post"
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void check(code);
                }}
              >
                <Input label="Collection code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" placeholder="e.g. 482913" className="min-w-0 flex-1 basis-40" />
                <Button type="submit" disabled={code.length !== 6}>
                  <ScanLine className="size-4" aria-hidden /><Text>Check code</Text></Button>
              </form>
              {checked && (
                <div aria-live="polite" className={cn('animate-rise rounded-lg p-5', checked.ok ? 'bg-success-50' : 'bg-accent-50')}>
                  {checked.ok ? (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="size-8 shrink-0 text-success-700" aria-hidden />
                        <div>
                          <p className="font-display text-xl font-bold text-success-700"><Text>{`Shelf ${checked.parcel.shelf}`}</Text></p>
                          <p className="text-[15px] text-ink-800">
                            <Text>{checked.parcel.courier}</Text><Text> · for </Text><Text>{checked.parcel.house}</Text>
                            {checked.parcel.trackingNo && ` · ${checked.parcel.trackingNo}`}
                          </p>
                          <p className="text-sm text-ink-600"><Text>{`Logged ${formatDateTime(checked.parcel.loggedAt)}`}</Text></p>
                          {checked.parcel.note && <p className="mt-1 text-sm text-ink-700">{checked.parcel.note}</p>}
                        </div>
                      </div>
                      {checked.parcel.hasPhoto && <LocalizedImg src={`/api/v1/parcels/${checked.parcel.id}/photo`} alt="Photo of the parcel taken when it was logged" className="max-h-48 w-full rounded-md border border-ink-200 object-cover" />}
                      <p className="text-sm text-ink-700"><Text>Check the parcel matches the photo and the house before you hand it over.</Text></p>
                      <div className="flex flex-wrap items-end gap-3">
                        <Input label="Collected by (optional)" value={collectedBy} onChange={(event) => setCollectedBy(event.target.value)} maxLength={80} placeholder="Name of the person collecting" className="min-w-0 flex-1 basis-48" />
                        <Button variant="success" onClick={() => void handOver.run(checked.parcel.id, checked.code)} pending={handOver.pending}>
                          <PackageCheck className="size-4" aria-hidden /><Text>Hand over</Text></Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <XCircle className="size-8 shrink-0 text-accent-600" aria-hidden />
                      <div>
                        <p className="font-display text-xl font-bold text-accent-700"><Text>Do not hand over</Text></p>
                        <p className="text-[15px] text-ink-800"><Text>{checked.message}</Text></p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Log a parcel" description="The household is told at once, with the shelf and their code." />
            <form method="post" onSubmit={submitLog} className="space-y-4 p-5" noValidate>
              <AddressPicker key={me.data?.townshipId ?? 'none'} townshipId={me.data?.townshipId ?? null} error={log.fields.homeId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Courier" value={courierChoice} onChange={(event) => setCourierChoice(event.target.value)} error={log.fields.courier}>
                  <option value=""><Text>Choose…</Text></option>
                  {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="OTHER"><Text>Another courier</Text></option>
                </Select>
                {courierChoice === 'OTHER' && <Input label="Courier name" value={otherCourier} onChange={(event) => setOtherCourier(event.target.value)} maxLength={40} required />}
                <LocalizedInput type="hidden" name="courier" value={courierChoice === 'OTHER' ? otherCourier : courierChoice} />
                <Input label="Shelf" name="shelf" maxLength={12} placeholder="e.g. B3" autoCapitalize="characters" required error={log.fields.shelf} />
                <Input label="Tracking number (optional)" name="trackingNo" maxLength={40} autoCapitalize="characters" error={log.fields.trackingNo} />
              </div>
              <Input label="Note (optional)" name="note" maxLength={200} placeholder="e.g. Large box, kept behind the counter" />
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
                <Camera className="size-5 shrink-0 text-ink-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate"><Text>{photoName ?? 'Photo of the parcel (recommended)'}</Text></span>
                <LocalizedInput type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? null)} />
              </label>
              <Button type="submit" pending={log.pending}>
                <Package className="size-4" aria-hidden /><Text>Log parcel</Text></Button>
            </form>
          </Card>
        </div>

        <CounterHandover title="Locker parcel kept at the counter" />

        <Card>
          <CardHeader title="On the shelf" description="Every parcel waiting, oldest first. Households get a reminder after three days." />
          <Async state={shelf} skeleton={<SkeletonList rows={3} className="p-5" />}>
            {(s) =>
              s.waiting.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Package} title="No parcels waiting" />
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {s.waiting.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink-900">
                          <Text>{p.house}</Text> <span className="font-normal text-ink-500">· {p.courier}</span>
                        </p>
                        <p className="text-sm text-ink-500"><Text>{`Arrived ${timeAgo(p.loggedAt)}`}</Text>{p.trackingNo && ` · ${p.trackingNo}`}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.days >= 3 && <Badge tone="warning"><Text>{`${p.days} days`}</Text></Badge>}
                        <Badge tone="gold"><Text>{`Shelf ${p.shelf}`}</Text></Badge>
                        {p.days >= RETURN_AFTER_DAYS && (
                          <Button size="sm" variant="secondary" onClick={() => setToReturn(p)}>
                            <Undo2 className="size-4" aria-hidden /><Text>Return</Text></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>
      </div>

      <ConfirmDialog
        open={toReturn !== null}
        onClose={() => setToReturn(null)}
        onConfirm={() => void sendBack.run(toReturn!.id)}
        title="Return this parcel to the courier?"
        confirmLabel="Mark as returned"
        pending={sendBack.pending}
      >
        <p className="text-[15px] text-ink-700"><Text>Only when the courier has taken it back. The household is told, and the code stops working.</Text></p>
      </ConfirmDialog>
    </>
  );
}
