import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  CITIZENSHIP_LABELS, idLast4, licenceExpired, missingVisitorDetails, normaliseIdNumber, TRANSPORT_INFO, VISIT_REASON_LABELS,
  type Citizenship, type TransportMode, type VisitorDetail, type VisitReason,
} from '@/shared/domain';
import { getConfig } from '../../config';
import { fieldErrors, ruleViolation } from '../../errors';

/**
 * Visitor details (BR26, revised): checked the same way wherever they are given, and the identity number kept
 * encrypted. AES-256-GCM with a key from VISITOR_DATA_KEY, never stored in the database, so a copy of the database
 * alone does not reveal anyone's number. Only the last 4 characters are kept readable. Development and tests use a
 * fixed stand-in key; a hosted copy (staging or production) refuses to store a number without the real key rather
 * than store it weakly.
 */

const DEV_KEY = 'simetown-development-visitor-data-key-not-for-production';
const VERSION = 'v1';

function key(): Buffer {
  const config = getConfig();
  // The fallback is public (it is in the code): only for development on your own computer, never when hosted.
  const secret = config.VISITOR_DATA_KEY ?? (config.APP_ENV === 'development' ? DEV_KEY : null);
  if (!secret) throw ruleViolation('VISITOR_DATA_NOT_CONFIGURED', 'Visitor details cannot be saved yet: the township office must finish setting up SimeTown (VISITOR_DATA_KEY).');
  return createHash('sha256').update(secret).digest();
}

export function encryptIdNumber(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** The full number, for the guard at the gate only. Null if it cannot be read (for example after a key change). */
export function decryptIdNumber(stored: string | null): string | null {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Details as a form sends them. Any may be missing; what is required depends on who gives them and when. */
export interface DetailsInput {
  citizenship?: Citizenship;
  idNumber?: string;
  transport?: TransportMode;
  vehicleNo?: string;
  licenceExpiry?: string;
  reason?: VisitReason;
  reasonOther?: string;
}

/** Details as stored, on a pass or a visit. */
export interface StoredDetails {
  citizenship: Citizenship | null;
  id_number_enc: string | null;
  id_last4: string | null;
  transport: TransportMode | null;
  vehicle_no: string | null;
  licence_expiry: string | null;
  reason: VisitReason | null;
  reason_other: string | null;
}

export const DETAIL_COLUMNS = 'citizenship, id_number_enc, id_last4, transport, vehicle_no, licence_expiry::text AS licence_expiry, reason, reason_other';

/**
 * Checks what was given and merges it over what is already stored. Field errors come back the way forms show them.
 * The identity number is checked against the citizenship it comes with; a licence that has expired is refused.
 */
export function mergeDetails(stored: StoredDetails | null, input: DetailsInput, today: string): StoredDetails {
  const fields: Record<string, string> = {};
  const next: StoredDetails = stored ? { ...stored } : {
    citizenship: null, id_number_enc: null, id_last4: null, transport: null, vehicle_no: null, licence_expiry: null, reason: null, reason_other: null,
  };
  if (input.citizenship !== undefined || input.idNumber !== undefined) {
    if (!input.citizenship) fields.citizenship = 'Choose the visitor’s citizenship.';
    else if (!input.idNumber?.trim()) fields.idNumber = 'Enter the identity number.';
    else {
      const id = normaliseIdNumber(input.citizenship, input.idNumber);
      if (!id.ok) fields.idNumber = id.error;
      else {
        next.citizenship = input.citizenship;
        next.id_number_enc = encryptIdNumber(id.value);
        next.id_last4 = idLast4(id.value);
      }
    }
  }
  if (input.transport !== undefined) {
    next.transport = input.transport;
    if (!TRANSPORT_INFO[input.transport].vehicle) next.vehicle_no = null;
    if (!TRANSPORT_INFO[input.transport].licence) next.licence_expiry = null;
  }
  // With no transport yet (the Assistant, older passes) a vehicle number is kept as given.
  if (input.vehicleNo !== undefined && (!next.transport || TRANSPORT_INFO[next.transport].vehicle)) next.vehicle_no = input.vehicleNo.trim().toUpperCase() || null;
  if (input.licenceExpiry !== undefined && next.transport && TRANSPORT_INFO[next.transport].licence) {
    if (!input.licenceExpiry) next.licence_expiry = null;
    else if (licenceExpired(input.licenceExpiry, today)) fields.licenceExpiry = 'This driving licence has expired. A visitor cannot drive in on it.';
    else next.licence_expiry = input.licenceExpiry;
  }
  if (input.reason !== undefined) {
    next.reason = input.reason;
    next.reason_other = input.reason === 'OTHER' ? input.reasonOther?.trim() || null : null;
    if (input.reason === 'OTHER' && !next.reason_other) fields.reasonOther = 'Say what the visit is for.';
  }
  if (Object.keys(fields).length > 0) throw fieldErrors(fields);
  return next;
}

/** Details with only the reason: for passes SimeTown makes itself, where the guard adds the rest at the gate. */
export const reasonOnly = (reason: VisitReason, other: string | null = null): StoredDetails => ({
  citizenship: null, id_number_enc: null, id_last4: null, transport: null, vehicle_no: null, licence_expiry: null, reason, reason_other: reason === 'OTHER' ? other : null,
});

export const missingOf = (d: StoredDetails) =>
  missingVisitorDetails({ citizenship: d.citizenship, hasId: Boolean(d.id_number_enc), transport: d.transport, vehicleNo: d.vehicle_no, licenceExpiry: d.licence_expiry, reason: d.reason });

/** Field errors for anything still missing, in the words the forms use. */
const MISSING_WORDS: Record<VisitorDetail, [string, string]> = {
  identity: ['idNumber', 'Enter the visitor’s citizenship and identity number.'],
  transport: ['transport', 'Choose how the visitor is travelling.'],
  vehicleNo: ['vehicleNo', 'Enter the vehicle number.'],
  licenceExpiry: ['licenceExpiry', 'Enter the driving licence’s expiry date.'],
  reason: ['reason', 'Choose the reason for the visit.'],
};
export function requireComplete(d: StoredDetails, allow: VisitorDetail[] = []) {
  const missing = missingOf(d).filter((m) => !allow.includes(m));
  if (missing.length > 0) throw fieldErrors(Object.fromEntries(missing.map((m) => MISSING_WORDS[m])));
}

/** What the household and the visitor's own link see: never the identity number, only its last 4 characters. */
export function maskedDetails(d: StoredDetails) {
  return {
    citizenship: d.citizenship,
    idLast4: d.id_last4,
    transport: d.transport,
    vehicleNo: d.vehicle_no,
    licenceExpiry: d.licence_expiry,
    reason: d.reason,
    reasonOther: d.reason_other,
  };
}

/** Plain words for an email or a notification: citizenship, transport and reason. Never the number. */
export function describeDetails(d: StoredDetails) {
  return {
    citizenship: d.citizenship ? CITIZENSHIP_LABELS[d.citizenship] : null,
    transport: d.transport ? TRANSPORT_INFO[d.transport].label : null,
    reason: d.reason === 'OTHER' ? d.reason_other : d.reason ? VISIT_REASON_LABELS[d.reason] : null,
    reasonIsOther: d.reason === 'OTHER',
  };
}
