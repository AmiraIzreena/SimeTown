'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedDiv, LocalizedLink as Link, LocalizedNav } from '@/components/ui/localized-elements';
import { ArrowRight, ChevronDown, Coins, Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { FEATURES } from '@/components/features/offer-content';
import { Logo } from '@/components/shell/logo';
import { LanguageSwitch } from '@/components/ui/language';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/shops', label: 'Shops' },
  { href: '/challenges', label: 'Challenges' },
  { href: '/sponsorship', label: 'Sponsors & Partners' },
  { href: '/status', label: 'Flood status' },
  { href: '/guest', label: 'Guests' },
];

/**
 * The top bar of the public pages. Over the landing hero it starts clear and turns solid
 * once the page scrolls; elsewhere it is solid from the start. "What we offer" opens a
 * menu of every module, grouped by layer.
 */
export function SiteHeader({ home = null, overlay = false }: { home?: string | null; overlay?: boolean }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(!overlay);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuId = useId();
  const mobileId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  // Close menus on navigation, Escape, or a click elsewhere.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setMenuOpen(false);
    setMobileOpen(false);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setMobileOpen(false); } };
    const onClick = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);
  useEffect(() => { document.body.style.overflow = mobileOpen ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [mobileOpen]);

  const openSoon = () => { window.clearTimeout(closeTimer.current); setMenuOpen(true); };
  const closeSoon = () => { closeTimer.current = window.setTimeout(() => setMenuOpen(false), 140); };
  const solid = scrolled || mobileOpen;
  const offerActive = pathname === '/offer';

  return (
    <header className={cn('site-header fixed inset-x-0 top-0 z-40', solid && 'is-solid')}>
      <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="SimeTown home" className="shrink-0 rounded-md">
          <Logo tone="light" />
        </Link>

        <LocalizedNav aria-label="Main" className="hidden flex-1 items-center justify-center gap-0 xl:flex">
          <div ref={menuRef} className="relative" onMouseEnter={openSoon} onMouseLeave={closeSoon}>
            <button
              type="button"
              className="site-nav-link inline-flex items-center gap-1"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-current={offerActive ? 'page' : undefined}
              onClick={() => setMenuOpen((open) => !open)}
              onFocus={openSoon}
            >
              <Text>What we offer</Text>
              <ChevronDown className={cn('size-4 transition-transform duration-300 ease-soft', menuOpen && 'rotate-180')} aria-hidden />
            </button>
            <LocalizedDiv id={menuId} data-open={menuOpen} className="site-mega" aria-label="What we offer" role="region">
              <div className="grid grid-cols-[1fr_1fr_1fr_15rem] gap-6 p-6">
                {FEATURES.map((group, g) => (
                  <div key={group.id} className="site-mega-col" style={{ '--i': g } as CSSProperties}>
                    <Link href={`/offer#${group.id}`} className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700 hover:text-brand-900"><Text>{group.layer}</Text></Link>
                    <ul className="mt-3 space-y-1">
                      {group.items.map((item) => (
                        <li key={item.name}>
                          <Link href={`/offer#${group.id}`} className="site-mega-item group">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 transition-colors duration-200 group-hover:bg-brand-600 group-hover:text-white"><item.icon className="size-4" aria-hidden /></span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-ink-900">{item.name}</span>
                              <span className="block truncate text-xs text-ink-500"><Text>{item.gloss}</Text></span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <Link href="/offer" className="site-mega-feature group site-mega-col" style={{ '--i': 3 } as CSSProperties}>
                  <Coins className="size-6 text-gold-300" aria-hidden />
                  <span className="mt-4 block font-display text-lg font-bold leading-snug text-white"><Text>Everything SimeTown offers, in one place</Text></span>
                  <span className="mt-2 block text-sm text-brand-100/90"><Text>Seventeen modules, one account, and points that are paid for before they are given.</Text></span>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white"><Text>Explore the app</Text><ArrowRight className="size-4 transition-transform duration-200 ease-soft group-hover:translate-x-1" aria-hidden /></span>
                </Link>
              </div>
            </LocalizedDiv>
          </div>
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="site-nav-link" aria-current={pathname === link.href ? 'page' : undefined}><Text>{link.label}</Text></Link>
          ))}
        </LocalizedNav>

        {/* Language, a thin divider, then the account actions: EN | Sign in | Get started. */}
        <div className="ml-auto hidden items-center gap-2 xl:flex">
          <LanguageSwitch signedIn={Boolean(home)} variant="header" />
          <span aria-hidden className="mx-1 h-6 w-px bg-white/20" />
          {home ? (
            <Link href={home} className="site-cta"><Text>Open SimeTown</Text><ArrowRight className="size-4" aria-hidden /></Link>
          ) : (
            <>
              <Link href="/login" className="site-nav-link"><Text>Sign in</Text></Link>
              <Link href="/register" className="site-cta"><Text>Get started</Text><ArrowRight className="size-4" aria-hidden /></Link>
            </>
          )}
        </div>

        <LocalizedButton
          type="button"
          className="ml-auto grid size-11 place-items-center rounded-full text-white transition-colors duration-200 hover:bg-white/10 xl:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls={mobileId}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span className="relative size-6">
            <Menu className={cn('absolute inset-0 size-6 transition-all duration-300 ease-soft', mobileOpen ? 'rotate-90 scale-50 opacity-0' : 'opacity-100')} aria-hidden />
            <X className={cn('absolute inset-0 size-6 transition-all duration-300 ease-soft', mobileOpen ? 'opacity-100' : '-rotate-90 scale-50 opacity-0')} aria-hidden />
          </span>
        </LocalizedButton>
      </div>

      <LocalizedDiv id={mobileId} data-open={mobileOpen} className="site-mobile xl:hidden" aria-label="Menu" role="region">
        <LocalizedNav aria-label="Main" className="mx-auto flex max-w-6xl flex-col px-5 pb-8 pt-2 sm:px-8">
          {[{ href: '/offer', label: 'What we offer' }, ...LINKS].map((link, i) => (
            <Link key={link.href} href={link.href} className="site-mobile-link" style={{ '--i': i } as CSSProperties} aria-current={pathname === link.href ? 'page' : undefined}>
              <Text>{link.label}</Text>
              <ArrowRight className="size-5 opacity-60" aria-hidden />
            </Link>
          ))}
          <div className="site-mobile-link mt-4 flex-wrap justify-start gap-3 border-0" style={{ '--i': LINKS.length + 1 } as CSSProperties}>
            {home ? (
              <Link href={home} className="site-cta"><Text>Open SimeTown</Text><ArrowRight className="size-4" aria-hidden /></Link>
            ) : (
              <>
                <Link href="/register" className="site-cta"><Text>Get started</Text><ArrowRight className="size-4" aria-hidden /></Link>
                <Link href="/login" className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"><Text>Sign in</Text></Link>
              </>
            )}
            <LanguageSwitch signedIn={Boolean(home)} variant="header" />
          </div>
        </LocalizedNav>
      </LocalizedDiv>
    </header>
  );
}
