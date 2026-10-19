'use client';

import { Text } from '@/components/ui/localized-text';

import { Siren, TriangleAlert } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useEffect, useRef, useState } from 'react';
import { useVerifiedText, type Verified } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { speak, useLang, useT } from '@/lib/i18n';

interface ActiveAlert extends Verified {
  id: string;
  level: 'WARNING' | 'DANGER';
  zone_name: string;
  level_pct: number;
  safe_route: string;
  assembly_point: string;
}

interface AccessChoices {
  flashAlerts: boolean;
  readAloud: boolean;
}

/**
 * BR19: a flood danger warning comes before everything else. While a DANGER
 * alert is open for this person's zone, a full-screen warning with the safe
 * route covers whatever they were doing. After they acknowledge it, a banner
 * stays at the top until the alert ends. A WARNING shows the banner only.
 *
 * Akses+: for someone who asked for it, the warning also flashes (once a
 * second, well under the three-flashes-a-second safety limit) and vibrates,
 * and is read aloud.
 */
export function AlertTakeover({ href }: { href: string }) {
  const { data } = useApi<ActiveAlert[]>('/alerts/active', { refreshInterval: 15_000 });
  const access = useApi<AccessChoices>('/me/access');
  const t = useT();
  const verified = useVerifiedText();
  const lang = useLang();
  // Remembered for this browser tab only, so a new session shows the warning again.
  const [acknowledged, setAcknowledged] = useState<string | null>(() => (typeof window === 'undefined' ? null : window.sessionStorage.getItem('kita.alert.ack')));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alert = data?.[0];
  const takeover = alert?.level === 'DANGER' && acknowledged !== alert.id;
  const flash = Boolean(takeover && access.data?.flashAlerts);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (takeover && !dialog.open) dialog.showModal();
    if (!takeover && dialog.open) dialog.close();
  }, [takeover]);

  useEffect(() => {
    if (!takeover || !alert) return;
    if (access.data?.flashAlerts && 'vibrate' in navigator) navigator.vibrate([400, 200, 400, 200, 400]);
    if (access.data?.readAloud) speak(`${t('Flood danger')}. ${alert.zone_name}. ${t('Safe route')}: ${alert.safe_route}. ${t('Go to')}: ${alert.assembly_point}.`, lang);
  }, [takeover, alert, access.data, t, lang]);

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
            {t(danger ? 'Flood danger' : 'Flood warning')} · <Text>{alert.zone_name}</Text>: <Text>{alert.level_pct}</Text>%.
          </span>
          <Link href={href} className="font-semibold underline underline-offset-2">
            <Text>{danger ? t('Safe route') : 'View details'}</Text>
          </Link>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="flood-danger-title"
        onCancel={(event) => event.preventDefault() /* must be acknowledged, not dismissed by accident */}
        className={cn('m-0 h-dvh max-h-none w-screen max-w-none bg-accent-700 p-0 text-white open:flex open:animate-fade-in', flash && 'flash-alert')}
      >
        {takeover && (
          <div className="m-auto flex w-full max-w-lg flex-col items-center px-6 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-white/15">
              <Siren className="size-8" aria-hidden />
            </span>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-accent-100">{t('Flood danger')}</p>
            <h2 id="flood-danger-title" className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              <Text>{alert.zone_name}</Text>
            </h2>
            <p className="mt-3 text-lg text-accent-50">
              <Text>{alert.level_pct}</Text>%. {t('Move to safety now.')}
            </p>
            <dl className="mt-8 w-full space-y-3 text-left">
              <div className="rounded-lg bg-white/10 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-accent-100">{t('Safe route')}</dt>
                <dd className="mt-1 text-[17px] font-medium"><Text>{alert.safe_route}</Text></dd>
              </div>
              <div className="rounded-lg bg-white/10 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-accent-100">{t('Go to')}</dt>
                <dd className="mt-1 text-[17px] font-medium"><Text>{alert.assembly_point}</Text></dd>
              </div>
            </dl>
            {/* Where this warning comes from, and how fresh it is (Appendix E.1). */}
            <p className="mt-4 text-sm text-accent-100">{verified(alert)}</p>
            <Button variant="light" size="lg" className="mt-6 w-full text-accent-700 hover:bg-accent-50" onClick={acknowledge} autoFocus>
              {t('I understand')}
            </Button>
            <p className="mt-4 text-sm text-accent-100">{t('In an emergency call 999.')}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
