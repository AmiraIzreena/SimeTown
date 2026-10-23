'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedDiv, LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, Store, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CounterInfo } from '@/components/features/locker-parcels';
import { useApi } from '@/lib/hooks';
import { formatHour } from '@/shared/lockers';

/**
 * The announcement bar for a resident with parcels waiting at the guardhouse: both kinds, those a courier left
 * with the guard and smart locker parcels too big for the home's door. It sits under the flood band when there is
 * one, and in its place when there is not. One button opens the Guardhouse tab of Parcels. Closing it hides it
 * until another parcel arrives (remembered in this browser only).
 */

const GUARDHOUSE_HREF = '/app/parcels?tab=guardhouse#parcel-tabs';
const DISMISSED = 'kita.parcelbar.dismissed';
/** The Parcels page says which tab it shows, so the bar can step aside on the Guardhouse tab itself. */
export const PARCEL_TAB_EVENT = 'kita:parcel-tab';
/** Sent when the bar is clicked on the Parcels page itself: it opens the Guardhouse tab in place. */
export const OPEN_GUARDHOUSE_EVENT = 'kita:open-guardhouse';

interface Shelf { parcels: { id: string; status: 'WAITING' | 'COLLECTED' | 'RETURNED'; overdue: boolean }[] }
interface Lockers { counters: CounterInfo[]; parcels: { id: string; state: string; overdue: boolean }[] }

const readDismissed = () => { try { return window.localStorage.getItem(DISMISSED); } catch { return null; } };

export function ParcelBar() {
  const shelf = useApi<Shelf>('/parcels', { refreshInterval: 60_000 });
  const lockers = useApi<Lockers>('/lockers/my-parcels', { refreshInterval: 60_000 });
  const pathname = usePathname();
  // Read once in the browser; on the server there are no parcels yet, so nothing shows either way.
  const [dismissed, setDismissed] = useState<string | null>(() => (typeof window === 'undefined' ? null : readDismissed()));
  const [pageTab, setPageTab] = useState<string | null>(null);

  useEffect(() => {
    const onTab = (e: Event) => setPageTab((e as CustomEvent<string | null>).detail);
    window.addEventListener(PARCEL_TAB_EVENT, onTab);
    return () => window.removeEventListener(PARCEL_TAB_EVENT, onTab);
  }, []);

  // Both lists first, so the count never jumps and closing it remembers the right parcels.
  if (!shelf.data || !lockers.data) return null;
  const waiting = [
    ...shelf.data.parcels.filter((p) => p.status === 'WAITING'),
    ...lockers.data.parcels.filter((p) => p.state === 'RELOCATED_TO_STORAGE' || p.state === 'RETURN_PENDING'),
  ];
  // The parcels it was closed for: a new parcel brings it back.
  const signature = waiting.map((p) => p.id).sort().join(',');
  const onGuardhouseTab = pathname === '/app/parcels' && pageTab === 'guardhouse';
  if (waiting.length === 0 || dismissed === signature || onGuardhouseTab) return null;

  const overdue = waiting.filter((p) => p.overdue).length;
  const counter = lockers.data.counters[0];
  const hours = counter
    ? counter.open
      ? counter.openFromHour === 0 && counter.openToHour === 24 ? `${counter.name} is open 24 hours.` : `${counter.name} is open now, until ${formatHour(counter.openToHour)}.`
      : `${counter.name} opens at ${formatHour(counter.openFromHour)}.`
    : null;
  const dismiss = () => {
    try { window.localStorage.setItem(DISMISSED, signature); } catch { /* private window: hidden until the page reloads */ }
    setDismissed(signature);
  };

  return (
    <LocalizedDiv role="region" aria-label="Parcels at the guardhouse" className="parcel-bar no-print relative overflow-hidden text-brand-950 shadow-[0_4px_14px_rgb(45_20_7/0.12)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2.5 py-3 pl-4 pr-12 sm:pl-6 sm:pr-14 lg:pl-8">
        <span aria-hidden className="parcel-bar-icon relative grid size-9 shrink-0 place-items-center rounded-full bg-white/70 text-gold-700 ring-1 ring-white">
          <Store className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="rounded bg-brand-950 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gold-300"><Text>{waiting.length === 1 ? 'Parcel waiting' : 'Parcels waiting'}</Text></span>
            <span className="text-[15px] font-semibold"><Text>{waiting.length === 1 ? 'You have a parcel at the guardhouse' : `You have ${waiting.length} parcels at the guardhouse`}</Text></span>
            {overdue > 0 && <span className="rounded-full bg-accent-700 px-2 py-0.5 text-[11px] font-bold text-white"><Text>{overdue === 1 ? '1 overdue' : `${overdue} overdue`}</Text></span>}
          </p>
          <p className="mt-0.5 text-sm text-brand-900/85"><Text>Show your code to the guard to collect it.</Text>{hours && <>{' '}<Text>{hours}</Text></>}</p>
        </div>
        <Link
          href={GUARDHOUSE_HREF}
          onClick={(e) => {
            // Already on Parcels: switch to the Guardhouse tab and bring it into view without a reload.
            if (pathname === '/app/parcels') { e.preventDefault(); window.dispatchEvent(new CustomEvent(OPEN_GUARDHOUSE_EVENT)); }
          }}
          className="group inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-950 px-4 sm:w-auto text-sm font-semibold text-white shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-soft hover:bg-brand-900 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-950 motion-safe:hover:-translate-y-px"
        >
          <Text>View guardhouse parcels</Text>
          <ArrowRight className="size-4 transition-transform duration-200 ease-soft motion-safe:group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>
      <LocalizedButton
        type="button" onClick={dismiss} aria-label="Hide until another parcel arrives"
        className="absolute right-2 top-2.5 grid size-9 place-items-center rounded-md sm:top-1/2 sm:-translate-y-1/2 text-brand-950/70 transition-[background-color,color] duration-200 hover:bg-white/50 hover:text-brand-950 focus-visible:outline-2 focus-visible:outline-brand-950 sm:right-3"
      >
        <X className="size-[18px]" aria-hidden />
      </LocalizedButton>
    </LocalizedDiv>
  );
}
