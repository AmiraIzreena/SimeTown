/**
 * What a Gerak challenge counts, in plain words, shared by the resident Gerak page, the public
 * Challenges page and the staff Campaigns console so all three say the same thing. Above all it
 * makes plain whether a loop must be finished. Mirrors server/modules/gerak/distance.ts: a kilometre
 * goal on either loop record counts distance on the loops, part-loops included.
 */

export type GerakChallengeKind = 'WHOLE_LOOPS' | 'LOOP_DISTANCE' | 'ANY_TRIP' | 'CHECKPOINTS';

export const GERAK_CHALLENGE_RULES: Record<GerakChallengeKind, { tag: string; rule: string }> = {
  WHOLE_LOOPS: { tag: 'Whole loops only', rule: 'Only whole loops count: tick every checkpoint of a loop on the same day.' },
  LOOP_DISTANCE: {
    tag: 'Part-loops count',
    rule: 'Part-loops count: every bit you walk or ride on a loop path adds up, finished or not. Distance off the loops does not count.',
  },
  ANY_TRIP: { tag: 'Any tracked trip', rule: 'Any walk, run or ride you track counts, on a loop or not.' },
  CHECKPOINTS: { tag: 'Each checkpoint', rule: 'Each checkpoint you tick counts, once a day for each one.' },
};

/** The kind of a Gerak challenge, or null for a challenge from another feature. */
export function gerakChallengeKind(activity: string, metric: string): GerakChallengeKind | null {
  if ((activity === 'GERAK_LOOP' || activity === 'GERAK_ON_LOOP') && metric === 'QUANTITY') return 'LOOP_DISTANCE';
  if (activity === 'GERAK_LOOP' || activity === 'GERAK_ON_LOOP') return 'WHOLE_LOOPS';
  if (activity === 'GERAK_TRIP') return 'ANY_TRIP';
  if (activity === 'GERAK_CHECKIN') return 'CHECKPOINTS';
  return null;
}
