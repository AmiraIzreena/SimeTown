'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarDays, MapPin } from 'lucide-react';
import { useState } from 'react';
import { KINDS } from '@/components/features/komuniti/model';
import { PostPhoto } from '@/components/features/komuniti/post-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { POST_FLAG_CATEGORY_LABELS, type PostFlagCategory, type PostStatus, type PostType } from '@/shared/domain';

export const STATUS_LABELS: Record<PostStatus, string> = { OPEN: 'Open', CLOSED: 'Closed', HIDDEN: 'Hidden for review', REMOVED: 'Removed' };
export const STATUS_TONES: Record<PostStatus, 'success' | 'neutral' | 'warning' | 'danger'> = { OPEN: 'success', CLOSED: 'neutral', HIDDEN: 'warning', REMOVED: 'danger' };

const RESPONSE_LABELS: Record<string, string> = { PENDING: 'Waiting', ACCEPTED: 'Accepted', DECLINED: 'Declined', CONFIRMED: 'Confirmed', RETURNED: 'Returned' };
const REPORT_STATUS: Record<string, { label: string; tone: 'danger' | 'neutral' | 'success' }> = {
  OPEN: { label: 'Waiting', tone: 'danger' },
  UPHELD: { label: 'Upheld', tone: 'success' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};
const SUSPENSION_DAYS = [3, 7, 30, 90];

interface Detail {
  id: string;
  type: PostType;
  title: string;
  body: string;
  location: string | null;
  starts_at: string | null;
  status: PostStatus;
  created_at: string;
  has_photo: boolean;
  township_name: string;
  author_id: string;
  author_name: string;
  by_township: boolean;
  moderated_at: string | null;
  moderation_note: string | null;
  moderated_by_name: string | null;
  responders: { user_id: string; name: string; status: string; due_back: string | null; overdue: boolean }[];
  reports: { user_id: string; reporter_name: string; category: PostFlagCategory; reason: string | null; status: string; created_at: string }[];
  author: { posts: number; removed: number; upheld_reports: number; suspension: { until: string; reason: string } | null };
}

type Decision = 'KEEP' | 'HIDE' | 'REMOVE';

/** One post in full, and what staff can do about it. */
export function PostReview({ id, canSuspend, onClose, onChanged }: { id: string | null; canSuspend: boolean; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<Detail>(id ? `/admin/komuniti/posts/${id}` : null);
  const changed = () => {
    void detail.mutate();
    onChanged();
  };
  return (
    <Modal open={id !== null} onClose={onClose} title="Review post" wide>
      <Async state={detail}>
        {(p) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[p.status]}><Text>{STATUS_LABELS[p.status]}</Text></Badge>
              <Badge><Text>{KINDS[p.type].group}</Text> · <Text>{KINDS[p.type].label}</Text></Badge>
              <span className="text-sm text-ink-500">{p.township_name} · <Text>{formatDateTime(p.created_at)}</Text></span>
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-ink-900">{p.title}</h3>
              <p className="mt-1 whitespace-pre-line text-[15px] text-ink-700">{p.body}</p>
              {p.has_photo && <PostPhoto postId={p.id} className="mt-3 max-h-96 w-full object-contain" />}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
                {p.starts_at && <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden /><Text>{formatDateTime(p.starts_at)}</Text></span>}
                {p.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{p.location}</span>}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-ink-25 p-3 text-sm text-ink-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Posted by</Text></p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">{p.author_name}{p.by_township && <> · <Text>Township</Text></>}</p>
                <p><Text>{`${p.author.posts} posts · ${p.author.removed} removed · ${p.author.upheld_reports} upheld reports`}</Text></p>
                {p.author.suspension && (
                  <p className="mt-1 font-semibold text-accent-700"><Text>{`Suspended until ${formatDate(p.author.suspension.until)}`}</Text></p>
                )}
              </div>
              <div className="rounded-lg bg-ink-25 p-3 text-sm text-ink-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Responses</Text></p>
                {p.responders.length === 0 ? (
                  <p className="mt-1"><Text>Nobody has responded.</Text></p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {p.responders.map((r) => (
                      <li key={r.user_id} className="flex flex-wrap items-center gap-2">
                        <span>{r.name}</span>
                        <Badge tone={r.overdue ? 'warning' : 'neutral'}><Text>{r.overdue ? 'Overdue' : RESPONSE_LABELS[r.status] ?? r.status}</Text></Badge>
                        {r.due_back && <span className="text-xs text-ink-500"><Text>{`Due ${formatDate(r.due_back)}`}</Text></span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>Reports</Text></p>
              {p.reports.length === 0 ? (
                <p className="text-sm text-ink-600"><Text>Nobody has reported this post.</Text></p>
              ) : (
                <ul className="space-y-2">
                  {p.reports.map((r) => (
                    <li key={r.user_id} className="rounded-lg border border-ink-200 p-3 text-sm text-ink-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={REPORT_STATUS[r.status]!.tone}><Text>{REPORT_STATUS[r.status]!.label}</Text></Badge>
                        <span className="font-semibold"><Text>{POST_FLAG_CATEGORY_LABELS[r.category]}</Text></span>
                        <span className="ml-auto text-xs text-ink-500">{r.reporter_name} · <Text>{timeAgo(r.created_at)}</Text></span>
                      </div>
                      {r.reason && <p className="mt-1">{r.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {p.moderated_at && (
              <p className="rounded-md bg-brand-50 p-3 text-sm text-brand-800">
                <Text>{`Last decision by ${p.moderated_by_name ?? 'staff'}, ${formatDateTime(p.moderated_at)}`}</Text>
                {p.moderation_note && <>: {p.moderation_note}</>}
              </p>
            )}

            <Decide post={p} onChanged={changed} />
            {canSuspend && !p.by_township && <SuspendAuthor post={p} onChanged={changed} />}
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Decide({ post, onChanged }: { post: Detail; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const decide = useAction((action: Decision) => api.post<{ status: PostStatus }>(`/admin/komuniti/posts/${post.id}/moderate`, { action, note: note.trim() || undefined }), {
    success: 'Saved. Everyone involved has been told.',
    onSuccess: () => {
      setNote('');
      onChanged();
    },
  });
  const waiting = post.reports.some((r) => r.status === 'OPEN');
  const visible = post.status === 'OPEN' || post.status === 'CLOSED';
  return (
    <div className="space-y-3 border-t border-ink-100 pt-4">
      <Textarea
        label="Note to the person who posted"
        name="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        hint="Needed to remove a post. They see this, so explain which rule it broke. Never say who reported it."
        error={decide.fields.note}
      />
      <div className="flex flex-wrap gap-2">
        {(waiting || !visible) && (
          <Button size="sm" variant="secondary" onClick={() => decide.run('KEEP')} disabled={decide.pending}>
            <Text>{visible ? 'It is fine: keep it' : 'It is fine: restore it'}</Text>
          </Button>
        )}
        {visible && <Button size="sm" variant="secondary" onClick={() => decide.run('HIDE')} disabled={decide.pending}><Text>Hide while checking</Text></Button>}
        {post.status !== 'REMOVED' && <Button size="sm" variant="danger" onClick={() => decide.run('REMOVE')} disabled={decide.pending}><Text>Remove</Text></Button>}
      </div>
    </div>
  );
}

/** Township admins and HQ: stop the author posting or responding for a while. */
function SuspendAuthor({ post, onChanged }: { post: Detail; onChanged: () => void }) {
  const suspend = useAction((days: number, reason: string) => api.post(`/admin/komuniti/suspensions/${post.author_id}`, { days, reason }), {
    success: 'Suspended. They have been told why and until when.',
    onSuccess: onChanged,
  });
  return (
    <form
      method="post"
      className="space-y-3 rounded-lg border border-accent-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void suspend.run(Number(data.get('days')), String(data.get('reason') ?? '').trim());
      }}
    >
      <p className="text-sm font-semibold text-ink-900">
        <Text>{post.author.suspension ? 'Change the suspension' : 'Suspend from Komuniti'}</Text>
      </p>
      <p className="text-sm text-ink-600"><Text>They can still read Komuniti, but cannot post or respond. Use this for repeated or serious problems.</Text></p>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Select label="For" name="days" defaultValue="7">
          {SUSPENSION_DAYS.map((d) => <option key={d} value={d}><Text>{`${d} days`}</Text></option>)}
        </Select>
        <Textarea label="Reason (they see this)" name="reason" maxLength={300} required error={suspend.fields.reason} />
      </div>
      <Button size="sm" variant="danger" type="submit" pending={suspend.pending}><Text>Suspend</Text></Button>
    </form>
  );
}
