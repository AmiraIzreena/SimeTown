import {
  Accessibility, Barcode, Bike, Bot, Building2, CalendarCheck, ClipboardList, DoorOpen, Droplets, Gauge, HandHeart, History, Home, House, Inbox, Landmark, MapPin, Megaphone,
  MessageCircleQuestionMark, Package, Receipt, Recycle, ScrollText, Settings, ShieldAlert, Store, Tag, TriangleAlert, UserRound, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react';
import { ADMINS, type Role } from '@/shared/domain';

export type Area = 'resident' | 'merchant' | 'sponsor' | 'guard' | 'courier' | 'console';

export interface NavItem {
  href: string;
  label: string;
  /** The Malay feature name gets a short English gloss for people new to the app. */
  gloss?: string;
  icon: LucideIcon;
  roles?: readonly Role[];
  /** Business menus: shown only when the account offers this (a shop, home services, or both). */
  offer?: 'retail' | 'services';
  /** Shown in the phone's bottom bar. Everything else sits behind "More". */
  primary?: boolean;
  /** A heading for long menus (the console): it starts where the group changes. */
  group?: string;
  /** Demo tooling, left out of the menu when demo mode is off (NEXT_PUBLIC_DEMO_MODE=false). */
  demoOnly?: boolean;
}

export const NAV: Record<Area, { title: string; items: NavItem[] }> = {
  resident: {
    title: 'Resident',
    // Grouped like the console, and every item has a short description beside it. The order keeps the phone's
    // bottom bar (the first four primary items: Home, Points & XP, Kitar, Lapor) exactly as before.
    items: [
      { href: '/app', label: 'Home', gloss: 'Your day', icon: Home, primary: true, group: 'Overview' },
      { href: '/app/wallet', label: 'Points & XP', gloss: 'Rewards', icon: Wallet, primary: true, group: 'Overview' },
      { href: '/notifications', label: 'Notifications', gloss: 'Updates', icon: Inbox, group: 'Overview' },
      { href: '/app/kitar', label: 'Kitar', gloss: 'Recycle', icon: Recycle, primary: true, group: 'Recycle & move' },
      { href: '/app/gerak', label: 'Gerak', gloss: 'Move', icon: Bike, group: 'Recycle & move' },
      { href: '/app/lapor', label: 'Lapor', gloss: 'Report', icon: TriangleAlert, primary: true, group: 'Around the township' },
      { href: '/app/komuniti', label: 'Komuniti', gloss: 'Neighbours & sharing', icon: HandHeart, group: 'Around the township' },
      { href: '/app/banjir', label: 'Banjir', gloss: 'Flood', icon: Droplets, group: 'Around the township' },
      { href: '/app/akses', label: 'Akses+', gloss: 'Access', icon: Accessibility, group: 'Around the township' },
      { href: '/app/tamu', label: 'Tamu', gloss: 'Visitors', icon: DoorOpen, group: 'Home & deliveries' },
      { href: '/app/parcels', label: 'Parcels', gloss: 'Deliveries', icon: Package, group: 'Home & deliveries' },
      { href: '/app/home-services', label: 'SimeTown Home', gloss: 'Home services', icon: House, group: 'Home & deliveries' },
      { href: '/app/assistant', label: 'Assistant', gloss: 'Ask anything', icon: Bot, group: 'Help & account' },
      { href: '/app/account', label: 'Account', gloss: 'Profile & settings', icon: UserRound, group: 'Help & account' },
    ],
  },
  merchant: {
    title: 'Business',
    items: [
      { href: '/merchant', label: 'Counter', icon: Store, primary: true, offer: 'retail' },
      { href: '/merchant/bookings', label: 'Bookings', icon: CalendarCheck, primary: true, offer: 'services' },
      { href: '/merchant/offers', label: 'Shop Offers', icon: Tag, primary: true, offer: 'retail' },
      { href: '/merchant/services', label: 'Services & workers', icon: Wrench, primary: true, offer: 'services' },
      { href: '/merchant/sales', label: 'Sales', icon: Receipt, primary: true, offer: 'retail' },
      { href: '/merchant/statements', label: 'Statements', icon: ScrollText, primary: true, offer: 'retail' },
      { href: '/notifications', label: 'Notifications', icon: Inbox },
      { href: '/merchant/account', label: 'Account', icon: UserRound },
    ],
  },
  sponsor: {
    title: 'Sponsor',
    items: [
      { href: '/sponsor', label: 'Campaigns', icon: Megaphone, primary: true },
      { href: '/sponsor/account', label: 'Account', icon: UserRound, primary: true },
    ],
  },
  guard: {
    title: 'Main gate',
    items: [
      { href: '/guard', label: 'Gate', icon: DoorOpen, primary: true },
      { href: '/guard/parcels', label: 'Parcels', icon: Package, primary: true },
      { href: '/guard/account', label: 'Account', icon: UserRound, primary: true },
    ],
  },
  courier: {
    title: 'Courier',
    items: [
      { href: '/courier', label: 'Deliver', icon: Package, primary: true },
      { href: '/courier/history', label: 'My deliveries', icon: History, primary: true },
      { href: '/courier/team', label: 'Team', icon: Users },
      { href: '/demo/labels', label: 'Demo labels', icon: Barcode, demoOnly: true },
      { href: '/courier/account', label: 'Account', icon: UserRound, primary: true },
    ],
  },
  console: {
    title: 'SDP console',
    // Grouped so staff scan four short lists instead of one of eighteen. Every page and role filter is unchanged.
    items: [
      { href: '/console', label: 'Insights', icon: Gauge, primary: true, group: 'Overview' },
      { href: '/notifications', label: 'Notifications', icon: Inbox, group: 'Overview' },
      { href: '/console/assistant', label: 'Assistant questions', icon: MessageCircleQuestionMark, group: 'Overview' },
      { href: '/console/reports', label: 'Lapor', icon: ClipboardList, primary: true, group: 'Operations' },
      { href: '/console/operations', label: 'Parcels', icon: Package, group: 'Operations' },
      { href: '/console/banjir', label: 'Flood dashboard', icon: Droplets, primary: true, group: 'Operations' },
      { href: '/console/places', label: 'Kiosks, trails & patrol points', icon: MapPin, group: 'Operations' },
      { href: '/console/recycling', label: 'Recycling collections', icon: Recycle, group: 'Operations' },
      { href: '/console/access', label: 'Access places', icon: Accessibility, group: 'Operations' },
      { href: '/console/home-services', label: 'Home service reports', icon: Wrench, group: 'Operations' },
      { href: '/console/komuniti', label: 'Komuniti', gloss: 'Reports & posts', icon: ShieldAlert, group: 'Community & partners' },
      { href: '/console/campaigns', label: 'Campaigns & sponsors', icon: Megaphone, group: 'Community & partners' },
      { href: '/console/shops', label: 'Shops', icon: Building2, roles: ADMINS, group: 'Community & partners' },
      { href: '/console/people', label: 'People', icon: Users, group: 'Community & partners' },
      { href: '/console/finance', label: 'Float & payments', icon: Landmark, group: 'Money & governance' },
      { href: '/console/audit', label: 'Audit trail', icon: History, roles: ADMINS, group: 'Money & governance' },
      { href: '/console/settings', label: 'Rules', icon: Settings, group: 'Money & governance' },
      { href: '/console/account', label: 'Account', icon: UserRound, group: '' },
    ],
  },
};
