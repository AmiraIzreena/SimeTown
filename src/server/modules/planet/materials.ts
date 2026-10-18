import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { chat, ModelError } from '../../ai/chat';
import { notFound } from '../../errors';
import { getConfig } from '../../config';

/**
 * Material comparison (the brief's "compare greener building materials").
 *
 * A project team picks one use and its performance requirements. Every material
 * for that use is checked against each requirement (meets, fails or no data),
 * ranked, and flagged where environmental evidence is missing. The AI agent may
 * explain the result, but only from this table: it never brings in figures of
 * its own. The library holds SAMPLE values to show how the comparison works;
 * each must be replaced with the supplier's datasheet before any decision.
 */

export const USE_CASES = ['WALKWAY_PAVING', 'LANDSCAPE_EDGING'] as const;
export type UseCase = (typeof USE_CASES)[number];

type CriterionKind = 'min' | 'max' | 'must';
export interface Criterion {
  key: 'costRm' | 'lifeYears' | 'strengthMpa' | 'permeable' | 'uvStable';
  label: string;
  unit: string;
  kind: CriterionKind;
}

export const USES: Record<UseCase, { label: string; unit: string; criteria: Criterion[] }> = {
  WALKWAY_PAVING: {
    label: 'Walkway paving',
    unit: 'm²',
    criteria: [
      { key: 'costRm', label: 'Installed cost', unit: 'RM per m²', kind: 'max' },
      { key: 'lifeYears', label: 'Service life', unit: 'years', kind: 'min' },
      { key: 'strengthMpa', label: 'Compressive strength', unit: 'MPa', kind: 'min' },
      { key: 'permeable', label: 'Lets rain soak through', unit: '', kind: 'must' },
    ],
  },
  LANDSCAPE_EDGING: {
    label: 'Landscape edging',
    unit: 'metre',
    criteria: [
      { key: 'costRm', label: 'Installed cost', unit: 'RM per metre', kind: 'max' },
      { key: 'lifeYears', label: 'Service life', unit: 'years', kind: 'min' },
      { key: 'uvStable', label: 'Stable in sun and heat', unit: '', kind: 'must' },
    ],
  },
};

export interface MaterialEntry {
  id: string;
  use: UseCase;
  name: string;
  conventional: boolean;
  values: Partial<Record<Criterion['key'], number | boolean | null>>;
  /** Embodied carbon, kg CO2e per unit of the use. Lower is better. */
  carbonKg: number | null;
  recycledPct: number | null;
  evidence: {
    /** An Environmental Product Declaration for this product. */
    epd: boolean;
    /** An independent test report for the performance figures. */
    testReport: boolean;
    /** A certificate for the recycled content it claims. */
    recycledCertificate: boolean;
  };
}

/** Sample values for the prototype. Replace each with the supplier's datasheet. */
export const MATERIAL_LIBRARY: MaterialEntry[] = [
  { id: 'paver-concrete', use: 'WALKWAY_PAVING', name: 'Precast concrete paver', conventional: true, values: { costRm: 55, lifeYears: 25, strengthMpa: 45, permeable: false }, carbonKg: 30, recycledPct: 0, evidence: { epd: false, testReport: true, recycledCertificate: false } },
  { id: 'paver-recycled-aggregate', use: 'WALKWAY_PAVING', name: 'Concrete paver with recycled aggregate', conventional: false, values: { costRm: 58, lifeYears: 20, strengthMpa: 35, permeable: false }, carbonKg: 24, recycledPct: 30, evidence: { epd: false, testReport: false, recycledCertificate: false } },
  { id: 'paver-permeable', use: 'WALKWAY_PAVING', name: 'Permeable concrete paver', conventional: false, values: { costRm: 75, lifeYears: 20, strengthMpa: 30, permeable: true }, carbonKg: 32, recycledPct: 0, evidence: { epd: false, testReport: true, recycledCertificate: false } },
  { id: 'paver-clay', use: 'WALKWAY_PAVING', name: 'Clay brick paver', conventional: true, values: { costRm: 70, lifeYears: 40, strengthMpa: 40, permeable: false }, carbonKg: 40, recycledPct: 0, evidence: { epd: true, testReport: true, recycledCertificate: false } },
  { id: 'paver-plastic', use: 'WALKWAY_PAVING', name: 'Recycled-plastic composite paver', conventional: false, values: { costRm: 85, lifeYears: null, strengthMpa: null, permeable: true }, carbonKg: 15, recycledPct: 80, evidence: { epd: false, testReport: false, recycledCertificate: false } },
  { id: 'edging-concrete', use: 'LANDSCAPE_EDGING', name: 'Precast concrete edging', conventional: true, values: { costRm: 25, lifeYears: 25, uvStable: true }, carbonKg: 12, recycledPct: 0, evidence: { epd: false, testReport: true, recycledCertificate: false } },
  { id: 'edging-steel', use: 'LANDSCAPE_EDGING', name: 'Galvanised steel edging', conventional: false, values: { costRm: 40, lifeYears: 20, uvStable: true }, carbonKg: 9, recycledPct: 30, evidence: { epd: true, testReport: true, recycledCertificate: true } },
  { id: 'edging-plastic', use: 'LANDSCAPE_EDGING', name: 'Recycled-plastic edging', conventional: false, values: { costRm: 30, lifeYears: 15, uvStable: null }, carbonKg: 4, recycledPct: 90, evidence: { epd: false, testReport: false, recycledCertificate: false } },
  { id: 'edging-timber', use: 'LANDSCAPE_EDGING', name: 'Treated timber edging', conventional: true, values: { costRm: 18, lifeYears: 6, uvStable: true }, carbonKg: 3, recycledPct: 0, evidence: { epd: false, testReport: false, recycledCertificate: false } },
  { id: 'edging-brick', use: 'LANDSCAPE_EDGING', name: 'Brick edging', conventional: true, values: { costRm: 35, lifeYears: 30, uvStable: true }, carbonKg: 15, recycledPct: 0, evidence: { epd: true, testReport: true, recycledCertificate: false } },
];

