'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, Flag, MessageSquare, RotateCcw, Truck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Async, EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { CATEGORY_LABELS, RESIDENT_STATUS, type IncidentStatus } from '@/shared/incidents';

interface Report {
  reference: string;
  category: string;
  status: IncidentStatus;
  summary: string;
  createdAt: string;
  outcome: string | null;
  awaitingYou: boolean;
  handled: boolean;
  canReopen: boolean;
  timeline: { kind: string; body: string | null; at: string; mine: boolean }[];
}
interface Referral {
  id: string;
  reason: string;
  tracking_no: string | null;
  ticket_ref: string | null;
  ticket_simulated: boolean;
  created_at: string;
  company: string | null;
  simulated: boolean;
  support: { name: string | null; url: string | null; phone: string | null } | null;
}

const TONE: Record<IncidentStatus, 'gold' | 'brand' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  OPEN: 'gold', ASSIGNED: 'brand', INVESTIGATING: 'brand', AWAITING_EXTERNAL_PARTY: 'warning', RESOLVED: 'success', REOPENED: 'danger', CLOSED: 'neutral',
};

/** What you reported to the township office and what it has told you, and the problems sent to courier companies. */
export default function MyReportsPage() {
  const data = useApi<{ disputeDays: number; reports: Report[]; referrals: Referral[] }>('/incidents/mine', { refreshInterval: 30_000 });
  return (
    <>
      <PageHeader title="My reports" description="Problems you reported to the township office, what is happening with each, and the ones that are for a courier company to handle." />
      <Async state={data} skeleton={<SkeletonList rows={3} />}>
        {(d) => (
          <div className="space-y-6">
            {d.reports.length === 0 && d.referrals.length === 0 && <EmptyState icon={Flag} title="No reports yet"><Text>Report a problem from Parcels or Tamu, and follow it here.</Text></EmptyState>}
            {d.reports.map((r) => <ReportCard key={r.reference} report={r} disputeDays={d.disputeDays} onChange={() => void data.mutate()} />)}
            {d.referrals.length > 0 && (
              <Card>
                <CardHeader title="For courier companies to handle" description="Delivery problems go to the courier company. The township office is not involved unless it is a township problem too." />
                <ul className="divide-y divide-ink-100">
                  {d.referrals.map((x) => (
                    <li key={x.id} className="space-y-1 px-5 py-3 text-[15px]">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                        <Truck className="size-4 text-brand-700" aria-hidden />{x.company ?? <Text>Courier company</Text>} · <Text>{CATEGORY_LABELS[x.reason] ?? x.reason}</Text>
                        {x.simulated && <Badge tone="neutral"><Text>Simulated company</Text></Badge>}
                      </p>
                      <p className="text-sm text-ink-600">
                        {x.tracking_no && <><span className="font-mono">{x.tracking_no}</span> · </>}<Text>{formatDateTime(x.created_at)}</Text>
                        {x.ticket_ref && <> · <Text>{x.ticket_simulated ? `Simulated reference ${x.ticket_ref}` : `Reference ${x.ticket_ref}`}</Text></>}
                      </p>
                      {x.support ? (
                        <p className="text-sm text-ink-700">
                          <Text>Contact:</Text> {x.support.name}{x.support.phone && ` · ${x.support.phone}`}
                          {x.support.url && <> · <a className="font-semibold text-brand-700 underline" href={x.support.url} target="_blank" rel="noopener noreferrer"><Text>support page</Text></a></>}
                        </p>
                      ) : (
                        <p className="text-sm text-ink-600"><Text>Use the contact in the courier’s own app or message, or ask the shop where you ordered.</Text></p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </Async>
    </>
  );
}

function ReportCard({ report: r, disputeDays, onChange }: { report: Report; disputeDays: number; onChange: () => void }) {
  const [reply, setReply] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const send = useAction(() => api.post(`/incidents/mine/${r.reference}/reply`, { body: reply.trim() }), {
    success: 'Sent to the township office.',
    onSuccess: () => {
      setReply('');
      onChange();
    },
  });
  const reopen = useAction(() => api.post(`/incidents/mine/${r.reference}/reopen`, { reason: reason.trim() }), {
    success: 'Reopened. The township office will look at it again.',
    onSuccess: () => {
      setReopening(false);
      setReason('');
      onChange();
    },
  });
  return (
    <Card id={r.reference} className="scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 p-5">
        <div>
          <p className="font-display text-lg font-bold text-ink-900"><Text>{CATEGORY_LABELS[r.category] ?? 'Report'}</Text></p>
          <p className="text-sm text-ink-500">{r.reference} · <Text>{formatDateTime(r.createdAt)}</Text></p>
        </div>
        <Badge tone={TONE[r.status]}><Text>{RESIDENT_STATUS[r.status]}</Text></Badge>
      </div>
      <div className="space-y-4 p-5">
        {r.outcome && (
          <div className="rounded-lg bg-success-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-700"><CheckCircle2 className="size-4" aria-hidden /><Text>Outcome</Text></p>
            <p className="mt-1 text-[15px] text-ink-800"><Text>{r.outcome}</Text></p>
          </div>
        )}
        <ol className="space-y-2">
          {r.timeline.map((e, i) => (
            <li key={i} className={cn('rounded-lg px-3 py-2 text-[15px]', e.mine ? 'ml-8 bg-brand-50 text-ink-800' : 'mr-8 bg-ink-50 text-ink-800', e.kind === 'INFO_REQUESTED' && 'border border-warning-600/30 bg-warning-50')}>
              <p className="text-xs text-ink-500"><Text>{e.mine ? 'You' : 'Township office'}</Text> · <Text>{formatDateTime(e.at)}</Text></p>
              {e.body && <p><Text>{e.body}</Text></p>}
            </li>
          ))}
        </ol>
        {!r.handled && (r.status === 'OPEN' || r.status === 'REOPENED') && <p className="text-sm text-ink-600"><Text>Waiting for someone in the township office to take it.</Text></p>}
        {r.status !== 'CLOSED' && r.status !== 'RESOLVED' && (
          <div className="space-y-2">
            <Textarea label={r.awaitingYou ? 'Your answer' : 'Add something'} value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1000} />
            <Button size="sm" onClick={() => void send.run()} pending={send.pending} disabled={reply.trim().length < 2}><MessageSquare className="size-4" aria-hidden /><Text>Send</Text></Button>
          </div>
        )}
        {r.canReopen && !reopening && <Button size="sm" variant="ghost" onClick={() => setReopening(true)}><RotateCcw className="size-4" aria-hidden /><Text>Not fixed? Reopen it</Text></Button>}
        {reopening && (
          <div className="space-y-2 rounded-lg border border-ink-200 p-4">
            <p className="text-sm text-ink-600"><Text>{`You can reopen a report within ${disputeDays} days of its outcome. The township office’s admins are told.`}</Text></p>
            <Textarea label="What is still wrong" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void reopen.run()} pending={reopen.pending} disabled={reason.trim().length < 5}><Text>Reopen</Text></Button>
              <Button size="sm" variant="ghost" onClick={() => setReopening(false)}><Text>Cancel</Text></Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
