import { formatRM } from '@/shared/domain';
import type { ActionRewardView } from './types';

const LOCALE = 'en-MY';
const TZ = 'Asia/Kuala_Lumpur';

export const formatDate = (value: string | Date) => new Date(value).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
export const formatDateTime = (value: string | Date) =>
  new Date(value).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
/** A compact axis label: the day number, with the month on the 1st ("29", "30", "1 Oct"). */
export const formatDay = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(LOCALE, isoDate.endsWith('-01') ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
export const formatMonth = (isoDate: string) => new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const formatKg = (grams: number) => `${(grams / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} kg`;
export const formatKm = (metres: number) => `${(metres / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} km`;
export const formatNumber = (n: number) => n.toLocaleString(LOCALE);

/** "A few minutes ago" style for recent things, a date for older ones. */
export function timeAgo(value: string | Date): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)} d ago`;
  return formatDate(value);
}

/** One sentence for what an action earned, in ringgit, naming who paid for any points. */
export function rewardMessage(reward: ActionRewardView | null | undefined, fallback: string): string {
  const offer = reward?.offerPoints ?? 0;
  if (!reward || (reward.xp === 0 && reward.points === 0 && offer === 0)) return fallback;
  const parts = [`+${reward.xp} Impact XP`];
  if (reward.points > 0) parts.push(`+${reward.points} points (${formatRM(reward.points)}), funded by ${[...new Set(reward.fundedBy)].join(' and ')}`);
  if (offer > 0) parts.push(`+${offer} offer points (${formatRM(offer)}), backed by township shop offers`);
  return parts.join(' · ');
}

/** RM typed by a person ("12.50") to whole sen, or null if it is not a valid amount. */
export function parseRM(text: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text.trim())) return null;
  return Math.round(Number(text) * 100);
}
