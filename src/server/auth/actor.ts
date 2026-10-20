import type { Role } from '@/shared/domain';
import { forbidden } from '../errors';

/** The signed-in person, as loaded from their session. Passed to every service call. */
export interface Actor {
  id: string;
  role: Role;
  email: string;
  fullName: string;
  /** NULL for SDP HQ admins (all townships) and sponsors. */
  townshipId: string | null;
  homeId: string | null;
  merchantId: string | null;
  sponsorId: string | null;
  residencyStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  memberCode: string | null;
}

/** A resident whose home has been confirmed. Only they can earn or spend. */
export type VerifiedResident = Actor & { homeId: string; townshipId: string };

export function requireVerifiedResident(actor: Actor): VerifiedResident {
  if (actor.role !== 'RESIDENT' || actor.residencyStatus !== 'VERIFIED' || !actor.homeId || !actor.townshipId) {
    throw forbidden('Your home needs to be confirmed before you can do this.');
  }
  return actor as VerifiedResident;
}

/** Residents and township roles always have a township. */
export function townshipOf(actor: Actor): string {
  if (!actor.townshipId) throw forbidden('Choose a township first.');
  return actor.townshipId;
}

/**
 * Township staff may only touch their own township; HQ admins may touch any.
 * Use on every staff action that names a record by id (stops IDOR across townships).
 */
export function assertTownshipAccess(actor: Actor, townshipId: string): void {
  if (!canAccessTownship(actor, townshipId)) throw forbidden();
}

/** The same rule as a yes/no, for callers that answer "not found" rather than "forbidden". */
export function canAccessTownship(actor: Actor, townshipId: string): boolean {
  return actor.role === 'HQ_ADMIN' || actor.townshipId === townshipId;
}
