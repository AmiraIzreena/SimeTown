'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * True inside the signed-in frame (the Shell). Public pages before login keep their own,
 * unchanged loading behaviour, so the 600ms skeleton hold only applies to signed-in screens.
 */
export const SignedInMotion = createContext(false);
export const useSignedInMotion = () => useContext(SignedInMotion);

/**
 * True while the data for `key` is loading, and for at least `minMs` after the
 * key changes, so a fast answer does not flash the skeleton on and off. Each
 * new key (a new search, a new filter) restarts the minimum.
 */
/**
 * For a skeleton shown on first load: true while still loading and for at least `minMs` after
 * the skeleton first appeared. Data that is already there (cached) never shows a skeleton, and
 * later refreshes keep the old data on screen, so neither is held up.
 */
export function useSkeletonHold(loading: boolean, minMs = 600): boolean {
  const [shownAt] = useState(() => (loading ? Date.now() : null));
  const [held, setHeld] = useState(shownAt !== null);
  useEffect(() => {
    if (!held || loading || shownAt === null) return;
    const timer = setTimeout(() => setHeld(false), Math.max(0, minMs - (Date.now() - shownAt)));
    return () => clearTimeout(timer);
  }, [held, loading, shownAt, minMs]);
  return loading || held;
}

export function useMinLoading(key: string, loading: boolean, minMs = 600): boolean {
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(key), minMs);
    return () => clearTimeout(timer);
  }, [key, minMs]);
  return loading || settledKey !== key;
}
