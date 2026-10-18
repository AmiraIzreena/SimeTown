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
  RETURN_PENDING: ['RETURNED', 'COLLECTED', 'EXCEPTION'],
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
  RELOCATION_IN_PROGRESS: 'Being moved',
  RELOCATED_TO_STORAGE: 'At the parcel counter',
  COLLECTION_IN_PROGRESS: 'Being collected',
  COLLECTED: 'Collected',
  DELIVERY_FAILED: 'Not delivered',
  RETURN_PENDING: 'Waiting for the courier to take back',
  RETURNED: 'Returned to the courier',
  EXCEPTION: 'Needs attention',
};

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
