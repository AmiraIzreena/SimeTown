'use client';

import {
  Award, Bell, CalendarClock, Camera, CheckCircle2, ClipboardList, Clock, DoorOpen, Eye, Flag, Hand, Lightbulb, ListChecks, Lock, MapPin, MessageSquare,
  PlayCircle, Plus, RotateCcw, ShieldCheck, Siren, Sparkles, ThumbsUp, Timer, UserRound, Users, Waves,
} from 'lucide-react';
import { ScreenButton, ScreenCard, ScreenRow, ScreenStats, ScreenTitle, Walkthrough, type WalkStep } from './walkthrough';

/**
 * How Lapor works, for each role: residents reporting, staff handling reports and cases, and admins setting the
 * case deadlines. Pictures only. The rules are the server's own (reports service, BR19, BR21, the incident engine
 * and its deadline checks); the threshold, deadlines and reopening window are township settings, so the pictures
 * show the starting values.
 */

// --- Residents ------------------------------------------------------------------------------------

const RESIDENT: WalkStep[] = [
  {
    key: 'report', icon: Plus, who: 'You', title: 'Tap New report: say what and where',
    text: 'Describe the problem, say where it is (a street, landmark or nearest house) and add a photo of it. The area and the type are optional. If someone is in immediate danger, call 999 first.',
    screen: <div className="space-y-3"><ScreenTitle>New report</ScreenTitle>
      <ScreenRow icon={MessageSquare} label="Street light not working outside the playground" i={0} />
      <ScreenRow icon={MapPin} label="Jalan Metafasa U16/171" i={1} />
      <ScreenRow icon={Camera} label="Photo of the problem" i={2} tick />
      <ScreenButton i={3}>Send report</ScreenButton>
    </div>,
  },
  {
    key: 'sorted', icon: Sparkles, who: 'SimeTown', title: 'SimeTown suggests the type and urgency',
    text: 'Leave Type on Suggest for me, and SimeTown reads your words and photo to choose a type and urgency. Staff can correct either, and every correction is recorded. Urgent safety reports are seen first.',
    screen: <div className="space-y-3"><ScreenTitle>Report received</ScreenTitle>
      <ScreenCard icon={Sparkles} title="Sorted as Lighting" note="Medium urgency · Staff can correct this" i={0} />
      <ScreenRow icon={Siren} label="Urgent safety reports" value="Seen first" i={1} tone="gold" />
    </div>,
  },
  {
    key: 'metoo', icon: ThumbsUp, who: 'You', title: 'Already reported? Tap Me too',
    text: 'While you type, problems neighbours have already reported may appear. If one is the same, tap Me too instead of reporting it again: you count as affected and hear every update.',
    screen: <div className="space-y-3"><ScreenTitle>Already reported?</ScreenTitle>
      <ScreenCard icon={Lightbulb} title="Street light out near the playground" note="Lighting · 4 residents affected" i={0} tone="gold" />
      <ScreenButton i={1}>Me too</ScreenButton>
    </div>,
  },
  {
    key: 'follow', icon: ListChecks, who: 'You', title: 'Follow it until it is fixed',
    text: 'Your report moves through four steps: Reported, Checked by staff, Assigned to a team with a target date, then Fixed. You are told at each step. If it passes its target date, it shows as Late.',
    screen: <div className="space-y-2.5"><ScreenTitle>Your report</ScreenTitle>
      <ScreenRow label="Reported" i={0} tick />
      <ScreenRow label="Checked by staff" i={1} tick />
      <ScreenRow label="Assigned to Landscape contractor" i={2} tick />
      <ScreenRow icon={CalendarClock} label="Fixed" value="Target: 30 Oct" i={3} tone="gold" />
    </div>,
  },
  {
    key: 'neighbours', icon: Eye, who: 'Neighbours', title: 'Neighbours see it once enough people share it',
    text: 'At first, only you and the township office see your report. Once enough residents have reported it or said Me too, it appears in Reports around the township, with a title SimeTown writes and one report’s photo, never your words. Staff can hide a photo.',
    screen: <div className="space-y-3"><ScreenTitle>Reports around the township</ScreenTitle>
      <ScreenRow icon={Users} label="4 of 5 residents" i={0} />
      <ScreenCard icon={Eye} title="Neighbours can see this" note="Street light out near the playground · 5 people affected" i={1} tone="success" />
    </div>,
  },
  {
    key: 'xp', icon: Award, who: 'You', title: 'Earn Impact XP once staff confirm it',
    text: 'When staff mark your report In progress or Resolved, you earn Impact XP. Only the first reporter earns it, and Me too earns none, so a false report gains nothing.',
    screen: <div className="space-y-3"><ScreenTitle>Notifications</ScreenTitle>
      <ScreenCard icon={Bell} title="Your report is being worked on" note="Open Lapor to see the details." i={0} />
      <ScreenCard icon={Award} title="Impact XP" note="Report confirmed by staff" i={1} tone="gold" />
    </div>,
  },
  {
    key: 'tabs', icon: MessageSquare, who: 'You', title: 'Reports from other pages are here too',
    text: 'Problems you report from Parcels, Tamu, Kitar, Gerak or Home services each have their own tab. If the township office asks you something, the report shows Needs your answer: reply right there. Not fixed? Reopen it within 7 days of the outcome.',
    screen: <div className="space-y-3"><ScreenTitle>Parcel reports</ScreenTitle>
      <ScreenCard icon={MessageSquare} title="Needs your answer" note="INC-000123 · Which door did you use?" i={0} tone="gold" />
      <ScreenRow icon={RotateCcw} label="Not fixed? Reopen it" i={1} />
    </div>,
  },
];

