import { randomUUID } from 'node:crypto';
import { ADMINS } from '@/shared/domain';
import { one, type Db } from '../../db/client';
import type { Actor } from '../../auth/actor';
import { forbidden, notFound } from '../../errors';
import { getConfig } from '../../config';
import { applyDirectoryChange } from './federation';
import type { ProviderShipmentStatus } from './types';

/**
 * The console's view of the simulated courier companies, for the demo: their
 * fictional shipments (with what each one shows), their staff directories, and
 * switches that act as the companies themselves would. None of this exists for
 * a real company: there, the company's own system holds this data.
 */

function assertDemo(actor: Actor) {
  if (getConfig().APP_ENV === 'production') throw notFound('Simulated courier companies');
  if (!ADMINS.includes(actor.role) && actor.role !== 'TOWNSHIP_STAFF') throw forbidden();
}

export async function simulatedOverview(db: Db, actor: Actor) {
  assertDemo(actor);
  const companies = await db.query<{ id: string; name: string; code: string; sim_outage: boolean; provider_mode: string; idp_mode: string | null; can_confirm_assignment: boolean }>(
    `SELECT id, name, code, sim_outage, provider_mode, idp_mode, can_confirm_assignment FROM courier_companies WHERE provider_mode = 'SIMULATED' OR idp_mode = 'SIMULATED' ORDER BY name`,
  );
  const shipments = await db.query(
    `SELECT s.id, s.company_id, s.tracking_no, s.status, s.locker_eligible, s.recipient_name, s.address_line, s.assigned_courier_ref, s.demo_case,
            (SELECT x.deposited_at FROM courier_shipments x WHERE x.company_id = s.company_id AND x.tracking_no = s.tracking_no) AS deposited_at
       FROM sim_shipments s WHERE s.company_id = ANY($1::uuid[]) ORDER BY s.tracking_no`,
    [companies.map((c) => c.id)],
  );
  const directory = await db.query(
    `SELECT d.company_id, d.employee_ref, d.full_name, d.active,
            (SELECT a.status FROM courier_accounts a WHERE a.company_id = d.company_id AND a.employee_ref = d.employee_ref) AS simetown_status
       FROM sim_directory d WHERE d.company_id = ANY($1::uuid[]) ORDER BY d.full_name`,
    [companies.map((c) => c.id)],
  );
  return { companies, shipments, directory };
}

/** Acts as the simulated company changing a shipment's status in its own system. */
export async function setSimulatedShipment(db: Db, actor: Actor, id: string, input: { status: ProviderShipmentStatus }) {
  assertDemo(actor);
  const rows = await db.query('UPDATE sim_shipments SET status = $2 WHERE id = $1 RETURNING id', [id, input.status]);
  if (rows.length === 0) throw notFound('Simulated shipment');
  return { ok: true };
}

/**
 * Acts as the simulated company suspending or reactivating one of its own
 * staff: its sign-in refuses them, and it tells SimeTown, which suspends them
 * here at once, through the same path a real company's signed message takes.
 */
export async function setSimulatedEmployee(db: Db, actor: Actor, companyId: string, employeeRef: string, active: boolean, now: Date) {
  assertDemo(actor);
  const company = await one<{ id: string; name: string }>(db, 'SELECT id, name FROM courier_companies WHERE id = $1', [companyId]);
  if (!company) throw notFound('Courier company');
  const rows = await db.query('UPDATE sim_directory SET active = $3 WHERE company_id = $1 AND employee_ref = $2 RETURNING employee_ref', [companyId, employeeRef, active]);
  if (rows.length === 0) throw notFound('Employee');
  return applyDirectoryChange(db, company, { employeeRef, active, eventId: `sim-${randomUUID()}` }, now);
}

/**
 * Printable demo shipping labels for the simulated companies' fictional
 * shipments, to scan with a phone or a USB scanner. The barcode carries only the
 * tracking number; the recipient printed on the label is what the fictional
 * shop printed, and SimeTown never reads it from the barcode. Demo only.
 */
export async function demoLabels(db: Db) {
  if (getConfig().APP_ENV === 'production') throw notFound('Demo labels');
  const rows = await db.query<Record<string, unknown>>(
    `SELECT s.tracking_no, s.status, s.locker_eligible, s.recipient_name, s.address_line, s.postcode, s.weight_g, s.length_mm, s.width_mm, s.height_mm, s.demo_case,
            c.name AS company, c.code AS company_code, coalesce(d.full_name, s.assigned_courier_ref) AS carried_by,
            (SELECT x.deposited_at IS NOT NULL FROM courier_shipments x WHERE x.company_id = s.company_id AND x.tracking_no = s.tracking_no) AS deposited
       FROM sim_shipments s JOIN courier_companies c ON c.id = s.company_id
       LEFT JOIN sim_directory d ON d.company_id = s.company_id AND d.employee_ref = s.assigned_courier_ref
      ORDER BY c.name, s.tracking_no`,
  );
  // A label whose shipment the company has no record of: it looks right, and still opens nothing.
  const jnt = await one<{ name: string; code: string }>(db, `SELECT name, code FROM courier_companies WHERE code = 'JNT' AND provider_mode = 'SIMULATED'`);
  if (jnt) {
    rows.push({
      tracking_no: 'JTSIM99999999', status: 'UNKNOWN', locker_eligible: true, recipient_name: 'Aisyah Rahman', address_line: 'No. 1, Jalan Metafasa U16/171, Elmina Valley 1, 40160 Shah Alam, Selangor',
      postcode: '40160', weight_g: null, length_mm: null, width_mm: null, height_mm: null, company: jnt.name, company_code: jnt.code, carried_by: null, deposited: false,
      demo_case: 'Unknown shipment: a well-formed tracking number J&T has no record of (a made-up or copied label). It is refused and no door opens.',
    });
  }
  return rows;
}
