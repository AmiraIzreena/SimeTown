import type { ReactNode } from 'react';
import { CampaignsRoute } from './campaigns-console';

/** Needs action, Running, Closed and Sponsors share one mounted console; each page only sets its title. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <CampaignsRoute />
      {children}
    </>
  );
}
