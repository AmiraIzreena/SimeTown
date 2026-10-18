import { randomBytes } from 'node:crypto';
import { one, type Db, type Queryable } from '../../db/client';

/**
 * Courier companies' own support, for problems that are theirs to fix.
 *
 * SimeTown shows only a support channel the township has verified (support_*
 * columns, with who verified it and when); it never guesses a link or a phone
 * number. A company whose own system can take tickets would implement
 * CourierSupportAdapter; no real company's ticket system is connected. The
 * simulated demo companies have a simulated adapter whose ticket references
 * are labelled as simulated everywhere.
 */

export interface SupportChannel {
  name: string | null;
  url: string | null;
  phone: string | null;
  verified: boolean;
}

export interface CourierSupportAdapter {
  readonly simulated: boolean;
  /** Files a ticket in the company's own system and returns its reference. */
  submitTicket(q: Queryable, referral: { id: string; tracking_no: string | null; reason: string }): Promise<{ ticketRef: string; status: string }>;
}

const simulatedSupport = (code: string): CourierSupportAdapter => ({
  simulated: true,
  async submitTicket() {
    return { ticketRef: `SIM-${code}-${randomBytes(3).toString('hex').toUpperCase()}`, status: 'RECEIVED' };
  },
});

export interface CompanySupportRow {
  id: string;
  name: string;
  code: string | null;
  provider_mode: string;
  support_name: string | null;
  support_url: string | null;
  support_phone: string | null;
  support_verified_at: Date | null;
}

export const channelOf = (c: CompanySupportRow): SupportChannel | null =>
  c.support_verified_at ? { name: c.support_name, url: c.support_url, phone: c.support_phone, verified: true } : null;

export function supportAdapterFor(c: Pick<CompanySupportRow, 'provider_mode' | 'code'>): CourierSupportAdapter | null {
  return c.provider_mode === 'SIMULATED' && c.code ? simulatedSupport(c.code) : null;
}

export async function companyForSupport(q: Queryable, id: string) {
  return one<CompanySupportRow>(q, 'SELECT id, name, code, provider_mode, support_name, support_url, support_phone, support_verified_at FROM courier_companies WHERE id = $1', [id]);
}

/** A township admin records the company's support channel after checking it with the company. */
export async function verifySupportChannel(db: Db, actorId: string, companyId: string, input: { name: string; url?: string | null; phone?: string | null }, now: Date) {
  await db.query(
    'UPDATE courier_companies SET support_name = $2, support_url = $3, support_phone = $4, support_verified_at = $5, support_verified_by = $6 WHERE id = $1',
    [companyId, input.name.trim(), input.url?.trim() || null, input.phone?.trim() || null, now, actorId],
  );
}