export function ResidentLaporWalkthrough() {
  return <Walkthrough title="How Lapor works" description="Report a problem, follow it, and see what neighbours reported." steps={RESIDENT} />;
}

// --- Staff, admins and HQ (console Lapor) --------------------------------------------------------

const CONSOLE: WalkStep[] = [
  {
    key: 'attention', icon: Siren, who: 'Staff, admins and HQ', title: 'Needs attention: what matters most',
    text: 'Problems that enough residents share, and anything urgent. Urgent comes first, then late, then the most people affected. An urgent safety report also alerts staff at once, and HQ.',
    screen: <div className="space-y-3"><ScreenTitle>Needs attention</ScreenTitle>
      <ScreenCard icon={Siren} title="Fallen tree across Jalan Metafasa" note="Urgent · Safety hazard · 2 residents" i={0} tone="alert" />
      <ScreenCard icon={Waves} title="Blocked drain by the lake" note="6 residents · 4 reports" i={1} tone="gold" />
    </div>,
  },
  {
    key: 'issue', icon: ClipboardList, who: 'Staff', title: 'One update reaches every report',
    text: 'Open a problem to set its status, who is fixing it and a target date, with a note for residents. Tap Save for every report: everyone who reported it or said Me too is told.',
    screen: <div className="space-y-2.5"><ScreenTitle>Blocked drain by the lake</ScreenTitle>
      <ScreenRow label="Status" value="In progress" i={0} />
      <ScreenRow label="Who is fixing it" value="Drainage contractor" i={1} />
      <ScreenRow icon={CalendarClock} label="Target date" value="30 Oct" i={2} />
      <ScreenButton i={3}>Save for every report</ScreenButton>
    </div>,
  },
  {
    key: 'ai', icon: Sparkles, who: 'Staff', title: 'Check what SimeTown suggested',
    text: 'In Community reports, each report shows the type and urgency SimeTown suggested. If either is wrong, change it and tap Save. Every change is recorded in the audit log.',
    screen: <div className="space-y-3"><ScreenTitle>Community reports</ScreenTitle>
      <ScreenCard icon={Sparkles} title="Suggested: Lighting, medium urgency" note="From the AI photo and text check" i={0} />
      <ScreenRow label="Urgency" value="High" i={1} tone="gold" />
      <ScreenRow icon={ShieldCheck} label="Change recorded in the audit log" i={2} tick />
    </div>,
  },
  {
    key: 'confirm', icon: CheckCircle2, who: 'Staff', title: 'Confirm it, fix it, show the fix',
    text: 'Moving a report to In progress confirms it is real, and the reporter earns Impact XP. When it is done, choose Resolved and add a photo of the fix for everyone following it. Not a real problem? Choose Closed, no action.',
    screen: <div className="space-y-3"><ScreenTitle>Status</ScreenTitle>
      <ScreenRow label="In progress" value="Reporter earns XP" i={0} tick />
      <ScreenRow label="Add a photo of the fix" i={1} tick />
      <ScreenCard icon={CheckCircle2} title="Resolved" note="Everyone following it is told" i={2} tone="success" />
    </div>,
  },
  {
    key: 'take', icon: Hand, who: 'Staff', title: 'Cases: tap I’ll handle this',
    text: 'Gate & community cases and Parcel & locker cases come from Tamu, Parcels, Kitar and Gerak. Each must be taken, then resolved, within its deadline. If two people tap at once, only one gets it.',
    screen: <div className="space-y-3"><ScreenTitle>Gate & community cases</ScreenTitle>
      <ScreenCard icon={DoorOpen} title="Visitor refused" note="INC-000123 · Take within 3 h 40 min" i={0} tone="gold" />
      <ScreenButton i={1}>I’ll handle this</ScreenButton>
    </div>,
  },
  {
    key: 'work', icon: MessageSquare, who: 'Case owner', title: 'Work the case, then Resolve',
    text: 'Add a note only staff see, Update the resident, or Ask the resident: the case then waits for their answer. Waiting for someone covers a courier company or a contractor. Resolve records the outcome the resident is told.',
    screen: <div className="space-y-2.5"><ScreenTitle>Case actions</ScreenTitle>
      <ScreenRow label="Add a note" i={0} />
      <ScreenRow label="Update the resident" i={1} />
      <ScreenRow label="Ask the resident" i={2} />
      <ScreenButton i={3} tone="success">Resolve</ScreenButton>
    </div>,
  },
  {
    key: 'admin', icon: Flag, who: 'Staff', title: 'Stuck? Ask an admin',
    text: 'Tap Ask an admin and say what they should do. The township admins are told at once, and the case stays with you. Admins set case deadlines in Parcels › Manage › Case deadlines.',
    screen: <div className="space-y-3"><ScreenTitle>Case actions</ScreenTitle>
      <ScreenRow icon={Flag} label="Ask an admin" value="Admins told" i={0} tick />
      <ScreenCard icon={Flag} title="Escalated: Visitor refused (INC-000123)" note="Ravi Kumar asked for an admin" i={1} tone="alert" />
    </div>,
  },
];

