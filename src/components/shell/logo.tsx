import { cn } from '@/lib/cn';

/** The KITA+ wordmark: our own mark, not Sime Darby Property's. */
export function Logo({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-xl font-extrabold tracking-tight', tone === 'light' ? 'text-white' : 'text-brand-800', className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="9" className={tone === 'light' ? 'fill-white' : 'fill-brand-700'} />
        <path d="M9 21.5V10.5h3.2v4.1l4-4.1h4l-4.6 4.6 4.9 6.4h-3.9l-3.2-4.3-1.2 1.2v3.1z" className={tone === 'light' ? 'fill-brand-800' : 'fill-white'} />
        <path d="M22.2 7.5h2.1v2.3h2.3v2.1h-2.3v2.3h-2.1v-2.3h-2.3V9.8h2.3z" className="fill-accent-500" />
      </svg>
      <span>
        KITA<span className="text-accent-500">+</span>
      </span>
    </span>
  );
}
