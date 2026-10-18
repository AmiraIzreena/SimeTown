
import { Text } from '@/components/ui/localized-text';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/shell';
import { merchantOffers, requireArea } from '@/server/auth/guard';

export default async function Layout({ children }: { children: ReactNode }) {
  const actor = await requireArea(['MERCHANT']);
  const offers = await merchantOffers(actor);
  return (
    <Shell area="merchant" user={{ fullName: actor.fullName, role: actor.role, offers }}>
      <Text>{children}</Text>
    </Shell>
  );
}
