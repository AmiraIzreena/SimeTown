import { z } from 'zod';
import { badRequest } from '../errors';

/** Keyset pagination: stable under inserts and fast on the (created_at, id) indexes. */
export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Returns the [sort value, id] the next page starts after, or nulls for the first page.
 * A `time` cursor is (timestamp, uuid); an `id` cursor carries only a numeric id. Both
 * parts are checked here, so a forged cursor is a 400 rather than a database error.
 */
export function decodeCursor(cursor: string | undefined, kind: 'time' | 'id'): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    const [a, b] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof a !== 'string' || typeof b !== 'string') throw new Error();
    const valid = kind === 'time' ? ISO_TIME.test(a) && !Number.isNaN(Date.parse(a)) && UUID.test(b) : /^\d{1,18}$/.test(b);
    if (!valid) throw new Error();
    return [a, b];
  } catch {
    throw badRequest('The page cursor is not valid.');
  }
}

/** Call with `limit + 1` rows; the extra row only tells us whether another page exists. */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => [Date | string | number, string | number]): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  if (rows.length <= limit || !last) return { items, nextCursor: null };
  const [a, b] = keyOf(last);
  const key = [a instanceof Date ? a.toISOString() : String(a), String(b)];
  return { items, nextCursor: Buffer.from(JSON.stringify(key)).toString('base64url') };
}
