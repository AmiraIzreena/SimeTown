'use client';

import { Text } from '@/components/ui/localized-text';
import { BadgeCheck, ClipboardList, DoorOpen, Flag, Handshake, QrCode, Search, Star, UserCheck, Wrench } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, SERVICE_LICENSED_TRADES } from '@/shared/domain';
import { SERVICE_ICONS } from './home-services';
import { ScreenButton, ScreenCard, ScreenRow, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How SimeTown Home works, for residents: choosing a service, comparing companies, booking a visit, seeing who is
 * coming, the gate pass, agreeing the price in person, and confirming the job. Pictures only: the companies and
 * workers are the demo township's, and every rule shown is the one the app applies. SimeTown takes no payment.
 */

/** The six services, as the tiles on the page. The licensed ones carry a check mark. */
function ServiceTiles() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {SERVICE_CATEGORIES.map((c, n) => {
        const Icon = SERVICE_ICONS[c];
        return (
          <div key={c} className={cn('hiw-row relative flex flex-col items-center gap-1.5 rounded-xl bg-white p-2.5 text-center text-ink-900 shadow-xl', n === 0 && 'walk-glow')} style={{ '--i': n } as CSSProperties}>
            <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-4" aria-hidden /></span>
            <span className="text-[11px] font-semibold leading-tight"><Text>{SERVICE_CATEGORY_LABELS[c]}</Text></span>
            {SERVICE_LICENSED_TRADES.includes(c) && <BadgeCheck className="absolute right-1.5 top-1.5 size-3.5 text-success-600" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}

/** A booking moving along its steps, as the status badge on My bookings does. */
function BookingSteps({ upTo }: { upTo: number }) {
  const steps = ['Waiting for the company', 'Visit confirmed', 'Worker assigned', 'Worker on site', 'Completed'];
  return (
    <ol className="hiw-row space-y-1.5 rounded-2xl bg-white/[0.07] p-3.5" style={{ '--i': 0 } as CSSProperties}>
      {steps.map((s, n) => (
        <li key={s} className="flex items-center gap-2.5 text-sm">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold', n <= upTo ? 'walk-step-on bg-brand-500 text-white' : 'bg-white/12 text-white/50')} style={{ '--i': n } as CSSProperties}>{n + 1}</span>
          <span className={n <= upTo ? 'font-semibold text-white' : 'text-white/50'}><Text>{s}</Text></span>
        </li>
      ))}
    </ol>
  );
}

/** The worker's gate pass: a QR code they show at the main gate. */
function GatePass() {
  const cells = [1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1];
  return (
    <div className="hiw-row flex items-center gap-4 rounded-2xl bg-white p-3.5 text-ink-900 shadow-xl" style={{ '--i': 0 } as CSSProperties}>
      <div className="walk-glow grid size-20 shrink-0 grid-cols-6 gap-0.5 rounded-lg bg-white p-1.5 ring-1 ring-ink-200">
        {cells.map((c, n) => <span key={n} className={cn('rounded-[1px]', c ? 'bg-ink-900' : 'bg-transparent')} />)}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500"><Text>Gate pass</Text></p>
        <p className="text-sm font-semibold"><Text>Ahmad Faizal · Elmina Plumbing Co.</Text></p>
        <p className="text-xs text-ink-500"><Text>Valid on the visit day only</Text></p>
      </div>
    </div>
  );
}

const RESIDENT: WalkStep[] = [
  {
    key: 'choose', icon: Search, who: 'You', title: 'Choose what you need',
    text: 'Pick a service. Plumbing, electrical, air-conditioning and renovation companies have their licence checked by the township team before they can take bookings.',
    screen: <div className="space-y-3"><ScreenTitle>Book a home service</ScreenTitle><ServiceTiles />
      <ScreenRow icon={BadgeCheck} label="Licence checked by the township" i={6} tone="gold" />
    </div>,
  },
  {
    key: 'compare', icon: Star, who: 'You', title: 'Compare the companies',
    text: 'See every company serving the township, how it prices the work and reviews from residents who completed a booking. Only real, finished jobs can be reviewed.',
    screen: <div className="space-y-3"><ScreenTitle>Plumbing</ScreenTitle>
      <ScreenCard icon={Wrench} title="Elmina Plumbing Co." note="Price after inspection · 2 workers" value="4.8" i={0} tone="gold" />
      <ScreenRow icon={Star} label="“Came on time and fixed the leak.”" i={1} />
    </div>,
  },
  {
    key: 'book', icon: ClipboardList, who: 'You', title: 'Send your request',
    text: 'Choose a day and a time of day, say what is wrong, and add a photo if it helps. The company is told at once and replies in the app.',
    screen: <div className="space-y-3"><ScreenTitle>Book a visit</ScreenTitle>
      <ScreenRow icon={ClipboardList} label="Kitchen sink is leaking" i={0} />
      <ScreenRow label="Tomorrow · Morning" value="Your choice" i={1} />
      <ScreenButton i={2}>Send request</ScreenButton>
    </div>,
  },
  {
    key: 'who', icon: UserCheck, who: 'Company', title: 'See who is coming',
    text: 'The company confirms the visit and assigns a registered worker. You see their name before they arrive, and can follow each step in My bookings.',
    screen: <div className="space-y-3"><ScreenTitle chip="Worker assigned">My bookings</ScreenTitle><BookingSteps upTo={2} /></div>,
  },
  {
    key: 'gate', icon: QrCode, who: 'Guard', title: 'The gate pass is made for you',
    text: 'A gate pass for the worker is made automatically for the visit day. The worker shows the QR code at the main gate, so there is nothing for you to do.',
    screen: <div className="space-y-3"><ScreenTitle>Main gate</ScreenTitle><GatePass />
      <ScreenRow icon={DoorOpen} label="Scanned at the main gate" i={1} tick />
    </div>,
  },
  {
    key: 'price', icon: Handshake, who: 'You and the company', title: 'Agree the price in person',
    text: 'You agree the price with the company before any work starts, and you pay them directly. SimeTown takes no payment.',
    screen: <div className="space-y-3"><ScreenTitle>On site</ScreenTitle>
      <ScreenCard icon={Handshake} title="Price agreed before work starts" note="You pay the company directly" i={0} tone="brand" />
      <ScreenRow label="SimeTown takes no payment" i={1} tick />
    </div>,
  },
  {
    key: 'done', icon: BadgeCheck, who: 'You', title: 'Confirm the job, then review it',
    text: 'When the company says the work is finished, confirm only if you are happy. It goes into your home logbook. Something wrong? Report it privately: only the township team sees it.',
    screen: <div className="space-y-3"><ScreenTitle>The job is done</ScreenTitle>
      <ScreenButton i={0} tone="success">The job is done</ScreenButton>
      <ScreenRow icon={ClipboardList} label="Added to your home logbook" i={1} tick />
      <ScreenRow icon={Flag} label="Report a problem privately" i={2} />
    </div>,
  },
];

export function ResidentHomeServiceWalkthrough() {
  return <Walkthrough title="How SimeTown Home works" description="From choosing a company to the job being done." steps={RESIDENT} />;
}
