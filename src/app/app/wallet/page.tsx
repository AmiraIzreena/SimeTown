'use client';

import { Award, Clock, QrCode as QrIcon } from 'lucide-react';
import { useState } from 'react';
import { PendingRedemption } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, ErrorState, Skeleton, SkeletonList } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi, usePaged } from '@/lib/hooks';
import type { SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface Wallet {
  points: number;
  xp: number;
  level: { level: number; name: string; floor: number; next: number };
  memberCode: string;
  badges: { id: string; label: string; hint: string; earned: boolean; progress: number; need: number }[];
  limits: { dayUsed: number; dayMax: number; monthUsed: number; monthMax: number };
  expiring: { points: number; date: string } | null;
  rules: { minRedeem: number; maxRedeemBps: number; inactiveMonths: number; maxMonths: number };
  pending: SaleView[];
}
interface Movement {
  id: number;
  kind: string;
  label: string;
  points: number;
  created_at: string;
}

const KIND_WORDS: Record<string, string> = {
  ISSUE: 'Earned',
  REDEEM: 'Spent',
  EXPIRE: 'Expired',
  REFUND_CLAWBACK: 'Taken back',
  REFUND_RETURN: 'Returned',
  ADJUSTMENT: 'Correction',
};

type Tab = 'history' | 'badges' | 'rules';

export default function WalletPage() {
  const wallet = useApi<Wallet>('/wallet', { refreshInterval: 5_000 });
  const history = usePaged<Movement>('/wallet/history?limit=15');
  const [tab, setTab] = useState<Tab>('history');
  const [showCode, setShowCode] = useState(false);

  return (
    <>
      <PageHeader title="Points & XP" description="Points are worth money at township shops. Impact XP has no money value: it is your record of good actions." />
      <Async state={wallet} skeleton={<Skeleton className="h-44 rounded-xl" />}>
        {(w) => (
          <div className="space-y-5">
            {w.pending.map((sale) => (
              <PendingRedemption
                key={sale.id}
                sale={sale}
                onDecided={() => {
                  void wallet.mutate();
                  void history.reload();
                }}
              />
            ))}

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-brand-100">KITA Points</p>
                    <p className="mt-2 font-display text-5xl font-bold leading-none tracking-tight tabular-nums">
                      <CountUp value={w.points} />
                    </p>
                    <p className="mt-2 text-[15px] text-brand-100">Worth {formatRM(w.points)} · 100 points = RM1</p>
                  </div>
                  <Button variant="light" onClick={() => setShowCode(true)}>
                    <QrIcon className="size-4" aria-hidden />
                    Show my code
                  </Button>
                </div>
                {w.expiring && (
                  <p className="mt-5 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm">
                    <Clock className="size-4 shrink-0" aria-hidden />
                    {formatPoints(w.expiring.points)} points expire from {formatDate(w.expiring.date)}. Use them at any member shop.
                  </p>
                )}
              </div>
              <Card className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink-500">Impact XP</p>
                  <Badge tone="brand">
                    Level {w.level.level} · {w.level.name}
                  </Badge>
                </div>
                <p className="mt-2 font-display text-4xl font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                  <CountUp value={w.xp} />
                </p>
                <div className="mt-4">
                  <Progress value={w.xp - w.level.floor} max={w.level.next - w.level.floor} label="Progress to the next level" />
                  <p className="mt-1.5 text-sm text-ink-500">{w.level.next - w.xp} XP to the next level</p>
                </div>
              </Card>
            </div>

            <Tabs<Tab> label="Wallet sections" value={tab} onChange={setTab} items={[{ key: 'history', label: 'History' }, { key: 'badges', label: 'Badges', count: w.badges.filter((b) => b.earned).length }, { key: 'rules', label: 'Rules & limits' }]} />

            {tab === 'history' && (
              <TabPanel>
                {history.error ? (
                  <ErrorState error={history.error} onRetry={() => void history.reload()} />
                ) : history.isLoading ? (
                  <SkeletonList rows={4} />
                ) : history.items.length === 0 ? (
                  <EmptyState title="No points yet">Shop at a member shop or finish a funded challenge. Every entry here will show who paid for the points.</EmptyState>
                ) : (
                  <Card>
                    <ul className="divide-y divide-ink-100">
                      {history.items.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-medium text-ink-900">{m.label}</p>
                            <p className="text-sm text-ink-500">
                              {KIND_WORDS[m.kind] ?? m.kind} · {formatDateTime(m.created_at)}
                            </p>
                          </div>
                          <span className={cn('shrink-0 font-display text-lg font-bold tabular-nums', m.points > 0 ? 'text-success-700' : 'text-ink-700')}>
                            {m.points > 0 ? '+' : '−'}
                            {formatPoints(Math.abs(m.points))}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {history.hasMore && (
                      <div className="border-t border-ink-100 p-3 text-center">
                        <Button variant="ghost" size="sm" onClick={() => void history.loadMore()} pending={history.loadingMore}>
                          Show more
                        </Button>
                      </div>
                    )}
                  </Card>
                )}
              </TabPanel>
            )}

            {tab === 'badges' && (
              <TabPanel>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {w.badges.map((badge) => (
                    <Card key={badge.id} className={cn('p-5', !badge.earned && 'bg-ink-25')}>
                      <span className={cn('grid size-11 place-items-center rounded-full', badge.earned ? 'bg-gold-100 text-gold-700' : 'bg-ink-100 text-ink-500')}>
                        <Award className="size-5" aria-hidden />
                      </span>
                      <p className="mt-3 text-[15px] font-semibold text-ink-900">{badge.label}</p>
                      <p className="text-sm text-ink-500">{badge.hint}</p>
                      {badge.earned ? (
                        <Badge tone="success" className="mt-3">
                          Earned
                        </Badge>
                      ) : (
                        <div className="mt-3">
                          <Progress value={badge.progress} max={badge.need} label={`Progress to ${badge.label}`} />
                          <p className="mt-1 text-xs text-ink-500">
                            {badge.progress} of {badge.need}
                          </p>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </TabPanel>
            )}

            {tab === 'rules' && (
              <TabPanel>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="How points work" />
                    <dl className="divide-y divide-ink-100 text-[15px]">
                      {[
                        ['Value', '100 points = RM1. Always.'],
                        ['Earning at shops', '1 point for every RM1 you pay. No points on the part of a bill paid with points.'],
                        ['Smallest amount you can use', `${formatPoints(w.rules.minRedeem)} points (${formatRM(w.rules.minRedeem)}), in whole ringgit.`],
                        ['Most you can use', `${w.rules.maxRedeemBps / 100}% of one bill. You confirm each use on this phone.`],
                        ['Expiry', `Points stay alive while you earn or spend at least once every ${w.rules.inactiveMonths} months. No point lasts longer than ${w.rules.maxMonths} months.`],
                        ['Cash and transfers', 'Points cannot be turned into cash or sent to another person.'],
                        ['Refunds', 'Points from a refunded purchase are taken back. Points you spent are returned as points.'],
                      ].map(([term, text]) => (
                        <div key={term} className="grid gap-1 px-5 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                          <dt className="font-medium text-ink-900">{term}</dt>
                          <dd className="text-ink-600">{text}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                  <Card>
                    <CardHeader title="Your earning limits" description="Limits per person and per home keep rewards fair." />
                    <div className="space-y-5 p-5">
                      {[
                        ['Today', w.limits.dayUsed, w.limits.dayMax],
                        ['This month', w.limits.monthUsed, w.limits.monthMax],
                      ].map(([name, used, max]) => (
                        <div key={name as string}>
                          <div className="mb-1.5 flex justify-between text-sm">
                            <span className="font-medium text-ink-800">{name}</span>
                            <span className="text-ink-500 tabular-nums">
                              {formatPoints(used as number)} of {formatPoints(max as number)} points
                            </span>
                          </div>
                          <Progress value={used as number} max={max as number} label={`Points earned ${String(name).toLowerCase()}`} />
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </TabPanel>
            )}

            <Modal open={showCode} onClose={() => setShowCode(false)} title="Your member code" description="Show this to the cashier to earn or use points.">
              <div className="flex flex-col items-center gap-4 py-2">
                <QrCode value={w.memberCode} label={`Member code ${w.memberCode}`} />
                <p className="font-display text-3xl font-bold tracking-[0.2em] text-ink-900">{w.memberCode}</p>
              </div>
            </Modal>
          </div>
        )}
      </Async>
    </>
  );
}
