import type { Metadata } from 'next';
import { JoinMachine } from './join';

export const metadata: Metadata = { title: 'Kitar · recycle at a bin' };

/** The machine's screen shows a QR code that opens this page; anything else in the address is ignored. */
export default async function MachineJoinPage({ searchParams }: { searchParams: Promise<{ m?: string; c?: string }> }) {
  const { m, c } = await searchParams;
  const machineId = typeof m === 'string' && /^[0-9a-f-]{36}$/i.test(m) ? m : null;
  const code = typeof c === 'string' && /^[A-Za-z0-9_-]{10,40}$/.test(c) ? c : null;
  return <JoinMachine machineId={machineId} code={code} />;
}
