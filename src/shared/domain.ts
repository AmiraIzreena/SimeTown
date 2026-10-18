/** Vocabulary shared by the server and the screens. No logic that needs a database lives here. */

export const ROLES = ['RESIDENT', 'MERCHANT', 'SPONSOR', 'GUARD', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Township staff and above. */
export const STAFF: Role[] = ['TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'];
/** People who may approve accounts, move money in the ledger and change set-up. */
export const ADMINS: Role[] = ['TOWNSHIP_ADMIN', 'HQ_ADMIN'];

export const ROLE_LABELS: Record<Role, string> = {
  RESIDENT: 'Resident',
  MERCHANT: 'Shop',
  SPONSOR: 'Sponsor',
  GUARD: 'Guard',
  TOWNSHIP_STAFF: 'Township staff',
  TOWNSHIP_ADMIN: 'Township admin',
  HQ_ADMIN: 'SDP HQ admin',
};

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  RESIDENT: '/app',
  MERCHANT: '/merchant',
  SPONSOR: '/sponsor',
  GUARD: '/guard',
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
  'GERAK_TRIP',
  'TAMAN_WATERING',
  'TAMAN_SIGHTING',
  'AKSES_UPDATE',
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

/** Where a flood signal comes from, and how far the Banjir agent trusts it (proposal 6.5). */
export const FLOOD_SOURCES = ['SENSOR', 'CAMERA', 'RAIN', 'REPORT'] as const;
export type FloodSource = (typeof FLOOD_SOURCES)[number];
export const FLOOD_SOURCE_LABELS: Record<FloodSource, string> = {
  SENSOR: 'Drain water-level sensor',
  CAMERA: 'CCTV picture read by AI',
  RAIN: 'Rain gauge',
  REPORT: 'Residents’ photo reports',
};

/**
 * The prototype's camera test set (proposal 6.5): pictures of a painted measuring
 * post in a drain, each with the true water level and what the image model read.
 * Accuracy is reported only as measured on this set. A reading below 0.6
 * confidence is not trusted as a signal.
 */
export const FLOOD_TEST_PICTURES = [
  { id: 'day-12', label: 'Daylight, low water', truePct: 12, readPct: 13, confidence: 0.94, night: false },
  { id: 'day-45', label: 'Daylight, rising after rain', truePct: 45, readPct: 43, confidence: 0.91, night: false },
  { id: 'day-78', label: 'Daylight, near the warning line', truePct: 78, readPct: 80, confidence: 0.88, night: false },
  { id: 'day-93', label: 'Daylight, above the danger line', truePct: 93, readPct: 92, confidence: 0.87, night: false },
  { id: 'glare-62', label: 'Glare on the water', truePct: 62, readPct: 67, confidence: 0.63, night: false },
  { id: 'night-88', label: 'Night, heavy rain', truePct: 88, readPct: 71, confidence: 0.46, night: true },
] as const;
export type FloodTestPictureId = (typeof FLOOD_TEST_PICTURES)[number]['id'];
export const CAMERA_MIN_CONFIDENCE = 0.6;

// --- Tamu: visitors -----------------------------------------------------------

export const PASS_TYPES = ['ONE_VISIT', 'REGULAR_HELPER', 'DELIVERY', 'EVENT', 'CONTRACTOR', 'CARER'] as const;
export type PassType = (typeof PASS_TYPES)[number];
/** How long each kind of pass may last, and how many entries it allows (null = any number within the dates). */
export const PASS_TYPE_INFO: Record<PassType, { label: string; maxDays: number; entries: number | null }> = {
  ONE_VISIT: { label: 'One visit', maxDays: 2, entries: 1 },
  REGULAR_HELPER: { label: 'Regular helper', maxDays: 90, entries: null },
  DELIVERY: { label: 'Delivery', maxDays: 1, entries: 1 },
  EVENT: { label: 'Event guest', maxDays: 2, entries: null },
  CONTRACTOR: { label: 'Contractor', maxDays: 30, entries: null },
  CARER: { label: 'Carer', maxDays: 90, entries: null },
};
export const HOST_REPLIES = ['EXPECTED', 'NOT_EXPECTED', 'CALL_ME'] as const;
export type HostReply = (typeof HOST_REPLIES)[number];

// --- SimeTown Home: home services ----------------------------------------------

/** What a business account offers: a shop (points, offers), home services, or both. */
export const MERCHANT_KINDS = ['RETAIL', 'SERVICES', 'BOTH'] as const;
export type MerchantKind = (typeof MERCHANT_KINDS)[number];
export const MERCHANT_KIND_LABELS: Record<MerchantKind, string> = { RETAIL: 'Shop', SERVICES: 'Home services', BOTH: 'Shop and home services' };
export const merchantKind = (m: { offersRetail: boolean; offersServices: boolean }): MerchantKind =>
  m.offersRetail && m.offersServices ? 'BOTH' : m.offersServices ? 'SERVICES' : 'RETAIL';

export const SERVICE_CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'AIRCON', 'CLEANING', 'REPAIRS', 'RENOVATION'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  AIRCON: 'Air-conditioning',
  CLEANING: 'Cleaning',
  REPAIRS: 'Repairs',
  RENOVATION: 'Renovation',
};

