'use client';

import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { ArrowBigUp, Eye, EyeOff } from 'lucide-react';
import { LocalizedButton, LocalizedInput } from '@/components/ui/localized-elements';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';

/**
 * A password box with an eye button to peek at what was typed, and a quiet
 * note while Caps Lock is on, since a password typed in capitals is the most
 * common reason a sign-in fails.
 */
export function PasswordInput({ className, disabled, onKeyDown, onKeyUp, onBlur, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  const checkCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  return (
    <div>
      <div className="relative">
        <LocalizedInput
          className={cn(className, '!pr-12 [&::-ms-reveal]:hidden')}
          type={shown ? 'text' : 'password'}
          disabled={disabled}
          onKeyDown={(event) => { checkCaps(event); onKeyDown?.(event); }}
          onKeyUp={(event) => { checkCaps(event); onKeyUp?.(event); }}
          onBlur={(event) => { setCapsLock(false); onBlur?.(event); }}
          {...rest}
        />
        <LocalizedButton
          type="button"
          onClick={() => setShown((value) => !value)}
          disabled={disabled}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-500 transition-colors duration-200 hover:text-ink-800 focus-visible:outline-2 focus-visible:outline-brand-700 disabled:opacity-50"
        >
          <Icon className="size-5" aria-hidden="true" />
        </LocalizedButton>
      </div>
      <p role="status" className="min-h-0 text-sm font-medium text-warning-700">
        {capsLock && (
          <span className="content-in mt-1.5 flex items-center gap-1.5">
            <ArrowBigUp className="size-4" aria-hidden="true" />
            <Text>Caps Lock is on</Text>
          </span>
        )}
      </p>
    </div>
  );
}
