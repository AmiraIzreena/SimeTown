import { Text } from '@/components/ui/localized-text';
import { LocalizedLink as Link, LocalizedNav } from '@/components/ui/localized-elements';
import { Logo } from '@/components/shell/logo';

/** The footer of the landing and "What we offer" pages. Public pages live in the top bar; the legal texts stay here. */
export function SiteFooter() {
  return (
    <footer className="border-t border-ink-200/80 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-ink-500 sm:px-8 md:flex-row md:items-center md:justify-between">
        <Logo className="text-base" />
        <div className="max-w-2xl space-y-2 md:text-right">
          <p><Text>© 2026 SimeTown. One app for township life in City of Elmina.</Text></p>
          <LocalizedNav aria-label="Legal" className="flex gap-4 md:justify-end">
            <Link href="/terms" className="font-medium text-ink-700 hover:underline"><Text>Terms of Use</Text></Link>
            <Link href="/privacy" className="font-medium text-ink-700 hover:underline"><Text>Privacy Notice</Text></Link>
          </LocalizedNav>
        </div>
      </div>
    </footer>
  );
}
