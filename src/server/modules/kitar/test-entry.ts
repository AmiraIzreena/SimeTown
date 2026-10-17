import { randomUUID } from 'node:crypto';
import { MATERIALS, type Material } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import { requireVerifiedResident, type Actor } from '../../auth/actor';
import { getConfig, type Config } from '../../config';
import { badRequest, forbidden, notFound, ruleViolation } from '../../errors';
import { audit } from '../audit';
import { creditDropOff, hasDropoffSource } from './machine';

/**
 * Kitar test mode: a practice recycling entry, for local demos only.
 *
 * This is a deliberate exception to BR23 (points per kg need a bin's signed record),
 * so it needs no setting but is available only on a local demo: the database must be
 * pglite AND the app must run in development (APP_ENV=development). Anywhere else the
 * route refuses, admins included, and GET /kitar does not offer it. config.ts already
 * refuses a pglite database outside development. Nothing here changes the bin or
 * typed kiosk paths.
 *
 * The entry goes through `creditDropOff`, the same step a finished bin session uses,
 * so trips per day, the home's monthly limits, shop promises and XP all apply as for
 * a real bin. Every entry is written to the audit log with the ids of its drop-off rows.
 * With migration 016 the rows are also stored with source TEST; a local database
 * without 016 still saves the entry, and the audit entry is then what marks it.
 */

const MAX_GRAMS = 20_000;

/** True only on a local demo: a pglite database and the app running in development. */
export function testEntryEnabled(config: Pick<Config, 'APP_ENV' | 'DATABASE_URL'>): boolean {
  return config.APP_ENV === 'development' && config.DATABASE_URL.startsWith('pglite://');
}

export async function recordTestEntry(
  db: Db,
  actor: Actor,
  input: { machineId: string; material: Material; weightG: number },
  now: Date,
  config: Pick<Config, 'APP_ENV' | 'DATABASE_URL'> = getConfig(),
) {
  // First, before anything else and whoever asks: no test mode, no entry.
  if (!testEntryEnabled(config)) throw forbidden('Test mode is off.');
  const resident = requireVerifiedResident(actor);
  if (!Number.isInteger(input.weightG) || input.weightG < 1 || input.weightG > MAX_GRAMS) throw badRequest('Enter a weight more than 0 kg, up to 20 kg.');
  if (!(MATERIALS as readonly string[]).includes(input.material)) throw badRequest('Choose a material.');

  return db.tx(async (tx) => {
    const bin = await one<{ id: string; kiosk_id: string; name: string; material: Material | null }>(
      tx,
      'SELECT id, kiosk_id, name, material FROM kitar_machines WHERE id = $1 AND township_id = $2',
      [input.machineId, resident.townshipId],
    );
    if (!bin) throw notFound('Bin');
    // The same rule as a real bin: a bin set to one material takes only that material.
    if (bin.material && bin.material !== input.material) throw ruleViolation('WRONG_MATERIAL', 'This bin takes a different material. Choose the bin for your material.');

    const ref = `test:${randomUUID()}`;
    const labelled = await hasDropoffSource(tx);
    const dropoffIds: string[] = [];
    const reward = await creditDropOff(tx, bin, null, resident.id, [{ material: input.material, grams: input.weightG }], input.weightG, now, false, { ref, labelled, dropoffIds });
    await audit(tx, resident.id, 'KITAR_TEST_ENTRY', 'kitar_dropoff', ref, {
      dropoffIds,
      labelled,
      machineId: bin.id,
      material: input.material,
      weightG: input.weightG,
      xp: reward?.xp ?? 0,
      points: reward?.points ?? 0,
      offerPoints: reward?.offerPoints ?? 0,
      skipped: reward?.skipped ?? null,
    });
    return { test: true as const, bin: bin.name, material: input.material, weightG: input.weightG, reward };
  });
}
