'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedNav } from '@/components/ui/localized-elements';

import { Accessibility, Bell, Languages, LogOut, Menu } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Drawer } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { setLang, useLang, useT } from '@/lib/i18n';
import { ROLE_LABELS, type Role } from '@/shared/domain';
import { AlertTakeover } from './alert-takeover';
import { Logo } from './logo';
import { NAV, type Area, type NavItem } from './nav';
import { NotificationsDrawer, type NotificationList } from './notifications';
import { ProfileCompletion } from './profile-completion';
import { reloadTo } from '@/lib/navigate';
import { AccountLanguage, persistLanguage } from '@/components/ui/language';
import { AksesViewContext } from '@/components/features/akses-mode';

export interface ShellUser {
  fullName: string;
  role: Role;
  /** Business accounts only: whether it runs a shop, home services, or both. */
  offers?: { retail: boolean; services: boolean };
}

interface AccessProfile {
  needs: ('MOBILITY' | 'VISION' | 'HEARING' | 'COGNITIVE' | 'ELDERLY')[];
  simpleMode: boolean;
}

const isActive = (pathname: string, item: NavItem, root: string) => (item.href === root ? pathname === root : pathname === item.href || pathname.startsWith(`${item.href}/`));

function pageMotion(pathname: string) {
  if (pathname === '/app') return 'motion-home';
  const routes: [string, string][] = [
    ['/app/wallet', 'motion-wallet'],
    ['/app/kitar', 'motion-kitar'],
    ['/app/gerak', 'motion-gerak'],
    ['/app/lapor', 'motion-lapor'],
    ['/app/tamu', 'motion-tamu'],
    ['/app/jiran', 'motion-jiran'],
    ['/app/kongsi', 'motion-kongsi'],
    ['/app/jimat', 'motion-jimat'],
    ['/app/banjir', 'motion-banjir'],
    ['/app/akses', 'motion-access'],
    ['/app/assistant', 'motion-assistant'],
    ['/app/home-services', 'motion-home-services'],
    ['/merchant/offers', 'motion-offers'],
    ['/merchant/bookings', 'motion-sales'],
    ['/merchant/services', 'motion-statements'],
    ['/merchant/sales', 'motion-sales'],
    ['/merchant/statements', 'motion-statements'],
    ['/merchant', 'motion-merchant'],
    ['/sponsor', 'motion-sponsor'],
    ['/guard', 'motion-gate'],
    ['/console/finance', 'motion-finance'],
    ['/console/reports', 'motion-reports'],
    ['/console/banjir', 'motion-flood-console'],
    ['/console/campaigns', 'motion-campaigns'],
    ['/console', 'motion-console'],
  ];
  return routes.find(([route]) => pathname === route || pathname.startsWith(`${route}/`))?.[1] ?? 'motion-utility';
}

async function signOut() {
  await api.post('/auth/logout').catch(() => undefined);
  reloadTo('/');
}

/**
 * The frame around every signed-in screen. Navigation adapts to the device:
 * a full sidebar on desktop, an icon rail on tablets, and a bottom bar with a
 * "More" drawer on phones.
 */
