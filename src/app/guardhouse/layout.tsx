import { Text } from '@/components/ui/localized-text';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { requireArea } from '@/server/auth/guard';

export default async function Layout({ children }: { children: ReactNode }) {
  // Guardhouse staff run the parcel counter; township staff and admins can cover a shift.
  const actor = await requireArea(['GUARDHOUSE', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN']);
  return (
    <Shell area="guardhouse" user={{ fullName: actor.fullName, role: actor.role }}>
      <Text>{children}</Text>
    </Shell>
  );
}
