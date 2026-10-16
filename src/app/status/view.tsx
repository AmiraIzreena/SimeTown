'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton } from '@/components/ui/localized-elements';
import { Camera, CheckCircle2, Clock, CloudRain, Gauge, MapPin, Megaphone, Navigation, Phone, Share2, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { FloodBadge } from '@/components/features/flood';
import { WaterColumn } from '@/components/features/water-column';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface StatusZone {
  id: string;
  name: string;
  status: 'NORMAL' | 'WARNING' | 'DANGER';
  level_pct: number;
  safe_route: string;
  assembly_point: string;
  updated_at: string;
  message_kind: string | null;
  what: string | null;
  where_text: string | null;
  todo: string | null;
  next_update_at: string | null;
  sent_at: string | null;
}
type Township = { id: string; name: string; warningPct: number; dangerPct: number; zones: StatusZone[] };

const REFRESH = 30_000;
const RANK = { DANGER: 0, WARNING: 1, NORMAL: 2 } as const;

const HOTLINES: { number: string; label: string }[] = [
  { number: '999', label: 'Police and ambulance' },
  { number: '994', label: 'Fire and rescue (Bomba)' },
  { number: '991', label: 'Civil defence (APM)' },
];

const PIPELINE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Gauge, title: 'Drain sensors', text: 'Water levels in every zone, read through the day.' },
  { icon: Camera, title: 'Cameras and rain', text: 'A second, independent signal confirms what the sensors see.' },
  { icon: UserCheck, title: 'Duty officer', text: 'Checks every warning and can stop or change it before it goes out.' },
  { icon: ShieldCheck, title: 'You are told', text: 'Residents in the zone get the safe route on their screen at once.' },
];

