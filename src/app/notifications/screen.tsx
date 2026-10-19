'use client';
import { useState } from 'react';
import { NotificationRows, useNotificationActions } from '@/components/features/notification-list';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Async, SkeletonList } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { Text } from '@/components/ui/localized-text';
import { Tabs } from '@/components/ui/tabs';
import { useApi } from '@/lib/hooks';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_LABELS, type NotificationList } from '@/shared/notifications';
export default function NotificationsCenter({ resident }: { resident: boolean }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const params = new URLSearchParams({ limit: '20' });
  if (filter === 'unread') params.set('unread', 'true');
  if (category) params.set('category', category);
  if (cursors.length) params.set('cursor', cursors[cursors.length - 1]!);
  const list = useApi<NotificationList>(`/notifications?${params}`, { refreshInterval: 30_000 });
  const summary = useApi<NotificationList>('/notifications', { refreshInterval: 30_000 });
  const action = useNotificationActions();
  return <>
    <PageHeader title="Notifications" description="Your latest updates, reminders and activity." action={resident && <Button variant="secondary" href="/app/requests"><Text>Request tracking</Text></Button>} />
    <Tabs label="Notifications" value={filter} onChange={(value) => { setFilter(value); setCursors([]); }} items={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: summary.data?.unread }]} />
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-100 p-5">
        <Select label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setCursors([]); }} className="min-w-48"><option value=""><Text>All categories</Text></option>{NOTIFICATION_CATEGORIES.map((value) => <option key={value} value={value}><Text>{NOTIFICATION_LABELS[value]}</Text></option>)}</Select>
        <Button variant="secondary" disabled={!summary.data?.unread} pending={action.pending} onClick={() => void action.run(null, 'read')}><Text>Mark all as read</Text></Button>
      </div>
      <Async state={list} skeleton={<SkeletonList rows={4} className="p-5" />}>{(data) => <NotificationRows items={data.items} />}</Async>
      <div className="flex justify-between gap-3 border-t border-ink-100 p-4">
        <Button variant="ghost" disabled={!cursors.length || list.isLoading} onClick={() => setCursors((current) => current.slice(0, -1))}><Text>Previous</Text></Button>
        <Button variant="ghost" disabled={!list.data?.nextCursor || list.isLoading} onClick={() => { if (list.data?.nextCursor) setCursors((current) => [...current, list.data!.nextCursor!]); }}><Text>Next</Text></Button>
      </div>
    </Card>
  </>;
}
