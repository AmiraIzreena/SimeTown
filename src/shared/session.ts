import type { Role } from './domain';

/**
 * How long a sign-in lasts (decided 2026-10-23). Only real actions count as activity: a tap, a key or a scroll,
 * never a screen refreshing itself.
 *
 * - Township staff, admins and HQ see residents' personal data and money: signed out after 15 minutes without
 *   activity.
 * - Residents, shops, sponsors and couriers: 30 minutes.
 * - Guards and guardhouse staff keep their screen open all shift and SOS alerts arrive on it: no inactivity
 *   timeout, so no SOS is missed.
 * - Everyone: at most 12 hours, active or not. SESSION_TTL_HOURS can make this shorter, never longer.
 */
export const MAX_SESSION_HOURS = 12;

/** The warning, with "Stay signed in", appears this long before an inactivity sign-out. */
export const IDLE_WARNING_MS = 2 * 60_000;

const STAFF_ROLES: readonly Role[] = ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'];
const SHIFT_ROLES: readonly Role[] = ['GUARD', 'GUARDHOUSE'];

/** Minutes without activity before a sign-in ends, or null for no inactivity timeout. */
export function idleMinutesFor(role: Role): number | null {
  if (SHIFT_ROLES.includes(role)) return null;
  return STAFF_ROLES.includes(role) ? 15 : 30;
}
