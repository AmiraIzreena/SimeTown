'use client';

import {
  Award, CalendarCheck, ClipboardList, Coins, DoorOpen, Flag, Moon, Package, Pause, QrCode, Recycle, Scale, ShieldCheck, Ticket, Timer, Truck, UserRound,
} from 'lucide-react';
import { ScreenButton, ScreenCard, ScreenRow, ScreenStats, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Kitar works, for residents (kiosk bins with a scale, guest codes and booked collections) and for staff on
 * Recycling collections. Pictures only. The rules are the server's own: only the bin's scale sets a weight and only
 * a signed bin session earns points per kg (BR23); XP and points stay inside the person's and home's limits (BR6);
 * collections follow kitar/collections.ts (the gate record decides each weight) and the nightly `recycling` job. Rates and limits are settings, so the
 * pictures show the starting values.
 */

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'ready', icon: Recycle, who: 'You', title: 'Get your items ready',
    text: 'Empty, rinse and dry them, then sort them by type. Each bin takes one material, such as paper or aluminium, and each material earns its own points per kg.',
    screen: <div className="space-y-2.5"><ScreenTitle>Points per kg</ScreenTitle>
      <ScreenRow icon={Package} label="Paper and cardboard" value="10" i={0} />
      <ScreenRow icon={Recycle} label="Plastic, PET" value="10" i={1} />
      <ScreenRow icon={Coins} label="Aluminium and tins" value="20" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'scan', icon: QrCode, who: 'You', title: 'Tap Recycle now and scan the bin',
    text: 'Choose the site and the bin, then scan the code on the bin’s screen with your phone camera. The code changes every 30 seconds, so it only works at the bin.',
    screen: <div className="space-y-3"><ScreenTitle>Recycle now</ScreenTitle>
      <ScreenRow icon={DoorOpen} label="Kiosk Elmina Valley" value="Open" i={0} tick />
      <ScreenRow icon={Package} label="Paper and cardboard" i={1} tick />
      <ScreenRow icon={QrCode} label="Scan the code on the bin’s screen" value="30 s" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'weigh', icon: Scale, who: 'Kiosk bin', title: 'The bin weighs it for you',
    text: 'Put your items in the bin. Its scale weighs them and sends the weight by itself, so you never type it. Only the weight the bin sends counts.',
    screen: <div className="space-y-3"><ScreenTitle chip="Live">Kiosk Elmina Valley</ScreenTitle>
      <ScreenStats items={[{ label: 'Paper and cardboard', value: '2.4 kg' }]} />
      <ScreenCard icon={Scale} title="Weighed by the bin’s scale" note="Nothing is typed on your phone" i={1} />
    </div>,
  },
  {
    key: 'reward', icon: Award, who: 'You', title: 'See your reward straight away',
    text: 'Each trip earns 20 Impact XP, and the bin’s weight earns points at your material’s rate. Spend points at a member shop and confirm on your own phone.',
    screen: <div className="space-y-3"><ScreenTitle>Thank you for recycling</ScreenTitle>
      <ScreenCard icon={Award} title="+20 Impact XP" note="For the trip" i={0} tone="gold" />
      <ScreenCard icon={Coins} title="+24 points" note="2.4 kg of paper at 10 per kg" i={1} tone="success" />
    </div>,
  },
  {
    key: 'limits', icon: Timer, who: 'You', title: 'Limits keep it fair',
    text: 'XP and points count for 2 trips a day per person and 60 trips a month per home, and your home shares a monthly points limit. More trips are welcome but earn nothing.',
    screen: <div className="space-y-2.5"><ScreenTitle>Your limits</ScreenTitle>
      <ScreenRow label="Your trips today" value="1 of 2" i={0} />
      <ScreenRow label="Trips from your home this month" value="14 of 60" i={1} />
      <ScreenRow label="Points per kg for your home this month" value="320 of 1,000" i={2} />
    </div>,
  },
  {
    key: 'guest', icon: Ticket, who: 'Visitors', title: 'Visitors get a guest code',
    text: 'A visitor recycles as a guest and gets an 8-letter code. A resident taps I have a guest code and enters it within 14 days. Guest recycling earns XP only.',
    screen: <div className="space-y-3"><ScreenTitle>Claim a guest code</ScreenTitle>
      <ScreenRow icon={Ticket} label="Code from the kiosk" value="TQMWRHKB" i={0} />
      <ScreenButton i={1}>Claim</ScreenButton>
      <ScreenRow icon={Award} label="+20 XP" value="No points" i={2} />
    </div>,
  },
  {
    key: 'book', icon: Truck, who: 'You', title: 'Bulky items? Book a collection',
    text: 'An old fridge, e-waste or a big load of paper: tap Book, choose what it is, a collector who takes it, and a day from tomorrow up to 30 days ahead. It is confirmed at once, and the gate gets the collector’s pass.',
    screen: <div className="space-y-2.5"><ScreenTitle>Book a collection</ScreenTitle>
      <ScreenRow label="What should they collect?" value="E-waste" i={0} />
      <ScreenRow icon={Truck} label="Kitar Plus Recyclers" i={1} tick />
      <ScreenRow icon={CalendarCheck} label="When" value="Morning" i={2} />
      <ScreenButton i={3}>Request collection</ScreenButton>
    </div>,
  },
  {
    key: 'weight', icon: Scale, who: 'You', title: 'After the visit, enter the weight',
    text: 'Tap Enter the weight with what the collector took. If the gate scanned the collector in that day, it earns Impact XP at once. With no gate record of them, there is no reward. Collections never earn points per kg.',
    screen: <div className="space-y-3"><ScreenTitle>How much did they take?</ScreenTitle>
      <ScreenRow icon={ShieldCheck} label="Collector scanned in at the gate" i={0} tick />
      <ScreenRow icon={Scale} label="Weight (kg)" value="12" i={1} />
      <ScreenCard icon={Award} title="Impact XP earned" note="Collected weight earns Impact XP, like a drop-off." i={2} tone="gold" />
    </div>,
  },
];

