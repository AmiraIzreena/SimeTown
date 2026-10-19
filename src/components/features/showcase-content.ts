import {
  Accessibility, Bike, HandHeart, Leaf, Recycle, Repeat2, TriangleAlert, type LucideIcon,
} from 'lucide-react';

/**
 * Demo content for the public Sponsors & Partners and Shops pages. Every shop
 * name is invented (the first two match the demo township's seed data);
 * photos are from Unsplash, free to use.
 */

/** A photo for a sponsor card, chosen from the sponsor's category (photos from Unsplash). */
const SPONSOR_PHOTOS: [RegExp, string][] = [
  [/solar|energy|power/i, '/images/sponsors/solar.jpg'],
  [/mobility|bike|bicycle|transport/i, '/images/sponsors/bicycle.jpg'],
  [/food|drink|coffee|cafe/i, '/images/sponsors/coffee.jpg'],
  [/recycl|waste/i, '/images/sponsors/recycling.jpg'],
  [/produce|grocer|market/i, '/images/sponsors/produce.jpg'],
  [/garden|nursery|plant/i, '/images/sponsors/garden.jpg'],
  [/health|fitness|sport/i, '/images/sponsors/fitness.jpg'],
];
const SPARE_PHOTOS = ['/images/sponsors/garden.jpg', '/images/sponsors/produce.jpg', '/images/sponsors/fitness.jpg', '/images/sponsors/recycling.jpg'];

export function sponsorImage(category: string | null, index: number): string {
  const match = category ? SPONSOR_PHOTOS.find(([pattern]) => pattern.test(category)) : undefined;
  return match ? match[1] : SPARE_PHOTOS[index % SPARE_PHOTOS.length]!;
}

export interface ShowcaseShop {
  id: string;
  name: string;
  category: string;
  image: string;
  offer: string | null;
  aksesFriendly: boolean;
  /** A shop that has applied and is waiting for approval. */
  joiningSoon?: boolean;
}

export const SHOPS: ShowcaseShop[] = [
  { id: 'kafe', name: 'Kafe Seri Pagi', category: 'Food & drink', image: '/images/shops/cafe.jpg', offer: 'RM3 off afternoon tea', aksesFriendly: true },
  { id: 'kedai', name: 'Kedai Runcit Mesra', category: 'Groceries', image: '/images/shops/grocery.jpg', offer: 'RM2 off your groceries', aksesFriendly: true },
  { id: 'roti', name: 'Roti Desa Bakery', category: 'Food & drink', image: '/images/shops/bakery.jpg', offer: 'RM1 off a loaf before 10am', aksesFriendly: false },
  { id: 'farmasi', name: 'Farmasi Elmina Sihat', category: 'Health', image: '/images/shops/pharmacy.jpg', offer: null, aksesFriendly: true },
  { id: 'dobi', name: 'Dobi Bersih Laundry', category: 'Services', image: '/images/shops/laundry.jpg', offer: 'RM2 off a wash and dry', aksesFriendly: false },
  { id: 'bunga', name: 'Kedai Bunga Melati', category: 'Home & garden', image: '/images/shops/florist.jpg', offer: null, aksesFriendly: false },
  { id: 'perkakas', name: 'Perkakasan Jaya', category: 'Home & garden', image: '/images/shops/hardware.jpg', offer: 'RM5 off repair tools', aksesFriendly: true },
  { id: 'bengkel', name: 'Bengkel Basikal Roda', category: 'Services', image: '/images/shops/bicycle.jpg', offer: null, aksesFriendly: false, joiningSoon: true },
];

/** How each township action looks on the Challenges page, and where in the app it is done. */
export const ACTIVITY_MEDIA: Record<string, { image: string; icon: LucideIcon; href: string; module: string }> = {
  KITAR_DROPOFF: { image: '/images/challenges/recycle.jpg', icon: Recycle, href: '/app/kitar', module: 'Kitar' },
  GERAK_LOOP: { image: '/images/challenges/trail.jpg', icon: Bike, href: '/app/gerak', module: 'Gerak' },
  GERAK_TRIP: { image: '/images/challenges/move.jpg', icon: Bike, href: '/app/gerak', module: 'Gerak' },
  GERAK_CHECKIN: { image: '/images/challenges/trail.jpg', icon: Bike, href: '/app/gerak', module: 'Gerak' },
  JIRAN_EVENT: { image: '/images/challenges/neighbours.jpg', icon: HandHeart, href: '/app/komuniti', module: 'Komuniti' },
  JIRAN_HELP: { image: '/images/challenges/neighbours.jpg', icon: HandHeart, href: '/app/komuniti', module: 'Komuniti' },
  KONGSI_SHARE: { image: '/images/challenges/share.jpg', icon: Repeat2, href: '/app/komuniti?tab=share', module: 'Komuniti' },
  LAPOR_REPORT: { image: '/images/challenges/report.jpg', icon: TriangleAlert, href: '/app/lapor', module: 'Lapor' },
  AKSES_UPDATE: { image: '/images/challenges/report.jpg', icon: Accessibility, href: '/app/akses', module: 'Akses+' },
};

export const FALLBACK_MEDIA = { image: '/images/challenges/neighbours.jpg', icon: Leaf, href: '/app', module: 'SimeTown' };
