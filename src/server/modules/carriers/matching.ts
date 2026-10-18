import { normalizePhone } from '@/shared/domain';
import { one, type Queryable } from '../../db/client';
import type { MatchResult, ProviderShipment } from './types';

/**
 * Matching a shipment to a SimeTown household, from what the courier company
 * says about its recipient. In order of trust:
 *
 *   1. the resident's own SimeTown delivery code, when the shop has it;
 *   2. a verified phone number, with a compatible name and address;
 *   3. the address (house or unit, street, building, postcode), with a compatible name.
 *
 * A name alone never matches, and a choice between two households is never made
 * automatically. The courier only ever sees masked details, and what is kept is
 * which details agreed, not the details themselves.
 */

const HONORIFICS = new Set(['bin', 'binti', 'bte', 'bt', 'mrs', 'miss', 'encik', 'puan', 'tuan', 'cik', 'mr', 'ms', 'dr', 'haji', 'hajah', 'datuk', 'dato', 'datin', 'a/l', 'a/p']);

/** The words of a name worth comparing: three letters or more, without titles. */
export const nameWords = (name: string) =>
  new Set(name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !HONORIFICS.has(w)));

export const namesCompatible = (a: string, b: string) => {
  const x = nameWords(a);
  return [...nameWords(b)].some((w) => x.has(w));
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bjln\b/g, 'jalan'], [/\blrg\b/g, 'lorong'], [/\bpsn\b/g, 'persiaran'], [/\btmn\b/g, 'taman'], [/\bkg\b/g, 'kampung'],
  [/\bblk\b/g, 'block'], [/\bblok\b/g, 'block'], [/\bppr\b/g, 'pangsapuri'], [/\bapt\b/g, 'apartment'], [/\bkondo\b/g, 'condominium'],
  [/\bno\b\.?/g, ' no '], [/\bunit\b/g, ' no '], [/\blot\b/g, ' no '],
];

/** An address as lower-case words, abbreviations spelt out, punctuation (except / and -) removed. */
export function normaliseAddress(text: string): string {
  let s = ` ${text.toLowerCase().normalize('NFKD')} `.replace(/[,.()#]/g, ' ');
  for (const [pattern, word] of ABBREVIATIONS) s = s.replace(pattern, word);
  return s.replace(/\s+/g, ' ').trim();
}

const postcodeOf = (text: string) => /\b(\d{5})\b/.exec(text)?.[1] ?? null;

/** House and unit numbers in an address: "no 12", "12a", "a-02-01", "a 02 01". */
function numbersIn(address: string): Set<string> {
  const out = new Set<string>();
  const unit = /\b([a-z]{1,2})\s*-?\s*(\d{1,3})\s*-\s*(\d{1,3})\b/g;
  for (const m of address.matchAll(unit)) out.add(`${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`);
  for (const m of address.matchAll(/(?:^|\bno\s+)([0-9]{1,5}[a-z]?)\b/g)) out.add(m[1]!);
  return out;
}

const normaliseHouseNo = (houseNo: string) => {
  const unit = /^([a-z]{1,2})\s*-?\s*(\d{1,3})\s*-\s*(\d{1,3})$/i.exec(houseNo.trim());
  return unit ? `${unit[1]!.toLowerCase()}-${unit[2]!.padStart(2, '0')}-${unit[3]!.padStart(2, '0')}` : houseNo.trim().toLowerCase();
};

interface HomeRow {
  id: string;
  house_no: string | null;
  street: string;
  building: string | null;
  postcode: string | null;
}

/** Homes in the township this address could be. More than one means the address is not precise enough. */
export async function homesForAddress(q: Queryable, townshipId: string, addressLine: string, postcode: string | null): Promise<{ homes: HomeRow[]; outside: boolean }> {
  const address = normaliseAddress(addressLine);
  const code = postcode ?? postcodeOf(addressLine);
  const known = await q.query<{ postcode: string }>('SELECT DISTINCT postcode FROM homes WHERE township_id = $1 AND postcode IS NOT NULL', [townshipId]);
  if (code && known.length > 0 && !known.some((k) => k.postcode === code)) return { homes: [], outside: true };
  const streets = (await q.query<{ street: string }>('SELECT DISTINCT street FROM homes WHERE township_id = $1', [townshipId]))
    .map((r) => r.street)
    .filter((street) => address.includes(normaliseAddress(street)));
  if (streets.length === 0) return { homes: [], outside: false };
  const numbers = numbersIn(address);
  const candidates = await q.query<HomeRow>(
    'SELECT id, house_no, street, building, postcode FROM homes WHERE township_id = $1 AND street = ANY($2::text[]) AND house_no IS NOT NULL',
    [townshipId, streets],
  );
  const homes = candidates.filter((h) => {
    if (!numbers.has(normaliseHouseNo(h.house_no!))) return false;
    if (h.building && !address.includes(normaliseAddress(h.building).replace(/\bblock [a-z0-9]+$/, '').trim())) return false;
    return !(code && h.postcode && h.postcode !== code);
  });
  return { homes, outside: false };
}

interface ResidentRow {
  id: string;
  home_id: string;
  full_name: string;
}

const RESIDENT = `u.role = 'RESIDENT' AND u.residency_status = 'VERIFIED' AND u.status = 'ACTIVE'`;

/** A masked name: "Aisyah Rahman" becomes "A••••h R••••n". */
export function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => (w.length <= 2 ? `${w[0]}•` : `${w[0]}${'•'.repeat(Math.min(5, w.length - 2))}${w[w.length - 1]}`)).join(' ');
}

