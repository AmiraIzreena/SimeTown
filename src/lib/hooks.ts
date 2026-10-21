'use client';

import { useCallback, useState } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from './api';

/** Reads from the API with caching, de-duplication and refresh on focus. Pass null to wait. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, api.get, { shouldRetryOnError: false, ...config });
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** A list that loads more on request, using the API's cursor. */
/** `Extra` types anything the API adds to the first page, such as filter counts. */
/**
 * With `keepPrevious`, a changed filter keeps the last results (and their counts) on screen until the new ones
 * arrive, and `stale` says so: the page around the list stays still and only the list itself changes.
 */
export function usePaged<T, Extra extends object = object>(path: string | null, options: { keepPrevious?: boolean } = {}) {
  type P = Page<T> & Partial<Extra>;
  const swr = useSWRInfinite<P, ApiError>(
    (index, previous) => {
      if (!path || (previous && !previous.nextCursor)) return null;
      const joiner = path.includes('?') ? '&' : '?';
      return index === 0 ? path : `${path}${joiner}cursor=${encodeURIComponent(previous!.nextCursor!)}`;
    },
    api.get,
    { shouldRetryOnError: false, revalidateFirstPage: true },
  );
  const [last, setLast] = useState<P[] | null>(null);
  if (options.keepPrevious && swr.data && swr.data !== last) setLast(swr.data);
  const stale = Boolean(options.keepPrevious && !swr.data && !swr.error && last && path);
  const pages = swr.data ?? (stale ? last! : []);
  return {
    items: pages.flatMap((p) => p.items),
    first: pages[0],
    error: swr.error,
    isLoading: swr.isLoading && !stale,
    /** Showing the previous filter's results while the new ones load. */
    stale,
    hasMore: Boolean(pages[pages.length - 1]?.nextCursor),
    loadingMore: swr.isValidating && swr.size > pages.length,
    loadMore: () => swr.setSize(swr.size + 1),
    reload: () => swr.mutate(),
  };
}

interface ActionOptions<R> {
  /** Login failures must be visible; expired-session errors redirect elsewhere. */
  showUnauthorizedError?: boolean;
  /** Shown as a success toast. Return null to stay quiet. */
  success?: string | ((result: R) => string | null);
  onSuccess?: (result: R) => void;
}

/**
 * Wraps a write to the API: tracks the pending state, shows what went wrong,
 * and hands field-level messages back to the form.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, options: ActionOptions<R> = {}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setFields({});
      try {
        const result = await fn(...args);
        const message = typeof options.success === 'function' ? options.success(result) : options.success;
        if (message) toast.show(message, 'success');
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Something went wrong. Please try again.');
        setFields(apiError.fields);
        if (apiError.status !== 401 || options.showUnauthorizedError) toast.show(apiError.message, 'error');
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass fresh closures each render; the latest is always used
    [fn, toast],
  );
  return { run, pending, fields };
}
