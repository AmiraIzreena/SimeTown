import { Text } from '@/components/ui/localized-text';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, BadgeCheck, Footprints, Wallet, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';
import { ChallengesView } from './view';

export const metadata: Metadata = {
  title: 'Challenges',
  description: 'Live challenges from Sime Darby Property and sponsors, and the everyday actions that earn Impact XP.',
};

const CLAIM: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Footprints, title: 'Do the activity', text: 'Recycle at a kiosk bin, finish a park loop, water a garden or help a neighbour.' },
  { icon: BadgeCheck, title: 'It is verified', text: 'A bin’s scale, a QR checkpoint, GPS or a staff member confirms it. There is no form to fill in.' },
  { icon: Wallet, title: 'XP and points arrive', text: 'Impact XP is added at once. When a challenge goal is met, its points land with the funder named.' },
];

export default async function ChallengesPage() {
  const actor = await currentActor();
  const home = actor ? ROLE_HOME[actor.role] : null;

  return (
    <div className="min-h-dvh overflow-x-clip bg-ink-25">
      <SiteHeader home={home} overlay />

      <main>
        {/* Hero */}
        <section className="hero-photo relative isolate overflow-hidden text-white">
          <div className="hero-photo-frame absolute inset-y-0 right-0 -z-20 w-full overflow-hidden lg:w-[55%]">
            <Image src="/images/challenges/trail.jpg" alt="" fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="hero-photo-img object-cover object-center" />
          </div>
          <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
          <div aria-hidden className="hero-glow absolute inset-0 -z-10" />
          <div className="hero-stagger mx-auto max-w-6xl px-5 pb-16 pt-36 sm:px-8 lg:pb-24 lg:pt-40">
            <p style={{ '--i': 0 } as CSSProperties} className="text-xs font-bold uppercase tracking-[0.2em] text-gold-300"><Text>Challenges</Text></p>
            <h1 style={{ '--i': 1 } as CSSProperties} className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl"><Text>Do good. Earn XP. Unlock rewards.</Text></h1>
            <p style={{ '--i': 2 } as CSSProperties} className="mt-5 max-w-lg text-[17px] leading-8 text-white/80"><Text>Sime Darby Property and township sponsors open challenges every month. Take part in the app, and your XP and points are added once the action is verified.</Text></p>
            <div style={{ '--i': 3 } as CSSProperties} className="mt-8 flex flex-wrap gap-3">
              <Link href="#live" className="site-cta px-6 py-3 text-base"><Text>See live challenges</Text><ArrowRight className="size-4" aria-hidden /></Link>
              <Link href="#everyday" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/10"><Text>Everyday XP</Text></Link>
            </div>
          </div>
        </section>

        {/* How claiming works */}
        <section className="landing-community py-16 text-white sm:py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-300"><Text>How claiming works</Text></p>
              <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>Nothing to claim by hand</Text></h2>
            </Reveal>
            <div className="relative mt-10 grid gap-5 md:grid-cols-3">
              {CLAIM.map((step, i) => (
                <Reveal key={step.title} index={i}>
                  <article className="h-full rounded-3xl border border-white/12 bg-white/[0.06] p-7 backdrop-blur-xl transition-colors duration-300 hover:bg-white/[0.1]">
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg"><step.icon className="size-6" aria-hidden /></span>
                      <span className="font-display text-sm font-bold tracking-[0.18em] text-gold-300">0{i + 1}</span>
                    </div>
                    <h3 className="mt-5 text-xl font-semibold text-white"><Text>{step.title}</Text></h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-brand-100/90"><Text>{step.text}</Text></p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <ChallengesView />

        {/* Call to action */}
        <section className="px-5 py-24 sm:px-8">
          <Reveal>
            <div className="hero-photo relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl px-8 py-14 text-white sm:px-14">
              <div className="absolute inset-y-0 right-0 -z-20 w-2/3 overflow-hidden">
                <Image src="/images/challenges/garden.jpg" alt="" fill sizes="66vw" className="object-cover object-center opacity-80" />
              </div>
              <div aria-hidden className="hero-photo-fade absolute inset-0 -z-10" />
              <h2 className="max-w-lg text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl"><Text>Your first challenge is a sign-up away</Text></h2>
              <p className="mt-4 max-w-md text-[17px] text-white/80"><Text>Create a resident account, confirm your home, and every verified action starts counting.</Text></p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={home ?? '/register'} className="site-cta px-6 py-3 text-base"><Text>{home ? 'Open SimeTown' : 'Create a resident account'}</Text><ArrowRight className="size-4" aria-hidden /></Link>
                <Link href="/sponsorship" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/10"><Text>Sponsor a challenge</Text></Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
