'use client';

import { Text } from '@/components/ui/localized-text';

import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/field';
import { DataTable } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { ADMINS, formatPoints, formatRM } from '@/shared/domain';
import { DEMO_MODE } from '@/lib/demo';

type Tab = 'float' | 'payments' | 'corrections';
interface FloatOverview {
  position: { trustSen: number; walletsSen: number; payablesSen: number; poolsSen: number; communitySen: number; lotsSen: number };
  checks: { id: number; checked_at: string; trust_sen: number; bank_statement_sen: number | null; ok: boolean; issues: string[] }[];
  paused: boolean;
}
interface Settlement {
  id: string;
  merchant_name: string;
  period_start: string;
  period_end: string;
  amount_sen: number;
  paid_at: string;
}
interface Adjustment {
  id: string;
  points: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  requested_by: string;
  member_name: string;
  member_code: string;
  requested_by_name: string;
  decided_by_name: string | null;
}

export default function FinancePage() {
  const me = useApi<Me>('/me');
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const [tab, setTab] = useState<Tab>('float');
  return (
    <>
      <PageHeader title="Float & payments" description="The reward float is kept apart from SimeTown’s own money. It must always equal the points residents hold plus everything else it owes." />
      <Tabs<Tab> label="Finance sections" value={tab} onChange={setTab} items={[{ key: 'float', label: 'Float check' }, { key: 'payments', label: 'Payments to shops' }, ...(isAdmin ? [{ key: 'corrections' as const, label: 'Corrections' }] : [])]} />
      <TabPanel>{tab === 'float' ? <FloatTab isAdmin={isAdmin} /> : tab === 'payments' ? <PaymentsTab isAdmin={isAdmin} /> : <CorrectionsTab myId={me.data?.id} />}</TabPanel>
    </>
  );
}

