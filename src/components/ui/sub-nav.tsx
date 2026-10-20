'use client';

import Link from 'next/link';
import { LocalizedNav } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';

export interface SubNavItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  /** Draws attention to the count, for example when something is waiting for action. */
  alert?: boolean;
}

/**
 * The pill navigation bar for the sections inside a tab (Parcels → Manage, Guardhouse
 * parcels, Smart lockers, Campaigns). Each pill is a link, so a section can be shared or
 * reopened after a refresh. Sits under `Tabs`; never replaces them.
 */
export function SubNav<K extends string>({ label, items, value, hrefOf, sticky = false, className }: {
  label: string;
  items: readonly SubNavItem<K>[];
  value: K;
  hrefOf: (key: K) => string;
  /** Stays under the top bar while the section scrolls (long settings lists). */
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('w-fit max-w-full rounded-xl border border-ink-200 bg-white/95 p-2 shadow-sm backdrop-blur-md', sticky && 'sticky top-16 z-20', className)}>
      <LocalizedNav aria-label={label} className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const current = item.key === value;
          return (
            <Link
              key={item.key}
              href={hrefOf(item.key)}
              scroll={false}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-600',
                current ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
              )}
            >
              <Text>{item.label}</Text>
              {item.count !== undefined && (
                <span className={cn(
                  'min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums',
                  item.alert && item.count > 0 ? 'bg-warning-50 text-warning-700' : current ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-600',
                )}>
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </LocalizedNav>
    </div>
  );
}
