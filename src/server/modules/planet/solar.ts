import { one, type Db } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { conflict, notFound } from '../../errors';
import { audit } from '../audit';
import { resolveTownship } from '../townships';

/**
 * Solar opportunity mapper (the brief's PLANET problem for developers): rank
 * rooftops and car parks for detailed feasibility studies.
 *
 * Each site's yearly output is a planning estimate from its usable area,
 * orientation and shading. Demand near it comes from the Jimat bills of homes in
 * the same area, added up per area and never shown per home, and from how many
 * residents there asked about solar. What is missing (a shading survey, a
 * structural check, the roof's age) is flagged, and it lowers the score, so a
 * site is never ranked high on data nobody has checked.
 */

export const SOLAR_KINDS = ['ROOFTOP', 'CAR_PARK', 'OTHER'] as const;
export type SolarKind = (typeof SOLAR_KINDS)[number];
export const ORIENTATIONS = ['FLAT', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const SHADING = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Shading = (typeof SHADING)[number];

/** Planning assumptions, shown beside every estimate. An engineer replaces them in the detailed study. */
export const SOLAR_ASSUMPTIONS = {
  kwpPerM2: 0.15,
  kwhPerKwpYear: 1200,
  orientation: { FLAT: 1, N: 0.97, S: 0.97, NE: 0.95, NW: 0.95, SE: 0.95, SW: 0.95, E: 0.92, W: 0.92 } as Record<Orientation, number>,
  shading: { LOW: 1, MEDIUM: 0.85, HIGH: 0.6 } as Record<Shading, number>,
  unknownShading: 0.85,
  oldRoofYears: 15,
};

interface SiteRow {
  id: string;
  name: string;
  kind: SolarKind;
  zone_id: string | null;
  zone_name: string | null;
  usable_m2: number;
  orientation: Orientation;
  shading: Shading | null;
  roof_age_years: number | null;
  structural_checked: boolean;
  expert_rank: number | null;
  notes: string | null;
}

export async function solarSites(db: Db, actor: Actor) {
  const townshipId = actor.townshipId;
  const [sites, zones] = await Promise.all([
    db.query<SiteRow>(
      `SELECT s.id, s.name, s.kind, s.zone_id, z.name AS zone_name, s.usable_m2, s.orientation, s.shading, s.roof_age_years,
              s.structural_checked, s.expert_rank, s.notes
         FROM solar_sites s LEFT JOIN flood_zones z ON z.id = s.zone_id
        WHERE ($1::uuid IS NULL OR s.township_id = $1) ORDER BY s.name`,
      [townshipId],
    ),
    // Each area's homes, their latest monthly electricity use from Jimat, and residents who asked about solar.
    db.query<{ id: string; name: string; homes_reporting: number; monthly_kwh: number; interested: number }>(
      `SELECT z.id, z.name,
              count(DISTINCT r.home_id)::int AS homes_reporting,
              coalesce(sum(r.electricity_kwh), 0)::int AS monthly_kwh,
              (SELECT count(*)::int FROM solar_leads l JOIN users u ON u.id = l.user_id JOIN homes hh ON hh.id = u.home_id WHERE hh.zone_id = z.id) AS interested
         FROM flood_zones z
         LEFT JOIN homes h ON h.zone_id = z.id
         LEFT JOIN LATERAL (
           SELECT j.home_id, j.electricity_kwh FROM jimat_readings j WHERE j.home_id = h.id AND j.electricity_kwh IS NOT NULL ORDER BY j.month DESC LIMIT 1
         ) r ON true
        WHERE ($1::uuid IS NULL OR z.township_id = $1)
        GROUP BY z.id, z.name ORDER BY z.name`,
      [townshipId],
    ),
  ]);
  return rankSites(sites, zones);
}

export function rankSites(
  sites: SiteRow[],
  zones: { id: string; name: string; homes_reporting: number; monthly_kwh: number; interested: number }[],
) {
  const a = SOLAR_ASSUMPTIONS;
  const maxZoneKwh = Math.max(1, ...zones.map((z) => z.monthly_kwh));
  const estimate = (s: SiteRow) =>
    Math.round(s.usable_m2 * a.kwpPerM2 * a.kwhPerKwpYear * a.orientation[s.orientation] * (s.shading ? a.shading[s.shading] : a.unknownShading));
  const maxKwh = Math.max(1, ...sites.map(estimate));
  const scored = sites.map((s) => {
    const zone = zones.find((z) => z.id === s.zone_id);
    const kwp = Math.round(s.usable_m2 * a.kwpPerM2 * 10) / 10;
    const annualKwh = estimate(s);
    const flags: string[] = [];
    if (!s.shading) flags.push('Shading survey needed');
    else if (s.shading === 'HIGH') flags.push('Heavy shading: check whether trimming or another layout helps');
    if (!s.structural_checked) flags.push(s.kind === 'CAR_PARK' ? 'Canopy structure and foundations need an engineering check' : 'Structural check needed');
    if (s.kind === 'ROOFTOP' && s.roof_age_years === null) flags.push('Roof age unknown');
    if (s.kind === 'ROOFTOP' && s.roof_age_years !== null && s.roof_age_years >= a.oldRoofYears) flags.push('Roof may need replacing before panels go on');
    if (!zone || zone.homes_reporting === 0) flags.push('No electricity data from homes nearby');
    if (s.usable_m2 < 50) flags.push('Small site: may not justify a separate study');

    const shadingReady = s.shading === 'LOW' ? 1 : s.shading === 'MEDIUM' ? 0.6 : s.shading === 'HIGH' ? 0.2 : 0;
    const roofReady = s.kind !== 'ROOFTOP' ? 1 : s.roof_age_years === null ? 0 : s.roof_age_years < a.oldRoofYears ? 1 : 0.3;
    const output = Math.round((annualKwh / maxKwh) * 45);
    // A site too small to matter never climbs the list on demand or readiness alone.
    const scale = Math.min(1, output / 15);
    const parts = {
      output,
      demand: Math.round(((zone?.monthly_kwh ?? 0) / maxZoneKwh) * 20 * scale),
      interest: Math.round(Math.min(1, (zone?.interested ?? 0) / 10) * 10 * scale),
      readiness: Math.round((shadingReady * 0.4 + (s.structural_checked ? 0.4 : 0) + roofReady * 0.2) * 25 * scale),
    };
    return {
      ...s,
      kwp,
      annualKwh,
      zoneMonthlyKwh: zone?.monthly_kwh ?? 0,
      zoneHomesReporting: zone?.homes_reporting ?? 0,
      zoneInterested: zone?.interested ?? 0,
      score: parts.output + parts.demand + parts.interest + parts.readiness,
      parts,
      flags,
    };
  });
  scored.sort((x, y) => y.score - x.score || y.annualKwh - x.annualKwh);
  const ranked = scored.map((s, i) => ({ ...s, rank: i + 1 }));

  // The brief's test: how well the shortlist matches an expert's own ranking. The shortlist is
  // shorter than the list ranked (at most five), so the comparison means something.
  const withExpert = ranked.filter((s) => s.expert_rank !== null);
  const n = withExpert.length < 2 ? 0 : Math.min(5, Math.floor(withExpert.length / 2) + 1);
  const expertTop = new Set([...withExpert].sort((x, y) => x.expert_rank! - y.expert_rank!).slice(0, n).map((s) => s.id));
  const appTop = withExpert.slice(0, n).map((s) => s.id);
  const agreement = n > 0 ? { compared: n, inBoth: appTop.filter((id) => expertTop.has(id)).length } : null;

  return {
    sites: ranked,
    areas: zones.map((z) => ({ id: z.id, name: z.name, homesReporting: z.homes_reporting, monthlyKwh: z.monthly_kwh, interested: z.interested })),
    agreement,
    assumptions: SOLAR_ASSUMPTIONS,
  };
}

export interface SolarSiteInput {
  name: string;
  kind: SolarKind;
  zoneId?: string | null;
  usableM2: number;
  orientation: Orientation;
  shading?: Shading | null;
  roofAgeYears?: number | null;
  structuralChecked?: boolean;
  expertRank?: number | null;
  notes?: string | null;
}

export async function createSolarSite(db: Db, actor: Actor, input: SolarSiteInput) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    if (input.zoneId && !(await one(tx, 'SELECT 1 FROM flood_zones WHERE id = $1 AND township_id = $2', [input.zoneId, townshipId]))) throw notFound('Area');
    if (await one(tx, 'SELECT 1 FROM solar_sites WHERE township_id = $1 AND lower(name) = lower($2)', [townshipId, input.name])) {
      throw conflict('SITE_EXISTS', 'A site with this name already exists.');
    }
    const row = await one<{ id: string }>(
      tx,
      `INSERT INTO solar_sites (township_id, name, kind, zone_id, usable_m2, orientation, shading, roof_age_years, structural_checked, expert_rank, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [townshipId, input.name.trim(), input.kind, input.zoneId ?? null, input.usableM2, input.orientation, input.shading ?? null, input.roofAgeYears ?? null, input.structuralChecked ?? false, input.expertRank ?? null, input.notes?.trim() || null],
    );
    await audit(tx, actor.id, 'SOLAR_SITE_CREATED', 'solar_site', row!.id, { name: input.name });
    return { id: row!.id };
  });
}

export async function updateSolarSite(db: Db, actor: Actor, id: string, input: Partial<SolarSiteInput>) {
  return db.tx(async (tx) => {
    const s = await one<{ township_id: string }>(tx, 'SELECT township_id FROM solar_sites WHERE id = $1 FOR UPDATE', [id]);
    if (!s) throw notFound('Site');
    assertTownshipAccess(actor, s.township_id);
    if (input.zoneId && !(await one(tx, 'SELECT 1 FROM flood_zones WHERE id = $1 AND township_id = $2', [input.zoneId, s.township_id]))) throw notFound('Area');
    const set: [string, unknown][] = [];
    const add = (column: string, value: unknown) => value !== undefined && set.push([column, value]);
    add('name', input.name?.trim());
    add('kind', input.kind);
    add('zone_id', input.zoneId);
    add('usable_m2', input.usableM2);
    add('orientation', input.orientation);
    add('shading', input.shading);
    add('roof_age_years', input.roofAgeYears);
    add('structural_checked', input.structuralChecked);
    add('expert_rank', input.expertRank);
    add('notes', input.notes === undefined ? undefined : input.notes?.trim() || null);
    if (set.length) {
      await tx.query(`UPDATE solar_sites SET ${set.map(([c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...set.map(([, v]) => v)]);
    }
    return { ok: true };
  });
}

export async function deleteSolarSite(db: Db, actor: Actor, id: string) {
  const s = await one<{ township_id: string }>(db, 'SELECT township_id FROM solar_sites WHERE id = $1', [id]);
  if (!s) throw notFound('Site');
  assertTownshipAccess(actor, s.township_id);
  await db.query('DELETE FROM solar_sites WHERE id = $1', [id]);
  return { ok: true };
}