function FloatTab({ isAdmin }: { isAdmin: boolean }) {
  const float = useApi<FloatOverview>('/finance/float');
  const [statement, setStatement] = useState('');
  const check = useAction(() => api.post<{ ok: boolean; issues: string[] }>('/finance/float/check', { bankStatementSen: statement ? (parseRM(statement) ?? undefined) : undefined }), {
    onSuccess: () => void float.mutate(),
    success: (r) => (r.ok ? 'Float check passed: matched to the sen.' : null),
  });
  const deposit = useAction((body: { amountSen: number | null; bankRef: string }) => api.post('/finance/community-pool/deposits', body), { success: 'Recorded.', onSuccess: () => void float.mutate() });

  return (
    <Async state={float}>
      {(f) => {
        const p = f.position;
        const owed = p.walletsSen + p.payablesSen + p.poolsSen + p.communitySen;
        const matched = p.trustSen === owed && p.lotsSen === p.walletsSen;
        return (
          <div className="space-y-5">
            {f.paused && (
              <Card className="flex gap-3 border-accent-200 bg-accent-50 p-5 text-[15px] text-accent-700">
                <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                <p>
                  <strong><Text>Points are paused.</Text></strong><Text> A float check failed, so no points can be given or spent until the cause is found. An SDP HQ admin resumes points under Rules.</Text></p>
              </Card>
            )}
            <Card>
              <CardHeader
                title="Where the float stands now"
                action={
                  <span className={`status-settle inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${matched ? 'bg-success-50 text-success-700' : 'bg-accent-50 text-accent-700'}`}>
                    <ShieldCheck className="size-4" aria-hidden />
                    <Text>{matched ? 'Matched to the sen' : 'Does not match'}</Text>
                  </span>
                }
              />
              <dl className="divide-y divide-ink-100 text-[15px]">
                {[
                  ['Points residents hold', p.walletsSen],
                  ['Owed to shops (paid at the next settlement)', p.payablesSen],
                  ['Paid in by shops and campaigns, not yet given as points', p.poolsSen],
                  ['Community pool', p.communitySen],
                ].map(([label, value], i) => (
                  <div key={label as string} style={{ '--i': i } as CSSProperties} className="value-line flex items-center justify-between gap-4 px-5 py-3">
                    <dt className="text-ink-600"><Text>{label}</Text></dt>
                    <dd className="font-semibold tabular-nums text-ink-900"><Text>{formatRM(value as number)}</Text></dd>
                  </div>
                ))}
                <div style={{ '--i': 4 } as CSSProperties} className="value-line flex items-center justify-between gap-4 bg-ink-25 px-5 py-3">
                  <dt className="font-semibold text-ink-900"><Text>The float owes</Text></dt>
                  <dd className="font-display text-lg font-bold tabular-nums text-ink-900"><CountUp value={owed} format={formatRM} /></dd>
                </div>
                <div style={{ '--i': 5 } as CSSProperties} className="value-line flex items-center justify-between gap-4 bg-ink-25 px-5 py-3">
                  <dt className="font-semibold text-ink-900"><Text>The float holds</Text></dt>
                  <dd className="font-display text-lg font-bold tabular-nums text-ink-900"><CountUp value={p.trustSen} format={formatRM} /></dd>
                </div>
              </dl>
            </Card>

            {isAdmin && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Run the check now" description="It runs every day on its own. You can also compare against the bank statement." />
                  <form method="post"
                    className="flex flex-wrap items-end gap-3 p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void check.run();
                    }}
                  >
                    <Input label="Trust account balance on the bank statement (RM, optional)" value={statement} onChange={(event) => setStatement(event.target.value)} inputMode="decimal" className="min-w-0 flex-1 basis-64" />
                    <Button type="submit" pending={check.pending}><Text>Run check</Text></Button>
                  </form>
                </Card>
                <Card>
                  <CardHeader title="Community pool" description="Record money Sime Darby Property pays in for corrections and community rewards." />
                  <form method="post"
                    className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault();
                      const element = event.currentTarget;
                      const form = Object.fromEntries(new FormData(element)) as Record<string, string>;
                      void deposit.run({ amountSen: parseRM(form.amount ?? ''), bankRef: form.bankRef! }).then((ok) => ok && element.reset());
                    }}
                  >
                    <Input label="Amount (RM)" name="amount" inputMode="decimal" required error={deposit.fields.amountSen} />
                    <Input label="Bank reference" name="bankRef" required error={deposit.fields.bankRef} />
                    <Button type="submit" variant="secondary" pending={deposit.pending}><Text>Record</Text></Button>
                  </form>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader title="Recent checks" />
              {f.checks.length === 0 ? (
                <p className="p-5 text-[15px] text-ink-500"><Text>No checks have run yet.</Text></p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {f.checks.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-[15px]">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden /> : <XCircle className="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink-900">
                          <Text>{c.ok ? 'Passed' : 'Failed'}</Text><Text> · float </Text><Text>{formatRM(c.trust_sen)}</Text>
                          <Text>{c.bank_statement_sen !== null && ` · bank statement ${formatRM(c.bank_statement_sen)}`}</Text>
                        </p>
                        {c.issues.map((issue) => (
                          <p key={issue} className="text-sm text-accent-700">
                            <Text>{issue}</Text>
                          </p>
                        ))}
                      </div>
                      <span className="text-sm text-ink-500"><Text>{formatDateTime(c.checked_at)}</Text></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </Async>
  );
}

function PaymentsTab({ isAdmin }: { isAdmin: boolean }) {
  const settlements = useApi<Settlement[]>('/finance/settlements');
  const float = useApi<FloatOverview>('/finance/float');
  const [confirming, setConfirming] = useState(false);
  const run = useAction(() => api.post<{ merchants: number; totalSen: number }>('/finance/settlements/run'), {
    success: (r) => (r.totalSen > 0 ? `Paid ${formatRM(r.totalSen)} to ${r.merchants} shop(s).` : 'Nothing was due.'),
    onSuccess: () => {
      setConfirming(false);
      void settlements.mutate();
      void float.mutate();
    },
  });
  const due = float.data?.position.payablesSen ?? 0;
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-ink-500"><Text>Owed to shops now</Text></p>
          <p className="font-display text-3xl font-bold tabular-nums text-ink-900"><Text>{formatRM(due)}</Text></p>
          <p className="mt-1 text-sm text-ink-500"><Text>Shops are paid 100% of the points they accept, every week.</Text>{DEMO_MODE && <> <Text>Demo environment: payments are recorded, not sent.</Text></>}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setConfirming(true)} disabled={due === 0}><Text>Run settlement</Text></Button>
        )}
      </Card>
      <Async state={settlements}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No payments yet"><Text>The weekly settlement pays every shop what it is owed.</Text></EmptyState>
          ) : (
            <DataTable
              caption="Payments to shops"
              rows={list}
              keyOf={(s) => s.id}
              columns={[
                { header: 'Shop', cell: (s) => <span className="font-medium text-ink-900">{s.merchant_name}</span> },
                { header: 'Period', cell: (s) => `${formatDate(s.period_start)} – ${formatDate(s.period_end)}` },
                { header: 'Paid', align: 'right', cell: (s) => formatRM(s.amount_sen) },
                { header: 'Paid on', cell: (s) => formatDateTime(s.paid_at) },
              ]}
            />
          )
        }
      </Async>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} onConfirm={() => void run.run()} title="Run the settlement?" confirmLabel="Pay shops" pending={run.pending}>
        <p><Text>Every shop is paid what it is owed, </Text><strong><Text>{formatRM(due)}</Text></strong><Text> in total, from the reward float. Each shop gets a statement.</Text></p>
      </ConfirmDialog>
    </div>
  );
}

