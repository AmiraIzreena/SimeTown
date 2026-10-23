'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedAside, LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, BadgeCheck, Car, CheckCircle2, DoorOpen, Droplets, Mail, QrCode, Recycle, ScanLine, UserPlus, type LucideIcon } from 'lucide-react';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface StatusTownship {
  warningPct: number;
  dangerPct: number;
  zones: { id: string; name: string; status: 'NORMAL' | 'WARNING' | 'DANGER'; level_pct: number }[];
}
interface Group {
  label: string;
  sponsors: { name: string; tagline: string | null }[];
}

const ARRIVAL: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Mail, title: 'Your pass comes by email', text: 'SimeTown emails it when your host invites you. It is valid for the day or the times your host chose. No email? Your host can give you the pass code instead.' },
  { icon: Car, title: 'Drive to the main gate', text: 'Open the link on your phone as you arrive. No app to download. Bring your identity card: the guard checks it and hands it straight back.' },
  { icon: ScanLine, title: 'The guard scans it', text: 'Your host is told the moment you arrive, and you are on your way in seconds.' },
];

function Journey({ icon: Icon, title, text, visual, action, index }: { icon: LucideIcon; title: string; text: string; visual: ReactNode; action?: ReactNode; index: number }) {
  return (
    <Reveal index={index}>
      <article className="journey-card group flex h-full flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-sm">
        <div className="journey-visual relative grid h-60 place-items-center overflow-hidden">{visual}</div>
        <div className="flex flex-1 flex-col p-6">
          <span className="offer-icon grid size-11 place-items-center rounded-xl bg-brand-100/80 text-brand-800"><Icon className="size-5" aria-hidden /></span>
          <h2 className="mt-4 text-xl font-semibold"><Text>{title}</Text></h2>
          <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-600"><Text>{text}</Text></p>
          {action}
        </div>
      </article>
    </Reveal>
  );
}

/** A visitor pass on a phone, with a scan line sweeping the code. */
function PassVisual() {
  return (
    <div className="pass-visual relative w-36 rounded-2xl bg-white p-3.5 text-ink-900 shadow-xl">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700"><Text>Visitor pass</Text></p>
      <p className="mt-1 text-sm font-semibold">Puan Rahmah</p>
      <div className="relative mt-2.5 overflow-hidden rounded-lg bg-ink-50 p-2">
        <QrCode className="mx-auto size-16 text-ink-900" strokeWidth={1.4} aria-hidden />
        <span aria-hidden className="pass-scan absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-transparent via-brand-400/50 to-transparent" />
      </div>
      <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-success-700"><BadgeCheck className="size-3" aria-hidden /><Text>Valid today</Text></p>
    </div>
  );
}

/** A guest claim code, its letters settling into place. */
function ClaimVisual() {
  const code = 'GX7K2Q9M';
  return (
    <div className="text-center">
      <span className="claim-ring mx-auto grid size-14 place-items-center rounded-full bg-white/15 text-white"><Recycle className="size-7" aria-hidden /></span>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70"><Text>Your claim code</Text></p>
      <p className="mt-2 flex justify-center gap-1" aria-label={code}>
        {code.split('').map((ch, i) => (
          <span key={i} aria-hidden className="claim-char grid h-9 w-7 place-items-center rounded-md bg-white font-display text-lg font-bold text-brand-900 shadow" style={{ '--i': i } as CSSProperties}>{ch}</span>
        ))}
      </p>
    </div>
  );
}

