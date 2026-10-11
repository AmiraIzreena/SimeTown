import { formatRM } from '@/shared/domain';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A Shop Offer's terms in one line: "Mon–Fri, 14:00–18:00 · min. spend RM20.00". */
export function offerTerms(o: { daysMask: number; startMinute: number; endMinute: number; minSpendSen: number }): string {
  const days = o.daysMask === 127 ? 'Every day' : o.daysMask === 31 ? 'Mon–Fri' : o.daysMask === 96 ? 'Weekends' : DAYS.filter((_, i) => o.daysMask & (1 << i)).join(', ');
  const hours = o.startMinute === 0 && o.endMinute === 1440 ? 'all day' : `${hhmm(o.startMinute)}–${hhmm(o.endMinute)}`;
  return `${days}, ${hours}${o.minSpendSen ? ` · min. spend ${formatRM(o.minSpendSen)}` : ''}`;
}

export const OFFER_DAYS = DAYS;
