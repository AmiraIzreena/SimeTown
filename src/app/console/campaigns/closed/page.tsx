import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Closed campaigns' };

/** The console itself is in the Campaigns layout, so switching pills does not remount it. */
export default function Page() {
  return null;
}
