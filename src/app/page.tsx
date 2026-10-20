
import { Text } from '@/components/ui/localized-text';
import { ArrowRight, Building2, ChevronDown, ShieldCheck, Wallet } from 'lucide-react';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { SiteHeader } from '@/components/shell/site-header';
import { SiteFooter } from '@/components/shell/site-footer';
import { LandingFaq, ModuleStrip } from '@/components/features/landing-extras';
import { HowItWorks } from '@/components/features/how-it-works';
import { Reveal } from '@/components/ui/reveal';
import { BlurReveal } from '@/components/ui/blur-reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

const AUDIENCES = [
  { icon: Wallet, title: 'Residents', text: 'One account and one balance for every township service.', href: '/register', cta: 'Create an account' },
  { icon: Building2, title: 'Township shops', text: 'Free to list. Paid 100% of every point you accept.', href: '/join', cta: 'Apply to join' },
  { icon: ShieldCheck, title: 'SDP and sponsors', text: 'Campaigns with fixed budgets, and results you can measure.', href: '/login', cta: 'Sign in' },
];

export default async function LandingPage() {
  const actor = await currentActor();
  const home = actor ? ROLE_HOME[actor.role] : null;

  return (
    <div className="min-h-dvh overflow-hidden bg-ink-25">
      <SiteHeader home={home} overlay />

      <main>
        {/* Hero: a Sime Darby Property township with its park, courts and playground on the right, fading to near-black on the left. */}
        <section className="hero-photo relative isolate flex min-h-[640px] items-end overflow-hidden text-white lg:min-h-[88vh] lg:items-center">
          <div className="hero-photo-frame absolute inset-y-0 right-0 -z-20 w-full overflow-hidden lg:w-[64%]">
            <Image
              src="/images/sdp-township-park.jpg"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 64vw, 100vw"
              className="hero-photo-img object-cover object-center"
            />
          </div>
          <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />

          <div className="hero-stagger mx-auto w-full max-w-6xl px-5 pb-16 pt-36 sm:px-8 lg:pb-24 lg:pt-32">
            <p style={{ '--i': 0 } as CSSProperties} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100 backdrop-blur-md"><span aria-hidden className="size-1.5 rounded-full bg-gold-300" /><Text>Everyday impact, made local</Text></p>
            {/* The heading's own blur reveal replaces the hero-rise stagger for this line. */}
            <BlurReveal
              as="h1"
              style={{ animation: 'none' }}
              className="mt-7 max-w-xl text-4xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-[60px]"
              delay={0.25}
              speedReveal={1.5}
              segments={[
                { text: 'Good things happen when a township' },
                { text: 'moves together', className: 'text-gold-300' },
                { text: '.', attach: true },
              ]}
            />
            <p style={{ '--i': 2 } as CSSProperties} className="mt-6 max-w-lg text-[17px] leading-8 text-white/80 sm:text-lg"><Text>SimeTown brings neighbours, local businesses and everyday services together—and rewards good actions with points that are paid for before they are given.</Text></p>
            <div style={{ '--i': 3 } as CSSProperties} className="mt-9 flex flex-wrap gap-3">
              <Link href={home ?? '/register'} className="site-cta px-6 py-3 text-base">
                <Text>{home ? 'Open SimeTown' : 'Create a resident account'}</Text>
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href="/offer" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:border-white/50 hover:bg-white/10">
                <Text>What we offer</Text>
              </Link>
            </div>
          </div>

          <Link href="#how" aria-label="Scroll to how it works" className="scroll-cue absolute bottom-6 left-1/2 hidden -translate-x-1/2 rounded-full p-2 text-white/70 hover:text-white lg:block">
            <ChevronDown className="size-6" aria-hidden />
          </Link>
        </section>

        {/* How it works */}
        <section id="how" className="offer-anchor mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>How it works</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>One good action, one local sale. Every point funded first.</Text></h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink-600"><Text>Follow one resident through a real SimeTown transaction, from the recycling kiosk to the shop’s weekly payout.</Text></p>
          </Reveal>
          <Reveal className="mt-12">
            <HowItWorks />
          </Reveal>
        </section>

        <ModuleStrip />

        {/* Audiences */}
        <section className="landing-community py-24 text-white sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-300"><Text>One township, shared progress</Text></p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>When the community thrives, everyone does.</Text></h2>
            </Reveal>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {AUDIENCES.map((a, i) => (
                <Reveal key={a.title} index={i}>
                  <div className="flex h-full flex-col rounded-2xl border border-white/15 bg-white/[0.08] p-6 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12)] backdrop-blur-xl transition-colors duration-200 hover:bg-white/[0.12] sm:p-7">
                    <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-gold-300"><a.icon className="size-5" aria-hidden /></span>
                    <h3 className="mt-5 text-lg font-semibold text-white"><Text>{a.title}</Text></h3>
                    <p className="mt-2 flex-1 text-[15px] leading-relaxed text-brand-100/90"><Text>{a.text}</Text></p>
                    <Link href={a.href} className="group mt-6 inline-flex items-center gap-1.5 self-start rounded-md text-sm font-semibold text-white">
                      <Text>{a.cta}</Text>
                      <ArrowRight className="size-4 transition-transform duration-200 ease-soft group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <LandingFaq />
      </main>

      <SiteFooter />
    </div>
  );
}
