'use client';

import { useEffect, useState } from 'react';

/**
 * True while the data for `key` is loading, and for at least `minMs` after the
 * key changes, so a fast answer does not flash the skeleton on and off. Each
 * new key (a new search, a new filter) restarts the minimum.
 */
export function useMinLoading(key: string, loading: boolean, minMs = 600): boolean {
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), minMs);
    return () => clearTimeout(timer);
  }, [key, minMs]);
  return loading || settledKey !== key;
}
