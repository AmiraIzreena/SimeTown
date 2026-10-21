'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { NotificationRows, useNotificationActions } from '@/components/features/notification-list';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { FilterBar, FilterChips, FilterRow, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { Text } from '@/components/ui/localized-text';
import { SubNav } from '@/components/ui/sub-nav';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { NOTIFICATION_LABELS, type NotificationCategory, type NotificationList } from '@/shared/notifications';

/**
 * The notification centre, in the same shape as Lapor: search and category chips in the filter bar, All / Unread
 * right above the list, and only the list changing when a filter is picked.
 */
export default function NotificationsCenter(props: { resident: boolean; categories: readonly NotificationCategory[] }) {
  return <Suspense fallback={<SkeletonList rows={4} />}><Center {...props} /></Suspense>;
}

/** Notifications per page. */
const PAGE = 20;

function Center({ resident, categories }: { resident: boolean; categories: readonly NotificationCategory[] }) {
  const params = useSearchParams();
  // All or Unread is part of the address, like the other status bars; category and search stay on the page.
  const view: 'all' | 'unread' = params.get('view') === 'unread' ? 'unread' : 'all';
  const [category, setCategory] = useState<NotificationCategory | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [cursors, setCursors] = useState<string[]>([]);
  // A new filter starts again from the first page.
  const filterKey = `${view}:${category}:${q}`;
  const [pagedFor, setPagedFor] = useState(filterKey);
  if (pagedFor !== filterKey) {
    setPagedFor(filterKey);
    setCursors([]);
  }

  const query = new URLSearchParams({ limit: String(PAGE) });
  if (view === 'unread') query.set('unread', 'true');
  if (category !== 'ALL') query.set('category', category);
  if (q) query.set('q', q);
  if (cursors.length) query.set('cursor', cursors[cursors.length - 1]!);
  // The previous results stay on screen (dimmed) until the new ones arrive, so the page around the list stays still.
  const list = useApi<NotificationList>(`/notifications?${query}`, { refreshInterval: 30_000, keepPreviousData: true });
  const summary = useApi<NotificationList>('/notifications', { refreshInterval: 30_000 });
  const action = useNotificationActions();
  const stale = list.isLoading && list.data !== undefined;
  const counts = list.data?.categories;
  const shown = list.data?.items.length ?? 0;
  const total = counts ? (category === 'ALL' ? categories.reduce((sum, c) => sum + (counts[c] ?? 0), 0) : counts[category] ?? 0) : undefined;
  const filtered = Boolean(q) || category !== 'ALL';
  const clearFilters = () => {
    setSearch('');
    setCategory('ALL');
  };

  return <>
    <PageHeader title="Notifications" description="Your latest updates, reminders and activity." action={resident && <Button variant="secondary" href="/app/requests"><Text>Request tracking</Text></Button>} />
    <div className="space-y-5">
      <FilterBar
        search={<SearchField value={search} onChange={setSearch} label="Search notifications" placeholder="Search notifications" />}
        chips={
          <FilterRow label="Category">
            <FilterChips<NotificationCategory | 'ALL'>
            label="Category"
            size="sm"
            value={category}
            onChange={setCategory}
            options={[{ key: 'ALL', label: 'All categories' }, ...categories.map((c) => ({ key: c, label: NOTIFICATION_LABELS[c], count: counts?.[c] ?? 0 }))]}
          />
          </FilterRow>
        }
        summary={list.data && total !== undefined && <FilterSummary shown={total} noun={total === 1 ? 'notification' : 'notifications'} onClear={filtered ? clearFilters : undefined} live />}
      />

      {/* All / Unread sits right above the list it switches, with the one action that affects them all. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubNav
          label="Read or unread"
          value={view}
          items={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: summary.data?.unread, alert: true }]}
          hrefOf={(key) => (key === 'all' ? '/notifications' : '/notifications?view=unread')}
        />
        <Button variant="secondary" disabled={!summary.data?.unread} pending={action.pending} onClick={() => void action.run(null, 'read')}><Text>Mark all as read</Text></Button>
      </div>

      {/* Only this part changes when a filter or All / Unread is picked; it dims while the new results load. */}
      <div aria-busy={stale || undefined} className={cn('transition-opacity duration-200', stale && 'pointer-events-none opacity-50')}>
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.mutate()} />
        ) : !list.data ? (
          <SkeletonList rows={4} />
        ) : list.data.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No notifications match your filters" action={<Button variant="secondary" onClick={clearFilters}><Text>Clear filters</Text></Button>}><Text>Try another category, or a different word.</Text></EmptyState>
          ) : view === 'unread' ? (
            <EmptyState title="You are all caught up"><Text>New notifications appear here until you read them.</Text></EmptyState>
          ) : (
            <EmptyState title="No notifications yet"><Text>Updates, reminders and activity appear here.</Text></EmptyState>
          )
        ) : (
          <Card className="overflow-hidden">
            <div key={`${pagedFor}:${cursors.length}`} className="content-in"><NotificationRows items={list.data.items} /></div>
            {(cursors.length > 0 || list.data.nextCursor) && (
              <div className="flex items-center justify-between gap-3 border-t border-ink-100 p-4">
                <Button variant="ghost" disabled={!cursors.length || stale} onClick={() => setCursors((current) => current.slice(0, -1))}><Text>Previous</Text></Button>
                {/* Where this page sits in the whole list, e.g. 21–31 of 31. */}
                {total !== undefined && <p className="text-sm tabular-nums text-ink-500">{cursors.length * PAGE + 1}–{cursors.length * PAGE + shown} <Text>of</Text> {total}</p>}
                <Button variant="ghost" disabled={!list.data.nextCursor || stale} onClick={() => { if (list.data?.nextCursor) setCursors((current) => [...current, list.data!.nextCursor!]); }}><Text>Next</Text></Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  </>;
}