export type Requirements = Partial<Record<Criterion['key'], number | boolean>>;
type Verdict = 'MEETS' | 'FAILS' | 'NO_DATA';

export function compareMaterials(use: UseCase, requirements: Requirements) {
  const spec = USES[use];
  const rows = MATERIAL_LIBRARY.filter((m) => m.use === use).map((m) => {
    const checks = spec.criteria
      .filter((c) => requirements[c.key] !== undefined && requirements[c.key] !== false)
      .map((c) => {
        const wanted = requirements[c.key]!;
        const value = m.values[c.key];
        let verdict: Verdict;
        if (value === null || value === undefined) verdict = 'NO_DATA';
        else if (c.kind === 'must') verdict = value === true ? 'MEETS' : 'FAILS';
        else if (c.kind === 'min') verdict = (value as number) >= (wanted as number) ? 'MEETS' : 'FAILS';
        else verdict = (value as number) <= (wanted as number) ? 'MEETS' : 'FAILS';
        return { key: c.key, verdict, value: value ?? null, wanted };
      });
    const missingEvidence: string[] = [];
    if (!m.evidence.epd) missingEvidence.push('No Environmental Product Declaration');
    if (!m.evidence.testReport) missingEvidence.push('No independent test report for the performance figures');
    if ((m.recycledPct ?? 0) > 0 && !m.evidence.recycledCertificate) missingEvidence.push('Recycled content claimed without a certificate');
    if (m.carbonKg === null) missingEvidence.push('No embodied carbon figure');
    const missingData = spec.criteria.filter((c) => m.values[c.key] === null || m.values[c.key] === undefined).map((c) => c.label);
    return {
      id: m.id,
      name: m.name,
      conventional: m.conventional,
      values: m.values,
      carbonKg: m.carbonKg,
      recycledPct: m.recycledPct,
      evidence: m.evidence,
      checks,
      fails: checks.filter((c) => c.verdict === 'FAILS').length,
      noData: checks.filter((c) => c.verdict === 'NO_DATA').length,
      missingEvidence,
      missingData,
    };
  });
  rows.sort((a, b) => a.fails - b.fails || a.noData - b.noData || (a.carbonKg ?? 1e9) - (b.carbonKg ?? 1e9) || ((a.values.costRm as number) ?? 1e9) - ((b.values.costRm as number) ?? 1e9));
  const baseline = rows.find((r) => r.conventional && r.fails === 0) ?? rows.find((r) => r.conventional) ?? null;
  return {
    use,
    useLabel: spec.label,
    unit: spec.unit,
    criteria: spec.criteria,
    requirements,
    rows: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      // Against the conventional choice, so the saving (or cost) of the greener option is plain.
      carbonVsBaselinePct: baseline && baseline.carbonKg && r.carbonKg !== null && r.id !== baseline.id ? Math.round(((r.carbonKg - baseline.carbonKg) / baseline.carbonKg) * 100) : null,
    })),
    baselineId: baseline?.id ?? null,
    sample: true,
  };
}

