import type { Metadata } from 'next';
import { CampaignsConsole } from './campaigns-console';

export const metadata: Metadata = { title: 'Campaigns needing action' };

export default function Page() {
  return <CampaignsConsole view="action" />;
}
