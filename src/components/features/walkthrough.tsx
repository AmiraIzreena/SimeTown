'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedDiv } from '@/components/ui/localized-elements';
import { Check, ChevronLeft, ChevronRight, Pause, Play, PlayCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

/**
 * "See how it works": a short animated walkthrough of one feature for one role, in the style of the landing
 * page's How it works. Each step shows a simple picture of the screen and one plain sentence. It plays by itself
 * (paused on hover or focus, and never with reduced motion), stops on the last step, and changes no data.
 */

export interface WalkStep {
  key: string;
  icon: LucideIcon;
  title: string;
  text: string;
  /** Who does this step, e.g. "Courier" or "Admins only". */
  who?: string;
  /** A simple picture of the screen, drawn on the dark stage. */
  screen: ReactNode;
}

const DURATION = 6500;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** The button that opens the walkthrough. */
export function Walkthrough({ title, description, steps, label = 'See how it works', className }: {
  title: string;
  description?: string;
  steps: WalkStep[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className={className}>
        <PlayCircle className="size-4 text-brand-600" aria-hidden /><Text>{label}</Text>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} wide>
        {open && <Player steps={steps} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function Player({ steps, onDone }: { steps: WalkStep[]; onDone: () => void }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const last = active === steps.length - 1;
  const running = playing && !held && !reduced && !last;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive((i) => Math.min(i + 1, steps.length - 1)), DURATION);
    return () => window.clearTimeout(timer);
  }, [running, active, steps.length]);

  const go = (i: number) => setActive(Math.max(0, Math.min(steps.length - 1, i)));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  };
  const step = steps[active]!;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="space-y-4 sm:space-y-5" onKeyDown={onKeyDown}>
      {/* The screen */}
      <div
        className="hiw-stage relative isolate overflow-hidden rounded-2xl px-3 py-4 sm:px-8 sm:py-7"
        onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      >
        <span aria-hidden className="hiw-orb absolute -right-20 -top-24 -z-10 size-64 rounded-full" />
        <span aria-hidden className="hiw-orb hiw-orb-2 absolute -bottom-28 -left-16 -z-10 size-64 rounded-full" />
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold text-white/60">
            <span className="inline-flex min-w-0 items-center gap-2"><step.icon className="size-4 shrink-0 text-gold-300" aria-hidden /><span className="truncate"><Text>{step.who ?? 'SimeTown'}</Text></span></span>
            <span className="tabular-nums">{pad(active + 1)} / {pad(steps.length)}</span>
          </div>
          <div key={active} className="hiw-card rounded-3xl border border-white/12 bg-white/[0.06] p-3.5 shadow-2xl backdrop-blur-xl sm:min-h-[15rem] sm:p-5">
            {step.screen}
          </div>
        </div>
      </div>

      {/* What happens */}
      <div aria-live="polite" className="sm:min-h-[5.5rem]">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-display text-xs font-bold tracking-[0.18em] text-brand-700">{pad(active + 1)}</span>
          <span className="text-lg font-semibold text-ink-900"><Text>{step.title}</Text></span>
          {step.who && <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-semibold text-ink-500"><Text>{step.who}</Text></span>}
        </p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-600"><Text>{step.text}</Text></p>
      </div>

      {/* Where you are, and the controls: pinned to the bottom so they stay in reach on a small screen. */}
      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 space-y-3 border-t border-ink-100 bg-white/95 px-5 pb-5 pt-3 backdrop-blur">
        <LocalizedDiv role="group" aria-label="Steps" className="flex gap-1.5">
          {steps.map((s, i) => (
            <LocalizedButton
              key={s.key} type="button" onClick={() => go(i)} aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === active ? 'step' : undefined}
              className="group relative h-6 flex-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className={cn('absolute inset-x-0 top-1/2 block h-1.5 -translate-y-1/2 overflow-hidden rounded-full transition-colors duration-200', i < active ? 'bg-brand-500' : 'bg-ink-100 group-hover:bg-ink-200')}>
                {i === active && <span key={`${active}-${running}`} className={cn('hiw-progress block h-full rounded-full bg-gradient-to-r from-brand-500 to-gold-500', running ? 'is-running' : 'is-paused')} style={{ '--hiw-duration': `${DURATION}ms` } as CSSProperties} />}
              </span>
            </LocalizedButton>
          ))}
        </LocalizedDiv>

        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => go(active - 1)} disabled={active === 0}><ChevronLeft className="size-4" aria-hidden /><Text>Back</Text></Button>
          {!reduced && !last && (
            <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
              {playing ? <><Pause className="size-4" aria-hidden /><Text>Pause</Text></> : <><Play className="size-4" aria-hidden /><Text>Play</Text></>}
            </Button>
          )}
          {last
            ? <Button size="sm" onClick={onDone}><Check className="size-4" aria-hidden /><Text>Got it</Text></Button>
            : <Button size="sm" onClick={() => go(active + 1)}><Text>Next</Text><ChevronRight className="size-4" aria-hidden /></Button>}
        </div>
      </div>
    </div>
  );
}

