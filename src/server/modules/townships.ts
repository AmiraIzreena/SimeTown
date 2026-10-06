import { formatAddress, shortAddress, type HomeAddress } from '@/shared/domain';
import type { Actor } from '../auth/actor';
import type { Queryable } from '../db/client';
import { badRequest, forbidden } from '../errors';

export async function listTownships(q: Queryable) {
  return q.query<{ id: string; name: string }>('SELECT id, name FROM townships ORDER BY name');
}

/** Columns that make up a home's postal address, for `formatAddress`. */
export const HOME_ADDRESS_COLUMNS = 'h.property_type, h.house_no, h.building, h.street, h.precinct, h.postcode, h.city, h.state';

/**
 * The township's address book for the address picker: its precincts and their
 * streets, from the property record. Addresses only, never who lives there.
 */
export async function addressOptions(q: Queryable, townshipId: string) {
  const rows = await q.query<{ precinct: string | null; street: string }>(
    `SELECT DISTINCT precinct, street FROM homes WHERE township_id = $1 AND house_no IS NOT NULL ORDER BY precinct NULLS LAST, street`,
    [townshipId],
  );
  const precincts: { precinct: string | null; streets: string[] }[] = [];
  for (const row of rows) {
    const last = precincts.at(-1);
    if (last && last.precinct === row.precinct) last.streets.push(row.street);
    else precincts.push({ precinct: row.precinct, streets: [row.street] });
  }
  return { precincts };
}

/** The houses (or high-rise units) on one street, the last step of the address picker. */
export async function homesOnStreet(q: Queryable, townshipId: string, precinct: string | null, street: string) {
  const rows = await q.query<HomeAddress & { id: string }>(
    `SELECT h.id, ${HOME_ADDRESS_COLUMNS} FROM homes h
      WHERE h.township_id = $1 AND h.street = $2 AND h.precinct IS NOT DISTINCT FROM $3 AND h.house_no IS NOT NULL
      ORDER BY h.building NULLS FIRST, length(h.house_no), h.house_no LIMIT 2000`,
    [townshipId, street, precinct],
  );
  // The street is already chosen, so a house is just its number; a unit also names its building.
  const label = (home: HomeAddress) => (home.property_type === 'HIGHRISE' ? shortAddress(home) : `No. ${home.house_no}`);
  return rows.map((home) => ({ id: home.id, label: label(home), address: formatAddress(home) }));
}

/**
 * Which township a staff action applies to. Township roles are fixed to their
 * own. An HQ admin names one, or it is inferred when only one exists.
 */
export async function resolveTownship(q: Queryable, actor: Actor, requested?: string): Promise<string> {
  if (actor.townshipId) {
    if (requested && requested !== actor.townshipId) throw forbidden();
    return actor.townshipId;
  }
  const townships = await listTownships(q);
  if (requested) {
    if (!townships.some((t) => t.id === requested)) throw badRequest('Unknown township.');
    return requested;
  }
  if (townships.length === 1) return townships[0]!.id;
  throw badRequest('Choose a township.');
}
