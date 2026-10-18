import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { one, type Db } from '../../db/client';
import { log } from '../../logger';
import type { CompanyRow, LookupResult, ProviderShipment, ProviderShipmentStatus } from './types';

/**
 * Shipment providers: how SimeTown asks a courier company about a shipment.
 *
 * SIMULATED is the built-in demo company: it answers from its own table of
 * fictional shipments, through the same interface as anything real. It is
 * labelled as simulated everywhere it appears.
 *
 * GATEWAY is SimeTown's own small, signed lookup contract (docs/DEPLOYMENT.md,
 * "Courier integrations"). No courier company's real API is built in or
 * claimed: a company that agrees to integrate implements the contract, or a
 * bridge translates it to whatever API the company actually offers.
 */

const LOOKUP_TIMEOUT_MS = 4_000;

export interface ShipmentProviderAdapter {
  readonly simulated: boolean;
  lookup(db: Db, company: CompanyRow, trackingNo: string, now: Date): Promise<LookupResult>;
  /** Tells the provider the shipment is in a locker. A failure never undoes the deposit; the job tries again later. */
  reportDeposited(db: Db, company: CompanyRow, trackingNo: string, now: Date): Promise<boolean>;
}

interface SimShipmentRow {
  id: string;
  tracking_no: string;
  status: ProviderShipmentStatus;
  locker_eligible: boolean;
  recipient_name: string;
  recipient_phone: string | null;
  address_line: string;
  postcode: string | null;
  simetown_code: string | null;
  weight_g: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  assigned_courier_ref: string | null;
}

const simulated: ShipmentProviderAdapter = {
  simulated: true,
  async lookup(db, company, trackingNo) {
    const started = Date.now();
    if (company.sim_outage) return { ok: false, error: 'The simulated provider is switched to "down".', latencyMs: 0 };
    const r = await one<SimShipmentRow>(db, 'SELECT * FROM sim_shipments WHERE company_id = $1 AND tracking_no = $2', [company.id, trackingNo]);
    const shipment: ProviderShipment | null = r
      ? {
          trackingNo: r.tracking_no,
          providerRef: `SIM-${r.id.slice(0, 8)}`,
          status: r.status,
          lockerEligible: r.locker_eligible,
          recipient: { name: r.recipient_name, phone: r.recipient_phone, addressLine: r.address_line, postcode: r.postcode, simetownCode: r.simetown_code },
          parcel: { weightG: r.weight_g, dimensionsMm: r.length_mm && r.width_mm && r.height_mm ? [r.length_mm, r.width_mm, r.height_mm] : null },
          // Only a provider that tracks its couriers says who carries a shipment.
          ...(company.can_confirm_assignment ? { assignedCourierRef: r.assigned_courier_ref } : {}),
        }
      : null;
    return { ok: true, shipment, latencyMs: Date.now() - started };
  },
  async reportDeposited(db, company, trackingNo) {
    if (company.sim_outage) return false;
    await db.query(`UPDATE sim_shipments SET status = 'DELIVERED' WHERE company_id = $1 AND tracking_no = $2`, [company.id, trackingNo]);
    return true;
  },
};

const gatewayShipment = z.object({
  trackingNo: z.string().min(4).max(40),
  providerRef: z.string().min(1).max(80),
  status: z.enum(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'RETURNED']),
  lockerEligible: z.boolean(),
  recipient: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().max(20).nullable(),
    addressLine: z.string().min(1).max(300),
    postcode: z.string().max(10).nullable(),
    simetownCode: z.string().max(12).nullable(),
  }),
  parcel: z.object({ weightG: z.number().int().nonnegative().nullable(), dimensionsMm: z.tuple([z.number(), z.number(), z.number()]).nullable() }),
  assignedCourierRef: z.string().max(80).nullable().optional(),
});
const gatewayAnswer = z.object({ found: z.boolean(), shipment: gatewayShipment.optional() });

function secretFrom(envName: string | null): string | null {
  return envName ? process.env[envName] ?? null : null;
}

