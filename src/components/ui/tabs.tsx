'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useLang } from '@/lib/i18n';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/** Tabs with one indicator that slides to the active tab. Arrow keys move between tabs. */
export function Tabs<K extends string>({ items, value, onChange, label }: { items: TabItem<K>[]; value: K; onChange: (key: K) => void; label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const lang = useLang();
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active) setBar({ left: active.offsetLeft, width: active.offsetWidth });
  }, [value, items.length, lang]);

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.key === value);
    const next = items[(index + step + items.length) % items.length]!;
    onChange(next.key);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus();
  };

  return (
    <LocalizedDiv ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="relative mb-5 flex gap-1 overflow-x-auto border-b border-ink-200">
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-key={item.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={cn('flex min-h-11 shrink-0 items-center gap-2 rounded-t-md px-3.5 text-[15px] font-semibold transition-colors duration-200 focus-visible:outline-offset-[-2px]', selected ? 'text-brand-700' : 'text-ink-500 hover:bg-ink-100/60 hover:text-ink-800')}
          >
            <Text>{item.label}</Text>
            {item.count !== undefined && item.count > 0 && <span className="rounded-full bg-ink-100 px-1.5 text-xs text-ink-600 tabular-nums"><Text>{item.count}</Text></span>}
          </button>
        );
      })}
      <span aria-hidden className="absolute bottom-0 left-0 h-0.5 rounded-full bg-brand-600 transition-[transform,width] duration-300 ease-soft" style={{ width: bar.width, transform: `translateX(${bar.left}px)` }} />
    </LocalizedDiv>
  );
}

export function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div role="tabpanel" className="content-in">
      <Text>{children}</Text>
    </div>
  );
}
