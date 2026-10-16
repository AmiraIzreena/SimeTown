import { Text } from '@/components/ui/localized-text';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, Building2, DoorOpen, Gauge, Megaphone, Store, Wallet, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { FEATURES, STEPS } from '@/components/features/offer-content';
import { OfferTabs } from '@/components/features/offer-tabs';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { CountUp } from '@/components/ui/count-up';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

export const metadata: Metadata = {
  title: 'What we offer',
  description: 'Every SimeTown module for residents, shops, sponsors and Sime Darby Property, and how its points work.',
};

const STATS: { value: number; suffix?: string; label: string }[] = [
  { value: 17, label: 'modules in one app' },
  { value: 7, label: 'role views, one sign-in' },
  { value: 2, label: 'languages: English and Bahasa Malaysia' },
  { value: 100, suffix: '%', label: 'of points paid for before they are given' },
];

const LAYER_NOTES: Record<string, string> = {
  people: 'Neighbours who know each other, gates that know who is expected, and help that reaches the people who need it first.',
  planet: 'Recycling, sharing, saving and gardening that are easy to do, counted properly and rewarded fairly.',
  business: 'Simple tools for the shops, sponsors and township team that keep the whole system funded and honest.',
};

const WHO: { icon: LucideIcon; title: string; gets: string[] }[] = [
  { icon: Wallet, title: 'Residents', gets: ['One account and one points balance', 'Savings at township shops', 'Flood warnings and visitor passes', 'Simple Mode and read-aloud if you need them'] },
  { icon: Store, title: 'Township shops', gets: ['Free to list', 'Paid 100% of every point accepted, every week', 'Shop Offers with a budget you set', 'Weekly statements'] },
  { icon: Megaphone, title: 'Sponsors', gets: ['Challenges with a fixed budget', 'Unused money refunded', 'Grouped results, never personal data', 'Partner tiers on a public page'] },
  { icon: DoorOpen, title: 'Guards', gets: ['Scan visitor passes at the gate', 'Answer walk-ins with the resident', 'SOS calls and patrol rounds', 'Flood task list'] },
  { icon: Gauge, title: 'Sime Darby Property', gets: ['Township results in totals only', 'The float matched to the sen', 'A monthly impact report', 'Flood agent and report queue'] },
];

