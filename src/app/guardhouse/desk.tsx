'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, Package } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AddressPicker } from '@/components/features/address';
import { CounterDropOffs } from '@/components/features/counter-parcels';
import { GuardhouseHandover, GuardhouseOverview, GuardhouseRegister, refreshGuardhouse } from '@/components/features/guardhouse-register';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { GuardParcelWalkthrough } from '@/components/features/parcel-walkthroughs';
import { Input, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { PHOTO_ACCEPT, PHOTO_HINT, shrinkPhoto, usePhotoPick } from '@/lib/image';
import type { Me } from '@/lib/types';
// The same tiles, panels and motion as Parcels in the console.
import '../console/operations/parcel-workspace.css';

const COURIERS = ['Shopee Express', 'J&T Express', 'Pos Laju', 'Ninja Van', 'DHL', 'GDex', 'City-Link', 'Lalamove', 'Grab'];

/**
 * The guardhouse staff's parcel desk. Everything held at the guardhouse is in one register: parcels a courier leaves with the
 * guard, and smart locker parcels that could not go into the household's door. One handover takes either code;
 * parcels stay until collected, overdue ones are reminded weekly, and the guard is asked to call when they wait long.
 */
export function ParcelDesk() {
  const me = useApi<Me>('/me');
  const [photoName, setPhotoName] = useState<string | null>(null);
  const pickPhoto = usePhotoPick();
  const [courierChoice, setCourierChoice] = useState('');
  const [otherCourier, setOtherCourier] = useState('');

  const log = useAction(
    async (data: FormData) => {
      const file = data.get('photo');
      if (file instanceof File && file.size > 0) data.set('photo', await shrinkPhoto(file), 'photo.jpg');
      else data.delete('photo');
      return api.post<{ house: string; notified: number }>('/guard/parcels', data);
    },
    {
      success: (r) => (r.notified ? `Logged for ${r.house}. The household has the collection code.` : `Logged for ${r.house}. Nobody there has the app: call the house.`),
      onSuccess: () => void refreshGuardhouse(),
    },
  );

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
    <div className="parcel-workspace">
      <PageHeader action={<GuardParcelWalkthrough />} title="Parcels" description="Everything held at the guardhouse. Log parcels left with you, receive smart locker parcels from couriers, and hand a parcel over only against its code." />
      <div className="space-y-6">
        <GuardhouseOverview />
        <CounterDropOffs />
        {/* The two counter jobs side by side, the same height, so neither leaves an empty gap. */}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
          <GuardhouseHandover fill />
          <Card className="ops-panel">
            <CardHeader title="Log a parcel" description="A courier left a parcel with you. The household is told at once, with the shelf and their code." />
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
              <div className="space-y-4">
              <Input label="Note (optional)" name="note" maxLength={200} placeholder="e.g. Large box, kept behind the counter" />
              <label className="photo-drop flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
                <Camera className="size-5 shrink-0 text-ink-500" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate"><Text>{photoName ?? 'Photo of the parcel (recommended)'}</Text></span><span className="block text-xs text-ink-500"><Text>{PHOTO_HINT}</Text></span></span>
                <LocalizedInput type="file" name="photo" accept={PHOTO_ACCEPT} capture="environment" className="sr-only" onChange={(event) => setPhotoName(pickPhoto(event.target)?.name ?? null)} />
              </label>
              </div>
              <Button type="submit" pending={log.pending} className="w-full sm:w-auto">
                <Package className="size-4" aria-hidden /><Text>Log parcel</Text></Button>
            </form>
          </Card>
        </div>
        <GuardhouseRegister />
      </div>
    </div>
  );
}
