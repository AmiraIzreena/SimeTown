'use client';

import { ArrowRight, MapPinned } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';

/**
 * The way from "my reports" to what neighbours have reported. A whole-card link with a short reason to open it, so
 * a resident checks for an existing report (and taps "Me too") before filing the same problem again.
 */
export function AroundLink() {
  return (
    <Link href="/app/lapor/around" className="around-link group flex items-center gap-4 rounded-xl border border-brand-200/70 bg-brand-50/60 p-4 sm:p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-xs ring-1 ring-brand-100">
        <MapPinned className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink-900"><Text>Reports around the township</Text></span>
        <span className="block text-sm text-ink-600"><Text>See what neighbours have already reported, by type, and say “Me too” instead of reporting it again.</Text></span>
      </span>
      <span className="hidden items-center gap-1.5 text-sm font-semibold text-brand-700 sm:inline-flex"><Text>Open</Text><ArrowRight className="around-link-arrow size-4" aria-hidden /></span>
      <ArrowRight className="around-link-arrow size-4 shrink-0 text-brand-700 sm:hidden" aria-hidden />
    </Link>
  );
}
