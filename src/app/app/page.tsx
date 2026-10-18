'use client';

import { Text } from '@/components/ui/localized-text';

import {
  Accessibility, Bike, Bot, CalendarClock, DoorOpen, Droplets, HandHeart, Inbox, Package, PiggyBank, Recycle, Repeat2, Sparkles, Sprout, Tag, TriangleAlert, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useState } from 'react';
import { CampaignCard, PendingRedemption } from '@/components/features/rewards';
import { SimpleHome } from '@/components/features/simple-mode';
import { SponsoredBanner } from '@/components/features/sponsored';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Progress } from '@/components/ui/card';
import { RankBars } from '@/components/ui/charts';
import { CountUp } from '@/components/ui/count-up';
import { Async, EmptyState, Skeleton, SkeletonList } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import type { BanjirOverview, Campaign, Me, SaleView } from '@/lib/types';
import { formatPoints, formatRM } from '@/shared/domain';

interface WalletOverview {
  points: number;
  offerPoints: number;
  totalPoints: number;
  saved: { pointsSen: number; offersSen: number; billsSen: number; totalSen: number };
  xp: number;
  level: { level: number; name: string; floor: number; next: number };
  residencyStatus: Me['residencyStatus'];
  pending: SaleView[];
}
interface Offers {
  offers: { id: string; merchantName: string; title: string; discountSen: number; usable: boolean }[];
}
interface Tamu {
  passes: { id: string; visitorName: string; type: string; status: string; validFrom: string; lastEntryAt: string | null }[];
  waiting: { id: string; visitor_name: string }[];
}

const ACTIONS: { href: string; label: string; text: string; icon: LucideIcon }[] = [
  { href: '/app/kitar', label: 'Kitar', text: 'Record a recycling drop-off', icon: Recycle },
  { href: '/app/gerak', label: 'Gerak', text: 'Track a walk or scan a checkpoint', icon: Bike },
  { href: '/app/tamu', label: 'Tamu', text: 'Visitor passes and the guardhouse', icon: DoorOpen },
  { href: '/app/parcels', label: 'Parcels', text: 'Parcels waiting at the guardhouse', icon: Package },
  { href: '/app/lapor', label: 'Lapor', text: 'Report a problem', icon: TriangleAlert },
  { href: '/app/requests', label: 'My requests', text: 'Everything your home is waiting on', icon: Inbox },
  { href: '/app/jimat', label: 'Jimat', text: 'Read a bill or enter readings', icon: Zap },
  { href: '/app/banjir', label: 'Banjir', text: 'Check flood levels', icon: Droplets },
  { href: '/app/taman', label: 'Taman', text: 'Garden plots and wildlife', icon: Sprout },
  { href: '/app/jiran', label: 'Jiran', text: 'Events and the help board', icon: HandHeart },
  { href: '/app/kongsi', label: 'Kongsi', text: 'Give away or lend an item', icon: Repeat2 },
  { href: '/app/wallet', label: 'Points & XP', text: 'Balance, history, badges', icon: Wallet },
  { href: '/app/akses', label: 'Akses+', text: 'Simple Mode, read-aloud and access needs', icon: Accessibility },
  { href: '/app/assistant', label: 'Assistant', text: 'Ask about the township', icon: Bot },
];

/** The demo township's recycling collection days (Tuesday and Friday). */
const COLLECTION_DAYS = [2, 5];

interface Moment {
  key: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  text: string;
  href: string;
}

/**
 * The "Today" card (proposal section 7): one card that changes through the day.
 * The flood level comes first when it matters, then a visitor at the gate or
 * expected, a shop offer nearby, and collection day.
 */
