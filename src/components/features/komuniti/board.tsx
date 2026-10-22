'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { CalendarDays, Gift, HandHeart, Plus, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AksesPage, useAksesMode } from '@/components/features/akses-mode';
import { Button } from '@/components/ui/button';
import { PageHeader, Stat } from '@/components/ui/card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useApi, usePaged } from '@/lib/hooks';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ChooseKind, CreatePost, LendItem, ReportPost } from './dialogs';
import { KINDS, TABS, type Impact, type KomunitiTab, type Post, type PostKind, type Responder } from './model';
import { PostCard } from './post-card';

export type { KomunitiTab } from './model';

/**
 * Komuniti: one feed for Jiran (events, help) and Kongsi (give, lend). The flow
 * is the same for each: post, neighbours respond, the author confirms, XP is given.
 */
export function KomunitiBoard({ initialTab = 'all' }: { initialTab?: KomunitiTab }) {
  const akses = useAksesMode();
  const [tab, setTab] = useState<KomunitiTab>(initialTab);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const q = useDebouncedValue(search.trim());
  const current = TABS.find((t) => t.key === tab)!;

  const params = new URLSearchParams({ limit: '12' });
  if (current.types.length) params.set('type', current.types.join(','));
  if (q) params.set('q', q);
  if (mine) params.set('mine', 'true');
  const posts = usePaged<Post>(`/posts?${params.toString()}`);
  const impact = useApi<Impact>('/posts/impact');

  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState<PostKind | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);
  const [lending, setLending] = useState<{ post: Post; responder: Responder } | null>(null);

  const reload = () => {
    void posts.reload();
    void impact.mutate();
  };
  const startCreate = () => (current.types.length === 1 ? setCreating(KINDS[current.types[0]!]) : setChoosing(true));

  return (
    <AksesPage>
      <PageHeader
        title="Komuniti"
        description="Connect, share and make an impact. Join events, help a neighbour, give away or lend things. You earn Impact XP when the other person confirms it happened."
        action={
          <Button size={akses.simple ? 'lg' : 'md'} onClick={startCreate}>
            <Plus className="size-4" aria-hidden />
            <Text>Create</Text>
          </Button>
        }
      />

      <LocalizedDiv role="region" aria-label="Your community impact" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Community Impact XP" value={impact.data?.xp ?? 0} format={(n) => `+${n}`} icon={Sparkles} tone="gold" />
        <Stat label="Events joined" value={impact.data?.activities ?? 0} icon={CalendarDays} />
        <Stat label="Items shared" value={impact.data?.contributions ?? 0} icon={Gift} tone="gold" />
        <Stat label="Neighbours helped" value={impact.data?.neighbours_helped ?? 0} icon={HandHeart} tone="success" />
      </LocalizedDiv>

      <Tabs<KomunitiTab> label="Komuniti" value={tab} onChange={setTab} items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Input label="Search posts" type="search" placeholder="Title, details or place" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} />
          <Search className="pointer-events-none absolute bottom-3 right-3 size-4 text-ink-400" aria-hidden />
        </div>
        <Button variant={mine ? 'primary' : 'secondary'} size={akses.simple ? 'lg' : 'md'} aria-pressed={mine} onClick={() => setMine((m) => !m)}>
          <Text>Only mine</Text>
        </Button>
      </div>

      <TabPanel>
        {posts.error ? (
          <ErrorState error={posts.error} onRetry={reload} />
        ) : posts.isLoading ? (
          <SkeletonList rows={3} />
        ) : posts.items.length === 0 ? (
          <EmptyState title={q || mine ? 'No posts match' : 'Nothing here yet'} action={<Button onClick={startCreate}><Text>Create</Text></Button>}>
            <Text>{q || mine ? 'Try another word, or clear the filters.' : current.empty}</Text>
          </EmptyState>
        ) : (
          <div className={`grid gap-4 ${akses.simple ? '' : 'md:grid-cols-2'}`}>
            {posts.items.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                index={index}
                large={akses.simple}
                onChanged={reload}
                onLend={(p, responder) => setLending({ post: p, responder })}
                onReport={setReporting}
              />
            ))}
          </div>
        )}
        {posts.hasMore && (
          <div className="mt-5 text-center">
            <Button variant="secondary" onClick={() => void posts.loadMore()} pending={posts.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
      </TabPanel>

      <ChooseKind
        open={choosing}
        types={current.types.length ? current.types : ['EVENT', 'HELP', 'GIVE', 'LEND']}
        large={akses.simple}
        onClose={() => setChoosing(false)}
        onChoose={(kind) => {
          setChoosing(false);
          setCreating(kind);
        }}
      />
      {lending && <LendItem post={lending.post} responder={lending.responder} large={akses.simple} onClose={() => setLending(null)} onLent={reload} />}
      {creating && <CreatePost kind={creating} accessible={akses.guided} onClose={() => setCreating(null)} onCreated={reload} />}
      <ReportPost post={reporting} onClose={() => setReporting(null)} onReported={reload} />
    </AksesPage>
  );
}
