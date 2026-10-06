'use client';

import { Bike, Droplets, HandHeart, Recycle, Repeat2, Sparkles, TriangleAlert, Wallet, Zap, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { CampaignCard, PendingRedemption } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Progress } from '@/components/ui/card';
import { RankBars } from '@/components/ui/charts';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState, Skeleton, SkeletonList } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Campaign, Me, SaleView } from '@/lib/types';
import { formatRM } from '@/shared/domain';

interface WalletOverview {
  points: number;
  xp: number;
  level: { level: number; name: string; floor: number; next: number };
  residencyStatus: Me['residencyStatus'];
  pending: SaleView[];
}

const ACTIONS: { href: string; label: string; text: string; icon: LucideIcon }[] = [
  { href: '/app/kitar', label: 'Kitar', text: 'Record a recycling drop-off', icon: Recycle },
  { href: '/app/gerak', label: 'Gerak', text: 'Scan a trail checkpoint', icon: Bike },
  { href: '/app/lapor', label: 'Lapor', text: 'Report a problem', icon: TriangleAlert },
  { href: '/app/jiran', label: 'Jiran', text: 'Events and the help board', icon: HandHeart },
  { href: '/app/kongsi', label: 'Kongsi', text: 'Give away or lend an item', icon: Repeat2 },
  { href: '/app/jimat', label: 'Jimat', text: 'Enter meter readings', icon: Zap },
  { href: '/app/banjir', label: 'Banjir', text: 'Check flood levels', icon: Droplets },
  { href: '/app/wallet', label: 'Points & XP', text: 'Balance, history, badges', icon: Wallet },
];

export default function ResidentHome() {
  const me = useApi<Me>('/me');
  const wallet = useApi<WalletOverview>('/wallet', { refreshInterval: 5_000 });
  const campaigns = useApi<Campaign[]>('/campaigns');
  const league = useApi<{ streets: { street: string; xp: number; mine: boolean }[] }>('/leagues/streets');
  const tenants = useApi<{ id: string; full_name: string }[]>('/household/requests');
  const decideTenant = useAction((id: string, approve: boolean) => api.post(`/household/requests/${id}`, { approve }), {
    onSuccess: () => void tenants.mutate(),
    success: 'Saved.',
  });
  const firstName = me.data?.fullName.split(' ')[0];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-medium text-ink-500">{me.data?.township ?? ' '}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-[28px]">{firstName ? `Selamat datang, ${firstName}` : <Skeleton className="h-8 w-64" />}</h1>
      </header>

      {me.data?.residencyStatus === 'PENDING' && (
        <Card className="border-warning-600/30 bg-warning-50 p-5 text-[15px] text-warning-700">
          <p className="font-semibold">Your home is waiting to be confirmed.</p>
          <p className="mt-1">You can look around now. Earning and spending start once the {me.data.occupancy === 'TENANT' ? 'owner or the township office' : 'township office'} confirms your home{me.data.home ? ` at ${me.data.home.address}` : ''}.</p>
        </Card>
      )}
      {me.data?.residencyStatus === 'REJECTED' && (
        <Card className="border-accent-200 bg-accent-50 p-5 text-[15px] text-accent-700">We could not confirm your home. Please contact the township office.</Card>
      )}

      {wallet.data?.pending.map((sale) => <PendingRedemption key={sale.id} sale={sale} onDecided={() => void wallet.mutate()} />)}

      {tenants.data?.map((tenant) => (
        <Card key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-[15px] text-ink-700">
            <strong className="text-ink-900">{tenant.full_name}</strong> says they are a tenant in your home. Is that right?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decideTenant.run(tenant.id, true)} disabled={decideTenant.pending}>
              Yes, confirm
            </Button>
            <Button size="sm" variant="secondary" onClick={() => decideTenant.run(tenant.id, false)} disabled={decideTenant.pending}>
              No
            </Button>
          </div>
        </Card>
      ))}

      <Async
        state={wallet}
        skeleton={
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        }
      >
        {(w) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Link href="/app/wallet" className="lift block rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white shadow-sm">
              <p className="text-sm font-medium text-brand-100">KITA Points</p>
              <p className="mt-2 font-display text-[44px] font-bold leading-none tracking-tight tabular-nums">
                <CountUp value={w.points} />
              </p>
              <p className="mt-2 text-[15px] text-brand-100">Worth {formatRM(w.points)} at township shops</p>
            </Link>
            <Link href="/app/wallet" className="lift block rounded-xl border border-ink-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-500">Impact XP</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  <Sparkles className="size-3.5" aria-hidden />
                  Level {w.level.level} · {w.level.name}
                </span>
              </div>
              <p className="mt-2 font-display text-[44px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                <CountUp value={w.xp} />
              </p>
              <div className="mt-4">
                <Progress value={w.xp - w.level.floor} max={w.level.next - w.level.floor} label="Progress to the next level" />
                <p className="mt-1.5 text-sm text-ink-500">{w.level.next - w.xp} XP to level {w.level.level + 1}</p>
              </div>
            </Link>
          </div>
        )}
      </Async>

      <section aria-labelledby="actions-title">
        <h2 id="actions-title" className="mb-3 text-lg font-semibold">
          What would you like to do?
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ACTIONS.map((action) => (
            <Link key={action.href} href={action.href} className="lift flex items-start gap-3 rounded-lg border border-ink-200 bg-white p-4 shadow-xs">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                <action.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink-900">{action.label}</span>
                <span className="block text-sm text-ink-500">{action.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="campaigns-title">
        <h2 id="campaigns-title" className="mb-3 text-lg font-semibold">
          Challenges with points
        </h2>
        <Async state={campaigns} skeleton={<SkeletonList rows={2} />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No funded challenges right now">You still earn Impact XP for every verified action. Points appear here when a sponsor or SDP funds a challenge.</EmptyState>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            )
          }
        </Async>
      </section>

      <Card>
        <CardHeader title="Street league" description="This month’s Impact XP by street. Streets, not people." />
        <div className="p-5">
          <Async state={league} skeleton={<Skeleton className="h-32" />}>
            {(l) => <RankBars rows={l.streets.map((s) => ({ label: s.mine ? `${s.street} (yours)` : s.street, value: s.xp, highlight: s.mine }))} format={(n) => `${n.toLocaleString('en-MY')} XP`} />}
          </Async>
        </div>
      </Card>
    </div>
  );
}
