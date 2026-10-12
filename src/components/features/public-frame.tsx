
import { Text } from '@/components/ui/localized-text';
import { LocalizedNav } from '@/components/ui/localized-elements';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import type { ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';

/** The frame for pages anyone can open without signing in: the status page, partners and the guest page. */
export function PublicFrame({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="bg-gradient-to-br from-brand-800 to-brand-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" aria-label="SimeTown home" className="rounded-md">
            <Logo tone="light" />
          </Link>
          <LocalizedNav aria-label="Public pages" className="flex items-center gap-1 text-sm font-semibold">
            <Link href="/status" className="rounded-md px-3 py-2 text-white/90 hover:bg-white/10"><Text>Flood status</Text></Link>
            <Link href="/guest" className="rounded-md px-3 py-2 text-white/90 hover:bg-white/10"><Text>Visiting</Text></Link>
            <Link href="/login" className="rounded-md bg-white px-3 py-2 text-brand-800 hover:bg-brand-50"><Text>Sign in</Text></Link>
          </LocalizedNav>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6">
          <h1 className="text-3xl font-bold text-white sm:text-4xl"><Text>{title}</Text></h1>
          <div className="mt-2 max-w-2xl text-[15px] text-brand-100"><Text>{intro}</Text></div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Text>{children}</Text>
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-ink-500 sm:px-6"><Text>A student prototype for the Sime Darby Property University Hackathon 2026. Not an official Sime Darby Property service. All data shown is invented.</Text></footer>
    </div>
  );
}
