/** Smart parcel lockers: the vocabulary shared by the server and the screens. */

export const PARCEL_STATES = [
  'REGISTERED',
  'VERIFIED',
  'LOCKER_RESERVED',
  'DEPOSIT_IN_PROGRESS',
  'DEPOSITED',
  'READY_FOR_COLLECTION',
  'OVERDUE',
  'RELOCATION_PENDING',
  'RELOCATION_IN_PROGRESS',
  'RELOCATED_TO_STORAGE',
  'COLLECTION_IN_PROGRESS',
  'COLLECTED',
  'DELIVERY_FAILED',
  'RETURN_PENDING',
  'RETURNED',
  'EXCEPTION',
] as const;
export type ParcelState = (typeof PARCEL_STATES)[number];

/**
 * Every move a parcel may make. Anything else is refused, so a repeated or
 * out-of-order request can never skip a step (for example, straight from
 * reserved to collected).
 */
export const PARCEL_TRANSITIONS: Record<ParcelState, readonly ParcelState[]> = {
  REGISTERED: ['VERIFIED', 'DELIVERY_FAILED'],
  // A courier may also hand the parcel to staff at a counter that accepts deliveries.
  VERIFIED: ['LOCKER_RESERVED', 'DELIVERY_FAILED', 'RELOCATED_TO_STORAGE'],
  LOCKER_RESERVED: ['DEPOSIT_IN_PROGRESS', 'VERIFIED', 'DELIVERY_FAILED'],
  DEPOSIT_IN_PROGRESS: ['DEPOSITED', 'LOCKER_RESERVED', 'VERIFIED', 'EXCEPTION'],
  DEPOSITED: ['READY_FOR_COLLECTION'],
  READY_FOR_COLLECTION: ['COLLECTION_IN_PROGRESS', 'OVERDUE', 'RETURN_PENDING', 'EXCEPTION'],
  OVERDUE: ['COLLECTION_IN_PROGRESS', 'RELOCATION_PENDING', 'READY_FOR_COLLECTION', 'EXCEPTION'],
  RELOCATION_PENDING: ['COLLECTION_IN_PROGRESS', 'RELOCATION_IN_PROGRESS', 'EXCEPTION'],
  RELOCATION_IN_PROGRESS: ['RELOCATED_TO_STORAGE', 'RELOCATION_PENDING', 'EXCEPTION'],
  RELOCATED_TO_STORAGE: ['COLLECTED', 'RETURN_PENDING', 'EXCEPTION'],
  COLLECTION_IN_PROGRESS: ['COLLECTED', 'READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING', 'EXCEPTION'],
  COLLECTED: [],
  DELIVERY_FAILED: [],
  // Staff can change their mind and keep it at the counter until the courier has taken it.
  RETURN_PENDING: ['RETURNED', 'COLLECTED', 'EXCEPTION', 'RELOCATED_TO_STORAGE'],
  RETURNED: [],
  EXCEPTION: ['READY_FOR_COLLECTION', 'RELOCATED_TO_STORAGE', 'RETURN_PENDING', 'COLLECTED'],
};

export const canMove = (from: ParcelState, to: ParcelState) => PARCEL_TRANSITIONS[from].includes(to);

/** In a locker, waiting for the household (the credential works at the locker). */
export const IN_LOCKER: ParcelState[] = ['READY_FOR_COLLECTION', 'OVERDUE', 'RELOCATION_PENDING'];
export const TERMINAL: ParcelState[] = ['COLLECTED', 'RETURNED', 'DELIVERY_FAILED'];

export const PARCEL_STATE_LABELS: Record<ParcelState, string> = {
  REGISTERED: 'Registered',
  VERIFIED: 'Recipient verified',
  LOCKER_RESERVED: 'Locker reserved',
  DEPOSIT_IN_PROGRESS: 'Being deposited',
  DEPOSITED: 'Deposited',
  READY_FOR_COLLECTION: 'Ready to collect',
  OVERDUE: 'Overdue',
  RELOCATION_PENDING: 'Due to be moved',
  RELOCATION_IN_PROGRESS: 'Moving to the guardhouse',
  RELOCATED_TO_STORAGE: 'At the guardhouse',
  COLLECTION_IN_PROGRESS: 'Being collected',
  COLLECTED: 'Collected',
  DELIVERY_FAILED: 'Not delivered',
  RETURN_PENDING: 'Going back to the courier',
  RETURNED: 'Returned to the courier',
  EXCEPTION: 'Needs attention',
};

/*
 * Private doors. Every home has its own door in the locker bank that serves its precinct, so a parcel waiting
 * in it blocks nobody and never has to be moved. A parcel that cannot go into the home's door goes to the parcel
 * counter at the guardhouse instead, and the household is told why.
 */
export const DELIVERY_PROBLEMS = ['TOO_BIG', 'DOOR_FULL', 'DOOR_DID_NOT_OPEN', 'DOOR_DAMAGED', 'PARCEL_DAMAGED', 'NO_DOOR', 'OTHER_STATION', 'COUNTER_CLOSED', 'OTHER'] as const;
export type DeliveryProblem = (typeof DELIVERY_PROBLEMS)[number];

/** The reasons a courier can give on the "What happened?" screen. The others the system finds by itself. */
export const COURIER_PROBLEMS = ['TOO_BIG', 'DOOR_FULL', 'DOOR_DID_NOT_OPEN', 'DOOR_DAMAGED', 'PARCEL_DAMAGED', 'OTHER'] as const satisfies readonly DeliveryProblem[];
export type CourierProblem = (typeof COURIER_PROBLEMS)[number];

