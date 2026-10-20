'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowRight, HeartPulse, ShieldCheck, Siren, TriangleAlert } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { useVerifiedText, type Verified } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
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
 *
 * A resident checks in right there: "I understand" keeps the safe route on
 * screen and asks "I'm safe" or "I need help" (the flow's step 4), so nobody
 * has to find the Banjir page first. "Later" closes it; the Banjir page still
 * has the same two buttons.
 */
export function AlertTakeover({ href, canCheckIn = false }: { href: string; canCheckIn?: boolean }) {
  const { data } = useApi<ActiveAlert[]>('/alerts/active', { refreshInterval: 15_000 });
  const access = useApi<AccessChoices>('/me/access');
  const t = useT();
  const verified = useVerifiedText();
  const lang = useLang();
  // Remembered for this browser tab only, so a new session shows the warning again.
  const [acknowledged, setAcknowledged] = useState<string | null>(() => (typeof window === 'undefined' ? null : window.sessionStorage.getItem('kita.alert.ack')));
  const [understood, setUnderstood] = useState(false);
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

  const checkin = useAction((status: 'SAFE' | 'NEED_HELP') => api.post('/banjir/checkin', { status }), {
    onSuccess: () => {
      void mutate('/banjir');
      acknowledge();
    },
    success: 'Thank you. The township team can see your answer.',
  });

  if (!alert) return null;
  function acknowledge() {
    if (!alert) return;
    window.sessionStorage.setItem('kita.alert.ack', alert.id);
    setAcknowledged(alert.id);
    setUnderstood(false);
  }
  const danger = alert.level === 'DANGER';

  return (
    <>
      {/*
        A solid band, deep amber for a warning and red for danger, so it can never be mistaken for the
        warm cream of the page. It names the level, says what the number means and what to do, shows it
        is live, and gives one clear button. The red full-screen danger alert below is unchanged.
      */}
      <div role="status" className={cn('flood-banner relative overflow-hidden text-white shadow-[0_4px_14px_rgb(45_20_7/0.18)]', danger ? 'is-danger' : 'is-warning')}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:px-6 lg:px-8">
          <span aria-hidden className="flood-icon relative grid size-9 shrink-0 place-items-center rounded-full bg-white/18 ring-1 ring-white/30">
            {danger ? <Siren className="size-[18px]" /> : <TriangleAlert className="size-[18px]" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className={cn('rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em]', 'bg-white text-accent-700')}>{t(danger ? 'Flood danger' : 'Flood warning')}</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/85"><span aria-hidden className="flood-live-dot" />{t('Live')}</span>
              <span className="text-[15px] font-semibold"><Text>{alert.zone_name}</Text></span>
            </p>
            <p className="mt-0.5 text-sm text-white/90">
              <Text>{`Water level is at ${alert.level_pct}%.`}</Text>{' '}
              <Text>{danger ? 'Move to safety now.' : canCheckIn ? 'Get ready to move and check your safe route.' : 'Check the flood dashboard for the latest readings.'}</Text>
            </p>
          </div>
          <Link
            href={href}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-semibold shadow-sm transition-[transform,box-shadow] duration-200 ease-soft hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-safe:hover:-translate-y-px',
              'text-accent-700',
            )}
          >
            <Text>{canCheckIn ? 'See safe route' : 'View details'}</Text>
            <ArrowRight className="size-4" aria-hidden />
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
            {understood ? (
              <div className="mt-6 w-full space-y-3">
                <p className="text-lg font-semibold text-white">{t('Let the township team know how you are.')}</p>
                <Button variant="light" size="lg" className="w-full text-accent-700 hover:bg-accent-50" onClick={() => void checkin.run('SAFE')} pending={checkin.pending} autoFocus>
                  <ShieldCheck className="size-5" aria-hidden />{t("I'm safe")}
                </Button>
                <Button variant="danger" size="lg" className="w-full border border-white/40" onClick={() => void checkin.run('NEED_HELP')} disabled={checkin.pending}>
                  <HeartPulse className="size-5" aria-hidden />{t('I need help')}
                </Button>
                <button type="button" className="w-full py-2 text-sm font-medium text-accent-100 underline underline-offset-2" onClick={acknowledge} disabled={checkin.pending}>
                  {t('Later')}
                </button>
              </div>
            ) : (
              <Button variant="light" size="lg" className="mt-6 w-full text-accent-700 hover:bg-accent-50" onClick={() => (canCheckIn ? setUnderstood(true) : acknowledge())} autoFocus>
                {t('I understand')}
              </Button>
            )}
            <p className="mt-4 text-sm text-accent-100">{t('In an emergency call 999.')}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
