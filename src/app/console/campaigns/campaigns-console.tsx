'use client';

import { Text } from '@/components/ui/localized-text';

import { AlertCircle, Award, BarChart3, CheckCircle2, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { BudgetSplit, CampaignReport, CampaignSplit, CampaignStatus, givenOf, splitOf } from '@/components/features/campaign-admin';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDate, parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Campaign, Me } from '@/lib/types';
import { ADMINS, campaignSplit, formatPoints, formatRM, SPONSOR_TIERS, SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';

/** What a campaign can reward, in words staff recognise. `unit` is set where a milestone total makes sense. */
const GOALS: { value: string; label: string; activity: string; metric: 'COUNT' | 'QUANTITY'; unit?: string; per?: number }[] = [
  { value: 'kitar-count', label: 'Kitar: each recycling drop-off', activity: 'KITAR_DROPOFF', metric: 'COUNT' },
  { value: 'kitar-kg', label: 'Kitar: kilograms recycled', activity: 'KITAR_DROPOFF', metric: 'QUANTITY', unit: 'kg', per: 1000 },
  { value: 'gerak-count', label: 'Gerak: each loop completed', activity: 'GERAK_LOOP', metric: 'COUNT' },
  { value: 'gerak-km', label: 'Gerak: kilometres walked or cycled', activity: 'GERAK_LOOP', metric: 'QUANTITY', unit: 'km', per: 1000 },
  { value: 'jiran-help', label: 'Jiran: neighbours helped', activity: 'JIRAN_HELP', metric: 'COUNT' },
  { value: 'jiran-event', label: 'Jiran: events attended', activity: 'JIRAN_EVENT', metric: 'COUNT' },
  { value: 'kongsi', label: 'Kongsi: items given or lent', activity: 'KONGSI_SHARE', metric: 'COUNT' },
  { value: 'trip-km', label: 'Gerak: kilometres on tracked trips', activity: 'GERAK_TRIP', metric: 'QUANTITY', unit: 'km', per: 1000 },
];

interface SponsorRow {
  id: string;
  name: string;
  tier: SponsorTier | 'NONE';
  tier_until: string | null;
  category: string | null;
  tagline: string | null;
  campaigns: number;
  /** The tier in force today. */
  active_tier: SponsorTier | 'NONE';
  /** Challenges a year the tier allows; null is no limit. */
  allowance: number | null;
  /** This year's challenges, drafts waiting for payment included. */
  challenges_this_year: number;
}

const DAY = 86_400_000;
const daysUntil = (iso: string, now: number) => Math.ceil((new Date(iso).getTime() - now) / DAY);

type Attention = 'PAYMENT' | 'ENDED' | 'POOL_EMPTY' | null;

/** What, if anything, an admin has to do next. */
function attentionOf(c: Campaign, now: number): Attention {
  if (c.status === 'DRAFT') return 'PAYMENT';
  if (c.status !== 'FUNDED') return null;
  if (new Date(c.ends_at).getTime() <= now) return 'ENDED';
  if (c.pool_left_sen < c.reward_points) return 'POOL_EMPTY';
  return null;
}

/** "9 days left", "Starts in 3 days", or the dates. */
function timing(c: Campaign, now: number): string {
  if (c.status === 'FUNDED') {
    const toStart = daysUntil(c.starts_at, now);
    if (toStart > 0) return toStart === 1 ? 'Starts tomorrow' : `Starts in ${toStart} days`;
    const left = daysUntil(c.ends_at, now);
    if (left > 1) return `${left} days left`;
    if (left === 1) return 'Last day';
    return `Ended ${formatDate(c.ends_at)}`;
  }
  return `${formatDate(c.starts_at)} – ${formatDate(c.ends_at)}`;
}

interface CardActions {
  isAdmin: boolean;
  now: number;
  onFund: (c: Campaign) => void;
  onClose: (c: Campaign) => void;
  onReport: (c: Campaign) => void;
}

function CampaignCard({ campaign: c, isAdmin, now, onFund, onClose, onReport }: { campaign: Campaign } & CardActions) {
  const attention = attentionOf(c, now);
  const { pool, given } = givenOf(c);
  return (
    <Card className="flex flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <CampaignStatus campaign={c} />
          {c.extra && <Badge tone="gold"><Text>Extra one-off</Text></Badge>}
        </span>
        <span className="text-sm text-ink-500"><Text>{timing(c, now)}</Text></span>
      </div>
      <h3 className="mt-3 text-lg font-semibold">{c.title}</h3>
      <p className="mt-1 line-clamp-2 text-[15px] text-ink-600">{c.description}</p>
      <p className="mt-3 text-sm text-ink-700">
        <Text>{c.sponsor_id ? 'Sponsor' : 'Community programme'}</Text><Text>{': '}</Text><strong>{c.funder}</strong>
      </p>
      <p className="mt-0.5 text-sm text-ink-500">
        <Text>{`${formatPoints(c.reward_points)} points (${formatRM(c.reward_points)}) per reward, up to ${c.per_person_cap} per person`}</Text>
      </p>

      <div className="mt-4 flex-1">
        {c.status === 'DRAFT' ? (
          <p className="rounded-lg bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
            <Text>{`Waiting for ${c.funder} to pay ${formatRM(c.budget_sen)}. Nothing is given until the payment is recorded.`}</Text>
            <UpgradeHint campaign={c} />
          </p>
        ) : (
          <>
            <Progress value={given} max={pool} tone={attention ? 'warning' : 'brand'} label="Reward pool given out" />
            <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="text-ink-700">
                <strong className="tabular-nums"><Text>{formatRM(given)}</Text></strong><Text>{` given of ${formatRM(pool)}`}</Text>
                {c.rewards_given !== undefined && <span className="text-ink-500"><Text>{c.rewards_given === 1 ? ' · 1 reward' : ` · ${c.rewards_given} rewards`}</Text></span>}
              </span>
              <span className="text-ink-500">
                <Text>{c.status === 'CLOSED' ? `${formatRM(c.refunded_sen ?? 0)} refunded` : `${formatRM(c.pool_left_sen)} left`}</Text>
              </span>
            </p>
          </>
        )}
        {attention === 'ENDED' && (
          <p className="mt-3 rounded-lg bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
            <Text>{`This campaign has ended. Close it to refund ${formatRM(c.pool_left_sen)} to ${c.funder}.`}</Text>
          </p>
        )}
        {attention === 'POOL_EMPTY' && (
          <p className="mt-3 rounded-lg bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
            <Text>The reward pool is used up, so no more rewards can be given. Close it to finish.</Text>
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {isAdmin && c.status === 'DRAFT' && (
          <Button size="sm" onClick={() => onFund(c)}><Text>Record payment</Text></Button>
        )}
        {isAdmin && (attention === 'ENDED' || attention === 'POOL_EMPTY') && (
          <Button size="sm" onClick={() => onClose(c)}><Text>Close and refund</Text></Button>
        )}
        {c.status !== 'DRAFT' && (
          <Button variant="secondary" size="sm" onClick={() => onReport(c)}>
            <BarChart3 className="size-4" aria-hidden /><Text>Results</Text></Button>
        )}
        {isAdmin && c.status !== 'CLOSED' && attention !== 'ENDED' && attention !== 'POOL_EMPTY' && (
          <Button variant="ghost" size="sm" onClick={() => onClose(c)}>
            <Text>{c.status === 'DRAFT' ? 'Cancel campaign' : 'Close early'}</Text>
          </Button>
        )}
      </div>
      {!isAdmin && c.status === 'DRAFT' && <p className="mt-3 text-sm text-ink-500"><Text>A township admin records the funder’s payment to start it.</Text></p>}
    </Card>
  );
}

function Group({ title, hint, campaigns, actions }: { title: string; hint: string; campaigns: Campaign[]; actions: CardActions }) {
  if (campaigns.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-ink-900"><Text>{title}</Text> <span className="text-ink-400 tabular-nums"><Text>{campaigns.length}</Text></span></h2>
      <p className="mb-3 text-sm text-ink-500"><Text>{hint}</Text></p>
      <div className="grid gap-4 lg:grid-cols-2">
        {campaigns.map((c) => <CampaignCard key={c.id} campaign={c} {...actions} />)}
      </div>
    </section>
  );
}

/** This year's challenges against what the tier includes, in words. Beyond that they run as extra one-offs, never refused. */
function allowanceText(sp: SponsorRow) {
  const used = sp.challenges_this_year;
  if (sp.active_tier === 'NONE') return `No tier: one-off challenges · ${used} this year`;
  if (sp.allowance === null) return `No set number · ${used} this year`;
  if (used > sp.allowance) return `All ${sp.allowance} included used · ${used - sp.allowance} extra this year`;
  return `${used} of ${sp.allowance} included challenges used this year`;
}

/** What the next tier up offers, shown once a sponsor has used what its tier includes. Peneraju has nowhere higher to go. */
const UPGRADE_HINT: Partial<Record<SponsorTier, string>> = {
  COMMUNITY_FRIEND: 'Running more? Rakan Township includes 4 challenges a year and adds banners in the app.',
  TOWNSHIP_PARTNER: 'Running more? Peneraju has no set number of challenges and makes them the only brand in their category.',
};
/** On an extra one-off, the next tier up, for the admin to mention when the payment is discussed. */
function UpgradeHint({ campaign: c }: { campaign: Campaign }) {
  const hint = c.extra ? UPGRADE_HINT[c.sponsor_tier as SponsorTier] : undefined;
  return hint ? <span className="mt-1 block font-medium text-brand-700"><Text>{hint}</Text></span> : null;
}
const isFull = (sp: SponsorRow | null) => sp !== null && sp.allowance !== null && sp.challenges_this_year >= sp.allowance;

const TIER_RULE = 'A tier is optional and paid yearly. Rakan Komuniti includes 1 challenge a year and Rakan Township 4; more can always run as extra one-offs. Peneraju has no set number.';
const TIER_RULE_STAFF = 'A tier is optional and paid yearly. Rakan Komuniti includes 1 challenge a year and Rakan Township 4; more can always run as extra one-offs. Peneraju has no set number. Only SDP HQ records tier payments.';

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
  return (
    <Card>
      <CardHeader
        title="Sponsors and tiers"
        description={isHq ? TIER_RULE : TIER_RULE_STAFF}
      />
      <Async state={sponsors}>
        {(list) =>
          list.length === 0 ? (
            <p className="px-5 py-6 text-[15px] text-ink-600"><Text>No sponsors yet. Add one under People.</Text></p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {list.map((sp) => {
                const hint = isFull(sp) && sp.active_tier !== 'NONE' ? UPGRADE_HINT[sp.active_tier] : undefined;
                return (
                  <li key={sp.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink-900">{sp.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                        {sp.active_tier !== 'NONE' ? (
                          <Badge tone="gold">
                            <Award className="size-3.5" aria-hidden />
                            <Text>{SPONSOR_TIER_INFO[sp.active_tier].label}</Text>
                          </Badge>
                        ) : (
                          <Badge><Text>No tier</Text></Badge>
                        )}
                        {sp.active_tier !== 'NONE' && sp.tier_until && <span><Text>{`until ${formatDate(sp.tier_until)}`}</Text></span>}
                        {sp.category && <span><Text>{`· ${sp.category}`}</Text></span>}
                      </span>
                    </span>
                    <span className="text-sm">
                      {sp.allowance !== null && <Progress value={sp.challenges_this_year} max={sp.allowance} tone="gold" label="Included challenges used this year" />}
                      <span className="mt-1.5 block text-ink-600"><Text>{allowanceText(sp)}</Text></span>
                      {hint && <span className="mt-1 block text-brand-700"><Text>{hint}</Text></span>}
                    </span>
                    {isHq && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setTier(sp.active_tier !== 'NONE' ? sp.active_tier : 'COMMUNITY_FRIEND');
                          setEditing(sp);
                        }}
                      ><Text>Record tier payment</Text></Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        }
      </Async>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Tier for ${editing?.name ?? ''}`}
        description={`Records the yearly fee of ${formatRM(SPONSOR_TIER_INFO[tier].feeSen)} as received.`}
        footer={
          <Button type="submit" form="tier-form" pending={save.pending}><Text>Record tier payment</Text></Button>
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
          <Input name="category" label="Category (for exclusivity)" defaultValue={editing?.category ?? ''} maxLength={60} error={save.fields.category} hint="One Peneraju per category, and only one at RM120,000." />
          <Input name="tagline" label="Banner text" defaultValue={editing?.tagline ?? ''} maxLength={120} error={save.fields.tagline} hint="Shown labelled “Sponsored”, never on safety screens." />
        </form>
      </Modal>
    </Card>
  );
}

type Tab = 'campaigns' | 'sponsors';

export default function CampaignsPage() {
  const me = useApi<Me>('/me');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [tab, setTab] = useState<Tab>('campaigns');
  const [creating, setCreating] = useState(false);
  const [funding, setFunding] = useState<Campaign | null>(null);
  const [closing, setClosing] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Campaign | null>(null);
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const reload = () => void campaigns.mutate();
  // Read once when the page opens; good enough for "days left".
  const [now] = useState(() => Date.now());
  const needsAction = (campaigns.data ?? []).filter((c) => attentionOf(c, now) !== null);

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
  const actions: CardActions = { isAdmin, now, onFund: setFunding, onClose: setClosing, onReport: setReport };

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
      <Tabs<Tab>
        label="Campaigns and sponsors"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'campaigns', label: 'Campaigns', count: needsAction.length },
          { key: 'sponsors', label: 'Sponsors & tiers' },
        ]}
      />

      {tab === 'campaigns' ? (
        <Async state={campaigns}>
          {(list) => {
            if (list.length === 0) {
              return <EmptyState title="No campaigns yet" action={<Button onClick={() => setCreating(true)}><Text>New campaign</Text></Button>}><Text>Set up a challenge for a sponsor, or a community programme funded by Sime Darby Property.</Text></EmptyState>;
            }
            const action = list.filter((c) => attentionOf(c, now) !== null).sort((a, b) => a.ends_at.localeCompare(b.ends_at));
            const running = list.filter((c) => c.status === 'FUNDED' && attentionOf(c, now) === null).sort((a, b) => a.ends_at.localeCompare(b.ends_at));
            const closed = list.filter((c) => c.status === 'CLOSED');
            return (
              <>
                {action.length === 0 ? (
                  <p className="mb-6 flex items-center gap-2 rounded-lg bg-success-50 px-4 py-3 text-[15px] text-success-700">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden /><Text>Nothing needs your action right now.</Text>
                  </p>
                ) : (
                  <p className="mb-4 flex items-center gap-2 text-[15px] text-ink-700">
                    <AlertCircle className="size-4 shrink-0 text-warning-600" aria-hidden /><Text>{action.length === 1 ? '1 campaign needs your action.' : `${action.length} campaigns need your action.`}</Text>
                  </p>
                )}
                <Group title="Needs action" hint="Record a payment to start a campaign, or close one that has finished to refund what is left." campaigns={action} actions={actions} />
                <Group title="Running" hint="Funded and giving rewards. Nothing to do until they end." campaigns={running} actions={actions} />
                <Group title="Closed" hint="Finished. Unused reward money has gone back to the funder." campaigns={closed} actions={actions} />
              </>
            );
          }}
        </Async>
      ) : (
        <SponsorTiers isHq={me.data?.role === 'HQ_ADMIN'} />
      )}

      <CreateCampaign open={creating} onClose={() => setCreating(false)} onCreated={reload} />
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
            <CampaignSplit campaign={funding} />
            {funding.extra && (
              <p className="rounded-lg bg-gold-50 px-4 py-3 text-sm text-ink-800">
                <Text>This is an extra one-off: the sponsor has used the challenges its tier includes this year.</Text>
                <UpgradeHint campaign={funding} />
              </p>
            )}
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

const STEPS = ['Who pays', 'The challenge', 'Budget and dates'] as const;
/** Which step shows each field, so a server error can take the admin back to it. */
const FIELD_STEP: Record<string, number> = { sponsorId: 0, title: 1, description: 1, goalTarget: 1, rewardPoints: 1, perPersonCap: 1, budgetSen: 2, startsAt: 2, endsAt: 2 };

/** Three short steps: who pays (and whether their tier allows another challenge), what residents do, and the money. */
function CreateCampaign({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const sponsors = useApi<SponsorRow[]>(open ? '/sponsors' : null);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(GOALS[0]!.value);
  const [sponsorId, setSponsorId] = useState('');
  const [budget, setBudget] = useState('');
  const [reward, setReward] = useState('300');
  const formRef = useRef<HTMLFormElement>(null);
  const selected = GOALS.find((g) => g.value === goal)!;
  const sponsor = sponsors.data?.find((s) => s.id === sponsorId) ?? null;
  const budgetSen = parseRM(budget) ?? 0;
  const split = campaignSplit(sponsorId || null);
  const { pool } = splitOf(budgetSen, split.poolBps, split.feeBps);
  const rewards = Number(reward) > 0 ? Math.floor(pool / Number(reward)) : 0;

  const close = () => {
    setStep(0);
    onClose();
  };
  const create = useAction((body: Record<string, unknown>) => api.post('/campaigns', body), {
    success: 'Campaign created. It starts once the payment is recorded.',
    onSuccess: () => {
      onCreated();
      close();
    },
  });
  const f = create.fields;
  // A server error on an earlier step takes the admin back to that field (adjusting state while rendering, not in an effect).
  const [seenFields, setSeenFields] = useState(f);
  if (seenFields !== f) {
    setSeenFields(f);
    const steps = Object.keys(f).map((k) => FIELD_STEP[k]).filter((s): s is number => s !== undefined);
    if (steps.length > 0) setStep(Math.min(...steps));
  }

  /** Checks the fields on this step before moving on. */
  const next = () => {
    const fields = formRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-step="${step}"] :is(input, textarea, select)`) ?? [];
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return;
      }
    }
    setStep((s) => s + 1);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < STEPS.length - 1) return next();
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
      startsAt: new Date(form.startsAt!).toISOString(),
      endsAt: new Date(`${form.endsAt}T23:59:59`).toISOString(),
    });
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal
      open={open}
      onClose={close}
      title="New campaign"
      description={`Step ${step + 1} of ${STEPS.length}`}
      wide
      footer={
        <>
          {step === 0 ? (
            <Button variant="secondary" onClick={close}><Text>Cancel</Text></Button>
          ) : (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}><Text>Back</Text></Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next}><Text>Next</Text></Button>
          ) : (
            <Button type="submit" form="create-campaign" pending={create.pending}><Text>Create campaign</Text></Button>
          )}
        </>
      }
    >
      <ol aria-hidden className="mb-5 grid grid-cols-3 gap-2">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className={`border-t-2 pt-2 text-xs font-semibold ${i <= step ? 'border-brand-600 text-brand-700' : 'border-ink-200 text-ink-400'}`}>
            <Text>{label}</Text>
          </li>
        ))}
      </ol>
      <form method="post" id="create-campaign" ref={formRef} onSubmit={submit} noValidate>
        <div data-step="0" hidden={step !== 0} className="space-y-4">
          <Select label="Who pays for it?" value={sponsorId} onChange={(event) => setSponsorId(event.target.value)} error={f.sponsorId} hint="Not listed? Add the sponsor under People first.">
            <option value=""><Text>Sime Darby Property (community programme)</Text></option>
            {sponsors.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {!sponsor ? (
            <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800"><Text>A community programme: the whole budget goes into rewards, with no campaign fee.</Text></p>
          ) : isFull(sponsor) ? (
            <div className="space-y-1.5 rounded-lg bg-gold-50 px-4 py-3 text-sm text-ink-800">
              <p><Text>{`${SPONSOR_TIER_INFO[sponsor.active_tier as SponsorTier].label} includes ${sponsor.allowance} challenge(s) a year, and all are used. This one runs as an extra one-off: 60% goes into rewards, with the usual 25% campaign fee and 15% running costs.`}</Text></p>
              {UPGRADE_HINT[sponsor.active_tier as SponsorTier] && <p className="font-medium text-brand-700"><Text>{UPGRADE_HINT[sponsor.active_tier as SponsorTier]!}</Text></p>}
            </div>
          ) : (
            <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
              {sponsor.active_tier === 'NONE' ? (
                <Text>No tier: a one-off challenge.</Text>
              ) : (
                <>
                  <Text>{SPONSOR_TIER_INFO[sponsor.active_tier].label}</Text><Text>{': '}</Text><Text>{allowanceText(sponsor)}</Text><Text>.</Text>
                </>
              )}{' '}
              <Text>60% of the budget goes into rewards; the 25% campaign fee and 15% running costs come out of it.</Text>
            </p>
          )}
        </div>

        <div data-step="1" hidden={step !== 1} className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" name="title" maxLength={100} required error={f.title} className="sm:col-span-2" placeholder="e.g. Kitar Challenge" />
          <Textarea label="What residents see" name="description" maxLength={600} required error={f.description} className="sm:col-span-2" placeholder="e.g. Recycle at any township kiosk this month and earn 300 points." />
          <Select label="What earns a reward" value={goal} onChange={(event) => setGoal(event.target.value)} className="sm:col-span-2">
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                <Text>{g.label}</Text>
              </option>
            ))}
          </Select>
          <Input label={selected.unit ? `A reward for every (${selected.unit})` : 'A reward for every (times)'} name="target" type="number" min={selected.unit ? 0.1 : 1} step={selected.unit ? 0.1 : 1} defaultValue={1} required error={f.goalTarget} hint={selected.unit ? `e.g. 10 means one reward per 10 ${selected.unit}` : 'e.g. 3 means one reward after every 3 times'} />
          <Input label="Points per reward" type="number" min={1} value={reward} onChange={(event) => setReward(event.target.value)} required error={f.rewardPoints} hint={Number(reward) > 0 ? `Worth ${formatRM(Number(reward))}` : undefined} />
          <Input label="Most rewards per person" name="cap" type="number" min={1} max={100} defaultValue={1} required error={f.perPersonCap} hint="Keep it at 1 so more residents get a reward." />
        </div>

        <div data-step="2" hidden={step !== 2} className="grid gap-4 sm:grid-cols-2">
          <Input label="Total budget (RM)" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="e.g. 20000" required error={f.budgetSen} className="sm:col-span-2" />
          <Input label="Starts" name="startsAt" type="date" defaultValue={today} required error={f.startsAt} />
          <Input label="Ends" name="endsAt" type="date" required error={f.endsAt} />
          {budgetSen > 0 && (
            <div className="space-y-3 rounded-lg border border-ink-200 p-4 sm:col-span-2">
              <BudgetSplit budgetSen={budgetSen} poolBps={split.poolBps} feeBps={split.feeBps} />
              <p className="text-sm text-ink-700">
                <Text>{`Enough for ${rewards.toLocaleString('en-MY')} rewards. Rewards stop when the pool runs out, and anything left is refunded when the campaign closes.`}</Text>
              </p>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