export function ConsoleLaporWalkthrough() {
  return <Walkthrough title="How Lapor works for staff" description="Community reports, cases, and who does what." steps={CONSOLE} />;
}

// --- Admins and HQ (case deadlines) --------------------------------------------------------------

const DEADLINES: WalkStep[] = [
  {
    key: 'targets', icon: Timer, who: 'Admins', title: 'Two deadlines for every case',
    text: 'Each priority has a time to be taken and a time to be resolved. These are proposed starting values: the township decides its own.',
    screen: <div className="space-y-2.5"><ScreenTitle>Targets by priority</ScreenTitle>
      <ScreenRow label="Critical" value="15 min · 4 h" i={0} tone="alert" />
      <ScreenRow label="High" value="1 h · 24 h" i={1} />
      <ScreenRow label="Normal" value="4 h · 2 days" i={2} />
      <ScreenRow label="Low" value="1 day · 3 days" i={3} />
    </div>,
  },
  {
    key: 'working', icon: CalendarClock, who: 'Admins', title: 'Working time skips nights and holidays',
    text: 'Normal and Low count only working time: 9 am to 6 pm, Monday to Friday, skipping the holidays you list. Critical and High count every minute.',
    screen: <div className="space-y-2.5"><ScreenTitle>Working hours, holidays and reopening</ScreenTitle>
      <ScreenRow label="Working day" value="9 am – 6 pm" i={0} />
      <ScreenRow label="Working days" value="Mon – Fri" i={1} />
      <ScreenRow label="Days to reopen a resolved report" value="7" i={2} />
    </div>,
  },
  {
    key: 'watch', icon: Clock, who: 'SimeTown', title: 'Deadlines are checked every 5 minutes',
    text: 'A case nobody took in time, or one past its deadline, is escalated to the township admins once, never twice. It is marked Escalated and shows Not taken in time or Past its deadline.',
    screen: <div className="space-y-3"><ScreenTitle>Case queue</ScreenTitle>
      <ScreenStats items={[{ label: 'Open', value: '12' }, { label: 'Unassigned', value: '2', tone: 'warn' }, { label: 'Past deadline', value: '1', tone: 'alert' }]} />
      <ScreenCard icon={Flag} title="Escalated: Unauthorised entry (INC-000124)" note="Not taken in time" i={3} tone="alert" />
    </div>,
  },
  {
    key: 'critical', icon: Siren, who: 'Township admins', title: 'Some cases reach admins at once',
    text: 'A critical case, such as a locker door opened without an unlock, goes to the admins straight away. So does a staff member’s Ask an admin, and a case the resident reopens because it was not fixed.',
    screen: <div className="space-y-3"><ScreenTitle>Escalated</ScreenTitle>
      <ScreenCard icon={Siren} title="Door opened without an unlock" note="Critical · Admins told at once" i={0} tone="alert" />
      <ScreenCard icon={Flag} title="Ravi Kumar asked for an admin" note="Visitor refused (INC-000123)" i={1} tone="gold" />
      <ScreenCard icon={RotateCcw} title="Reopened" note="The resident says it is not fixed" i={2} tone="gold" />
    </div>,
  },
  {
    key: 'assign', icon: UserRound, who: 'Admins and HQ', title: 'Admins assign and reassign',
    text: 'Give a case to a staff member with Assign, or move it with Reassign and a reason. The new owner is told, and the move is recorded.',
    screen: <div className="space-y-3"><ScreenTitle>Reassign</ScreenTitle>
      <ScreenRow icon={UserRound} label="Give it to" value="Ravi Kumar" i={0} />
      <ScreenRow label="Why it is moving" value="On leave this week" i={1} />
      <ScreenCard icon={Bell} title="Case for you: Visitor refused (INC-000123)" note="Sent to Ravi Kumar" i={2} />
    </div>,
  },
  {
    key: 'close', icon: Lock, who: 'SimeTown', title: 'Resolved cases close by themselves',
    text: 'A resolved case closes once the resident can no longer reopen it: 7 days here. A case that is not resolved never closes by itself.',
    screen: <div className="space-y-3"><ScreenTitle>Case activity</ScreenTitle>
      <ScreenRow icon={CheckCircle2} label="Resolved" value="7 days to reopen" i={0} />
      <ScreenCard icon={Lock} title="Closed" note="This report is closed." i={1} tone="success" />
    </div>,
  },
  {
    key: 'save', icon: ShieldCheck, who: 'Admins and HQ', title: 'Only admins change the deadlines',
    text: 'Staff can see the deadlines here. Admins change them and tap Save deadlines. Run the deadline checks now runs the checks at once, for a demonstration.',
    screen: <div className="space-y-3"><ScreenTitle>Case deadlines</ScreenTitle>
      <ScreenButton i={0}>Save deadlines</ScreenButton>
      <ScreenRow icon={PlayCircle} label="Run the deadline checks now" i={1} />
    </div>,
  },
];

export function CaseDeadlinesWalkthrough() {
  return <Walkthrough title="How case deadlines work" label="How deadlines work" description="Deadlines, escalations and who is told." steps={DEADLINES} />;
}
