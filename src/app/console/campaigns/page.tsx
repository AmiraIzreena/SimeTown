'use client';

import { Text } from '@/components/ui/localized-text';

import { Award, BarChart3, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BudgetSplit, CampaignReport, CampaignStatus } from '@/components/features/campaign-admin';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { formatDate, parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Campaign, Me } from '@/lib/types';
import { ADMINS, formatPoints, formatRM, SPONSOR_TIERS, SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';

/** What a campaign can reward, in words staff recognise. `unit` is set where a milestone total makes sense. */
const GOALS: { value: string; label: string; activity: string; metric: 'COUNT' | 'QUANTITY'; unit?: string; per?: number }[] = [
  { value: 'kitar-count', label: 'Kitar: each recycling drop-off', activity: 'KITAR_DROPOFF', metric: 'COUNT' },
  { value: 'kitar-kg', label: 'Kitar: kilograms recycled', activity: 'KITAR_DROPOFF', metric: 'QUANTITY', unit: 'kg', per: 1000 },
  { value: 'gerak-count', label: 'Gerak: each loop completed', activity: 'GERAK_LOOP', metric: 'COUNT' },
  { value: 'gerak-km', label: 'Gerak: kilometres walked or cycled', activity: 'GERAK_LOOP', metric: 'QUANTITY', unit: 'km', per: 1000 },
  { value: 'jiran-help', label: 'Jiran: neighbours helped', activity: 'JIRAN_HELP', metric: 'COUNT' },
  { value: 'jiran-event', label: 'Jiran: events attended', activity: 'JIRAN_EVENT', metric: 'COUNT' },
  { value: 'kongsi', label: 'Kongsi: items given or lent', activity: 'KONGSI_SHARE', metric: 'COUNT' },
  { value: 'jimat', label: 'Jimat: months using less', activity: 'JIMAT_SAVER', metric: 'COUNT' },
  { value: 'trip-km', label: 'Gerak: kilometres on tracked trips', activity: 'GERAK_TRIP', metric: 'QUANTITY', unit: 'km', per: 1000 },
  { value: 'taman', label: 'Taman: days watering a community garden', activity: 'TAMAN_WATERING', metric: 'COUNT' },
];

interface SponsorRow {
  id: string;
  name: string;
  tier: SponsorTier | 'NONE';
  tier_until: string | null;
  category: string | null;
  tagline: string | null;
  campaigns: number;
}

/** Sponsors and their tiers. Only SDP HQ records a tier payment; the fee is income and never touches the float. */
function SponsorTiers({ isHq }: { isHq: boolean }) {
  const sponsors = useApi<SponsorRow[]>('/sponsors');
  const [editing, setEditing] = useState<SponsorRow | null>(null);
  const [tier, setTier] = useState<SponsorTier>('COMMUNITY_FRIEND');
  const save = useAction((body: Record<string, string>) => api.post<{ feeSen: number }>(`/admin/sponsors/${editing!.id}/tier`, body), {
    onSuccess: () => {
      setEditing(null);
      void sponsors.mutate();
    },
    success: (r) => `Tier recorded: ${formatRM(r.feeSen)} for the year.`,
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card className="mt-8">
      <CardHeader title="Sponsors and tiers" description="Sponsors join in four tiers. Tier names and fees are placeholders to test with real brands in the pilot." />
      <Async state={sponsors}>
        {(list) => (
          <ul className="divide-y divide-ink-100">
            {list.map((sp) => {
              const active = sp.tier !== 'NONE' && sp.tier_until !== null && sp.tier_until >= today;
              return (
                <li key={sp.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-ink-900">{sp.name}</span>
                    <span className="block text-sm text-ink-500">
                      <Text>{sp.campaigns}</Text><Text> campaign</Text><Text>{sp.campaigns === 1 ? '' : 's'}</Text>
                      <Text>{sp.category && ` · ${sp.category}`}</Text>
                      <Text>{active && sp.tier_until && ` · until ${formatDate(sp.tier_until)}`}</Text>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {active ? (
                      <Badge tone="gold">
                        <Award className="size-3.5" aria-hidden />
                        <Text>{SPONSOR_TIER_INFO[sp.tier as SponsorTier].label}</Text>
                      </Badge>
                    ) : (
                      <Badge><Text>No tier</Text></Badge>
                    )}
                    {isHq && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setTier(active ? (sp.tier as SponsorTier) : 'COMMUNITY_FRIEND');
                          setEditing(sp);
                        }}
                      ><Text>Record tier</Text></Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Async>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Tier for ${editing?.name ?? ''}`}
        description={`Records the yearly fee of ${formatRM(SPONSOR_TIER_INFO[tier].feeSen)} as received.`}
        footer={
          <Button type="submit" form="tier-form" pending={save.pending}><Text>Record payment</Text></Button>
        }
      >
        <form
          id="tier-form"
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
            void save.run({ tier, bankRef: f.bankRef ?? '', ...(f.category ? { category: f.category } : {}), ...(f.tagline ? { tagline: f.tagline } : {}) });
          }}
        >
          <Select label="Tier" value={tier} onChange={(event) => setTier(event.target.value as SponsorTier)}>
            {SPONSOR_TIERS.map((t) => (
              <option key={t} value={t}>
                <Text>{SPONSOR_TIER_INFO[t].label}</Text> · <Text>{formatRM(SPONSOR_TIER_INFO[t].feeSen)}</Text><Text> a year</Text></option>
            ))}
          </Select>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600">
            {SPONSOR_TIER_INFO[tier].benefits.map((b) => (
              <li key={b}><Text>{b}</Text></li>
            ))}
          </ul>
          <Input name="bankRef" label="Bank reference" required maxLength={60} error={save.fields.bankRef} />
          <Input name="category" label="Category (for exclusivity)" defaultValue={editing?.category ?? ''} maxLength={60} error={save.fields.category} hint="One Green Champion per category, and one Title Partner." />
          <Input name="tagline" label="Banner text" defaultValue={editing?.tagline ?? ''} maxLength={120} error={save.fields.tagline} hint="Shown labelled “Sponsored”, never on safety screens." />
        </form>
      </Modal>
    </Card>
  );
}

export default function CampaignsPage() {
  const me = useApi<Me>('/me');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [creating, setCreating] = useState(false);
  const [funding, setFunding] = useState<Campaign | null>(null);
  const [closing, setClosing] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Campaign | null>(null);
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const reload = () => void campaigns.mutate();

  const fund = useAction((id: string, bankRef: string) => api.post<{ poolSen: number }>(`/campaigns/${id}/fund`, { bankRef }), {
    success: (r) => `Funded. ${formatRM(r.poolSen)} is now in the reward pool.`,
    onSuccess: () => {
      setFunding(null);
      reload();
    },
  });
  const close = useAction((id: string) => api.post<{ refundSen: number }>(`/campaigns/${id}/close`), {
    success: (r) => `Closed. ${formatRM(r.refundSen)} goes back to the funder.`,
    onSuccess: () => {
      setClosing(null);
      reload();
    },
  });

  return (
    <>
      <PageHeader
        title="Campaigns & sponsors"
        description="Challenges with a fixed, prefunded reward pool. Nothing is awarded until the funder’s payment is recorded, and awards stop when the pool is used up."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /><Text>New campaign</Text></Button>
        }
      />
      <Async state={campaigns}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No campaigns yet" action={<Button onClick={() => setCreating(true)}><Text>New campaign</Text></Button>}><Text>Set up a challenge for a sponsor, or a community programme funded by Sime Darby Property.</Text></EmptyState>
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
                  <p className="mt-3 text-sm text-ink-700"><Text>Funded by </Text><strong><Text>{c.funder}</Text></strong> · <Text>{formatPoints(c.reward_points)}</Text><Text> points per reward, up to </Text><Text>{c.per_person_cap}</Text><Text> per person</Text>{c.status === 'FUNDED' && (
                      <>
                        <Text>{' '}</Text><Text>· pool left </Text><strong><Text>{formatRM(c.pool_left_sen)}</Text></strong>
                      </>
                    )}
                  </p>
                  <div className="mt-3">
                    <BudgetSplit campaign={c} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {c.status !== 'DRAFT' && (
                      <Button variant="secondary" size="sm" onClick={() => setReport(c)}>
                        <BarChart3 className="size-4" aria-hidden /><Text>Results</Text></Button>
                    )}
                    {isAdmin && c.status === 'DRAFT' && (
                      <Button size="sm" onClick={() => setFunding(c)}><Text>Record payment</Text></Button>
                    )}
                    {isAdmin && c.status !== 'CLOSED' && (
                      <Button variant="ghost" size="sm" onClick={() => setClosing(c)}>
                        <Text>{c.status === 'DRAFT' ? 'Cancel' : 'Close and refund'}</Text>
                      </Button>
                    )}
                  </div>
                  {!isAdmin && c.status === 'DRAFT' && <p className="mt-3 text-sm text-ink-500"><Text>A township admin records the funder’s payment to start it.</Text></p>}
                </Card>
              ))}
            </div>
          )
        }
      </Async>

      <CreateCampaign open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      <SponsorTiers isHq={me.data?.role === 'HQ_ADMIN'} />
      <CampaignReport campaign={report} onClose={() => setReport(null)} />

      <Modal
        open={funding !== null}
        onClose={() => setFunding(null)}
        title="Record the funder’s payment"
        description={funding ? `${funding.title} · ${formatRM(funding.budget_sen)} from ${funding.funder}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFunding(null)}><Text>Cancel</Text></Button>
            <Button type="submit" form="fund-campaign" pending={fund.pending}><Text>Payment received</Text></Button>
          </>
        }
      >
        {funding && (
          <form method="post"
            id="fund-campaign"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void fund.run(funding.id, String(new FormData(event.currentTarget).get('bankRef')));
            }}
          >
            <p className="text-[15px] text-ink-700"><Text>Only record this once the full amount is in the trust account. The reward pool goes into the float; the fee and running costs go to SimeTown.</Text></p>
            <BudgetSplit campaign={funding} />
            <Input label="Bank reference" name="bankRef" required maxLength={60} error={fund.fields.bankRef} hint="Each reference can be used once." />
          </form>
        )}
      </Modal>

      <ConfirmDialog open={closing !== null} onClose={() => setClosing(null)} onConfirm={() => closing && void close.run(closing.id)} title={closing?.status === 'DRAFT' ? 'Cancel this campaign?' : 'Close this campaign?'} confirmLabel={closing?.status === 'DRAFT' ? 'Cancel campaign' : 'Close and refund'} destructive pending={close.pending}>
        {closing?.status === 'FUNDED' ? (
          <p><Text>No more rewards will be given. The unused pool, </Text><strong><Text>{formatRM(closing.pool_left_sen)}</Text></strong><Text>, is refunded to </Text><Text>{closing.funder}</Text><Text>. This cannot be undone.</Text></p>
        ) : (
          <p><Text>The campaign was never funded, so nothing is refunded. This cannot be undone.</Text></p>
        )}
      </ConfirmDialog>
    </>
  );
}

function CreateCampaign({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const sponsors = useApi<{ id: string; name: string }[]>(open ? '/sponsors' : null);
  const [goal, setGoal] = useState(GOALS[0]!.value);
  const [sponsorId, setSponsorId] = useState('');
  const [budget, setBudget] = useState('');
  const [reward, setReward] = useState('300');
  const selected = GOALS.find((g) => g.value === goal)!;
  const budgetSen = parseRM(budget) ?? 0;
  // Sponsors pay the standard split; an SDP community programme puts the whole budget into rewards.
  const split = sponsorId ? { poolBps: 6000, feeBps: 2500, costsBps: 1500 } : { poolBps: 10_000, feeBps: 0, costsBps: 0 };
  const poolSen = Math.floor((budgetSen * split.poolBps) / 10_000);
  const rewards = Number(reward) > 0 ? Math.floor(poolSen / Number(reward)) : 0;

  const create = useAction((body: Record<string, unknown>) => api.post('/campaigns', body), {
    success: 'Campaign created. It starts once the payment is recorded.',
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void create.run({
      sponsorId: sponsorId || null,
      title: form.title,
      description: form.description,
      activity: selected.activity,
      goalMetric: selected.metric,
      goalTarget: Math.max(1, Math.round(Number(form.target || 1) * (selected.per ?? 1))),
      rewardPoints: Number(reward),
      perPersonCap: Number(form.cap),
      budgetSen,
      ...split,
      startsAt: new Date(form.startsAt!).toISOString(),
      endsAt: new Date(`${form.endsAt}T23:59:59`).toISOString(),
    });
  };
  const f = create.fields;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          <Button type="submit" form="create-campaign" pending={create.pending}><Text>Create campaign</Text></Button>
        </>
      }
    >
      <form method="post" id="create-campaign" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Title" name="title" maxLength={100} required error={f.title} className="sm:col-span-2" />
        <Textarea label="What residents see" name="description" maxLength={600} required error={f.description} className="sm:col-span-2" />
        <Select label="Funded by" value={sponsorId} onChange={(event) => setSponsorId(event.target.value)} error={f.sponsorId}>
          <option value=""><Text>Sime Darby Property (community programme)</Text></option>
          {sponsors.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Rewards" value={goal} onChange={(event) => setGoal(event.target.value)}>
          {GOALS.map((g) => (
            <option key={g.value} value={g.value}>
              <Text>{g.label}</Text>
            </option>
          ))}
        </Select>
        <Input label={selected.unit ? `Reward every (${selected.unit})` : 'Reward every (times)'} name="target" type="number" min={selected.unit ? 0.1 : 1} step={selected.unit ? 0.1 : 1} defaultValue={1} required error={f.goalTarget} />
        <Input label="Points per reward" type="number" min={1} value={reward} onChange={(event) => setReward(event.target.value)} required error={f.rewardPoints} hint={Number(reward) > 0 ? `Worth ${formatRM(Number(reward))}` : undefined} />
        <Input label="Most rewards per person" name="cap" type="number" min={1} max={100} defaultValue={1} required error={f.perPersonCap} />
        <Input label="Total budget (RM)" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="e.g. 20000" required error={f.budgetSen} />
        <Input label="Starts" name="startsAt" type="date" defaultValue={today} required error={f.startsAt} />
        <Input label="Ends" name="endsAt" type="date" required error={f.endsAt} />
        {budgetSen > 0 && (
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800 sm:col-span-2"><Text>Reward pool </Text><strong><Text>{formatRM(poolSen)}</Text></strong>
            <Text>{sponsorId ? `, SimeTown fee ${formatRM(Math.floor(budgetSen * 0.25))}, running costs ${formatRM(budgetSen - poolSen - Math.floor(budgetSen * 0.25))}` : ' (the whole budget)'}</Text><Text>. Enough for </Text><strong><Text>{rewards.toLocaleString('en-MY')}</Text></strong><Text> rewards; awards stop when it runs out, and anything left is refunded.</Text></p>
        )}
      </form>
    </Modal>
  );
}
