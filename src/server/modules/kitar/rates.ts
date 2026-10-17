import type { Material } from '@/shared/domain';
import type { Queryable } from '../../db/client';

/**
 * Kitar rates per material (migration 014). Only a signed bin session uses them
 * (BR23); typed kiosk drop-offs never earn points per kg.
 */

/**
 * What a session is worth in offer-backed points: each material's grams at its own
 * rate, rounded down per material, then added up. A material with no rate, or a rate
 * of 0, adds nothing, so it earns Impact XP only.
 */
export function offerWorthAt(rates: ReadonlyMap<Material, number>, byMaterial: readonly { material: Material; grams: number }[]): number {
  return byMaterial.reduce((sum, m) => sum + Math.floor((m.grams * (rates.get(m.material) ?? 0)) / 1000), 0);
}

export interface MaterialRate {
  material: Material;
  pointsPerKg: number;
  placeholder: boolean;
}

/**
 * The rates residents see. A database without migration 014 has no rates table: that
 * gives no rates instead of an error, so the Kitar screen still loads. Any other error is real.
 */
export async function listRates(q: Queryable): Promise<MaterialRate[]> {
  try {
    return await q.query<MaterialRate>('SELECT material, points_per_kg AS "pointsPerKg", placeholder FROM kitar_material_rates ORDER BY material');
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return []; // undefined_table
    throw error;
  }
}

export async function offerWorthByMaterial(q: Queryable, byMaterial: readonly { material: Material; grams: number }[]): Promise<number> {
  if (byMaterial.length === 0) return 0;
  const rows = await q.query<{ material: Material; points_per_kg: number }>('SELECT material, points_per_kg FROM kitar_material_rates');
  return offerWorthAt(new Map(rows.map((r) => [r.material, r.points_per_kg])), byMaterial);
}
