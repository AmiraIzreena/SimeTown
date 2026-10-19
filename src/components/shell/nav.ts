import {
  Accessibility, Barcode, Bike, Bot, Building2, CalendarCheck, ClipboardList, DoorOpen, Droplets, Gauge, HandHeart, History, Home, House, Inbox, Landmark, Layers, Leaf, MapPin, Megaphone,
  MessageCircleQuestionMark, Package, Receipt, Recycle, Repeat2, ScrollText, Settings, ShieldAlert, Sprout, Store, Sun, Tag, TriangleAlert, UserRound, Users, Wallet, Wrench, Zap, type LucideIcon,
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
}

export const NAV: Record<Area, { title: string; items: NavItem[] }> = {
  resident: {
    title: 'Resident',
    items: [
      { href: '/app', label: 'Home', icon: Home, primary: true },
      { href: '/app/wallet', label: 'Points & XP', icon: Wallet, primary: true },
      { href: '/app/kitar', label: 'Kitar', gloss: 'Recycle', icon: Recycle, primary: true },
      { href: '/app/gerak', label: 'Gerak', gloss: 'Move', icon: Bike },
      { href: '/app/lapor', label: 'Lapor', gloss: 'Report', icon: TriangleAlert, primary: true },
      { href: '/app/requests', label: 'My requests', icon: Inbox },
      { href: '/app/tamu', label: 'Tamu', gloss: 'Visitors', icon: DoorOpen },
      { href: '/app/parcels', label: 'Parcels', icon: Package },
      { href: '/app/jiran', label: 'Jiran', gloss: 'Neighbours', icon: HandHeart },
      { href: '/app/kongsi', label: 'Kongsi', gloss: 'Share', icon: Repeat2 },
      { href: '/app/jimat', label: 'Jimat', gloss: 'Save energy', icon: Zap },
      { href: '/app/banjir', label: 'Banjir', gloss: 'Flood', icon: Droplets },
      { href: '/app/taman', label: 'Taman', gloss: 'Garden', icon: Sprout },
      { href: '/app/akses', label: 'Akses+', gloss: 'Access', icon: Accessibility },
      { href: '/app/assistant', label: 'Assistant', icon: Bot },
      { href: '/app/home-services', label: 'SimeTown Home', gloss: 'Home services', icon: House },
      { href: '/app/account', label: 'Account', icon: UserRound },
    ],
  },
  merchant: {
    title: 'Shop',
    items: [
      { href: '/merchant', label: 'Counter', icon: Store, primary: true, offer: 'retail' },
      { href: '/merchant/bookings', label: 'Bookings', icon: CalendarCheck, primary: true, offer: 'services' },
      { href: '/merchant/offers', label: 'Shop Offers', icon: Tag, primary: true, offer: 'retail' },
      { href: '/merchant/services', label: 'Services & workers', icon: Wrench, primary: true, offer: 'services' },
      { href: '/merchant/sales', label: 'Sales', icon: Receipt, primary: true, offer: 'retail' },
      { href: '/merchant/statements', label: 'Statements', icon: ScrollText, primary: true, offer: 'retail' },
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
      { href: '/demo/labels', label: 'Demo labels', icon: Barcode },
      { href: '/courier/account', label: 'Account', icon: UserRound, primary: true },
    ],
  },
  console: {
    title: 'SDP console',
    items: [
      { href: '/console', label: 'Insights', icon: Gauge, primary: true },
      { href: '/console/reports', label: 'Lapor', icon: ClipboardList, primary: true },
      { href: '/console/operations', label: 'Parcels', icon: Package },
      { href: '/console/assistant', label: 'Assistant questions', icon: MessageCircleQuestionMark },
      { href: '/console/banjir', label: 'Flood dashboard', icon: Droplets, primary: true },
      { href: '/console/campaigns', label: 'Campaigns & sponsors', icon: Megaphone },
      { href: '/console/people', label: 'People', icon: Users },
      { href: '/console/shops', label: 'Shops', icon: Building2, roles: ADMINS },
      { href: '/console/finance', label: 'Float & payments', icon: Landmark },
      { href: '/console/places', label: 'Kiosks, machines & trails', icon: MapPin },
      { href: '/console/recycling', label: 'Recycling collections', icon: Recycle },
      { href: '/console/solar', label: 'Solar sites', icon: Sun },
      { href: '/console/materials', label: 'Greener materials', icon: Layers },
      { href: '/console/nature', label: 'Nature & access', icon: Leaf },
      { href: '/console/moderation', label: 'Moderation', icon: ShieldAlert },
      { href: '/console/home-services', label: 'Home service reports', icon: Wrench },
      { href: '/console/audit', label: 'Audit trail', icon: History, roles: ADMINS },
      { href: '/console/settings', label: 'Rules', icon: Settings },
      { href: '/console/account', label: 'Account', icon: UserRound },
    ],
  },
};
