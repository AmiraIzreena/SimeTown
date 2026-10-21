import { Text } from '@/components/ui/localized-text';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { ArrowRight, Pause, Play, Plus } from 'lucide-react';
import { FEATURES } from '@/components/features/offer-content';

/** Every module as a slow, endless row of chips; the full descriptions live on "What we offer". */
export function ModuleStrip() {
  const items = FEATURES.flatMap((group) => group.items.map((item) => ({ ...item, layer: group.id })));
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="module-strip-row flex shrink-0 gap-3 pr-3">
      {items.map((item) => (
        <li key={item.name} className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-ink-200/80 bg-white px-4 py-2.5 shadow-xs">
          <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-brand-700"><item.icon className="size-3.5" aria-hidden /></span>
          <span className="text-sm font-semibold text-ink-800">{item.name}</span>
          <span className="text-xs text-ink-500"><Text>{item.gloss}</Text></span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="modules-title" className="border-y border-white/80 bg-white/40 py-14">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-5 sm:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>One app</Text></p>
          <h2 id="modules-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl"><Text>Everything the township needs, in one place</Text></h2>
        </div>
        <Link href="/offer" className="group inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-xs transition-colors duration-200 hover:border-brand-400 hover:bg-brand-50">
          <Text>See everything SimeTown offers</Text>
          <ArrowRight className="size-4 transition-transform duration-200 ease-soft group-hover:translate-x-1" aria-hidden />
        </Link>
      </div>
      {/* The strip moves on its own, so it can be paused with a mouse, a tap or the keyboard (WCAG 2.2.2). No script: the checkbox drives the CSS. */}
      <div className="module-strip-wrap mt-8">
        <div className="module-strip flex overflow-hidden">
          {row(false)}
          {row(true)}
        </div>
        <div className="mx-auto mt-4 flex max-w-6xl justify-end px-5 motion-reduce:hidden sm:px-8">
          <label className="module-strip-toggle inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-700 shadow-xs transition-colors duration-200 hover:border-brand-300 hover:text-brand-800 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600">
            <input type="checkbox" className="peer sr-only" />
            <Pause className="size-3.5 peer-checked:hidden" aria-hidden />
            <Play className="hidden size-3.5 peer-checked:block" aria-hidden />
            <span className="peer-checked:hidden"><Text>Pause the moving list</Text></span>
            <span className="hidden peer-checked:inline"><Text>Play the moving list</Text></span>
          </label>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Are SimeTown Points real money?', 'They have a fixed value: 100 points are worth RM1 at any SimeTown shop in your township. Points cannot be cashed out or transferred to someone else.'],
  ['Who pays for my points?', 'The shop pays for points you earn when you shop, a sponsor pays for challenge rewards, and Sime Darby Property pays for community programmes. The money is set aside before the points reach you.'],
  ['Where and how can I spend them?', 'At any SimeTown shop in your township, for up to 30% of a bill, from 100 points. Your phone asks you to confirm every time.'],
  ['Do my points expire?', 'Your points stay valid as long as you earn or spend at least once every 12 months, for up to 24 months. We remind you 60 days and 14 days before any points expire.'],
  ['Who can see my information?', 'Your home is verified once. Shops and sponsors only ever see grouped totals, never your name, unless you choose to share. You can download or delete your data at any time.'],
  ['I rent my home. Can I join?', 'Yes. Register with your address, and the owner or the township office confirms that you live there.'],
  ['What happens during a flood?', 'If your zone reaches the danger level, a warning with the safe route takes over your screen. One tap tells the township team you are safe, or that you need help.'],
  ['I run a shop. What does it cost?', 'Listing and accepting points is free, and you are paid 100% of the points you accept every week. When you give points, you fund them at 1% of the sale plus a 15% service fee on those points.'],
];

/** Questions residents and shop owners actually ask. Native details/summary, so it works without JavaScript. */
export function LandingFaq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Questions</Text></p>
          <h2 id="faq-title" className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"><Text>Good to know</Text></h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-600"><Text>The answers residents and shop owners ask for most. Signed in, the SimeTown Assistant can answer the rest.</Text></p>
        </div>
        <div className="divide-y divide-ink-200/80 rounded-3xl border border-white/80 bg-white/70 px-6 shadow-sm sm:px-8">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq-item group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[17px] font-semibold text-ink-900 marker:hidden">
                <Text>{q}</Text>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 transition-[transform,background-color,color] duration-300 ease-soft group-open:rotate-45 group-open:bg-brand-600 group-open:text-white"><Plus className="size-4" aria-hidden /></span>
              </summary>
              <p className="faq-answer pb-6 pr-12 text-[15px] leading-relaxed text-ink-600"><Text>{a}</Text></p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
