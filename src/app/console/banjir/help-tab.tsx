'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedSelect } from '@/components/ui/localized-elements';

import { CheckCircle2, HeartPulse, PhoneCall, ShieldCheck, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { FloodBadge } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { HelpBoard } from './types';

/**
 * Tab 4: the residents to reach first while a zone is under an alert: the Akses+
 * priority list (with their consent) and anyone who said "I need help". Duty
 * staff send a guard and see when each one is reached. Duty staff only (BR32).
 */
export function HelpTab() {
  const board = useApi<HelpBoard>('/admin/banjir/help', { refreshInterval: 8_000 });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const assign = useAction((body: { eventId: string; userId: string; assignedTo: string }) => api.post('/admin/banjir/help-tasks', body), {
    onSuccess: () => void board.mutate(),
    success: 'Sent. The guard has the task on the gate screen.',
  });
  const reached = useAction((taskId: string) => api.post(`/banjir/help-tasks/${taskId}/reached`), { onSuccess: () => void board.mutate(), success: 'Marked reached.' });

  return (
    <Async state={board}>
      {(b) =>
        b.events.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No zone is under an alert"><Text>The priority help list appears here, for duty staff only, while a zone has a flood warning or danger alert.</Text></EmptyState>
        ) : (
          <div className="space-y-6">
            {b.events.map((e) => {
              const done = e.people.filter((p) => p.task?.status === 'REACHED').length;
              return (
                <Card key={e.id}>
                  <CardHeader title={e.zone_name} description={`Alert since ${formatDateTime(e.started_at)} · ${done} of ${e.people.length} reached`} action={<FloodBadge status={e.peak_status} />} />
                  {e.people.length === 0 ? (
                    <p className="p-5 text-sm text-ink-500"><Text>Nobody in this zone is on the priority list or has asked for help.</Text></p>
                  ) : (
                    <ul className="divide-y divide-ink-100">
                      {e.people.map((p) => {
                        const key = `${e.id}:${p.user_id}`;
                        const picked = choice[key] ?? p.task?.assigned_to ?? b.responders[0]?.id ?? '';
                        return (
                          <li key={p.user_id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                            <div className="min-w-0 space-y-1 text-sm">
                              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                                {p.checked_in === 'NEED_HELP' ? <HeartPulse className="size-4 text-accent-600" aria-hidden /> : <PhoneCall className="size-4 text-brand-700" aria-hidden />}
                                {p.full_name}
                                {p.checked_in === 'NEED_HELP' && <Badge tone="danger"><Text>Asked for help</Text></Badge>}
                                {p.checked_in === 'SAFE' && <Badge tone="success"><Text>Checked in safe</Text></Badge>}
                                {p.priority && <Badge tone="brand"><Text>Priority list</Text></Badge>}
                              </p>
                              <p className="text-ink-600"><Text>{p.address}</Text>{p.phone && <> · <a className="font-medium text-brand-700 underline" href={`tel:${p.phone}`}>{p.phone}</a></>}</p>
                              {p.priority_note && <p className="text-ink-500"><Text>{p.priority_note}</Text></p>}
                              {p.task && (
                                <p className="flex items-center gap-1.5 text-ink-600">
                                  {p.task.status === 'REACHED' ? <CheckCircle2 className="size-4 text-success-700" aria-hidden /> : <UserCheck className="size-4 text-ink-500" aria-hidden />}
                                  <Text>{p.task.status === 'REACHED' ? 'Reached by ' : 'On the way: '}</Text>{p.task.assignee}
                                  <span className="text-xs text-ink-500">· <Text>{timeAgo(p.task.reached_at ?? p.task.created_at)}</Text></span>
                                </p>
                              )}
                            </div>
                            {p.task?.status !== 'REACHED' && (
                              <div className="flex flex-wrap items-center gap-2">
                                <LocalizedSelect aria-label="Who goes" className="control h-10 w-48" value={picked} onChange={(event) => setChoice({ ...choice, [key]: event.target.value })}>
                                  {b.responders.map((r) => (
                                    <option key={r.id} value={r.id}>{r.full_name}</option>
                                  ))}
                                </LocalizedSelect>
                                <Button size="sm" disabled={!picked || assign.pending} onClick={() => void assign.run({ eventId: e.id, userId: p.user_id, assignedTo: picked })}>
                                  <Text>{p.task ? 'Reassign' : 'Send'}</Text>
                                </Button>
                                {p.task && (
                                  <Button size="sm" variant="secondary" disabled={reached.pending} onClick={() => void reached.run(p.task!.id)}>
                                    <Text>Mark reached</Text>
                                  </Button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })}
            <p className="text-xs text-ink-500"><Text>Shown to duty staff only while a zone is under an alert, with the residents’ consent (BR32). Assigning a guard puts the task on their gate screen.</Text></p>
          </div>
        )
      }
    </Async>
  );
}
