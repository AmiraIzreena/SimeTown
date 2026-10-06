'use client';

import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Hidden {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  author_name: string;
  reasons: string[];
}

export default function ModerationPage() {
  const queue = useApi<Hidden[]>('/moderation/posts');
  const decide = useAction((id: string, action: 'RESTORE' | 'REMOVE') => api.post(`/moderation/posts/${id}`, { action }), { success: 'Done.', onSuccess: () => void queue.mutate() });
  return (
    <>
      <PageHeader title="Moderation" description="Posts flagged by three or more residents are hidden until someone here has looked at them." />
      <Async state={queue}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing to review">
              No posts are waiting.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {list.map((post) => (
                <li key={post.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">Hidden</Badge>
                      <span className="text-sm text-ink-500">
                        {post.author_name} · {timeAgo(post.created_at)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-[17px] font-semibold">{post.title}</h2>
                    <p className="mt-1 whitespace-pre-line text-[15px] text-ink-600">{post.body}</p>
                    <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                      <p className="font-semibold">Why residents flagged it</p>
                      <ul className="mt-1 list-disc pl-5">
                        {post.reasons.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => decide.run(post.id, 'RESTORE')} disabled={decide.pending}>
                        It is fine: restore
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => decide.run(post.id, 'REMOVE')} disabled={decide.pending}>
                        Remove
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
