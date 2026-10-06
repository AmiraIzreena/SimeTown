'use client';

import { BellOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { EmptyState, SkeletonList } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';

export interface NotificationList {
  unread: number;
  items: { id: number; priority: 'NORMAL' | 'URGENT'; title: string; body: string; link: string | null; read_at: string | null; created_at: string }[];
}

export function NotificationsDrawer({ open, onClose, list, onRead }: { open: boolean; onClose: () => void; list?: NotificationList; onRead: () => void }) {
  // Opening the panel counts as reading what is in it.
  useEffect(() => {
    if (open && list?.unread) void api.post('/notifications/read').then(onRead).catch(() => undefined);
  }, [open, list?.unread, onRead]);

  return (
    <Drawer open={open} onClose={onClose} side="right" title="Notifications">
      {!list ? (
        <SkeletonList rows={3} />
      ) : list.items.length === 0 ? (
        <EmptyState icon={BellOff} title="Nothing yet">
          Updates about your points, reports and township alerts will appear here.
        </EmptyState>
      ) : (
        <ul className="-mx-2 space-y-1">
          {list.items.map((n) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className={cn('text-sm font-semibold', n.read_at ? 'text-ink-700' : 'text-ink-900')}>{n.title}</p>
                  {n.priority === 'URGENT' && <Badge tone="danger">Urgent</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                <p className="mt-1 text-xs text-ink-500">{timeAgo(n.created_at)}</p>
              </>
            );
            const className = cn('block rounded-md px-3 py-2.5 transition-colors duration-200', !n.read_at && 'bg-brand-50/60', n.link && 'hover:bg-ink-50');
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} onClick={onClose} className={className}>
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
