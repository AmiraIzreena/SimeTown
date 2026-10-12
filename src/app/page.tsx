
import { Text } from '@/components/ui/localized-text';
import { LocalizedNav } from '@/components/ui/localized-elements';
import {
  Accessibility, ArrowRight, Bike, Bot, Building2, DoorOpen, Droplets, Gauge, HandHeart, House, Megaphone, Recycle, Repeat2, ShieldCheck, Sprout, Store, TriangleAlert, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';


//changes all instances of 'SimeTown' to SimeTown
const STEPS = [
  { n: '1', title: 'Do', text: 'Recycle, cycle a loop, report a hazard, help a neighbour, or simply shop locally.' },
  { n: '2', title: 'Earn', text: 'Every verified action earns Impact XP. Points come only where a shop, a sponsor or SDP has paid for them.' },
  { n: '3', title: 'Spend', text: 'Use points for up to 30% of a bill at any township shop. You confirm on your own phone.' },
  { n: '4', title: 'Settle', text: 'The float pays the shop in full, every week. Nobody pays twice and no shop is out of pocket.' },
];

const FEATURES: { layer: string; question: string; items: { icon: LucideIcon; name: string; gloss: string; text: string }[] }[] = [
  {
    layer: 'People',
    question: 'Safer, more connected, more inclusive living',
    items: [
      { icon: HandHeart, name: 'Jiran', gloss: 'Neighbours', text: 'Join township events. Ask for help or offer it.' },
      { icon: TriangleAlert, name: 'Lapor', gloss: 'Report', text: 'Report a hazard or a blocked ramp in under a minute and follow it until it is fixed.' },
      { icon: DoorOpen, name: 'Tamu', gloss: 'Visitors', text: 'Send a visitor pass by link. The guard scans it and you are told the moment they arrive.' },
      { icon: Bike, name: 'Gerak', gloss: 'Move', text: 'Track a walk or ride on the map; checkpoints tick themselves, with fair-play checks.' },
      { icon: Accessibility, name: 'Akses+', gloss: 'Access', text: 'Simple Mode, read-aloud, flashing alerts, step-free places and a priority help list.' },
    ],
  },
  {
    layer: 'Planet',
    question: 'Making sustainable living easy and worth doing',
    items: [
      { icon: Recycle, name: 'SimeTown Recycle', gloss: 'Recycle', text: 'A smart machine recognises, counts and weighs each item, and signs every record.' },
      { icon: Repeat2, name: 'Kongsi', gloss: 'Share', text: 'Give away or lend things instead of throwing them out.' },
      { icon: Zap, name: 'Jimat', gloss: 'Save', text: 'Upload a bill: it is checked for safety, read, and confirmed by you. Leak alerts and tips.' },
      { icon: Droplets, name: 'Banjir', gloss: 'Flood', text: 'Sensors and camera AI, two signals must agree, a person checks the rest, and a safe route.' },
      { icon: Sprout, name: 'Taman', gloss: 'Garden', text: 'Book a garden plot, take a day on the watering roster and log the wildlife you spot.' },
      { icon: Bot, name: 'SimeTown Assistant', gloss: 'Preview', text: 'Ask in English or Bahasa Malaysia. It acts only after you confirm, and never decides an alert.' },
    ],
  },
  {
    layer: 'Business',
    question: 'Tools for shops, sponsors and Sime Darby Property',
    items: [
      { icon: Store, name: 'SimeTown Merchant', gloss: 'Shops', text: 'Give and accept points, and set your own Shop Offer with a monthly budget you control.' },
      { icon: Megaphone, name: 'SimeTown Partner Hub', gloss: 'Sponsors', text: 'Four sponsor tiers, and challenges with a fixed budget. Whatever is not used is refunded.' },
      { icon: Gauge, name: 'SimeTown Insights', gloss: 'SDP', text: 'What the township achieved, in totals only, with the float matched to the sen.' },
      { icon: House, name: 'SimeTown Home', gloss: 'Preview', text: 'A home logbook, trusted home services with contractor passes, and early previews of launches.' },
    ],
  },
];

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
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="landing-header mx-4 mt-4 flex h-16 items-center justify-between px-4 sm:mx-auto sm:max-w-6xl sm:px-6">
          <Logo tone="light" />
          <LocalizedNav aria-label="Account" className="flex items-center gap-2">
            {home ? (
              <Button href={home} variant="light" size="sm"><Text>Open SimeTown</Text></Button>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-3 py-2 text-sm font-semibold text-white/90 transition-colors duration-200 hover:text-white"><Text>Sign in</Text></Link>
                <Button href="/register" variant="light" size="sm"><Text>Get started</Text></Button>
              </>
            )}
          </LocalizedNav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="landing-hero relative isolate overflow-hidden text-white">
          <svg aria-hidden className="parallax absolute -right-24 -top-10 -z-10 h-[130%] w-[70%] opacity-[0.09]" viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice">
            <g fill="none" stroke="white" strokeWidth="1.2">
              <circle cx="330" cy="300" r="120" />
              <circle cx="330" cy="300" r="200" />
              <circle cx="330" cy="300" r="290" />
              <path d="M40 520h520M90 520v-90h70v90M190 520V360h90v160M310 520V400h60v120M400 520V320h110v200" />
              <path d="M120 430l35-30 35 30M215 360l30-26 30 26" />
            </g>
          </svg>
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-32 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:pb-28 lg:pt-40">
            <div className="animate-rise">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100 shadow-sm backdrop-blur-md"><span aria-hidden className="size-1.5 rounded-full bg-gold-300" /><Text>Everyday impact, made local</Text></p>
              <h1 className="mt-7 max-w-2xl text-4xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-[60px]"><Text>Good things happen when a township </Text><span className="text-gold-300"><Text>moves together</Text></span>.
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-8 text-brand-100/90 sm:text-lg"><Text>SimeTown brings neighbours, local businesses and everyday services together—and rewards good actions with points that are paid for before they are given.</Text></p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button href={home ?? '/register'} variant="light" size="lg">
                  <Text>{home ? 'Open SimeTown' : 'Create a resident account'}</Text>
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
                {!home && (
                  <Button href="/login" size="lg" className="border border-white/25 bg-transparent text-white shadow-none hover:bg-white/10"><Text>Sign in</Text></Button>
                )}
              </div>
            </div>

            {/* An original illustration of the resident's wallet, drawn in markup. */}
            <div aria-hidden className="landing-wallet animate-rise mx-auto w-full max-w-sm [animation-delay:120ms] lg:mx-0 lg:justify-self-end">
              <div className="rounded-[1.75rem] border border-white/20 bg-white/10 p-3 shadow-[0_28px_90px_rgb(0_0_0_/_0.28)] backdrop-blur-xl">
                <div className="rounded-[1.35rem] border border-white/80 bg-white/90 p-6 text-ink-800 shadow-xl backdrop-blur-xl sm:p-7">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-500"><Text>SimeTown Points</Text></p>
                    <span className="rounded-full bg-gold-50 px-2.5 py-0.5 text-xs font-semibold text-gold-700"><Text>100 pts = RM1</Text></span>
                  </div>
                  <p className="mt-2 font-display text-4xl font-bold tracking-tight text-ink-900">675</p>
                  <p className="text-sm text-ink-500"><Text>worth RM6.75 at township shops</Text></p>
                  <div className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-sm">
                    {[
                      ['SimeTown Recycle Challenge', 'funded by a sponsor', '+300'],
                      ['Kafe Seri Pagi', 'funded by the shop', '+45'],
                      ['Kedai Runcit Mesra', 'spent on groceries', '−300'],
                    ].map(([name, who, points]) => (
                      <div key={name} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-800"><Text>{name}</Text></p>
                          <p className="truncate text-xs text-ink-500"><Text>{who}</Text></p>
                        </div>
                        <span className={points!.startsWith('+') ? 'font-semibold text-success-700' : 'font-semibold text-ink-700'}><Text>{points}</Text></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>How it works</Text></p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Four simple steps. Every point funded first.</Text></h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} index={i}>
                <div className="glass-surface h-full rounded-2xl border p-6 shadow-sm transition-transform duration-300 ease-soft hover:-translate-y-1">
                  <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-display text-sm font-bold text-white shadow-sm"><Text>{step.n}</Text></span>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight"><Text>{step.title}</Text></h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-600"><Text>{step.text}</Text></p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-white/80 bg-white/35 py-24 sm:py-28">
          <div className="mx-auto max-w-6xl space-y-16 px-5 sm:px-8">
            {FEATURES.map((group) => (
              <div key={group.layer}>
                <Reveal>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>{group.layer}</Text></p>
                  <h2 className="mt-3 max-w-3xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl"><Text>{group.question}</Text></h2>
                </Reveal>
                <div className={`mt-7 grid gap-4 sm:grid-cols-2 ${group.items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
                  {group.items.map((item, i) => (
                    <Reveal key={item.name} index={i}>
                      <article className="glass-surface lift h-full rounded-2xl border p-5 shadow-sm sm:p-6">
                        <span className="grid size-10 place-items-center rounded-xl bg-brand-100/80 text-brand-800">
                          <item.icon className="size-5" aria-hidden />
                        </span>
                        <h3 className="mt-4 text-base font-semibold">
                          {item.name} <span className="text-sm font-normal text-ink-500"><Text>{item.gloss}</Text></span>
                        </h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-ink-600"><Text>{item.text}</Text></p>
                      </article>
                    </Reveal>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The rule */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-600"><Text>The SimeTown promise</Text></p>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>No pool, no points.</Text></h2>
              <p className="mt-5 text-[17px] leading-8 text-ink-600"><Text>A point is given only after someone has put the money for it into a separate, locked pot: the reward float. That is why a shop can always be paid, and why SimeTown never earns from points residents fail to use.</Text></p>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ['100 pts', '= RM1, always', 'One simple value across the township.'],
                ['30%', 'of a bill at most', 'From 100 points, in whole ringgit.'],
                ['100%', 'repaid to shops', 'Every week, with no fee for accepting points.'],
              ].map(([big, small, text], i) => (
                <Reveal key={big} index={i}>
                  <div className="glass-surface h-full rounded-2xl border p-5 shadow-sm">
                    <p className="font-display text-3xl font-bold text-brand-700"><Text>{big}</Text></p>
                    <p className="text-sm font-semibold text-ink-800"><Text>{small}</Text></p>
                    <p className="mt-2 text-sm text-ink-500"><Text>{text}</Text></p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

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
      </main>

      <footer className="border-t border-ink-200/80 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-ink-500 sm:px-8 md:flex-row md:items-center md:justify-between">
          <Logo className="text-base" />
          <div className="max-w-2xl space-y-2 md:text-right">
            <p><Text>A student prototype for the Sime Darby Property University Hackathon 2026. It is not an official Sime Darby Property product. All residents, shops, sponsors and figures shown are demo data, and no real money moves.</Text></p>
            <LocalizedNav aria-label="Public pages" className="flex flex-wrap gap-4 md:justify-end">
              <Link href="/status" className="font-medium text-ink-700 hover:underline"><Text>Flood status</Text></Link>
              <Link href="/guest" className="font-medium text-ink-700 hover:underline"><Text>Visiting as a guest</Text></Link>
              <Link href="/partners" className="font-medium text-ink-700 hover:underline"><Text>Partners</Text></Link>
            </LocalizedNav>
            <LocalizedNav aria-label="Legal" className="flex gap-4 md:justify-end">
              <Link href="/terms" className="font-medium text-ink-700 hover:underline"><Text>Terms of Use</Text></Link>
              <Link href="/privacy" className="font-medium text-ink-700 hover:underline"><Text>Privacy Notice</Text></Link>
            </LocalizedNav>
          </div>
        </div>
      </footer>
    </div>
  );
}
