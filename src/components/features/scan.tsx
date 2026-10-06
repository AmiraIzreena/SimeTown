'use client';

import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

/**
 * Printed QR codes open the app with the code already in the address, so the
 * phone's own camera is the scanner. The same code is printed in letters
 * underneath for typing by hand.
 */
export function CodeEntry({ label, value, onChange, onSubmit, pending, error, action }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending?: boolean;
  error?: string;
  action: string;
}) {
  return (
    <form method="post"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input label={label} value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} placeholder="e.g. GABC2345XY" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} error={error} className="min-w-0 flex-1 basis-56" hint="Scan the poster with your camera, or type the code printed under it." />
      <Button type="submit" pending={pending} disabled={value.trim().length < 6} className="mb-[26px]">
        <ScanLine className="size-4" aria-hidden />
        {action}
      </Button>
    </form>
  );
}
