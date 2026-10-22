'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedSvg } from '@/components/ui/localized-elements';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { GoogleTownshipMap } from './google-township-map';

export interface MapLoop {
  id: string;
  name: string;
  mode: string;
  path: [number, number][];
}
export interface MapCheckpoint {
  id: string;
  loop_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

/**
 * The township drawn from its own data: loop paths, checkpoints, the main
 * gate, a trip's route and where you are now. Drawn in the page (no map
 * tiles from a third party), so no location ever leaves the app to draw it.
 */
type TownshipMapProps = {
  loops: MapLoop[];
  checkpoints: MapCheckpoint[];
  gate?: { name: string | null; lat: number; lng: number } | null;
  route?: [number, number][];
  here?: { lat: number; lng: number } | null;
  hits?: string[];
  /** One loop to draw strongly, with the others faded behind it. */
  focusLoopId?: string | null;
  /** Changes when the map should frame its view again (a new "Show on map" tap, or Reset view). */
  viewKey?: string;
  className?: string;
};

export function TownshipMap(props: TownshipMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const route = props.route ?? [];
  const hits = props.hits ?? [];
  const fallback = <LocalTownshipMap {...props} route={route} hits={hits} />;

  if (!apiKey) return fallback;
  return <GoogleTownshipMap {...props} apiKey={apiKey} route={route} hits={hits} fallback={fallback} />;
}

function LocalTownshipMap({
  loops,
  checkpoints,
  gate,
  route = [],
  here,
  hits = [],
  focusLoopId,
  className,
}: TownshipMapProps) {
  const W = 640;
  const H = 400;
  // A highlighted loop fills the frame (unless a trip is being followed); otherwise the whole township.
  const focusPath = focusLoopId && !here ? loops.find((l) => l.id === focusLoopId)?.path : undefined;
  const project = useMemo(() => {
    const all: [number, number][] = focusPath && focusPath.length > 1 ? focusPath : [...loops.flatMap((l) => l.path), ...checkpoints.map((c) => [c.lat, c.lng] as [number, number]), ...(gate ? [[gate.lat, gate.lng] as [number, number]] : [])];
    if (all.length === 0) return null;
    const lats = all.map((p) => p[0]);
    const lngs = all.map((p) => p[1]);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    // Equal metres in both directions, with a margin, fitted to the frame.
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * kx, 1e-4);
    const spanY = Math.max(maxLat - minLat, 1e-4);
    const scale = Math.min((W - 80) / spanX, (H - 70) / spanY);
    const ox = (W - spanX * scale) / 2;
    const oy = (H - spanY * scale) / 2;
    return (lat: number, lng: number): [number, number] => [ox + (lng - minLng) * kx * scale, H - (oy + (lat - minLat) * scale)];
  }, [loops, checkpoints, gate, focusPath]);

  if (!project) {
    return <div className={cn('grid h-56 place-items-center rounded-lg bg-ink-50 text-sm text-ink-500', className)}><Text>The township map has not been drawn yet.</Text></div>;
  }
  const line = (points: [number, number][]) => points.map(([lat, lng], i) => `${i ? 'L' : 'M'}${project(lat, lng).map((n) => n.toFixed(1)).join(' ')}`).join(' ');
  const lake = loops.find((l) => /lake|tasik/i.test(l.name));
  const lakeShape = lake && lake.path.length > 3
    ? (() => {
        const cLat = lake.path.reduce((s, p) => s + p[0], 0) / lake.path.length;
        const cLng = lake.path.reduce((s, p) => s + p[1], 0) / lake.path.length;
        return line(lake.path.map(([lat, lng]) => [cLat + (lat - cLat) * 0.68, cLng + (lng - cLng) * 0.68]));
      })()
    : null;

  return (
    <LocalizedSvg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Township map with walking and cycling loops" className={cn('h-auto w-full rounded-lg border border-ink-200 bg-[#eef5ee]', className)}>
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="#dfe9df" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      {lakeShape && <path d={`${lakeShape} Z`} fill="#bfe0ea" stroke="#9ccbd9" strokeWidth="1.5" />}
      {lake && lakeShape && (() => {
        const cLat = lake.path.reduce((s, p) => s + p[0], 0) / lake.path.length;
        const cLng = lake.path.reduce((s, p) => s + p[1], 0) / lake.path.length;
        const [x, y] = project(cLat, cLng);
        return (
          <text x={x} y={y} textAnchor="middle" className="fill-[#4b8ea3] text-[13px] font-semibold italic"><Text>Tasik</Text></text>
        );
      })()}
      {[...loops].sort((a, b) => Number(a.id === focusLoopId) - Number(b.id === focusLoopId)).map((loop) => {
        const focused = focusLoopId === loop.id;
        return (
          <path key={loop.id} className="gerak-map-line" d={line(loop.path)} fill="none" stroke={loop.mode === 'CYCLE' ? '#c68a12' : '#23817d'} strokeWidth={focused ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={loop.mode === 'CYCLE' ? '10 7' : undefined} opacity={focusLoopId ? (focused ? 1 : 0.2) : 0.75} />
        );
      })}
      {route.length > 1 && <path d={line(route)} fill="none" stroke="#b91229" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />}
      {checkpoints.map((cp) => {
        const [x, y] = project(cp.lat, cp.lng);
        const hit = hits.includes(cp.id);
        return (
          <g key={cp.id} opacity={focusLoopId && cp.loop_id !== focusLoopId ? 0.3 : 1}>
            <circle cx={x} cy={y} r="9" fill={hit ? '#1a7f52' : 'white'} stroke={hit ? '#14643f' : '#0f5351'} strokeWidth="2.5" />
            {hit && <path d={`M${x - 4} ${y} l3 3 l5 -6`} fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
            <text x={x + 13} y={y + 4} className="fill-ink-800 text-[12px] font-semibold" paintOrder="stroke" stroke="#eef5ee" strokeWidth="4">
              {cp.name}
            </text>
          </g>
        );
      })}
      {gate && (() => {
        const [x, y] = project(gate.lat, gate.lng);
        return (
          <g>
            <rect x={x - 9} y={y - 9} width="18" height="18" rx="4" fill="#083433" />
            <text x={x} y={y + 4} textAnchor="middle" className="fill-white text-[11px] font-bold"><Text>G</Text></text>
            <text x={x - 14} y={y + 4} textAnchor="end" className="fill-ink-700 text-[11px] font-medium" paintOrder="stroke" stroke="#eef5ee" strokeWidth="4">
              <Text>{gate.name ?? 'Main gate'}</Text>
            </text>
          </g>
        );
      })()}
      {here && (() => {
        const [x, y] = project(here.lat, here.lng);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return null; // outside the township: nothing to draw
        return (
          <g>
            <circle cx={x} cy={y} r="16" fill="#2563eb" opacity="0.15" />
            <circle cx={x} cy={y} r="7" fill="#2563eb" stroke="white" strokeWidth="3" />
          </g>
        );
      })()}
    </LocalizedSvg>
  );
}
