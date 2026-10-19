'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { CalendarDays, Flag, Gift, HandHeart, MapPin, Plus, Repeat2, Search, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { AksesPage, useAksesMode } from '@/components/features/akses-mode';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Stat } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, rewardMessage, timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { ActionRewardView } from '@/lib/types';
import type { PostType } from '@/shared/domain';

interface Post {
  id: string;
  type: PostType;
  title: string;
  body: string;
  location: string | null;
  starts_at: string | null;
  capacity: number | null;
  status: 'OPEN' | 'CLOSED' | 'HIDDEN';
  created_at: string;
  author_name: string;
  by_township: boolean;
  is_mine: boolean;
  responses: number;
  my_response: 'PENDING' | 'CONFIRMED' | null;
  responders: { user_id: string; name: string; status: 'PENDING' | 'CONFIRMED' }[];
}

interface Impact {
  xp: number;
  activities: number;
  contributions: number;
  neighbours_helped: number;
}

interface PostKind {
  type: PostType;
  /** Jiran or Kongsi: kept as a label so residents still recognise them. */
  group: 'Jiran' | 'Kongsi';
  label: string;
  icon: LucideIcon;
  tone: string;
  /** Button and title for creating one. */
  create: string;
  /** One line on the type chooser. */
  pitch: string;
  /** What a neighbour presses to respond. */
  respond: string;
  responded: string;
  /** What the author presses once it really happened. */
  confirm: string;
  xpNote: string;
}

const KINDS: Record<PostType, PostKind> = {
  EVENT: { type: 'EVENT', group: 'Jiran', label: 'Activity', icon: CalendarDays, tone: 'bg-brand-50 text-brand-700', create: 'New event', pitch: 'A clean-up, a game, a street potluck.', respond: 'I’m coming', responded: 'You’re going', confirm: 'Confirm attended', xpNote: 'Guests earn Impact XP when you confirm they attended.' },
  HELP: { type: 'HELP', group: 'Jiran', label: 'Help', icon: HandHeart, tone: 'bg-success-50 text-success-700', create: 'Ask for help', pitch: 'Moving a table, a lift to the clinic, fixing a tap.', respond: 'I can help', responded: 'You offered to help', confirm: 'Confirm they helped', xpNote: 'Your helper earns Impact XP when you confirm the favour was done.' },
  GIVE: { type: 'GIVE', group: 'Kongsi', label: 'Give away', icon: Gift, tone: 'bg-gold-50 text-gold-700', create: 'Give an item', pitch: 'Books, clothes, furniture you no longer need.', respond: 'I’d like this', responded: 'You asked for this', confirm: 'Confirm handed over', xpNote: 'You earn Impact XP when you confirm the item was collected.' },
  LEND: { type: 'LEND', group: 'Kongsi', label: 'Lend', icon: Repeat2, tone: 'bg-gold-50 text-gold-700', create: 'Lend an item', pitch: 'A ladder, a drill, a folding table.', respond: 'I’d like to borrow this', responded: 'You asked to borrow this', confirm: 'Confirm lent', xpNote: 'You earn Impact XP each time you confirm a loan.' },
};

export type KomunitiTab = 'all' | 'activities' | 'help' | 'share';

const TABS: { key: KomunitiTab; label: string; types: PostType[]; empty: string }[] = [
  { key: 'all', label: 'All', types: [], empty: 'Nothing posted yet. Start an event, ask for help or share something.' },
  { key: 'activities', label: 'Activities', types: ['EVENT'], empty: 'No events yet. Start one: a clean-up, a game, a street potluck.' },
  { key: 'help', label: 'Help', types: ['HELP'], empty: 'Nobody needs a hand right now. Need one yourself?' },
  { key: 'share', label: 'Give & Lend', types: ['GIVE', 'LEND'], empty: 'Nothing to give or borrow right now. Clearing out a cupboard?' },
];

/** Waits until typing pauses before searching. */
function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Komuniti: one feed for Jiran (events, help) and Kongsi (give, lend). The flow
 * is the same for each: post, neighbours respond, the author confirms, XP is given.
 */
