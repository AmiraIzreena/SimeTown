'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { MapCheckpoint, MapLoop } from './township-map';

type Position = { lat: number; lng: number };

interface GoogleOverlay {
  setMap(map: GoogleMap | null): void;
}

interface GoogleMarker {
  map: GoogleMap | null;
}

interface GoogleBounds {
  extend(position: Position): void;
  isEmpty(): boolean;
}

interface GoogleMap {
  fitBounds(bounds: GoogleBounds, padding?: number): void;
  setCenter(position: Position): void;
  setZoom(zoom: number): void;
}

interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Polyline: new (options: Record<string, unknown>) => GoogleOverlay;
  Circle: new (options: Record<string, unknown>) => GoogleOverlay;
  LatLngBounds: new () => GoogleBounds;
  marker: {
    AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMarker;
  };
}

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
    __kitaGoogleMapsReady?: () => void;
  }
}

let mapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (window.google?.maps?.Map && window.google.maps.marker?.AdvancedMarkerElement) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    window.__kitaGoogleMapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps loaded without the maps library.'));
      delete window.__kitaGoogleMapsReady;
    };

    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      loading: 'async',
      callback: '__kitaGoogleMapsReady',
      libraries: 'marker',
      v: 'weekly',
      region: 'MY',
      language: 'en',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.onerror = () => {
      mapsPromise = null;
      delete window.__kitaGoogleMapsReady;
      reject(new Error('Google Maps could not be loaded.'));
    };
    document.head.append(script);
  });

  return mapsPromise;
}

function markerContent(label: string, options: { hit?: boolean; gate?: boolean; here?: boolean } = {}) {
  const root = document.createElement('div');
  root.className = 'flex items-center gap-1.5 whitespace-nowrap font-sans text-xs font-semibold text-ink-900 drop-shadow-sm';

  const pin = document.createElement('span');
  pin.className = cn(
    'grid size-7 place-items-center rounded-full border-[3px] border-white shadow-md',
    options.gate ? 'rounded-md bg-brand-900 text-white' : options.here ? 'bg-blue-600 text-white' : options.hit ? 'bg-success-600 text-white' : 'bg-white text-brand-800',
  );
  pin.textContent = options.gate ? 'G' : options.here ? '●' : options.hit ? '✓' : '•';
  root.append(pin);

  if (!options.here) {
    const text = document.createElement('span');
    text.className = 'rounded bg-white/90 px-1.5 py-1 shadow-sm';
    text.textContent = label;
    root.append(text);
  }
  return root;
}

export function GoogleTownshipMap({
  apiKey,
  loops,
  checkpoints,
  gate,
  route,
  here,
  hits,
  className,
  fallback,
}: {
  apiKey: string;
  loops: MapLoop[];
  checkpoints: MapCheckpoint[];
  gate?: { name: string | null; lat: number; lng: number } | null;
  route: [number, number][];
  here?: Position | null;
  hits: string[];
  className?: string;
  fallback: ReactNode;
}) {
  const t = useT();
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMap | null>(null);
  const overlays = useRef<(GoogleOverlay | GoogleMarker)[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !element.current) return;

        for (const overlay of overlays.current) {
          if ('setMap' in overlay) overlay.setMap(null);
          else overlay.map = null;
        }
        overlays.current = [];

        const all: Position[] = [
          ...loops.flatMap((loop) => loop.path.map(([lat, lng]) => ({ lat, lng }))),
          ...checkpoints.map(({ lat, lng }) => ({ lat, lng })),
          ...route.map(([lat, lng]) => ({ lat, lng })),
          ...(gate ? [{ lat: gate.lat, lng: gate.lng }] : []),
          ...(here ? [here] : []),
        ];
        if (all.length === 0) return;

        const instance = map.current ?? new maps.Map(element.current, {
          center: all[0],
          zoom: 15,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          gestureHandling: 'cooperative',
        });
        map.current = instance;

        for (const loop of loops) {
          overlays.current.push(new maps.Polyline({
            map: instance,
            path: loop.path.map(([lat, lng]) => ({ lat, lng })),
            strokeColor: loop.mode === 'CYCLE' ? '#c68a12' : '#23817d',
            strokeOpacity: 0.9,
            strokeWeight: 5,
            icons: loop.mode === 'CYCLE' ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '18px' }] : undefined,
          }));
        }

        if (route.length > 1) {
          overlays.current.push(new maps.Polyline({
            map: instance,
            path: route.map(([lat, lng]) => ({ lat, lng })),
            strokeColor: '#b91229',
            strokeOpacity: 1,
            strokeWeight: 6,
            zIndex: 5,
          }));
        }

        for (const checkpoint of checkpoints) {
          overlays.current.push(new maps.marker.AdvancedMarkerElement({
            map: instance,
            position: { lat: checkpoint.lat, lng: checkpoint.lng },
            title: checkpoint.name,
            content: markerContent(checkpoint.name, { hit: hits.includes(checkpoint.id) }),
          }));
        }

        if (gate) {
          overlays.current.push(new maps.marker.AdvancedMarkerElement({
            map: instance,
            position: { lat: gate.lat, lng: gate.lng },
            title: gate.name ?? t('Main gate'),
            content: markerContent(gate.name ?? 'Main gate', { gate: true }),
          }));
        }

        if (here) {
          overlays.current.push(
            new maps.Circle({ map: instance, center: here, radius: 18, fillColor: '#2563eb', fillOpacity: 0.16, strokeColor: '#2563eb', strokeOpacity: 0.35, strokeWeight: 1 }),
            new maps.marker.AdvancedMarkerElement({ map: instance, position: here, title: t('Your current position'), content: markerContent('', { here: true }), zIndex: 10 }),
          );
        }

        const bounds = new maps.LatLngBounds();
        for (const point of all) bounds.extend(point);
        if (all.length === 1) {
          instance.setCenter(all[0]!);
          instance.setZoom(17);
        } else if (!bounds.isEmpty()) {
          instance.fitBounds(bounds, 48);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, checkpoints, gate, here, hits, loops, route, t]);

  if (failed) {
    return (
      <div className="space-y-2">
        {fallback}
        <p className="text-xs text-warning-700"><Text>Google Maps could not load. The built-in map is shown instead.</Text></p>
      </div>
    );
  }

  return <div ref={element} role="img" aria-label={t('Google Map with township walking and cycling loops')} className={cn('aspect-[8/5] min-h-72 w-full overflow-hidden rounded-lg border border-ink-200 bg-ink-50', className)} />;
}