export function ResidentKitarWalkthrough() {
  return <Walkthrough title="How Kitar works" description="Recycle at a kiosk bin, claim a guest code, or book a collection." steps={RESIDENT} />;
}

// --- Staff, admins and HQ (Recycling collections) -------------------------------------------------

const CONSOLE: WalkStep[] = [
  {
    key: 'auto', icon: CalendarCheck, who: 'SimeTown', title: 'Most collections run by themselves',
    text: 'A booking is confirmed at once and the collector gets a gate pass for that day. The household is reminded the day before. Weights and disputes settle themselves; staff only watch for patterns.',
    screen: <div className="space-y-2.5"><ScreenTitle>Handled automatically</ScreenTitle>
      <ScreenRow label="Booking confirmed" i={0} tick />
      <ScreenRow label="Gate pass for the collector" i={1} tick />
      <ScreenRow label="Reminder the day before" i={2} tick />
    </div>,
  },
  {
    key: 'gate', icon: ShieldCheck, who: 'Guard', title: 'The gate scans the collector in',
    text: 'The collector shows their pass at the gate, like any contractor. That scan proves the visit happened. A collector visiting several homes that day only needs one pass scanned.',
    screen: <div className="space-y-3"><ScreenTitle>Main gate</ScreenTitle>
      <ScreenCard icon={Truck} title="Kitar Plus Recyclers" note="Contractor pass · scanned in" i={0} tone="success" />
    </div>,
  },
  {
    key: 'weights', icon: Scale, who: 'SimeTown', title: 'The gate record decides each weight',
    text: 'Collector scanned in that day, on any home’s pass: the weight is credited at once, counted up to a maximum per material (e-waste 100 kg, paper 50 kg). No gate record: the collection closes with no reward. Nobody approves it.',
    screen: <div className="space-y-2.5"><ScreenTitle>Weights</ScreenTitle>
      <ScreenRow label="12 kg, gate scanned" value="Credited" i={0} tick />
      <ScreenRow label="150 kg of e-waste" value="Counts as 100 kg" i={1} tick />
      <ScreenRow label="8 kg, no gate record" value="No reward" i={2} tone="alert" />
    </div>,
  },
  {
    key: 'night', icon: Moon, who: 'SimeTown', title: 'Every night, the rest is settled',
    text: 'A weight sent before the collector reached the gate is decided that night. A past collection with no gate scan and no weight is marked missed, and its pass is cancelled. The household is told each result.',
    screen: <div className="space-y-2.5"><ScreenTitle>Handled automatically</ScreenTitle>
      <ScreenRow label="Weight sent. Checked against the gate record tonight" i={0} tick />
      <ScreenRow label="Missed. The collector did not come" i={1} tick />
    </div>,
  },
  {
    key: 'missed', icon: Flag, who: 'Household', title: 'Disputes settle themselves too',
    text: 'On a missed collection, the household taps The collector came within 7 days and sends the weight. If the gate saw the collector that day for another home, it is credited. If not, it stays missed.',
    screen: <div className="space-y-3"><ScreenTitle>The collector came</ScreenTitle>
      <ScreenRow icon={ShieldCheck} label="Collector at the gate that day" value="Credited" i={0} tick />
      <ScreenRow icon={Flag} label="No gate record" value="Stays missed" i={1} tone="alert" />
    </div>,
  },
  {
    key: 'watch', icon: Pause, who: 'Staff', title: 'To watch: homes and collectors',
    text: 'A home that keeps sending large weights or hitting its limits, or a collector who keeps missing visits, is flagged after 3 times in 30 days. Contact them, or Pause collector until it is sorted.',
    screen: <div className="space-y-3"><ScreenTitle>To watch</ScreenTitle>
      <ScreenCard icon={Truck} title="Missed 3 collections" note="Minyak Hijau Collectors · last 30 days" i={0} tone="alert" />
      <ScreenButton i={1}>Pause collector</ScreenButton>
    </div>,
  },
  {
    key: 'collectors', icon: UserRound, who: 'Staff, admins and HQ', title: 'Collectors and their day',
    text: 'Admins add a collector with what they take and which days they come. Today’s collections gives each collector a list to Copy or Print. Material accepted shows the kilograms each month, and why bins turned items away.',
    screen: <div className="space-y-3"><ScreenTitle>Collectors</ScreenTitle>
      <ScreenRow icon={Truck} label="Kitar Plus Recyclers" value="Live" i={0} tick />
      <ScreenRow icon={ClipboardList} label="Today’s collections" value="Print" i={1} />
      <ScreenStats items={[{ label: 'Collected from homes this month', value: '86 kg' }]} i={2} />
    </div>,
  },
];

export function ConsoleCollectionsWalkthrough() {
  return <Walkthrough title="How recycling collections work" description="What runs by itself, and what needs you." steps={CONSOLE} />;
}
