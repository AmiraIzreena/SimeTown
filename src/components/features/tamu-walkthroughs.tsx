'use client';

import {
  BadgeCheck, Bell, CircleX, KeyRound, Clock, DoorOpen, EyeOff, IdCard, Link2, Lock, LogOut, Mail, MessageCircle, Navigation, PhoneCall, QrCode, Route,
  ScanLine, ShieldCheck, Siren, Timer, Truck, UserPlus, UserRound,
} from 'lucide-react';
import { ScreenButton, ScreenCard, ScreenRow, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Tamu works for residents (visitor passes, visitor details, walk-ins and SOS), and how the guard runs the main
 * gate. Pictures only. The rules are the server's own (tamu/service.ts, tamu/visitor-data.ts): each kind of pass has a
 * longest length and one-entry kinds close after the first scan; every visit records citizenship, identity number,
 * transport and reason (BR26, revised), given by the resident, by the visitor on their link, or by the guard at the
 * gate; an expired driving licence blocks entry by vehicle; the number is encrypted, shown in full only to the guard
 * and never emailed; "Not expected" informs and never blocks lawful access; records are deleted after 90 days and
 * Tamu gives no points or XP (BR27). The ID numbers shown are made up (birthplace code 00 is never issued).
 */

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'create', icon: DoorOpen, who: 'You', title: 'Create a visitor pass',
    text: 'Choose the kind of visit, then your visitor’s name, how they travel and the reason for the visit. A car or motorcycle needs its number. Each kind of pass has its own longest length: a delivery lasts a day, a contractor up to 30 days.',
    screen: <div className="space-y-2.5"><ScreenTitle>New visitor pass</ScreenTitle>
      <ScreenRow label="Kind of visit" value="One visit" i={0} />
      <ScreenRow icon={UserRound} label="Visitor name" value="Puan Rahmah" i={1} />
      <ScreenRow label="Transport" value="Car · BKL 2408" i={2} />
      <ScreenRow label="Reason for the visit" value="Visiting family" i={3} />
    </div>,
  },
  {
    key: 'identity', icon: IdCard, who: 'You', title: 'Their identity: from you, or from them',
    text: 'The gate also needs your visitor’s citizenship and identity number, and a driver’s licence expiry. Enter them now, with your visitor’s permission, or let your visitor give them on their pass link. Your home only ever sees the last 4 characters.',
    screen: <div className="space-y-2.5"><ScreenTitle>Visitor’s IC or passport</ScreenTitle>
      <ScreenRow label="Who fills it in?" value="I’ll fill it in now" i={0} />
      <ScreenRow icon={IdCard} label="Malaysian citizen" value="•••• 5122" i={1} />
      <ScreenRow icon={BadgeCheck} label="Driving licence expiry" value="Valid" i={2} tick />
      <ScreenButton i={3}>Create pass</ScreenButton>
    </div>,
  },
  {
    key: 'send', icon: Mail, who: 'You', title: 'SimeTown emails your visitor the pass',
    text: 'Add your visitor’s email and SimeTown emails them the pass: a link with its QR code. Your visitor needs no app and no account. No email? Tell them the pass code: the guard can type it at the gate. Send again makes a new link, emailed to your visitor, and the old one stops working.',
    screen: <div className="space-y-2.5"><ScreenTitle>Pass for Puan Rahmah</ScreenTitle>
      <ScreenCard icon={QrCode} title="PAB12CD3" note="The code printed under the QR code" i={0} />
      <ScreenRow icon={Mail} label="SimeTown has emailed the pass" i={1} tick />
      <ScreenRow icon={KeyRound} label="No email? Tell them the pass code" i={2} />
      <ScreenRow icon={Link2} label="Send again makes a new link" i={3} />
    </div>,
  },
  {
    key: 'visitor', icon: Navigation, who: 'Your visitor', title: 'Your visitor opens the link',
    text: 'They see the QR code to show the guard and directions to the main gate. If you left their identity to them, a short form asks for it, sent only with their agreement. Only your street is shown, never your house number or your name.',
    screen: <div className="space-y-2.5"><ScreenTitle chip="Valid now">Visitor pass</ScreenTitle>
      <ScreenRow icon={IdCard} label="Before you come: your details for the gate" i={0} tick />
      <ScreenRow icon={Navigation} label="Open in Waze" i={1} tick />
      <ScreenRow icon={EyeOff} label="House number and host’s name hidden" i={2} tick />
    </div>,
  },
  {
    key: 'arrive', icon: Bell, who: 'You', title: 'You are told the moment they arrive',
    text: 'The guard scans the QR code at the main gate and checks their identity card. You get a notification and an email saying who came, how and why, never their identity number. A one-visit or delivery pass then closes by itself.',
    screen: <div className="space-y-2.5"><ScreenTitle>Notifications</ScreenTitle>
      <ScreenCard icon={Bell} title="Puan Rahmah arrived at 3:05 pm" note="Scanned in at the main gate." i={0} tone="success" />
      <ScreenRow icon={Mail} label="Email: Your visitor has arrived" i={1} tick />
      <ScreenRow icon={Lock} label="Identity number never emailed" i={2} />
    </div>,
  },
  {
    key: 'walkin', icon: UserPlus, who: 'You', title: 'Someone came without a pass? You are asked',
    text: 'The guard records their details and your home is asked straight away, in the app and by email. Tap Expected, Not expected or Call me; the first answer from your home is the one the guard sees. Not expected tells the guard. It never blocks lawful access on a public road.',
    screen: <div className="space-y-2.5"><ScreenTitle>Someone is at the main gate</ScreenTitle>
      <ScreenCard icon={UserRound} title="Encik Hafiz" note="Motorcycle · Delivery. Are you expecting them?" i={0} tone="gold" />
      <ScreenButton i={1} tone="success">Expected</ScreenButton>
      <ScreenRow label="Not expected · Call me" i={2} />
    </div>,
  },
  {
    key: 'sos', icon: Siren, who: 'You', title: 'SOS reaches the guardhouse at once',
    text: 'SOS to the guardhouse tells the guards and the township team your address straight away, and you are told when a guard is on the way. Pressing it again sends nothing more. In a medical emergency, also call 999.',
    screen: <div className="space-y-2.5"><ScreenTitle>SOS to the guardhouse</ScreenTitle>
      <ScreenCard icon={Siren} title="Sent to the guardhouse" note="Guards and the township team" i={0} tone="alert" />
      <ScreenCard icon={ShieldCheck} title="The guardhouse is on its way" note="A guard has seen your SOS." i={1} tone="success" />
    </div>,
  },
  {
    key: 'privacy', icon: ShieldCheck, who: 'SimeTown', title: 'Only what the gate needs, and not for long',
    text: 'A visit keeps the visitor’s name, citizenship, identity number, transport and reason. The number is stored encrypted and shown in full only to the guard. Guards never keep the card. Everything is deleted after 90 days. Tamu gives no points and no XP.',
    screen: <div className="space-y-2.5"><ScreenTitle>Visitor privacy</ScreenTitle>
      <ScreenRow icon={Lock} label="Number encrypted; your home sees the last 4" i={0} tick />
      <ScreenRow icon={IdCard} label="Guards never keep the card" i={1} tick />
      <ScreenRow icon={Timer} label="Deleted after 90 days" i={2} tick />
    </div>,
  },
];

