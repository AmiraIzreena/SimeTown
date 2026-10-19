import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv, LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, Award, BadgeCheck, Building2, ChartColumn, Check, HandCoins, Landmark, Recycle, RadioTower, Sprout, Store, Trophy, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { OfferTabs } from '@/components/features/offer-tabs';
import { SponsorSlider } from '@/components/features/sponsor-slider';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { CountUp } from '@/components/ui/count-up';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { PENERAJU_TIERS, PUBLIC_SPONSOR_TIERS, ROLE_HOME, SPONSOR_TIER_INFO } from '@/shared/domain';

export const metadata: Metadata = {
  title: 'Sponsors & Partners',
  description: 'The sponsors who fund township challenges, the tiers they choose, and the partners who help run the township.',
};

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Award, title: 'Choose a tier', text: 'A yearly tier gives your brand a place on this page and a set number of challenges.' },
  { icon: HandCoins, title: 'Fund a challenge', text: 'Your budget goes into a locked pool before any resident earns a single point from it.' },
  { icon: BadgeCheck, title: 'Residents take part', text: 'Every action is verified by a bin’s scale, a QR code or staff before a point is given.' },
  { icon: ChartColumn, title: 'See the results', text: 'You get grouped results, never a list of people. Unused reward money is refunded; tier and campaign fees are not.' },
];

/** Where a sponsor's RM20,000 challenge goes (proposal, worked example 3). */
const SPLIT = [
  { label: 'Spent at township shops', sen: 600_000, tone: 'bg-brand-500' },
  { label: 'SimeTown campaign fee', sen: 500_000, tone: 'bg-brand-800' },
  { label: 'Refunded to the sponsor', sen: 450_000, tone: 'bg-gold-500' },
  { label: 'Verification, prizes and publicity', sen: 300_000, tone: 'bg-ink-500' },
  { label: 'Expired points to a community pool', sen: 150_000, tone: 'bg-success-600' },
];

const PARTNERS: { icon: LucideIcon; who: string; gives: string; gets: string }[] = [
  { icon: Landmark, who: 'Local authority', gives: 'Acts on Lapor reports and official flood channels', gets: 'Live reports and flood data, fewer complaints' },
  { icon: RadioTower, who: 'Telco and sensor suppliers', gives: 'Connectivity and flood sensors, cost shared', gets: 'A real township showcase for their network' },
  { icon: Recycle, who: 'Licensed recycler', gives: 'Collects from the kiosk bins', gets: 'Clean, sorted material with signed weights' },
  { icon: Sprout, who: 'Conservation partner', gives: 'Confirms wildlife sightings and plans native planting', gets: 'Resident data for local biodiversity work' },
  { icon: Store, who: 'Township shops', gives: 'Accept points as redemption partners', gets: 'Customers who live a few streets away' },
];

const SECTIONS = [
  { id: 'sponsors', label: 'Our sponsors' },
  { id: 'how', label: 'How sponsorship works' },
  { id: 'tiers', label: 'Sponsor tiers' },
  { id: 'partners', label: 'Our partners' },
];

const rm = (sen: number) => `RM${(sen / 100).toLocaleString('en-MY')}`;

