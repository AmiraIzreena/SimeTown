import type { Metadata } from 'next';
import '../operations/parcel-workspace.css';
import { AccessConsole } from './console';

export const metadata: Metadata = { title: 'Access places' };

/** A notification links here with ?ref=ACC-000123 to open that incident. */
export default async function AccessPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return <AccessConsole initialRef={typeof ref === 'string' && /^ACC-\d{6,}$/i.test(ref) ? ref.toUpperCase() : null} />;
}
