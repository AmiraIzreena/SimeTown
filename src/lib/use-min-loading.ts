'use client';

import { useEffect, useState } from 'react';

/** How long a load may run before its skeleton shows (see .skeleton in globals.css). */
export const SKELETON_DELAY_MS = 150;

/**
 * True while the data for `key` is loading. A skeleton only becomes visible
 * once the load outlasts SKELETON_DELAY_MS, so a quick or cached answer never
 * flashes one; once it has shown, this stays true for at least `minMs` more,
 * so it does not blink on and off. Data that is already there is never held
 * back. A new key (a new search, a new filter) starts again.
 */
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
