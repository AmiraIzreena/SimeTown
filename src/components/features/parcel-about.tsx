'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { BellRing, DoorOpen, History, KeyRound, ShieldAlert, Store, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, Skeleton, SkeletonCard } from '@/components/ui/feedback';
import { useApi } from '@/lib/hooks';
import { formatHour } from '@/shared/lockers';
import { CounterStatus, MY_LOCKERS, type MyLockers } from './locker-parcels';

/**
 * The About tab of Parcels, in the same shape as Kitar's: what the lockers look like, where the household's
 * parcels go, how collecting works, and short answers to common questions. Every timing shown comes from the
 * township's own settings, never from fixed text.
 */

const dayCount = (days: number) => (days === 1 ? '1 day' : `${days} days`);

/** A locker bank beside the guardhouse, one door open with a parcel. Decorative: the label says what it shows. */
function LockerIllustration() {
  const doors = Array.from({ length: 18 }, (_, i) => ({ col: i % 6, row: Math.floor(i / 6) }));
  return (
    <LocalizedDiv role="img" aria-label="Illustration of a smart locker bank beside the guardhouse" className="relative h-40 overflow-hidden rounded-xl bg-gradient-to-br from-brand-600 to-brand-400">
      <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" aria-hidden>
        <g opacity=".2" fill="#fff"><circle cx="352" cy="24" r="38" /><circle cx="40" cy="28" r="20" /></g>
        <rect x="0" y="128" width="400" height="22" fill="rgba(6,32,26,.3)" />
        {/* The locker bank */}
        <rect x="96" y="22" width="176" height="108" rx="10" fill="#F2F6F3" />
        <rect x="96" y="22" width="176" height="14" rx="7" fill="#dbe0e0" />
        {doors.map(({ col, row }) => {
          const x = 104 + col * 27;
          const y = 42 + row * 28;
          const mine = col === 3 && row === 1;
          return mine ? (
            <g key={`${col}-${row}`}>
              <rect x={x} y={y} width="24" height="25" rx="3" fill="#232a2a" />
              <rect x={x + 4} y={y + 9} width="16" height="12" rx="2" fill="#C9A21C" />
              <rect x={x + 4} y={y + 13} width="16" height="2.5" fill="#A3820F" />
              <path d={`M${x} ${y} l-12 4 v19 l12 2 z`} fill="#3FBF9C" />
            </g>
          ) : (
            <g key={`${col}-${row}`}>
              <rect x={x} y={y} width="24" height="25" rx="3" fill="#E4EAE6" stroke="#cfd8d3" />
              <circle cx={x + 19} cy={y + 12.5} r="1.6" fill="#9aa6a1" />
            </g>
          );
        })}
        {/* Keypad and screen */}
        <rect x="112" y="27" width="20" height="5" rx="2.5" fill="#3FBF9C" />
        {/* The guardhouse */}
        <rect x="292" y="70" width="70" height="60" rx="6" fill="#F2F6F3" />
        <path d="M284 74 L327 50 L370 74 Z" fill="#232a2a" opacity=".85" />
        <rect x="302" y="84" width="24" height="18" rx="3" fill="#2E9CCA" opacity=".85" />
        <rect x="334" y="92" width="18" height="38" rx="3" fill="#4c5757" />
        <rect x="30" y="96" width="44" height="34" rx="5" fill="#C9A21C" />
        <rect x="30" y="108" width="44" height="4" fill="#A3820F" />
        <rect x="46" y="96" width="12" height="34" fill="#A3820F" opacity=".5" />
      </svg>
      <span className="absolute left-3 top-2.5 rounded-full bg-black/30 px-2.5 py-0.5 text-xs font-semibold text-white" aria-hidden>
        <Text>Illustration of a smart locker bank</Text>
      </span>
    </LocalizedDiv>
  );
}

interface Tile {
  title: string;
  icon: LucideIcon;
  body: (d: MyLockers) => string[];
}

const counterHours = (d: MyLockers) => (d.counters[0] ? `${formatHour(d.counters[0].openFromHour)} to ${formatHour(d.counters[0].openToHour)}` : null);

