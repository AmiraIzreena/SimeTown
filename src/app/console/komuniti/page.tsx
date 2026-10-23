'use client';

import { Text } from '@/components/ui/localized-text';

import { AlertTriangle, Camera, EyeOff, Flag, ImageOff, Repeat2, ShieldCheck, UserX, Users } from 'lucide-react';
import { useState } from 'react';
import { KINDS } from '@/components/features/komuniti/model';
import { PostPhoto } from '@/components/features/komuniti/post-card';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Stat } from '@/components/ui/card';
import { Async, EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { FilterBar, FilterMenu, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { DataTable } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ADMINS, POST_FLAG_CATEGORY_LABELS, POST_STATUSES, POST_TYPES, type PostFlagCategory, type PostStatus, type PostType } from '@/shared/domain';
import { PostReview, STATUS_LABELS, STATUS_TONES } from './post-review';

interface Overview {
  open_posts: number;
  reported: number;
  hidden: number;
  overdue_loans: number;
  removed_30d: number;
  new_30d: number;
  suspended: number;
}

interface ReportedPost {
  id: string;
  type: PostType;
  title: string;
  body: string;
  status: PostStatus;
  created_at: string;
  has_photo: boolean;
  photo_held: boolean;
  township_name: string;
  author_name: string;
  open_reports: number;
  urgent: boolean;
  reports: { category: PostFlagCategory; reason: string | null; created_at: string }[];
}

interface AdminPost {
  id: string;
  type: PostType;
  title: string;
  status: PostStatus;
  created_at: string;
  has_photo: boolean;
  township_name: string;
  author_name: string;
  responses: number;
  open_reports: number;
  overdue: number;
}

interface Suspension {
  user_id: string;
  name: string;
  until: string;
  reason: string;
  suspended_by: string;
  township_name: string;
}

type Tab = 'reports' | 'posts' | 'suspensions';

/**
 * Komuniti in the console. Township staff and admins see their own township;
 * HQ sees every township, or one it picks. Suspensions are for admins and HQ.
 */
export default function KomunitiConsolePage() {
  const me = useApi<Me>('/me');
  const hq = me.data?.role === 'HQ_ADMIN';
  const canSuspend = me.data ? ADMINS.includes(me.data.role) : false;
  const townships = useApi<{ id: string; name: string }[]>(hq ? '/townships' : null);
  const [townshipId, setTownshipId] = useState('');
  const [tab, setTab] = useState<Tab>('reports');
  const [openId, setOpenId] = useState<string | null>(null);

  const scope = townshipId ? `townshipId=${townshipId}` : '';
  const overview = useApi<Overview>(`/admin/komuniti/overview?${scope}`);
  const reports = useApi<ReportedPost[]>(`/admin/komuniti/reports?${scope}`);
  const suspensions = useApi<Suspension[]>(`/admin/komuniti/suspensions?${scope}`);
  const [filters, setFilters] = useState<PostFilters>({ status: '', type: '', search: '' });
  const q = useDebouncedValue(filters.search.trim());
  const params = new URLSearchParams(scope);
  params.set('limit', '25');
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (q) params.set('q', q);
  const posts = usePaged<AdminPost>(`/admin/komuniti/posts?${params.toString()}`);
  const refresh = () => {
    void overview.mutate();
    void reports.mutate();
    void suspensions.mutate();
    void posts.reload();
  };

  const o = overview.data;
  return (
    <>
      <PageHeader
        title="Komuniti"
        description="Reports from residents, every post in the township, and residents suspended from Komuniti. The person who posted is never told who reported them."
        action={hq && townships.data && (
          <FilterMenu<string> label="Township" value={townshipId} onChange={setTownshipId} options={[{ value: '', label: 'All townships' }, ...townships.data.map((t) => ({ value: t.id, label: t.name, raw: true }))]} />
        )}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Tiles open the list they count: the Reports tab, or All posts filtered to that status. */}
        <Stat label="Reports waiting" value={o?.reported ?? 0} icon={Flag} tone={o?.reported ? 'danger' : 'brand'} onClick={() => setTab('reports')} />
        <Stat label="Hidden for review" value={o?.hidden ?? 0} icon={EyeOff} tone={o?.hidden ? 'warning' : 'brand'} onClick={() => { setFilters({ status: 'HIDDEN', type: '', search: '' }); setTab('posts'); }} />
        <Stat label="Open posts" value={o?.open_posts ?? 0} icon={Users} hint={<Text>{`${o?.new_30d ?? 0} new in 30 days`}</Text>} onClick={() => { setFilters({ status: 'OPEN', type: '', search: '' }); setTab('posts'); }} />
        <Stat label="Overdue loans" value={o?.overdue_loans ?? 0} icon={Repeat2} tone={o?.overdue_loans ? 'warning' : 'brand'} hint={<Text>{`${o?.removed_30d ?? 0} removed · ${o?.suspended ?? 0} suspended`}</Text>} />
      </div>

      <Tabs<Tab>
        label="Komuniti"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'reports', label: 'Reports', count: reports.data?.length },
          { key: 'posts', label: 'All posts' },
          { key: 'suspensions', label: 'Suspended', count: suspensions.data?.length },
        ]}
      />
      <TabPanel>
        {tab === 'reports' ? (
          <ReportsQueue state={reports} hq={hq && !townshipId} onOpen={setOpenId} onChanged={refresh} />
        ) : tab === 'posts' ? (
          <AllPosts posts={posts} filters={filters} onFilter={setFilters} hq={hq && !townshipId} onOpen={setOpenId} />
        ) : (
          <Suspensions state={suspensions} hq={hq && !townshipId} canLift={canSuspend} onChanged={refresh} />
        )}
      </TabPanel>

      <PostReview id={openId} canSuspend={canSuspend} onClose={() => setOpenId(null)} onChanged={refresh} />
    </>
  );
}

