'use client';

import { Text } from '@/components/ui/localized-text';

import { Flag, LocateFixed, Play, ShieldCheck, Square, Timer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulatedNote } from '@/components/features/preview';
import { TownshipMap, type MapCheckpoint, type MapLoop } from '@/components/features/township-map';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Async } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatKm, rewardMessage } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { ActionRewardView } from '@/lib/types';
import { GERAK_MODES, GERAK_MODE_INFO, type GerakMode } from '@/shared/domain';

interface MapData {
  loops: MapLoop[];
  checkpoints: MapCheckpoint[];
  gate: { name: string | null; lat: number; lng: number } | null;
  active: { id: string; mode: GerakMode; simulated: boolean; started_at: string; distance_m: number; valid_m: number; active_s: number; route: [number, number][]; hits: string[] } | null;
  recent: { id: string; mode: GerakMode; simulated: boolean; started_at: string; distance_m: number; valid_m: number; too_fast_m: number; active_s: number; route: [number, number][]; reward: ActionRewardView | null }[];
  simulationAllowed: boolean;
}
interface Point {
  lat: number;
  lng: number;
  acc: number;
  t: number;
}
interface Progress {
  distanceM: number;
  validM: number;
  tooFastM: number;
  activeS: number;
  ignored: number;
  ticked: string[];
  ended: boolean;
  reward: ActionRewardView | null;
}
interface Finished {
  distanceM: number;
  validM: number;
  tooFastM: number;
  activeS: number;
  loopsCompleted: number;
  countedAsTrip: boolean;
  reward: ActionRewardView;
}

/** Walking pace and friends, in metres a second, for the demo playback only. */
const DEMO_SPEED: Record<GerakMode, number> = { WALK: 1.4, RUN: 2.8, CYCLE: 5, WHEELCHAIR: 1.2 };

/** Points every ~12 m along a path, at a steady speed: the demo's stand-in for GPS. */
function playback(path: [number, number][], startMs: number, speed: number): Point[] {
  const out: Point[] = [];
  let t = startMs;
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1]!;
    const [bLat, bLng] = path[i]!;
    const metres = Math.hypot((bLat - aLat) * 111_320, (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180));
    const steps = Math.max(1, Math.round(metres / 12));
    for (let s = 1; s <= steps; s++) {
      t += (metres / steps / speed) * 1000;
      out.push({ lat: aLat + ((bLat - aLat) * s) / steps, lng: aLng + ((bLng - aLng) * s) / steps, acc: 5, t: Math.round(t) });
    }
  }
  return out;
}

const minutes = (s: number) => `${Math.floor(s / 60)} min`;

/**
 * Gerak map tracking (proposal 6.2). Tap Start, follow the trip on the map,
 * checkpoints tick themselves, tap Finish. Position is read only while an
 * activity runs, and sent in small batches; the fair-play checks happen on
 * the server, not here.
 */
