'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedAside } from '@/components/ui/localized-elements';

import { Megaphone } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Banner {
  name: string;
  tagline: string | null;
  tierLabel: string;
}

/**
 * One sponsored banner, always labelled "Sponsored" (BR17, BR31). Used on the
 * home screen only: never on Banjir, Tamu or Lapor.
 */
export function SponsoredBanner() {
  const { data } = useApi<Banner | null>('/sponsored');
  const t = useT();
  if (!data) return null;
  return (
    <LocalizedAside aria-label={t('Sponsored')} className="flex items-center gap-4 rounded-lg border border-gold-300/60 bg-gold-50 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-gold-700 shadow-xs">
        <Megaphone className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink-900">{data.name}</p>
        {data.tagline && <p className="truncate text-sm text-ink-600"><Text>{data.tagline}</Text></p>}
      </div>
      <span className="shrink-0 rounded-full border border-gold-300 bg-white px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold-700">{t('Sponsored')}</span>
    </LocalizedAside>
  );
}
