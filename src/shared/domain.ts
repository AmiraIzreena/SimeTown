/** Vocabulary shared by the server and the screens. No logic that needs a database lives here. */

export const ROLES = ['RESIDENT', 'MERCHANT', 'SPONSOR', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Township staff and above. */
export const STAFF: Role[] = ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'];
/** People who may approve accounts, move money in the ledger and change set-up. */
export const ADMINS: Role[] = ['TOWNSHIP_ADMIN', 'HQ_ADMIN'];

export const ROLE_LABELS: Record<Role, string> = {
  RESIDENT: 'Resident',
  MERCHANT: 'Shop',
  SPONSOR: 'Sponsor',
  TOWNSHIP_STAFF: 'Township staff',
  TOWNSHIP_ADMIN: 'Township admin',
  HQ_ADMIN: 'SDP HQ admin',
};

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  RESIDENT: '/app',
  MERCHANT: '/merchant',
  SPONSOR: '/sponsor',
  TOWNSHIP_STAFF: '/console',
  TOWNSHIP_ADMIN: '/console',
  HQ_ADMIN: '/console',
};

/** Verified actions that earn Impact XP. Rates and limits live in the activity_rules table. */
export const ACTIVITIES = [
  'JIRAN_EVENT',
  'JIRAN_HELP',
  'KONGSI_SHARE',
  'LAPOR_REPORT',
  'GERAK_CHECKIN',
  'GERAK_LOOP',
  'KITAR_DROPOFF',
  'JIMAT_READING',
  'JIMAT_SAVER',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const POST_TYPES = ['EVENT', 'HELP', 'GIVE', 'LEND'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const REPORT_CATEGORIES = ['POTHOLE', 'LIGHTING', 'DRAINAGE', 'WASTE', 'ACCESS_BARRIER', 'SAFETY', 'OTHER'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  POTHOLE: 'Pothole or road damage',
  LIGHTING: 'Lighting',
  DRAINAGE: 'Blocked drain',
  WASTE: 'Rubbish or dumping',
  ACCESS_BARRIER: 'Access barrier',
  SAFETY: 'Safety hazard',
  OTHER: 'Something else',
};

export const URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const REPORT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const MATERIALS = ['PLASTIC_PET', 'PLASTIC_OTHER', 'PAPER', 'GLASS', 'ALUMINIUM', 'E_WASTE', 'TEXTILE', 'COOKING_OIL'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL_INFO: Record<Material, { label: string; tip: string }> = {
  PLASTIC_PET: { label: 'Plastic, PET', tip: 'Empty it, rinse it and put the cap back on.' },
  PLASTIC_OTHER: { label: 'Plastic, other', tip: 'Clean and dry. Leave out cling film and foam boxes.' },
  PAPER: { label: 'Paper and cardboard', tip: 'Flatten boxes. Keep it dry and free of food.' },
  GLASS: { label: 'Glass', tip: 'Rinse bottles and jars. Wrap anything broken.' },
  ALUMINIUM: { label: 'Aluminium and tins', tip: 'Rinse and crush cans to save space.' },
  E_WASTE: { label: 'E-waste', tip: 'Remove batteries where you can. Do not break screens.' },
  TEXTILE: { label: 'Clothes and textiles', tip: 'Clean and dry, in a tied bag.' },
  COOKING_OIL: { label: 'Used cooking oil', tip: 'Cool it, strain it and bring it in a sealed bottle.' },
};

export type FloodStatus = 'NORMAL' | 'WARNING' | 'DANGER';

/** Impact XP needed to reach each level. Level n starts at 50·n·(n−1) XP. */
export const LEVEL_NAMES = ['Newcomer', 'Neighbour', 'Helper', 'Champion', 'Guardian', 'Township Hero'] as const;

export function levelFor(xp: number): { level: number; name: string; floor: number; next: number } {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  return {
    level,
    name: LEVEL_NAMES[Math.min(level, LEVEL_NAMES.length) - 1]!,
    floor: 50 * level * (level - 1),
    next: 50 * (level + 1) * level,
  };
}

// --- Addresses and phone numbers ------------------------------------------------

/** Malaysia's 13 states and 3 federal territories, as written on an address. */
export const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak',
  'Selangor', 'Terengganu', 'Wilayah Persekutuan Kuala Lumpur', 'Wilayah Persekutuan Labuan', 'Wilayah Persekutuan Putrajaya',
] as const;
export type MalaysianState = (typeof MALAYSIAN_STATES)[number];

export interface HomeAddress {
  property_type: 'LANDED' | 'HIGHRISE';
  /** A house number ("12"), or a high-rise unit in block-floor-unit form ("A-03-07"). */
  house_no: string | null;
  /** High-rise only: the building, such as "Residensi KITA". */
  building: string | null;
  street: string;
  /** The precinct or phase inside the township, such as "Elmina Valley 2". */
  precinct: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
}

/** Everything a postal address needs is there. */
export const isCompleteAddress = (a: HomeAddress) =>
  Boolean(a.house_no && a.street && a.postcode && a.city && a.state && (a.property_type === 'LANDED' || a.building));

/** The first line, for lists: "No. 12, Jalan Kenanga 1/KT1" or "A-03-07, Residensi KITA". */
export const shortAddress = (a: HomeAddress) =>
  a.property_type === 'HIGHRISE' ? [a.house_no, a.building].filter(Boolean).join(', ') : [a.house_no && `No. ${a.house_no}`, a.street].filter(Boolean).join(', ');

/**
 * A home written as Malaysian post is addressed, in the order Sime Darby Property
 * townships are laid out: house (or unit and building), street, precinct or phase,
 * then postcode, city and state.
 *   No. 12, Jalan Kenanga 1/KT1, Precinct Kenanga, 41050 Klang, Selangor
 *   A-03-07, Residensi KITA, Jalan Melur 2/KT2, Precinct Melur, 41050 Klang, Selangor
 */
export function formatAddress(a: HomeAddress): string {
  const first = a.property_type === 'HIGHRISE' ? [a.house_no, a.building] : [a.house_no && `No. ${a.house_no}`];
  const town = [a.postcode, a.city].filter(Boolean).join(' ');
  return [...first, a.street, a.precinct, town, a.state].filter(Boolean).join(', ');
}

/**
 * A phone number in international (E.164) form, the way it is stored: "012-345 6789"
 * and "+60 12 345 6789" both become "+60123456789". Malaysian numbers are checked
 * against the national plan; others only for shape. Returns null if it is not valid.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.trim().replace(/[\s().-]/g, '');
  const international = digits.startsWith('+') ? digits : digits.startsWith('0') ? `+60${digits.slice(1)}` : digits.startsWith('60') ? `+${digits}` : null;
  if (!international) return null;
  if (international.startsWith('+60')) return /^\+60(1\d{8,9}|[3-9]\d{7,8})$/.test(international) ? international : null;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}

/** "+60123456789" as people write it: "+60 12-345 6789". Other numbers are shown as stored. */
export function formatPhone(e164: string): string {
  const mobile = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  return mobile ? `+60 ${mobile[1]}-${mobile[2]} ${mobile[3]}` : e164;
}

/** 100 points = RM1, so one point is one sen. */
export const formatRM = (sen: number) =>
  `RM${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatPoints = (points: number) => points.toLocaleString('en-MY');
