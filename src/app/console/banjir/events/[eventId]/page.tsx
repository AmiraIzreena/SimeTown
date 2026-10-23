'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowLeft, Bot, Printer, UserRound } from 'lucide-react';
import { use, useState } from 'react';
import { FloodBadge } from '@/components/features/flood';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async } from '@/components/ui/feedback';
import { Checkbox, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { FLOOD_SOURCE_LABELS, ROLE_LABELS, type FloodStatus } from '@/shared/domain';
import { DECISION_WORDS, STEP_WORDS, type EventReport } from '../../types';

type TimelineEntry = EventReport['timeline'][number];
type Message = EventReport['messages'][number];

/** Folds a run of messages with the same words (the 15-minute updates) into one, with how many and until when. */
function foldMessages(messages: Message[]) {
  const rows: { m: Message; count: number; lastAt: string }[] = [];
  for (const m of messages) {
    const prev = rows.at(-1);
    if (prev && prev.m.kind === m.kind && prev.m.level === m.level && prev.m.what === m.what && prev.m.todo === m.todo) {
      prev.count++;
      prev.lastAt = m.sent_at;
    } else rows.push({ m, count: 1, lastAt: m.sent_at });
  }
  return rows;
}

/** What each step means, in one plain sentence. The level, where there is one, is shown beside it. */
const STEP_MEANING: Record<string, string> = {
  ALERT_SENT: 'Sent to everyone in the zone, the duty team and residents’ carers.',
  ALL_CLEAR_SENT: 'The water is back to normal; residents were told they can return.',
  DRAFTED: 'Only one signal showed this, so it waited for a person to confirm.',
  DRAFT_DROPPED: 'The draft was withdrawn before anyone was told.',
  OFFICER_CONFIRMED: 'The duty officer sent the draft.',
  OFFICER_CANCELLED: 'The duty officer stopped the draft; residents were not told.',
  SECOND_CHECK: 'A second signal or a second staff member backed the warning, so residents now see it as confirmed.',
  ESCALATED: 'Nobody answered within 3 minutes and the water was still rising, so it was sent.',
  UNANSWERED: 'Nobody confirmed within 5 minutes, so the township admins were told.',
  UPDATE_SENT: 'Scheduled update to residents, as promised in the last message.',
  SMS_QUEUED: 'Text messages recorded for residents (simulated: no SMS provider in the prototype).',
};

/** Who acted: the agent and the schedule are automatic; a person is named with their role. */
function actorOf(t: TimelineEntry): { who: string; role: string | null; automatic: boolean } {
  if (t.actor_name) return { who: t.actor_name, role: t.actor_role ? `${ROLE_LABELS[t.actor_role]}${t.actor_role === 'TOWNSHIP_STAFF' || t.actor_role === 'TOWNSHIP_ADMIN' ? ', duty officer' : ''}` : null, automatic: false };
  if (t.step === 'UPDATE_SENT') return { who: 'Schedule', role: 'automatic, every 15 minutes', automatic: true };
  return { who: 'Banjir agent', role: 'automatic rules', automatic: true };
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

/**
 * The event timeline, organised: grouped by day, each step with who acted (and their role), the level,
 * what the step means and any reason given. A run of identical scheduled updates is folded into one line,
 * so a long event stays readable without hiding that the updates went out.
 */
function EventTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="p-5 text-sm text-ink-500"><Text>Nothing was logged.</Text></p>;
  // Fold consecutive scheduled updates at the same level.
  const rows: { first: TimelineEntry; last: TimelineEntry; count: number }[] = [];
  for (const t of entries) {
    const prev = rows.at(-1);
    if (prev && t.step === 'UPDATE_SENT' && prev.first.step === 'UPDATE_SENT' && prev.first.detail.level === t.detail.level && dayOf(prev.first.at) === dayOf(t.at)) {
      prev.last = t;
      prev.count++;
    } else rows.push({ first: t, last: t, count: 1 });
  }
  const days = [...new Set(rows.map((row) => dayOf(row.first.at)))];
  return (
    <div className="space-y-4 p-5">
      {days.map((day) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>{day}</Text></h3>
          <ol className="space-y-2">
            {rows.filter((row) => dayOf(row.first.at) === day).map(({ first: t, last, count }) => {
              const actor = actorOf(t);
              const level = typeof t.detail.level === 'string' ? (t.detail.level as FloodStatus) : null;
              const reason = typeof t.detail.reason === 'string' && t.detail.reason ? t.detail.reason : null;
              const people = typeof t.detail.people === 'number' ? t.detail.people : null;
              return (
                <li key={t.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 rounded-lg border border-ink-100 bg-white/60 px-3 py-2.5 text-sm">
                  <span className="tabular-nums text-ink-500">
                    <Text>{timeOf(t.at)}</Text>
                    {count > 1 && <span className="block text-xs"><Text>{`to ${timeOf(last.at)}`}</Text></span>}
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900"><Text>{count > 1 ? `${count} scheduled updates sent` : (STEP_WORDS[t.step] ?? t.step)}</Text></span>
                      {level && <FloodBadge status={level} />}
                      {typeof t.detail.decision === 'string' && DECISION_WORDS[t.detail.decision] && <Badge><Text>{DECISION_WORDS[t.detail.decision]}</Text></Badge>}
                    </span>
                    <span className="block text-ink-600"><Text>{STEP_MEANING[t.step] ?? ''}</Text>{people !== null && <Text>{` ${people} people.`}</Text>}</span>
                    {reason && <span className="block rounded-md bg-ink-50 px-2.5 py-1.5 text-xs text-ink-700"><Text>Reason: </Text>“<Text>{reason}</Text>”</span>}
                    <span className="flex items-center gap-1.5 text-xs text-ink-500">
                      {actor.automatic ? <Bot className="size-3.5" aria-hidden /> : <UserRound className="size-3.5" aria-hidden />}
                      <span className="font-medium text-ink-700"><Text>{actor.who}</Text></span>
                      {actor.role && <Text>{`· ${actor.role}`}</Text>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

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
                // The event's highest point, labelled so it is not mistaken for the level now.
                action={
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500"><Text>Peak</Text></span>
                    <FloodBadge status={r.event.peak_status} />
                    {r.event.peak_level_pct !== null && <span className="font-display text-xl font-bold tabular-nums"><Text>{r.event.peak_level_pct}</Text>%</span>}
                  </span>
                }
              />
            </Card>

            {/* Five figures: one row on wide screens; on narrower ones the length spans the top so no tile sits alone. */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="sm:col-span-2 xl:col-span-1 [&>*]:h-full">
                <Stat label="Length" value={r.durationMin === null ? '–' : formatDuration(r.durationMin)} hint={r.event.ended_at ? undefined : 'Still open: it ends with the all clear.'} />
              </div>
              {/* Lead time is measured to danger. With no danger, a short figure and the reason in the hint keep the tile the same shape as the others. */}
              <Stat
                label="Warning lead time"
                value={r.warningLeadMin !== null ? formatDuration(r.warningLeadMin) : r.event.first_danger_at ? '–' : r.event.ended_at ? 'None' : 'Not yet'}
                hint={r.warningLeadMin !== null || r.event.first_danger_at ? 'From the first alert to danger.' : r.event.ended_at ? 'It stayed at warning and never reached danger.' : 'It has not reached danger. Measured from the first alert to danger.'}
              />
              <Stat label="People warned" value={r.event.people_warned} hint={`${r.smsSimulated} by SMS (simulated)`} />
              <Stat label="Checked in within 30 minutes" value={r.checkins.within30Pct === null ? '–' : `${r.checkins.within30Pct}%`} hint={`${r.checkins.safe} safe · ${r.checkins.need_help} needed help · ${r.checkins.residents} residents`} />
              {/* The same count as the Priority help tab: residents on the priority list, and how many were reached. */}
              <Stat
                label="Priority residents reached"
                value={r.priorityResidents === 0 ? 'None listed' : `${r.help.reached} of ${r.priorityResidents}`}
                hint={
                  r.priorityResidents === 0
                    ? 'No resident in this zone is on the priority help list.'
                    : r.help.avg_reach_min !== null
                      ? `On average ${r.help.avg_reach_min} min after the first alert`
                      : r.help.tasks === 0
                        ? 'Nobody has been sent to them yet (Priority help tab).'
                        : `${r.help.tasks} sent so far`
                }
              />
            </div>

            {/* The timeline is long; messages and signals stay in view beside it while it scrolls. */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
              <Card>
                <CardHeader title="Timeline" description={`Every step for ${r.event.zone_name}, the whole zone, from 30 minutes before the first alert. Who acted, and why.`} />
                <EventTimeline entries={r.timeline} />
              </Card>
              <div className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2 print:static print:max-h-none print:overflow-visible">
                {/* The one thing staff act on here, so it leads the column and never sinks below a long timeline. */}
                <Card>
                  <CardHeader
                    title="False-alarm review"
                    description="Was this a real flood? The answer feeds the false-alarm rate in Insights."
                    action={
                      r.event.reviewed_at
                        ? <Badge tone="success"><Text>Reviewed</Text></Badge>
                        : r.event.ended_at
                          ? <Badge tone="warning"><Text>Needs review</Text></Badge>
                          : <Badge><Text>After the all clear</Text></Badge>
                    }
                  />
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
                <Card>
                  <CardHeader title="Messages sent" description={`What residents of ${r.event.zone_name} read, in order. Identical updates in a row are shown once.`} />
                  <ul className="space-y-2 p-5 text-sm">
                    {foldMessages(r.messages).map(({ m, count, lastAt }) => (
                      <li key={m.id} className="space-y-1 rounded-md bg-ink-50 p-3">
                        <p className="flex flex-wrap items-center gap-2">
                          <FloodBadge status={m.level} />
                          <Badge><Text>{m.kind === 'UPDATE' ? 'Update' : m.kind === 'ALL_CLEAR' ? 'All clear' : 'Alert'}</Text></Badge>
                          {count > 1 && <Badge tone="brand"><Text>{`Sent ${count} times`}</Text></Badge>}
                        </p>
                        <p className="font-medium text-ink-900"><Text>{m.what}</Text></p>
                        <p className="text-ink-700"><Text>{m.todo}</Text></p>
                        {m.where_text && <p className="text-xs text-ink-600"><span className="font-semibold"><Text>Where: </Text></span><Text>{m.where_text}</Text></p>}
                        <p className="text-xs text-ink-500">
                          <Text>{formatDateTime(m.sent_at)}</Text>
                          {count > 1 && <Text>{` to ${formatDateTime(lastAt)}`}</Text>}
                          {' · '}<Text>{DECISION_WORDS[m.decision] ?? m.decision}</Text>
                          {m.decided_by_name && <> · <Text>{m.decided_by_name}</Text>{m.decided_by_role && <Text>{` (${ROLE_LABELS[m.decided_by_role]})`}</Text>}</>}
                        </p>
                      </li>
                    ))}
                    {r.messages.length === 0 && <li className="text-ink-500"><Text>No messages were sent.</Text></li>}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Signals behind it" />
                  <ul className="space-y-1.5 p-5 text-sm">
                    {r.signals.map((s) => (
                      <li key={s.source} className="flex justify-between gap-3">
                        <span><Text>{FLOOD_SOURCE_LABELS[s.source]}</Text></span>
                        <span className="tabular-nums text-ink-600"><Text>{s.n === 1 ? '1 reading' : `${s.n} readings`}</Text>{s.max_pct !== null && <> · <Text>highest </Text><Text>{s.max_pct}</Text>%</>}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}
