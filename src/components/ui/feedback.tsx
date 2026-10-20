
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { CloudOff, Inbox, Lock, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSignedInMotion, useSkeletonHold } from '@/lib/use-min-loading';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4', className)} />;
}

/** Reserves the heading, fields and action space of a loading form. */
export function SkeletonForm() {
  return <LocalizedDiv role="status" aria-label="Loading" className="glass-surface rounded-xl border p-5 shadow-sm">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="mt-3 w-2/3" />
    <div aria-hidden className="mt-6 grid gap-4 sm:grid-cols-2">
      {[0, 1].map((field) => <div key={field}><Skeleton className="mb-2 w-24" /><Skeleton className="h-11 w-full" /></div>)}
    </div>
    <Skeleton className="mt-5 h-11 w-32" />
  </LocalizedDiv>;
}

/** A stand-in for a list or a row of cards while they load. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <LocalizedDiv className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-ink-200 bg-white p-5">
          <Skeleton className="w-2/5" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </LocalizedDiv>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <LocalizedDiv className="grid grid-cols-2 gap-4 lg:grid-cols-4" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass-surface rounded-xl border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><Skeleton className="h-3 w-1/2" /><Skeleton className="size-8 rounded-lg" /></div>
          <Skeleton className="mt-2 h-7 w-2/3" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      ))}
    </LocalizedDiv>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state flex flex-col items-center rounded-xl border border-dashed border-ink-200 bg-white/70 px-6 py-12 text-center">
      <span className="empty-state-icon grid size-12 place-items-center rounded-full bg-ink-100 text-ink-500">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold"><Text>{title}</Text></h3>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-500"><Text>{children}</Text></p>}
      {action && <div className="mt-5"><Text>{action}</Text></div>}
    </div>
  );
}

/** Says what went wrong in plain words and offers the one useful next step. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const denied = error.status === 403;
  const Icon = denied ? Lock : CloudOff;
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-ink-200 bg-white px-6 py-12 text-center">
      <span className={cn('grid size-12 place-items-center rounded-full', denied ? 'bg-warning-50 text-warning-600' : 'bg-accent-50 text-accent-600')}>
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold"><Text>{denied ? 'This is not available to you yet' : error.code === 'NETWORK' ? 'No connection' : 'We could not load this'}</Text></h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500"><Text>{error.message}</Text></p>
      {onRetry && !denied && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}><Text>Try again</Text></Button>
      )}
    </div>
  );
}

interface Loadable<T> {
  data?: T;
  error?: ApiError;
  isLoading: boolean;
  mutate?: () => unknown;
}

/**
 * Renders the right state for a piece of loaded data: skeleton while loading,
 * an error with retry, or the content. Keeps every screen consistent.
 */
/** Skeleton, then content fading in. A skeleton that appears stays at least 600ms, so it never flashes (UI guidelines §8). */
export function Async<T>({ state, skeleton, children }: { state: Loadable<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  // Only signed-in screens hold the skeleton; public pages before login behave as before.
  const holding = useSkeletonHold(useSignedInMotion() && state.data === undefined && !state.error);
  if (state.error && state.data === undefined) return <ErrorState error={state.error} onRetry={state.mutate ? () => void state.mutate!() : undefined} />;
  if (state.data !== undefined && !holding) return <div className="animate-fade-in"><Text>{children(state.data)}</Text></div>;
  return <>{skeleton ?? <SkeletonList />}</>;
}
