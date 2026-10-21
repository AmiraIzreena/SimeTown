import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';

/** The way back from a detail page to the list it came from. The arrow nudges left on a mouse hover. */
export function BackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('back-link -ml-0.5 inline-flex min-h-10 items-center gap-2 rounded-md pr-3 text-sm font-semibold text-ink-600 transition-colors hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600', className)}>
      <ArrowLeft className="back-link-arrow size-4" aria-hidden /><Text>{children}</Text>
    </Link>
  );
}
