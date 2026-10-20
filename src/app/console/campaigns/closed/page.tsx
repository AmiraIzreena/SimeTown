import type { Metadata } from 'next';
import { CampaignsConsole } from '../campaigns-console';

export const metadata: Metadata = { title: 'Closed campaigns' };

export default function Page() {
  return <CampaignsConsole view="closed" />;
}
