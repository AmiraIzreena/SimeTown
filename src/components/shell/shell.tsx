'use client';

import { Bell, LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Drawer } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { ROLE_LABELS, type Role } from '@/shared/domain';
import { AlertTakeover } from './alert-takeover';
import { Logo } from './logo';
import { NAV, type Area, type NavItem } from './nav';
import { NotificationsDrawer, type NotificationList } from './notifications';
import { ProfileCompletion } from './profile-completion';
import { reloadTo } from '@/lib/navigate';

export interface ShellUser {
  fullName: string;
  role: Role;
}

const isActive = (pathname: string, item: NavItem, root: string) => (item.href === root ? pathname === root : pathname === item.href || pathname.startsWith(`${item.href}/`));

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

  const root = NAV[area].items[0]!.href;
  const items = NAV[area].items.filter((item) => !item.roles || item.roles.includes(user.role));
  const primary = items.filter((item) => item.primary).slice(0, 4);
  const needsMore = items.length > primary.length;
  const initials = user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  const link = (item: NavItem, compact: boolean) => {
    const active = isActive(pathname, item, root);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={compact ? item.label : undefined}
        className={cn(
          'group relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors duration-200',
          active ? 'bg-white/12 text-white' : 'text-brand-100/80 hover:bg-white/8 hover:text-white',
          compact && 'justify-center px-0 lg:justify-start lg:px-3',
        )}
      >
        <span aria-hidden className={cn('absolute left-0 h-5 w-[3px] rounded-r-full bg-accent-500 transition-opacity duration-200', active ? 'opacity-100' : 'opacity-0')} />
        <item.icon className="size-5 shrink-0" aria-hidden />
        <span className={cn(compact && 'sr-only lg:not-sr-only')}>
          {item.label}
          {item.gloss && <span className="ml-1.5 text-xs font-normal text-brand-200/70">{item.gloss}</span>}
        </span>
      </Link>
    );
  };

  return (
    <div className="min-h-dvh md:pl-[72px] lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
        Skip to content
      </a>

      {/* Tablet rail and desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col bg-gradient-to-b from-brand-900 to-brand-950 md:flex lg:w-64">
        <div className="flex h-16 items-center justify-center px-4 lg:justify-start">
          <Link href={root} aria-label="KITA+ home" className="rounded-md">
            <Logo tone="light" className="[&>span]:hidden lg:[&>span]:inline" />
          </Link>
        </div>
        <p className="hidden px-6 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300/70 lg:block">{NAV[area].title}</p>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {items.map((item) => link(item, true))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-white/12 text-sm font-semibold text-white">{initials}</span>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
              <p className="truncate text-xs text-brand-200/70">{ROLE_LABELS[user.role]}</p>
            </div>
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="hidden size-9 shrink-0 place-items-center rounded-md text-brand-100/80 transition-colors duration-200 hover:bg-white/10 hover:text-white lg:grid">
              <LogOut className="size-[18px]" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur-sm sm:px-6 md:h-16 lg:px-8">
        <Link href={root} aria-label="KITA+ home" className="rounded-md md:hidden">
          <Logo />
        </Link>
        <p className="hidden text-sm font-medium text-ink-500 md:block">{NAV[area].title}</p>
        <button
          type="button"
          onClick={() => setInboxOpen(true)}
          aria-label={inbox.data?.unread ? `Notifications, ${inbox.data.unread} unread` : 'Notifications'}
          className="relative grid size-11 place-items-center rounded-md text-ink-600 transition-colors duration-200 hover:bg-ink-100 hover:text-ink-900"
        >
          <Bell className="size-5" aria-hidden />
          {Boolean(inbox.data?.unread) && <span aria-hidden className="absolute right-2.5 top-2.5 size-2.5 rounded-full border-2 border-white bg-accent-500" />}
        </button>
      </header>

      {(area === 'resident' || area === 'console') && <AlertTakeover href={area === 'resident' ? '/app/banjir' : '/console/banjir'} />}

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8 lg:pt-8">
        <ProfileCompletion accountHref={`${root}/account`} />
        {/* A short fade-and-rise when moving between screens. */}
        <div key={pathname} className="animate-rise">
          {children}
        </div>
      </main>

      {/* Phone bottom bar */}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        {primary.map((item) => {
          const active = isActive(pathname, item, root);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors duration-200', active ? 'text-brand-700' : 'text-ink-500')}>
              <item.icon className={cn('size-[22px] transition-transform duration-200 ease-soft', active && '-translate-y-0.5')} aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenuOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-500">
          <Menu className="size-[22px]" aria-hidden />
          {needsMore ? 'More' : 'Menu'}
        </button>
      </nav>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title={user.fullName} description={ROLE_LABELS[user.role]}>
        <nav aria-label="All sections" className="-mx-2 space-y-0.5" onClick={() => setMenuOpen(false)}>
          {items.map((item) => {
            const active = isActive(pathname, item, root);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 items-center gap-3 rounded-md px-3 text-[15px] font-medium', active ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-ink-50')}>
                <item.icon className="size-5" aria-hidden />
                {item.label}
                {item.gloss && <span className="text-xs font-normal text-ink-500">{item.gloss}</span>}
              </Link>
            );
          })}
        </nav>
        <button type="button" onClick={signOut} className="mt-4 flex min-h-12 w-full items-center gap-3 rounded-md border-t border-ink-100 px-1 pt-4 text-[15px] font-medium text-ink-700">
          <LogOut className="size-5" aria-hidden />
          Sign out
        </button>
      </Drawer>

      <NotificationsDrawer open={inboxOpen} onClose={() => setInboxOpen(false)} list={inbox.data} onRead={() => void inbox.mutate()} />
    </div>
  );
}