async function signedPost(company: CompanyRow, path: string, payload: unknown) {
  const secret = secretFrom(company.provider_secret_env);
  if (!secret || secret.length < 32) throw new Error(`The secret ${company.provider_secret_env ?? '(none)'} is not set.`);
  const body = JSON.stringify(payload);
  const ts = new Date().toISOString();
  return fetch(`${company.provider_url!.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-simetown-timestamp': ts, 'x-simetown-signature': createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex') },
    body,
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
}

const gateway: ShipmentProviderAdapter = {
  simulated: false,
  async lookup(_db, company, trackingNo, now) {
    const started = Date.now();
    try {
      const response = await signedPost(company, '/shipments/lookup', { trackingNo, requestedAt: now.toISOString() });
      if (!response.ok) return { ok: false, error: `The provider answered ${response.status}.`, latencyMs: Date.now() - started };
      const parsed = gatewayAnswer.safeParse(await response.json());
      if (!parsed.success) return { ok: false, error: 'The provider sent an answer SimeTown does not understand.', latencyMs: Date.now() - started };
      const s = parsed.data.found ? parsed.data.shipment : undefined;
      if (parsed.data.found && !s) return { ok: false, error: 'The provider said "found" without the shipment.', latencyMs: Date.now() - started };
      // The provider must answer about the shipment that was asked for.
      if (s && s.trackingNo.toUpperCase() !== trackingNo) return { ok: false, error: 'The provider answered about a different shipment.', latencyMs: Date.now() - started };
      const shipment: ProviderShipment | null = s
        ? { ...s, trackingNo: s.trackingNo.toUpperCase(), ...(company.can_confirm_assignment ? { assignedCourierRef: s.assignedCourierRef ?? null } : { assignedCourierRef: undefined }) }
        : null;
      return { ok: true, shipment, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, error: `The provider could not be reached: ${error instanceof Error ? error.message : String(error)}`, latencyMs: Date.now() - started };
    }
  },
  async reportDeposited(_db, company, trackingNo, now) {
    try {
      const response = await signedPost(company, '/shipments/deposited', { trackingNo, depositedAt: now.toISOString() });
      return response.ok;
    } catch (error) {
      log.warn('Could not tell the courier company about a deposit', { company: company.id, error: String(error) });
      return false;
    }
  },
};

export function providerFor(company: CompanyRow): ShipmentProviderAdapter | null {
  return company.provider_mode === 'SIMULATED' ? simulated : company.provider_mode === 'GATEWAY' ? gateway : null;
}

/** Records how the provider answered, for the integration health panel. */
export async function recordProviderHealth(db: Db, companyId: string, result: LookupResult, now: Date) {
  await db.query(
    'UPDATE courier_companies SET provider_checked_at = $2, provider_ok = $3, provider_error = $4, provider_latency_ms = $5 WHERE id = $1',
    [companyId, now, result.ok, result.ok ? null : result.error, result.latencyMs],
  );
}

const MAX_NOTIFY_ATTEMPTS = 6;

/**
 * Tells courier companies about deposits they have not heard of yet, retrying
 * with a limit. Run by the "couriers" job; a deposit is complete whether or not
 * the company has been told.
 */
export async function notifyProviders(db: Db, now: Date): Promise<{ notified: number; failed: number }> {
  const pending = await db.query<{ id: string; tracking_no: string; company_id: string }>(
    `SELECT id, tracking_no, company_id FROM courier_shipments
      WHERE deposited_at IS NOT NULL AND provider_notified_at IS NULL AND notify_attempts < $1 ORDER BY deposited_at LIMIT 100`,
    [MAX_NOTIFY_ATTEMPTS],
  );
  let notified = 0;
  let failed = 0;
  for (const p of pending) {
    const company = (await one<CompanyRow>(db, 'SELECT * FROM courier_companies WHERE id = $1', [p.company_id]))!;
    const provider = providerFor(company);
    const ok = provider ? await provider.reportDeposited(db, company, p.tracking_no, now) : true;
    await db.query(
      'UPDATE courier_shipments SET notify_attempts = notify_attempts + 1, provider_notified_at = CASE WHEN $2 THEN $3::timestamptz ELSE NULL END WHERE id = $1',
      [p.id, ok, now],
    );
    if (ok) notified++;
    else failed++;
  }
  return { notified, failed };
}