function ReportsQueue({ state, hq, onOpen, onChanged }: { state: ReturnType<typeof useApi<ReportedPost[]>>; hq: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const keep = useAction((id: string) => api.post(`/admin/komuniti/posts/${id}/moderate`, { action: 'KEEP' }), {
    success: 'Kept. The residents who reported it have been told.',
    onSuccess: onChanged,
  });
  return (
    <Async state={state}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing to review"><Text>No reports are waiting.</Text></EmptyState>
        ) : (
          <ul className="space-y-3">
            {list.map((post) => (
              <li key={post.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {post.urgent && <Badge tone="danger"><AlertTriangle className="size-3.5" aria-hidden /><Text>Scam or safety</Text></Badge>}
                    <Badge tone={STATUS_TONES[post.status]}><Text>{STATUS_LABELS[post.status]}</Text></Badge>
                    {post.photo_held && (post.status === 'OPEN' || post.status === 'CLOSED') && <Badge tone="warning"><ImageOff className="size-3.5" aria-hidden /><Text>Photo held, 2 reports</Text></Badge>}
                    <Badge><Text>{KINDS[post.type].label}</Text></Badge>
                    <span className="text-sm text-ink-500">
                      {post.author_name}{hq && <> · {post.township_name}</>} · <Text>{timeAgo(post.created_at)}</Text>
                    </span>
                  </div>
                  <h2 className="mt-3 text-[17px] font-semibold">{post.title}</h2>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-[15px] text-ink-600">{post.body}</p>
                  {post.has_photo && <PostPhoto postId={post.id} className="mt-3 sm:max-w-sm" />}
                  <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                    <p className="font-semibold"><Text>{post.open_reports === 1 ? '1 report' : `${post.open_reports} reports`}</Text></p>
                    <ul className="mt-1 list-disc pl-5">
                      {post.reports.map((r, i) => (
                        <li key={i}>
                          <Text>{POST_FLAG_CATEGORY_LABELS[r.category]}</Text>{r.reason && <>: {r.reason}</>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onOpen(post.id)}><Text>Review</Text></Button>
                    <Button size="sm" variant="secondary" onClick={() => keep.run(post.id)} disabled={keep.pending}><Text>It is fine: keep it</Text></Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )
      }
    </Async>
  );
}

interface PostFilters {
  status: PostStatus | '';
  type: PostType | '';
  search: string;
}

function AllPosts({ posts, filters, onFilter, hq, onOpen }: {
  posts: ReturnType<typeof usePaged<AdminPost>>;
  filters: PostFilters;
  onFilter: (filters: PostFilters) => void;
  hq: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <FilterBar
        className="mb-4"
        search={<SearchField value={filters.search} onChange={(search) => onFilter({ ...filters, search })} label="Search posts" placeholder="Title, details or author" maxLength={80} />}
        controls={
          <>
            <FilterMenu<PostStatus | ''> label="Status" value={filters.status} onChange={(status) => onFilter({ ...filters, status })} options={[{ value: '', label: 'Any' }, ...POST_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))]} />
            <FilterMenu<PostType | ''> label="Kind" value={filters.type} onChange={(type) => onFilter({ ...filters, type })} options={[{ value: '', label: 'Any' }, ...POST_TYPES.map((value) => ({ value, label: KINDS[value].label }))]} />
          </>
        }
        summary={posts.isLoading || posts.error ? undefined : (
          <FilterSummary
            shown={posts.items.length}
            noun={posts.hasMore ? 'posts shown, more below' : 'posts'}
            onClear={filters.search || filters.status || filters.type ? () => onFilter({ ...filters, search: '', status: '', type: '' }) : undefined}
          />
        )}
      />
      {posts.error ? (
        <ErrorState error={posts.error} onRetry={() => void posts.reload()} />
      ) : posts.isLoading ? (
        <SkeletonList rows={4} />
      ) : posts.items.length === 0 ? (
        <EmptyState title="No posts match"><Text>Try another word, or clear the filters.</Text></EmptyState>
      ) : (
        <DataTable
          caption="Komuniti posts"
          rows={posts.items}
          keyOf={(p) => p.id}
          columns={[
            { header: 'Posted', cell: (p) => <Text>{timeAgo(p.created_at)}</Text> },
            {
              header: 'Post',
              cell: (p) => (
                <span className="inline-flex items-center gap-1.5 font-medium text-ink-900">
                  {p.title}
                  {p.has_photo && <span className="text-ink-500"><Camera className="size-4" aria-hidden /><span className="sr-only"><Text>Has a photo</Text></span></span>}
                </span>
              ),
            },
            { header: 'Kind', desktopOnly: true, cell: (p) => <Text>{KINDS[p.type].label}</Text> },
            { header: 'By', desktopOnly: true, cell: (p) => <>{p.author_name}{hq && <span className="block text-xs text-ink-500">{p.township_name}</span>}</> },
            {
              header: 'Status',
              cell: (p) => (
                <span className="flex flex-wrap gap-1">
                  <Badge tone={STATUS_TONES[p.status]}><Text>{STATUS_LABELS[p.status]}</Text></Badge>
                  {p.open_reports > 0 && <Badge tone="danger"><Text>{p.open_reports === 1 ? '1 report' : `${p.open_reports} reports`}</Text></Badge>}
                  {p.overdue > 0 && <Badge tone="warning"><Text>Overdue</Text></Badge>}
                </span>
              ),
            },
            { header: 'Responses', desktopOnly: true, align: 'right', cell: (p) => p.responses },
            { header: '', align: 'right', cell: (p) => <Button size="sm" variant="secondary" onClick={() => onOpen(p.id)}><Text>Open</Text></Button> },
          ]}
        />
      )}
      {posts.hasMore && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => void posts.loadMore()} pending={posts.loadingMore}><Text>Show more</Text></Button>
        </div>
      )}
    </>
  );
}

function Suspensions({ state, hq, canLift, onChanged }: { state: ReturnType<typeof useApi<Suspension[]>>; hq: boolean; canLift: boolean; onChanged: () => void }) {
  const lift = useAction((userId: string) => api.post(`/admin/komuniti/suspensions/${userId}/lift`), { success: 'Suspension lifted. They have been told.', onSuccess: onChanged });
  return (
    <Async state={state}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon={UserX} title="Nobody is suspended"><Text>Township admins and HQ can suspend a resident from a post they review.</Text></EmptyState>
        ) : (
          <DataTable
            caption="Suspended from Komuniti"
            rows={list}
            keyOf={(s) => s.user_id}
            columns={[
              { header: 'Resident', cell: (s) => <>{s.name}{hq && <span className="block text-xs text-ink-500">{s.township_name}</span>}</> },
              { header: 'Until', cell: (s) => <Text>{formatDate(s.until)}</Text> },
              { header: 'Reason', cell: (s) => s.reason },
              { header: 'By', desktopOnly: true, cell: (s) => s.suspended_by },
              {
                header: '',
                align: 'right',
                cell: (s) => canLift && (
                  <Button size="sm" variant="secondary" onClick={() => lift.run(s.user_id)} disabled={lift.pending}>
                    <Text>Lift suspension</Text>
                  </Button>
                ),
              },
            ]}
          />
        )
      }
    </Async>
  );
}
