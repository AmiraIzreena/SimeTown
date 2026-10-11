import type { Metadata } from 'next';
import { StatusView } from './view';

export const metadata: Metadata = { title: 'Flood status', description: 'The one official flood status page for the township: zone levels and the latest official message.' };

export default function StatusPage() {
  return <StatusView />;
}
