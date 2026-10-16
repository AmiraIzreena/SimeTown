'use client';

import { Text } from '@/components/ui/localized-text';
import { Accessibility, BadgePercent, Clock, Coins } from 'lucide-react';
import Image from 'next/image';
import { useState, type CSSProperties } from 'react';
import { SHOPS } from '@/components/features/showcase-content';
import { LocalizedNav } from '@/components/ui/localized-elements';
import { cn } from '@/lib/cn';

const ALL = 'All shops';
const CATEGORIES = [ALL, ...Array.from(new Set(SHOPS.map((s) => s.category)))];

/** The demo township's shops, filterable by type. Cards re-enter with a short stagger when the filter changes. */
export function ShopDirectory() {
  const [category, setCategory] = useState(ALL);
  const shown = SHOPS.filter((s) => category === ALL || s.category === category);

  return (
    <div>
      <LocalizedNav aria-label="Filter shops" className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} className="offer-tab border border-ink-200 bg-white" aria-current={category === c ? 'true' : undefined}>
            <Text>{c}</Text>
          </button>
        ))}
      </LocalizedNav>

      <div key={category} className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((shop, i) => (
          <article key={shop.id} className="shop-card group relative overflow-hidden rounded-3xl border border-white/80 bg-white shadow-sm" style={{ '--i': i } as CSSProperties}>
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image src={shop.image} alt="" fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-700 ease-soft group-hover:scale-105" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                {shop.joiningSoon ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-ink-700"><Clock className="size-3" aria-hidden /><Text>Joining soon</Text></span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold-300 px-2.5 py-1 text-[11px] font-bold text-brand-950"><Coins className="size-3" aria-hidden /><Text>Accepts points</Text></span>
                )}
                {shop.aksesFriendly && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-brand-800"><Accessibility className="size-3" aria-hidden /><Text>Akses-friendly</Text></span>
                )}
              </div>
              <p className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white"><Text>{shop.category}</Text></p>
            </div>
            <div className="p-5">
              <h3 className="text-lg font-semibold leading-snug">{shop.name}</h3>
              <p className={cn('mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm', shop.offer ? 'bg-brand-50 text-brand-800' : 'bg-ink-50 text-ink-500')}>
                <BadgePercent className="size-4 shrink-0" aria-hidden />
                <Text>{shop.offer ?? (shop.joiningSoon ? 'Waiting for township approval' : 'Earn 1 point for every RM1')}</Text>
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
