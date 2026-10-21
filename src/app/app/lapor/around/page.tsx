import type { Metadata } from 'next';
import { AroundScreen } from './screen';

export const metadata: Metadata = { title: 'Reports around the township' };

export default function Page() {
  return <AroundScreen />;
}
