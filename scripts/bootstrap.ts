import './env';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { MALAYSIAN_STATES } from '../src/shared/domain';
import { hashToken, newToken } from '../src/server/auth/session';
import { getConfig } from '../src/server/config';
import { getDb, one } from '../src/server/db/client';
import { audit } from '../src/server/modules/audit';

/**
 * Sets up a real township on an empty (migrated) database: the township, its
 * flood zones, its homes from the property record, and the first SDP HQ admin,
 * who gets a one-time link to set a password. Safe to run again: existing rows
 * are kept, new zones and homes are added.
 *
 *   npm run bootstrap -- docs/bootstrap.example.json
 */
const input = z.object({
  township: z.string().trim().min(2).max(120),
  zones: z.array(z.object({ name: z.string().trim().min(1).max(80), safeRoute: z.string().trim().min(3).max(300), assemblyPoint: z.string().trim().min(3).max(200) })).min(1),
  // One entry per home in SDP's property record, with its full postal address.
  homes: z.array(
    z
      .object({
        unitCode: z.string().trim().min(1).max(30), // the property-record reference staff match against
        propertyType: z.enum(['LANDED', 'HIGHRISE']).default('LANDED'),
        houseNo: z.string().trim().min(1).max(20), // "12", or a unit such as "A-03-07"
        building: z.string().trim().min(1).max(120).optional(), // high-rise only
        street: z.string().trim().min(1).max(120),
        precinct: z.string().trim().min(1).max(120).optional(),
        postcode: z.string().trim().regex(/^\d{5}$/),
        city: z.string().trim().min(2).max(60),
        state: z.enum(MALAYSIAN_STATES),
        zone: z.string().trim().optional(),
      })
      .refine((h) => h.propertyType === 'LANDED' || h.building, { message: 'A high-rise unit needs its building', path: ['building'] }),
  ),
  admin: z.object({ email: z.email(), fullName: z.string().trim().min(2).max(100) }),
});

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run bootstrap -- <file.json>   (see docs/bootstrap.example.json)');
  const data = input.parse(JSON.parse(readFileSync(file, 'utf8')));
  const unknownZone = data.homes.find((h) => h.zone && !data.zones.some((z) => z.name === h.zone));
  if (unknownZone) throw new Error(`Home ${unknownZone.unitCode} names a zone that is not listed: ${unknownZone.zone}`);

  const db = await getDb();
  const link = await db.tx(async (tx) => {
    await tx.query('INSERT INTO townships (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [data.township]);
    const township = (await one<{ id: string }>(tx, 'SELECT id FROM townships WHERE name = $1', [data.township]))!.id;
    const zoneIds = new Map<string, string>();
    for (const zone of data.zones) {
      await tx.query(
        'INSERT INTO flood_zones (township_id, name, safe_route, assembly_point) VALUES ($1, $2, $3, $4) ON CONFLICT (township_id, name) DO NOTHING',
        [township, zone.name, zone.safeRoute, zone.assemblyPoint],
      );
      zoneIds.set(zone.name, (await one<{ id: string }>(tx, 'SELECT id FROM flood_zones WHERE township_id = $1 AND name = $2', [township, zone.name]))!.id);
    }
    for (const home of data.homes) {
      await tx.query(
        `INSERT INTO homes (township_id, zone_id, unit_code, property_type, house_no, building, street, precinct, postcode, city, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [
          township, home.zone ? zoneIds.get(home.zone) : null, home.unitCode.toUpperCase(), home.propertyType, home.houseNo,
          home.building ?? null, home.street, home.precinct ?? null, home.postcode, home.city, home.state,
        ],
      );
    }

    if (await one(tx, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [data.admin.email])) return null;
    const admin = await one<{ id: string }>(tx, `INSERT INTO users (email, full_name, role) VALUES ($1, $2, 'HQ_ADMIN') RETURNING id`, [
      data.admin.email.toLowerCase(),
      data.admin.fullName,
    ]);
    const token = newToken();
    await tx.query(`INSERT INTO user_invites (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')`, [hashToken(token), admin!.id]);
    await audit(tx, null, 'BOOTSTRAP', 'township', township, { homes: data.homes.length, zones: data.zones.length, admin: data.admin.email });
    return `${getConfig().appOrigin}/invite#${token}`;
  });

  console.log(`Township "${data.township}": ${data.zones.length} zone(s), ${data.homes.length} home(s) ensured.`);
  console.log(link ? `\nFirst admin: ${data.admin.email}\nSet-password link (works once, 7 days):\n  ${link}\n` : `\nAn account for ${data.admin.email} already exists; no new link was made.\n`);
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
