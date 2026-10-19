'use client';

import { Bell, Package, Wrench, Users, Wallet, Flag, Recycle, ShieldAlert, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Text } from '@/components/ui/localized-text';
import { EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { timeAgo } from '@/lib/format';
import { NOTIFICATION_LABELS, type NotificationItem } from '@/shared/notifications';

export function useNotificationActions() {
  const { mutate } = useSWRConfig();
  return useAction(async (id: string | null, action: 'read' | 'dismiss') => {
    await api.post(id ? `/notifications/${id}/${action}` : '/notifications/read');
    await mutate((key) => typeof key === 'string' && (key === '/notifications' || key.startsWith('/notifications?')));
    return true;
  });
}
const ICONS = { PARCELS: Package, SERVICES: Wrench, COMMUNITY: Users, REWARDS: Wallet, REPORTS: Flag, RECYCLING: Recycle, ALERTS: ShieldAlert, ACCOUNT: UserRound };
export function NotificationRows({ items, compact = false, onNavigate }: { items: NotificationItem[]; compact?: boolean; onNavigate?: () => void }) {
  if (!items.length) return <EmptyState icon={Bell} title="No notifications"><Text>Updates will appear here when there is something new.</Text></EmptyState>;
  return <ul className="divide-y divide-ink-100">{items.map((item) => <NotificationRow key={item.id} item={item} compact={compact} onNavigate={onNavigate} />)}</ul>;
}
function NotificationRow({ item, compact, onNavigate }: { item: NotificationItem; compact: boolean; onNavigate?: () => void }) {
  const action = useNotificationActions();
  const router = useRouter();
  const Icon = ICONS[item.category];
  const open = async () => {
    if (!item.read_at && !await action.run(item.id, 'read')) return;
    if (item.link) { onNavigate?.(); router.push(item.link); }
  };
  return <li className={`p-4 sm:p-5 ${!item.read_at ? 'bg-brand-50/50' : ''}`}>
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700"><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-500"><Text>{NOTIFICATION_LABELS[item.category]}</Text>{!item.read_at && <Badge tone="brand"><Text>Unread</Text></Badge>}{item.priority === 'URGENT' && <Badge tone="danger"><Text>Urgent</Text></Badge>}</div>
        <button type="button" disabled={action.pending} onClick={() => void open()} className="block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60">
          <span className="block text-sm font-semibold text-ink-900"><Text>{item.title}</Text></span>
          <span className={`mt-1 block text-sm text-ink-600 ${compact ? 'line-clamp-2' : 'break-words'}`}><Text>{item.body}</Text></span>
        </button>
        <time dateTime={item.created_at} className="mt-2 block text-xs text-ink-500"><Text>{timeAgo(item.created_at)}</Text></time>
        {!compact && <div className="mt-2 flex flex-wrap gap-2">
          {item.link && <Button size="sm" variant="ghost" pending={action.pending} onClick={() => void open()}><Text>View details</Text></Button>}
          {!item.read_at && <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => void action.run(item.id, 'read')}><Text>Mark as read</Text></Button>}
          <Button size="sm" variant="ghost" disabled={action.pending} onClick={() => void action.run(item.id, 'dismiss')}><Text>Dismiss</Text></Button>
        </div>}
      </div>
    </div>
  </li>;
}
