'use client';

import { Text } from '@/components/ui/localized-text';
import {
  Accessibility, BarChart3, Bot, Camera, ClipboardList, CloudRain, Gauge, HeartPulse, History, Map, MapPin, Megaphone, PhoneCall, Radio, Route,
  Send, ShieldCheck, Siren, Timer, TriangleAlert, UserCheck, Users, Wrench, X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ScreenButton, ScreenCard, ScreenRow, ScreenStats, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Banjir works, for each role: residents, guards on flood duty, and staff, admins and HQ on the flood
 * dashboard. Pictures only: the zones are the demo township's, and every rule shown is the agent's own (BR19,
 * BR21, BR28, BR32). The warning and danger lines are township settings, so the pictures show examples.
 */

/** A drain gauge: water rising to `pct`, with the warning and danger lines marked. */
function Gauge3({ pct, label }: { pct: number; label: string }) {
  const tone = pct >= 90 ? 'from-[#ff6b5a] to-accent-600' : pct >= 75 ? 'from-gold-300 to-[#e08a2a]' : 'from-[#7fd3c2] to-[#2f9b84]';
  return (
    <div className="hiw-row flex items-end gap-4 rounded-2xl bg-white/[0.07] p-3.5" style={{ '--i': 0 } as CSSProperties}>
      <div className="relative h-28 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15">
        <span className={cn('walk-rise absolute inset-x-0 bottom-0 bg-gradient-to-t', tone)} style={{ height: `${pct}%` }} />
        <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-white/70" style={{ bottom: '90%' }} />
        <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-white/40" style={{ bottom: '75%' }} />
      </div>
      <div className="min-w-0 pb-1">
        <p className="text-xs text-white/60"><Text>{label}</Text></p>
        <p className="font-display text-3xl font-bold text-white">{pct}%</p>
        <p className="mt-1 text-[11px] text-white/60"><Text>Dashed lines: warning and danger</Text></p>
      </div>
    </div>
  );
}

/** The red band residents see at the top of every page. */
function FloodBand({ danger = false, i = 1 }: { danger?: boolean; i?: number }) {
  return (
    <div className={cn('hiw-row rounded-2xl p-3 text-white shadow-xl', danger ? 'bg-[#800d1c]' : 'bg-accent-600')} style={{ '--i': i } as CSSProperties}>
      <p className="flex items-center gap-2">
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent-700"><Text>{danger ? 'Flood danger' : 'Flood warning'}</Text></span>
        <span className="text-sm font-semibold"><Text>Elmina Valley 1 & 2</Text></span>
      </p>
      <p className="mt-1 text-xs text-white/90"><Text>{danger ? 'Water level is at 92%. Move to safety now.' : 'Water level is at 78%. Get ready to move and check your safe route.'}</Text></p>
      <span className="mt-2 inline-block rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-accent-700"><Text>See safe route</Text></span>
    </div>
  );
}

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'watch', icon: Gauge, who: 'SimeTown', title: 'Sensors watch the drains in your zone',
    text: 'Drain sensors and cameras measure the water in each zone. The Banjir page shows your zone’s level, its safe route and its assembly point, updated every few seconds.',
    screen: <div className="space-y-3"><ScreenTitle chip="Live">Your zone · Elmina Valley 1 & 2</ScreenTitle><Gauge3 pct={34} label="Normal" />
      <ScreenRow icon={Route} label="Safe route" value="Persiaran Metafasa" i={1} /></div>,
  },
  {
    key: 'agree', icon: ShieldCheck, who: 'Banjir agent', title: 'Two signals must agree',
    text: 'An alert goes out by itself only when two different kinds of signal agree, such as the drain sensor and the camera. With only one signal, the duty officer checks first.',
    screen: <div className="space-y-3"><ScreenTitle>Banjir agent</ScreenTitle>
      <ScreenRow icon={Radio} label="Drain sensor" value="78%" i={0} tick />
      <ScreenRow icon={Camera} label="Camera reading" value="Water on the road" i={1} tick />
      <ScreenCard icon={Megaphone} title="Warning sent" note="Two signals agreed" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'band', icon: TriangleAlert, who: 'You', title: 'A warning appears on every page',
    text: 'A red band shows at the top of the app with your zone and the water level. Tap See safe route to see the way out and where to gather.',
    screen: <div className="space-y-3"><ScreenTitle>Flood warning</ScreenTitle><FloodBand i={0} />
      <ScreenRow icon={MapPin} label="Assembly point" value="Persiaran Metafasa" i={2} /></div>,
  },
  {
    key: 'danger', icon: Siren, who: 'You', title: 'At danger, the alert fills your screen',
    text: 'A danger alert covers whatever you are doing, with the safe route and where to go. Every message says when the next update comes, at least every 15 minutes.',
    screen: <div className="space-y-3"><ScreenTitle>Flood danger</ScreenTitle><FloodBand danger i={0} />
      <ScreenRow icon={Timer} label="Next update" value="In 15 minutes" i={2} /></div>,
  },
  {
    key: 'checkin', icon: UserCheck, who: 'You', title: 'Tell the team you are safe',
    text: 'Tap I’m safe, or I need help. If you ask for help, duty staff send a guard to you and can see when you have been reached.',
    screen: <div className="space-y-3"><ScreenTitle>Let the team know</ScreenTitle>
      <ScreenButton i={0}>I’m safe</ScreenButton>
      <div className="hiw-row" style={{ '--i': 1 } as CSSProperties}><span className="block rounded-xl bg-accent-600 py-2.5 text-center text-sm font-bold text-white"><Text>I need help</Text></span></div>
      <ScreenCard icon={ShieldCheck} title="You checked in safe" note="The township team can see your answer" i={2} tone="success" />
    </div>,
  },
  {
    key: 'priority', icon: Accessibility, who: 'Akses+', title: 'Need extra help? Join the priority list',
    text: 'In Akses+, turn on Priority help list for floods. In a flood warning, staff phone homes on this list first. Only duty staff see it, only during an alert, and only with your consent.',
    screen: <div className="space-y-3"><ScreenTitle>Akses+</ScreenTitle>
      <ScreenRow icon={Accessibility} label="Priority help list for floods" value="On" i={0} tick />
      <ScreenRow icon={PhoneCall} label="Staff phone you first" i={1} tick />
      <ScreenRow icon={Users} label="Your carer sees alerts and check-ins" i={2} tick />
    </div>,
  },
];

