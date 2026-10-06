'use client';

import { BarChart3, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { BudgetSplit, CampaignReport, CampaignStatus } from '@/components/features/campaign-admin';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Campaign } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

export default function SponsorPage() {
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [report, setReport] = useState<Campaign | null>(null);
  return (
    <>
      <PageHeader title="Your campaigns" description="Each campaign has a fixed budget paid up front. Whatever is not given out is refunded when it closes." />
      <Async state={campaigns}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Megaphone} title="No campaigns yet">
              The township team sets up campaigns with you. Once one is funded it appears here with its results.
            </EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {list.map((c) => (
                <Card key={c.id} className="flex flex-col p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CampaignStatus campaign={c} />
                    <span className="text-sm text-ink-500">
                      {formatDate(c.starts_at)} – {formatDate(c.ends_at)}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">{c.title}</h2>
                  <p className="mt-1 flex-1 text-[15px] text-ink-600">{c.description}</p>
                  <p className="mt-3 text-sm text-ink-700">
                    Budget <strong>{formatRM(c.budget_sen)}</strong> · {formatPoints(c.reward_points)} points per reward · pool left <strong>{formatRM(c.pool_left_sen)}</strong>
                  </p>
                  <div className="mt-3">
                    <BudgetSplit campaign={c} />
                  </div>
                  <div className="mt-4">
                    <Button variant="secondary" size="sm" onClick={() => setReport(c)}>
                      <BarChart3 className="size-4" aria-hidden />
                      View results
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      <CampaignReport campaign={report} onClose={() => setReport(null)} />
    </>
  );
}
