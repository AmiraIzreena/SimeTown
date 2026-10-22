'use client';

import { Text } from '@/components/ui/localized-text';

import { Bike, Check, ExternalLink, Footprints, History, MapPinned, QrCode, Route } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Reveal } from '@/components/ui/reveal';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
import { GerakChallenges } from '@/components/features/gerak/challenges';
import { GerakAbout } from '@/components/features/gerak/gerak-about';
import { CodeEntry } from '@/components/features/scan';
import { Tracker } from '@/components/features/tracker';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Progress, Stat } from '@/components/ui/card';
import { ReportProblemButton } from '@/components/features/report-problem';
import { Async, EmptyState, SkeletonList, SkeletonStats } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatKm, rewardMessage } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useAction, useApi } from '@/lib/hooks';
import type { ActionRewardView, Campaign } from '@/lib/types';

interface Loop {
  id: string;
  name: string;
  description: string;
  mode: 'WALK' | 'CYCLE';
  distance_m: number;
  checkpoints: { id: string; seq: number; name: string; lat: number | null; lng: number | null; scanned_today: boolean }[];
  timesCompleted: number;
  lastCompletedAt: string | null;
}
interface Overview {
  loops: Loop[];
  monthMetres: number;
  monthLoops: number;
  allLoops: number;
}
type GerakTab = 'track' | 'loops' | 'about';

interface CheckIn {
  checkpoint: string;
  loop: string;
  loopCompleted: boolean;
  remaining: number;
  reward: ActionRewardView;
}

export function GerakScreen({ scanned }: { scanned: string }) {
  const akses = useAksesMode();
  const overview = useApi<Overview>('/gerak');
  const campaigns = useApi<Campaign[]>('/campaigns');
  const [code, setCode] = useState(scanned);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [focusLoopId, setFocusLoopId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [tab, setTab] = useState<GerakTab>('track');

  /** Changes tab. Coming back to Track frames the map again, as it was hidden (and sized 0) meanwhile. */
  const changeTab = (next: GerakTab) => {
    if (next === 'track' && tab !== 'track') setFocusKey((n) => n + 1);
    setTab(next);
  };

  /**
   * Highlights a loop on the tracker map, frames it (again, even if the map was panned since) and
   * brings the map into view, switching to the Track tab first if needed. Tapping another loop
   * moves straight to it; the map's own toolbar has "Show all loops" and "Reset view".
   */
  const showOnMap = (id: string) => {
    setFocusLoopId(id);
    setFocusKey((n) => n + 1);
    setTab('track');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Wait a frame so the Track tab is visible before scrolling to its map.
    requestAnimationFrame(() => document.getElementById('gerak-tracker')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
  };

  const scan = useAction(() => api.post<CheckIn>('/gerak/checkins', { code: code.trim() }), {
    onSuccess: () => {
      setCode('');
      void overview.mutate();
      void campaigns.mutate();
    },
    success: (r) =>
      r.loopCompleted ? `${r.loop} complete! ${rewardMessage(r.reward, '')}` : `${r.checkpoint} scanned. ${r.remaining} more to finish ${r.loop}. ${rewardMessage(r.reward, '')}`,
  });
  const mobility = campaigns.data?.filter((c) => c.activity.startsWith('GERAK')) ?? [];
  const tabItems: TabItem<GerakTab>[] = [
    { key: 'track', label: 'Track' },
    { key: 'loops', label: 'Loops', count: overview.data?.loops.length },
    { key: 'about', label: 'About' },
  ];

  const statsBlock = (
    <Async state={overview} skeleton={<SkeletonStats count={4} />}>
      {(o) => <GerakStats o={o} />}
    </Async>
  );

  const trackerBlock = (
    <Reveal>
      <div id="gerak-tracker" className="scroll-mt-24">
        <Tracker
          onFinished={() => {
            void overview.mutate();
            void campaigns.mutate();
          }}
          focusLoopId={focusLoopId}
          focusKey={focusKey}
          onClearFocus={() => setFocusLoopId(null)}
        />
      </div>
    </Reveal>
  );

  // The poster backup as one slim strip: what it is on the left, the code on the right.
  const scanBlock = (
    <Reveal>
      <Card className="gerak-scan grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="flex items-start gap-3">
          <span className="gerak-scan-icon grid size-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
            <QrCode className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold"><Text>Or scan a checkpoint poster</Text></h2>
            <p className="mt-1 text-sm text-ink-600"><Text>The backup when GPS is weak. Scan every checkpoint of a loop on the same day.</Text></p>
          </div>
        </div>
        <div className="border-t border-ink-100 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          {akses.guided ? (
            <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => setCheckpointOpen(true)}><Text>Enter checkpoint code</Text></Button>
          ) : <CodeEntry label="Checkpoint code" value={code} onChange={setCode} onSubmit={() => void scan.run()} pending={scan.pending} error={scan.fields.code} action="Check in" />}
        </div>
      </Card>
    </Reveal>
  );

  const challengesBlock = (
    <Async state={campaigns} skeleton={<SkeletonList rows={2} />}>
      {() => <GerakChallenges campaigns={mobility} />}
    </Async>
  );

  const loopsBlock = (
    <section aria-labelledby="loops-title">
      <Async state={overview} skeleton={<><LoopsHeading /><SkeletonList rows={2} /></>}>
        {(o) => (
          <>
            <LoopsHeading loops={o.loops} />
            {o.loops.length === 0 ? (
              <EmptyState icon={Route} title="No loops yet"><Text>The township team has not set up any walking or cycling loops.</Text></EmptyState>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {o.loops.map((loop, i) => (
                  <Reveal key={loop.id} index={i % 2} className="h-full">
                    <LoopCard loop={loop} focused={focusLoopId === loop.id} onShowOnMap={() => showOnMap(loop.id)} />
                  </Reveal>
                ))}
              </div>
            )}
          </>
        )}
      </Async>
    </section>
  );

  return (
    <AksesPage>
      <PageHeader title="Gerak" description="Walk, run, cycle or wheel a township loop. Track it on the map and the checkpoints tick themselves, or scan the posters on the way." action={<ReportProblemButton context="GERAK" subtitle="A loop, a checkpoint, the map, your distance or a challenge" />} />
      {akses.simple ? (
        // Simple mode keeps one page, in the original order, as Kitar does.
        <div className="space-y-6">
          {statsBlock}
          {trackerBlock}
          {scanBlock}
          {challengesBlock}
          {loopsBlock}
        </div>
      ) : (
        <>
          <Tabs items={tabItems} value={tab} onChange={changeTab} label="Gerak" />
          <TabPanel>
            {/* Track stays mounted while hidden, so a trip being tracked keeps running on the other tabs. */}
            <div hidden={tab !== 'track'} className={tab === 'track' ? 'gerak-tab-in space-y-6' : undefined}>
              {statsBlock}
              {trackerBlock}
              {scanBlock}
              <div className="pt-4">{challengesBlock}</div>
            </div>
            {tab === 'loops' && <div className="gerak-tab-in">{loopsBlock}</div>}
            {tab === 'about' && <div className="gerak-tab-in"><GerakAbout /></div>}
          </TabPanel>
        </>
      )}
      {akses.guided && <AksesWizard open={checkpointOpen} title="Check in at a checkpoint" step={0} total={1} onClose={() => setCheckpointOpen(false)} onBack={() => undefined} onNext={() => undefined} onSubmit={() => void scan.run().then((result) => result && setCheckpointOpen(false))} pending={scan.pending} submitLabel="Check in">
        <Input label="Checkpoint code" labelClassName="!text-3xl !font-semibold" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. GABC2345XY" maxLength={16} error={scan.fields.code} hint="Scan the poster with your camera, or type the code printed under it." />
      </AksesWizard>}
    </AksesPage>
  );
}

