import type { Metadata } from 'next';
import { PassView } from './view';

// A visitor's pass is reached only by its link: never indexed, and the link is not passed on to other sites.
export const metadata: Metadata = { title: 'Visitor pass', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function PassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{30,100}$/.test(token);
  return <PassView token={valid ? token : null} />;
}
