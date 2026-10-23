'use client';

import { ArrowRight, MapPinned } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';

/**
 * The way from "my reports" to what neighbours have reported. A whole-card link with a short reason to open it, so
 * a resident checks for an existing report (and taps "Me too") before filing the same problem again. It stands out
 * with a brand edge, a solid icon and an outlined button, but stays lighter than the solid "New report" button.
 */
export function AroundLink() {
  return (
    <Link
      href="/app/lapor/around"
      className="around-link group relative flex items-center gap-4 overflow-hidden rounded-xl border border-brand-300/80 bg-gradient-to-r from-brand-100/70 via-brand-50/70 to-white/70 p-4 pl-5 shadow-xs sm:p-5 sm:pl-6"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand-500" />
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
        <MapPinned className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700"><Text>Check first</Text></span>
        <span className="block text-base font-semibold text-ink-900"><Text>Reports around the township</Text></span>
        <span className="block text-sm text-ink-600"><Text>See what neighbours have already reported, by type, and say “Me too” instead of reporting it again.</Text></span>
      </span>
      <span className="around-link-cta hidden shrink-0 items-center gap-1.5 rounded-lg border border-brand-300 bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 shadow-xs sm:inline-flex">
        <Text>See reports</Text><ArrowRight className="around-link-arrow size-4" aria-hidden />
      </span>
      <ArrowRight className="around-link-arrow size-5 shrink-0 text-brand-700 sm:hidden" aria-hidden />
    </Link>
  );
}
