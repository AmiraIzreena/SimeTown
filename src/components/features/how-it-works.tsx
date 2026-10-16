'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { ArrowRight, Barcode, Camera, Check, Coins, Landmark, Recycle, Scale, ShieldCheck, Smartphone, Store, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { formatRM } from '@/shared/domain';

/**
 * "How it works" on the landing page: one real transaction, told in four steps.
 * The steps advance on their own (paused on hover, focus, off-screen or with
 * reduced motion); each step shows the screen a resident, shop or SDP sees.
 */

const DURATION = 6500;

const STEPS: { key: string; icon: LucideIcon; title: string; who: string; text: string; proof: string }[] = [
  { key: 'do', icon: Recycle, title: 'Do', who: 'Resident', text: 'Aisyah drops 8 bottles into a smart recycling machine in Elmina Central Park. Camera, barcode and scale must all agree before anything counts.', proof: 'Verified by machine, signed record' },
  { key: 'earn', icon: Coins, title: 'Earn', who: 'Sponsor-funded', text: 'She earns Impact XP at once. Because a sponsor funded this month’s challenge, 300 points land too, with the funder named.', proof: 'Paid into the float before it is given' },
  { key: 'spend', icon: Smartphone, title: 'Spend', who: 'Township shop', text: 'At Kedai Runcit Mesra her bill is RM20. She uses 300 points for RM3 off, and confirms on her own phone. Points cover up to 30% of a bill.', proof: 'Confirmed on the resident’s phone' },
  { key: 'settle', icon: Landmark, title: 'Settle', who: 'Sime Darby Property', text: 'Every week the reward float pays the shop in full for the points it accepted. The float always equals the points residents hold, to the sen.', proof: 'Reconciled daily, settled weekly' },
];

