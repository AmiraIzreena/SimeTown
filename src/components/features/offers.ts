import { formatRM } from '@/shared/domain';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A Shop Offer's terms in one line: "Mon–Fri, 14:00–18:00 · min. spend RM20.00". Pass the page's `t` to get
 * it in the reader's language; each part is translated on its own, since the line as a whole is not a catalogue sentence.
 */
export function offerTerms(o: { daysMask: number; startMinute: number; endMinute: number; minSpendSen: number }, t: (text: string) => string = (text) => text): string {
  const days = o.daysMask === 127 ? t('Every day') : o.daysMask === 31 ? t('Mon–Fri') : o.daysMask === 96 ? t('Weekends') : DAYS.filter((_, i) => o.daysMask & (1 << i)).map((day) => t(day)).join(', ');
  const hours = o.startMinute === 0 && o.endMinute === 1440 ? t('all day') : `${hhmm(o.startMinute)}–${hhmm(o.endMinute)}`;
  return `${days}, ${hours}${o.minSpendSen ? ` ${t(`· min. spend ${formatRM(o.minSpendSen)}`)}` : ''}`;
}

export const OFFER_DAYS = DAYS;
