'use client';

import { Text } from '@/components/ui/localized-text';

import { ArrowRight, Cpu, FlaskConical, Plus, QrCode as QrIcon, Recycle, Scale, Ticket, UserRound, Users } from 'lucide-react';
import { LiveMachineSession } from '@/components/features/machine-session';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
import { HubSummary } from '@/components/features/kitar/hub-summary';
import { GOOD_TO_KNOW_ID, HOW_KITAR_WORKS, KitarAbout } from '@/components/features/kitar/kitar-about';
import { KitarMap } from '@/components/features/kitar/kitar-map';
import { PointsPausedBanner } from '@/components/features/kitar/limits-card';
import { ManualRecycleDialog } from '@/components/features/kitar/manual-recycle-dialog';
import { MaterialIcon } from '@/components/features/kitar/materials';
import { RatesList } from '@/components/features/kitar/rates-list';
import { RecycleSheet } from '@/components/features/kitar/recycle-sheet';
import type { KitarOverview, WalletSummary } from '@/components/features/kitar/types';
import { Badge } from '@/components/ui/card';
import { useState } from 'react';
import { CampaignCard } from '@/components/features/rewards';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatKg, rewardMessage, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { ActionRewardView, Campaign } from '@/lib/types';
import { MATERIAL_INFO } from '@/shared/domain';

const MACHINE_STATUS = { ONLINE: { label: 'Open', tone: 'success' as const }, FULL: { label: 'Full', tone: 'warning' as const }, OFFLINE: { label: 'Offline', tone: 'neutral' as const } };

type HubTab = 'tx' | 'map' | 'about';
const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: 'tx', label: 'Transaction' },
  { key: 'map', label: 'Map' },
  { key: 'about', label: 'About' },
];