/**
 * The Gerak headline figures, in the same KPI tiles as Kitar and the console: this month's
 * distance and loops, every loop completed, and today's checkpoints. Every number is the
 * resident's own recorded activity; nothing is estimated.
 */
function GerakStats({ o }: { o: Overview }) {
  const loopsToday = o.loops.filter((l) => l.checkpoints.length > 0 && l.checkpoints.every((c) => c.scanned_today)).length;
  const checkpointsTotal = o.loops.reduce((sum, l) => sum + l.checkpoints.length, 0);
  const checkpointsToday = o.loops.reduce((sum, l) => sum + l.checkpoints.filter((c) => c.scanned_today).length, 0);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Distance this month" value={o.monthMetres} format={formatKm} hint="On township loops, finished or not" icon={Route} />
      <Stat label="Loops this month" value={o.monthLoops} hint="Completed this month" icon={Bike} tone="gold" />
      <Stat label="Loops in total" value={o.allLoops} hint="Every loop you have completed" icon={Footprints} tone="success" />
      <Stat label="Checkpoints today" value={checkpointsToday} hint={`of ${checkpointsTotal} · ${loopsToday} of ${o.loops.length} loops done`} icon={MapPinned} />
    </div>
  );
}

/** The loops section heading, with a one-line summary once the loops have loaded. */
function LoopsHeading({ loops }: { loops?: Loop[] }) {
  const walking = loops?.filter((l) => l.mode === 'WALK').length ?? 0;
  const cycling = (loops?.length ?? 0) - walking;
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="loops-title" className="text-lg font-semibold tracking-tight"><Text>Township loops</Text></h2>
        <p className="mt-0.5 text-sm text-ink-500"><Text>Routes set up by the township team. Finish every checkpoint of a loop on the same day to complete it.</Text></p>
      </div>
      {loops && loops.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs font-medium text-ink-600">
          {walking > 0 && <span className="map-key-chip"><Footprints className="size-3.5 text-[#23817d]" aria-hidden /><Text>{walking === 1 ? '1 walking loop' : `${walking} walking loops`}</Text></span>}
          {cycling > 0 && <span className="map-key-chip"><Bike className="size-3.5 text-gold-600" aria-hidden /><Text>{cycling === 1 ? '1 cycling loop' : `${cycling} cycling loops`}</Text></span>}
        </div>
      )}
    </div>
  );
}