/** How a company prices a job. The price itself is agreed in person; SimeTown takes no payment. */
/** Services that come round again: the home logbook reminds the home this many days after the last one. */
export const SERVICE_REMINDER_DAYS: Partial<Record<ServiceCategory, number>> = { AIRCON: 180 };
/** A reminder turns "due soon" this many days before it is due. */
export const SERVICE_DUE_SOON_DAYS = 21;

export const SERVICE_PRICING = ['FIXED', 'INSPECTION', 'QUOTE'] as const;
export type ServicePricing = (typeof SERVICE_PRICING)[number];
export const SERVICE_PRICING_LABELS: Record<ServicePricing, string> = {
  FIXED: 'Fixed price',
  INSPECTION: 'Price after inspection',
  QUOTE: 'Site visit and quotation',
};

export const SERVICE_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type ServiceSlot = (typeof SERVICE_SLOTS)[number];
export const SERVICE_SLOT_LABELS: Record<ServiceSlot, string> = { MORNING: 'Morning (9am to 12pm)', AFTERNOON: 'Afternoon (12pm to 5pm)', EVENING: 'Evening (5pm to 8pm)' };

export const BOOKING_STATUSES = ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED', 'DECLINED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  REQUESTED: 'Waiting for the company',
  ACCEPTED: 'Visit confirmed',
  SCHEDULED: 'Worker assigned',
  IN_PROGRESS: 'Worker on site',
  WORK_DONE: 'Waiting for your confirmation',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};
/** Bookings that are still going on. */
export const OPEN_BOOKING_STATUSES: readonly BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'WORK_DONE'];

export const SERVICE_REPORT_CATEGORIES = ['HARASSMENT', 'MISCONDUCT', 'NO_SHOW', 'POOR_WORK', 'PRICING', 'OTHER'] as const;
export type ServiceReportCategory = (typeof SERVICE_REPORT_CATEGORIES)[number];
export const SERVICE_REPORT_CATEGORY_LABELS: Record<ServiceReportCategory, string> = {
  HARASSMENT: 'Harassment or threatening behaviour',
  MISCONDUCT: 'Other misconduct',
  NO_SHOW: 'Nobody came',
  POOR_WORK: 'Poor or unsafe work',
  PRICING: 'Price different from what was agreed',
  OTHER: 'Something else',
};
export const SERVICE_REPORT_STATUSES = ['NEW', 'REVIEWING', 'CLOSED'] as const;
export type ServiceReportStatus = (typeof SERVICE_REPORT_STATUSES)[number];

// --- Sponsors -----------------------------------------------------------------

// The stored codes predate the three-tier proposal and are kept so the shared
// database needs no migration: Peneraju is sold at two prices, stored as
// GREEN_CHAMPION (RM60,000) and TITLE_PARTNER (RM120,000, one at a time).
export const SPONSOR_TIERS = ['COMMUNITY_FRIEND', 'TOWNSHIP_PARTNER', 'GREEN_CHAMPION', 'TITLE_PARTNER'] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];
/** The tiers shown to the public, one card each. */
export const PUBLIC_SPONSOR_TIERS: readonly SponsorTier[] = ['COMMUNITY_FRIEND', 'TOWNSHIP_PARTNER', 'GREEN_CHAMPION'];
export const PENERAJU_TIERS: readonly SponsorTier[] = ['GREEN_CHAMPION', 'TITLE_PARTNER'];
const PENERAJU_BENEFITS = ['Everything in Rakan Township', 'The only brand in its category', 'Naming rights on a flagship programme', 'Branding on every machine', 'First position on the guest page', 'One in-app pop-up a quarter, never email, SMS or push (from the pilot)', 'A joint yearly impact report', 'First right to renew'];
/** The proposal's three tiers (Appendix D.2). Fees are placeholders to test with real brands in the pilot. */
export const SPONSOR_TIER_INFO: Record<SponsorTier, { label: string; feeSen: number; feeToSen?: number; challenges: number | null; benefits: string[] }> = {
  COMMUNITY_FRIEND: {
    label: 'Rakan Komuniti',
    feeSen: 600_000,
    challenges: 1,
    benefits: ['Logo on the Partners page', 'One sponsored challenge a year', 'One booth day at a township event', 'An impact certificate', 'Can register as a point-redemption partner', 'About RM2,000 a year when bundled into an SDP retail lease'],
  },
  TOWNSHIP_PARTNER: {
    label: 'Rakan Township',
    feeSen: 2_000_000,
    challenges: 4,
    benefits: ['Everything in Rakan Komuniti', 'A rotating banner on the guest page and home screen', 'Four challenges a year', 'Screen time on the recycling machines', 'Four booth days', 'A grouped report each quarter', 'A swipeable voucher ad slot (from the pilot)', 'Priority placement in the shop directory (from the pilot)'],
  },
  GREEN_CHAMPION: {
    label: 'Peneraju',
    feeSen: 6_000_000,
    feeToSen: 12_000_000,
    challenges: null,
    benefits: PENERAJU_BENEFITS,
  },
  TITLE_PARTNER: {
    label: 'Peneraju',
    feeSen: 12_000_000,
    challenges: null,
    benefits: PENERAJU_BENEFITS,
  },
};