/** A masked address: numbers and codes stay, so the courier can check the label; words are masked. */
export function maskAddress(address: string): string {
  return address
    .split(/(\s+|,)/)
    .map((part) => (/\d/.test(part) || part.trim().length <= 2 ? part : `${part[0]}${'•'.repeat(Math.min(4, part.length - 1))}`))
    .join('')
    .slice(0, 80);
}

export async function matchResident(q: Queryable, townshipId: string, recipient: ProviderShipment['recipient']): Promise<MatchResult> {
  const masked = { name: maskName(recipient.name), address: maskAddress(recipient.addressLine) };
  const fail = (reason: MatchResult['reason'], evidence: string[] = []): MatchResult => ({ matched: false, method: null, homeId: null, recipientUserId: null, evidence, reason, masked });

  // 1. The resident's own delivery code: what they chose to give the shop.
  if (recipient.simetownCode) {
    const r = await one<ResidentRow>(
      q, `SELECT u.id, u.home_id, u.full_name FROM users u WHERE u.member_code = $1 AND u.township_id = $2 AND ${RESIDENT}`, [recipient.simetownCode.trim().toUpperCase(), townshipId],
    );
    if (r) {
      const evidence = ['SimeTown delivery code', ...(namesCompatible(r.full_name, recipient.name) ? ['name'] : [])];
      return { matched: true, method: 'MEMBER_CODE', homeId: r.home_id, recipientUserId: r.id, evidence, reason: null, masked };
    }
  }

  const { homes, outside } = await homesForAddress(q, townshipId, recipient.addressLine, recipient.postcode);
  if (outside) return fail('OUTSIDE_TOWNSHIP', ['postcode']);

  // 2. A verified phone number, with a name and an address that agree.
  const phone = recipient.phone ? normalizePhone(recipient.phone) : null;
  if (phone) {
    const byPhone = await q.query<ResidentRow>(`SELECT u.id, u.home_id, u.full_name FROM users u WHERE u.phone = $1 AND u.township_id = $2 AND ${RESIDENT}`, [phone, townshipId]);
    const agreed = byPhone.filter((r) => namesCompatible(r.full_name, recipient.name) && homes.some((h) => h.id === r.home_id));
    const households = new Set(agreed.map((r) => r.home_id));
    if (households.size === 1) {
      const only = agreed.length === 1 ? agreed[0]!.id : null;
      return { matched: true, method: 'PHONE_NAME_ADDRESS', homeId: agreed[0]!.home_id, recipientUserId: only, evidence: ['phone', 'name', 'address'], reason: null, masked };
    }
  }

  // 3. The address, with a name that agrees with someone who lives there.
  if (homes.length === 0) return fail('NOT_REGISTERED');
  if (homes.length > 1) return fail('AMBIGUOUS', ['address']);
  const home = homes[0]!;
  const living = await q.query<ResidentRow>(`SELECT u.id, u.home_id, u.full_name FROM users u WHERE u.home_id = $1 AND ${RESIDENT}`, [home.id]);
  if (living.length === 0) return fail('NOT_REGISTERED', ['address']);
  const named = living.filter((r) => namesCompatible(r.full_name, recipient.name));
  if (named.length === 0) return fail('NAME_MISMATCH', ['address']);
  return {
    matched: true, method: 'ADDRESS_NAME', homeId: home.id, recipientUserId: named.length === 1 ? named[0]!.id : null,
    evidence: ['address', 'name', ...(recipient.postcode || postcodeOf(recipient.addressLine) ? ['postcode'] : [])], reason: null, masked,
  };
}
