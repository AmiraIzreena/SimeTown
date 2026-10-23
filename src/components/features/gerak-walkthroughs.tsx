'use client';

import {
  Award, Bike, Coins, EyeOff, Footprints, Gauge, LocateFixed, Lock, MapPin, Printer, QrCode, Recycle, Route, ShieldCheck, Trophy, Wifi,
} from 'lucide-react';
import { ScreenButton, ScreenCard, ScreenRow, ScreenStats, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Gerak works for residents (tracked trips, checkpoint posters, loops and challenges), and how staff run the
 * places behind Kitar, Gerak and the guards' rounds. Pictures only. The rules are the server's own: tracking checks
 * every batch on the server (BR24, gerak/tracking.ts), a loop is complete when every checkpoint is ticked the same day,
 * and only admins and HQ show or hide a loop. XP and points follow the activity rules and stay inside the person's and
 * home's limits (BR6). The demo loop is the township's Eco Lake Loop.
 */

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'pick', icon: Route, who: 'You', title: 'Pick a township loop',
    text: 'The Loops tab lists every walking and cycling loop, with its checkpoints in order and how often you have finished it. Tap Directions to start to get there.',
    screen: <div className="space-y-2.5"><ScreenTitle>Township loops</ScreenTitle>
      <ScreenCard icon={Route} title="Eco Lake Loop" note="Walking · 2 checkpoints" value="0.6 km" i={0} />
      <ScreenRow icon={MapPin} label="Elmina Urban Park" i={1} />
      <ScreenRow icon={MapPin} label="Eco Lake, mall side" i={2} />
    </div>,
  },
  {
    key: 'start', icon: LocateFixed, who: 'You', title: 'Tap Start on the Track tab',
    text: 'Choose walk, run, cycle or wheelchair, and follow your trip on the map. Your location is read only between Start and Finish.',
    screen: <div className="space-y-3"><ScreenTitle chip="Live">Track</ScreenTitle>
      <ScreenStats items={[{ label: 'Distance', value: '0.3 km' }, { label: 'Checkpoints today', value: '1 of 2' }]} />
      <ScreenRow icon={Footprints} label="Walk" i={2} tick />
    </div>,
  },
  {
    key: 'pass', icon: QrCode, who: 'You', title: 'Pass each checkpoint',
    text: 'A checkpoint ticks itself as you go past it. If GPS is weak, scan the QR poster at the post, or type the code printed under it. Each checkpoint counts once a day.',
    screen: <div className="space-y-2.5"><ScreenTitle>Checkpoints today</ScreenTitle>
      <ScreenRow icon={MapPin} label="Elmina Urban Park" value="Ticked" i={0} tick />
      <ScreenRow icon={QrCode} label="Eco Lake, mall side" value="Poster scanned" i={1} tick />
    </div>,
  },
  {
    key: 'fair', icon: Gauge, who: 'SimeTown', title: 'Fair play is checked on the server',
    text: 'A poor GPS fix is ignored, and any part of a trip faster than the activity allows does not count, so a car or motorbike ride never earns. A trip counts once it has 200 m of fair-play distance.',
    screen: <div className="space-y-2.5"><ScreenTitle>Fair play</ScreenTitle>
      <ScreenRow icon={Footprints} label="Walking pace" value="Counts" i={0} tick />
      <ScreenRow icon={Bike} label="Too fast for the activity" value="Not counted" i={1} tone="alert" />
      <ScreenRow icon={Wifi} label="Weak GPS fix" value="Ignored" i={2} />
    </div>,
  },
  {
    key: 'finish', icon: Award, who: 'You', title: 'Tap Finish and see what you earned',
    text: 'Finish every checkpoint of a loop on the same day and the loop is complete. A trip, each checkpoint and each finished loop earn Impact XP, and tracked trips can also earn points, within your and your home’s limits.',
    screen: <div className="space-y-3"><ScreenTitle>Trip finished</ScreenTitle>
      <ScreenCard icon={Route} title="Eco Lake Loop complete" note="Every checkpoint ticked today" i={0} tone="success" />
      <ScreenCard icon={Award} title="+40 Impact XP" note="For the finished loop" i={1} tone="gold" />
      <ScreenCard icon={Coins} title="Points" note="For a tracked trip, within your home’s monthly limit" i={2} />
    </div>,
  },
  {
    key: 'challenges', icon: Trophy, who: 'You', title: 'Challenges count by themselves',
    text: 'You never join a challenge. Every challenge that is running counts your activity, so one walk can move several. Each card says whether part-loops count, or only whole loops.',
    screen: <div className="space-y-3"><ScreenTitle>Challenges</ScreenTitle>
      <ScreenCard icon={Trophy} title="Loop Finisher Challenge" note="Whole loops only" i={0} tone="gold" />
      <ScreenStats items={[{ label: 'Distance this month', value: '4.2 km' }, { label: 'Loops this month', value: '3' }]} i={1} />
    </div>,
  },
  {
    key: 'privacy', icon: Lock, who: 'You', title: 'Your location stays private',
    text: 'On Finish, the first and last 200 m of your route, usually near home, are cut and never stored, and the whole route is deleted after 30 days. Scanning a poster sends no location at all.',
    screen: <div className="space-y-2.5"><ScreenTitle>Your location and privacy</ScreenTitle>
      <ScreenRow icon={LocateFixed} label="Read only between Start and Finish" i={0} tick />
      <ScreenRow icon={EyeOff} label="First and last 200 m never stored" i={1} tick />
      <ScreenRow icon={Lock} label="Route deleted after 30 days" i={2} tick />
    </div>,
  },
];

