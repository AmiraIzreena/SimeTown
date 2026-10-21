import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Campaigns needing action' };

/** The console itself is in the Campaigns layout, so switching pills does not remount it. */
export default function Page() {
  return null;
}
