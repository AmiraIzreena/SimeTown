'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * True inside the signed-in frame (the Shell). Public pages before login keep their own,
 * unchanged loading behaviour, so the 600ms skeleton hold only applies to signed-in screens.
 */
export const SignedInMotion = createContext(false);
export const useSignedInMotion = () => useContext(SignedInMotion);

/** How long a load may run before its skeleton shows (see .skeleton in globals.css). */
export const SKELETON_DELAY_MS = 150;

/**
 * True while the data for `key` is loading. A skeleton only becomes visible
 * once the load outlasts SKELETON_DELAY_MS, so a quick or cached answer never
 * flashes one; once it has shown, this stays true for at least `minMs` more,
 * so it does not blink on and off. Data that is already there is never held
 * back. A new key (a new search, a new filter) starts again.
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
  const [shownAt, setShownAt] = useState<number | null>(null);

  // The skeleton becomes visible once the load outlasts the delay.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShownAt(Date.now()), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, loading]);

  // Once the load settles, a skeleton that did show stays for the rest of its minimum.
  useEffect(() => {
    if (loading || shownAt === null) return;
    const timer = setTimeout(() => setShownAt(null), Math.max(0, shownAt + minMs - Date.now()));
    return () => clearTimeout(timer);
  }, [loading, shownAt, minMs]);

  return loading || shownAt !== null;
}