export function KitarScreen() {
  const akses = useAksesMode();
  const overview = useApi<KitarOverview>('/kitar');
  const campaigns = useApi<Campaign[]>('/campaigns');
  // Only the hub shows points and level; Simple mode keeps its own layout and does not load them.
  const wallet = useApi<WalletSummary>(akses.simple ? null : '/wallet');
  const [tab, setTab] = useState<HubTab>('tx');
  // The Good to know tile the About tab opens with, set only by the "New here?" link.
  const [aboutTile, setAboutTile] = useState<string | null>(null);
  const [recycleOpen, setRecycleOpen] = useState(false);
  // The kiosk "Recycle here" on the Map tab starts the sheet on; null lets the resident choose.
  const [recycleSite, setRecycleSite] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  // The hub's "I have a guest code": the same claim form, in a Modal instead of on the page.
  const [guestOpen, setGuestOpen] = useState(false);
  // "Manual recycle (practice)": offered only when GET /kitar says test mode is available (a local pglite demo).
  const [manualOpen, setManualOpen] = useState(false);
  const testMode = Boolean(overview.data?.testEntry);

  const [claimCode, setClaimCode] = useState('');
  const claim = useAction(() => api.post<{ grams: number; reward: ActionRewardView | null }>('/kitar/claim', { code: claimCode.trim() }), {
    onSuccess: () => {
      setClaimCode('');
      void overview.mutate();
    },
    success: (r) => `Claimed ${formatKg(r.grams)}. ${rewardMessage(r.reward, 'Thank you for recycling.')} Guest recycling earns XP only.`,
  });
  // "New here? See how it works": open the About tab at Good to know, with the How Kitar works tile open.
  const showHowItWorks = () => {
    setAboutTile(HOW_KITAR_WORKS);
    setTab('about');
    requestAnimationFrame(() => {
      const section = document.getElementById(GOOD_TO_KNOW_ID);
      section?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      section?.focus({ preventScroll: true });
    });
  };
  const recycling = campaigns.data?.filter((c) => c.activity === 'KITAR_DROPOFF') ?? [];

  // --- The page's existing blocks, unchanged. Simple mode shows them in their original order; the hub's Transaction tab places them among the new parts.

  const statsBlock = (
    <Async state={overview} skeleton={<SkeletonStats count={3} />}>
      {(o) => (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat label="You, this month" value={o.monthGrams} format={formatKg} icon={Recycle} />
          <Stat label={o.street ? `${o.street}, this month` : 'Your street, this month'} value={o.streetMonthGrams} format={formatKg} icon={Users} />
          <div className="col-span-2 lg:col-span-1">
            <Stat label="You, all time" value={o.allGrams} format={formatKg} hint={`${o.dropOffs} drop-offs`} icon={Scale} tone="gold" />
          </div>
        </div>
      )}
    </Async>
  );

  const challengeBlock = recycling.length > 0 && (
    <div className="grid gap-4 md:grid-cols-2">
      {recycling.map((c) => (
        <CampaignCard key={c.id} campaign={c} />
      ))}
    </div>
  );

  const machineCard = (
    <Card>
      <CardHeader title="Kiosk bins with a scale" description="A 30-second stop: the bin’s scale sends the weight by itself, so there is nothing to type. Drop-offs weighed by a bin can also earn offer-backed points." />
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.2fr]">
        <Async state={overview} skeleton={<SkeletonStats count={1} />}>
          {(o) =>
            o.machines.length === 0 ? (
              <p className="text-sm text-ink-500"><Text>No bins with a scale in this township yet.</Text></p>
            ) : (
              <ul className="space-y-2">
                {o.machines.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 p-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                        <Cpu className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-ink-900">{m.name}</span>
                        <span className="block truncate text-sm text-ink-500"><Text>{m.location}</Text></span>
                      </span>
                    </span>
                    <Badge tone={MACHINE_STATUS[m.status].tone}><Text>{MACHINE_STATUS[m.status].label}</Text></Badge>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
        <ol className="space-y-3 text-[15px] text-ink-700">
          <li className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">1</span>
            <span>
              <strong className="text-ink-900"><Text>Scan the code on the bin’s screen</Text></strong><Text> with your phone camera. Its code changes every 30 seconds, so a photo of an old code is useless.</Text></span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">
              <QrIcon className="size-4" aria-hidden />
            </span>
            <span>
              <strong className="text-ink-900"><Text>Or show your SimeTown QR</Text></strong><Text> to the machine’s camera (Points & XP, “Show my code”). It works on a phone with no data, or on a printed card.</Text></span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-200 text-sm font-bold text-ink-700">
              <UserRound className="size-4" aria-hidden />
            </span>
            <span>
              <strong className="text-ink-900"><Text>Visitors recycle as a guest</Text></strong><Text> and get a claim code that a resident can claim within 14 days, for XP only.</Text></span>
          </li>
        </ol>
      </div>
      {akses.guided ? (
        <div className="border-t border-ink-100 p-5">
          <Button size="lg" className="min-h-16 w-full text-xl" onClick={() => setClaimOpen(true)}><Text>Claim guest recycling</Text></Button>
        </div>
      ) : (
      <form method="post" className="flex flex-wrap items-end gap-3 border-t border-ink-100 p-5" onSubmit={(event) => { event.preventDefault(); void claim.run(); }}>
        <Input label="Claim guest recycling" value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="8-letter code from the kiosk" autoComplete="off" spellCheck={false} maxLength={16} className="min-w-0 flex-1 basis-56" error={claim.fields.code} hint="Recycled before you joined, or with a guest? Enter the code the kiosk gave." />
        <Button type="submit" variant="secondary" pending={claim.pending} disabled={claimCode.trim().length < 6} className="mb-[26px]">
          <Ticket className="size-4" aria-hidden /><Text>Claim</Text></Button>
      </form>
      )}
    </Card>
  );

  const recentCard = (
    <Card>
      <CardHeader title="Your recent drop-offs" />
      <Async state={overview}>
        {(o) =>
          o.recent.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Recycle} title="No drop-offs yet"><Text>Kiosks: </Text><Text>{o.kiosks.map((k) => `${k.name} (${k.location})`).join('; ') || 'none set up yet'}</Text>.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {o.recent.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[15px]">
                  <div className="flex min-w-0 items-center gap-3">
                    <MaterialIcon material={d.material} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900"><Text>{MATERIAL_INFO[d.material].label}</Text>{d.test && <Badge tone="warning"><Text>Test entry</Text></Badge>}</p>
                      <p className="text-sm text-ink-500">
                        <Text>{d.kiosk}</Text> · <Text>{timeAgo(d.created_at)}</Text>
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold text-ink-800 tabular-nums"><Text>{formatKg(d.weight_g)}</Text></span>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </Card>
  );

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader title="Kitar" description="Recycle at a kiosk. Each bin has a scale that sends the weight by itself, so you never type it. Every drop-off earns Impact XP." />
      {akses.simple ? (
        <div className="space-y-6">
          {statsBlock}
          {challengeBlock}
          <LiveMachineSession onDone={() => void overview.mutate()} />
          {machineCard}
          {recentCard}
        </div>
      ) : (
        <>
          <Tabs items={HUB_TABS} value={tab} onChange={(next) => { setAboutTile(null); setTab(next); }} label="Kitar hub" />
          {tab === 'tx' && (
            <TabPanel>
              <div className="space-y-6">
                <HubSummary overview={overview} wallet={wallet} />
                <PointsPausedBanner status={overview.data?.points?.status} />
                <div className={`grid gap-3 ${testMode ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  <Button size="lg" className="w-full" onClick={() => setRecycleOpen(true)}>
                    <Plus className="size-5" aria-hidden /><Text>Recycle now</Text></Button>
                  <Button size="lg" variant="secondary" className="w-full" onClick={() => (akses.guided ? setClaimOpen(true) : setGuestOpen(true))}>
                    <Ticket className="size-5" aria-hidden /><Text>I have a guest code</Text></Button>
                  {testMode && (
                    <Button size="lg" variant="secondary" className="w-full border-dashed border-warning-600/60 text-warning-700" onClick={() => setManualOpen(true)}>
                      <FlaskConical className="size-5" aria-hidden /><Text>Manual recycle (practice)</Text></Button>
                  )}
                </div>
                <LiveMachineSession onDone={() => { void overview.mutate(); void wallet.mutate(); }} />
                {challengeBlock}
                {overview.data && <RatesList overview={overview.data} />}
                <button type="button" onClick={showHowItWorks} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-[15px] font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900">
                  <Text>New here? See how it works</Text><ArrowRight className="size-4" aria-hidden /></button>
                {recentCard}
              </div>
            </TabPanel>
          )}
          {tab === 'map' && (
            <TabPanel>
              <KitarMap machines={overview.data?.machines} onRecycleHere={(kiosk) => { setRecycleSite(kiosk); setRecycleOpen(true); }} />
            </TabPanel>
          )}
          {tab === 'about' && (
            <TabPanel>
              <KitarAbout overview={overview.data} openTile={aboutTile} />
            </TabPanel>
          )}
          <Modal
            open={guestOpen}
            onClose={() => setGuestOpen(false)}
            title="Claim a guest code"
            footer={
              <>
                <Button variant="secondary" onClick={() => setGuestOpen(false)}><Text>Cancel</Text></Button>
                <Button type="submit" form="guest-claim" pending={claim.pending} disabled={claimCode.trim().length < 6}>
                  <Ticket className="size-4" aria-hidden /><Text>Claim</Text></Button>
              </>
            }
          >
            <form id="guest-claim" method="post" onSubmit={(event) => { event.preventDefault(); void claim.run().then((result) => result && setGuestOpen(false)); }}>
              <Input label="Code from the kiosk" value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="8-letter code from the kiosk" autoComplete="off" spellCheck={false} maxLength={16} error={claim.fields.code} hint="Recycled before you joined, or with a guest? Enter the code the kiosk gave. Guest recycling earns XP only." />
            </form>
          </Modal>
          <RecycleSheet open={recycleOpen} onClose={() => { setRecycleOpen(false); setRecycleSite(null); }} initialSite={recycleSite} machines={overview.data?.machines ?? []} rates={overview.data?.rates} limits={overview.data?.limits} />
          {testMode && overview.data && (
            <ManualRecycleDialog open={manualOpen} onClose={() => setManualOpen(false)} overview={overview.data} wallet={wallet.data} onSaved={() => Promise.all([overview.mutate(), wallet.mutate()])} />
          )}
        </>
      )}
      {akses.guided && (
        <>
          <AksesWizard open={claimOpen} title="Claim guest recycling" step={0} total={1} onClose={() => setClaimOpen(false)} onBack={() => undefined} onNext={() => undefined} onSubmit={() => void claim.run().then((result) => result && setClaimOpen(false))} pending={claim.pending} submitLabel="Claim">
            <Input label="Code from the kiosk" labelClassName="!text-3xl !font-semibold" value={claimCode} onChange={(event) => setClaimCode(event.target.value.toUpperCase())} placeholder="8-letter code" maxLength={16} error={claim.fields.code} />
          </AksesWizard>
        </>
      )}
    </AksesPage>
  );
}
