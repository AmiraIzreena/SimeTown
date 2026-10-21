import { Shell } from '@/components/shell/shell';
import type { Area } from '@/components/shell/nav';
import { requireArea, merchantOffers } from '@/server/auth/guard';
import { ROLES, type Role } from '@/shared/domain';
import { notificationCategoriesFor } from '@/shared/notifications';
import NotificationsCenter from './screen';
const AREAS: Record<Role, Area> = { RESIDENT: 'resident', MERCHANT: 'merchant', SPONSOR: 'sponsor', GUARD: 'guard', COURIER: 'courier', TOWNSHIP_STAFF: 'console', TOWNSHIP_ADMIN: 'console', HQ_ADMIN: 'console' };
export default async function NotificationsPage() {
  const actor = await requireArea(ROLES);
  const offers = actor.role === 'MERCHANT' ? await merchantOffers(actor) : undefined;
  return <Shell area={AREAS[actor.role]} user={{ id: actor.id, fullName: actor.fullName, role: actor.role, offers }}>
    <NotificationsCenter resident={actor.role === 'RESIDENT'} categories={notificationCategoriesFor(actor.role, offers)} />
  </Shell>;
}
