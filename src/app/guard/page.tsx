import type { Metadata } from 'next';
import { GateScreen } from './gate';

export const metadata: Metadata = { title: 'Main gate' };

/** A scanned patrol poster opens this page with its code filled in; anything else in that slot is ignored. */
export default async function GatePage({ searchParams }: { searchParams: Promise<{ patrol?: string }> }) {
  const { patrol } = await searchParams;
  const initialPatrol = typeof patrol === 'string' && /^[A-Za-z0-9]{6,16}$/.test(patrol) ? patrol.toUpperCase() : '';
  return <GateScreen initialPatrol={initialPatrol} />;
}
