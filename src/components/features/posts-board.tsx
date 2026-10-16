'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarDays, Flag, MapPin, Plus, Users } from 'lucide-react';
import { AksesPage, useAksesMode } from '@/components/features/akses-mode';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDateTime, rewardMessage, timeAgo } from '@/lib/format';
import { useAction, usePaged } from '@/lib/hooks';
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

export interface BoardKind {
  type: PostType;
  tab: string;
  /** Button for creating one. */
  create: string;
  /** What a neighbour presses to respond. */
  respond: string;
  responded: string;
  /** What the author presses once it really happened. */
  confirm: string;
  empty: string;
  xpNote: string;
}

/**
 * One board for Jiran (events, help) and Kongsi (give, lend). The flow is the
 * same in each: post, neighbours respond, the author confirms, XP is given.
 */
export function PostsBoard({ title, description, kinds }: { title: string; description: string; kinds: BoardKind[] }) {
  const akses = useAksesMode();
  const [type, setType] = useState<PostType>(kinds[0]!.type);
  const kind = kinds.find((k) => k.type === type)!;
  const posts = usePaged<Post>(`/posts?type=${type}&limit=12`);
  const [creating, setCreating] = useState(false);
  const [flagging, setFlagging] = useState<Post | null>(null);

  const reload = () => void posts.reload();
  const respond = useAction((id: string) => api.post(`/posts/${id}/respond`), { onSuccess: reload, success: 'Done. The person who posted has been told.' });
  const confirm = useAction((postId: string, userId: string) => api.post<{ reward: ActionRewardView | null }>(`/posts/${postId}/responses/${userId}/confirm`), {
    onSuccess: reload,
    success: (r) => (kind.type === 'GIVE' || kind.type === 'LEND' ? rewardMessage(r.reward, 'Confirmed.') : 'Confirmed. Their Impact XP has been added.'),
  });
  const close = useAction((id: string) => api.post(`/posts/${id}/close`), { onSuccess: reload, success: 'Closed.' });

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader
        title={title}
        description={description}
        action={
          <Button size={akses.simple ? 'lg' : 'md'} onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            <Text>{kind.create}</Text>
          </Button>
        }
      />
      <Tabs<PostType> label={title} value={type} onChange={setType} items={kinds.map((k) => ({ key: k.type, label: k.tab }))} />
      <TabPanel>
        {posts.error ? (
          <ErrorState error={posts.error} onRetry={reload} />
        ) : posts.isLoading ? (
          <SkeletonList rows={3} />
        ) : posts.items.length === 0 ? (
          <EmptyState title="Nothing here yet" action={<Button onClick={() => setCreating(true)}><Text>{kind.create}</Text></Button>}>
            <Text>{kind.empty}</Text>
          </EmptyState>
        ) : (
          <div className={`grid gap-4 ${akses.simple ? '' : 'md:grid-cols-2'} ${title === 'Jiran' ? 'community-post-grid' : 'sharing-post-grid'}`}>
            {posts.items.map((post, index) => (
              <Card key={post.id} className={`post-card-enter flex flex-col ${akses.simple ? 'p-6' : 'p-5'}`} style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
                <div className="flex flex-wrap items-center gap-2">
                  {post.by_township && <Badge tone="brand"><Text>Township</Text></Badge>}
                  {post.is_mine && <Badge><Text>Yours</Text></Badge>}
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
                          <Button size={akses.simple ? 'lg' : 'sm'} variant="secondary" onClick={() => confirm.run(post.id, r.user_id)} disabled={confirm.pending}>
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
                    post.status === 'OPEN' && (
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
            ))}
          </div>
        )}
        {posts.hasMore && (
          <div className="mt-5 text-center">
            <Button variant="secondary" onClick={() => void posts.loadMore()} pending={posts.loadingMore}><Text>Show more</Text></Button>
          </div>
        )}
      </TabPanel>

      <CreatePost kind={kind} open={creating} accessible={akses.guided} onClose={() => setCreating(false)} onCreated={reload} />
      <FlagPost post={flagging} onClose={() => setFlagging(null)} onFlagged={reload} />
    </AksesPage>
  );
}

function CreatePost({ kind, open, accessible, onClose, onCreated }: { kind: BoardKind; open: boolean; accessible: boolean; onClose: () => void; onCreated: () => void }) {
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
  const close = () => {
    setStep(0);
    setTitle('');
    setBody('');
    setLocation('');
    setStartsAt('');
    setCapacity('');
    setGuidedError('');
    onClose();
  };
  const create = useAction((body: Record<string, unknown>) => api.post('/posts', body), {
    success: 'Posted.',
    onSuccess: () => {
      onCreated();
      close();
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
      open={open}
      wide={accessible}
      className={accessible ? 'guided-modal' : undefined}
      onClose={close}
      title={kind.create}
      description={accessible ? t('Question {step} of {total}', { step: step + 1, total: steps.length }) : kind.xpNote}
      footer={
        <>
          {accessible && step > 0 && <Button size="lg" variant="secondary" onClick={() => setStep((current) => current - 1)}><Text>Back</Text></Button>}
          <Button size={accessible ? 'lg' : 'md'} variant="secondary" onClick={close}><Text>Cancel</Text></Button>
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
