
import { Text } from '@/components/ui/localized-text';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { requireArea } from '@/server/auth/guard';

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requireArea(['SPONSOR']);
  return (
    <Shell area="sponsor" user={{ fullName: actor.fullName, role: actor.role }}>
      <Text>{children}</Text>
    </Shell>
  );
}
