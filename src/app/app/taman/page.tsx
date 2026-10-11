import type { Metadata } from 'next';
import { TamanScreen } from './screen';

export const metadata: Metadata = { title: 'Taman' };

/** A scanned garden-gate poster opens this page with its code filled in; anything else in that slot is ignored. */
export default async function TamanPage({ searchParams }: { searchParams: Promise<{ garden?: string }> }) {
  const { garden } = await searchParams;
  const scanned = typeof garden === 'string' && /^[A-Za-z0-9]{6,16}$/.test(garden) ? garden.toUpperCase() : '';
  return <TamanScreen scanned={scanned} />;
}
