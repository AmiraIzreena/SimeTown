'use client';

import { Siren, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/hooks';

interface ActiveAlert {
  id: string;
  level: 'WARNING' | 'DANGER';
  zone_name: string;
  level_pct: number;
  safe_route: string;
  assembly_point: string;
}

/**
 * BR19: a flood danger warning comes before everything else. While a DANGER
 * alert is open for this person's zone, a full-screen warning with the safe
 * route covers whatever they were doing. After they acknowledge it, a banner
 * stays at the top until the alert ends. A WARNING shows the banner only.
 */
export function AlertTakeover({ href }: { href: string }) {
  const { data } = useApi<ActiveAlert[]>('/alerts/active', { refreshInterval: 15_000 });
  // Remembered for this browser tab only, so a new session shows the warning again.
  const [acknowledged, setAcknowledged] = useState<string | null>(() => (typeof window === 'undefined' ? null : window.sessionStorage.getItem('kita.alert.ack')));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alert = data?.[0];
  const takeover = alert?.level === 'DANGER' && acknowledged !== alert.id;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (takeover && !dialog.open) dialog.showModal();
    if (!takeover && dialog.open) dialog.close();
  }, [takeover]);

  if (!alert) return null;
  const acknowledge = () => {
    window.sessionStorage.setItem('kita.alert.ack', alert.id);
    setAcknowledged(alert.id);
  };
  const danger = alert.level === 'DANGER';

  return (
    <>
      <div role="status" className={danger ? 'bg-accent-600 text-white' : 'bg-warning-50 text-warning-700'}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm font-medium sm:px-6 lg:px-8">
          <TriangleAlert className="size-[18px] shrink-0" aria-hidden />
          <span>
            Flood {danger ? 'danger' : 'warning'} in {alert.zone_name}: water at {alert.level_pct}%.
          </span>
          <Link href={href} className="font-semibold underline underline-offset-2">
            {danger ? 'See the safe route' : 'View details'}
          </Link>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="flood-danger-title"
        onCancel={(event) => event.preventDefault() /* must be acknowledged, not dismissed by accident */}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-accent-700 p-0 text-white open:flex open:animate-fade-in"
      >
        {takeover && (
          <div className="m-auto flex w-full max-w-lg flex-col items-center px-6 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-white/15">
              <Siren className="size-8" aria-hidden />
            </span>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-accent-100">Flood danger</p>
            <h2 id="flood-danger-title" className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              {alert.zone_name}
            </h2>
            <p className="mt-3 text-lg text-accent-50">Water level is at {alert.level_pct}%. Move to safety now.</p>
            <dl className="mt-8 w-full space-y-3 text-left">
              <div className="rounded-lg bg-white/10 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-accent-100">Safe route</dt>
                <dd className="mt-1 text-[17px] font-medium">{alert.safe_route}</dd>
              </div>
              <div className="rounded-lg bg-white/10 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-accent-100">Go to</dt>
                <dd className="mt-1 text-[17px] font-medium">{alert.assembly_point}</dd>
              </div>
            </dl>
            <Button variant="light" size="lg" className="mt-8 w-full text-accent-700 hover:bg-accent-50" onClick={acknowledge} autoFocus>
              I understand
            </Button>
            <p className="mt-4 text-sm text-accent-100">In an emergency call 999.</p>
          </div>
        )}
      </dialog>
    </>
  );
}
