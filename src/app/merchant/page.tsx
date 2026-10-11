'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv, LocalizedInput } from '@/components/ui/localized-elements';

import { CheckCircle2, CircleSlash, Clock, Coins, HandCoins, PiggyBank, Receipt, Repeat, Tag, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Async, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface Summary {
  merchant: { name: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' };
  poolSen: number;
  owedSen: number;
  last7Days: { sales: number; billSen: number; pointsGiven: number; feesSen: number; pointsAccepted: number };
  last30Days: { customers: number; returning: number; newCustomers: number; offersUsed: number };
  liveOffer: { id: string; title: string; discountSen: number; minSpendSen: number; usable: boolean; reason: string | null; usedThisMonthSen: number; budgetThisMonthSen: number } | null;
  successFeesDueSen: number;
  rules: { pointsPerRinggit: number; feeBps: number; minRedeem: number; redeemStep: number; maxRedeemBps: number; successFeeBps: number };
}

export default function CounterPage() {
  const summary = useApi<Summary>('/merchant/summary');
  const [memberCode, setMemberCode] = useState('');
  const [bill, setBill] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [points, setPoints] = useState(0);
  const [useOffer, setUseOffer] = useState(false);
  // One key per sale attempt: if the network drops and the cashier presses again, the sale is still recorded once.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [recorded, setRecorded] = useState<SaleView | null>(null);

  const rules = summary.data?.rules;
  const billSen = parseRM(bill);
  const cap = rules && billSen ? Math.floor((billSen * rules.maxRedeemBps) / 10_000) : 0;
  const maxPoints = rules ? cap - (cap % rules.redeemStep) : 0;
  const redeem = usePoints ? Math.min(points, maxPoints) : 0;
  const offer = summary.data?.liveOffer;
  const offerOk = Boolean(offer?.usable && billSen && billSen > offer.discountSen && billSen >= offer.minSpendSen);
  const offerSen = useOffer && offerOk && offer ? offer.discountSen : 0;
  const cashSen = billSen ? billSen - redeem - offerSen : 0;

  const record = useAction(() => api.post<SaleView>('/merchant/sales', { memberCode: memberCode.trim(), billSen, redeemPoints: redeem, useOffer: offerSen > 0, idempotencyKey: key }), {
    onSuccess: (result) => {
      setRecorded(result);
      void summary.mutate();
    },
  });

  // While the resident decides on their phone, ask every two seconds.
  const waiting = useApi<SaleView>(recorded?.status === 'PENDING' ? `/merchant/sales/${recorded.id}` : null, {
    refreshInterval: (latest) => (latest && latest.status !== 'PENDING' ? 0 : 2_000),
    onSuccess: (latest) => latest.status !== 'PENDING' && void summary.mutate(),
  });
  const sale = recorded?.status === 'PENDING' ? (waiting.data ?? recorded) : recorded;

  const next = () => {
    setRecorded(null);
    setMemberCode('');
    setBill('');
    setUsePoints(false);
    setUseOffer(false);
    setPoints(0);
    setKey(crypto.randomUUID());
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void record.run();
  };
  const active = summary.data?.merchant.status === 'ACTIVE';
  const canSubmit = active && memberCode.trim().length >= 6 && billSen !== null && billSen > 0 && (!usePoints || redeem >= (rules?.minRedeem ?? 100)) && (!useOffer || offerOk) && cashSen > 0;

  return (
    <>
      <PageHeader title={summary.data?.merchant.name ?? 'Counter'} description="Enter a sale to give points. If the customer wants to use points, they confirm on their own phone." />
      <div className="space-y-6">
        <Async state={summary} skeleton={<SkeletonStats count={3} />}>
          {(s) => (
            <>
              {s.merchant.status !== 'ACTIVE' && (
                <Card className="border-warning-600/30 bg-warning-50 p-5 text-[15px] text-warning-700">
                  <p className="font-semibold"><Text>{s.merchant.status === 'PENDING' ? 'Your shop is waiting for approval.' : 'Your shop is suspended.'}</Text></p>
                  <p className="mt-1"><Text>{s.merchant.status === 'PENDING' ? 'The township office is checking your business registration. You can record sales once approved.' : 'Please contact the township office.'}</Text></p>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Reward pool" value={s.poolSen} format={formatRM} icon={PiggyBank} tone={s.poolSen < 1_000 ? 'warning' : 'brand'} hint={s.poolSen < 1_000 ? 'Low. No pool, no points: top up to keep giving points.' : 'Pays for the points you give'} />
                <Stat label="Due to you this week" value={s.owedSen} format={formatRM} icon={HandCoins} tone="success" hint="100% of points you accepted" />
                <Stat label="Sales, last 7 days" value={s.last7Days.sales} icon={Receipt} hint={formatRM(s.last7Days.billSen)} />
                <Stat label="Points given, 7 days" value={s.last7Days.pointsGiven} icon={Coins} tone="gold" hint={`Service fee ${formatRM(s.last7Days.feesSen)}`} />
              </div>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="KITA customers, 30 days" value={s.last30Days.customers} icon={Receipt} />
                <Stat label="New customers" value={s.last30Days.newCustomers} icon={UserPlus} tone="success" hint="First KITA sale here in 30 days" />
                <Stat label="Returning customers" value={s.last30Days.returning} icon={Repeat} hint="Bought here before" />
                <Stat label="Shop Offers used, 30 days" value={s.last30Days.offersUsed} icon={Tag} tone="gold" hint={s.successFeesDueSen ? `${formatRM(s.successFeesDueSen)} in success fees waiting` : undefined} />
              </div>
            </>
          )}
        </Async>

        {sale ? (
          <SaleResult sale={sale} onNext={next} />
        ) : (
          <Card>
            <CardHeader title="New sale" />
            <form method="post" onSubmit={submit} className="space-y-5 p-5" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Member code" value={memberCode} onChange={(event) => setMemberCode(event.target.value.toUpperCase())} placeholder="8 letters and numbers" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12} required error={record.fields.memberCode} hint="The customer shows it in their wallet." />
                <Input label="Bill total (RM)" value={bill} onChange={(event) => setBill(event.target.value)} inputMode="decimal" placeholder="0.00" required error={record.fields.billSen ?? (bill && billSen === null ? 'Enter an amount such as 20 or 20.50.' : undefined)} />
              </div>

              <div className="rounded-lg border border-ink-200 p-4">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-[15px] font-semibold text-ink-900"><Text>Customer wants to use points</Text></span>
                    <span className="block text-sm text-ink-500"><Text>Up to </Text><Text>{rules ? rules.maxRedeemBps / 100 : 30}</Text><Text>% of the bill, in whole ringgit</Text><Text>{maxPoints > 0 ? `: at most ${formatPoints(maxPoints)} points here` : ''}</Text>.
                    </span>
                  </span>
                  <LocalizedInput type="checkbox" role="switch" checked={usePoints} onChange={(event) => setUsePoints(event.target.checked)} className="peer sr-only" />
                  <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-ink-200 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:ease-soft peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/25" />
                </label>
                {usePoints && rules && (
                  <div className="mt-4 animate-fade-in">
                    {maxPoints < rules.minRedeem ? (
                      <p className="text-sm text-ink-600"><Text>Enter a bill of at least </Text><Text>{formatRM(Math.ceil((rules.minRedeem * 10_000) / rules.maxRedeemBps))}</Text><Text> to use points.</Text></p>
                    ) : (
                      <LocalizedDiv className="flex flex-wrap gap-2" role="group" aria-label="Points to use">
                        {[...new Set([...[1, 2, 3, 5, 10].map((m) => m * rules.redeemStep).filter((v) => v >= rules.minRedeem && v <= maxPoints), maxPoints])].map((value) => (
                          <button key={value} type="button" aria-pressed={redeem === value} onClick={() => setPoints(value)} className={cn('min-h-11 rounded-md border px-4 text-sm font-semibold transition-colors duration-200', redeem === value ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-700 hover:border-ink-300')}>
                            <Text>{formatPoints(value)}</Text><Text> pts </Text><span className="font-normal text-ink-500">(<Text>{formatRM(value)}</Text>)</span>
                          </button>
                        ))}
                      </LocalizedDiv>
                    )}
                  </div>
                )}
              </div>

              {offer && (
                <div className={cn('rounded-lg border p-4', offer.usable ? 'border-gold-300 bg-gold-50' : 'border-ink-200')}>
                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
                        <Tag className="size-4 text-gold-700" aria-hidden /><Text>Customer wants to use your Shop Offer</Text></span>
                      <span className="block text-sm text-ink-600">
                        {offer.title}: <Text>{formatPoints(offer.discountSen)}</Text><Text> offer-backed points for </Text><Text>{formatRM(offer.discountSen)}</Text><Text> off</Text><Text>{offer.minSpendSen ? `, minimum ${formatRM(offer.minSpendSen)}` : ''}</Text>.<Text>{' '}</Text>
                        <Text>{offer.usable ? `You give the discount; the only fee is ${(rules?.successFeeBps ?? 1000) / 100}% of it.` : offer.reason === 'BUDGET_USED' ? 'Paused: this month’s budget is used up.' : 'Not available at this time of day.'}</Text>
                      </span>
                    </span>
                    <LocalizedInput type="checkbox" role="switch" checked={useOffer} disabled={!offer.usable} onChange={(event) => setUseOffer(event.target.checked)} className="peer sr-only" />
                    <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-ink-200 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:ease-soft peer-checked:bg-gold-500 peer-checked:after:translate-x-5 peer-disabled:opacity-50 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/25" />
                  </label>
                  {useOffer && billSen !== null && !offerOk && <p className="mt-2 text-sm text-warning-700"><Text>This bill does not meet the offer’s terms.</Text></p>}
                </div>
              )}

              {billSen !== null && billSen > 0 && (
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-ink-50 p-4 text-center sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-ink-500"><Text>Customer pays</Text></dt>
                    <dd className="font-display text-xl font-bold text-ink-900 tabular-nums"><Text>{formatRM(cashSen)}</Text></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-ink-500"><Text>Points accepted</Text></dt>
                    <dd className="font-display text-xl font-bold text-ink-900 tabular-nums"><Text>{formatPoints(redeem)}</Text></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-ink-500"><Text>Shop Offer</Text></dt>
                    <dd className="font-display text-xl font-bold text-ink-900 tabular-nums"><Text>{offerSen ? `−${formatRM(offerSen)}` : '–'}</Text></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-ink-500"><Text>Points you give</Text></dt>
                    <dd className="font-display text-xl font-bold text-ink-900 tabular-nums"><Text>{formatPoints(Math.floor(Math.max(0, cashSen) / 100) * (rules?.pointsPerRinggit ?? 1))}</Text></dd>
                  </div>
                </dl>
              )}

              <Button type="submit" size="lg" pending={record.pending} disabled={!canSubmit}>
                <Text>{(usePoints && redeem > 0) || offerSen > 0 ? 'Ask customer to confirm' : 'Record sale'}</Text>
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

function SaleResult({ sale, onNext }: { sale: SaleView; onNext: () => void }) {
  const view = {
    PENDING: { icon: Clock, tone: 'text-gold-700 bg-gold-50', title: 'Waiting for the customer', text: `Ask ${sale.memberName} to open their KITA+ wallet and confirm ${sale.offerPoints ? `the Shop Offer${sale.redeemPoints ? ` and ${formatPoints(sale.redeemPoints)} points` : ''}` : `${formatPoints(sale.redeemPoints)} points`}.` },
    COMPLETED: { icon: CheckCircle2, tone: 'text-success-700 bg-success-50', title: 'Sale recorded', text: `Collect ${formatRM(sale.cashSen)} from ${sale.memberName}.` },
    DECLINED: { icon: CircleSlash, tone: 'text-ink-600 bg-ink-100', title: 'The customer declined', text: 'No points were used. Record the sale again without points if they still want to buy.' },
    EXPIRED: { icon: CircleSlash, tone: 'text-ink-600 bg-ink-100', title: 'The request ran out of time', text: 'No points were used. Please try again.' },
    REFUNDED: { icon: CircleSlash, tone: 'text-ink-600 bg-ink-100', title: 'Refunded', text: '' },
  }[sale.status];
  return (
    <Card className="animate-rise p-6 text-center sm:p-8" aria-live="polite">
      <span className={cn('mx-auto grid size-14 place-items-center rounded-full', view.tone)}>
        <view.icon className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-bold"><Text>{view.title}</Text></h2>
      <p className="mt-1 text-[15px] text-ink-600"><Text>{view.text}</Text></p>
      {sale.status === 'COMPLETED' && (
        <dl className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-ink-50 p-3">
            <dt className="text-xs font-medium text-ink-500"><Text>Paid in cash</Text></dt>
            <dd className="font-display text-lg font-bold tabular-nums"><Text>{formatRM(sale.cashSen)}</Text></dd>
          </div>
          <div className="rounded-lg bg-ink-50 p-3">
            <dt className="text-xs font-medium text-ink-500"><Text>Points accepted</Text></dt>
            <dd className="font-display text-lg font-bold tabular-nums"><Text>{formatPoints(sale.redeemPoints)}</Text></dd>
          </div>
          <div className="rounded-lg bg-ink-50 p-3">
            <dt className="text-xs font-medium text-ink-500"><Text>Points given</Text></dt>
            <dd className="font-display text-lg font-bold tabular-nums"><Text>{formatPoints(sale.pointsEarned)}</Text></dd>
          </div>
        </dl>
      )}
      {sale.status === 'COMPLETED' && sale.redeemPoints > 0 && <p className="mt-4 text-sm text-ink-600"><Text>{formatRM(sale.redeemPoints)}</Text><Text> is added to what the float pays you this week. There is no fee for accepting points.</Text></p>}
      {sale.status === 'COMPLETED' && sale.offerPoints > 0 && (
        <p className="mt-2 text-sm text-ink-600"><Text>Shop Offer “</Text><Text>{sale.offerTitle}</Text><Text>”: you gave </Text><Text>{formatRM(sale.offerPoints)}</Text><Text> off. Success fee </Text><Text>{formatRM(sale.successFeeSen)}</Text>.
        </p>
      )}
      {sale.earnNote === 'POOL_EMPTY' && <Badge tone="warning" className="mt-4"><Text>No points given: your reward pool is empty</Text></Badge>}
      {sale.earnNote === 'LIMIT_REACHED' && <Badge className="mt-4"><Text>The customer has reached their earning limit</Text></Badge>}
      {sale.status !== 'PENDING' && (
        <div className="mt-7">
          <Button size="lg" onClick={onNext} autoFocus><Text>Next customer</Text></Button>
        </div>
      )}
    </Card>
  );
}