export function ResidentFloodWalkthrough() {
  return <Walkthrough title="How Banjir works" description="How flood alerts reach you, and what to do." steps={RESIDENT} />;
}

// --- Guards ---------------------------------------------------------------------------------------

const GUARD: WalkStep[] = [
  {
    key: 'band', icon: TriangleAlert, who: 'Guard', title: 'The flood band tells you first',
    text: 'When a zone has a flood warning or danger, the red band appears at the top of your screen too, with the zone and the water level.',
    screen: <div className="space-y-3"><ScreenTitle>Main gate</ScreenTitle><FloodBand i={0} /></div>,
  },
  {
    key: 'tasks', icon: ClipboardList, who: 'Guard', title: 'Your flood task list',
    text: 'While the alert is on, the gate screen lists what to do: keep the gate lane clear and check the drain grilles. At danger, open the assembly point and direct people along the safe route.',
    screen: <div className="space-y-3"><ScreenTitle>Flood task list</ScreenTitle>
      <ScreenRow icon={MapPin} label="Open the assembly point" i={0} tick />
      <ScreenRow icon={Route} label="Direct people along the safe route" i={1} tick />
      <ScreenRow icon={ShieldCheck} label="Keep the gate lane clear" i={2} tick />
    </div>,
  },
  {
    key: 'reach', icon: HeartPulse, who: 'Guard', title: 'Reach a resident who needs help',
    text: 'If a resident asked for help or is on the priority list, the duty officer may send you. Their name, address and phone show on the gate screen. Call them or go to them.',
    screen: <div className="space-y-3"><ScreenTitle>Main gate</ScreenTitle>
      <ScreenCard icon={HeartPulse} title="Reach Zainab Yusof" note="Elmina Gardens · Asked for help · No. 7, Jalan Frekuensi U16/115" i={0} tone="alert" />
      <ScreenButton i={1}>Reached them</ScreenButton>
    </div>,
  },
  {
    key: 'done', icon: UserCheck, who: 'Duty officer', title: 'The duty officer sees it is done',
    text: 'Tap Reached them once you have got to them. The flood dashboard shows who reached each resident and when.',
    screen: <div className="space-y-3"><ScreenTitle>Priority help</ScreenTitle>
      <ScreenCard icon={UserCheck} title="Reached by Azman Shah" note="Zainab Yusof · 2 min ago" i={0} tone="success" />
    </div>,
  },
];

export function GuardFloodWalkthrough() {
  return <Walkthrough title="How flood duty works" label="How flood duty works" description="What appears on the gate screen during a flood, and what to do." steps={GUARD} />;
}

// --- Staff, admins and HQ (flood dashboard) ------------------------------------------------------

