export const NOTIFICATION_CATEGORIES = ['PARCELS', 'SERVICES', 'COMMUNITY', 'REWARDS', 'REPORTS', 'RECYCLING', 'ALERTS', 'ACCOUNT'] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export const NOTIFICATION_LABELS: Record<NotificationCategory, string> = {
  PARCELS: 'Parcels', SERVICES: 'Home services', COMMUNITY: 'Community', REWARDS: 'Points & XP',
  REPORTS: 'Reports & requests', RECYCLING: 'Recycling', ALERTS: 'Township alerts', ACCOUNT: 'Account',
};
/** The filter only offers categories the account can actually receive. */
export function notificationCategoriesFor(role: string, offers?: { retail: boolean; services: boolean }): readonly NotificationCategory[] {
  if (role === 'MERCHANT') return NOTIFICATION_CATEGORIES.filter((c) => c === 'ACCOUNT' || (c === 'SERVICES' && offers?.services !== false) || (c === 'REWARDS' && offers?.retail !== false));
  return NOTIFICATION_CATEGORIES;
}
export interface NotificationItem {
  id: string; priority: 'NORMAL' | 'URGENT'; title: string; body: string; link: string | null;
  category: NotificationCategory; read_at: string | null; created_at: string;
}
export interface NotificationList { items: NotificationItem[]; unread: number; nextCursor: string | null }

export function notificationCategory(link?: string | null): NotificationCategory {
  if (/parcels|lockers|courier|operations/.test(link ?? '')) return 'PARCELS';
  if (/home-services|bookings|services/.test(link ?? '')) return 'SERVICES';
  if (/wallet|sales|finance|statements/.test(link ?? '')) return 'REWARDS';
  if (/lapor|reports|incidents|requests|assistant/.test(link ?? '')) return 'REPORTS';
  if (/komuniti|jiran|kongsi|moderation/.test(link ?? '')) return 'COMMUNITY';
  if (/kitar|recycling/.test(link ?? '')) return 'RECYCLING';
  if (/banjir|alerts/.test(link ?? '')) return 'ALERTS';
  return 'ACCOUNT';
}

/** Notifications only navigate to implemented internal sections. */
export function notificationDestination(link: string | null): string | null {
  if (!link || !/^\/(app|console|merchant|courier|guard|sponsor)(\/|\?|#|$)/.test(link) || /[\\\u0000-\u0020]/.test(link)) return null;
  const path = link.split(/[?#]/)[0];
  if (/^\/app\/lapor\/[0-9a-f-]{36}$/i.test(path ?? '')) return link;
  const sections = /^\/(app(?:\/(?:wallet|parcels|home-services|lapor|reports|requests|komuniti|jiran|kongsi|kitar|banjir|akses|assistant|tamu|account))?|console(?:\/(?:komuniti|operations|lockers|parcels|reports|incidents|people|home-services|recycling|places|access|finance|assistant|banjir|account))?|merchant(?:\/(?:bookings|services|sales|statements|account))?|courier(?:\/(?:team|account|history))?|guard(?:\/parcels)?|sponsor)$/;
  return sections.test(path ?? '') ? link : null;
}
