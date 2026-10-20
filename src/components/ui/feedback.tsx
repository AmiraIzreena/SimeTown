
import { Text } from '@/components/ui/localized-text';
import { LocalizedDiv } from '@/components/ui/localized-elements';
import { CloudOff, Inbox, Lock, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { SkeletonGate } from './skeleton-gate';

/** One placeholder bar. It is a line of text (h-4) unless the class gives it a height or size. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  const sized = /(?:^|\s)(?:h-|size-)/.test(className ?? '');
  return <div aria-hidden className={cn('skeleton', !sized && 'h-4', className)} style={style} />;
}

/** The frame of a loading card: the same glass surface as <Card>, fading in with its skeleton. */
export function SkeletonCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div aria-hidden className={cn('skeleton-shell glass-surface rounded-xl border shadow-sm', className)}>{children}</div>;
}

/** Reserves the heading, fields and action space of a loading form. */
export function SkeletonForm() {
  return <LocalizedDiv role="status" aria-label="Loading" aria-busy="true" className="skeleton-shell glass-surface rounded-xl border p-5 shadow-sm">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="mt-3 w-2/3" />
    <div aria-hidden className="mt-6 grid gap-4 sm:grid-cols-2">
      {[0, 1].map((field) => <div key={field}><Skeleton className="mb-2 w-24" /><Skeleton className="h-11 w-full" /></div>)}
    </div>
    <Skeleton className="mt-5 h-11 w-32" />
  </LocalizedDiv>;
}

/** A stand-in for a list of cards while they load: an icon, a title, two lines and a status. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <LocalizedDiv className={cn('space-y-3', className)} role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} className="flex items-start gap-4 p-5">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className="w-2/5" />
            <Skeleton className="mt-3 h-3 w-4/5" />
            <Skeleton className="mt-2 h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-6 w-20 shrink-0 rounded-full sm:block" />
        </SkeletonCard>
      ))}
    </LocalizedDiv>
  );
}

/** The shape of a row of <Stat> cards: label and icon, the number, then a hint. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <LocalizedDiv className="grid grid-cols-2 gap-4 lg:grid-cols-4" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="mt-1 h-3 w-1/2" />
            <Skeleton className="size-9 shrink-0 rounded-md" />
          </div>
          <Skeleton className="mt-2 h-7 w-2/3" />
          <Skeleton className="mt-3 h-3 w-4/5" />
        </SkeletonCard>
      ))}
    </LocalizedDiv>
  );
}

/**
 * The shape of a <Card> with a <CardHeader>: a title and description, then a
 * body of the given kind (lines of text, a bar chart, or a grid of figures).
 */
export function SkeletonPanel({ body = 'lines', cells = 4, cols = cells, className }: { body?: 'lines' | 'bars' | 'cells'; cells?: number; cols?: number; className?: string }) {
  return (
    <LocalizedDiv role="status" aria-label="Loading" aria-busy="true" className={cn('skeleton-shell glass-surface flex flex-col rounded-xl border shadow-sm', className)}>
      <div aria-hidden className="border-b border-ink-100/80 px-5 py-5 sm:px-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3 w-3/5" />
      </div>
      {body === 'bars' && (
        <div aria-hidden className="flex h-44 flex-1 items-end gap-1.5 p-5 sm:gap-2.5">
          {Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="h-full min-w-0 flex-1 rounded-b-none rounded-t-sm" style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}
        </div>
      )}
      {body === 'cells' && (
        <div aria-hidden className="grid flex-1 grid-cols-2 gap-px bg-ink-100/70 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': cols } as CSSProperties}>
          {Array.from({ length: cells }, (_, i) => (
            <div key={i} className="bg-white/80 px-5 py-4"><Skeleton className="h-3 w-3/4" /><Skeleton className="mt-2 h-6 w-1/2" /></div>
          ))}
        </div>
      )}
      {body === 'lines' && (
        <div aria-hidden className="space-y-3 p-5">
          {[90, 75, 82, 60].map((w) => <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />)}
        </div>
      )}
    </LocalizedDiv>
  );
}

/** The shape of headline metric cards: a label and badge, a large number, then a progress line. */
export function SkeletonMetrics({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <LocalizedDiv className={cn('grid gap-4 md:grid-cols-3', className)} role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className="p-6">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-11 w-1/2" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
          <Skeleton className="mt-2 h-3 w-2/5" />
        </SkeletonCard>
      ))}
    </LocalizedDiv>
  );
}

/** The shape of <RankBars>: a label and figure over a thin bar, row after row. */
export function SkeletonRanks({ rows = 5 }: { rows?: number }) {
  return (
    <LocalizedDiv className="space-y-3" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <Skeleton className="h-3.5" style={{ width: `${40 - i * 4}%` }} />
            <Skeleton className="h-3.5 w-14" />
          </div>
          <Skeleton className="h-2 rounded-full" style={{ width: `${92 - i * 14}%` }} />
        </div>
      ))}
    </LocalizedDiv>
  );
}

/** The shape of a timeline of cards: status badges and a time, two lines of text, then a place. */
export function SkeletonTimeline({ rows = 3 }: { rows?: number }) {
  return (
    <LocalizedDiv className="space-y-3" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} className="p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-3 w-14" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-11/12" />
          <Skeleton className="mt-2 h-3.5 w-3/5" />
          <Skeleton className="mt-3 h-3 w-40" />
        </SkeletonCard>
      ))}
    </LocalizedDiv>
  );
}

/** The shape of rows inside a card (divided list): a name and a detail line, then a status and an action. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <LocalizedDiv className="divide-y divide-ink-100" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton className="hidden h-9 w-16 shrink-0 sm:block" />
        </div>
      ))}
    </LocalizedDiv>
  );
}

/**
 * A whole screen while its route loads: the page heading, a row of figures
 * and a list. Used by the loading.tsx of each signed-in area.
 */
export function SkeletonPage() {
  return (
    <div>
      <div aria-hidden className="skeleton-shell page-heading mb-8 sm:mb-9">
        <div className="min-w-0">
          <Skeleton className="h-8 w-56 sm:h-9" />
          <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        </div>
      </div>
      <div className="space-y-6">
        <SkeletonStats />
        <SkeletonList rows={3} />
      </div>
    </div>
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
 * an error with retry, or the content. Keeps every screen consistent. A quick
 * answer shows no skeleton at all; one that did show stays long enough not to
 * flash (see useMinLoading).
 */
export function Async<T>({ state, skeleton, children }: { state: Loadable<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  const settled = state.data !== undefined || Boolean(state.error);
  return (
    <SkeletonGate loading={!settled} skeleton={skeleton ?? <SkeletonList />}>
      {state.data !== undefined ? (
        <div className="content-in"><Text>{children(state.data)}</Text></div>
      ) : state.error ? (
        <ErrorState error={state.error} onRetry={state.mutate ? () => void state.mutate!() : undefined} />
      ) : null}
    </SkeletonGate>
  );
}