/** How the courier and staff see each reason. */
export const DELIVERY_PROBLEM_LABELS: Record<DeliveryProblem, string> = {
  TOO_BIG: 'The parcel is too big for the door',
  DOOR_FULL: 'The door already has something inside',
  DOOR_DID_NOT_OPEN: 'The door did not open',
  DOOR_DAMAGED: 'The door is damaged or dirty',
  PARCEL_DAMAGED: 'The parcel is damaged',
  NO_DOOR: 'The home has no locker door yet',
  OTHER_STATION: 'The home’s door is at another locker',
  COUNTER_CLOSED: 'The guardhouse was closed',
  OTHER: 'Other reason',
};

/** What the household is told, in plain words. */
export const DELIVERY_PROBLEM_FOR_RESIDENT: Record<DeliveryProblem, string> = {
  TOO_BIG: 'It was too large for your locker door.',
  DOOR_FULL: 'Your locker door already had a parcel in it.',
  DOOR_DID_NOT_OPEN: 'Your locker door did not open for the courier. The township office has been told.',
  DOOR_DAMAGED: 'Your locker door needs attention. The township office has been told.',
  PARCEL_DAMAGED: 'The courier reported that the parcel is damaged.',
  NO_DOOR: 'Your home does not have a locker door yet.',
  OTHER_STATION: 'The courier was at a different locker.',
  COUNTER_CLOSED: 'The guardhouse was closed.',
  OTHER: 'The courier could not use your locker door.',
};

/** Where Malaysian township hours are kept. Counters open and close by the township's clock, wherever the viewer is. */
export const TOWNSHIP_TIME_ZONE = 'Asia/Kuala_Lumpur';

/** Minutes past midnight in a time zone. */
function minutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(now);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** Whether a counter open daily from `fromHour` to `toHour` (24 means midnight) is open now. */
export function counterOpenAt(fromHour: number, toHour: number, now: Date, timeZone = TOWNSHIP_TIME_ZONE): boolean {
  if (fromHour <= 0 && toHour >= 24) return true;
  const m = minutesInZone(now, timeZone);
  return m >= fromHour * 60 && m < toHour * 60;
}

/** "8:00 am", "10:00 pm", "12:00 midnight". */
export function formatHour(hour: number): string {
  if (hour === 24 || hour === 0) return '12:00 midnight';
  if (hour === 12) return '12:00 noon';
  return `${hour % 12}:00 ${hour < 12 ? 'am' : 'pm'}`;
}

/** The sentence residents see: "Open daily, 8:00 am – 10:00 pm", or "Open 24 hours". */
export function counterHoursText(fromHour: number, toHour: number): string {
  return fromHour <= 0 && toHour >= 24 ? 'Open 24 hours' : `Open daily, ${formatHour(fromHour)} – ${formatHour(toHour)}`;
}

/** The live status line: "Open now · closes 10:00 pm" or "Closed · opens 8:00 am". */
export function counterStatus(fromHour: number, toHour: number, now: Date, timeZone = TOWNSHIP_TIME_ZONE): { open: boolean; text: string } {
  if (fromHour <= 0 && toHour >= 24) return { open: true, text: 'Open now · open 24 hours' };
  const open = counterOpenAt(fromHour, toHour, now, timeZone);
  return open ? { open, text: `Open now · closes ${formatHour(toHour)}` } : { open, text: `Closed · opens ${formatHour(fromHour)}` };
}

/** Whole days between two moments, never negative: what "uncollected for 9 days" counts. */
export const daysBetween = (from: Date | string, to: Date | string) => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));

export const COMPARTMENT_STATES = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'FAULTY', 'DISABLED'] as const;
export type CompartmentState = (typeof COMPARTMENT_STATES)[number];
export const COMPARTMENT_STATE_LABELS: Record<CompartmentState, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  OCCUPIED: 'Occupied',
  FAULTY: 'Faulty',
  DISABLED: 'Disabled',
};

export const LOCKER_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type LockerSize = (typeof LOCKER_SIZES)[number];
/** Inside dimensions of each standard compartment, in millimetres (width × height × depth). */
export const LOCKER_SIZE_INFO: Record<LockerSize, { label: string; hint: string; mm: [number, number, number] }> = {
  S: { label: 'Small', hint: 'Envelopes, phone cases, cosmetics', mm: [420, 100, 500] },
  M: { label: 'Medium', hint: 'Shoe boxes, clothing', mm: [420, 220, 500] },
  L: { label: 'Large', hint: 'Small appliances, multiple items', mm: [420, 400, 500] },
  XL: { label: 'Extra large', hint: 'Bulky boxes', mm: [420, 700, 600] },
};

/** The smallest standard size a parcel of these dimensions fits, or null when no compartment can take it. */
export function sizeFor(mm: [number, number, number]): LockerSize | null {
  const sorted = (d: number[]) => [...d].sort((a, b) => b - a);
  const parcel = sorted(mm);
  for (const size of LOCKER_SIZES) {
    const box = sorted(LOCKER_SIZE_INFO[size].mm);
    if (parcel.every((v, i) => v <= box[i]!)) return size;
  }
  return null;
}

/** A QR code a resident shows at a locker or counter reads "SIMELOCKER:<credential>". */
export const PICKUP_QR_PREFIX = 'SIMELOCKER:';
