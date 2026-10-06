import type { Metadata } from 'next';
import { KitarScreen } from './screen';

export const metadata: Metadata = { title: 'Kitar' };

/** A scanned poster opens this page with its code in the address; anything else in that slot is ignored. */
export default async function KitarPage({ searchParams }: { searchParams: Promise<{ kiosk?: string }> }) {
  const { kiosk } = await searchParams;
  const scanned = typeof kiosk === 'string' && /^[A-Za-z0-9]{6,16}$/.test(kiosk) ? kiosk.toUpperCase() : '';
  return <KitarScreen scanned={scanned} />;
}