export function Tracker({ onFinished }: { onFinished: () => void }) {
  const toast = useToast();
  const map = useApi<MapData>('/gerak/map');
  const [mode, setMode] = useState<GerakMode>('WALK');
  const [demo, setDemo] = useState(false);
  const [demoLoop, setDemoLoop] = useState('');
  const [activity, setActivity] = useState<{ id: string; simulated: boolean; startedAt: number } | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [hits, setHits] = useState<string[]>([]);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [busy, setBusy] = useState(false);
  const buffer = useRef<Point[]>([]);
  const timers = useRef<{ watch?: number; flush?: number; play?: number }>({});

  const stopTimers = useCallback(() => {
    if (timers.current.watch !== undefined) navigator.geolocation.clearWatch(timers.current.watch);
    window.clearInterval(timers.current.flush);
    window.clearInterval(timers.current.play);
    timers.current = {};
  }, []);
  useEffect(() => stopTimers, [stopTimers]);

  const finishWith = useCallback(
    (result: Finished) => {
      stopTimers();
      setActivity(null);
      setFinished(result);
      void map.mutate();
      onFinished();
    },
    [map, onFinished, stopTimers],
  );

  /** Sends what has been collected since the last batch. */
  const flush = useCallback(
    async (id: string) => {
      const batch = buffer.current.splice(0, 300);
      if (batch.length === 0) return;
      try {
        const p = await api.post<Progress>(`/gerak/activities/${id}/points`, { points: batch });
        setProgress(p);
        if (p.ticked.length) {
          toast.show(`Checkpoint passed: ${p.ticked.join(', ')}`, 'success');
          void map.mutate().then((m) => m && setHits(m.active?.hits ?? []));
        }
        if (p.ended) {
          toast.show('Ten minutes without moving: your activity ended by itself.', 'success');
          finishWith({ distanceM: p.distanceM, validM: p.validM, tooFastM: p.tooFastM, activeS: p.activeS, loopsCompleted: 0, countedAsTrip: p.validM >= 200, reward: p.reward ?? { xp: 0, points: 0, fundedBy: [] } });
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ACTIVITY_ENDED') stopTimers();
      }
    },
    [finishWith, map, stopTimers, toast],
  );

  const follow = useCallback(
    (id: string, simulated: boolean, startedAt: number, loop?: MapLoop) => {
      stopTimers();
      if (simulated && loop) {
        // Demo playback: the recorded path at the chosen speed, sped up on screen, on the activity's own clock.
        const points = playback(loop.path, startedAt, DEMO_SPEED[mode]);
        let i = 0;
        timers.current.play = window.setInterval(() => {
          const p = points[i++];
          if (!p) {
            window.clearInterval(timers.current.play);
            return;
          }
          buffer.current.push(p);
          setTrail((t) => [...t, [p.lat, p.lng]]);
          setHere({ lat: p.lat, lng: p.lng });
        }, 250);
        timers.current.flush = window.setInterval(() => void flush(id), 2_000);
        return;
      }
      timers.current.watch = navigator.geolocation.watchPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp };
          buffer.current.push(p);
          setTrail((t) => [...t, [p.lat, p.lng]]);
          setHere({ lat: p.lat, lng: p.lng });
        },
        () => toast.show('Location is off. Allow location for this site, or scan the checkpoint posters instead.', 'error'),
        { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
      );
      timers.current.flush = window.setInterval(() => void flush(id), 10_000);
    },
    [flush, mode, stopTimers, toast],
  );

  const start = async () => {
    setBusy(true);
    setFinished(null);
    try {
      const loop = map.data?.loops.find((l) => l.id === (demoLoop || map.data?.loops[0]?.id));
      if (demo && !loop) throw new ApiError(0, 'NO_LOOP', 'There is no drawn loop to play back.');
      const a = await api.post<{ id: string; startedAt: string }>('/gerak/activities', { mode, simulated: demo });
      const startedAt = new Date(a.startedAt).getTime();
      buffer.current = [];
      setTrail([]);
      setHits([]);
      setProgress(null);
      setActivity({ id: a.id, simulated: demo, startedAt });
      follow(a.id, demo, startedAt, loop);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not start. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (id: string) => {
    setBusy(true);
    try {
      window.clearInterval(timers.current.play);
      await flush(id);
      finishWith(await api.post<Finished>(`/gerak/activities/${id}/finish`));
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not finish. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Track a walk, run or ride"
        description="Tap Start and follow your trip on the map. Checkpoints tick themselves as you pass; the QR code on the post is the backup."
        action={activity ? <Badge tone="brand"><Text>{activity.simulated ? 'Demo playback' : 'Tracking'}</Text></Badge> : undefined}
      />
      <div className="space-y-4 p-5">
        <Async state={map}>
          {(m) => {
            const running = activity ?? (m.active ? { id: m.active.id, simulated: m.active.simulated, startedAt: new Date(m.active.started_at).getTime() } : null);
            const latest = finished ? m.recent[0] : undefined;
            const route = activity ? trail : finished ? (latest?.route ?? []) : (m.active?.route ?? m.recent[0]?.route ?? []);
            return (
              <>
                <TownshipMap loops={m.loops} checkpoints={m.checkpoints} gate={m.gate} route={route} here={activity ? here : null} hits={activity ? hits : (m.active?.hits ?? [])} />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-500">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1 w-5 rounded bg-brand-500" /><Text> Walking loop</Text></span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1 w-5 rounded border-t-2 border-dashed border-gold-500" /><Text> Cycling loop</Text></span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1 w-5 rounded bg-accent-600" /> <Text>{activity ? 'This trip' : 'Your last trip (trimmed near home)'}</Text>
                  </span>
                </div>

                {running ? (
                  <div className="space-y-3">
                    <dl className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-lg bg-ink-50 p-3">
                        <dt className="text-xs font-medium text-ink-500"><Text>Distance</Text></dt>
                        <dd className="font-display text-xl font-bold tabular-nums"><Text>{formatKm(progress?.distanceM ?? m.active?.distance_m ?? 0)}</Text></dd>
                      </div>
                      <div className="rounded-lg bg-ink-50 p-3">
                        <dt className="text-xs font-medium text-ink-500"><Text>Counts (fair play)</Text></dt>
                        <dd className="font-display text-xl font-bold tabular-nums"><Text>{formatKm(progress?.validM ?? m.active?.valid_m ?? 0)}</Text></dd>
                      </div>
                      <div className="rounded-lg bg-ink-50 p-3">
                        <dt className="text-xs font-medium text-ink-500"><Text>Active</Text></dt>
                        <dd className="font-display text-xl font-bold tabular-nums"><Text>{minutes(progress?.activeS ?? m.active?.active_s ?? 0)}</Text></dd>
                      </div>
                    </dl>
                    {progress && (progress.ignored > 0 || progress.tooFastM > 0) && (
                      <p className="text-sm text-ink-600">
                        <Text>{progress.ignored > 0 && `${progress.ignored} weak GPS fixes ignored. `}</Text>
                        <Text>{progress.tooFastM > 0 && `${formatKm(progress.tooFastM)} was too fast for this activity and does not count.`}</Text>
                      </p>
                    )}
                    {!activity && (
                      <p className="text-sm text-ink-600"><Text>An activity is still running from </Text><Text>{new Date(running.startedAt).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}</Text><Text>. Finish it to be credited.</Text></p>
                    )}
                    <Button size="lg" variant="danger" onClick={() => void finish(running.id)} pending={busy}>
                      <Square className="size-4" aria-hidden /><Text>Finish</Text></Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {finished && (
                      <div className="animate-rise rounded-lg bg-success-50 p-4 text-[15px] text-success-700" aria-live="polite">
                        <p className="flex items-center gap-2 font-semibold">
                          <Flag className="size-4" aria-hidden />
                          <Text>{finished.countedAsTrip ? `${formatKm(finished.validM)} verified` : 'Too short to count as a trip (200 m or more)'}</Text>
                          <Text>{finished.loopsCompleted > 0 && ` · ${finished.loopsCompleted} loop${finished.loopsCompleted === 1 ? '' : 's'} complete`}</Text>
                        </p>
                        <p className="mt-1 text-sm"><Text>{rewardMessage(finished.reward, 'Thank you for moving.')}</Text></p>
                        {finished.tooFastM > 0 && <p className="mt-1 text-sm text-ink-700"><Text>{formatKm(finished.tooFastM)}</Text><Text> above the speed band for this activity did not count.</Text></p>}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Select label="Activity" value={mode} onChange={(event) => setMode(event.target.value as GerakMode)} hint={`Fair play: parts faster than ${GERAK_MODE_INFO[mode].maxSpeedKmh} km/h do not count.`}>
                        {GERAK_MODES.map((g) => (
                          <option key={g} value={g}>
                            <Text>{GERAK_MODE_INFO[g].label}</Text>
                          </option>
                        ))}
                      </Select>
                      {m.simulationAllowed && demo && (
                        <Select label="Demo route" value={demoLoop || m.loops[0]?.id || ''} onChange={(event) => setDemoLoop(event.target.value)}>
                          {m.loops.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    {m.simulationAllowed && <Switch label="Demo: play back a route instead of GPS" hint="For showing the feature indoors. Refused in production." checked={demo} onChange={setDemo} />}
                    <Button size="lg" onClick={() => void start()} pending={busy}>
                      <Play className="size-4" aria-hidden /><Text>Start</Text></Button>
                  </div>
                )}
                {activity?.simulated && <SimulatedNote><Text>Demo playback: positions follow the drawn loop instead of the phone’s GPS. The server applies the same fair-play checks.</Text></SimulatedNote>}
              </>
            );
          }}
        </Async>
        <ul className="grid gap-2 border-t border-ink-100 pt-4 text-sm text-ink-600 sm:grid-cols-3">
          <li className="flex gap-2">
            <LocateFixed className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><Text>Location only between Start and Finish.</Text></li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><Text>The first and last 200 m (near home) are never stored; routes are deleted after 30 days.</Text></li>
          <li className="flex gap-2">
            <Timer className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><Text>In a phone browser, tracking works while the screen is on.</Text></li>
        </ul>
      </div>
    </Card>
  );
}
