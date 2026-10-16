'use client';

import { Text } from '@/components/ui/localized-text';

import { Award, BarChart3, Check, ExternalLink, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { BudgetSplit, CampaignReport, CampaignStatus } from '@/components/features/campaign-admin';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { Async, EmptyState } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Campaign } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface Tier {
  name: string;
  tier: string;
  tierLabel: string;
  until: string | null;
  category: string | null;
  tagline: string | null;
  benefits: string[];
  challengesThisYear: number;
  challengeAllowance: number | null;
}

/** The sponsor's tier, what it includes, and challenges used this year (proposal section 12). */
function TierCard() {
  const tier = useApi<Tier>('/sponsor/tier');
  return (
    <Async state={tier}>
      {(t) => (
        <Card className="mb-6">
          <CardHeader
            title={t.tierLabel}
            description={t.until ? `Your tier runs until ${formatDate(t.until)}${t.category ? ` · category: ${t.category}` : ''}.` : 'Sponsors outside a tier run one-off challenges with a campaign fee.'}
            action={
              <Button href="/sponsorship#sponsors" variant="secondary" size="sm">
                <ExternalLink className="size-4" aria-hidden /><Text>Partners page</Text></Button>
            }
          />
          <div className="grid gap-6 p-5 md:grid-cols-[1.4fr_1fr]">
            <ul className="space-y-2">
              {t.benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[15px] text-ink-700">
                  <Check className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
                  <Text>{b}</Text>
                </li>
              ))}
            </ul>
            <div className="space-y-3 rounded-lg bg-ink-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Award className="size-4 text-gold-500" aria-hidden /><Text>Challenges this year</Text></p>
              {t.challengeAllowance === null ? (
                <p className="text-sm text-ink-600"><Text>{t.challengesThisYear}</Text><Text> run · </Text><Text>{t.tier === 'NONE' ? 'each with a one-off campaign fee' : 'no yearly limit at this tier'}</Text></p>
              ) : (
                <>
                  <Progress value={t.challengesThisYear} max={t.challengeAllowance} tone="gold" label="Challenges used this year" />
                  <p className="text-sm text-ink-600">
                    <Text>{t.challengesThisYear}</Text><Text> of </Text><Text>{t.challengeAllowance}</Text><Text> included</Text></p>
                </>
              )}
              {t.tagline && (
                <p className="text-sm text-ink-600"><Text>Banner text: “</Text><Text>{t.tagline}</Text>” <Badge tone="gold"><Text>Always labelled Sponsored</Text></Badge>
                </p>
              )}
              <p className="text-xs text-ink-500"><Text>You see grouped totals only, never anyone’s personal data, and your content never appears on safety screens.</Text></p>
            </div>
          </div>
        </Card>
      )}
    </Async>
  );
}

export default function SponsorPage() {
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [report, setReport] = useState<Campaign | null>(null);
  return (
    <>
      <PageHeader title="Your campaigns" description="Each campaign has a fixed budget paid up front. Whatever is not given out is refunded when it closes." />
      <TierCard />
      <Async state={campaigns}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Megaphone} title="No campaigns yet"><Text>The township team sets up campaigns with you. Once one is funded it appears here with its results.</Text></EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {list.map((c) => (
                <Card key={c.id} className="flex flex-col p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CampaignStatus campaign={c} />
                    <span className="text-sm text-ink-500">
                      <Text>{formatDate(c.starts_at)}</Text> – <Text>{formatDate(c.ends_at)}</Text>
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold">{c.title}</h2>
                  <p className="mt-1 flex-1 text-[15px] text-ink-600">{c.description}</p>
                  <p className="mt-3 text-sm text-ink-700"><Text>Budget </Text><strong><Text>{formatRM(c.budget_sen)}</Text></strong> · <Text>{formatPoints(c.reward_points)}</Text><Text> points per reward · pool left </Text><strong><Text>{formatRM(c.pool_left_sen)}</Text></strong>
                  </p>
                  <div className="mt-3">
                    <BudgetSplit campaign={c} />
                  </div>
                  <div className="mt-4">
                    <Button variant="secondary" size="sm" onClick={() => setReport(c)}>
                      <BarChart3 className="size-4" aria-hidden /><Text>View results</Text></Button>
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
