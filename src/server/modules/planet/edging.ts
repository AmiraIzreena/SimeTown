import { one, type Db, type Queryable } from '../../db/client';
import { assertTownshipAccess, type Actor } from '../../auth/actor';
import { notFound } from '../../errors';
import { audit } from '../audit';
import { resolveTownship } from '../townships';

/**
 * The recycled-plastic landscape edging trial (the brief's "prove
 * waste-derived materials work"). SimeTown does not make the edging: a
 * recycling partner does, from plastic the township's residents recycled. The
 * app keeps the test plan, records each result beside the conventional
 * concrete edging laid next to it, and shows how much plastic the township has
 * collected so far. The kilograms of plastic per metre is the partner's figure,
 * entered by staff; nothing here guesses it.
 */

export const TRIAL_AREAS = ['SAFETY', 'PERFORMANCE', 'ENVIRONMENT'] as const;
export const TRIAL_STATUSES = ['PLANNED', 'RUNNING', 'PASSED', 'FAILED'] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

/** The starting test plan, set up the first time a township opens the trial. Staff record results against each. */
export const DEFAULT_TEST_PLAN: { area: (typeof TRIAL_AREAS)[number]; name: string; method: string; passRule: string }[] = [
  { area: 'SAFETY', name: 'Sharp edges and splinters', method: 'Run a gloved hand along every cut end and joint after installation.', passRule: 'No sharp edge or loose sliver.' },
  { area: 'SAFETY', name: 'Trip height', method: 'Measure how far the edging stands above the path at ten points.', passRule: 'Within the same limit as the concrete edging beside it.' },
  { area: 'SAFETY', name: 'Behaviour near heat', method: 'Check the supplier’s fire data; keep the trial strip away from BBQ areas.', passRule: 'Supplier data reviewed and the location agreed by the township office.' },
  { area: 'PERFORMANCE', name: 'Dimensions as delivered', method: 'Measure length, height and thickness of five pieces.', passRule: 'Within the supplier’s stated tolerance.' },
  { area: 'PERFORMANCE', name: 'Impact from a mower or trolley', method: 'Roll a loaded trolley wheel against the edging and strike it with the mower guard, ten times each.', passRule: 'No crack or permanent dent; the concrete edging is tested the same way.' },
  { area: 'PERFORMANCE', name: 'Sun and heat over three months', method: 'Inspect monthly for warping, fading and brittleness; record the surface temperature at midday.', passRule: 'No warping or brittleness after three months outdoors.' },
  { area: 'PERFORMANCE', name: 'Staying in line after heavy rain', method: 'Measure the line against a string after each heavy rain for three months.', passRule: 'No more movement than the concrete edging.' },
  { area: 'ENVIRONMENT', name: 'Recycled content', method: 'Ask the partner for the batch record linking the edging to the plastic collected.', passRule: 'Batch record received and recycled share stated.' },
  { area: 'ENVIRONMENT', name: 'Embodied carbon against concrete', method: 'Compare the supplier’s figure with the concrete edging’s, per metre.', passRule: 'Lower than the concrete edging, with the source of both figures.' },
  { area: 'ENVIRONMENT', name: 'Shedding of plastic fragments', method: 'Inspect the soil and path next to the strip monthly for loose fragments.', passRule: 'No visible fragments after three months.' },
  { area: 'PERFORMANCE', name: 'Cost per metre installed', method: 'Record the supplied and installed cost of both strips.', passRule: 'Recorded for both, so the difference is known.' },
];

async function ensurePlan(q: Queryable, townshipId: string) {
  const has = await one(q, 'SELECT 1 FROM edging_trial_tests WHERE township_id = $1 LIMIT 1', [townshipId]);
  if (has) return;
  for (const [i, t] of DEFAULT_TEST_PLAN.entries()) {
    await q.query(
      `INSERT INTO edging_trial_tests (township_id, seq, area, name, method, pass_rule) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [townshipId, i + 1, t.area, t.name, t.method, t.passRule],
    );
  }
}

export async function edgingTrial(db: Db, actor: Actor) {
  return db.tx(async (tx) => {
    const townshipId = await resolveTownship(tx, actor);
    await ensurePlan(tx, townshipId);
    const [tests, plastic] = await Promise.all([
      tx.query<{ id: string; seq: number; area: string; name: string; method: string; pass_rule: string; result_recycled: string | null; result_conventional: string | null; status: TrialStatus; updated_at: Date | null }>(
        `SELECT id, seq, area, name, method, pass_rule, result_recycled, result_conventional, status, updated_at
           FROM edging_trial_tests WHERE township_id = $1 ORDER BY seq`,
        [townshipId],
      ),
      one<{ kiosk_g: number; machine_g: number }>(
        tx,
        `SELECT (SELECT coalesce(sum(d.weight_g), 0)::int FROM kitar_dropoffs d JOIN kitar_kiosks k ON k.id = d.kiosk_id
                  WHERE k.township_id = $1 AND d.material IN ('PLASTIC_PET', 'PLASTIC_OTHER')) AS kiosk_g,
                (SELECT coalesce(sum(i.weight_g), 0)::int FROM kitar_items i JOIN kitar_sessions s ON s.id = i.session_id JOIN kitar_machines m ON m.id = s.machine_id
                  WHERE m.township_id = $1 AND i.accepted AND i.material IN ('PLASTIC_PET', 'PLASTIC_OTHER')) AS machine_g`,
        [townshipId],
      ),
    ]);
    const counts = Object.fromEntries(['PLANNED', 'RUNNING', 'PASSED', 'FAILED'].map((s) => [s, tests.filter((t) => t.status === s).length]));
    return { plasticCollectedG: plastic!.kiosk_g + plastic!.machine_g, tests, counts };
  });
}

export async function updateTrialTest(
  db: Db,
  actor: Actor,
  id: string,
  input: { status?: TrialStatus; resultRecycled?: string | null; resultConventional?: string | null },
  now: Date,
) {
  return db.tx(async (tx) => {
    const t = await one<{ township_id: string }>(tx, 'SELECT township_id FROM edging_trial_tests WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw notFound('Test');
    assertTownshipAccess(actor, t.township_id);
    await tx.query(
      `UPDATE edging_trial_tests SET status = coalesce($2, status),
              result_recycled = CASE WHEN $3::boolean THEN $4 ELSE result_recycled END,
              result_conventional = CASE WHEN $5::boolean THEN $6 ELSE result_conventional END,
              updated_at = $7
        WHERE id = $1`,
      [id, input.status ?? null, input.resultRecycled !== undefined, input.resultRecycled?.trim() || null, input.resultConventional !== undefined, input.resultConventional?.trim() || null, now],
    );
    await audit(tx, actor.id, 'TRIAL_TEST_UPDATED', 'edging_trial_test', id, { status: input.status });
    return { ok: true };
  });
}