function TodayCard({ wallet }: { wallet?: WalletOverview }) {
  const t = useT();
  const flood = useApi<BanjirOverview>('/banjir', { refreshInterval: 15_000 });
  const tamu = useApi<Tamu>('/tamu');
  const offers = useApi<Offers>('/offers');
  const parcels = useApi<{ parcels: { id: string; courier: string; shelf: string; status: string }[] }>('/parcels');
  const now = new Date();
  const hour = Number(now.toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }));
  const weekday = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })).getDay();
  const greeting = hour < 12 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Good night';

  const moments: Moment[] = [];
  const myZone = flood.data?.zones.find((z) => z.id === flood.data?.myZoneId);
  if (myZone && myZone.status !== 'NORMAL') {
    moments.push({ key: 'flood', icon: Droplets, tone: myZone.status === 'DANGER' ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700', title: t(myZone.status === 'DANGER' ? 'Flood danger' : 'Flood warning'), text: myZone.what ?? `${myZone.name}: water at ${myZone.level_pct}%.`, href: '/app/banjir' });
  } else if (myZone) {
    moments.push({ key: 'flood', icon: Droplets, tone: 'bg-success-50 text-success-700', title: `${myZone.name}: ${myZone.level_pct}%`, text: t('Your area is safe right now.'), href: '/app/banjir' });
  }
  for (const w of tamu.data?.waiting ?? []) {
    moments.push({ key: `walkin-${w.id}`, icon: DoorOpen, tone: 'bg-gold-50 text-gold-700', title: t('Someone is at the main gate'), text: `${w.visitor_name}. Reply Expected, Not expected or Call me.`, href: '/app/tamu' });
  }
  const waiting = parcels.data?.parcels.filter((p) => p.status === 'WAITING') ?? [];
  if (waiting.length > 0) {
    moments.push({
      key: 'parcels',
      icon: Package,
      tone: 'bg-gold-50 text-gold-700',
      title: waiting.length === 1 ? t('A parcel is waiting at the guardhouse') : t('{n} parcels are waiting at the guardhouse', { n: waiting.length }),
      text: t('Show the collection code in Parcels to collect it.'),
      href: '/app/parcels',
    });
  }
  const today = now.toDateString();
  const expected = tamu.data?.passes.find((p) => p.status === 'ACTIVE' && !p.lastEntryAt && new Date(p.validFrom).toDateString() === today && (p.type === 'ONE_VISIT' || p.type === 'DELIVERY'));
  if (expected) moments.push({ key: 'visitor', icon: CalendarClock, tone: 'bg-brand-50 text-brand-700', title: `${expected.visitorName} is expected today`, text: 'You will be told the moment the guard scans their pass.', href: '/app/tamu' });
  const offer = offers.data?.offers.find((o) => o.usable);
  if (offer) {
    const covered = (wallet?.offerPoints ?? 0) >= offer.discountSen;
    moments.push({ key: 'offer', icon: Tag, tone: 'bg-gold-50 text-gold-700', title: `${offer.merchantName}: ${offer.title}`, text: covered ? `Your offer points cover it now (${formatPoints(offer.discountSen)} points).` : `${formatPoints(offer.discountSen)} offer points. Recycle at a kiosk bin or take a tracked walk to earn them.`, href: '/app/wallet' });
  }
  if (COLLECTION_DAYS.includes((weekday + 1) % 7)) moments.push({ key: 'collection', icon: Recycle, tone: 'bg-brand-50 text-brand-700', title: 'Recycling collection tomorrow', text: 'Put out paper and cans tonight, or drop them in a kiosk bin for XP.', href: '/app/kitar' });
  else if (COLLECTION_DAYS.includes(weekday)) moments.push({ key: 'collection', icon: Recycle, tone: 'bg-brand-50 text-brand-700', title: 'Recycling collection today', text: 'Bins go out before 8am. Missed it? The recycling kiosks are open daily, 8:00 AM to 10:00 PM.', href: '/app/kitar' });
  if (hour >= 6 && hour < 10) moments.push({ key: 'walk', icon: Bike, tone: 'bg-brand-50 text-brand-700', title: 'A cool morning at Elmina Central Park', text: 'Tap Start in Gerak; the checkpoints tick themselves.', href: '/app/gerak' });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-gradient-to-r from-brand-50 to-white px-5 py-3.5">
        <h2 className="text-base font-semibold">
          {t('Today')} · <Text>{greeting}</Text>
        </h2>
        <span className="text-sm text-ink-500"><Text>{now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kuala_Lumpur' })}</Text></span>
      </div>
      {moments.length === 0 ? (
        <p className="p-5 text-sm text-ink-500"><Text>Nothing needs you right now.</Text></p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {moments.slice(0, 4).map((m) => (
            <li key={m.key}>
              <Link href={m.href} className="flex items-start gap-3 px-5 py-3.5 transition-colors duration-200 hover:bg-ink-25">
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', m.tone)}>
                  <m.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink-900"><Text>{m.title}</Text></span>
                  <span className="block text-sm text-ink-600"><Text>{m.text}</Text></span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ResidentHome() {
  const t = useT();
  const me = useApi<Me>('/me');
  const access = useApi<{ simpleMode: boolean }>('/me/access');
  const wallet = useApi<WalletOverview>('/wallet', { refreshInterval: 5_000 });
  const campaigns = useApi<Campaign[]>('/campaigns');
  const league = useApi<{ streets: { street: string; xp: number; mine: boolean }[] }>('/leagues/streets');
  const tenants = useApi<{ id: string; full_name: string }[]>('/household/requests');
  const [fullApp, setFullApp] = useState(() => typeof window !== 'undefined' && window.sessionStorage.getItem('kita.fullApp') === '1');
  const decideTenant = useAction((id: string, approve: boolean) => api.post(`/household/requests/${id}`, { approve }), {
    onSuccess: () => void tenants.mutate(),
    success: 'Saved.',
  });
  const firstName = me.data?.fullName.split(' ')[0];

  if (access.data?.simpleMode && !fullApp) {
    return (
      <SimpleHome
        onFullApp={() => {
          window.sessionStorage.setItem('kita.fullApp', '1');
          setFullApp(true);
        }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-medium text-ink-500"><Text>{me.data?.township ?? ' '}</Text></p>
        <h1 className="mt-1 text-2xl font-bold sm:text-[28px]">{firstName ? `${t('Welcome')}, ${firstName}` : <Skeleton className="h-8 w-64" />}</h1>
      </header>

      {me.data?.residencyStatus === 'PENDING' && (
        <Card className="border-warning-600/30 bg-warning-50 p-5 text-[15px] text-warning-700">
          <p className="font-semibold"><Text>Your home is waiting to be confirmed.</Text></p>
          <p className="mt-1"><Text>You can look around now. Earning and spending start once the </Text><Text>{me.data.occupancy === 'TENANT' ? 'owner or the township office' : 'township office'}</Text><Text> confirms your home</Text><Text>{me.data.home ? ` at ${me.data.home.address}` : ''}</Text>.</p>
        </Card>
      )}
      {me.data?.residencyStatus === 'REJECTED' && (
        <Card className="border-accent-200 bg-accent-50 p-5 text-[15px] text-accent-700"><Text>We could not confirm your home. Please contact the township office.</Text></Card>
      )}

      {wallet.data?.pending.map((sale) => <PendingRedemption key={sale.id} sale={sale} onDecided={() => void wallet.mutate()} />)}

      {tenants.data?.map((tenant) => (
        <Card key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-[15px] text-ink-700">
            <strong className="text-ink-900">{tenant.full_name}</strong><Text> says they are a tenant in your home. Is that right?</Text></p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decideTenant.run(tenant.id, true)} disabled={decideTenant.pending}><Text>Yes, confirm</Text></Button>
            <Button size="sm" variant="secondary" onClick={() => decideTenant.run(tenant.id, false)} disabled={decideTenant.pending}><Text>No</Text></Button>
          </div>
        </Card>
      ))}

      {me.data?.residencyStatus === 'VERIFIED' && <TodayCard wallet={wallet.data} />}

      <Async
        state={wallet}
        skeleton={
          <div className="resident-metrics grid gap-4 md:grid-cols-3">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        }
      >
        {(w) => (
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/app/wallet" className="lift block rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white shadow-sm">
              <p className="text-sm font-medium text-brand-100">{t('SimeTown Points')}</p>
              <p className="mt-2 font-display text-[44px] font-bold leading-none tracking-tight tabular-nums">
                <CountUp value={w.totalPoints} />
              </p>
              <p className="mt-2 text-[15px] text-brand-100">{t('Worth {rm} at township shops', { rm: formatRM(w.totalPoints) })}</p>
              {w.offerPoints > 0 && (
                <p className="mt-3 text-xs text-brand-200">
                  <Text>{formatPoints(w.points)}</Text><Text> cash-backed · </Text><Text>{formatPoints(w.offerPoints)}</Text><Text> offer-backed</Text></p>
              )}
            </Link>
            <Link href="/app/wallet" className="lift block rounded-xl border border-ink-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-500">{t('Impact XP')}</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  <Sparkles className="size-3.5" aria-hidden /><Text>Level </Text><Text>{w.level.level}</Text> · {w.level.name}
                </span>
              </div>
              <p className="mt-2 font-display text-[44px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                <CountUp value={w.xp} />
              </p>
              <div className="mt-4">
                <Progress value={w.xp - w.level.floor} max={w.level.next - w.level.floor} label="Progress to the next level" />
                <p className="mt-1.5 text-sm text-ink-500"><Text>{w.level.next - w.xp}</Text><Text> XP to level </Text><Text>{w.level.level + 1}</Text></p>
              </div>
            </Link>
            <Link href="/app/wallet" className="lift block rounded-xl border border-gold-300/60 bg-gold-50 p-6 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gold-700">{t('You saved')}</p>
                <PiggyBank className="size-5 text-gold-700" aria-hidden />
              </div>
              <p className="mt-2 font-display text-[44px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                <CountUp value={w.saved.totalSen} format={formatRM} />
              </p>
              <p className="mt-3 text-sm text-ink-600"><Text>Points </Text><Text>{formatRM(w.saved.pointsSen)}</Text><Text> · Offers </Text><Text>{formatRM(w.saved.offersSen)}</Text><Text> · Bills </Text><Text>{formatRM(w.saved.billsSen)}</Text>
              </p>
            </Link>
          </div>
        )}
      </Async>

      <SponsoredBanner />

      <section aria-labelledby="actions-title">
        <h2 id="actions-title" className="mb-3 text-lg font-semibold">
          {t('What would you like to do?')}
        </h2>
        <div className="resident-actions grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ACTIONS.map((action, index) => (
            <Link key={action.href} href={action.href} className="lift flex items-start gap-3 rounded-lg border border-ink-200 bg-white p-4 shadow-xs" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                <action.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink-900"><Text>{action.label}</Text></span>
                <span className="block text-sm text-ink-500">{t(action.text)}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="campaigns-title">
        <h2 id="campaigns-title" className="mb-3 text-lg font-semibold">
          {t('Challenges with points')}
        </h2>
        <Async state={campaigns} skeleton={<SkeletonList rows={2} />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No funded challenges right now"><Text>You still earn Impact XP for every verified action. Points appear here when a sponsor or SDP funds a challenge.</Text></EmptyState>
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
        <CardHeader title={t('Street league')} description="This month’s Impact XP by street. Streets, not people." />
        <div className="p-5">
          <Async state={league} skeleton={<Skeleton className="h-32" />}>
            {(l) => <RankBars rows={l.streets.map((s) => ({ label: s.mine ? `${s.street} (yours)` : s.street, value: s.xp, highlight: s.mine }))} format={(n) => `${n.toLocaleString('en-MY')} XP`} />}
          </Async>
        </div>
      </Card>
    </div>
  );
}