/** The township's live flood status in miniature. */
function FloodVisual({ zones, dangerPct }: { zones: StatusTownship['zones']; dangerPct: number }) {
  const shown = zones.slice(0, 4);
  return (
    <div className="flex h-36 items-end gap-3">
      {(shown.length ? shown : [{ id: 'a', name: '', status: 'NORMAL' as const, level_pct: 20 }]).map((z, i) => (
        <div key={z.id} className="flex flex-col items-center gap-2">
          <span className="relative h-28 w-8 overflow-hidden rounded-lg bg-white/15">
            <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-white/60" style={{ bottom: `${dangerPct}%` }} />
            <span className={cn('mini-fill absolute inset-x-0 bottom-0 rounded-b-lg', z.status === 'DANGER' ? 'bg-accent-500' : z.status === 'WARNING' ? 'bg-gold-300' : 'bg-white')} style={{ height: `${Math.max(6, z.level_pct)}%`, '--i': i } as CSSProperties} />
          </span>
          <span className="max-w-12 truncate text-[10px] font-semibold text-white/80">{z.name.replace(/^Elmina\s+/, '')}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Guest mode: what a visitor, or a resident who has not joined yet, can do
 * without an account. Guests are not tracked.
 */
export function GuestView() {
  const t = useT();
  const status = useApi<StatusTownship[]>('/public/flood-status', { refreshInterval: 60_000 });
  const partners = useApi<Group[]>('/public/partners');
  const township = status.data?.[0];
  const zones = status.data?.flatMap((tw) => tw.zones) ?? [];
  const alerts = zones.filter((z) => z.status !== 'NORMAL');
  const title = partners.data?.find((g) => g.label === 'Peneraju')?.sponsors[0] ?? partners.data?.[0]?.sponsors[0];
  const sponsorName = title?.name.replace(/\s*\(demo sponsor\)\s*$/i, '');

  const floodLine = !status.data ? t('Checking the flood status…')
    : alerts.length === 1 ? t('Flood alert in {names}', { names: alerts[0]!.name })
    : alerts.length ? t('Flood alerts in {n} zones: {names}', { n: alerts.length, names: alerts.map((a) => a.name).join(', ') })
    : t('All zones are normal right now');

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader overlay />
      <main>
        {/* Hero */}
        <section className="hero-photo relative isolate overflow-hidden text-white">
          <div className="hero-photo-frame absolute inset-y-0 right-0 -z-20 w-full overflow-hidden lg:w-[58%]">
            <Image src="/images/sdp-home.jpg" alt="" fill priority sizes="(min-width: 1024px) 58vw, 100vw" className="hero-photo-img object-cover object-center" />
          </div>
          <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto max-w-6xl px-5 pb-16 pt-36 sm:px-8 lg:pb-24 lg:pt-40">
            <p style={{ '--i': 0 } as CSSProperties} className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300"><Text>Guests</Text></p>
            <h1 style={{ '--i': 1 } as CSSProperties} className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl"><Text>Welcome to City of Elmina</Text></h1>
            <p style={{ '--i': 2 } as CSSProperties} className="mt-5 max-w-lg text-[17px] leading-8 text-white/80"><Text>Visiting family, friends or a shop? No account needed. Here is everything a guest can do in the township.</Text></p>
            <div style={{ '--i': 3 } as CSSProperties} className="mt-8">
              <Link href="/status" className={cn('status-chip inline-flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm font-semibold backdrop-blur-md transition-colors', alerts.length ? 'border-gold-300/60 bg-gold-300/15 hover:bg-gold-300/25' : 'border-white/20 bg-white/10 hover:bg-white/15')}>
                {alerts.length ? <Droplets className="size-4 text-gold-300" aria-hidden /> : <CheckCircle2 className="size-4 text-[#7fe0b0]" aria-hidden />}
                <span>{floodLine}</span>
                <ArrowRight className="size-4 opacity-70" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* Journeys */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>For guests</Text></p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Three things you can do today</Text></h2>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <Journey index={0} icon={DoorOpen} title="Visitor pass" text="SimeTown emails you the pass your host made. Open it, add your details if your host asks, and show the QR code at the main gate. No app needed." visual={<PassVisual />} />
            <Journey index={1} icon={Recycle} title="Recycle as a guest" text="Tap “Recycle as guest” on the screen of any kiosk bin. You get a claim code: join SimeTown within 14 days to claim the Impact XP. Guests are not tracked." visual={<ClaimVisual />} />
            <Journey
              index={2}
              icon={Droplets}
              title="Flood status"
              text="Check every zone’s water level before you travel, with the safe route and meeting point for each zone."
              visual={<FloodVisual zones={zones} dangerPct={township?.dangerPct ?? 90} />}
              action={<Link href="/status" className="group/cta mt-5 inline-flex items-center gap-2 self-start text-sm font-semibold text-brand-700"><Text>Open the status page</Text><ArrowRight className="size-4 transition-transform duration-200 group-hover/cta:translate-x-1" aria-hidden /></Link>}
            />
          </div>
        </section>

        {/* Arriving */}
        <section className="landing-community py-20 text-white sm:py-24">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-300"><Text>Arriving at the gate</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>In at the gate in under a minute</Text></h2>
            </Reveal>
            <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
              <span aria-hidden className="arrival-line absolute left-10 right-10 top-8 hidden h-px md:block" />
              {ARRIVAL.map((step, i) => (
                <Reveal key={step.title} index={i}>
                  <li className="relative h-full list-none rounded-3xl border border-white/12 bg-white/[0.06] p-7 backdrop-blur-xl transition-colors duration-300 hover:bg-white/[0.1]">
                    <span className="relative grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg ring-4 ring-brand-950/40"><step.icon className="size-7" aria-hidden /></span>
                    <p className="mt-5 font-display text-xs font-bold tracking-[0.18em] text-gold-300">0{i + 1}</p>
                    <h3 className="mt-1 text-xl font-semibold text-white"><Text>{step.title}</Text></h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-brand-100/90"><Text>{step.text}</Text></p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl space-y-5 px-5 py-20 sm:px-8">
          {title && (
            <Reveal>
              <LocalizedAside aria-label="Sponsored" className="sponsor-strip flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-3xl border border-gold-300/60 bg-gradient-to-r from-gold-50 via-white to-gold-50 px-6 py-5">
                <p className="text-[15px] text-ink-800">
                  <strong className="font-semibold">{sponsorName}</strong>
                  {title.tagline && <> · <Text>{title.tagline}</Text></>}
                </p>
                <span className="flex items-center gap-3">
                  <Link href="/sponsorship#sponsors" className="text-sm font-semibold text-brand-700 hover:underline"><Text>All sponsors</Text></Link>
                  <span className="shrink-0 rounded-full border border-gold-300 bg-white px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold-700"><Text>Sponsored</Text></span>
                </span>
              </LocalizedAside>
            </Reveal>
          )}

          <Reveal>
            <div className="hero-photo relative isolate overflow-hidden rounded-3xl px-8 py-12 text-white sm:px-12">
              <div className="absolute inset-y-0 right-0 -z-20 w-2/3 overflow-hidden">
                <Image src="/images/sdp-home.jpg" alt="" fill sizes="66vw" className="object-cover object-center opacity-80" />
              </div>
              <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
              <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight text-white"><Text>Live in the township?</Text></h2>
              <p className="mt-3 max-w-md text-white/80"><Text>Join with your address to earn points at local shops, get flood alerts for your street, and send visitor passes.</Text></p>
              <Link href="/register" className="site-cta mt-7 px-6 py-3 text-base"><UserPlus className="size-4" aria-hidden /><Text>Create a resident account</Text></Link>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
