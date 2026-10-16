'use client';

import { Text } from '@/components/ui/localized-text';

import { MessageCircleQuestionMark, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Handoff {
  id: string;
  question: string;
  status: 'OPEN' | 'ANSWERED';
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  resident: string;
  answered_by: string | null;
}

/**
 * Questions the Assistant could not answer, sent here only when the resident
 * tapped Yes. Staff see the question and who asked it, never the rest of the
 * chat. The answer appears in the resident's chat, with a notification.
 */
export default function AssistantQuestionsPage() {
  const list = useApi<Handoff[]>('/admin/assistant/handoffs');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const answer = useAction((id: string, text: string) => api.post(`/admin/assistant/handoffs/${id}/answer`, { answer: text }), {
    success: 'Sent. The resident sees it in their chat.',
    onSuccess: () => void list.mutate(),
  });
  const submit = (id: string) => (event: FormEvent) => {
    event.preventDefault();
    void answer.run(id, (drafts[id] ?? '').trim());
  };
  return (
    <>
      <PageHeader title="Assistant questions" description="Questions residents asked the SimeTown Assistant to pass to the township office. Your answer goes into their chat." />
      <Async state={list}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState icon={MessageCircleQuestionMark} title="No questions yet"><Text>Residents’ questions appear here when the Assistant hands them over.</Text></EmptyState>
          ) : (
            <ul className="space-y-3">
              {items.map((h) => (
                <li key={h.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={h.status === 'OPEN' ? 'warning' : 'success'}><Text>{h.status === 'OPEN' ? 'Waiting for an answer' : 'Answered'}</Text></Badge>
                      <span className="text-sm text-ink-500">
                        {h.resident} · <Text>{timeAgo(h.created_at)}</Text>
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-[15px] text-ink-900">{h.question}</p>
                    {h.status === 'ANSWERED' ? (
                      <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
                        <p className="whitespace-pre-line">{h.answer}</p>
                        <p className="mt-1 text-xs text-ink-500">
                          {h.answered_by} · <Text>{timeAgo(h.answered_at!)}</Text>
                        </p>
                      </div>
                    ) : (
                      <form method="post" onSubmit={submit(h.id)} className="mt-3 space-y-2" noValidate>
                        <Textarea
                          name="answer"
                          label="Your answer"
                          rows={3}
                          maxLength={2000}
                          value={drafts[h.id] ?? ''}
                          onChange={(event) => setDrafts((d) => ({ ...d, [h.id]: event.target.value }))}
                          error={answer.fields.answer}
                        />
                        <Button type="submit" size="sm" pending={answer.pending} disabled={(drafts[h.id] ?? '').trim().length < 2}>
                          <Send className="size-4" aria-hidden /><Text>Send answer</Text></Button>
                      </form>
                    )}
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
