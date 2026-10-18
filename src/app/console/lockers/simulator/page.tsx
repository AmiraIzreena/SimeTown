import type { Metadata } from 'next';
import { Simulator } from './simulator';

export const metadata: Metadata = { title: 'Locker simulator' };

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const { station } = await searchParams;
  return <Simulator stationId={typeof station === 'string' && /^[0-9a-f-]{36}$/.test(station) ? station : ''} />;
}