export function KomunitiBoard({ initialTab = 'all' }: { initialTab?: KomunitiTab }) {
  const akses = useAksesMode();
  const [tab, setTab] = useState<KomunitiTab>(initialTab);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const q = useDebounced(search.trim());
  const current = TABS.find((t) => t.key === tab)!;

  const params = new URLSearchParams({ limit: '12' });
  if (current.types.length) params.set('type', current.types.join(','));
  if (q) params.set('q', q);
  if (mine) params.set('mine', 'true');
  const posts = usePaged<Post>(`/posts?${params.toString()}`);
  const impact = useApi<Impact>('/posts/impact');

  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState<PostKind | null>(null);
  const [flagging, setFlagging] = useState<Post | null>(null);

  const reload = () => {
    void posts.reload();
    void impact.mutate();
  };
  const startCreate = () => (current.types.length === 1 ? setCreating(KINDS[current.types[0]!]) : setChoosing(true));
  const respond = useAction((id: string) => api.post(`/posts/${id}/respond`), { onSuccess: reload, success: 'Done. The person who posted has been told.' });
  const confirm = useAction(
    async (post: Post, userId: string) => ({ type: post.type, ...(await api.post<{ reward: ActionRewardView | null }>(`/posts/${post.id}/responses/${userId}/confirm`)) }),
    {
      onSuccess: reload,
      success: (r) => (KINDS[r.type].group === 'Kongsi' ? rewardMessage(r.reward, 'Confirmed.') : 'Confirmed. Their Impact XP has been added.'),
    },
  );
  const close = useAction((id: string) => api.post(`/posts/${id}/close`), { onSuccess: reload, success: 'Closed.' });

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
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
            {posts.items.map((post, index) => {
              const kind = KINDS[post.type];
              const full = post.capacity !== null && post.responses >= post.capacity;
              return (
                <Card key={post.id} className={`post-card-enter flex flex-col ${akses.simple ? 'p-6' : 'p-5'}`} style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', kind.tone)}>
                      <kind.icon className="size-3.5" aria-hidden />
                      <Text>{kind.group}</Text> · <Text>{kind.label}</Text>
                    </span>
                    {post.by_township && <Badge tone="brand"><Text>Township</Text></Badge>}
                    {post.is_mine && <Badge><Text>Yours</Text></Badge>}
                    {post.status === 'OPEN' && full && <Badge tone="warning"><Text>Full</Text></Badge>}
                    {post.status === 'CLOSED' && <Badge><Text>Closed</Text></Badge>}
                    {post.status === 'HIDDEN' && <Badge tone="warning"><Text>Hidden for review</Text></Badge>}
                    <span className="ml-auto text-xs text-ink-500">
                      {post.author_name} · <Text>{timeAgo(post.created_at)}</Text>
                    </span>
                  </div>
                  <h3 className={`mt-3 font-semibold ${akses.simple ? 'text-xl' : 'text-[17px]'}`}>{post.title}</h3>
                  <p className={`mt-1 flex-1 whitespace-pre-line text-ink-600 ${akses.simple ? 'text-lg' : 'text-[15px]'}`}>{post.body}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
                    {post.starts_at && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="size-4" aria-hidden />
                        <Text>{formatDateTime(post.starts_at)}</Text>
                      </span>
                    )}
                    {post.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" aria-hidden />
                        <Text>{post.location}</Text>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-4" aria-hidden />
                      <Text>{post.responses}</Text>
                      <Text>{post.capacity ? ` of ${post.capacity}` : ''}</Text>
                    </span>
                  </div>

                  {post.responders.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-ink-100 pt-3">
                      {post.responders.map((r) => (
                        <li key={r.user_id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-ink-800">{r.name}</span>
                          {r.status === 'CONFIRMED' ? (
                            <Badge tone="success"><Text>Confirmed</Text></Badge>
                          ) : (
                            <Button size={akses.simple ? 'lg' : 'sm'} variant="secondary" onClick={() => confirm.run(post, r.user_id)} disabled={confirm.pending}>
                              <Text>{kind.confirm}</Text>
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {post.is_mine ? (
                      post.status === 'OPEN' && (
                        <Button size={akses.simple ? 'lg' : 'sm'} variant="ghost" onClick={() => close.run(post.id)} disabled={close.pending}><Text>Close</Text></Button>
                      )
                    ) : post.my_response ? (
                      <Badge tone={post.my_response === 'CONFIRMED' ? 'success' : 'brand'}><Text>{post.my_response === 'CONFIRMED' ? 'Confirmed' : kind.responded}</Text></Badge>
                    ) : (
                      post.status === 'OPEN' && !full && (
                        <Button size={akses.simple ? 'lg' : 'sm'} onClick={() => respond.run(post.id)} disabled={respond.pending}>
                          <Text>{kind.respond}</Text>
                        </Button>
                      )
                    )}
                    {!post.is_mine && (
                      <button type="button" onClick={() => setFlagging(post)} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-500 transition-colors duration-200 hover:text-accent-600">
                        <Flag className="size-4" aria-hidden /><Text>Report post</Text></button>
                    )}
                  </div>
                </Card>
              );
            })}
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
      {creating && <CreatePost kind={creating} accessible={akses.guided} onClose={() => setCreating(null)} onCreated={reload} />}
      <FlagPost post={flagging} onClose={() => setFlagging(null)} onFlagged={reload} />
    </AksesPage>
  );
}

function ChooseKind({ open, types, large, onClose, onChoose }: { open: boolean; types: PostType[]; large: boolean; onClose: () => void; onChoose: (kind: PostKind) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="What would you like to post?" description="Pick one. You can earn Impact XP once the other person confirms." footer={<Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {types.map((type) => {
          const kind = KINDS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChoose(kind)}
              className={cn('flex items-start gap-3 rounded-lg border border-ink-200 text-left transition-colors duration-200 hover:border-brand-400 hover:bg-brand-50/40 focus-visible:border-brand-500', large ? 'p-5' : 'p-4')}
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-md', kind.tone)}>
                <kind.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className={cn('block font-semibold text-ink-900', large ? 'text-lg' : 'text-[15px]')}><Text>{kind.create}</Text></span>
                <span className="mt-0.5 block text-sm text-ink-500"><Text>{kind.group}</Text> · <Text>{kind.pitch}</Text></span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function CreatePost({ kind, accessible, onClose, onCreated }: { kind: PostKind; accessible: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState('');
  const [guidedError, setGuidedError] = useState('');
  const steps = kind.type === 'EVENT' ? ['title', 'body', 'location', 'startsAt', 'capacity'] as const : ['title', 'body', 'location'] as const;
  const currentStep = steps[step];
  const create = useAction((body: Record<string, unknown>) => api.post('/posts', body), {
    success: 'Posted.',
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void create.run({
      type: kind.type,
      title: title.trim(),
      body: body.trim(),
      location: location.trim() || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      capacity: capacity ? Number(capacity) : undefined,
    });
  };
  const next = () => {
    const invalid = currentStep === 'title' && !title.trim()
      ? 'Please enter a title.'
      : currentStep === 'body' && !body.trim()
        ? 'Please enter details.'
        : currentStep === 'startsAt' && !startsAt
          ? 'Please choose a date and time.'
          : '';
    if (invalid) {
      setGuidedError(invalid);
      return;
    }
    setGuidedError('');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };
  const f = create.fields;
  return (
    <Modal
      open
      wide={accessible}
      className={accessible ? 'guided-modal' : undefined}
      onClose={onClose}
      title={kind.create}
      description={accessible ? t('Question {step} of {total}', { step: step + 1, total: steps.length }) : kind.xpNote}
      footer={
        <>
          {accessible && step > 0 && <Button size="lg" variant="secondary" onClick={() => setStep((current) => current - 1)}><Text>Back</Text></Button>}
          <Button size={accessible ? 'lg' : 'md'} variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          {accessible && step < steps.length - 1 ? (
            <Button size="lg" onClick={next}><Text>Next</Text></Button>
          ) : (
            <Button size={accessible ? 'lg' : 'md'} type="submit" form="create-post" pending={create.pending}><Text>Post</Text></Button>
          )}
        </>
      }
    >
      {accessible && <p className="mb-4 text-base text-ink-600"><Text>{kind.xpNote}</Text></p>}
      <form method="post" id="create-post" onSubmit={submit} className="space-y-4" noValidate>
        {(!accessible || currentStep === 'title') && <Input label="Title" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="title" value={title} onChange={(event) => { setTitle(event.target.value); setGuidedError(''); }} maxLength={100} required error={guidedError || f.title} />}
        {(!accessible || currentStep === 'body') && <Textarea label="Details" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="body" value={body} onChange={(event) => { setBody(event.target.value); setGuidedError(''); }} maxLength={1000} required error={guidedError || f.body} />}
        {(!accessible || currentStep === 'location') && <Input label="Where (optional)" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} error={f.location} />}
        {kind.type === 'EVENT' && (!accessible || currentStep === 'startsAt') && <Input label="Date and time" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="startsAt" type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setGuidedError(''); }} required error={guidedError || f.startsAt} />}
        {kind.type === 'EVENT' && (!accessible || currentStep === 'capacity') && <Input label="Places (optional)" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="capacity" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} min={1} inputMode="numeric" error={f.capacity} />}
      </form>
    </Modal>
  );
}

function FlagPost({ post, onClose, onFlagged }: { post: Post | null; onClose: () => void; onFlagged: () => void }) {
  const flag = useAction((reason: string) => api.post(`/posts/${post!.id}/flag`, { reason }), {
    success: 'Thank you. A moderator will look at it.',
    onSuccess: () => {
      onFlagged();
      onClose();
    },
  });
  return (
    <Modal
      open={post !== null}
      onClose={onClose}
      title="Report this post"
      description="Posts flagged by several residents are hidden until a moderator has reviewed them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          <Button variant="danger" type="submit" form="flag-post" pending={flag.pending}><Text>Report</Text></Button>
        </>
      }
    >
      <form method="post"
        id="flag-post"
        onSubmit={(event) => {
          event.preventDefault();
          void flag.run(String(new FormData(event.currentTarget).get('reason')));
        }}
      >
        <Textarea label="What is wrong with it?" name="reason" maxLength={200} required error={flag.fields.reason} />
      </form>
    </Modal>
  );
}