export default async function OfferPage() {
  const actor = await currentActor();
  const home = actor ? ROLE_HOME[actor.role] : null;

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader home={home} overlay />

      <main>
        {/* Hero */}
        <section className="hero-photo relative isolate overflow-hidden text-white">
          <div className="hero-photo-frame absolute inset-y-0 right-0 -z-20 w-full overflow-hidden lg:w-[55%]">
            <Image src="/images/sdp-home.jpg" alt="" fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="hero-photo-img object-cover object-center" />
          </div>
          <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto max-w-6xl px-5 pb-16 pt-36 sm:px-8 lg:pb-20 lg:pt-40">
            <p style={{ '--i': 0 } as CSSProperties} className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300"><Text>What we offer</Text></p>
            <h1 style={{ '--i': 1 } as CSSProperties} className="mt-4 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl"><Text>One app for everything township life needs</Text></h1>
            <p style={{ '--i': 2 } as CSSProperties} className="mt-5 max-w-xl text-[17px] leading-8 text-white/80"><Text>SimeTown brings safety, community, green living and local shopping together under one verified account, with points that every township shop accepts.</Text></p>
            <dl style={{ '--i': 3 } as CSSProperties} className="mt-10 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="border-l-2 border-gold-300/60 pl-4">
                  <dt className="sr-only"><Text>{stat.label}</Text></dt>
                  <dd className="font-display text-3xl font-bold text-white"><CountUp value={stat.value} />{stat.suffix}</dd>
                  <dd aria-hidden className="mt-1 text-sm leading-snug text-white/70"><Text>{stat.label}</Text></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <OfferTabs />

        {/* Modules by layer */}
        {FEATURES.map((group, g) => (
          <section key={group.id} id={group.id} className={`offer-anchor py-20 sm:py-24 ${g % 2 ? 'border-y border-white/80 bg-white/40' : ''}`}>
            <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_2fr] lg:gap-14">
              <Reveal className="lg:sticky lg:top-40 lg:self-start">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>{group.layer}</Text></p>
                <h2 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl"><Text>{group.question}</Text></h2>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-600"><Text>{LAYER_NOTES[group.id]}</Text></p>
              </Reveal>
              <div className="grid gap-4 sm:grid-cols-2">
                {group.items.map((item, i) => (
                  <Reveal key={item.name} index={i}>
                    <article className="glass-surface offer-card h-full rounded-2xl border p-6 shadow-sm">
                      <span className="offer-icon grid size-11 place-items-center rounded-xl bg-brand-100/80 text-brand-800">
                        <item.icon className="size-5" aria-hidden />
                      </span>
                      <h3 className="mt-5 text-lg font-semibold">
                        {item.name} <span className="text-sm font-normal text-ink-500"><Text>{item.gloss}</Text></span>
                      </h3>
                      <p className="mt-2 text-[15px] leading-relaxed text-ink-600"><Text>{item.text}</Text></p>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        ))}

        {/* How points work */}
        <section id="points" className="offer-anchor landing-community py-20 text-white sm:py-24">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-300"><Text>How points work</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>No pool, no points.</Text></h2>
              <p className="mt-4 max-w-2xl text-[17px] leading-8 text-brand-100/90"><Text>A point is given only after someone has put the money for it into a separate, locked pot: the reward float. That is why a shop can always be paid, and why SimeTown never earns from points residents fail to use.</Text></p>
            </Reveal>
            <div className="relative mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <span aria-hidden className="absolute left-6 right-6 top-6 hidden h-px bg-gradient-to-r from-gold-300/0 via-gold-300/60 to-gold-300/0 lg:block" />
              {STEPS.map((step, i) => (
                <Reveal key={step.n} index={i}>
                  <div className="relative h-full rounded-2xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-xl transition-colors duration-300 hover:bg-white/[0.12]">
                    <span className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 font-display text-lg font-bold text-white shadow-lg ring-4 ring-brand-950/40"><Text>{step.n}</Text></span>
                    <h3 className="mt-5 text-lg font-semibold text-white"><Text>{step.title}</Text></h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-brand-100/90"><Text>{step.text}</Text></p>
                  </div>
                </Reveal>
              ))}
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ['100 pts', '= RM1, always'],
                ['30%', 'of a bill at most'],
                ['100%', 'repaid to shops'],
              ].map(([big, small], i) => (
                <Reveal key={big} index={i}>
                  <div className="rounded-2xl border border-white/10 bg-black/15 px-6 py-5">
                    <p className="font-display text-3xl font-bold text-gold-300"><Text>{big}</Text></p>
                    <p className="mt-1 text-sm font-semibold text-white"><Text>{small}</Text></p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Who it is for */}
        <section id="who" className="offer-anchor mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Who it is for</Text></p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>One sign-in, the right screen for each person</Text></h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {WHO.map((who, i) => (
              <Reveal key={who.title} index={i}>
                <article className="glass-surface offer-card h-full rounded-2xl border p-6 shadow-sm">
                  <span className="offer-icon grid size-11 place-items-center rounded-xl bg-brand-100/80 text-brand-800"><who.icon className="size-5" aria-hidden /></span>
                  <h3 className="mt-5 text-lg font-semibold"><Text>{who.title}</Text></h3>
                  <ul className="mt-3 space-y-2 text-sm text-ink-600">
                    {who.gets.map((get) => (
                      <li key={get} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" /><Text>{get}</Text></li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Call to action */}
        <section className="px-5 pb-24 sm:px-8">
          <Reveal>
            <div className="hero-photo relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl px-8 py-14 text-white sm:px-14">
              <div className="absolute inset-y-0 right-0 -z-20 w-2/3 overflow-hidden">
                <Image src="/images/sdp-home.jpg" alt="" fill sizes="66vw" className="object-cover object-center opacity-80" />
              </div>
              <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
              <h2 className="max-w-lg text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>Ready to see your township move together?</Text></h2>
              <p className="mt-4 max-w-md text-[17px] text-white/80"><Text>Create a resident account, or apply to join as a township shop.</Text></p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={home ?? '/register'} className="site-cta px-6 py-3 text-base"><Text>{home ? 'Open SimeTown' : 'Create a resident account'}</Text><ArrowRight className="size-4" aria-hidden /></Link>
                <Link href="/join" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/10"><Building2 className="size-4" aria-hidden /><Text>Apply to join</Text></Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
