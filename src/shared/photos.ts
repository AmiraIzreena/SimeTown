/**
 * The photo rules every upload follows. The browser checks them before sending, and the
 * server checks them again (the type from the file's own first bytes, never its name).
 */
export const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** At most 10 MB per photo. */
export const MAX_PHOTO_BYTES = 10_000_000;
