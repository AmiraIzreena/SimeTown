import {
  ArrowRight, Bike, Building2, Droplets, Gauge, HandHeart, Megaphone, Recycle, Repeat2, ShieldCheck, Store, TriangleAlert, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/ui/reveal';
import { currentActor } from '@/server/auth/guard';
import { ROLE_HOME } from '@/shared/domain';

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
      { icon: Bike, name: 'Gerak', gloss: 'Move', text: 'Walk or cycle township loops and scan checkpoints along the way.' },
    ],
  },
  {
    layer: 'Planet',
    question: 'Making sustainable living easy and worth doing',
    items: [
      { icon: Recycle, name: 'Kitar', gloss: 'Recycle', text: 'Check the material, drop it at a kiosk, and see your street’s total grow.' },
      { icon: Repeat2, name: 'Kongsi', gloss: 'Share', text: 'Give away or lend things instead of throwing them out.' },
      { icon: Zap, name: 'Jimat', gloss: 'Save', text: 'Track electricity and water month by month, with tips and a leak alert.' },
      { icon: Droplets, name: 'Banjir', gloss: 'Flood', text: 'Water levels by zone. A danger warning takes over the screen with a safe route.' },
    ],
  },
  {
    layer: 'Business',
    question: 'Tools for shops, sponsors and Sime Darby Property',
    items: [
      { icon: Store, name: 'KITA Merchant', gloss: 'Shops', text: 'Give points on sales and accept points as part-payment, with a weekly statement.' },
      { icon: Megaphone, name: 'KITA Partner Hub', gloss: 'Sponsors', text: 'Fund a challenge with a fixed budget. Whatever is not used is refunded.' },
      { icon: Gauge, name: 'KITA Insights', gloss: 'SDP', text: 'What the township achieved, in totals only, with the float matched to the sen.' },
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
    <div className="bg-white">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Logo tone="light" />
          <nav aria-label="Account" className="flex items-center gap-2">
            {home ? (
              <Button href={home} variant="light" size="sm">
                Open KITA+
              </Button>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-3 py-2 text-sm font-semibold text-white/90 transition-colors duration-200 hover:text-white">
                  Sign in
                </Link>
                <Button href="/register" variant="light" size="sm">
                  Get started
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 text-white">
          <svg aria-hidden className="parallax absolute -right-24 -top-10 -z-10 h-[130%] w-[70%] opacity-[0.09]" viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice">
            <g fill="none" stroke="white" strokeWidth="1.2">
              <circle cx="330" cy="300" r="120" />
              <circle cx="330" cy="300" r="200" />
              <circle cx="330" cy="300" r="290" />
              <path d="M40 520h520M90 520v-90h70v90M190 520V360h90v160M310 520V400h60v120M400 520V320h110v200" />
              <path d="M120 430l35-30 35 30M215 360l30-26 30 26" />
            </g>
          </svg>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-32 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-40">
            <div className="animate-rise">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-100">Township of Tomorrow · People &amp; Planet</p>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] text-white sm:text-5xl lg:text-[56px]">
                One app where people, businesses and nature <span className="text-gold-300">thrive together</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-100/90">
                KITA+ rewards everyday good actions with points that keep value inside the township. Every point is paid for before it is given.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Button href={home ?? '/register'} variant="light" size="lg">
                  {home ? 'Open KITA+' : 'Create a resident account'}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
                {!home && (
                  <Button href="/login" size="lg" className="border border-white/25 bg-transparent text-white shadow-none hover:bg-white/10">
                    Sign in
                  </Button>
                )}
              </div>
            </div>

            {/* An original illustration of the resident's wallet, drawn in markup. */}
            <div aria-hidden className="animate-rise mx-auto w-full max-w-sm [animation-delay:120ms] lg:mx-0 lg:justify-self-end">
              <div className="rounded-2xl border border-white/15 bg-white/8 p-3 shadow-lg backdrop-blur-sm">
                <div className="rounded-xl bg-white p-5 text-ink-800">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink-500">KITA Points</p>
                    <span className="rounded-full bg-gold-50 px-2.5 py-0.5 text-xs font-semibold text-gold-700">100 pts = RM1</span>
                  </div>
                  <p className="mt-2 font-display text-4xl font-bold tracking-tight text-ink-900">675</p>
                  <p className="text-sm text-ink-500">worth RM6.75 at township shops</p>
                  <div className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-sm">
                    {[
                      ['Kitar Challenge', 'funded by a sponsor', '+300'],
                      ['Kafe Seri Pagi', 'funded by the shop', '+45'],
                      ['Kedai Runcit Mesra', 'spent on groceries', '−300'],
                    ].map(([name, who, points]) => (
                      <div key={name} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-800">{name}</p>
                          <p className="truncate text-xs text-ink-500">{who}</p>
                        </div>
                        <span className={points!.startsWith('+') ? 'font-semibold text-success-700' : 'font-semibold text-ink-700'}>{points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-600">How it works</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold sm:text-4xl">Four steps, and the money is always there first.</h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} index={i}>
                <div className="h-full rounded-lg border border-ink-200 bg-white p-6 shadow-xs">
                  <span className="grid size-9 place-items-center rounded-full bg-brand-700 font-display text-sm font-bold text-white">{step.n}</span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-ink-600">{step.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="bg-ink-50 py-20">
          <div className="mx-auto max-w-6xl space-y-14 px-5 sm:px-8">
            {FEATURES.map((group) => (
              <div key={group.layer}>
                <Reveal>
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-600">{group.layer}</p>
                  <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{group.question}</h2>
                </Reveal>
                <div className={`mt-7 grid gap-4 sm:grid-cols-2 ${group.items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
                  {group.items.map((item, i) => (
                    <Reveal key={item.name} index={i}>
                      <article className="lift h-full rounded-lg border border-ink-200 bg-white p-5 shadow-xs">
                        <span className="grid size-10 place-items-center rounded-md bg-brand-50 text-brand-700">
                          <item.icon className="size-5" aria-hidden />
                        </span>
                        <h3 className="mt-4 text-base font-semibold">
                          {item.name} <span className="text-sm font-normal text-ink-500">{item.gloss}</span>
                        </h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{item.text}</p>
                      </article>
                    </Reveal>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The rule */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-600">The most important rule</p>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">No pool, no points.</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-ink-600">
                A point is given only after someone has put the money for it into a separate, locked pot: the reward float. That is why a shop can always be paid, and why KITA+ never earns from points residents fail to use.
              </p>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ['100 pts', '= RM1, always', 'One simple value across the township.'],
                ['30%', 'of a bill at most', 'From 100 points, in whole ringgit.'],
                ['100%', 'repaid to shops', 'Every week, with no fee for accepting points.'],
              ].map(([big, small, text], i) => (
                <Reveal key={big} index={i}>
                  <div className="h-full rounded-lg border border-ink-200 bg-white p-5 shadow-xs">
                    <p className="font-display text-3xl font-bold text-brand-700">{big}</p>
                    <p className="text-sm font-semibold text-ink-800">{small}</p>
                    <p className="mt-2 text-sm text-ink-500">{text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="bg-gradient-to-br from-brand-800 to-brand-950 py-20 text-white">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <Reveal>
              <h2 className="text-3xl font-bold text-white sm:text-4xl">Three groups gain together.</h2>
            </Reveal>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {AUDIENCES.map((a, i) => (
                <Reveal key={a.title} index={i}>
                  <div className="flex h-full flex-col rounded-lg border border-white/12 bg-white/6 p-6">
                    <a.icon className="size-7 text-gold-300" aria-hidden />
                    <h3 className="mt-4 text-lg font-semibold text-white">{a.title}</h3>
                    <p className="mt-1.5 flex-1 text-[15px] text-brand-100/90">{a.text}</p>
                    <Link href={a.href} className="group mt-5 inline-flex items-center gap-1.5 self-start rounded-md text-sm font-semibold text-white">
                      {a.cta}
                      <ArrowRight className="size-4 transition-transform duration-200 ease-soft group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-ink-500 sm:px-8 md:flex-row md:items-center md:justify-between">
          <Logo className="text-base" />
          <div className="max-w-2xl space-y-2 md:text-right">
            <p>
              A student prototype for the Sime Darby Property University Hackathon 2026. It is not an official Sime Darby Property product. All residents, shops, sponsors and figures shown are demo data, and no real money moves.
            </p>
            <nav aria-label="Legal" className="flex gap-4 md:justify-end">
              <Link href="/terms" className="font-medium text-ink-700 hover:underline">
                Terms of Use
              </Link>
              <Link href="/privacy" className="font-medium text-ink-700 hover:underline">
                Privacy Notice
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
