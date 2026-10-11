'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import type { ReactNode } from 'react';

/** An on/off switch with its label and an optional line of help, as one large touch target. */
export function Switch({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span>
        <span className="block text-[15px] font-semibold text-ink-900"><Text>{label}</Text></span>
        {hint && <span className="block text-sm text-ink-500"><Text>{hint}</Text></span>}
      </span>
      <LocalizedInput type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-ink-200 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:ease-soft peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/25 peer-disabled:opacity-50"
      />
    </label>
  );
}