const TILES: Tile[] = [
  {
    title: 'Your own locker door',
    icon: DoorOpen,
    body: () => [
      'Every home has its own private door, size M or larger, in the locker bank that serves its precinct. Nobody from another home can open it.',
      'Your home gets the door with its first locker parcel and keeps it while you live there. The locker is open 24 hours.',
    ],
  },
  {
    title: 'When a parcel goes to the guardhouse',
    icon: Store,
    body: (d) => {
      const hours = counterHours(d);
      return [
        'A locker parcel goes to the guardhouse when it is too big for your door, your door already has a parcel in it, or your door needs attention. The courier says why, and you are told. Some couriers leave parcels straight with the guard too.',
        hours ? `The guard receives it while the guardhouse is open, ${hours}. After hours, the courier keeps it and brings it on the next round.` : 'The guard receives it while the guardhouse is open. After hours, the courier keeps it and brings it on the next round.',
        'No parcel is left at your house.',
      ];
    },
  },
  {
    title: 'Reminders',
    icon: BellRing,
    body: (d) => [
      `A parcel in your door is never overdue. You get a gentle reminder after ${d.policy.doorReminderHours} hours, then once a week.`,
      `A parcel at the guardhouse is overdue after ${dayCount(d.policy.overdueAfterDays)}. You are reminded once a week, and after ${dayCount(d.policy.callAfterDays)} the guard may call your home.`,
      'Reminders are not sent late at night. Security alerts are sent at any hour.',
    ],
  },
  {
    title: 'Late collections',
    icon: History,
    body: (d) => [
      `The guardhouse keeps your parcel until you collect it; it is not sent back for waiting. Parcels collected more than ${dayCount(d.policy.overdueAfterDays)} after they arrived appear in My late collections, with the days they waited.`,
      'No charges apply. A late-collection storage charge is being considered for the future; you would be told well in advance.',
    ],
  },
  {
    title: 'Keeping your code safe',
    icon: KeyRound,
    body: () => [
      'Your QR code and PIN open only your door, and only for that parcel. Each works once.',
      'Think someone else has seen your code? Tap Get a new code on the parcel. The old one stops working straight away, and others in your home are told.',
    ],
  },
  {
    title: 'Security alerts',
    icon: ShieldAlert,
    body: () => [
      'If your door is opened without a valid code, you are told at once and the guard on duty checks the locker.',
      'If someone in your home opened it, no action is needed.',
    ],
  },
];

const STEPS = [
  { title: 'The courier puts your parcel in your own door.', body: 'The locker confirms it only when the door is shut with the parcel inside.' },
  { title: 'You are told at once.', body: 'Your QR code and PIN appear on the Parcel lockers tab.' },
  { title: 'Collect it any time.', body: 'Show the QR code or type the PIN at the locker, or open your door from this app with the station code.' },
];

function AboutSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <Skeleton className="h-40 w-full rounded-xl" />
      <SkeletonCard className="space-y-3 p-5"><Skeleton className="h-4 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></SkeletonCard>
    </div>
  );
}

/** The About tab for Parcels: the household's door and the guardhouse, how it works, and good-to-know answers. */
export function ParcelAbout() {
  const mine = useApi<MyLockers>(MY_LOCKERS, { refreshInterval: 30_000 });
  const [tile, setTile] = useState<Tile | null>(null);
  return (
    <Async state={mine} skeleton={<AboutSkeleton />}>
      {(d) => (
        <div className="space-y-6">
          <LockerIllustration />

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-ink-900"><Text>Where your parcels go</Text></h2>
              <p className="text-sm text-ink-500"><Text>Into your home’s own locker door. When that is not possible, or a courier leaves it with the guard, to the guardhouse.</Text></p>
            </div>
            <Card>
              <ul className="divide-y divide-ink-100">
                <li className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><DoorOpen className="size-5" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink-900">{d.door ? <Text>{`${d.door.station} · door ${d.door.label}`}</Text> : <Text>Your locker door</Text>}</span>
                    <span className="block text-sm text-ink-500">{d.door ? d.door.location : <Text>Given to your home with its first locker parcel</Text>}</span>
                  </span>
                  <Badge tone="success"><Text>Open 24 hours</Text></Badge>
                </li>
                {d.counters.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700"><Store className="size-5" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ink-900"><Text>{`Guardhouse · ${c.name}`}</Text></span>
                      <span className="block text-sm text-ink-500">{c.location} · <Text>{`Open ${formatHour(c.openFromHour)} to ${formatHour(c.openToHour)}`}</Text></span>
                    </span>
                    <Badge tone={c.open ? 'success' : 'neutral'}><Text>{c.open ? 'Open now' : 'Closed now'}</Text></Badge>
                  </li>
                ))}
              </ul>
            </Card>
            {d.counters.length > 0 && <div className="grid gap-3 sm:hidden">{d.counters.map((c) => <CounterStatus key={c.id} counter={c} />)}</div>}
          </section>

          <Card className="p-5">
            <ol className="space-y-3 text-[15px] text-ink-700">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{i + 1}</span>
                  <span>
                    <strong className="text-ink-900"><Text>{s.title}</Text></strong> <Text>{s.body}</Text>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-ink-900"><Text>Good to know</Text></h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TILES.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setTile(item)}
                  className="glass-surface flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] font-semibold text-ink-900 shadow-sm transition-colors duration-200 hover:border-brand-300 sm:min-h-28 sm:flex-col sm:justify-center sm:text-center"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                    <item.icon className="size-5" aria-hidden />
                  </span>
                  <Text>{item.title}</Text>
                </button>
              ))}
            </div>
          </section>

          <Modal open={tile !== null} onClose={() => setTile(null)} title={tile?.title ?? ''} footer={<Button onClick={() => setTile(null)}><Text>Got it</Text></Button>}>
            <div className="space-y-3">
              {tile?.body(d).map((paragraph) => <p key={paragraph} className="text-[15px] leading-relaxed text-ink-700"><Text>{paragraph}</Text></p>)}
            </div>
          </Modal>
        </div>
      )}
    </Async>
  );
}
