import { Text } from '@/components/ui/localized-text';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, BadgeCheck, Banknote, Coins, Gift, QrCode, Recycle, ShieldCheck, Smartphone, Store, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { ShopDirectory } from '@/components/features/shop-directory';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

export const metadata: Metadata = {
  title: 'Shops',
  description: 'Township shops where residents earn and spend SimeTown Points, and what it costs a shop to join.',
};

const COUNTER: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: QrCode, title: 'Show your member code', text: 'At the counter, show the code in your Points & XP screen, or say it.' },
  { icon: Coins, title: 'Earn as you pay', text: 'The shop gives 1 point for every RM1 you pay. The shop funds those points itself.' },
  { icon: Smartphone, title: 'Spend with one tap', text: 'Use points for up to 30% of a bill. Your phone asks you to confirm first.' },
  { icon: Banknote, title: 'The shop is paid in full', text: 'Every week the reward float pays the shop for the points it accepted.' },
];

const TWO_WAYS: { icon: LucideIcon; title: string; text: string; tone: string }[] = [
  { icon: Recycle, title: 'Good actions earn Impact XP', text: 'Recycling, cycling, gardening and helping a neighbour earn XP, levels and badges. Some also earn offer-backed points.', tone: 'from-success-600 to-[#0f5e3d]' },
  { icon: Gift, title: 'Shops turn them into savings', text: 'Offer-backed points unlock a Shop Offer, such as RM2 off groceries, on the terms the shop chose.', tone: 'from-brand-500 to-brand-800' },
  { icon: ShieldCheck, title: 'Every point is paid for first', text: 'Shopping points are funded by the shop, challenge points by a sponsor, community points by SDP.', tone: 'from-gold-500 to-[#86590a]' },
];

export default async function ShopsPage() {
  const actor = await currentActor();
  const home = actor ? ROLE_HOME[actor.role] : null;

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader home={home} overlay />

      <main>
        {/* Hero */}
        <section className="hero-photo relative isolate overflow-hidden text-white">
          <div className="hero-photo-frame absolute inset-y-0 right-0 -z-20 w-full overflow-hidden lg:w-[55%]">
            <Image src="/images/shops/cafe.jpg" alt="" fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="hero-photo-img object-cover object-center" />
          </div>
          <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto max-w-6xl px-5 pb-16 pt-36 sm:px-8 lg:pb-24 lg:pt-40">
            <p style={{ '--i': 0 } as CSSProperties} className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300"><Text>Shops</Text></p>
            <h1 style={{ '--i': 1 } as CSSProperties} className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl"><Text>Shop local. Earn as you go.</Text></h1>
            <p style={{ '--i': 2 } as CSSProperties} className="mt-5 max-w-lg text-[17px] leading-8 text-white/80"><Text>Every township shop that joins SimeTown gives and accepts the same points, so the good you do in the township becomes a saving a few streets from home.</Text></p>
            <div style={{ '--i': 3 } as CSSProperties} className="mt-8 flex flex-wrap gap-3">
              <Link href="#directory" className="site-cta px-6 py-3 text-base"><Text>Browse shops</Text><ArrowRight className="size-4" aria-hidden /></Link>
              <Link href="/join" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/10"><Store className="size-4" aria-hidden /><Text>Own a shop? Join</Text></Link>
            </div>
          </div>
        </section>

        {/* At the counter */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>At the counter</Text></p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Four moments, under a minute</Text></h2>
          </Reveal>
          <div className="relative mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <span aria-hidden className="steps-line absolute left-8 right-8 top-7 hidden h-px lg:block" />
            {COUNTER.map((step, i) => (
              <Reveal key={step.title} index={i}>
                <div className="glass-surface offer-card relative h-full rounded-2xl border p-6 shadow-sm">
                  <span className="offer-icon relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md"><step.icon className="size-6" aria-hidden /></span>
                  <p className="mt-5 font-display text-xs font-bold tracking-[0.18em] text-brand-600">0{i + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold"><Text>{step.title}</Text></h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-600"><Text>{step.text}</Text></p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* XP and shops */}
        <section className="landing-community py-20 text-white sm:py-24">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-300"><Text>Impact XP and shops</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>Do good in the township. Save at the shops in it.</Text></h2>
            </Reveal>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {TWO_WAYS.map((card, i) => (
                <Reveal key={card.title} index={i}>
                  <article className="h-full rounded-3xl border border-white/12 bg-white/[0.06] p-7 backdrop-blur-xl transition-colors duration-300 hover:bg-white/[0.1]">
                    <span className={`grid size-12 place-items-center rounded-2xl bg-gradient-to-br ${card.tone} text-white shadow-lg`}><card.icon className="size-6" aria-hidden /></span>
                    <h3 className="mt-5 text-xl font-semibold text-white"><Text>{card.title}</Text></h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-brand-100/90"><Text>{card.text}</Text></p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Directory */}
        <section id="directory" className="offer-anchor mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Township shops</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Where your points are welcome</Text></h2>
            </div>
            <p className="max-w-sm text-sm text-ink-500"><Text>Shops across City of Elmina that give and accept SimeTown Points.</Text></p>
          </Reveal>
          <Reveal className="mt-8">
            <ShopDirectory />
          </Reveal>
        </section>

        {/* For shop owners */}
        <section className="border-y border-white/80 bg-white/40 py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>For shop owners</Text></p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Win neighbours, not commission bills</Text></h2>
              <ul className="mt-6 space-y-3 text-[15px] text-ink-700">
                {['Free to list, and no fee for accepting points', 'Paid 100% of every point you accept, every week', 'Set your own Shop Offer, with a monthly budget you control', 'A weekly statement for every sale and fee'].map((line) => (
                  <li key={line} className="flex gap-2.5"><BadgeCheck className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden /><Text>{line}</Text></li>
                ))}
              </ul>
              <Link href="/join" className="site-cta mt-8 px-6 py-3 text-base"><Text>Apply to join</Text><ArrowRight className="size-4" aria-hidden /></Link>
            </Reveal>
            <Reveal index={1}>
              <div className="glass-surface rounded-3xl border p-6 shadow-sm sm:p-8">
                <h3 className="text-lg font-semibold"><Text>What RM100 of sales costs a shop</Text></h3>
                <div className="mt-6 space-y-5">
                  {[
                    { label: 'SimeTown points and fee', value: 'RM1.15', pct: 4.2, tone: 'bg-gradient-to-r from-brand-500 to-brand-700' },
                    { label: 'Typical delivery platform commission', value: 'RM25 to RM30', pct: 100, tone: 'bg-ink-400' },
                  ].map((row, i) => (
                    <div key={row.label}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-ink-700"><Text>{row.label}</Text></span>
                        <span className="font-display text-lg font-bold text-ink-900"><Text>{row.value}</Text></span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink-100">
                        <span className={`bar-grow block h-full rounded-full ${row.tone}`} style={{ width: `${row.pct}%`, '--d': i } as CSSProperties} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs leading-relaxed text-ink-500"><Text>SimeTown: 1 point (RM1) per RM100 paid, plus a 15% service fee on that point. Delivery commission rates vary by contract.</Text></p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
