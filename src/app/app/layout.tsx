import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { requireArea } from '@/server/auth/guard';

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requireArea(['RESIDENT']);
  return (
    <Shell area="resident" user={{ fullName: actor.fullName, role: actor.role }}>
      {children}
    </Shell>
  );
}
