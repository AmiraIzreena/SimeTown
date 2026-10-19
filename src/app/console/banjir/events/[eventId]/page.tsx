'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowLeft, Printer } from 'lucide-react';
import { use, useState } from 'react';
import { FloodBadge } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async } from '@/components/ui/feedback';
import { Checkbox, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { FLOOD_SOURCE_LABELS } from '@/shared/domain';
import { DECISION_WORDS, STEP_WORDS, type EventReport } from '../../types';

/**
 * The post-event report (proposal Appendix E.2, rule 10): the timeline, who was warned,
 * the check-in rate and the false-alarm review, from the audit trail. Printable.
 * Counts only: it names no resident.
 */
export default function FloodEventReportPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const report = useApi<EventReport>(`/admin/banjir/events/${eventId}`);
  const [note, setNote] = useState('');
  const [falseAlarm, setFalseAlarm] = useState(false);
  const review = useAction(() => api.post(`/admin/banjir/events/${eventId}/review`, { falseAlarm, note }), { onSuccess: () => void report.mutate(), success: 'Review saved.' });

  return (
    <div className="print-report">
      <PageHeader
        title="Post-event report"
        description="From the agent’s log and the audit trail. Counts only: no resident is named."
        action={
          <span className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" href="/console/banjir"><ArrowLeft className="size-4" aria-hidden /><Text>Flood dashboard</Text></Button>
            <Button onClick={() => window.print()}><Printer className="size-4" aria-hidden /><Text>Print</Text></Button>
          </span>
        }
      />
      <Async state={report}>
        {(r) => (
          <div className="space-y-6">
            <Card>
              <CardHeader
                title={r.event.zone_name}
                description={`${formatDateTime(r.event.started_at)} to ${r.event.ended_at ? formatDateTime(r.event.ended_at) : 'now (still open)'}`}
                action={<span className="flex items-center gap-2"><FloodBadge status={r.event.peak_status} />{r.event.peak_level_pct !== null && <span className="font-display text-xl font-bold tabular-nums"><Text>{r.event.peak_level_pct}</Text>%</span>}</span>}
              />
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Length" value={r.durationMin === null ? '–' : `${r.durationMin} min`} />
              <Stat label="Warning lead time" value={r.warningLeadMin === null ? '–' : `${r.warningLeadMin} min`} hint="From the first alert to danger." />
              <Stat label="People warned" value={r.event.people_warned} hint={`${r.smsSimulated} by SMS (simulated)`} />
              <Stat label="Checked in within 30 minutes" value={r.checkins.within30Pct === null ? '–' : `${r.checkins.within30Pct}%`} hint={`${r.checkins.safe} safe · ${r.checkins.need_help} needed help · ${r.checkins.residents} residents`} />
              <Stat label="Priority residents reached" value={`${r.help.reached} of ${r.help.tasks}`} hint={r.help.avg_reach_min === null ? undefined : `On average ${r.help.avg_reach_min} min after the first alert`} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Timeline" description="Every step of the agent and the officer, from 30 minutes before the first alert." />
                <ol className="space-y-2 p-5 text-sm">
                  {r.timeline.map((t) => (
                    <li key={t.id} className="grid grid-cols-[5.5rem_1fr] gap-3">
                      <span className="tabular-nums text-ink-500"><Text>{formatDateTime(t.at)}</Text></span>
                      <span>
                        <span className="font-medium text-ink-900"><Text>{STEP_WORDS[t.step] ?? t.step}</Text></span>
                        {typeof t.detail.level === 'string' && <span className="text-ink-600"> · <Text>{String(t.detail.level).toLowerCase()}</Text></span>}
                        {typeof t.detail.decision === 'string' && <span className="text-ink-600"> · <Text>{DECISION_WORDS[String(t.detail.decision)]}</Text></span>}
                        {t.actor_name && <span className="text-ink-600"> · {t.actor_name}</span>}
                        {typeof t.detail.reason === 'string' && t.detail.reason && <span className="block text-xs text-ink-600">“{String(t.detail.reason)}”</span>}
                      </span>
                    </li>
                  ))}
                  {r.timeline.length === 0 && <li className="text-ink-500"><Text>Nothing was logged.</Text></li>}
                </ol>
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Messages sent" />
                  <ul className="space-y-2 p-5 text-sm">
                    {r.messages.map((m) => (
                      <li key={m.id} className="rounded-md bg-ink-50 p-3">
                        <p className="font-medium text-ink-900"><Text>{m.what}</Text></p>
                        <p className="text-ink-700"><Text>{m.todo}</Text></p>
                        <p className="mt-1 text-xs text-ink-500"><Text>{formatDateTime(m.sent_at)}</Text> · <Text>{DECISION_WORDS[m.decision]}</Text>{m.decided_by_name && <> · {m.decided_by_name}</>}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Signals behind it" />
                  <ul className="space-y-1.5 p-5 text-sm">
                    {r.signals.map((s) => (
                      <li key={s.source} className="flex justify-between gap-3">
                        <span><Text>{FLOOD_SOURCE_LABELS[s.source]}</Text></span>
                        <span className="tabular-nums text-ink-600"><Text>{s.n}</Text><Text> readings</Text>{s.max_pct !== null && <> · <Text>highest </Text><Text>{s.max_pct}</Text>%</>}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader title="False-alarm review" description="Was this a real flood? The answer feeds the false-alarm rate in Insights." />
              <div className="space-y-4 p-5 text-sm">
                {r.event.reviewed_at ? (
                  <div className="space-y-1">
                    <Badge tone={r.event.false_alarm ? 'warning' : 'success'}><Text>{r.event.false_alarm ? 'False alarm' : 'Real flood'}</Text></Badge>
                    {r.event.review_note && <p className="text-ink-700"><Text>{r.event.review_note}</Text></p>}
                    <p className="text-xs text-ink-500"><Text>{formatDateTime(r.event.reviewed_at)}</Text>{r.event.reviewer && <> · {r.event.reviewer}</>}</p>
                  </div>
                ) : null}
                {r.event.ended_at ? (
                  <form
                    method="post"
                    className="no-print space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void review.run();
                    }}
                  >
                    <Checkbox label="This was a false alarm" checked={falseAlarm} onChange={(event) => setFalseAlarm(event.target.checked)} />
                    <Textarea label="What happened, and what to change" value={note} onChange={(event) => setNote(event.target.value)} rows={3} error={review.fields.note} />
                    <Button type="submit" pending={review.pending} disabled={note.trim().length < 3}><Text>{r.event.reviewed_at ? 'Update the review' : 'Save the review'}</Text></Button>
                  </form>
                ) : (
                  <p className="text-ink-500"><Text>The review opens after the all clear.</Text></p>
                )}
              </div>
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}
