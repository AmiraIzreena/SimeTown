'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedDialog, LocalizedImg } from '@/components/ui/localized-elements';

import { CalendarDays, EyeOff, Flag, MapPin, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, rewardMessage, timeAgo } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { ActionRewardView } from '@/lib/types';
import { KINDS, formatDay, today, type Post, type PostKind, type Responder } from './model';

type Size = 'sm' | 'lg';

/** One post in the feed: what it is, who responded (for the author), and what you can do. */
export function PostCard({ post, index, large, onChanged, onLend, onReport }: {
  post: Post;
  index: number;
  large: boolean;
  onChanged: () => void;
  onLend: (post: Post, responder: Responder) => void;
  onReport: (post: Post) => void;
}) {
  const kind = KINDS[post.type];
  const full = post.capacity !== null && post.responses >= post.capacity;
  const size: Size = large ? 'lg' : 'sm';
  const close = useAction(() => api.post(`/posts/${post.id}/close`), { onSuccess: onChanged, success: 'Closed.' });

  return (
    <Card className={`post-card-enter flex flex-col ${large ? 'p-6' : 'p-5'}`} style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
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
      <h3 className={`mt-3 font-semibold ${large ? 'text-xl' : 'text-[17px]'}`}>{post.title}</h3>
      <p className={`mt-1 flex-1 whitespace-pre-line text-ink-600 ${large ? 'text-lg' : 'text-[15px]'}`}>{post.body}</p>
      {post.has_photo && (post.photo_shown ? (
        <>
          <PostPhoto postId={post.id} className="mt-3" />
          {post.photo_held && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500"><EyeOff className="size-3.5" aria-hidden /><Text>Photo hidden while staff check it</Text></p>}
        </>
      ) : (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-ink-300 bg-ink-50 px-3 py-4 text-sm text-ink-600"><EyeOff className="size-4 shrink-0" aria-hidden /><Text>Photo hidden while staff check it</Text></p>
      ))}
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
            <ResponderRow key={r.user_id} post={post} kind={kind} responder={r} size={size} onChanged={onChanged} onLend={onLend} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {post.is_mine ? (
          post.status === 'OPEN' && (
            <Button size={size} variant="ghost" onClick={() => close.run()} disabled={close.pending}><Text>Close</Text></Button>
          )
        ) : (
          <MyResponse post={post} kind={kind} full={full} size={size} onChanged={onChanged} />
        )}
        {!post.is_mine && (
          <button type="button" onClick={() => onReport(post)} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-500 transition-colors duration-200 hover:text-accent-600">
            <Flag className="size-4" aria-hidden /><Text>Report post</Text></button>
        )}
      </div>
    </Card>
  );
}

/** The author's view of one neighbour who responded: accept, decline, confirm, mark returned. */
function ResponderRow({ post, kind, responder: r, size, onChanged, onLend }: {
  post: Post;
  kind: PostKind;
  responder: Responder;
  size: Size;
  onChanged: () => void;
  onLend: (post: Post, responder: Responder) => void;
}) {
  const t = useT();
  const path = `/posts/${post.id}/responses/${r.user_id}`;
  const confirm = useAction(() => api.post<{ reward: ActionRewardView | null }>(`${path}/confirm`), {
    onSuccess: onChanged,
    success: (res) => (post.type === 'LEND' ? 'Lent. Mark it returned when it comes back.' : post.type === 'GIVE' ? rewardMessage(res.reward, 'Confirmed.') : 'Confirmed. Their Impact XP has been added.'),
  });
  const accept = useAction(() => api.post(`${path}/accept`, {}), { onSuccess: onChanged, success: 'Accepted. They have been told.' });
  const decline = useAction(() => api.post(`${path}/decline`), { onSuccess: onChanged, success: 'Declined. They have been told.' });
  const returned = useAction(() => api.post<{ reward: ActionRewardView | null }>(`${path}/returned`), {
    onSuccess: onChanged,
    success: (res) => rewardMessage(res.reward, 'Marked returned.'),
  });
  const busy = confirm.pending || accept.pending || decline.pending || returned.pending;
  const onLoan = post.type === 'LEND' && r.status === 'CONFIRMED';
  const overdue = onLoan && r.due_back !== null && r.due_back < today();

  const confirmButton = <Button size={size} variant="secondary" onClick={() => confirm.run()} disabled={busy}><Text>{kind.confirm}</Text></Button>;
  const declineButton = <Button size={size} variant="ghost" onClick={() => decline.run()} disabled={busy}><Text>Decline</Text></Button>;

  let actions;
  if (post.type === 'EVENT') {
    actions = r.status === 'CONFIRMED' ? <Badge tone="success"><Text>Attended</Text></Badge> : confirmButton;
  } else if (r.status === 'PENDING') {
    actions = post.status === 'OPEN' && (
      <>
        <Button size={size} onClick={() => (post.type === 'LEND' ? onLend(post, r) : accept.run())} disabled={busy}><Text>Accept</Text></Button>
        {declineButton}
      </>
    );
  } else if (r.status === 'ACCEPTED') {
    actions = <>{confirmButton}{declineButton}</>;
  } else if (onLoan) {
    actions = (
      <>
        <Badge tone={overdue ? 'warning' : 'brand'}><Text>{overdue ? 'Overdue' : 'On loan'}</Text></Badge>
        <Button size={size} variant="secondary" onClick={() => returned.run()} disabled={busy}><Text>Mark returned</Text></Button>
      </>
    );
  } else {
    actions = r.status === 'DECLINED' ? <Badge><Text>Declined</Text></Badge> : <Badge tone="success"><Text>{r.status === 'RETURNED' ? 'Returned' : 'Confirmed'}</Text></Badge>;
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="font-medium text-ink-800">
        {r.name}
        {r.due_back && (r.status === 'ACCEPTED' || onLoan) && <span className="ml-2 font-normal text-ink-500">{t('Return by {date}', { date: t(formatDay(r.due_back)) })}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">{actions}</span>
    </li>
  );
}

/** A neighbour's view of someone else's post: respond, see where it stands, or take it back. */
function MyResponse({ post, kind, full, size, onChanged }: { post: Post; kind: PostKind; full: boolean; size: Size; onChanged: () => void }) {
  const t = useT();
  const respond = useAction(() => api.post(`/posts/${post.id}/respond`), { onSuccess: onChanged, success: 'Done. The person who posted has been told.' });
  const withdraw = useAction(() => api.post(`/posts/${post.id}/withdraw`), { onSuccess: onChanged, success: 'Cancelled. The person who posted has been told.' });
  const mine = post.my_response;

  if (mine === 'PENDING' || mine === 'ACCEPTED') {
    const started = post.type === 'EVENT' && post.starts_at !== null && new Date(post.starts_at) <= new Date();
    return (
      <>
        <Badge tone="brand"><Text>{mine === 'ACCEPTED' ? kind.accepted : kind.responded}</Text></Badge>
        {post.my_due_back && <span className="text-sm text-ink-500">{t('Return by {date}', { date: t(formatDay(post.my_due_back)) })}</span>}
        {!started && <Button size={size} variant="ghost" onClick={() => withdraw.run()} disabled={withdraw.pending}><Text>{kind.withdraw}</Text></Button>}
      </>
    );
  }
  if (mine === 'CONFIRMED') {
    if (post.type === 'LEND' && post.my_due_back) {
      const late = post.my_due_back < today();
      return (
        <Badge tone={late ? 'warning' : 'brand'}>
          {t(late ? 'Overdue: please return it ({date})' : 'Borrowed: return by {date}', { date: t(formatDay(post.my_due_back)) })}
        </Badge>
      );
    }
    return <Badge tone="success"><Text>Confirmed</Text></Badge>;
  }
  if (mine === 'DECLINED') return <Badge><Text>Not this time</Text></Badge>;
  if (post.status !== 'OPEN' || full) return null;
  return (
    <Button size={size} onClick={() => respond.run()} disabled={respond.pending}>
      <Text>{mine === 'RETURNED' ? 'Borrow again' : kind.respond}</Text>
    </Button>
  );
}

/**
 * A post's optional photo: every photo has the same 16:9 shape, cropped from the centre; a click opens the
 * whole picture. The server decides who may see it (township, author, staff), so the same address works everywhere.
 */
export function PostPhoto({ postId, className }: { postId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const src = `/api/v1/posts/${postId}/photo`;
  const alt = 'Photo attached to this post';
  return (
    <>
      <LocalizedButton type="button" onClick={() => setOpen(true)} className={cn('block aspect-video w-full cursor-zoom-in overflow-hidden rounded-lg border border-ink-200 bg-ink-100', className)}>
        <LocalizedImg src={src} alt={alt} loading="lazy" className="size-full object-cover object-center" />
        <span className="sr-only"><Text>Open larger</Text></span>
      </LocalizedButton>
      <PhotoViewer open={open} src={src} alt={alt} onClose={() => setOpen(false)} />
    </>
  );
}

/** The whole photo, uncropped, over the page. Native <dialog>: Escape, focus trapping and returning focus come free. */
function PhotoViewer({ open, src, alt, onClose }: { open: boolean; src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <LocalizedDialog
      ref={ref}
      className="photo-viewer"
      aria-label="Photo"
      // Only this dialog's own close, and a click on the dark area around the photo.
      onClose={(event) => event.target === ref.current && onClose()}
      onClick={(event) => event.target === ref.current && onClose()}
    >
      {open && (
        <>
          <LocalizedImg src={src} alt={alt} className="max-h-[calc(100dvh-5rem)] max-w-full object-contain" />
          <Button variant="secondary" size="sm" onClick={onClose} className="absolute top-4 right-4">
            <X className="size-4" aria-hidden /><Text>Close</Text>
          </Button>
        </>
      )}
    </LocalizedDialog>
  );
}