/** One township loop: today's progress, its checkpoints as numbered stops, your history on it and ways to get there. */
function LoopCard({ loop, focused, onShowOnMap }: { loop: Loop; focused: boolean; onShowOnMap: () => void }) {
  const t = useT();
  const total = loop.checkpoints.length;
  const done = loop.checkpoints.filter((c) => c.scanned_today).length;
  const complete = total > 0 && done === total;
  const start = loop.checkpoints.find((c) => c.lat !== null && c.lng !== null);
  const directions = start
    ? `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: `${start.lat},${start.lng}`, travelmode: loop.mode === 'CYCLE' ? 'bicycling' : 'walking' })}`
    : null;
  const ModeIcon = loop.mode === 'CYCLE' ? Bike : Footprints;

  return (
    <Card className={cn('loop-card relative flex h-full flex-col overflow-hidden p-5 sm:p-6', loop.mode === 'CYCLE' ? 'is-cycle' : 'is-walk', complete && 'is-complete', focused && 'is-focused')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand"><ModeIcon className="size-3.5" aria-hidden /><Text>{loop.mode === 'CYCLE' ? 'Cycling' : 'Walking'}</Text></Badge>
        <Badge><Text>{formatKm(loop.distance_m)}</Text></Badge>
        {complete && <Badge tone="success"><Check className="size-3.5" aria-hidden /><Text>Done today</Text></Badge>}
      </div>
      <h3 className="mt-3 text-[17px] font-semibold">{loop.name}</h3>
      <p className="mt-1 text-[15px] text-ink-600">{loop.description}</p>

      {total > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs font-medium text-ink-600">
            <span><Text>Today</Text></span>
            <span className="tabular-nums"><Text>{`${done} of ${total} checkpoints`}</Text></span>
          </div>
          <Progress value={done} max={total} label={`Checkpoints done today on ${loop.name}`} />
        </div>
      )}

      <ol className="mt-4 flex-1 space-y-2" aria-label={t(`Checkpoints on ${loop.name}, in order`)}>
        {loop.checkpoints.map((cp, i) => (
          <li key={cp.id} className={cn('gerak-checkpoint gerak-stop flex items-center gap-2.5 text-[15px]', cp.scanned_today && 'gerak-checkpoint-done')} style={{ '--i': i } as CSSProperties}>
            {cp.scanned_today ? (
              <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
                <circle cx="12" cy="12" r="12" className="fill-success-600" />
                <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink-200 bg-white text-xs font-semibold tabular-nums text-ink-500">{i + 1}</span>
            )}
            <span className={cp.scanned_today ? 'text-ink-900' : 'text-ink-600'}>{cp.name}</span>
            <span className="sr-only"><Text>{cp.scanned_today ? '(scanned today)' : '(not scanned yet)'}</Text></span>
          </li>
        ))}
      </ol>

      <p className="mt-4 flex items-center gap-1.5 text-sm text-ink-500">
        <History className="size-4 shrink-0" aria-hidden />
        {loop.timesCompleted > 0 && loop.lastCompletedAt ? (
          <span>
            <Text>{loop.timesCompleted === 1 ? 'You have completed this loop once' : `You have completed this loop ${loop.timesCompleted} times`}</Text>
            <Text> · last on </Text><Text>{formatDate(loop.lastCompletedAt)}</Text>
          </span>
        ) : (
          <Text>You have not completed this loop yet</Text>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
        <Button variant="secondary" size="sm" onClick={onShowOnMap} aria-pressed={focused}>
          <MapPinned className="gerak-icon-up size-4" aria-hidden />
          <Text>{focused ? 'Shown on map' : 'Show on map'}</Text>
        </Button>
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="gerak-link-btn btn btn-secondary inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 shadow-xs transition-[background-color,border-color,box-shadow,translate] duration-(--duration-fast) ease-soft hover:border-ink-300 hover:bg-ink-25 hover:shadow-sm active:scale-[0.98] motion-reduce:transition-none pointer-fine:hover:-translate-y-px"
          >
            <ExternalLink className="gerak-icon-out size-4" aria-hidden />
            <Text>Directions to start</Text>
            <span className="sr-only"><Text>(opens Google Maps)</Text></span>
          </a>
        )}
      </div>
    </Card>
  );
}
