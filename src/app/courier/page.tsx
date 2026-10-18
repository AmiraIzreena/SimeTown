import type { Metadata } from 'next';
import { CourierDesk } from './desk';

export const metadata: Metadata = { title: 'Deliver' };

/** A station's QR poster opens this page with the station filled in; anything else in that slot is ignored. */
export default async function CourierPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const { station } = await searchParams;
  return <CourierDesk initialStation={typeof station === 'string' && /^[A-Za-z0-9]{6,12}$/.test(station) ? station.toUpperCase() : ''} />;
}
