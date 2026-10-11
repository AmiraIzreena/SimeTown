'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton } from '@/components/ui/localized-elements';

import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useHydrated } from '@/lib/use-hydrated';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-soft ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white shadow-xs hover:bg-brand-800 hover:shadow-sm',
  secondary: 'border border-ink-200 bg-white text-ink-800 shadow-xs hover:border-ink-300 hover:bg-ink-25',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-accent-600 text-white shadow-xs hover:bg-accent-700',
  light: 'bg-white text-brand-800 shadow-sm hover:bg-brand-50',
};

const sizes: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-[15px]',
  lg: 'min-h-12 px-6 text-base',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows progress and blocks a second click. */
  pending?: boolean;
  /** Renders a link that looks like a button. */
  href?: string;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', pending, href, className, children, disabled, ...rest }: Props) {
  // A submit button stays off until the page is interactive. Otherwise a fast tap could make the
  // browser submit the form itself, putting its fields (a password, say) in the address bar.
  const notReady = !useHydrated() && rest.type === 'submit';
  const classes = cn(base, variants[variant], sizes[size], className);
  if (href) {
    return (
      <Link href={href} className={classes}>
        <Text>{children}</Text>
      </Link>
    );
  }
  return (
    <LocalizedButton type="button" className={classes} disabled={disabled || pending || notReady} aria-busy={pending || undefined} {...rest}>
      {pending && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      <Text>{children}</Text>
    </LocalizedButton>
  );
}
