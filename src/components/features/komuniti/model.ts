import { CalendarDays, Gift, HandHeart, Repeat2, type LucideIcon } from 'lucide-react';
import type { PostType } from '@/shared/domain';

/** What the resident feed (GET /posts) returns. */
export interface Post {
  id: string;
  type: PostType;
  title: string;
  body: string;
  location: string | null;
  starts_at: string | null;
  capacity: number | null;
  status: 'OPEN' | 'CLOSED' | 'HIDDEN';
  created_at: string;
  author_name: string;
  by_township: boolean;
  is_mine: boolean;
  responses: number;
  my_response: ResponseStatus | null;
  /** When I have borrowed it: the date it should come back (YYYY-MM-DD). */
  my_due_back: string | null;
  responders: Responder[];
}

export type ResponseStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CONFIRMED' | 'RETURNED';

export interface Responder {
  user_id: string;
  name: string;
  status: ResponseStatus;
  due_back: string | null;
}

export interface Impact {
  xp: number;
  activities: number;
  contributions: number;
  neighbours_helped: number;
}

export interface PostKind {
  type: PostType;
  /** Jiran or Kongsi: kept as a label so residents still recognise them. */
  group: 'Jiran' | 'Kongsi';
  label: string;
  icon: LucideIcon;
  tone: string;
  /** Button and title for creating one. */
  create: string;
  /** One line on the type chooser. */
  pitch: string;
  /** What a neighbour presses to respond. */
  respond: string;
  responded: string;
  /** What the neighbour sees once the author has picked them. */
  accepted: string;
  /** What the neighbour presses to take it back. */
  withdraw: string;
  /** What the author presses once it really happened. */
  confirm: string;
  xpNote: string;
}

export const KINDS: Record<PostType, PostKind> = {
  EVENT: { type: 'EVENT', group: 'Jiran', label: 'Activity', icon: CalendarDays, tone: 'bg-brand-50 text-brand-700', create: 'New event', pitch: 'A clean-up, a game, a street potluck.', respond: 'I’m coming', responded: 'You’re going', accepted: 'You’re going', withdraw: 'Cancel RSVP', confirm: 'Confirm attended', xpNote: 'Guests earn Impact XP when you confirm they attended.' },
  HELP: { type: 'HELP', group: 'Jiran', label: 'Help', icon: HandHeart, tone: 'bg-success-50 text-success-700', create: 'Ask for help', pitch: 'Moving a table, a lift to the clinic, fixing a tap.', respond: 'I can help', responded: 'You offered to help', accepted: 'Accepted: arrange a time to help', withdraw: 'Withdraw offer', confirm: 'Confirm they helped', xpNote: 'Accept one helper, then confirm once the favour is done. Your helper earns Impact XP then.' },
  GIVE: { type: 'GIVE', group: 'Kongsi', label: 'Give away', icon: Gift, tone: 'bg-gold-50 text-gold-700', create: 'Give an item', pitch: 'Books, clothes, furniture you no longer need.', respond: 'I’d like this', responded: 'You asked for this', accepted: 'Accepted: arrange to collect it', withdraw: 'Withdraw request', confirm: 'Confirm handed over', xpNote: 'Accept one neighbour, then confirm when they collect it. You earn Impact XP then.' },
  LEND: { type: 'LEND', group: 'Kongsi', label: 'Lend', icon: Repeat2, tone: 'bg-gold-50 text-gold-700', create: 'Lend an item', pitch: 'A ladder, a drill, a folding table.', respond: 'I’d like to borrow this', responded: 'You asked to borrow this', accepted: 'Accepted: arrange to collect it', withdraw: 'Withdraw request', confirm: 'Confirm lent', xpNote: 'Accept a borrower with a return date. You earn Impact XP when the item comes back and you mark it returned.' },
};

export type KomunitiTab = 'all' | 'activities' | 'help' | 'share';

export const TABS: { key: KomunitiTab; label: string; types: PostType[]; empty: string }[] = [
  { key: 'all', label: 'All', types: [], empty: 'Nothing posted yet. Start an event, ask for help or share something.' },
  { key: 'activities', label: 'Activities', types: ['EVENT'], empty: 'No events yet. Start one: a clean-up, a game, a street potluck.' },
  { key: 'help', label: 'Help', types: ['HELP'], empty: 'Nobody needs a hand right now. Need one yourself?' },
  { key: 'share', label: 'Give & Lend', types: ['GIVE', 'LEND'], empty: 'Nothing to give or borrow right now. Clearing out a cupboard?' },
];

/** Today in the township (Malaysia, UTC+8), as YYYY-MM-DD. */
export const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const formatDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
