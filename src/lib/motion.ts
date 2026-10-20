/** How long a finished row takes to slide out (matches `.ops-row.is-leaving` in parcel-workspace.css). */
const LEAVE_MS = 200;

/**
 * Waits while a row slides out of its list, so the list refreshes after the motion instead of
 * snapping. Reduced-motion users get no wait at all.
 */
export function afterLeave(): Promise<void> {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Promise((resolve) => setTimeout(resolve, reduce ? 0 : LEAVE_MS));
}
