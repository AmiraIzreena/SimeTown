import type { Metadata } from 'next';
import { CampaignsConsole } from '../campaigns-console';

export const metadata: Metadata = { title: 'Sponsors & tiers' };

export default function Page() {
  return <CampaignsConsole view="sponsors" />;
}
