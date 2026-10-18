import { Text } from '@/components/ui/localized-text';

import { LockKeyhole, MapPin, Package, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { currentActor } from '@/server/auth/guard';
import { getDb, one } from '@/server/db/client';

export const metadata: Metadata = { title: 'Parcel locker' };

/**
 * What a locker station's QR poster opens. It shows the station's name and
 * sends each person to their own screen: couriers to deliver, residents to
 * collect. The code on the poster grants nothing by itself; every action is
 * checked again on the server.
 */
export default async function LockerStationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{6,12}$/.test(code)) notFound();
  const station = await one<{ name: string; location: string; keypad_locked: boolean }>(
    await getDb(),
    `SELECT s.name, s.location, EXISTS (SELECT 1 FROM pickup_lockouts l WHERE l.location_id = s.id AND l.cleared_at IS NULL) AS keypad_locked FROM locker_stations s WHERE s.code = $1`,
    [code.toUpperCase()],
  );
  if (!station) notFound();
  const actor = await currentActor();
  if (actor?.role === 'COURIER') redirect(`/courier?station=${code.toUpperCase()}`);
  if (actor?.role === 'RESIDENT') redirect(`/app/parcels?station=${code.toUpperCase()}`);
  return (
    <main className="grid min-h-dvh place-items-center bg-ink-25 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <Logo />
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-xs">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-700"><MapPin className="size-4" aria-hidden /><Text>Parcel locker</Text></p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink-900">{station.name}</h1>
          <p className="text-[15px] text-ink-600">{station.location}</p>
          <div className="mt-6 grid gap-3">
            <Button href={`/login?next=${encodeURIComponent(`/app/parcels?station=${code.toUpperCase()}`)}`} size="lg"><Package className="size-5" aria-hidden /><Text>I am collecting a parcel</Text></Button>
            <Button href={`/login?next=${encodeURIComponent(`/courier?station=${code.toUpperCase()}`)}`} size="lg" variant="secondary"><Truck className="size-5" aria-hidden /><Text>I am a courier</Text></Button>
          </div>
          {station.keypad_locked && (
            <div className="mt-5 rounded-lg bg-warning-50 p-4 text-sm text-ink-800" role="status">
              <p className="flex items-center gap-2 font-semibold text-warning-700"><LockKeyhole className="size-4" aria-hidden /><Text>This locker’s keypad is locked for safety</Text></p>
              <p className="mt-1"><Text>Too many wrong codes were typed here. Choose “I am collecting a parcel” and sign in: you can open your door from the app and ask staff to unlock the keypad.</Text></p>
            </div>
          )}
          <p className="mt-5 text-sm text-ink-500">{!station.keypad_locked && <><Text>No app? Type your six-digit pickup PIN on the locker’s keypad.</Text> </>}<a className="font-semibold text-brand-700 underline" href="/courier-apply"><Text>Courier without an account? Apply here.</Text></a></p>
        </div>
      </div>
    </main>
  );
}
