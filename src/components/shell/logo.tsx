
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';
import Image from 'next/image';

/** The SimeTown wordmark: our own mark, not Sime Darby Property's. */
export function Logo({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-xl font-extrabold tracking-tight', tone === 'light' ? 'text-white' : 'text-brand-800', className)}>
      <Image src="/icon.svg" alt="SimeTown logo" width={34} height={34} className="h-[2.1rem] w-[2.1rem]" />
      <span><Text>SimeTown</Text></span>
    </span>
  );
}
