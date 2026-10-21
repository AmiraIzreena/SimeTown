'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton } from '@/components/ui/localized-elements';
import { FlaskConical, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DEMO_MODE } from '@/lib/demo';
import { cn } from '@/lib/cn';

/**
 * The one marker of the demo environment, in place of explanations on every
 * screen: a small chip that opens a short note. It sits above the phone's bottom
 * bar in the signed-in app.
 */
export function DemoMarker() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  if (!DEMO_MODE) return null;
  // Full-screen kiosk views (the machine screen) and printouts stay clean.
  if (/^\/console\/machine\//.test(pathname)) return null;
  const signedArea = /^\/(app|console|merchant|sponsor|guard)(\/|$)/.test(pathname);

  return (
    <div ref={ref} className={cn('no-print fixed left-3 z-[60] sm:left-4', signedArea ? 'bottom-[5.25rem] lg:bottom-4' : 'bottom-4')}>
      {open && (
        <div role="dialog" aria-labelledby="demo-marker-title" className="demo-pop absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-700 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p id="demo-marker-title" className="font-semibold text-ink-900"><Text>Demo environment</Text></p>
            <LocalizedButton type="button" aria-label="Close" onClick={() => setOpen(false)} className="-m-1 rounded-md p-1 text-ink-500 hover:text-ink-700"><X className="size-4" aria-hidden /></LocalizedButton>
          </div>
          <p className="mt-2 leading-relaxed"><Text>Accounts, shops, sponsors and figures are sample data. No real payments are made, and sensors and machines are simulated. SimeTown is not an official Sime Darby Property service.</Text></p>
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm backdrop-blur transition-colors hover:border-ink-300 hover:text-ink-900">
        <FlaskConical className="size-3.5 text-brand-600" aria-hidden />
        <Text>Demo</Text>
      </button>
    </div>
  );
}