function DoScreen() {
  const checks: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Camera, label: 'Camera', value: 'PET bottle' },
    { icon: Barcode, label: 'Barcode', value: 'Matched' },
    { icon: Scale, label: 'Scale', value: '0.42 kg' },
  ];
  return (
    <div className="hiw-screen">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"><Text>Smart recycling machine</Text></p>
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-success-600/20 px-2.5 py-1 text-[11px] font-semibold text-[#7fe0b0]"><span className="live-dot" aria-hidden /><Text>Session open</Text></span>
      </div>
      <p className="mt-4 font-display text-5xl font-bold text-white"><span className="hiw-count">8</span> <span className="text-xl font-semibold text-white/60"><Text>items</Text></span></p>
      <ul className="mt-6 space-y-2.5">
        {checks.map((c, i) => (
          <li key={c.label} className="hiw-row flex items-center gap-3 rounded-xl bg-white/[0.07] px-3.5 py-3" style={{ '--i': i } as CSSProperties}>
            <span className="grid size-9 place-items-center rounded-lg bg-white/10 text-gold-300"><c.icon className="size-4" aria-hidden /></span>
            <span className="flex-1 text-sm text-white/80"><Text>{c.label}</Text></span>
            <span className="text-sm font-semibold text-white"><Text>{c.value}</Text></span>
            <span className="hiw-tick grid size-6 place-items-center rounded-full bg-success-600 text-white"><Check className="size-3.5" aria-hidden /></span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-white/50"><Text>Record signed by machine EV-01 · Elmina Central Park</Text></p>
    </div>
  );
}

function EarnScreen() {
  return (
    <div className="hiw-screen">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"><Text>SimeTown Points</Text></p>
      <p className="mt-3 font-display text-5xl font-bold text-white">1,119</p>
      <p className="text-sm text-white/60"><Text>worth RM11.19 at township shops</Text></p>
      <div className="hiw-row mt-6 rounded-2xl bg-white p-4 text-ink-900 shadow-xl" style={{ '--i': 0 } as CSSProperties}>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-50 text-gold-700"><Coins className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold"><Text>Kitar Challenge complete</Text></p>
            <p className="text-xs text-ink-500"><Text>Funded by Solar Cerah, a township sponsor</Text></p>
          </div>
          <span className="font-display text-lg font-bold text-success-700">+300</span>
        </div>
      </div>
      <div className="hiw-row mt-3 flex items-center justify-between rounded-2xl bg-white/[0.07] px-4 py-3" style={{ '--i': 1 } as CSSProperties}>
        <span className="text-sm text-white/80"><Text>Impact XP</Text></span>
        <span className="text-sm font-semibold text-gold-300"><Text>+40 XP · Level 3</Text></span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <span className="hiw-bar block h-full rounded-full bg-gradient-to-r from-gold-300 to-brand-400" style={{ width: '72%' }} />
      </div>
    </div>
  );
}

function SpendScreen() {
  return (
    <div className="hiw-screen">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"><Text>Confirm on your phone</Text></p>
      <p className="mt-3 text-lg font-semibold text-white">Kedai Runcit Mesra</p>
      <dl className="mt-5 space-y-2.5 text-sm">
        {[
          ['Bill', 'RM20.00', 0],
          ['Points used (300)', '− RM3.00', 1],
        ].map(([label, value, i]) => (
          <div key={label as string} className="hiw-row flex justify-between rounded-xl bg-white/[0.07] px-4 py-3" style={{ '--i': i } as CSSProperties}>
            <dt className="text-white/70"><Text>{label as string}</Text></dt>
            <dd className="font-semibold text-white">{value}</dd>
          </div>
        ))}
        <div className="hiw-row flex justify-between rounded-xl border border-gold-300/40 bg-gold-300/10 px-4 py-3" style={{ '--i': 2 } as CSSProperties}>
          <dt className="font-semibold text-gold-300"><Text>You pay</Text></dt>
          <dd className="font-display text-xl font-bold text-white">{formatRM(1700)}</dd>
        </div>
      </dl>
      <div className="hiw-row mt-5 grid grid-cols-2 gap-2" style={{ '--i': 3 } as CSSProperties}>
        <span className="rounded-xl bg-white/10 py-3 text-center text-sm font-semibold text-white/80"><Text>Not now</Text></span>
        <span className="hiw-press rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 py-3 text-center text-sm font-bold text-white"><Text>Confirm</Text></span>
      </div>
    </div>
  );
}

function SettleScreen() {
  return (
    <div className="hiw-screen">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"><Text>Weekly settlement</Text></p>
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-success-600/20 px-2.5 py-1 text-[11px] font-semibold text-[#7fe0b0]"><ShieldCheck className="size-3.5" aria-hidden /><Text>Matched to the sen</Text></span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="hiw-row rounded-2xl bg-white/[0.07] p-4" style={{ '--i': 0 } as CSSProperties}>
          <p className="text-xs text-white/60"><Text>Reward float holds</Text></p>
          <p className="mt-1 font-display text-2xl font-bold text-white">{formatRM(269251)}</p>
        </div>
        <div className="hiw-row rounded-2xl bg-white/[0.07] p-4" style={{ '--i': 1 } as CSSProperties}>
          <p className="text-xs text-white/60"><Text>Points residents hold</Text></p>
          <p className="mt-1 font-display text-2xl font-bold text-white">{formatRM(269251)}</p>
        </div>
      </div>
      <div className="hiw-row mt-3 flex items-center gap-3 rounded-2xl bg-white p-4 text-ink-900 shadow-xl" style={{ '--i': 2 } as CSSProperties}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Store className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold"><Text>Paid to Kedai Runcit Mesra</Text></p>
          <p className="text-xs text-ink-500"><Text>100% of points accepted · no fee</Text></p>
        </div>
        <span className="font-display text-lg font-bold">{formatRM(300)}</span>
      </div>
    </div>
  );
}

const SCREENS = [DoScreen, EarnScreen, SpendScreen, SettleScreen];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    if (rootRef.current) observer.observe(rootRef.current);
    return () => { media.removeEventListener('change', update); observer.disconnect(); };
  }, []);

  const running = visible && !paused && !reduced;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive((i) => (i + 1) % STEPS.length), DURATION);
    return () => window.clearTimeout(timer);
  }, [running, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + STEPS.length) % STEPS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const Screen = SCREENS[active]!;
  return (
    <div ref={rootRef} className="hiw" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12">
        {/* Steps */}
        <LocalizedDiv role="tablist" aria-orientation="vertical" aria-label="How SimeTown works, step by step" className="relative flex flex-col gap-3" onKeyDown={onKeyDown}>
          <span aria-hidden className="absolute bottom-8 left-[27px] top-8 w-px bg-ink-200" />
          <span aria-hidden className="hiw-rail absolute left-[27px] top-8 w-px bg-gradient-to-b from-brand-500 to-gold-500" style={{ height: `calc((100% - 4rem) * ${active / (STEPS.length - 1)})` }} />
          {STEPS.map((step, i) => {
            const on = i === active;
            const done = i < active;
            return (
              <button
                key={step.key}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`hiw-tab-${step.key}`}
                aria-selected={on}
                aria-controls="hiw-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn('hiw-step relative flex gap-4 rounded-2xl border p-4 text-left sm:p-5', on ? 'is-active border-brand-200 bg-white shadow-lg' : 'border-transparent hover:bg-white/70')}
              >
                <span className={cn('relative z-10 grid size-14 shrink-0 place-items-center rounded-2xl transition-colors duration-300', on ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md' : done ? 'bg-brand-100 text-brand-700' : 'bg-white text-ink-400 ring-1 ring-ink-200')}>
                  {done ? <Check className="size-6" aria-hidden /> : <step.icon className="size-6" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-display text-xs font-bold tracking-[0.18em] text-brand-600">0{i + 1}</span>
                    <span className={cn('text-lg font-semibold', on ? 'text-ink-900' : 'text-ink-700')}><Text>{step.title}</Text></span>
                    <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-500"><Text>{step.who}</Text></span>
                  </span>
                  <span className="hiw-detail grid">
                    <span className="overflow-hidden">
                      <span className="mt-2 block text-[15px] leading-relaxed text-ink-600"><Text>{step.text}</Text></span>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-success-700"><ShieldCheck className="size-3.5" aria-hidden /><Text>{step.proof}</Text></span>
                    </span>
                  </span>
                  {on && (
                    <span aria-hidden className="mt-4 block h-1 overflow-hidden rounded-full bg-ink-100">
                      <span key={`${active}-${running}`} className={cn('hiw-progress block h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-500', running ? 'is-running' : 'is-paused')} style={{ '--hiw-duration': `${DURATION}ms` } as CSSProperties} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </LocalizedDiv>

        {/* Live screen */}
        <div id="hiw-panel" role="tabpanel" aria-labelledby={`hiw-tab-${STEPS[active]!.key}`} className="hiw-stage relative isolate flex min-h-[460px] items-center justify-center overflow-hidden rounded-[2rem] p-6 sm:p-10">
          <span aria-hidden className="hiw-orb absolute -right-20 -top-24 -z-10 size-72 rounded-full" />
          <span aria-hidden className="hiw-orb hiw-orb-2 absolute -bottom-28 -left-16 -z-10 size-72 rounded-full" />
          <div className="w-full max-w-sm">
            <div className="mb-4 flex items-center justify-between text-xs font-semibold text-white/60">
              <span className="inline-flex items-center gap-2"><Wallet className="size-4 text-gold-300" aria-hidden /><Text>In the SimeTown app</Text></span>
              <span className="tabular-nums">0{active + 1} / 0{STEPS.length}</span>
            </div>
            <div key={active} className="hiw-card rounded-3xl border border-white/12 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl">
              <Screen />
            </div>
          </div>
        </div>
      </div>

      {/* Where the money goes */}
      <div className="mt-10 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="glass-surface rounded-3xl border p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700"><Text>Follow the money</Text></p>
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-2 sm:gap-3">
            {([
              ['Funder', 'Shop, sponsor or SDP', Coins],
              ['Reward float', 'Ring-fenced, checked daily', Landmark],
              ['Township shop', 'Paid 100%, weekly', Store],
            ] as const).map(([title, note, Icon], i) => (
              <FlowNode key={title} title={title} note={note} Icon={Icon} last={i === 2} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            ['100%', 'of points paid for before they are given'],
            ['100 = RM1', 'points to ringgit at every township shop'],
          ].map(([big, small]) => (
            <div key={big} className="glass-surface offer-card rounded-3xl border p-5 shadow-sm">
              <p className="font-display text-3xl font-bold text-brand-700">{big}</p>
              <p className="mt-2 text-sm leading-snug text-ink-600"><Text>{small}</Text></p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FlowNode({ title, note, Icon, last }: { title: string; note: string; Icon: LucideIcon; last: boolean }) {
  return (
    <>
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md"><Icon className="size-5" aria-hidden /></span>
        <p className="mt-2.5 text-sm font-semibold text-ink-900"><Text>{title}</Text></p>
        <p className="text-xs text-ink-500"><Text>{note}</Text></p>
      </div>
      {!last && (
        <span aria-hidden className="hiw-flow relative mt-6 h-0.5 w-8 rounded-full bg-brand-100 sm:w-16">
          <span className="hiw-flow-dot absolute -top-[3px] size-2 rounded-full bg-brand-500" />
          <ArrowRight className="absolute -right-2 -top-[7px] size-4 text-brand-400" />
        </span>
      )}
    </>
  );
}
