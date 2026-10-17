import type { KitarMachine } from './types';

/**
 * The four Kitar kiosk sites, as in the prototype. Fixed text, not database rows:
 * the township team runs every kiosk on the same hours. Elmina Green and West are
 * coming soon, as their sites still need a survey (spec, "To confirm").
 *
 * Map positions live here only. When the surveyed coordinates arrive, replace
 * `lat` and `lng` for each kiosk and set `verified: true`; nothing else changes.
 */
export type SiteStatus = 'OPEN' | 'COMING_SOON';

export interface KitarSite {
  id: 'gardens' | 'valley' | 'green' | 'west';
  name: string;
  /** The kiosk's name in the database, which links the site to its real bins. Null until the kiosk is set up. */
  kiosk: string | null;
  /** Where the kiosk is. Null while the site is still to be confirmed, so nothing is shown before it is decided. */
  location: string | null;
  /** The neighbourhoods the kiosk serves. */
  serves: string[];
  /** The kiosk's position on the map. */
  lat: number;
  lng: number;
  /** True once the position comes from a site survey. While any kiosk is false, the map says pin positions are approximate. */
  verified: boolean;
  status: SiteStatus;
}

/** Every open kiosk keeps these hours (spec, Roles: township team). */
export const KIOSK_HOURS = 'Open daily, 8:00 AM to 10:00 PM';
export const KIOSK_HOURS_SHORT = '8:00 AM to 10:00 PM';

/** The City of Elmina, where the map opens. */
export const MAP_CENTRE = { lat: 3.19917, lng: 101.50056, zoom: 14 };

export const KITAR_SITES: KitarSite[] = [
  {
    id: 'gardens', name: 'Elmina Gardens', kiosk: 'Kiosk Elmina Gardens', location: 'Beside Surau Elmina Gardens', serves: ['Elmina Gardens'], status: 'OPEN',
    // PLACEHOLDER: replace with surveyed coordinates
    lat: 3.2021, lng: 101.5036, verified: false,
  },
  {
    id: 'valley', name: 'Elmina Valley', kiosk: 'Kiosk Elmina Valley', location: 'Elmina Valley Central Park car park', serves: ['Elmina Valley 1', 'Elmina Valley 2'], status: 'OPEN',
    // PLACEHOLDER: replace with surveyed coordinates
    lat: 3.1993, lng: 101.4974, verified: false,
  },
  {
    id: 'green', name: 'Elmina Green', kiosk: null, location: null, serves: ['Elmina Green'], status: 'COMING_SOON',
    // PLACEHOLDER: replace with surveyed coordinates
    lat: 3.1961, lng: 101.5031, verified: false,
  },
  {
    id: 'west', name: 'Elmina West', kiosk: null, location: null, serves: ['Elmina West'], status: 'COMING_SOON',
    // PLACEHOLDER: replace with surveyed coordinates
    lat: 3.1958, lng: 101.4952, verified: false,
  },
];

export const OPEN_SITES = KITAR_SITES.filter((s) => s.status === 'OPEN');

/** The site's bins, matched by the kiosk's name. An older server sends no kiosk name, so the location stands in for it. */
export function binsAt(site: KitarSite, machines: KitarMachine[]): KitarMachine[] {
  if (!site.kiosk) return [];
  return machines.filter((m) => (m.kiosk ? m.kiosk === site.kiosk : m.location === site.location));
}