const CONSOLE: WalkStep[] = [
  {
    key: 'map', icon: Map, who: 'Staff, admins and HQ', title: 'Live map: every zone at a glance',
    text: 'Each zone’s water level, status and latest message, live. A zone under an alert stands out, with a link to its place in the agent queue.',
    screen: <div className="space-y-3"><ScreenTitle chip="Live">Live map</ScreenTitle>
      <ScreenStats items={[{ label: 'Valley 1 & 2', value: '78%', tone: 'warn' }, { label: 'Gardens', value: '22%' }, { label: 'West', value: '9%' }]} />
      <ScreenCard icon={TriangleAlert} title="Warning · Elmina Valley 1 & 2" note="Open in the agent queue" i={3} tone="gold" />
    </div>,
  },
  {
    key: 'rules', icon: ShieldCheck, who: 'Banjir agent', title: 'Numbers and fixed rules decide',
    text: 'An alert goes out by itself only when two different kinds of signal agree. Danger needs the drain sensor and the camera. Rain or residents’ reports can support a warning, never danger. The AI only reads pictures.',
    screen: <div className="space-y-3"><ScreenTitle>Signals</ScreenTitle>
      <ScreenRow icon={Radio} label="Drain sensor" value="Danger" i={0} tick />
      <ScreenRow icon={Camera} label="Camera" value="Danger" i={1} tick />
      <ScreenRow icon={CloudRain} label="Rain gauge" value="Warning only" i={2} />
    </div>,
  },
  {
    key: 'queue', icon: Bot, who: 'Duty officer', title: 'Agent queue: confirm one-signal alerts',
    text: 'With only one signal, the agent drafts the message and waits for you. Send now, or Cancel with a reason. A warning waits 5 minutes, then admins are told. A danger is sent after 3 minutes if the water is still rising.',
    screen: <div className="space-y-3"><ScreenTitle>Confirm a warning alert?</ScreenTitle>
      <ScreenRow icon={Timer} label="Time left to confirm" value="4:12" i={0} tone="gold" />
      <ScreenButton i={1}>Send now</ScreenButton>
      <ScreenRow icon={X} label="Cancel needs a reason" i={2} />
    </div>,
  },
  {
    key: 'message', icon: Megaphone, who: 'Banjir agent', title: 'Every message says the same four things',
    text: 'What is happening, where, what to do, and when the next update comes. Updates follow at least every 15 minutes until the all clear.',
    screen: <div className="space-y-3"><ScreenTitle>Official message</ScreenTitle>
      <ScreenRow label="What: water is rising in the drains" i={0} />
      <ScreenRow label="Where: Jalan Metafasa U16/171" i={1} />
      <ScreenRow label="To do: get ready to move" i={2} />
      <ScreenRow icon={Timer} label="Next update by 4:45 pm" i={3} tone="gold" />
    </div>,
  },
  {
    key: 'help', icon: HeartPulse, who: 'Duty staff', title: 'Priority help: send a guard',
    text: 'During an alert, see residents on the priority help list and anyone who tapped I need help. Choose who goes and tap Send: the task appears on the guard’s gate screen.',
    screen: <div className="space-y-3"><ScreenTitle>Priority help</ScreenTitle>
      <ScreenCard icon={HeartPulse} title="Zainab Yusof · Asked for help" note="Priority list · No. 7, Jalan Frekuensi U16/115" i={0} tone="alert" />
      <ScreenRow icon={Send} label="Who goes: Azman Shah" value="Send" i={1} tick />
    </div>,
  },
  {
    key: 'sensors', icon: Wrench, who: 'Staff and admins', title: 'Sensors: keep them healthy',
    text: 'A sensor that goes silent, gets stuck or runs low on battery is marked faulty and stops counting, and a ticket opens. Calibrate it on site and log maintenance to close it.',
    screen: <div className="space-y-3"><ScreenTitle>Sensors</ScreenTitle>
      <ScreenRow icon={Radio} label="EV12-LAKEEDGE-1 · battery 84%" value="Healthy" i={0} tick />
      <ScreenRow icon={Radio} label="EV12-MAINDRAIN-2 · silent 6 min" value="Faulty" i={1} tone="alert" />
      <ScreenRow icon={Wrench} label="Log maintenance to close" i={2} />
    </div>,
  },
  {
    key: 'events', icon: History, who: 'Staff, admins and HQ', title: 'Events and reports after the all clear',
    text: 'Each flood becomes an event: a timeline, who was warned, how many checked in, and a false-alarm review once the water is back to normal.',
    screen: <div className="space-y-3"><ScreenTitle>Event report</ScreenTitle>
      <ScreenStats items={[{ label: 'Warned', value: '48' }, { label: 'Checked in', value: '81%' }, { label: 'Lead time', value: '22 min' }]} />
      <ScreenRow icon={BarChart3} label="False-alarm review" value="Needs review" i={3} tone="gold" />
    </div>,
  },
];

export function ConsoleFloodWalkthrough() {
  return <Walkthrough title="How the flood dashboard works" description="The tabs, the alert rules, and who does what." steps={CONSOLE} />;
}