/** Seconds until the next automatic refresh, restarting whenever the data arrives. */
function useCountdown(stamp: unknown) {
  const [left, setLeft] = useState(REFRESH / 1000);
  useEffect(() => {
    const started = Date.now();
    const tick = () => setLeft(Math.max(0, Math.ceil((REFRESH - (Date.now() - started)) / 1000)));
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [stamp]);
  return left;
}

function ZoneCard({ z, t, index }: { z: StatusZone; t: Township; index: number }) {
  return (
    <article className={cn('zone-card relative flex flex-col overflow-hidden rounded-3xl border bg-white p-6 shadow-sm', z.status === 'DANGER' && 'is-danger border-accent-200', z.status === 'WARNING' && 'border-warning-600/40', z.status === 'NORMAL' && 'border-white/80')} style={{ '--i': index } as CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-snug">{z.name}</h3>
        <FloodBadge status={z.status} />
      </div>
      <div className="mt-5 flex items-stretch gap-5">
        <WaterColumn level={z.level_pct} status={z.status} warningPct={t.warningPct} dangerPct={t.dangerPct} className="h-32" />
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500"><Text>Water level</Text></p>
            <p className={cn('font-display text-5xl font-bold tabular-nums leading-none', z.status === 'DANGER' ? 'text-accent-600' : z.status === 'WARNING' ? 'text-warning-700' : 'text-ink-900')}>
              <CountUp value={z.level_pct} />%
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-ink-500"><Clock className="size-3.5" aria-hidden /><Text>Updated </Text><Text>{timeAgo(z.updated_at)}</Text></p>
        </div>
      </div>

      {z.what && (
        <div className={cn('mt-5 rounded-2xl p-4 text-sm', z.status === 'DANGER' ? 'bg-accent-50' : 'bg-warning-50')}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">
            <Megaphone className="size-3.5" aria-hidden /><Text>Official message · </Text><Text>{z.sent_at ? formatDateTime(z.sent_at) : ''}</Text>
          </p>
          <p className="mt-1.5 font-semibold text-ink-900"><Text>{z.what}</Text></p>
          {z.todo && <p className="mt-1 text-ink-700"><Text>{z.todo}</Text></p>}
          {z.next_update_at && (
            <p className="mt-2 flex items-center gap-1.5 text-ink-600">
              <Clock className="size-3.5" aria-hidden /><Text>Next update by </Text><Text>{new Date(z.next_update_at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}</Text>
            </p>
          )}
        </div>
      )}

      <ul className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-sm text-ink-700">
        <li className="flex gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Navigation className="size-3.5" aria-hidden /></span>
          <span><span className="block text-xs font-semibold text-ink-500"><Text>Safe route</Text></span><Text>{z.safe_route}</Text></span>
        </li>
        <li className="flex gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><MapPin className="size-3.5" aria-hidden /></span>
          <span><span className="block text-xs font-semibold text-ink-500"><Text>Meeting point</Text></span><Text>{z.assembly_point}</Text></span>
        </li>
      </ul>
    </article>
  );
}

/**
 * The one official flood status page: the single source of truth during a
 * flood, readable without the app or an account. Zones and official messages
 * only, never anything about a person.
 */
export function StatusView() {
  const t = useT();
  const toast = useToast();
  const status = useApi<Township[]>('/public/flood-status', { refreshInterval: REFRESH });
  const left = useCountdown(status.data);
  const zones = status.data?.flatMap((tw) => tw.zones) ?? [];
  const counts = { NORMAL: 0, WARNING: 0, DANGER: 0 };
  for (const z of zones) counts[z.status]++;
  const worst = counts.DANGER ? 'DANGER' : counts.WARNING ? 'WARNING' : 'NORMAL';

  const share = async () => {
    const url = window.location.href.split('#')[0]!;
    const data = { title: t('Flood status'), text: t('The official flood status for City of Elmina'), url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); toast.show(t('Link copied')); }
    } catch { /* the person closed the share sheet */ }
  };

  const headline = !status.data ? t('Checking every zone…')
    : worst === 'DANGER' ? (counts.DANGER === 1 ? t('Flood danger in 1 zone') : t('Flood danger in {n} zones', { n: counts.DANGER }))
    : worst === 'WARNING' ? (counts.WARNING === 1 ? t('Flood warning in 1 zone') : t('Flood warning in {n} zones', { n: counts.WARNING }))
    : t('All zones are normal');

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className={cn('status-hero relative isolate overflow-hidden pt-[72px] text-white', `is-${worst.toLowerCase()}`)}>
          <div aria-hidden className="status-rain absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-14 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:pb-16 lg:pt-16">
            <div>
              <p style={{ '--i': 0 } as CSSProperties} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">
                <span className="live-dot" aria-hidden /><Text>Live</Text>
                <span className="text-white/60">·</span>
                <span className="tabular-nums text-white/80">{t('Refreshes in {n}s', { n: left })}</span>
              </p>
              <h1 style={{ '--i': 1 } as CSSProperties} className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl" aria-live="polite">{headline}</h1>
              <p style={{ '--i': 2 } as CSSProperties} className="mt-4 max-w-xl text-[17px] leading-8 text-white/80"><Text>The official flood status for every zone, updated every 15 minutes while an alert is open. Share this page instead of forwarding messages.</Text></p>
              <div style={{ '--i': 3 } as CSSProperties} className="mt-7 flex flex-wrap gap-3">
                <LocalizedButton type="button" onClick={() => void share()} className="site-cta px-5 py-3 text-base"><Share2 className="size-4" aria-hidden /><Text>Share this page</Text></LocalizedButton>
                <a href="tel:999" className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-white/15"><Phone className="size-4" aria-hidden /><Text>Emergency 999</Text></a>
              </div>
            </div>
            <dl style={{ '--i': 4 } as CSSProperties} className="grid grid-cols-3 gap-3">
              {([['NORMAL', 'Normal', CheckCircle2], ['WARNING', 'Warning', CloudRain], ['DANGER', 'Danger', Megaphone]] as const).map(([key, label, Icon]) => (
                <div key={key} className={cn('status-count rounded-2xl border p-4 backdrop-blur-xl', counts[key] && key !== 'NORMAL' ? 'border-white/40 bg-white/15' : 'border-white/12 bg-white/[0.06]')}>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-white/70"><Icon className="size-3.5" aria-hidden /><Text>{label}</Text></dt>
                  <dd className="mt-2 font-display text-3xl font-bold tabular-nums text-white">{status.data ? <CountUp value={counts[key]} /> : '–'}</dd>
                  <dd className="text-[11px] text-white/60"><Text>{counts[key] === 1 ? 'zone' : 'zones'}</Text></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Zones */}
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <Async state={status}>
            {(townships) =>
              townships.length === 0 ? (
                <EmptyState title="No townships yet" />
              ) : (
                <div className="space-y-12">
                  {townships.map((tw) => (
                    <div key={tw.id}>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 className="text-2xl font-bold tracking-tight">{tw.name}</h2>
                        <p className="flex flex-wrap items-center gap-4 text-xs text-ink-500">
                          <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-warning-600" aria-hidden /><Text>Warning</Text> {tw.warningPct}%</span>
                          <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-accent-500" aria-hidden /><Text>Danger</Text> {tw.dangerPct}%</span>
                        </p>
                      </div>
                      <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                        {[...tw.zones].sort((a, b) => RANK[a.status] - RANK[b.status] || b.level_pct - a.level_pct).map((z, i) => <ZoneCard key={z.id} z={z} t={tw} index={i} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </Async>
        </section>

        {/* How warnings are raised */}
        <section className="border-y border-white/80 bg-white/40 py-16">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>How warnings are raised</Text></p>
            <h2 className="mt-3 max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl"><Text>Two signals must agree, and a person checks</Text></h2>
            <ol className="status-pipeline relative mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <span aria-hidden className="steps-line absolute left-8 right-8 top-7 hidden h-px lg:block" />
              {PIPELINE.map((step, i) => (
                <li key={step.title} className="glass-surface offer-card relative list-none rounded-2xl border p-6 shadow-sm">
                  <span className="offer-icon relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md"><step.icon className="size-6" aria-hidden /></span>
                  <p className="mt-5 font-display text-xs font-bold tracking-[0.18em] text-brand-600">0{i + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold"><Text>{step.title}</Text></h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-600"><Text>{step.text}</Text></p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Hotlines */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="grid gap-4 md:grid-cols-[1fr_2fr] md:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-600"><Text>In an emergency</Text></p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight"><Text>Call for help first</Text></h2>
              <p className="mt-2 text-[15px] text-ink-600"><Text>This page supports official channels; it does not replace them.</Text></p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {HOTLINES.map((h) => (
                <a key={h.number} href={`tel:${h.number}`} className="hotline group flex items-center gap-4 rounded-2xl border border-ink-200 bg-white p-5 shadow-xs">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-600 transition-colors duration-300 group-hover:bg-accent-600 group-hover:text-white"><Phone className="size-5" aria-hidden /></span>
                  <span>
                    <span className="block font-display text-2xl font-bold tabular-nums text-ink-900">{h.number}</span>
                    <span className="block text-xs text-ink-500"><Text>{h.label}</Text></span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
