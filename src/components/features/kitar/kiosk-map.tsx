'use client';

import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { KitarSite } from './sites';

type LeafletModule = typeof Leaflet;

/** OpenStreetMap's own tile server: no key, no account. Its attribution must stay visible. */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** A small CSS circle, not Leaflet's image marker (its images break in bundlers). Open kiosks are solid; coming-soon kiosks are hollow and grey. */
function pinIcon(L: LeafletModule, site: KitarSite, active: boolean) {
  const size = active ? 30 : 22;
  const look = site.status === 'OPEN' ? 'border-white bg-brand-600' : 'border-ink-400 bg-white';
  return L.divIcon({
    className: 'kitar-pin',
    html: `<span class="block size-full rounded-full border-[3px] shadow-md ${look} ${active ? 'ring-4 ring-brand-300/70' : ''}"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The Leaflet map behind the Map tab. Leaflet touches `window`, so it is loaded
 * here, in the browser only, never during server rendering. It never asks for
 * the resident's location.
 *
 * `focus` changes when the resident taps a kiosk card: the map then moves to
 * that kiosk and opens its popup. A tap on a pin calls `onSelect` instead.
 */
export function KioskMap({ sites, centre, selectedId, focus, onSelect, popupFor }: {
  sites: KitarSite[];
  centre: { lat: number; lng: number; zoom: number };
  selectedId: KitarSite['id'];
  focus: number;
  onSelect: (id: KitarSite['id']) => void;
  popupFor: (site: KitarSite) => HTMLElement;
}) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{ L: LeafletModule; map: Leaflet.Map; markers: Map<KitarSite['id'], Leaflet.Marker> } | null>(null);
  // Bumped each time a map is built, so the effects below run again for the new map.
  const [version, setVersion] = useState(0);
  // The latest callbacks, for Leaflet's event handlers, which are attached once.
  const handlers = useRef({ onSelect, popupFor });
  useEffect(() => {
    handlers.current = { onSelect, popupFor };
  }, [onSelect, popupFor]);

  // Build the map. It is rebuilt when the language changes, so its zoom buttons speak the new language.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      const el = container.current;
      if (cancelled || !el) return;
      const L = ((mod as { default?: LeafletModule }).default ?? mod) as LeafletModule;
      const map = L.map(el, { center: [centre.lat, centre.lng], zoom: centre.zoom, zoomControl: false, scrollWheelZoom: false });
      L.control.zoom({ zoomInTitle: t('Zoom in'), zoomOutTitle: t('Zoom out') }).addTo(map);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      const markers = new Map<KitarSite['id'], Leaflet.Marker>();
      for (const site of sites) {
        const marker = L.marker([site.lat, site.lng], {
          icon: pinIcon(L, site, false),
          title: site.status === 'OPEN' ? site.name : t('{name}, coming soon', { name: site.name }),
          alt: site.name,
          keyboard: true,
          riseOnHover: true,
        }).addTo(map);
        marker.bindPopup(() => handlers.current.popupFor(site), { autoPanPadding: [16, 16], maxWidth: 260 });
        marker.on('click', () => handlers.current.onSelect(site.id));
        markers.set(site.id, marker);
      }
      leaflet.current = { L, map, markers };
      setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
    };
  }, [centre, sites, t]);

  // The chosen kiosk's pin is larger, with a ring.
  useEffect(() => {
    const current = leaflet.current;
    if (!current) return;
    for (const site of sites) current.markers.get(site.id)?.setIcon(pinIcon(current.L, site, site.id === selectedId));
  }, [selectedId, sites, version]);

  // A tap on a card: move to its kiosk and open the popup.
  useEffect(() => {
    const current = leaflet.current;
    if (!current || focus === 0) return;
    const marker = current.markers.get(selectedId);
    if (!marker) return;
    const zoom = Math.max(current.map.getZoom(), centre.zoom);
    if (reducedMotion()) current.map.setView(marker.getLatLng(), zoom, { animate: false });
    else current.map.flyTo(marker.getLatLng(), zoom, { duration: 0.5 });
    marker.openPopup();
    // Only a new card tap should move the map, not a change of kiosk from a pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, version]);

  // New bin data (status changes every few seconds): refresh an open popup.
  useEffect(() => {
    const current = leaflet.current;
    if (!current) return;
    for (const site of sites) {
      const marker = current.markers.get(site.id);
      // A function, not an element, so later openings still build fresh content.
      if (marker?.isPopupOpen()) marker.getPopup()?.setContent(() => handlers.current.popupFor(site));
    }
  }, [popupFor, sites, version]);

  return <div ref={container} className="size-full" />;
}
