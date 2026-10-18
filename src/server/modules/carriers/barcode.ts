/**
 * What a label barcode contains. A shipping label's 1D barcode usually holds the
 * tracking number alone; a 2D code may hold a link or a few fields. Nothing
 * here assumes the barcode carries the recipient: only the tracking number is
 * taken, and everything else comes from the courier company's system.
 */

const TRACKING = /^[A-Z0-9][A-Z0-9-]{5,38}[A-Z0-9]$/;

/** The tracking number in what a scanner or a person typed, or null when there is none. */
export function trackingFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 512) return null;
  let candidate = text;
  // A link: take a tracking-like query parameter, or the last part of the path.
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const param = ['tracking', 'trackingNo', 'tracking_no', 'awb', 'waybill', 'no', 'id'].map((k) => url.searchParams.get(k)).find(Boolean);
      candidate = param ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      return null;
    }
  } else if (/[|;\n]/.test(text)) {
    // A few fields in one code: the first field that looks like a tracking number.
    candidate = text.split(/[|;\n]/).map((s) => s.trim()).find((s) => TRACKING.test(s.toUpperCase().replace(/\s+/g, ''))) ?? '';
  }
  const clean = candidate.toUpperCase().replace(/\s+/g, '');
  return TRACKING.test(clean) ? clean : null;
}

/** Whether a tracking number looks like this company's. A match proves nothing about whether the shipment is real. */
export function matchesPattern(trackingNo: string, pattern: string | null): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(trackingNo);
  } catch {
    return true;
  }
}
