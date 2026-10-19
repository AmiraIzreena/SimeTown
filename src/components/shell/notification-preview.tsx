'use client';
import { useEffect, useRef } from 'react';
import { useApi } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Async, SkeletonList } from '@/components/ui/feedback';
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { NotificationRows } from '@/components/features/notification-list';
import type { NotificationList } from '@/shared/notifications';
export function NotificationsPreview({ onClose }: { onClose: () => void }) {
  const list = useApi<NotificationList>('/notifications', { refreshInterval: 30_000 });
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { onClose(); trigger?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [onClose]);
  return <LocalizedDiv ref={panel} id="notification-preview" role="region" tabIndex={-1} aria-label="Notifications" className="glass-surface fixed left-3 right-3 top-16 z-50 overflow-hidden rounded-xl border shadow-xl sm:absolute sm:left-auto sm:right-4 sm:w-96">
    <div className="flex items-center justify-between border-b border-ink-100 p-4"><h2 className="font-semibold"><Text>Notifications</Text></h2><Button size="sm" variant="ghost" onClick={onClose}><Text>Close</Text></Button></div>
    <div className="max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain"><Async state={list} skeleton={<SkeletonList rows={3} className="p-4" />}>{(data) => <NotificationRows items={data.items.slice(0, 5)} compact onNavigate={onClose} />}</Async></div>
    <div className="border-t border-ink-100 p-3" onClick={onClose}><Button variant="secondary" href="/notifications" className="w-full"><Text>View all notifications</Text></Button></div>
  </LocalizedDiv>;
}
