
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CountUp } from './count-up';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-ink-200 bg-white shadow-xs', className)} {...rest} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold"><Text>{title}</Text></h2>
        {description && <p className="mt-0.5 text-sm text-ink-500"><Text>{description}</Text></p>}
      </div>
      <Text>{action}</Text>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold sm:text-[28px]"><Text>{title}</Text></h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-500"><Text>{description}</Text></p>}
      </div>
      {action && <div className="flex flex-wrap gap-2"><Text>{action}</Text></div>}
    </header>
  );
}

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'gold';
const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-accent-50 text-accent-700',
  gold: 'bg-gold-50 text-gold-700',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}><Text>{children}</Text></span>;
}

/** A headline number. Whole numbers count up once when first shown. */
export function Stat({ label, value, format, hint, icon: Icon, tone = 'brand' }: {
  label: string;
  value: number | string;
  format?: (n: number) => string;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500"><Text>{label}</Text></p>
        {Icon && (
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', tones[tone])}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-[28px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
        {typeof value === 'number' ? <CountUp value={value} format={format} /> : value}
      </p>
      {hint && <p className="mt-2 text-sm text-ink-500"><Text>{hint}</Text></p>}
    </Card>
  );
}

export function Progress({ value, max, tone = 'brand', label }: { value: number; max: number; tone?: 'brand' | 'gold' | 'danger' | 'warning'; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = { brand: 'bg-brand-600', gold: 'bg-gold-500', danger: 'bg-accent-600', warning: 'bg-warning-600' }[tone];
  return (
    <LocalizedDiv role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-2 overflow-hidden rounded-full bg-ink-100">
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-soft', fill)} style={{ width: `${pct}%` }} />
    </LocalizedDiv>
  );
}
