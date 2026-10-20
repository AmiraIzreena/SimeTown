'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ComponentProps } from 'react';
import { Text } from '@/components/ui/localized-text';
import { Button } from './button';

/**
 * A button that copies `text` and says so in place for two seconds: the copy
 * icon turns into a tick and the label reads "Copied". `onCopied` and
 * `onError` let a screen keep its own toast.
 */
export function CopyButton({ text, label = 'Copy link', onCopied, onError, ...rest }: Omit<ComponentProps<typeof Button>, 'children' | 'onClick'> & {
  text: string;
  label?: string;
  onCopied?: () => void;
  onError?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
    } catch {
      onError?.();
    }
  };
  const Icon = copied ? Check : Copy;
  return (
    <Button {...rest} onClick={() => void copy()}>
      <Icon className={copied ? 'content-in size-4' : 'size-4'} aria-hidden />
      <span aria-live="polite"><Text>{copied ? 'Copied' : label}</Text></span>
    </Button>
  );
}