export default async function SponsorshipPage() {
  const actor = await currentActor();
  const home = actor ? ROLE_HOME[actor.role] : null;
  const total = SPLIT.reduce((sum, part) => sum + part.sen, 0);

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader home={home} overlay />

      <main>
        {/* Hero */}
        <section className="landing-community relative isolate overflow-hidden text-white">
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-36 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:pb-20 lg:pt-40">
            <div>
              <p style={{ '--i': 0 } as CSSProperties} className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300"><Text>{'Sponsors & Partners'}</Text></p>
              <h1 style={{ '--i': 1 } as CSSProperties} className="mt-4 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl"><Text>The organisations behind a greener township</Text></h1>
              <p style={{ '--i': 2 } as CSSProperties} className="mt-5 max-w-xl text-[17px] leading-8 text-white/80"><Text>Sponsors buy a yearly tier to promote their brand in the app, and can fund challenges residents complete in the real world. Tier and campaign fees are not refunded; unused reward money comes back. Partners bring a service, equipment or expertise that helps run the township.</Text></p>
              <div style={{ '--i': 3 } as CSSProperties} className="mt-8 flex flex-wrap gap-3">
                <Link href="#sponsors" className="site-cta px-6 py-3 text-base"><Text>Meet our sponsors</Text><ArrowRight className="size-4" aria-hidden /></Link>
                <Link href="#partners" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/10"><Text>Our partners</Text></Link>
              </div>
            </div>
            <dl style={{ '--i': 4 } as CSSProperties} className="grid grid-cols-3 gap-3">
              {[
                { value: 100, suffix: '%', label: 'of every challenge pool funded before points are given' },
                { value: 0, suffix: '', label: 'names shared with sponsors: grouped results only' },
                { value: 3, suffix: '', label: 'sponsor tiers, one brand per category at the top' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/12 bg-white/[0.06] p-4 backdrop-blur-xl">
                  <dt className="sr-only"><Text>{stat.label}</Text></dt>
                  <dd className="font-display text-3xl font-bold text-gold-300"><CountUp value={stat.value} />{stat.suffix}</dd>
                  <dd aria-hidden className="mt-2 text-xs leading-snug text-white/70"><Text>{stat.label}</Text></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <OfferTabs sections={SECTIONS} />

        {/* Sponsors slider */}
        <section id="sponsors" className="offer-anchor mx-auto max-w-6xl px-5 pt-20 sm:px-8 sm:pt-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Our sponsors</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Brands that fund the good residents do</Text></h2>
            </div>
            <p className="max-w-sm text-sm text-ink-500"><Text>Current sponsors, highest tier first.</Text></p>
          </Reveal>
          <Reveal className="-mx-5 mt-4 sm:-mx-8">
            <SponsorSlider />
          </Reveal>
        </section>

        {/* How it works */}
        <section id="how" className="offer-anchor mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>How a sponsorship works</Text></p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Four steps, with nothing hidden</Text></h2>
          </Reveal>
          <div className="relative mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <span aria-hidden className="steps-line absolute left-8 right-8 top-7 hidden h-px lg:block" />
            {STEPS.map((step, i) => (
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

          {/* Where the money goes */}
          <Reveal className="mt-14">
            <div className="glass-surface rounded-3xl border p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Example</Text></p>
                  <h3 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl"><Text>Where a RM20,000 challenge goes</Text></h3>
                </div>
                <p className="text-sm text-ink-500"><Text>Real cost to the sponsor: RM15,500, about RM6.20 per resident who took part.</Text></p>
              </div>
              <LocalizedDiv className="mt-6 flex h-4 w-full overflow-hidden rounded-full bg-ink-100" role="img" aria-label="RM20,000 split: RM6,000 spent at shops, RM5,000 fee, RM4,500 refunded, RM3,000 costs, RM1,500 community pool">
                {SPLIT.map((part, i) => (
                  <span key={part.label} className={`bar-grow h-full ${part.tone}`} style={{ width: `${(part.sen / total) * 100}%`, '--d': i } as CSSProperties} />
                ))}
              </LocalizedDiv>
              <ul className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                {SPLIT.map((part) => (
                  <li key={part.label} className="flex items-start gap-2">
                    <span aria-hidden className={`mt-1 size-2.5 shrink-0 rounded-full ${part.tone}`} />
                    <span><span className="block font-semibold text-ink-900">{rm(part.sen)}</span><span className="text-ink-600"><Text>{part.label}</Text></span></span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Tiers */}
        <section id="tiers" className="offer-anchor border-y border-white/80 bg-white/40 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Sponsor tiers</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>A tier for every size of business</Text></h2>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-600"><Text>Tier fees are separate from challenge budgets, which go into each challenge’s own locked pool.</Text></p>
            </Reveal>
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PUBLIC_SPONSOR_TIERS.map((tier, i) => {
                const info = SPONSOR_TIER_INFO[tier];
                const top = PENERAJU_TIERS.includes(tier);
                return (
                  <Reveal key={tier} index={i}>
                    <article className={`tier-card relative flex h-full flex-col rounded-3xl border p-6 ${top ? 'is-featured border-transparent text-white' : 'glass-surface shadow-sm'}`}>
                      {top && <span className="absolute right-5 top-5 rounded-full bg-gold-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-950"><Text>One per category</Text></span>}
                      <p className={`text-xs font-bold uppercase tracking-[0.18em] ${top ? 'text-gold-300' : 'text-brand-700'}`}>0{i + 1}</p>
                      <h3 className={`mt-2 text-xl font-bold ${top ? 'text-white' : ''}`}><Text>{info.label}</Text></h3>
                      <p className={`mt-4 font-display text-3xl font-bold ${top ? 'text-white' : 'text-ink-900'}`}>{rm(info.feeSen)}{info.feeToSen ? `–${rm(info.feeToSen)}` : ''}<span className={`text-sm font-medium ${top ? 'text-white/70' : 'text-ink-500'}`}> <Text>a year</Text></span></p>
                      <p className={`mt-1 text-sm ${top ? 'text-white/70' : 'text-ink-500'}`}><Text>{info.challenges === null ? 'Unlimited challenges' : info.challenges === 1 ? 'One challenge a year' : `${info.challenges} challenges a year`}</Text></p>
                      <ul className={`mt-5 flex-1 space-y-2.5 border-t pt-5 text-sm ${top ? 'border-white/15 text-white/85' : 'border-ink-100 text-ink-700'}`}>
                        {info.benefits.map((benefit) => (
                          <li key={benefit} className="flex gap-2"><Check className={`mt-0.5 size-4 shrink-0 ${top ? 'text-gold-300' : 'text-success-600'}`} aria-hidden /><Text>{benefit}</Text></li>
                        ))}
                      </ul>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* Partnerships beyond sponsorship */}
        <section id="partners" className="offer-anchor border-t border-ink-100 mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Our partners</Text></p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Partners help run the township. They are not sponsors.</Text></h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-600"><Text>A partner brings a service, equipment or expertise, and both sides gain from the work. No money changes hands for visibility. A partner that also buys a sponsor tier appears under Our sponsors as well.</Text></p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PARTNERS.map((partner, i) => (
              <Reveal key={partner.who} index={i}>
                <article className="glass-surface offer-card h-full rounded-2xl border p-5 shadow-sm">
                  <span className="offer-icon grid size-11 place-items-center rounded-xl bg-brand-100/80 text-brand-800"><partner.icon className="size-5" aria-hidden /></span>
                  <h3 className="mt-4 font-semibold"><Text>{partner.who}</Text></h3>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-400"><Text>Gives</Text></p>
                  <p className="mt-1 text-sm text-ink-700"><Text>{partner.gives}</Text></p>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-400"><Text>Gets</Text></p>
                  <p className="mt-1 text-sm text-ink-700"><Text>{partner.gets}</Text></p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Call to action */}
        <section className="px-5 pb-24 sm:px-8">
          <Reveal>
            <div className="landing-community relative isolate mx-auto flex max-w-6xl flex-col gap-6 overflow-hidden rounded-3xl px-8 py-12 text-white sm:px-14 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-white"><Text>Put your brand behind something residents actually do</Text></h2>
                <p className="mt-3 max-w-lg text-white/75"><Text>Sponsor accounts are set up by the township team. Sponsors sign in to see their tier, challenges and grouped results.</Text></p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href={home ?? '/login'} className="site-cta px-6 py-3 text-base"><Building2 className="size-4" aria-hidden /><Text>{home ? 'Open SimeTown' : 'Sponsor sign-in'}</Text></Link>
                <Link href="/challenges" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/10"><Trophy className="size-4" aria-hidden /><Text>Live challenges</Text></Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