function CorrectionsTab({ myId }: { myId?: string }) {
  const adjustments = useApi<Adjustment[]>('/finance/adjustments');
  const request = useAction((body: { memberCode: string; points: number; reason: string }) => api.post('/finance/adjustments', body), {
    success: 'Request recorded. A second admin must approve it.',
    onSuccess: () => void adjustments.mutate(),
  });
  const decide = useAction((id: string, approve: boolean) => api.post(`/finance/adjustments/${id}/decision`, { approve }), { success: 'Saved.', onSuccess: () => void adjustments.mutate() });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = Object.fromEntries(new FormData(element)) as Record<string, string>;
    void request.run({ memberCode: form.memberCode!, points: Number(form.points), reason: form.reason! }).then((ok) => ok && element.reset());
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Request a correction" description="A points balance cannot be changed by one person. A second admin approves every request, and both steps are logged." />
        <form method="post" onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
          <Input label="Member code" name="memberCode" maxLength={12} autoCapitalize="characters" required error={request.fields.memberCode} />
          <Input label="Points to add (or remove, with a minus sign)" name="points" type="number" step={1} required error={request.fields.points} />
          <Textarea label="Reason" name="reason" maxLength={300} required error={request.fields.reason} className="sm:col-span-2" hint="At least 10 characters. This is kept in the audit trail." />
          <div>
            <Button type="submit" pending={request.pending}><Text>Send for approval</Text></Button>
          </div>
        </form>
      </Card>
      <Async state={adjustments}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No corrections"><Text>Requests and their approvals appear here.</Text></EmptyState>
          ) : (
            <ul className="space-y-3">
              {list.map((a) => (
                <li key={a.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-ink-900">
                        <Text>{a.points > 0 ? '+' : '−'}</Text>
                        <Text>{formatPoints(Math.abs(a.points))}</Text><Text> points · </Text><Text>{a.member_name}</Text> (<Text>{a.member_code}</Text>)
                      </p>
                      <p className="text-sm text-ink-600">{a.reason}</p>
                      <p className="text-sm text-ink-500"><Text>Requested by </Text><Text>{a.requested_by_name}</Text> · <Text>{formatDateTime(a.created_at)}</Text>
                        <Text>{a.decided_by_name && ` · decided by ${a.decided_by_name}`}</Text>
                      </p>
                    </div>
                    {a.status !== 'PENDING' ? (
                      <Badge tone={a.status === 'APPROVED' ? 'success' : 'neutral'}><Text>{a.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Text></Badge>
                    ) : a.requested_by === myId ? (
                      <Badge tone="warning"><Text>Needs a second admin</Text></Badge>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => decide.run(a.id, true)} disabled={decide.pending}><Text>Approve</Text></Button>
                        <Button size="sm" variant="secondary" onClick={() => decide.run(a.id, false)} disabled={decide.pending}><Text>Reject</Text></Button>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </div>
  );
}
