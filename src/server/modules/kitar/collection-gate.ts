import type { Queryable } from '../../db/client';
import { notify } from '../notifications';

/**
 * Called by the gate when it scans a pass in. If the pass belongs to a
 * recycling collection that is still open, the household is asked for the
 * weight once. Kept apart from collections.ts so Tamu does not import it back.
 */
export async function onCollectionGateEntry(tx: Queryable, passId: string) {
  const rows = await tx.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM recycling_collections WHERE pass_id = $1 AND status = 'CONFIRMED' AND reported_weight_g IS NULL AND review_reason IS NULL`,
    [passId],
  );
  for (const x of rows) {
    await notify(tx, [x.user_id], {
      title: 'How much did they take?',
      body: 'The collector is in. Enter the weight on your collection card in Kitar.',
      link: '/app/kitar',
      category: 'RECYCLING',
      dedupeKey: `kitar-collection-weight:${x.id}`,
    });
  }
}
