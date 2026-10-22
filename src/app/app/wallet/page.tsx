'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { Award, Clock, PiggyBank, QrCode as QrIcon, Store, Tag } from 'lucide-react';
import { AksesPage, AksesReadAloud, useAksesMode } from '@/components/features/akses-mode';
import { offerTerms } from '@/components/features/offers';
import { useState } from 'react';
import { PendingRedemption } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, ErrorState, Skeleton, SkeletonCard, SkeletonList } from '@/components/ui/feedback';
import { QrCode } from '@/components/ui/qr';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi, usePaged } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface Wallet {
  points: number;
  offerPoints: number;
  totalPoints: number;
  saved: { pointsSen: number; offersSen: number; totalSen: number };
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

interface OfferView {
  id: string;
  merchantName: string;
  title: string;
  discountSen: number;
  minSpendSen: number;
  startMinute: number;
  endMinute: number;
  daysMask: number;
  usable: boolean;
  reason: string | null;
}
interface OffersData {
  offers: OfferView[];
  pledges: { month: string; pledged: number; issued: number; used: number; shops: number };
  balance: number;
  history: { id: string; source: string; label: string; amount: number; remaining: number; redeemed: number; pledge_month: string; earned_at: string; expires_at: string }[];
}

type Tab = 'history' | 'offers' | 'badges' | 'rules';

/** The balance card and the Impact XP card, in the shape they load into. */
function WalletSkeleton() {
  return (
    <LocalizedDiv role="status" aria-label="Loading" aria-busy="true" className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <SkeletonCard className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-3 h-12 w-40" />
            <Skeleton className="mt-3 h-3.5 w-56" />
          </div>
          <Skeleton className="h-11 w-36" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </SkeletonCard>
      <SkeletonCard className="p-6">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-9 w-28" />
        <Skeleton className="mt-5 h-2 w-full rounded-full" />
        <Skeleton className="mt-2 h-3 w-2/5" />
      </SkeletonCard>
    </LocalizedDiv>
  );
}

export default function WalletPage() {
  const t = useT();
  const akses = useAksesMode();
  const wallet = useApi<Wallet>('/wallet', { refreshInterval: 5_000 });
  const history = usePaged<Movement>('/wallet/history?limit=15');
  const offers = useApi<OffersData>('/offers');
  const [tab, setTab] = useState<Tab>('history');
  const [showCode, setShowCode] = useState(false);

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader title="Points & XP" description="Points are worth money at township shops. Impact XP has no money value: it is your record of good actions." />
      <Async state={wallet} skeleton={<WalletSkeleton />}>
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

            {akses.simple ? (
              <Card className="space-y-5 border-brand-200 bg-brand-50 p-6">
                <div>
                  <p className="font-semibold text-ink-700"><Text>My points</Text></p>
                  <p className="mt-2 font-display text-5xl font-bold tabular-nums text-ink-900"><CountUp value={w.totalPoints} /></p>
                  <p className="mt-2 text-xl font-semibold"><Text>Worth </Text><Text>{formatRM(w.totalPoints)}</Text></p>
                  <p className="mt-2"><Text>Cash-backed points: </Text><Text>{formatPoints(w.points)}</Text></p>
                  <p><Text>Offer-backed points: </Text><Text>{formatPoints(w.offerPoints)}</Text></p>
                  <p className="mt-4 font-semibold"><Text>Impact XP: </Text><Text>{w.xp}</Text><Text>. Level </Text><Text>{w.level.level}</Text></p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" variant="light" onClick={() => setShowCode(true)}>
                    <QrIcon className="size-5" aria-hidden /><Text>Show my code</Text>
                  </Button>
                  <AksesReadAloud
                    profile={akses.profile}
                    text={`${t('You have {n} points, worth {rm}.', { n: formatPoints(w.totalPoints), rm: formatRM(w.totalPoints) })} ${t('Impact XP')}: ${w.xp}. ${t('Level')} ${w.level.level}.`}
                  />
                </div>
              </Card>
            ) : (
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="wallet-balance-card rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-brand-100"><Text>SimeTown Points</Text></p>
                    <p className="mt-2 font-display text-5xl font-bold leading-none tracking-tight tabular-nums">
                      <CountUp value={w.totalPoints} />
                    </p>
                    <p className="mt-2 text-[15px] text-brand-100"><Text>Worth </Text><Text>{formatRM(w.totalPoints)}</Text><Text> · 100 points = RM1</Text></p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md bg-white/10 px-3 py-2">
                        <dt className="text-brand-100"><Text>Cash-backed</Text></dt>
                        <dd className="font-semibold tabular-nums">
                          <Text>{formatPoints(w.points)}</Text> · <Text>{formatRM(w.points)}</Text>
                        </dd>
                        <dd className="text-xs text-brand-200"><Text>Any member shop, up to 30% of a bill</Text></dd>
                      </div>
                      <div className="rounded-md bg-white/10 px-3 py-2">
                        <dt className="text-brand-100"><Text>Offer-backed</Text></dt>
                        <dd className="font-semibold tabular-nums">
                          <Text>{formatPoints(w.offerPoints)}</Text> · <Text>{formatRM(w.offerPoints)}</Text>
                        </dd>
                        <dd className="text-xs text-brand-200"><Text>Shop Offers, on each shop’s terms</Text></dd>
                      </div>
                    </dl>
                  </div>
                  <Button variant="light" onClick={() => setShowCode(true)}>
                    <QrIcon className="size-4" aria-hidden /><Text>Show my code</Text></Button>
                </div>
                {w.expiring && (
                  <p className="mt-5 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm">
                    <Clock className="size-4 shrink-0" aria-hidden />
                    <Text>{formatPoints(w.expiring.points)}</Text><Text> points expire from </Text><Text>{formatDate(w.expiring.date)}</Text><Text>. Use them at any member shop.</Text></p>
                )}
              </div>
              <Card className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink-500"><Text>Impact XP</Text></p>
                  <Badge tone="brand"><Text>Level </Text><Text>{w.level.level}</Text> · {w.level.name}
                  </Badge>
                </div>
                <p className="mt-2 font-display text-4xl font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                  <CountUp value={w.xp} />
                </p>
                <div className="mt-4">
                  <Progress value={w.xp - w.level.floor} max={w.level.next - w.level.floor} label="Progress to the next level" />
                  <p className="mt-1.5 text-sm text-ink-500"><Text>{w.level.next - w.xp}</Text><Text> XP to the next level</Text></p>
                </div>
              </Card>
            </div>
            )}

            <Card className="flex flex-wrap items-center gap-5 border-gold-300/60 bg-gold-50 p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-gold-700 shadow-xs">
                <PiggyBank className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gold-700"><Text>You saved, all together</Text></p>
                <p className="font-display text-3xl font-bold tabular-nums text-ink-900"><CountUp value={w.saved.totalSen} format={formatRM} /></p>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-ink-500"><Text>Points used</Text></dt>
                  <dd className="font-semibold tabular-nums"><Text>{formatRM(w.saved.pointsSen)}</Text></dd>
                </div>
                <div>
                  <dt className="text-ink-500"><Text>Shop Offers</Text></dt>
                  <dd className="font-semibold tabular-nums"><Text>{formatRM(w.saved.offersSen)}</Text></dd>
                </div>
              </dl>
            </Card>

            <Tabs<Tab>
              label="Wallet sections"
              value={tab}
              onChange={setTab}
              items={[
                { key: 'history', label: 'History' },
                { key: 'offers', label: 'Shop Offers', count: offers.data?.offers.filter((o) => o.usable).length },
                { key: 'badges', label: 'Badges', count: w.badges.filter((b) => b.earned).length },
                { key: 'rules', label: 'Rules & limits' },
              ]}
            />

            {tab === 'offers' && (
              <TabPanel>
                <Async state={offers} skeleton={<SkeletonList rows={2} />}>
                  {(o) => (
                    <div className="space-y-4">
                      <p className="rounded-md bg-brand-50 px-4 py-3 text-sm text-brand-800"><Text>No pledge, no points: township shops have promised </Text><strong><Text>{formatRM(o.pledges.pledged)}</Text></strong><Text> of discounts this month, so at most </Text><Text>{formatPoints(o.pledges.pledged)}</Text><Text> offer-backed points can be given. </Text><Text>{formatPoints(o.pledges.issued)}</Text><Text> have been given so far.</Text></p>
                      {o.offers.length === 0 ? (
                        <EmptyState icon={Tag} title="No Shop Offers right now"><Text>When a shop sets an offer, it appears here with its terms.</Text></EmptyState>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          {o.offers.map((offer) => (
                            <Card key={offer.id} className="p-5">
                              <div className="flex items-start justify-between gap-3">
                                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700">
                                  <Store className="size-5" aria-hidden />
                                </span>
                                <Badge tone={offer.usable ? 'success' : 'neutral'}><Text>{offer.usable ? 'Available now' : offer.reason === 'BUDGET_USED' ? 'Paused: budget used' : 'Not at this time'}</Text></Badge>
                              </div>
                              <p className="mt-3 text-sm font-medium text-ink-500"><Text>{offer.merchantName}</Text></p>
                              <p className="text-[17px] font-semibold text-ink-900">{offer.title}</p>
                              <p className="mt-1 text-sm text-ink-600">
                                <Text>{formatPoints(offer.discountSen)}</Text><Text> offer points for </Text><Text>{formatRM(offer.discountSen)}</Text><Text> off · </Text><Text>{offerTerms(offer, t)}</Text>
                              </p>
                              <p className="mt-3 text-xs text-ink-500">
                                <Text>{o.balance >= offer.discountSen ? 'Your offer points cover this. Ask the cashier to use the Shop Offer.' : `You need ${formatPoints(offer.discountSen - o.balance)} more offer points.`}</Text>
                              </p>
                            </Card>
                          ))}
                        </div>
                      )}
                      <Card>
                        <CardHeader title="Your offer-backed points" description="Each batch says what stood behind it. They follow the same expiry rule as every point." />
                        {o.history.length === 0 ? (
                          <p className="p-5 text-sm text-ink-500"><Text>Earn them from verified green actions: recycling at a kiosk bin, and tracked walks and rides.</Text></p>
                        ) : (
                          <ul className="divide-y divide-ink-100">
                            {o.history.map((lot) => (
                              <li key={lot.id} className="flex items-center justify-between gap-4 px-5 py-3">
                                <div className="min-w-0">
                                  <p className="truncate text-[15px] font-medium text-ink-900"><Text>{lot.label}</Text></p>
                                  <p className="text-sm text-ink-500">
                                    <Text>{formatDateTime(lot.earned_at)}</Text> · <Text>{formatPoints(lot.remaining)}</Text><Text> left · expires </Text><Text>{formatDate(lot.expires_at)}</Text>
                                  </p>
                                </div>
                                <span className="shrink-0 font-display text-lg font-bold tabular-nums text-success-700">+<Text>{formatPoints(lot.amount)}</Text></span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>
                    </div>
                  )}
                </Async>
              </TabPanel>
            )}

            {tab === 'history' && (
              <TabPanel>
                {history.error ? (
                  <ErrorState error={history.error} onRetry={() => void history.reload()} />
                ) : history.isLoading ? (
                  <SkeletonList rows={4} />
                ) : history.items.length === 0 ? (
                  <EmptyState title="No points yet"><Text>Shop at a member shop or finish a funded challenge. Every entry here will show who paid for the points.</Text></EmptyState>
                ) : (
                  <Card>
                    <ul className="divide-y divide-ink-100">
                      {history.items.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-medium text-ink-900"><Text>{m.label}</Text></p>
                            <p className="text-sm text-ink-500">
                              <Text>{KIND_WORDS[m.kind] ?? m.kind}</Text> · <Text>{formatDateTime(m.created_at)}</Text>
                            </p>
                          </div>
                          <span className={cn('shrink-0 font-display text-lg font-bold tabular-nums', m.points > 0 ? 'text-success-700' : 'text-ink-700')}>
                            <Text>{m.points > 0 ? '+' : '−'}</Text>
                            <Text>{formatPoints(Math.abs(m.points))}</Text>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {history.hasMore && (
                      <div className="border-t border-ink-100 p-3 text-center">
                        <Button variant="ghost" size="sm" onClick={() => void history.loadMore()} pending={history.loadingMore}><Text>Show more</Text></Button>
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
                      <p className="mt-3 text-[15px] font-semibold text-ink-900"><Text>{badge.label}</Text></p>
                      <p className="text-sm text-ink-500"><Text>{badge.hint}</Text></p>
                      {badge.earned ? (
                        <Badge tone="success" className="mt-3"><Text>Earned</Text></Badge>
                      ) : (
                        <div className="mt-3">
                          <Progress value={badge.progress} max={badge.need} label={`Progress to ${t(badge.label)}`} />
                          <p className="mt-1 text-xs text-ink-500">
                            <Text>{badge.progress}</Text><Text> of </Text><Text>{badge.need}</Text>
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
                        ['Two kinds of backing', 'Cash-backed points have money in the locked reward float behind them. Offer-backed points are backed by discounts township shops pledged for the month, and are used on a Shop Offer.'],
                        ['Earning at shops', '1 point for every RM1 you pay. No points on the part of a bill paid with points.'],
                        ['Smallest amount you can use', `${formatPoints(w.rules.minRedeem)} points (${formatRM(w.rules.minRedeem)}), in whole ringgit.`],
                        ['Most you can use', `${w.rules.maxRedeemBps / 100}% of one bill. You confirm each use on this phone.`],
                        ['Expiry', `Points stay alive while you earn or spend at least once every ${w.rules.inactiveMonths} months. No point lasts longer than ${w.rules.maxMonths} months.`],
                        ['Cash and transfers', 'Points cannot be turned into cash or sent to another person.'],
                        ['Refunds', 'Points from a refunded purchase are taken back. Points you spent are returned as points.'],
                      ].map(([term, text]) => (
                        <div key={term} className="grid gap-1 px-5 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                          <dt className="font-medium text-ink-900"><Text>{term}</Text></dt>
                          <dd className="text-ink-600"><Text>{text}</Text></dd>
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
                            <span className="font-medium text-ink-800"><Text>{name}</Text></span>
                            <span className="text-ink-500 tabular-nums">
                              <Text>{formatPoints(used as number)}</Text><Text> of </Text><Text>{formatPoints(max as number)}</Text><Text> points</Text></span>
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
                <p className="font-display text-3xl font-bold tracking-[0.2em] text-ink-900"><Text>{w.memberCode}</Text></p>
              </div>
            </Modal>
          </div>
        )}
      </Async>
    </AksesPage>
  );
}
