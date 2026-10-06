import type { Metadata } from 'next';
import { GerakScreen } from './screen';

export const metadata: Metadata = { title: 'Gerak' };

/** A scanned poster opens this page with its code in the address; anything else in that slot is ignored. */
export default async function GerakPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const scanned = typeof code === 'string' && /^[A-Za-z0-9]{6,16}$/.test(code) ? code.toUpperCase() : '';
  return <GerakScreen scanned={scanned} />;
}
