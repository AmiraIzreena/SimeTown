import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROLE_HOME, type Role } from '@/shared/domain';
import { getDb } from '../db/client';
import type { Actor } from './actor';
import { actorFromToken, sessionCookieName } from './session';

/** The signed-in person for a server-rendered page, or null. */
export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(sessionCookieName())?.value ?? null;
  return actorFromToken(await getDb(), token, new Date());
}

/**
 * Used by each area's layout. Signed-out visitors go to sign-in; signed-in
 * people who belong elsewhere go to their own area. The API enforces the same
 * roles independently, so this only decides which screens are shown.
 */
export async function requireArea(roles: readonly Role[]): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  if (!roles.includes(actor.role)) redirect(ROLE_HOME[actor.role]);
  return actor;
}