export function ResidentGerakWalkthrough() {
  return <Walkthrough title="How Gerak works" description="Walk, run, cycle or wheel a township loop, and what it earns." steps={RESIDENT} />;
}

// --- Staff, admins and HQ (Kiosks, trails & patrol points) ----------------------------------------

const CONSOLE: WalkStep[] = [
  {
    key: 'three', icon: MapPin, who: 'Staff, admins and HQ', title: 'Three kinds of places, one page',
    text: 'Kitar recycling kiosks and their bins, Gerak walking and cycling loops, and the guards’ patrol points. Each has a printed code that proves someone was there.',
    screen: <div className="space-y-2.5"><ScreenTitle>Places</ScreenTitle>
      <ScreenRow icon={Recycle} label="Kitar · Recycling kiosks" i={0} />
      <ScreenRow icon={Route} label="Gerak · Loops" i={1} />
      <ScreenRow icon={ShieldCheck} label="Guards · Patrol points" i={2} />
    </div>,
  },
  {
    key: 'kiosks', icon: Recycle, who: 'Admins and HQ', title: 'Kiosks, then bins with a scale',
    text: 'An admin adds a kiosk, then puts a bin at it. The bin’s signing key is made on the server and never shown. Each bin shows whether it is online, full or offline, and today’s use.',
    screen: <div className="space-y-2.5"><ScreenTitle>Kitar · Kiosk bins</ScreenTitle>
      <ScreenRow icon={Recycle} label="Kiosk Elmina Valley" value="Online" i={0} tick />
      <ScreenRow icon={Recycle} label="Kiosk Elmina Gardens" value="Bin full" i={1} tone="gold" />
    </div>,
  },
  {
    key: 'loop', icon: Route, who: 'Staff', title: 'New loop: name, distance, checkpoints',
    text: 'Create a walking or cycling loop with 2 to 12 checkpoints, one per line, in order. It appears on the Gerak page for every resident at once. Then print a poster for each checkpoint.',
    screen: <div className="space-y-2.5"><ScreenTitle>New loop</ScreenTitle>
      <ScreenRow label="Name" value="Eco Lake Loop" i={0} />
      <ScreenRow label="Distance (km)" value="0.6" i={1} />
      <ScreenRow label="Checkpoints, one per line, in order" value="2" i={2} />
      <ScreenButton i={3}>Create loop</ScreenButton>
    </div>,
  },
  {
    key: 'posters', icon: Printer, who: 'Staff', title: 'Print posters and check the map',
    text: 'Print poster gives each checkpoint its QR code, which opens the Gerak page. View on map shows the loop’s route and checkpoints. Until a route is drawn, only its posters work.',
    screen: <div className="space-y-3"><ScreenTitle>Eco Lake Loop</ScreenTitle>
      <ScreenRow icon={Printer} label="Elmina Urban Park" value="Print poster" i={0} />
      <ScreenRow icon={MapPin} label="Route on the map" value="View on map" i={1} tick />
    </div>,
  },
  {
    key: 'hide', icon: EyeOff, who: 'Admins and HQ', title: 'Hide or show a loop, with a reason',
    text: 'Hide from residents takes a loop off Gerak at once: its posters stop working and trips no longer count it, but what residents already earned stays. The reason is kept in the audit log with your name.',
    screen: <div className="space-y-3"><ScreenTitle>Hide this loop from residents?</ScreenTitle>
      <ScreenRow label="Reason" value="Path flooded" i={0} />
      <ScreenButton i={1}>Hide from residents</ScreenButton>
    </div>,
  },
  {
    key: 'patrol', icon: ShieldCheck, who: 'Guards', title: 'Patrol points for security rounds',
    text: 'Print a poster for each patrol point and put it up on site. Guards scan them on their security rounds. Residents never see these, and they earn no points or XP.',
    screen: <div className="space-y-2.5"><ScreenTitle>Guards · Patrol points</ScreenTitle>
      <ScreenRow icon={ShieldCheck} label="Main gate" value="Print poster" i={0} />
      <ScreenRow icon={ShieldCheck} label="Community hall" value="Print poster" i={1} />
      <ScreenRow icon={ShieldCheck} label="Elmina Gardens back lane" value="Print poster" i={2} />
    </div>,
  },
];

export function ConsolePlacesWalkthrough() {
  return <Walkthrough title="How places work" description="Kiosks, loops and patrol points, and who sets them up." steps={CONSOLE} />;
}
