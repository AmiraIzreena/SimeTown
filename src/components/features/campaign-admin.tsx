'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { Badge, Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Campaign } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

export function CampaignStatus({ campaign: c }: { campaign: Campaign }) {
  if (c.status === 'DRAFT') return <Badge tone="warning"><Text>Waiting for payment</Text></Badge>;
  if (c.status === 'CLOSED') return <Badge><Text>Closed</Text></Badge>;
  if (c.live) return <Badge tone="success"><Text>Live</Text></Badge>;
  return <Badge tone="brand"><Text>{new Date(c.starts_at) > new Date() ? 'Funded, not started' : 'Ended, not closed'}</Text></Badge>;
}

/** Where the budget goes: reward pool, platform fee, running costs. */
export function BudgetSplit({ campaign: c }: { campaign: Campaign }) {
  const pool = Math.floor((c.budget_sen * c.pool_bps) / 10_000);
  const fee = Math.floor((c.budget_sen * c.fee_bps) / 10_000);
  const parts = [
    { label: 'Reward pool', value: pool, className: 'bg-brand-600' },
    { label: 'KITA+ fee', value: fee, className: 'bg-gold-500' },
    { label: 'Running costs', value: c.budget_sen - pool - fee, className: 'bg-ink-300' },
  ].filter((p) => p.value > 0);
  return (
    <div>
      <LocalizedDiv className="flex h-2.5 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={parts.map((p) => `${p.label} ${formatRM(p.value)}`).join(', ')}>
        {parts.map((p) => (
          <div key={p.label} className={p.className} style={{ width: `${(p.value / c.budget_sen) * 100}%` }} />
        ))}
      </LocalizedDiv>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((p) => (
          <div key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 rounded-sm ${p.className}`} />
            <dt className="text-ink-500"><Text>{p.label}</Text></dt>
            <dd className="font-semibold text-ink-800 tabular-nums"><Text>{formatRM(p.value)}</Text></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface Report {
  suppressed: boolean;
  minGroupSize: number;
  results: { participants: number; rewardsGiven: number; pointsIssued: number; pointsSpentAtShops: number; pointsStillHeld: number; pointsExpiredOrReturned: number } | null;
}

/** Grouped results only. Sponsors see nothing until the group is large enough that no one can be singled out. */
export function CampaignReport({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const report = useApi<Report>(campaign ? `/campaigns/${campaign.id}/report` : null);
  return (
    <Modal open={campaign !== null} onClose={onClose} title={campaign?.title ?? ''} description={campaign ? `${formatDate(campaign.starts_at)} – ${formatDate(campaign.ends_at)} · funded by ${campaign.funder}` : undefined} wide>
      {campaign && (
        <div className="space-y-5">
          <BudgetSplit campaign={campaign} />
          <Async state={report}>
            {(r) =>
              r.suppressed || !r.results ? (
                <Card className="bg-ink-25 p-5 text-[15px] text-ink-700">
                  <p className="font-semibold text-ink-900"><Text>Results are not shown yet.</Text></p>
                  <p className="mt-1"><Text>To protect residents’ privacy, numbers appear once at least </Text><Text>{r.minGroupSize}</Text><Text> residents have taken part.</Text></p>
                </Card>
              ) : (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ['Residents rewarded', r.results.participants.toLocaleString('en-MY')],
                    ['Rewards given', r.results.rewardsGiven.toLocaleString('en-MY')],
                    ['Points given', `${formatPoints(r.results.pointsIssued)} (${formatRM(r.results.pointsIssued)})`],
                    ['Spent at township shops', formatRM(r.results.pointsSpentAtShops)],
                    ['Still held by residents', formatRM(r.results.pointsStillHeld)],
                    ['Expired or returned', formatRM(r.results.pointsExpiredOrReturned)],
                    ['Pool not yet given', formatRM(campaign.pool_left_sen)],
                    ...(campaign.refunded_sen !== null ? [['Refunded to funder', formatRM(campaign.refunded_sen)]] : []),
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-ink-200 p-4">
                      <dt className="text-xs font-medium text-ink-500"><Text>{label}</Text></dt>
                      <dd className="mt-1 font-display text-lg font-bold text-ink-900 tabular-nums"><Text>{value}</Text></dd>
                    </div>
                  ))}
                </dl>
              )
            }
          </Async>
          <p className="text-sm text-ink-500"><Text>Totals only. KITA+ never shares a list of people with a sponsor.</Text></p>
        </div>
      )}
    </Modal>
  );
}