/** A plain summary built from the table alone, used when no AI service is set up (and as the agent's fallback). */
export function summarise(result: ReturnType<typeof compareMaterials>): string {
  const fits = result.rows.filter((r) => r.fails === 0 && r.noData === 0);
  const unsure = result.rows.filter((r) => r.fails === 0 && r.noData > 0);
  const parts: string[] = [];
  if (fits.length) {
    const best = fits[0]!;
    parts.push(`${best.name} meets every requirement you set and has the lowest embodied carbon of those that do${best.carbonVsBaselinePct !== null && best.carbonVsBaselinePct < 0 ? ` (${Math.abs(best.carbonVsBaselinePct)}% less than the conventional choice)` : ''}.`);
    if (best.missingEvidence.length) parts.push(`Before shortlisting it, ask the supplier for: ${best.missingEvidence.join('; ').toLowerCase()}.`);
  } else {
    parts.push('No material in the library meets every requirement you set. Relax one requirement or add a product.');
  }
  if (unsure.length) parts.push(`${unsure.map((r) => r.name).join(', ')} could fit, but data is missing: ${[...new Set(unsure.flatMap((r) => r.missingData))].join(', ').toLowerCase()}.`);
  parts.push('These are sample values: check each figure against the supplier’s datasheet.');
  return parts.join(' ');
}

/**
 * The agent explains the comparison in plain words. It is given the table and
 * nothing else, told to use only those figures, and falls back to the rule-based
 * summary when the AI service is not set up or does not answer.
 */
export async function explainComparison(use: UseCase, requirements: Requirements) {
  const result = compareMaterials(use, requirements);
  if (getConfig().AI_PROVIDER === 'none') return { summary: summarise(result), source: 'RULES' as const, result };
  const system = [
    'You help a property developer’s project team compare building materials for one use.',
    'Use ONLY the JSON table you are given. Never add figures, products, standards or claims that are not in it.',
    'In at most 120 words: name the best fit for the stated requirements, the trade-off against the conventional choice,',
    'and every piece of missing environmental evidence or missing data that must be obtained before a decision.',
    'Say plainly that the values are samples to be checked against supplier datasheets. Plain British English, no lists.',
  ].join(' ');
  try {
    const reply = await chat(system, [{ role: 'user', text: JSON.stringify({ use: result.useLabel, unit: result.unit, requirements, rows: result.rows }) }], []);
    const text = reply.text.trim();
    if (!text) throw new ModelError('empty');
    return { summary: text, source: 'AI' as const, result };
  } catch {
    return { summary: summarise(result), source: 'RULES' as const, result };
  }
}

export interface ShortlistInput {
  use: UseCase;
  requirements: Requirements;
  materialIds: string[];
  secondsTaken: number;
  note?: string;
}

/** A saved shortlist, with how long it took: the brief's "time to shortlist". */
export async function saveShortlist(db: Db, actor: Actor, input: ShortlistInput, now: Date) {
  const known = new Set(MATERIAL_LIBRARY.filter((m) => m.use === input.use).map((m) => m.id));
  if (input.materialIds.some((id) => !known.has(id))) throw notFound('Material');
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO material_shortlists (user_id, use_case, requirements, material_ids, seconds_taken, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [actor.id, input.use, JSON.stringify(input.requirements), input.materialIds, input.secondsTaken, input.note?.trim() || null, now],
  );
  return { id: row!.id };
}

export async function listShortlists(db: Db) {
  const rows = await db.query<{ id: string; use_case: UseCase; material_ids: string[]; seconds_taken: number; note: string | null; created_at: Date; full_name: string }>(
    `SELECT s.id, s.use_case, s.material_ids, s.seconds_taken, s.note, s.created_at, u.full_name
       FROM material_shortlists s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 20`,
  );
  const median = await one<{ seconds: number | null }>(db, 'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_taken)::int AS seconds FROM material_shortlists');
  return {
    medianSeconds: median?.seconds ?? null,
    shortlists: rows.map((r) => ({ ...r, useLabel: USES[r.use_case].label, materials: r.material_ids.map((id) => MATERIAL_LIBRARY.find((m) => m.id === id)?.name ?? id) })),
  };
}