// --- Akses+ -------------------------------------------------------------------

export const ACCESS_NEEDS = ['MOBILITY', 'VISION', 'HEARING', 'COGNITIVE', 'ELDERLY'] as const;
export type AccessNeed = (typeof ACCESS_NEEDS)[number];
export const ACCESS_NEED_LABELS: Record<AccessNeed, string> = {
  MOBILITY: 'I use a wheelchair or find steps hard',
  VISION: 'I am blind or have low vision',
  HEARING: 'I am deaf or hard of hearing',
  COGNITIVE: 'I prefer simple screens and steps',
  ELDERLY: 'I am an older resident',
};
export const PLACE_KINDS = ['STEP_FREE_ROUTE', 'RAMP', 'LIFT', 'ACCESSIBLE_TOILET', 'OKU_PARKING', 'SEATING'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  STEP_FREE_ROUTE: 'Step-free route',
  RAMP: 'Ramp',
  LIFT: 'Lift',
  ACCESSIBLE_TOILET: 'Accessible toilet',
  OKU_PARKING: 'OKU parking',
  SEATING: 'Rest seating',
};

// --- Taman --------------------------------------------------------------------

export const WILDLIFE_KINDS = ['BIRD', 'INSECT', 'MAMMAL', 'REPTILE', 'AMPHIBIAN', 'PLANT', 'OTHER'] as const;
export type WildlifeKind = (typeof WILDLIFE_KINDS)[number];
export const WILDLIFE_KIND_LABELS: Record<WildlifeKind, string> = {
  BIRD: 'Bird',
  INSECT: 'Insect or butterfly',
  MAMMAL: 'Mammal',
  REPTILE: 'Reptile',
  AMPHIBIAN: 'Frog or toad',
  PLANT: 'Native plant',
  OTHER: 'Something else',
};

// --- Gerak ----------------------------------------------------------------------

export const GERAK_MODES = ['WALK', 'RUN', 'CYCLE', 'WHEELCHAIR'] as const;
export type GerakMode = (typeof GERAK_MODES)[number];
/** Fair play (BR24): parts of a trip faster than the top speed for the activity do not count. */
export const GERAK_MODE_INFO: Record<GerakMode, { label: string; maxSpeedKmh: number }> = {
  WALK: { label: 'Walk', maxSpeedKmh: 9 },
  RUN: { label: 'Run', maxSpeedKmh: 22 },
  CYCLE: { label: 'Cycle', maxSpeedKmh: 40 },
  WHEELCHAIR: { label: 'Wheelchair', maxSpeedKmh: 12 },
};

// --- Jimat ----------------------------------------------------------------------

export const BILL_KINDS = ['ELECTRICITY', 'WATER'] as const;
export type BillKind = (typeof BILL_KINDS)[number];

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
  /** High-rise only: the building, such as "Pangsapuri Harmoni Elmina, Block A". */
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

/** The first line, for lists: "No. 12, Jalan Metafasa U16/171" or "A-03-07, Pangsapuri Harmoni Elmina, Block A". */
export const shortAddress = (a: HomeAddress) =>
  a.property_type === 'HIGHRISE' ? [a.house_no, a.building].filter(Boolean).join(', ') : [a.house_no && `No. ${a.house_no}`, a.street].filter(Boolean).join(', ');

/**
 * A home written as Malaysian post is addressed, in the order Sime Darby Property
 * townships are laid out: house (or unit and building), street, precinct or phase,
 * then postcode, city and state.
 *   No. 12, Jalan Metafasa U16/171, Elmina Valley 1, 40160 Shah Alam, Selangor
 *   A-03-07, Pangsapuri Harmoni Elmina, Block A, Jalan Casuarina U17/56, Elmina West, 40160 Shah Alam, Selangor
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

/**
 * The default monthly limit of offer-backed points per home (BR6; raised from 800 to 1000 for now).
 * The live limit is the setting program_settings.offer_points_monthly_home, which SDP HQ can change;
 * migration 015 gives it this default. Used here only where a page states the default.
 */
export const HOME_OFFER_POINTS_DEFAULT = 1_000;
