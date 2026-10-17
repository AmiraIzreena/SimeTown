import type { Metadata } from 'next';
import { KitarScreen } from './screen';

export const metadata: Metadata = { title: 'Kitar' };

/** Old kiosk posters open this page with ?kiosk=CODE. The typed drop-off form it filled is gone, so the page ignores it. */
export default function KitarPage() {
  return <KitarScreen />;
}
