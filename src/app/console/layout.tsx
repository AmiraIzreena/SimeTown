import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { requireArea } from '@/server/auth/guard';
import { STAFF } from '@/shared/domain';

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requireArea(STAFF);
  return (
    <Shell area="console" user={{ fullName: actor.fullName, role: actor.role }}>
      {children}
    </Shell>
  );
}
