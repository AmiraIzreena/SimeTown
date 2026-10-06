'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/** False on the server and until React has taken over the page in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