export function Shell({ area, user, children }: { area: Area; user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const inbox = useApi<NotificationList>('/notifications', { refreshInterval: 30_000 });
  const access = useApi<AccessProfile>(area === 'resident' ? '/me/access' : null);
  const [accessibleOverride, setAccessibleOverride] = useState<boolean | null>(null);
  const t = useT();
  const lang = useLang();
  const switchLang = () => {
    const next = lang === 'ms' ? 'en' : 'ms';
    setLang(next);
    // Remembered on the account too, so the choice follows the person to another device.
    void persistLanguage(next).catch(() => undefined);
  };

  const root = NAV[area].items[0]!.href;
  const items = NAV[area].items.filter((item) => (!item.roles || item.roles.includes(user.role)) && (!item.offer || !user.offers || user.offers[item.offer]));
  const primary = items.filter((item) => item.primary).slice(0, 4);
  const needsMore = items.length > primary.length;
  const initials = user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const motion = pageMotion(pathname);
  const savedAccessible = Boolean(access.data?.simpleMode || access.data?.needs.length);
  const accessible = area === 'resident' && (accessibleOverride ?? savedAccessible);

  const link = (item: NavItem, compact: boolean) => {
    const active = isActive(pathname, item, root);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={compact ? item.label : undefined}
        className={cn(
          'group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors duration-200',
          active ? 'bg-brand-400/20 text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12)] ring-1 ring-inset ring-brand-300/20' : 'text-brand-100/80 hover:bg-white/8 hover:text-white',
          compact && 'justify-center px-0 lg:justify-start lg:px-3',
        )}
      >
        <span aria-hidden className={cn('absolute left-0 h-5 w-[3px] rounded-r-full bg-gold-300 transition-opacity duration-200', active ? 'opacity-100' : 'opacity-0')} />
        <item.icon className="size-5 shrink-0" aria-hidden />
        <span className={cn(compact && 'sr-only lg:not-sr-only')}>
          {t(item.label)}
          {item.gloss && <span className="ml-1.5 text-xs font-normal text-brand-200/70">{t(item.gloss)}</span>}
        </span>
      </Link>
    );
  };

  return (
    <AksesViewContext.Provider value={area === 'resident' ? accessibleOverride : null}>
    <div className={cn('min-h-dvh md:pl-20 lg:pl-64', accessible && 'akses-shell')}>
      <AccountLanguage />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"><Text>Skip to content</Text></a>

      {/* Tablet rail and desktop sidebar */}
      <aside className="app-sidebar no-print fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-white/15 bg-gradient-to-b from-brand-900/85 to-brand-950/85 shadow-xl backdrop-blur-2xl md:flex lg:w-64">
        <div className="flex h-16 items-center justify-center px-4 lg:justify-start">
          <Link href={root} aria-label="SimeTown home" className="rounded-md">
            <Logo tone="light" className="[&>span]:hidden lg:[&>span]:inline" />
          </Link>
        </div>
        <p className="hidden px-6 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300/70 lg:block"><Text>{NAV[area].title}</Text></p>
        <LocalizedNav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          <Text>{items.map((item) => link(item, true))}</Text>
        </LocalizedNav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-brand-400/20 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.15)]"><Text>{initials}</Text></span>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
              <p className="truncate text-xs text-brand-200/70"><Text>{ROLE_LABELS[user.role]}</Text></p>
            </div>
            <LocalizedButton type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="hidden size-9 shrink-0 place-items-center rounded-md text-brand-100/80 transition-colors duration-200 hover:bg-white/10 hover:text-white lg:grid">
              <LogOut className="size-[18px]" aria-hidden />
            </LocalizedButton>
          </div>
        </div>
      </aside>

      {/* Top bar */}
      <header className="app-topbar no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/70 bg-white/65 px-4 shadow-[0_4px_20px_rgb(45_20_7_/_0.035)] backdrop-blur-2xl sm:px-6 lg:px-10">
        <Link href={root} aria-label="SimeTown home" className="rounded-md md:hidden">
          <Logo />
        </Link>
        <p className="hidden items-center gap-2 text-sm font-semibold tracking-tight text-brand-900 md:flex"><span aria-hidden className="size-2 rounded-full bg-brand-500 shadow-[0_0_0_4px_rgb(232_111_32_/_0.12)]" />{t(NAV[area].title)}</p>
        <div className="flex items-center gap-1">
        {area === 'resident' && (
          <LocalizedButton
            type="button"
            onClick={() => setAccessibleOverride(!accessible)}
            aria-pressed={accessible}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors duration-200',
              accessible ? 'bg-brand-700 text-white hover:bg-brand-800' : 'text-ink-700 hover:bg-ink-100',
            )}
          >
            <Accessibility className="size-[18px]" aria-hidden />
            <span><Text>{accessible ? 'Standard view' : 'Accessible view'}</Text></span>
          </LocalizedButton>
        )}
        <LocalizedButton
          type="button"
          onClick={switchLang}
          aria-label={lang === 'ms' ? 'Switch to English' : 'Tukar ke Bahasa Malaysia'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-ink-600 transition-colors duration-200 hover:bg-ink-100 hover:text-ink-900"
        >
          <Languages className="size-[18px]" aria-hidden />
          <span aria-hidden><Text>{lang === 'ms' ? 'BM' : 'EN'}</Text></span>
        </LocalizedButton>
        <LocalizedButton
          type="button"
          onClick={() => setInboxOpen(true)}
          aria-label={inbox.data?.unread ? `Notifications, ${inbox.data.unread} unread` : 'Notifications'}
          className="relative grid size-11 place-items-center rounded-md text-ink-600 transition-colors duration-200 hover:bg-ink-100 hover:text-ink-900"
        >
          <Bell className="size-5" aria-hidden />
          {Boolean(inbox.data?.unread) && <span aria-hidden className="absolute right-2.5 top-2.5 size-2.5 rounded-full border-2 border-white bg-accent-500" />}
        </LocalizedButton>
        </div>
      </header>

      {(area === 'resident' || area === 'console' || area === 'guard') && <AlertTakeover href={area === 'resident' ? '/app/banjir' : area === 'guard' ? '/guard' : '/console/banjir'} canCheckIn={area === 'resident'} />}

      <main id="main" className={cn('mx-auto w-full max-w-7xl px-4 pb-28 pt-7 sm:px-6 md:pb-14 md:pt-9 lg:px-10 lg:pt-10', accessible && 'akses-view')}>
        <ProfileCompletion accountHref={`${root}/account`} />
        {/* A short fade-and-rise when moving between screens. */}
        <div key={pathname} className={cn('animate-rise', motion)}>
          <Text>{children}</Text>
        </div>
      </main>

      {/* Phone bottom bar */}
      <LocalizedNav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col border-t border-white/70 bg-white/70 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(45_20_7_/_0.055)] backdrop-blur-2xl md:hidden">
        {primary.map((item) => {
          const active = isActive(pathname, item, root);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors duration-200', active ? 'text-brand-700' : 'text-ink-500')}>
              <item.icon className={cn('size-[22px] transition-transform duration-200 ease-soft', active && '-translate-y-0.5')} aria-hidden />
              {t(item.label)}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenuOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-500">
          <Menu className="size-[22px]" aria-hidden />
          {t(needsMore ? 'More' : 'Menu')}
        </button>
      </LocalizedNav>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title={user.fullName} description={ROLE_LABELS[user.role]}>
        <LocalizedNav aria-label="All sections" className="-mx-2 space-y-0.5" onClick={() => setMenuOpen(false)}>
          {items.map((item) => {
            const active = isActive(pathname, item, root);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 items-center gap-3 rounded-md px-3 text-[15px] font-medium', active ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-ink-50')}>
                <item.icon className="size-5" aria-hidden />
                {t(item.label)}
                {item.gloss && <span className="text-xs font-normal text-ink-500">{t(item.gloss)}</span>}
              </Link>
            );
          })}
        </LocalizedNav>
        <button type="button" onClick={signOut} className="mt-4 flex min-h-12 w-full items-center gap-3 rounded-md border-t border-ink-100 px-1 pt-4 text-[15px] font-medium text-ink-700">
          <LogOut className="size-5" aria-hidden />
          {t('Sign out')}
        </button>
      </Drawer>

      <NotificationsDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} list={inbox.data} onRead={() => void inbox.mutate()} />
    </div>
    </AksesViewContext.Provider>
  );
}
