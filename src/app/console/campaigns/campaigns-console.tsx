'use client';

import { Text } from '@/components/ui/localized-text';

import '../operations/parcel-workspace.css';
import { ArrowRight, Award, BarChart3, CheckCircle2, Clock3, Gift, Hourglass, Plus, Search, Target, Undo2, Wallet, type LucideIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { BudgetSplit, CampaignReport, CampaignSplit, CampaignStatus, givenOf, splitOf } from '@/components/features/campaign-admin';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { FilterBar, FilterChips, FilterSummary, SearchField } from '@/components/ui/filter-bar';
import { SubNav } from '@/components/ui/sub-nav';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { Campaign, Me } from '@/lib/types';
import { useMinLoading } from '@/lib/use-min-loading';
import { ADMINS, campaignSplit, formatPoints, formatRM, SPONSOR_TIERS, SPONSOR_TIER_INFO, type SponsorTier } from '@/shared/domain';
import { GERAK_CHALLENGE_RULES, gerakChallengeKind } from '@/shared/gerak-challenges';

/** What a campaign can reward, in words staff recognise. `unit` is set where a milestone total makes sense. */
const GOALS: { value: string; label: string; activity: string; metric: 'COUNT' | 'QUANTITY'; unit?: string; per?: number }[] = [
  { value: 'kitar-count', label: 'Kitar: each recycling drop-off', activity: 'KITAR_DROPOFF', metric: 'COUNT' },
  { value: 'kitar-kg', label: 'Kitar: kilograms recycled', activity: 'KITAR_DROPOFF', metric: 'QUANTITY', unit: 'kg', per: 1000 },
  { value: 'gerak-count', label: 'Gerak: each loop completed', activity: 'GERAK_LOOP', metric: 'COUNT' },
  // Distance on the township loops, finished or not; distance off the loops never counts (server/modules/gerak/distance.ts).
  { value: 'gerak-km', label: 'Gerak: kilometres on township loops (part-loops count)', activity: 'GERAK_LOOP', metric: 'QUANTITY', unit: 'km', per: 1000 },
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

/**
 * What a campaign counts and its goal, as staff chose them, so a whole-loops Gerak challenge is never
 * mistaken for a part-loops one. Gerak rules use the same words residents see (shared/gerak-challenges.ts).
 */
function GoalSummary({ campaign: c }: { campaign: Campaign }) {
  const goal = GOALS.find((g) => g.activity === c.activity && g.metric === c.goal_metric);
  const kind = gerakChallengeKind(c.activity, c.goal_metric);
  const target = c.goal_metric === 'QUANTITY' && goal?.per ? `${(c.goal_target / goal.per).toLocaleString('en-MY')} ${goal.unit}` : c.goal_target === 1 ? 'once' : `${c.goal_target} times`;
  return (
    <div className="mt-3 space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <Target className="size-4 shrink-0 text-brand-600" aria-hidden />
        <span><Text>{goal?.label ?? c.activity}</Text><Text>{` · goal ${target}`}</Text></span>
        {kind && <Badge tone={kind === 'WHOLE_LOOPS' ? 'brand' : 'neutral'}><Text>{GERAK_CHALLENGE_RULES[kind].tag}</Text></Badge>}
      </p>
      {kind && <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600"><Text>{GERAK_CHALLENGE_RULES[kind].rule}</Text></p>}
    </div>
  );
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
      <GoalSummary campaign={c} />
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

/**
 * The money behind the campaigns, as KPI tiles above the section pills. Each tile opens the
 * section it describes. Figures add up from the same cards the sections show.
 */
function CampaignKpis({ split, onPick }: { split: ReturnType<typeof sections>; onPick: (view: (typeof SECTIONS)[number]) => void }) {
  const sum = (list: Campaign[], pick: (c: Campaign) => number) => list.reduce((total, c) => total + pick(c), 0);
  const all = [...split.action, ...split.running, ...split.closed];
  const awaiting = sum(split.action, (c) => (c.status === 'DRAFT' ? c.budget_sen : 0));
  const toRefund = sum(split.action, (c) => (c.status === 'FUNDED' ? c.pool_left_sen : 0));
  const rewards = sum(all, (c) => c.rewards_given ?? 0);
  const tiles: { label: string; value: number; hint: string; icon: LucideIcon; tone: 'warning' | 'ok' | 'neutral'; pick: (typeof SECTIONS)[number] }[] = [
    { label: 'Awaiting payment', value: awaiting, hint: awaiting ? 'Record the payment to start' : 'Nothing waiting', icon: Hourglass, tone: awaiting ? 'warning' : 'ok', pick: 'action' },
    { label: 'To refund on closing', value: toRefund, hint: toRefund ? 'Close finished campaigns to refund' : 'Nothing to refund', icon: Undo2, tone: toRefund ? 'warning' : 'ok', pick: 'action' },
    { label: 'Left in reward pools', value: sum(split.running, (c) => c.pool_left_sen), hint: 'Still to be given as rewards', icon: Wallet, tone: 'neutral', pick: 'running' },
    { label: 'Paid out as rewards', value: sum(all, (c) => givenOf(c).given), hint: rewards === 1 ? '1 reward given' : `${formatPoints(rewards)} rewards given`, icon: Gift, tone: 'neutral', pick: 'running' },
  ];
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <button key={t.label} type="button" onClick={() => onPick(t.pick)} style={{ '--i': i } as CSSProperties} className={cn('ops-kpi glass-surface group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm', `is-${t.tone}`)}>
          <span className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-500"><Text>{t.label}</Text></span>
            <span className="ops-kpi-icon grid size-8 shrink-0 place-items-center rounded-lg"><t.icon className="size-4" aria-hidden /></span>
          </span>
          <span className="mt-2 block font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
            <CountUp value={t.value} format={formatRM} delay={i * 60} />
          </span>
          <span className="ops-kpi-hint mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="line-clamp-2 min-w-0"><Text>{t.hint}</Text></span>
            <ArrowRight className="ops-kpi-arrow size-3.5 shrink-0" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}

function Group({ hint, campaigns, actions }: { hint: string; campaigns: Campaign[]; actions: CardActions }) {
  if (campaigns.length === 0) return null;
  return (
    <section className="content-in mb-8">
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

/** Sponsor, included challenges, and (HQ only) the action; the header row uses the same columns. */
const SPONSOR_COLS = 'sm:grid-cols-[minmax(0,1fr)_16rem]';
const SPONSOR_COLS_HQ = 'sm:grid-cols-[minmax(0,1fr)_16rem_11rem] sm:[&>button]:justify-self-end';

/** A tier ending within this many days is flagged, so HQ can ask for the renewal before included challenges stop. */
const EXPIRING_DAYS = 30;
type SponsorChip = 'ALL' | 'OVER' | 'EXPIRING' | 'NONE';
function inChip(sp: SponsorRow, chip: SponsorChip, now: number): boolean {
  if (chip === 'OVER') return sp.allowance !== null && sp.challenges_this_year > sp.allowance;
  if (chip === 'EXPIRING') return sp.active_tier !== 'NONE' && sp.tier_until !== null && daysUntil(sp.tier_until, now) <= EXPIRING_DAYS;
  if (chip === 'NONE') return sp.active_tier === 'NONE';
  return true;
}

const TIER_RULE = 'A tier is optional and paid yearly. Rakan Komuniti includes 1 challenge a year and Rakan Township 4; more can always run as extra one-offs. Peneraju has no set number.';
const TIER_RULE_STAFF = 'A tier is optional and paid yearly. Rakan Komuniti includes 1 challenge a year and Rakan Township 4; more can always run as extra one-offs. Peneraju has no set number. Only SDP HQ records tier payments.';

/** Sponsors and their tiers. Only SDP HQ records a tier payment; the fee is income and never touches the float. */
function SponsorTiers({ isHq, isAdmin }: { isHq: boolean; isAdmin: boolean }) {
  const sponsors = useApi<SponsorRow[]>('/sponsors');
  // Adding the organisation lives here, beside its tier; its sign-in is made under People → Staff & partner access.
  const [adding, setAdding] = useState(false);
  const addSponsor = useAction((name: string) => api.post('/sponsors', { name }), {
    success: 'Sponsor added.',
    onSuccess: () => {
      setAdding(false);
      void sponsors.mutate();
    },
  });
  const [editing, setEditing] = useState<SponsorRow | null>(null);
  const [tier, setTier] = useState<SponsorTier>('COMMUNITY_FRIEND');
  const save = useAction((body: Record<string, string>) => api.post<{ feeSen: number }>(`/admin/sponsors/${editing!.id}/tier`, body), {
    onSuccess: () => {
      setEditing(null);
      void sponsors.mutate();
    },
    success: (r) => `Tier recorded: ${formatRM(r.feeSen)} for the year.`,
  });
  const t = useT();
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<SponsorChip>('ALL');
  // Read once when the tab opens; good enough for "days left" on a tier.
  const [now] = useState(() => Date.now());
  const year = new Date(now).getFullYear();
  const rows = sponsors.data ?? [];
  const term = q.trim().toLowerCase();
  const matches = (sp: SponsorRow) => !term || sp.name.toLowerCase().includes(term) || (sp.category ?? '').toLowerCase().includes(term);
  const count = (c: SponsorChip) => (sponsors.data ? rows.filter((sp) => matches(sp) && inChip(sp, c, now)).length : undefined);
  const shown = rows.filter((sp) => matches(sp) && inChip(sp, chip, now));
  const filtered = chip !== 'ALL' || Boolean(term);
  return (
    <div className="space-y-4">
      <FilterBar
        search={<SearchField value={q} onChange={setQ} label="Search sponsors" placeholder="Sponsor name or category, e.g. Kopi Hijau or Recycling" />}
        chips={
          <FilterChips<SponsorChip>
            label="Sponsors"
            value={chip}
            onChange={setChip}
            options={[
              { key: 'ALL', label: 'All sponsors', count: count('ALL') },
              { key: 'OVER', label: 'Over allowance', count: count('OVER'), alert: true },
              { key: 'EXPIRING', label: 'Expiring soon', count: count('EXPIRING'), alert: true },
              { key: 'NONE', label: 'No tier', count: count('NONE') },
            ]}
          />
        }
        summary={sponsors.data ? <FilterSummary shown={shown.length} total={rows.length} noun="sponsors" onClear={filtered ? () => { setChip('ALL'); setQ(''); } : undefined} /> : undefined}
      />
    <Card>
      <CardHeader
        title="Sponsors and tiers"
        description="Optional yearly tiers. Included challenges reset every calendar year."
        action={isAdmin && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /><Text>Add sponsor</Text></Button>}
      />
      <details className="mx-5 -mt-1 mb-4 text-sm text-ink-600 sm:mx-6">
        <summary className="cursor-pointer font-medium text-brand-700 hover:text-brand-800"><Text>How tiers work</Text></summary>
        <p className="mt-2 max-w-3xl"><Text>{isHq ? TIER_RULE : TIER_RULE_STAFF}</Text></p>
      </details>
      <Async state={sponsors}>
        {(list) =>
          list.length === 0 ? (
            <p className="px-5 py-6 text-[15px] text-ink-600"><Text>{isAdmin ? 'No sponsors yet. Add the first one with Add sponsor.' : 'No sponsors yet. A township admin can add one.'}</Text></p>
          ) : shown.length === 0 ? (
            <div className="border-t border-ink-100/80"><EmptyState icon={Search} title="No sponsors match"><Text>Try another name, category or filter.</Text></EmptyState></div>
          ) : (
            <>
            <div aria-hidden className={cn('hidden gap-3 border-t border-ink-100/80 bg-ink-25/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 sm:grid', isHq ? SPONSOR_COLS_HQ : SPONSOR_COLS)}>
              <span><Text>Sponsor</Text></span>
              <span><Text>{`Included challenges ${year}`}</Text></span>
              {isHq && <span />}
            </div>
            <ul key={chip} className="content-in divide-y divide-ink-100 border-t border-ink-100/80">
              {shown.map((sp) => {
                const hint = isFull(sp) && sp.active_tier !== 'NONE' ? UPGRADE_HINT[sp.active_tier] : undefined;
                const days = sp.active_tier !== 'NONE' && sp.tier_until ? daysUntil(sp.tier_until, now) : null;
                const expiring = days !== null && days <= EXPIRING_DAYS;
                const lapsed = sp.tier !== 'NONE' && sp.active_tier === 'NONE';
                const used = sp.challenges_this_year;
                return (
                  <li key={sp.id} className={cn('grid gap-3 px-5 py-4 sm:items-center', isHq ? SPONSOR_COLS_HQ : SPONSOR_COLS)}>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink-900">{sp.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
                        {sp.active_tier !== 'NONE' ? (
                          <Badge tone="gold">
                            <Award className="size-3.5" aria-hidden />
                            <Text>{SPONSOR_TIER_INFO[sp.active_tier].label}</Text>
                          </Badge>
                        ) : lapsed ? (
                          <Badge tone="warning"><Text>Tier lapsed</Text></Badge>
                        ) : (
                          <Badge><Text>No tier</Text></Badge>
                        )}
                        {days !== null && sp.tier_until && (
                          <span className={cn('inline-flex items-center gap-1', expiring && 'font-semibold text-warning-700')}>
                            {expiring && <Clock3 className="size-3.5" aria-hidden />}
                            <Text>{expiring ? (days <= 0 ? `Ends today, ${formatDate(sp.tier_until)}` : `Ends in ${days} days, ${formatDate(sp.tier_until)}`) : `until ${formatDate(sp.tier_until)}`}</Text>
                          </span>
                        )}
                        {sp.category && <span><Text>{`· ${sp.category}`}</Text></span>}
                      </span>
                    </span>
                    {/* Same three lines in every row: (label on a phone), bar, then figure and what is left. */}
                    <span className="text-sm">
                      <span className="mb-1.5 block text-xs font-medium text-ink-500 sm:hidden"><Text>{`Included challenges ${year}`}</Text></span>
                      {sp.allowance !== null ? (
                        <Progress value={used} max={sp.allowance} tone="gold" label="Included challenges used this year" />
                      ) : (
                        // No set number (Peneraju) or no tier: a soft full track keeps the rows lined up.
                        <span aria-hidden className={cn('block h-1.5 rounded-full', sp.active_tier === 'NONE' ? 'bg-ink-100' : 'bg-gold-100')} />
                      )}
                      <span className="mt-2 flex items-center justify-between gap-2">
                        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                          <strong className="font-semibold tabular-nums text-ink-900">{sp.allowance !== null ? `${used} / ${sp.allowance}` : used}</strong>
                          <span className="text-ink-500">
                            <Text>{sp.allowance === null ? (sp.active_tier === 'NONE' ? 'one-offs' : 'no set number') : used > sp.allowance ? `${used - sp.allowance} extra` : `${sp.allowance - used} left`}</Text>
                          </span>
                        </span>
                        {hint && <span title={t(hint)} className="shrink-0 whitespace-nowrap"><Badge tone="brand">Suggest upgrade</Badge></span>}
                      </span>
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
            </>
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
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a sponsor"
        description="The organisation that funds challenges. Record its tier afterwards, and make its sign-in under People → Staff & partner access."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}><Text>Cancel</Text></Button>
            <Button type="submit" form="add-sponsor" pending={addSponsor.pending}><Text>Add sponsor</Text></Button>
          </>
        }
      >
        <form id="add-sponsor" method="post" onSubmit={(event) => { event.preventDefault(); void addSponsor.run(String(new FormData(event.currentTarget).get('name') ?? '')); }}>
          <Input label="Organisation name" name="name" required minLength={2} maxLength={120} error={addSponsor.fields.name} />
        </form>
      </Modal>
    </div>
  );
}

/**
 * Each section has its own page: the Campaigns tab splits into Needs action, Running and Closed
 * (a pill bar, as on Parcels → Manage), and Sponsors & tiers is the second tab.
 */
export type CampaignsView = 'action' | 'running' | 'closed' | 'sponsors';

const HREF: Record<CampaignsView, string> = {
  action: '/console/campaigns',
  running: '/console/campaigns/running',
  closed: '/console/campaigns/closed',
  sponsors: '/console/campaigns/sponsors',
};
const SECTIONS = ['action', 'running', 'closed'] as const;

/** Splits the list the same way for the pills' counts and the cards shown. */
function sections(list: Campaign[], now: number): Record<(typeof SECTIONS)[number], Campaign[]> {
  const byEnd = (a: Campaign, b: Campaign) => a.ends_at.localeCompare(b.ends_at);
  return {
    action: list.filter((c) => attentionOf(c, now) !== null).sort(byEnd),
    running: list.filter((c) => c.status === 'FUNDED' && attentionOf(c, now) === null).sort(byEnd),
    closed: list.filter((c) => c.status === 'CLOSED'),
  };
}

const VIEWS: Record<Exclude<CampaignsView, 'sponsors'>, { title: string; hint: string; empty: string }> = {
  action: { title: 'Needs action', hint: 'Record a payment to start a campaign, or close one that has finished to refund what is left.', empty: 'Nothing needs your action right now.' },
  running: { title: 'Running', hint: 'Funded and giving rewards. Nothing to do until they end.', empty: 'No campaigns are running right now.' },
  closed: { title: 'Closed', hint: 'Finished. Unused reward money has gone back to the funder.', empty: 'No campaigns have closed yet.' },
};

/**
 * The console for whichever pill the address names. It lives in the Campaigns layout, so moving
 * between the pills keeps it mounted: the tiles do not count up again and the page stays put.
 */
export function CampaignsRoute() {
  const pathname = usePathname();
  const last = pathname.split('/').pop();
  const view: CampaignsView = last === 'running' || last === 'closed' || last === 'sponsors' ? last : 'action';
  return <CampaignsConsole view={view} />;
}

export function CampaignsConsole({ view }: { view: CampaignsView }) {
  const router = useRouter();
  const me = useApi<Me>('/me');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [creating, setCreating] = useState(false);
  const [funding, setFunding] = useState<Campaign | null>(null);
  const [closing, setClosing] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Campaign | null>(null);
  const isAdmin = me.data ? ADMINS.includes(me.data.role) : false;
  const reload = () => void campaigns.mutate();
  // Read once when the page opens; good enough for "days left".
  const [now] = useState(() => Date.now());
  const split = campaigns.data ? sections(campaigns.data, now) : null;
  // Tiles show a skeleton for at least 600ms on first load, so they never flash.
  const kpisLoading = useMinLoading('campaign-kpis', !campaigns.data);

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
      <Tabs<'campaigns' | 'sponsors'>
        label="Campaigns and sponsors"
        value={view === 'sponsors' ? 'sponsors' : 'campaigns'}
        onChange={(next) => router.push(next === 'sponsors' ? HREF.sponsors : HREF.action, { scroll: false })}
        items={[
          { key: 'campaigns', label: 'Campaigns', count: split?.action.length },
          { key: 'sponsors', label: 'Sponsors & tiers' },
        ]}
      />

      {view === 'sponsors' ? (
        <SponsorTiers isHq={me.data?.role === 'HQ_ADMIN'} isAdmin={isAdmin} />
      ) : (
        <>
        {kpisLoading || !split ? (
          !campaigns.error && <div className="mb-6"><SkeletonStats count={4} /></div>
        ) : (
          <CampaignKpis split={split} onPick={(next) => router.push(HREF[next], { scroll: false })} />
        )}
        <SubNav
          label="Campaigns"
          value={view}
          items={SECTIONS.map((key) => ({ key, label: VIEWS[key].title, count: split?.[key].length, alert: key === 'action' }))}
          hrefOf={(key) => HREF[key]}
          className="mb-6"
        />
        <Async state={campaigns}>
          {(list) => {
            if (list.length === 0) {
              return <EmptyState title="No campaigns yet" action={<Button onClick={() => setCreating(true)}><Text>New campaign</Text></Button>}><Text>Set up a challenge for a sponsor, or a community programme funded by Sime Darby Property.</Text></EmptyState>;
            }
            const shown = sections(list, now)[view];
            const v = VIEWS[view];
            // The pill already names the section and its count, so only the hint is repeated here.
            return shown.length === 0 ? (
              <>
                <p className="mb-3 text-sm text-ink-500"><Text>{v.hint}</Text></p>
                <p className={cn('flex items-center gap-2 rounded-lg px-4 py-3 text-[15px]', view === 'action' ? 'bg-success-50 text-success-700' : 'bg-ink-50 text-ink-600')}>
                  {view === 'action' && <CheckCircle2 className="size-4 shrink-0" aria-hidden />}<Text>{v.empty}</Text>
                </p>
              </>
            ) : (
              <Group hint={v.hint} campaigns={shown} actions={actions} />
            );
          }}
        </Async>
        </>
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
          <li key={label} aria-current={i === step ? 'step' : undefined} className={`border-t-2 pt-2 text-xs font-semibold ${i <= step ? 'border-brand-600 text-brand-700' : 'border-ink-200 text-ink-500'}`}>
            <Text>{label}</Text>
          </li>
        ))}
      </ol>
      <form method="post" id="create-campaign" ref={formRef} onSubmit={submit} noValidate>
        <div data-step="0" hidden={step !== 0} className="space-y-4">
          <Select label="Who pays for it?" value={sponsorId} onChange={(event) => setSponsorId(event.target.value)} error={f.sponsorId} hint="Not listed? Add the sponsor under Sponsors & tiers first.">
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
          {/* For Gerak, say exactly what counts before staff commit a budget: whole loops, part-loops, any trip or checkpoints. */}
          {(() => {
            const kind = gerakChallengeKind(selected.activity, selected.metric);
            return kind ? (
              <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900 sm:col-span-2" role="note">
                <Target className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
                <span><strong><Text>{GERAK_CHALLENGE_RULES[kind].tag}</Text></strong><Text>{'. '}</Text><Text>{GERAK_CHALLENGE_RULES[kind].rule}</Text><Text>{' Residents see this rule on the challenge card.'}</Text></span>
              </p>
            ) : null;
          })()}
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