export function ResidentTamuWalkthrough() {
  return <Walkthrough title="How Tamu works" description="Visitor passes, visitor details, walk-ins and SOS, from your phone to the main gate." steps={RESIDENT} />;
}

// --- The guard at the main gate --------------------------------------------------------------------

const GUARD: WalkStep[] = [
  {
    key: 'scan', icon: ScanLine, who: 'Guard', title: 'Scan the visitor’s pass',
    text: 'Tap Scan with camera and point it at the QR code on the visitor’s phone. If the camera cannot read it, type the code printed under it and tap Check pass.',
    screen: <div className="space-y-2.5"><ScreenTitle>Scan a visitor pass</ScreenTitle>
      <ScreenRow icon={QrCode} label="Scan with camera" i={0} tick />
      <ScreenRow label="Pass code" value="PAB12CD3" i={1} />
      <ScreenButton i={2}>Check pass</ScreenButton>
    </div>,
  },
  {
    key: 'valid', icon: DoorOpen, who: 'Guard', title: 'Valid: check the card, then let them in',
    text: 'The screen shows who they are, the house and their details, with the full identity number. Compare it with their identity card and hand the card straight back. The host is told they arrived.',
    screen: <div className="space-y-2.5"><ScreenTitle>Scan a visitor pass</ScreenTitle>
      <ScreenCard icon={DoorOpen} title="Let in: Puan Rahmah" note="One visit · to No. 5, Jalan Metafasa" i={0} tone="success" />
      <ScreenRow icon={IdCard} label="Malaysian citizen" value="580412005122" i={1} />
      <ScreenRow icon={BadgeCheck} label="Car · BKL 2408" value="Licence valid" i={2} tick />
    </div>,
  },
  {
    key: 'missing', icon: IdCard, who: 'Guard', title: 'Details missing? Fill them in first',
    text: 'A pass SimeTown made for a collector or a worker, or one whose visitor did not add their identity, asks you for what is missing. Copy it from their identity card, then tap Let in. Nothing is recorded until then.',
    screen: <div className="space-y-2.5"><ScreenTitle>Details needed: Collector</ScreenTitle>
      <ScreenRow icon={IdCard} label="MyKad number" value="850315005521" i={0} />
      <ScreenRow icon={Truck} label="Lorry" value="BKL 7071" i={1} />
      <ScreenButton i={2}>Let in</ScreenButton>
    </div>,
  },
  {
    key: 'invalid', icon: CircleX, who: 'Guard', title: 'Not valid: the screen says why',
    text: 'A pass may be cancelled by the host, expired, already used or not valid yet. A driver whose licence has expired cannot be let in by vehicle until a valid licence date is entered. Log anyone else as a walk-in, so the household can answer.',
    screen: <div className="space-y-2.5"><ScreenTitle>Pass not valid</ScreenTitle>
      <ScreenRow icon={CircleX} label="This pass has already been used." i={0} tone="alert" />
      <ScreenRow icon={BadgeCheck} label="Driving licence expired" i={1} tone="alert" />
      <ScreenRow icon={Clock} label="This pass is not valid yet." i={2} />
    </div>,
  },
  {
    key: 'walkin', icon: UserPlus, who: 'Guard', title: 'No pass? Record their details and ask the household',
    text: 'From their identity card, record the name, citizenship and identity number, how they travel (with the vehicle number and licence expiry for drivers) and the reason, then choose the house and tap Ask the household. Everyone there with the app is asked, in the app and by email.',
    screen: <div className="space-y-2.5"><ScreenTitle>Walk-in visitor</ScreenTitle>
      <ScreenRow icon={UserRound} label="Visitor name" value="Encik Hafiz" i={0} />
      <ScreenRow icon={IdCard} label="MyKad number" value="990117007713" i={1} />
      <ScreenRow label="Motorcycle · Delivery" value="VBN 772" i={2} />
      <ScreenButton i={3}>Ask the household</ScreenButton>
    </div>,
  },
  {
    key: 'reply', icon: MessageCircle, who: 'Guard', title: 'The answer appears in the gate log',
    text: 'Expected, Not expected or Call the host shows beside the visitor, and you get a notification too. Not expected is for your information; it never blocks lawful access on a public road. Tap Left when a visitor goes.',
    screen: <div className="space-y-2.5"><ScreenTitle>Gate log, last 24 hours</ScreenTitle>
      <ScreenRow icon={UserRound} label="Encik Hafiz · Walk-in" value="Expected" i={0} tick />
      <ScreenRow icon={UserRound} label="Puan Rahmah · Pass" i={1} />
      <ScreenRow icon={LogOut} label="Left" i={2} />
    </div>,
  },
  {
    key: 'sos', icon: Siren, who: 'Guard', title: 'An SOS goes to the top of the screen',
    text: 'It shows the resident’s address and phone. Tap On my way and the resident is told a guard is coming. Tap Close once it is dealt with.',
    screen: <div className="space-y-2.5"><ScreenTitle chip="Live">SOS</ScreenTitle>
      <ScreenCard icon={Siren} title="SOS · No. 5, Jalan Metafasa" note="Just now · waiting" i={0} tone="alert" />
      <ScreenButton i={1}>On my way</ScreenButton>
      <ScreenRow icon={PhoneCall} label="Resident told: a guard is coming" i={2} tick />
    </div>,
  },
  {
    key: 'patrol', icon: Route, who: 'Guard', title: 'Check each point on the patrol round',
    text: 'Scan the poster at each patrol point with your phone camera: it opens the gate screen with the code filled in. Or type the code, then tap Check point. The round shows which points are checked today.',
    screen: <div className="space-y-2.5"><ScreenTitle>Patrol round</ScreenTitle>
      <ScreenRow icon={ShieldCheck} label="1. Main gate" value="Checked" i={0} tick />
      <ScreenRow icon={ShieldCheck} label="2. Community hall" value="Checked" i={1} tick />
      <ScreenRow icon={Route} label="3. Elmina Gardens back lane" value="Not yet today" i={2} />
    </div>,
  },
];

export function GuardGateWalkthrough() {
  return <Walkthrough title="How the gate works" label="How the gate works" description="Visitor passes and details, walk-ins, SOS calls and the patrol round." steps={GUARD} />;
}
