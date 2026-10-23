'use client';

import { Text } from '@/components/ui/localized-text';
import {
  AlertTriangle, BarChart3, Bell, BookOpen, Box, CalendarClock, CheckCircle2, ClipboardList, DoorOpen, Flag, History, IdCard, KeyRound,
  LayoutDashboard, Mail, MessageSquareText, PackageCheck, PackagePlus, PhoneCall, ScanLine, Search, Settings2, ShieldCheck, Store, Truck, Undo2, Warehouse,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ScreenButton, ScreenCard, ScreenRow, ScreenStats, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Parcels works, for each role that uses it: residents, guardhouse staff, couriers, and staff, admins and HQ in the
 * console. Pictures only: the names are the demo township's, and every rule shown is the one the app applies.
 */

/** A small locker bank. One door is the household's: it glows, and opens when `open` is set. */
function LockerBank({ open = false, parcel = true, label = 'A07' }: { open?: boolean; parcel?: boolean; label?: string }) {
  const doors = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className="hiw-row rounded-2xl bg-[#F2F6F3] p-2.5 shadow-xl" style={{ '--i': 0 } as CSSProperties}>
      <div className="mb-2 h-2 rounded-full bg-[#dbe0e0]" />
      <div className="grid grid-cols-4 gap-1.5">
        {doors.map((d) => d === 6 ? (
          <div key={d} className="walk-glow relative h-11 rounded-md bg-brand-100 ring-2 ring-gold-300">
            {parcel && <span className="walk-drop absolute inset-x-2 bottom-1.5 top-3 rounded-sm bg-gold-500/80" aria-hidden />}
            <span className={cn('absolute inset-0 grid place-items-center rounded-md bg-brand-600 text-[10px] font-bold text-white', open && 'walk-door')}>{label}</span>
          </div>
        ) : (
          <div key={d} className="h-11 rounded-md bg-white shadow-[inset_0_0_0_1px_#dbe0e0]">
            <span className="mx-auto mt-4 block h-1 w-3 rounded-full bg-[#cfd6d6]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A big code, as the resident sees it. */
function CodeBox({ code, label, i = 1 }: { code: string; label: string; i?: number }) {
  return (
    <div className="hiw-row rounded-2xl bg-white p-4 text-center text-ink-900 shadow-xl" style={{ '--i': i } as CSSProperties}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500"><Text>{label}</Text></p>
      <p className="mt-1 font-display text-3xl font-bold tracking-[0.2em]">{code}</p>
    </div>
  );
}

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'door', icon: DoorOpen, who: 'Courier', title: 'Your parcel goes into your own door',
    text: 'Every home has its own private door in the locker beside your guardhouse. The courier scans the label and your door opens for them. Nobody else can use it.',
    screen: <div className="space-y-3"><ScreenTitle chip="Delivered">Elmina Valley Locker A</ScreenTitle><LockerBank /><ScreenRow icon={Truck} label="J&T Express" value="Door A07" i={1} tick /></div>,
  },
  {
    key: 'told', icon: Bell, who: 'SimeTown', title: 'You are told straight away',
    text: 'You get a notification in the app, and an email if you have them on. It says which door, never the code, so only you can open it.',
    screen: <div className="space-y-3"><ScreenTitle>Notifications</ScreenTitle>
      <ScreenCard icon={Bell} title="Your parcel is ready in your locker" note="Elmina Valley Locker A · door A07" i={0} />
      <ScreenCard icon={Mail} title="Email: Your parcel is ready" note="Sent to your account’s email" i={1} tone="gold" />
    </div>,
  },
  {
    key: 'code', icon: KeyRound, who: 'You', title: 'Open Parcels and use your code',
    text: 'Each parcel has a one-time code. At the locker, tap Open my door, or type the PIN on the keypad. Someone collecting for you? Share the code with them.',
    screen: <div className="space-y-3"><ScreenTitle>Parcels · Parcel lockers</ScreenTitle><CodeBox code="141 686" label="Locker PIN" i={0} /><ScreenButton i={1}>Open my door</ScreenButton></div>,
  },
  {
    key: 'take', icon: PackageCheck, who: 'You', title: 'Take it and shut the door',
    text: 'The door opens. Take your parcel and close the door. The code stops working, and the door is ready for your next parcel.',
    screen: <div className="space-y-3"><ScreenTitle chip="Door open">Door A07</ScreenTitle><LockerBank open /><ScreenRow icon={CheckCircle2} label="Collected" value="Just now" i={1} tick /></div>,
  },
  {
    key: 'guardhouse', icon: Warehouse, who: 'If it does not fit', title: 'Too big? It waits at the guardhouse',
    text: 'If a parcel does not fit your door, the courier gives it to the guard. Show your code to the guard during opening hours. It is never sent back for waiting, and there are no fees.',
    screen: <div className="space-y-3"><ScreenTitle chip="Open now">Main guardhouse</ScreenTitle>
      <ScreenRow icon={CalendarClock} label="Open daily" value="8:00 am – 10:00 pm" i={0} />
      <ScreenRow icon={Box} label="Your parcel" value="2 days uncollected" i={1} />
      <CodeBox code="605 721" label="Show to the guard" i={2} />
    </div>,
  },
  {
    key: 'reminders', icon: CalendarClock, who: 'SimeTown', title: 'Gentle reminders if you forget',
    text: 'In your door: a reminder after 2 days, then weekly. At the guardhouse: overdue after 7 days, a weekly reminder, and the guard calls you at 14 days.',
    screen: <div className="space-y-3"><ScreenTitle>Reminders</ScreenTitle>
      <ScreenRow icon={DoorOpen} label="In your door" value="2 days, then weekly" i={0} />
      <ScreenRow icon={Warehouse} label="At the guardhouse" value="Overdue at 7 days" i={1} />
      <ScreenRow icon={PhoneCall} label="The guard calls you" value="At 14 days" i={2} tone="gold" />
    </div>,
  },
];

export function ResidentParcelWalkthrough() {
  return <Walkthrough title="How Parcels works" description="Where your parcels go, and how to collect them." steps={RESIDENT} />;
}

// --- Guards ---------------------------------------------------------------------------------------

const GUARD: WalkStep[] = [
  {
    key: 'log', icon: PackagePlus, who: 'Guardhouse staff', title: 'A courier leaves a parcel with you',
    text: 'Choose the house, the courier and the shelf, and take a photo. The household is told at once and gets a collection code.',
    screen: <div className="space-y-3"><ScreenTitle>Log a parcel</ScreenTitle>
      <ScreenRow label="House" value="No. 5, Jalan Metafasa" i={0} />
      <ScreenRow label="Courier" value="Shopee Express" i={1} />
      <ScreenRow label="Shelf" value="B3" i={2} />
      <ScreenButton i={3}>Log parcel</ScreenButton>
    </div>,
  },
  {
    key: 'dropoff', icon: Truck, who: 'Guardhouse staff', title: 'A courier brings a locker parcel',
    text: 'Parcels too big for a home’s door come to you. Check the parcel and tap Confirm receipt, so the household knows it is here.',
    screen: <div className="space-y-3"><ScreenTitle>Couriers bringing parcels</ScreenTitle>
      <ScreenCard icon={Truck} title="J&T Express · JT208F96D0E7" note="Too big for door A02 · No. 1, Jalan Metafasa" i={0} />
      <ScreenButton i={1}>Confirm receipt</ScreenButton>
    </div>,
  },
  {
    key: 'handover', icon: ScanLine, who: 'Guardhouse staff', title: 'Hand over against the code',
    text: 'The resident shows a code or QR. Scan it or type it in Check code. It works for every parcel at the guardhouse. For locker parcels, check their ID too.',
    screen: <div className="space-y-3"><ScreenTitle>Hand over a parcel</ScreenTitle>
      <CodeBox code="605 721" label="Code" i={0} />
      <ScreenRow icon={CheckCircle2} label="Match: Shopee Express · shelf B3" i={1} tick />
      <ScreenRow icon={IdCard} label="ID checked" i={2} tick />
      <ScreenButton tone="success" i={3}>Hand over</ScreenButton>
    </div>,
  },
  {
    key: 'call', icon: PhoneCall, who: 'Guardhouse staff', title: 'Call when a parcel waits 14 days',
    text: 'The register marks Call due. Call the household, then add a note so everyone knows. Parcels are never sent back just for waiting.',
    screen: <div className="space-y-3"><ScreenTitle>Guardhouse register</ScreenTitle>
      <ScreenCard icon={PhoneCall} title="Call due · 15 days" note="SHOW0003 · No. 5, Jalan Metafasa" i={0} tone="alert" />
      <ScreenRow icon={MessageSquareText} label="Called, no answer. Left a message." i={1} tick />
    </div>,
  },
  {
    key: 'register', icon: ClipboardList, who: 'Guardhouse staff', title: 'Every parcel in one register',
    text: 'Search by tracking number, house or courier, and filter by status. Open any parcel to see its whole history: when it came, reminders, calls and who collected it.',
    screen: <div className="space-y-3"><ScreenTitle>Guardhouse register</ScreenTitle>
      <ScreenStats items={[{ label: 'Held now', value: '13' }, { label: 'Overdue', value: '4', tone: 'warn' }, { label: 'Calls', value: '2', tone: 'alert' }]} />
      <ScreenRow icon={Search} label="Search: tracking, house, courier" i={3} />
      <ScreenRow icon={History} label="History for each parcel" i={4} tick />
    </div>,
  },
];

export function GuardParcelWalkthrough() {
  return <Walkthrough title="How the guardhouse works" description="Logging, handing over and following up on every parcel kept here." steps={GUARD} />;
}

// --- Couriers -------------------------------------------------------------------------------------

const COURIER: WalkStep[] = [
  {
    key: 'scan', icon: ScanLine, who: 'Courier', title: 'Scan the parcel at the locker',
    text: 'Choose the station, scan the label and tap Check shipment. Your company and SimeTown check the shipment and the home. You only see a masked name.',
    screen: <div className="space-y-3"><ScreenTitle>Deliver to a locker</ScreenTitle>
      <ScreenRow icon={ScanLine} label="JT208F96D0E7" i={0} />
      <ScreenRow icon={ShieldCheck} label="Shipment checked" value="J&T Express" i={1} tick />
      <ScreenRow icon={CheckCircle2} label="Recipient" value="A**** R*****" i={2} tick />
    </div>,
  },
  {
    key: 'door', icon: DoorOpen, who: 'Courier', title: 'The home’s own door opens',
    text: 'Tap Open the door. The household’s private door opens by itself. Put the parcel in and shut the door. The household is told at once.',
    screen: <div className="space-y-3"><ScreenTitle chip="Door open">Door A07</ScreenTitle><LockerBank open parcel={false} /><ScreenButton i={1}>Shut the door with the parcel inside</ScreenButton></div>,
  },
  {
    key: 'nofit', icon: AlertTriangle, who: 'Courier', title: 'Will not fit? Say why',
    text: 'Choose a reason, such as too big or the door already has a parcel, or write your own. The door is freed and the app shows where to take it.',
    screen: <div className="space-y-3"><ScreenTitle>It will not go into this door</ScreenTitle>
      <ScreenRow label="Too big for the door" i={0} tick />
      <ScreenRow label="The door already has a parcel" i={1} />
      <ScreenRow label="Other: write your own" i={2} />
    </div>,
  },
  {
    key: 'guard', icon: Warehouse, who: 'Courier', title: 'Hand it to the guard',
    text: 'Take it to the guardhouse while it is open and tap I am at the guardhouse. The guard confirms receipt. After 10 pm, keep it for your next round.',
    screen: <div className="space-y-3"><ScreenTitle chip="Open now">Main guardhouse</ScreenTitle>
      <ScreenRow icon={CalendarClock} label="Open daily" value="8:00 am – 10:00 pm" i={0} />
      <ScreenCard icon={CheckCircle2} title="Received by the guard" note="The household is told where it is" i={1} tone="success" />
    </div>,
  },
];

export function CourierParcelWalkthrough() {
  return <Walkthrough title="How locker delivery works" description="From scanning the label to a closed door, or the guardhouse." steps={COURIER} />;
}

// --- Staff, admins and HQ (console) ---------------------------------------------------------------

const CONSOLE: WalkStep[] = [
  {
    key: 'today', icon: LayoutDashboard, who: 'Staff, admins and HQ', title: 'Today: what needs action now',
    text: 'Calls to make come first, then couriers bringing parcels, overdue parcels and doors to check. Open any item to deal with it.',
    screen: <div className="space-y-3"><ScreenTitle chip="Live">Needs action now</ScreenTitle>
      <ScreenCard icon={PhoneCall} title="Call the household · 15 days" note="No. 5, Jalan Metafasa" i={0} tone="alert" />
      <ScreenCard icon={Truck} title="Courier bringing a parcel" note="J&T Express · to the guardhouse" i={1} />
      <ScreenCard icon={CalendarClock} title="Overdue at the guardhouse · 8 days" note="No. 3, Jalan Frekuensi" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'guardhouse', icon: Warehouse, who: 'Staff, admins and HQ', title: 'Guardhouse: every parcel held there',
    text: 'The figures on top, then the register with search, filters and each parcel’s history. Staff and admins can hand over and add notes; HQ can see everything.',
    screen: <div className="space-y-3"><ScreenTitle>Guardhouse</ScreenTitle>
      <ScreenStats items={[{ label: 'Held now', value: '13' }, { label: 'Overdue', value: '4', tone: 'warn' }, { label: 'Calls', value: '2', tone: 'alert' }]} />
      <ScreenRow icon={Search} label="Search and filter the register" i={3} />
      <ScreenRow icon={History} label="Open a parcel to see its history" i={4} tick />
    </div>,
  },
  {
    key: 'lockers', icon: DoorOpen, who: 'Staff and admins', title: 'Smart lockers: parcels and door access',
    text: 'See every locker parcel and its record. A door holding a parcel only opens for staff with a second admin’s approval, and every opening is logged.',
    screen: <div className="space-y-3"><ScreenTitle>Door access</ScreenTitle>
      <ScreenCard icon={ShieldCheck} title="Second admin approval" note="Needed before any staff opening" i={0} tone="gold" />
      <ScreenRow icon={Truck} label="Courier delivery · A07" value="Opened" i={1} />
      <ScreenRow icon={PackageCheck} label="Resident collection · A07" value="Opened" i={2} />
    </div>,
  },
  {
    key: 'performance', icon: BarChart3, who: 'Staff, admins and HQ', title: 'Performance: how each locker is doing',
    text: 'Every locker bank and the guardhouse: doors in use, how long parcels wait, collections and failed deliveries over the last weeks.',
    screen: <div className="space-y-3"><ScreenTitle>Performance</ScreenTitle>
      <ScreenRow icon={Store} label="Elmina Valley Locker A" value="17% in use" i={0} />
      <ScreenRow icon={Store} label="Elmina Gardens Locker B" value="13% in use" i={1} />
      <ScreenRow icon={Store} label="Elmina West Locker C" value="17% in use" i={2} />
      <div className="hiw-row h-2 overflow-hidden rounded-full bg-white/10" style={{ '--i': 3 } as CSSProperties}><span className="hiw-bar block h-full w-[62%] rounded-full bg-gradient-to-r from-gold-300 to-brand-400" /></div>
    </div>,
  },
  {
    key: 'cases', icon: Flag, who: 'Staff, admins and HQ', title: 'Problems become cases in Lapor',
    text: 'A disputed handover, a door that will not open or a courier problem is a case in Lapor › Parcel & locker cases, with deadlines and its full history.',
    screen: <div className="space-y-3"><ScreenTitle>Lapor · Parcel & locker cases</ScreenTitle>
      <ScreenCard icon={Flag} title="Locker door will not open" note="INC-000002 · Critical" i={0} tone="alert" />
      <ScreenRow icon={Undo2} label="Taken by staff · being investigated" i={1} tick />
    </div>,
  },
  {
    key: 'manage', icon: Settings2, who: 'Admins only', title: 'Manage: doors, guardhouses and rules',
    text: 'Admins see which home has which door, set the guardhouse’s opening hours and room, approve couriers and set the reminder timings.',
    screen: <div className="space-y-3"><ScreenTitle>Manage</ScreenTitle>
      <ScreenRow icon={DoorOpen} label="Doors: one per home" i={0} tick />
      <ScreenRow icon={Warehouse} label="Guardhouse hours and room" i={1} tick />
      <ScreenRow icon={BookOpen} label="Locker policy: reminders" i={2} tick />
    </div>,
  },
];

export function ConsoleParcelWalkthrough() {
  return <Walkthrough title="How Parcels works in the console" description="The tabs, what each is for, and who can do what." steps={CONSOLE} />;
}
