'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';
import { cn } from '@/lib/cn';

/** A password box with an eye button to peek at what was typed. */
export function PasswordInput({ className, disabled, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className="relative">
      <LocalizedInput className={cn(className, '!pr-12 [&::-ms-reveal]:hidden')} type={shown ? 'text' : 'password'} disabled={disabled} {...rest} />
      <LocalizedButton
        type="button"
        onClick={() => setShown((value) => !value)}
        disabled={disabled}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-500 hover:text-ink-800 focus-visible:outline-2 focus-visible:outline-brand-700 disabled:opacity-50"
      >
        <Icon className="size-5" aria-hidden="true" />
      </LocalizedButton>
    </div>
  );
}