// --- Building blocks for the screens -------------------------------------------------------------

/** The small heading at the top of a screen, with an optional live chip. */
export function ScreenTitle({ children, chip }: { children: string; chip?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"><Text>{children}</Text></p>
      {chip && <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-success-600/20 px-2.5 py-1 text-[11px] font-semibold text-[#7fe0b0]"><span className="live-dot" aria-hidden /><Text>{chip}</Text></span>}
    </div>
  );
}

/** One line on a screen: an icon, a label and a value, sliding in after the one before. */
export function ScreenRow({ icon: Icon, label, value, i = 0, tick, tone = 'plain' }: {
  icon?: LucideIcon; label: string; value?: string; i?: number; tick?: boolean; tone?: 'plain' | 'gold' | 'alert';
}) {
  return (
    <div className={cn('hiw-row flex items-center gap-3 rounded-xl px-3.5 py-2.5', tone === 'gold' ? 'border border-gold-300/40 bg-gold-300/10' : tone === 'alert' ? 'border border-accent-200/40 bg-accent-500/15' : 'bg-white/[0.07]')} style={{ '--i': i } as CSSProperties}>
      {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-gold-300"><Icon className="size-4" aria-hidden /></span>}
      <span className="min-w-0 flex-1 text-sm text-white/80"><Text>{label}</Text></span>
      {value && <span className="shrink-0 text-sm font-semibold text-white"><Text>{value}</Text></span>}
      {tick && <span className="hiw-tick grid size-6 shrink-0 place-items-center rounded-full bg-success-600 text-white" style={{ '--i': i } as CSSProperties}><Check className="size-3.5" aria-hidden /></span>}
    </div>
  );
}

/** A white card on the dark screen, like a notification or a record. */
export function ScreenCard({ icon: Icon, title, note, value, i = 0, tone = 'brand' }: {
  icon: LucideIcon; title: string; note?: string; value?: string; i?: number; tone?: 'brand' | 'gold' | 'success' | 'alert';
}) {
  const tones = { brand: 'bg-brand-50 text-brand-700', gold: 'bg-gold-50 text-gold-700', success: 'bg-success-50 text-success-700', alert: 'bg-accent-50 text-accent-700' };
  return (
    <div className="hiw-row flex items-start gap-3 rounded-2xl bg-white p-3.5 text-ink-900 shadow-xl" style={{ '--i': i } as CSSProperties}>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tones[tone])}><Icon className="size-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold"><Text>{title}</Text></p>
        {note && <p className="text-xs text-ink-500"><Text>{note}</Text></p>}
      </div>
      {value && <span className="font-display text-base font-bold text-ink-900"><Text>{value}</Text></span>}
    </div>
  );
}

/** A button on the screen that pulses as if being pressed. */
export function ScreenButton({ children, i = 0, tone = 'brand' }: { children: string; i?: number; tone?: 'brand' | 'success' }) {
  return (
    <div className="hiw-row" style={{ '--i': i } as CSSProperties}>
      <span className={cn('hiw-press block rounded-xl py-2.5 text-center text-sm font-bold text-white', tone === 'success' ? 'bg-success-600' : 'bg-gradient-to-r from-brand-500 to-brand-700')}><Text>{children}</Text></span>
    </div>
  );
}

/** A row of figures, like the top of a dashboard. */
export function ScreenStats({ items, i = 0 }: { items: { label: string; value: string; tone?: 'plain' | 'warn' | 'alert' }[]; i?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((s, n) => (
        <div key={s.label} className="hiw-row rounded-xl bg-white/[0.07] p-2.5" style={{ '--i': i + n } as CSSProperties}>
          <p className="text-[11px] leading-tight text-white/60"><Text>{s.label}</Text></p>
          <p className={cn('mt-1 font-display text-xl font-bold', s.tone === 'warn' ? 'text-gold-300' : s.tone === 'alert' ? 'text-[#ff9b8a]' : 'text-white')}><Text>{s.value}</Text></p>
        </div>
      ))}
    </div>
  );
}
