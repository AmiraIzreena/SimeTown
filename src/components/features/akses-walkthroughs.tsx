'use client';

import { Text } from '@/components/ui/localized-text';
import {
  Accessibility, Bell, CheckCircle2, DoorOpen, Droplets, HeartHandshake, LifeBuoy, Lock, MapPin, PhoneCall, Ruler, ShieldCheck, Trash2,
  TriangleAlert, Users, Vibrate, Volume2, Wallet, type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ScreenButton, ScreenCard, ScreenRow, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Akses+ works, for residents: telling the app what helps once, Simple Mode, read-aloud and flashing alerts, the
 * priority help list for floods, carers, and step-free places. Pictures only: the names are the demo township's,
 * and every rule shown is the one the app applies (BR32).
 */

/** The Simple Mode home: four big buttons, the same four the app shows. */
function SimpleHome() {
  const tiles: { label: string; icon: LucideIcon; tone: string }[] = [
    { label: 'Help', icon: LifeBuoy, tone: 'bg-accent-600 text-white' },
    { label: 'Visitors', icon: DoorOpen, tone: 'bg-brand-700 text-white' },
    { label: 'Flood', icon: Droplets, tone: 'bg-[#1f5f8b] text-white' },
    { label: 'My points', icon: Wallet, tone: 'bg-gold-500 text-ink-900' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map((t, n) => (
        <div key={t.label} className={cn('hiw-row flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl font-display text-lg font-bold shadow-xl', t.tone, n === 0 && 'walk-glow')} style={{ '--i': n } as CSSProperties}>
          <t.icon className="size-6" aria-hidden /><Text>{t.label}</Text>
        </div>
      ))}
    </div>
  );
}

/** A phone screen flashing for an alert, once a second, with the vibration marks beside it. */
function FlashingPhone() {
  return (
    <div className="hiw-row flex items-center justify-center gap-4 rounded-2xl bg-white/[0.07] p-4" style={{ '--i': 0 } as CSSProperties}>
      <Vibrate className="size-5 text-gold-300" aria-hidden />
      <div className="relative h-28 w-16 overflow-hidden rounded-2xl bg-ink-900 ring-2 ring-white/20">
        <span aria-hidden className="walk-flash absolute inset-1 rounded-xl bg-white" />
        <span className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 rounded-md bg-accent-600 px-1 py-1 text-center text-[9px] font-bold uppercase leading-tight text-white"><Text>Flood warning</Text></span>
      </div>
      <Vibrate className="size-5 -scale-x-100 text-gold-300" aria-hidden />
    </div>
  );
}

const RESIDENT: WalkStep[] = [
  {
    key: 'needs', icon: Accessibility, who: 'You', title: 'Tell the app what helps you, once',
    text: 'Tick what applies to you, if anything. Every feature adapts from there, so you never have to ask again. It is optional, and private.',
    screen: <div className="space-y-3"><ScreenTitle>My access needs</ScreenTitle>
      <ScreenRow icon={Accessibility} label="I use a wheelchair or find steps hard" i={0} tick />
      <ScreenRow icon={Users} label="I am an older resident" i={1} tick />
      <ScreenRow icon={Lock} label="Private: seen only by you" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'simple', icon: LifeBuoy, who: 'You', title: 'Simple Mode: four big buttons',
    text: 'Turn on Simple Mode and your home screen becomes four big buttons: Help, Visitors, Flood and My points. Forms ask one question at a time.',
    screen: <div className="space-y-3"><ScreenTitle>Simple Mode</ScreenTitle><SimpleHome /></div>,
  },
  {
    key: 'alerts', icon: Volume2, who: 'You', title: 'Hear alerts, or see them flash',
    text: 'Read alerts aloud uses your phone’s own voice for flood warnings and Simple Mode. Flash and vibrate is for deaf and hard-of-hearing residents: one flash a second, within the safe limit.',
    screen: <div className="space-y-3"><ScreenTitle>Alerts</ScreenTitle><FlashingPhone />
      <ScreenRow icon={Volume2} label="Read alerts aloud" value="On" i={1} tick />
    </div>,
  },
  {
    key: 'priority', icon: PhoneCall, who: 'Duty staff', title: 'Priority help list for floods',
    text: 'Join the list and, in a flood warning, staff phone your home first. Add a short note, such as “Uses a walking frame”. Only duty staff see it, only during an alert, and only with your consent.',
    screen: <div className="space-y-3"><ScreenTitle>Flood warning</ScreenTitle>
      <ScreenCard icon={PhoneCall} title="Phone first: No. 7, Jalan Frekuensi U16/115" note="Note: Uses a walking frame; lives alone" i={0} tone="alert" />
      <ScreenRow icon={ShieldCheck} label="Seen only during the alert" i={1} tick />
    </div>,
  },
  {
    key: 'carer', icon: HeartHandshake, who: 'Your carer', title: 'A carer can keep an eye on you',
    text: 'Ask a family member who is also a resident, using their member code. They hear about flood alerts in your area and see whether you checked in safe. Never your access needs.',
    screen: <div className="space-y-3"><ScreenTitle>Carers</ScreenTitle>
      <ScreenRow icon={HeartHandshake} label="Daniel" value="Your carer" i={0} tick />
      <ScreenCard icon={CheckCircle2} title="Aisyah checked in safe" note="Elmina Valley 1 & 2 · Flood warning" i={1} tone="success" />
    </div>,
  },
  {
    key: 'places', icon: MapPin, who: 'You', title: 'Step-free places, kept honest',
    text: 'Ramps, lifts, accessible toilets and OKU parking show two things: whether the place is verified, and whether it can be used today. Report a problem, and follow it until it is fixed.',
    screen: <div className="space-y-3"><ScreenTitle>Step-free and accessible places</ScreenTitle>
      <ScreenRow icon={Ruler} label="Ramp · Community hall main entrance" value="Verified" i={0} tick />
      <ScreenRow icon={TriangleAlert} label="Lift · Pangsapuri Harmoni Elmina Block A" value="Reported" i={1} tone="alert" />
      <ScreenButton i={2}>Report a problem</ScreenButton>
    </div>,
  },
  {
    key: 'yours', icon: Trash2, who: 'You', title: 'Yours to change or delete',
    text: 'Change your answers whenever you like, and you are told when a report you made changes. Delete your access needs at any time and they are gone.',
    screen: <div className="space-y-3"><ScreenTitle>Akses+</ScreenTitle>
      <ScreenCard icon={Bell} title="Your report was fixed" note="Lift · Pangsapuri Harmoni Elmina Block A · Is it clear?" i={0} tone="brand" />
      <ScreenRow icon={Trash2} label="Delete my access needs" i={1} />
    </div>,
  },
];

export function ResidentAksesWalkthrough() {
  return <Walkthrough title="How Akses+ works" description="How the app adapts to you, and who sees what." steps={RESIDENT} />;
}
