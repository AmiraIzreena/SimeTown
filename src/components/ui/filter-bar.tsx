'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv, LocalizedInput, LocalizedUl } from '@/components/ui/localized-elements';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * One filter pattern for every console list: a search box, then chips or
 * selects, then a line saying how many results show and how to clear the
 * filters. Each list keeps its own state; this only fixes the look and order.
 */
export function FilterBar({ search, chips, controls, summary, className }: {
  search?: ReactNode;
  chips?: ReactNode;
  controls?: ReactNode;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('filter-bar rounded-xl border glass-surface shadow-sm', className)}>
      <div className="space-y-3 p-4 sm:p-5">
        {search}
        {chips}
        {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>
      {summary}
    </div>
  );
}

/** A search box with an icon and a clear button. Escape clears it too. */
export function SearchField({ value, onChange, label, placeholder, maxLength = 60, className }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={cn('search-field relative', className)}>
      <Search aria-hidden className="search-field-icon pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <LocalizedInput
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && value) { event.preventDefault(); onChange(''); } }}
        className="control pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="search-field-clear absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-800">
          <X className="size-4" aria-hidden />
          <span className="sr-only"><Text>Clear search</Text></span>
        </button>
      )}
    </div>
  );
}

export interface ChipOption<K extends string> {
  key: K;
  label: string;
  count?: number;
  /** Draws attention to the count, for example when cases are overdue. */
  alert?: boolean;
}

/** A row of mutually exclusive filter chips. Scrolls sideways on a phone. */
export function FilterChips<K extends string>({ options, value, onChange, label, size = 'md' }: {
  options: ChipOption<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <LocalizedDiv role="group" aria-label={label} className="filter-chips -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.key)}
            className={cn('filter-chip inline-flex shrink-0 items-center gap-2 rounded-full border font-semibold', size === 'sm' ? 'min-h-8 px-3 text-[13px]' : 'min-h-10 px-4 text-sm')}
          >
            <Text>{option.label}</Text>
            {option.count !== undefined && (
              <span className={cn('filter-chip-count rounded-full px-1.5 text-xs tabular-nums', option.alert && option.count > 0 && 'is-alert')}>{option.count}</span>
            )}
          </button>
        );
      })}
    </LocalizedDiv>
  );
}

export interface MenuOption<V extends string> {
  value: V;
  label: string;
  /** Names and other values that are never translated. */
  raw?: boolean;
}

/**
 * A compact filter as a pill ("Priority: Any") that opens a styled menu, in
 * place of a full-width native select. The first option is the "no filter"
 * value; any other choice tints the pill so active filters stand out.
 */
export function FilterMenu<V extends string>({ label, value, options, onChange }: {
  label: string;
  value: V;
  options: MenuOption<V>[];
  onChange: (value: V) => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0]!;
  const active = value !== options[0]?.value;

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const show = () => {
    const r = button.current!.getBoundingClientRect();
    // Fixed, so a card with hidden overflow cannot clip it; flips left near the right edge.
    setPlace({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 224) - 8)), minWidth: Math.max(r.width, 224) });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const items = list.current?.querySelectorAll<HTMLElement>('[role="option"]');
    const selected = Array.from(items ?? []).find((el) => el.getAttribute('aria-selected') === 'true');
    (selected ?? items?.[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(false);
    };
    const moved = () => close(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', moved);
      window.removeEventListener('scroll', moved, true);
    };
  }, [open]);

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); go(at + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); go(at - 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(items.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); show(); } }}
        className={cn('filter-menu inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm', active && 'is-active')}
      >
        <span className="text-ink-500"><Text>{label}</Text>:</span>
        <span className="truncate font-semibold">{current.raw ? current.label : <Text>{current.label}</Text>}</span>
        <ChevronDown aria-hidden className={cn('filter-menu-chevron size-4 shrink-0', open && 'rotate-180')} />
      </button>
      {open && place && createPortal(
        <LocalizedUl
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          style={{ top: place.top, left: place.left, minWidth: place.minWidth }}
          className="filter-menu-list fixed z-50 max-h-80 max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-ink-100 bg-white p-1.5 shadow-lg"
        >
          {options.map((option, i) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                style={{ '--i': i } as CSSProperties}
                onClick={() => { onChange(option.value); close(); }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChange(option.value); close(); } }}
                className="filter-menu-option flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none"
              >
                <span>{option.raw ? option.label : <Text>{option.label}</Text>}</span>
                {selected && <Check aria-hidden className="size-4 shrink-0 text-brand-600" />}
              </li>
            );
          })}
        </LocalizedUl>,
        document.body,
      )}
    </>
  );
}

/** How many results show, and a way to clear every filter at once. */
export function FilterSummary({ shown, total, noun, onClear, live }: {
  shown: number;
  total?: number;
  noun: string;
  onClear?: () => void;
  /** Shows the "updates automatically" dot for lists that refresh themselves. */
  live?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-4 py-2.5 text-sm text-ink-500 sm:px-5">
      <p aria-live="polite" className="flex items-center gap-2">
        {live && <span aria-hidden className="live-dot" />}
        <span><strong className="font-semibold tabular-nums text-ink-800">{shown}</strong>{total !== undefined && total !== shown && <> <Text>of</Text> <span className="tabular-nums">{total}</span></>} <Text>{noun}</Text></span>
      </p>
      {onClear && (
        <button type="button" onClick={onClear} className="font-semibold text-brand-700 transition-colors hover:text-brand-800 hover:underline">
          <Text>Clear filters</Text>
        </button>
      )}
    </div>
  );
}
