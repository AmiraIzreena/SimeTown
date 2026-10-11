import { createHash } from 'node:crypto';
import { sniffImage } from '../ai/classifier';
import { AppError, badRequest, ruleViolation } from '../errors';
import { readBody } from '../http/body';
import { pdfStreams } from './pdf';

/**
 * The file-safety gate for uploaded bills (proposal 6.3, BR25), following the
 * OWASP File Upload Cheat Sheet. A file passes every step or goes no further:
 *
 *   1. Type     JPG, PNG, WebP or PDF, decided by the file's own first bytes.
 *   2. Size     at most 4 MB, and at most 4 pages.
 *   3. Scan     known-malware signatures. The prototype checks the standard
 *               EICAR test signature only; the pilot adds a real scanner.
 *   4. Active   a PDF with scripts, launch actions, embedded files, forms or
 *               encryption is refused, including names hidden with #-escapes.
 *   5. Clean    photos are re-drawn on the phone before upload, which drops
 *               hidden data; a PDF is never opened or rendered, only its text
 *               is read, here, in memory.
 *
 * Nothing is written to disk and the file is never stored: only its SHA-256
 * fingerprint is kept, so the same bill cannot be used twice.
 */

export const BILL_MAX_BYTES = 4_000_000;
const MAX_PAGES = 4;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToE|AA)\b/;

export type BillMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

export interface GateStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface CheckedFile {
  mime: BillMime;
  bytes: Uint8Array;
  sha256: string;
  pages: number | null;
  steps: GateStep[];
}

/** PDF names may hide letters as #xx ("/J#61vaScript"); undo that before looking. */
const decodeNames = (text: string) => text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

function refuse(steps: GateStep[], step: string, detail: string): never {
  steps.push({ step, ok: false, detail });
  throw ruleViolation('FILE_REFUSED', detail, { steps });
}

/** Runs the gate. Throws FILE_REFUSED, with the steps passed so far, at the first failure. */
export function checkBillFile(bytes: Uint8Array): CheckedFile {
  const steps: GateStep[] = [];
  if (bytes.length === 0) refuse(steps, 'Type', 'The file is empty.');
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
  const mime: BillMime | null = isPdf ? 'application/pdf' : sniffImage(bytes);
  if (!mime) refuse(steps, 'Type', 'Only JPG, PNG, WebP or PDF files are accepted. The file’s contents decide, not its name.');
  steps.push({ step: 'Type', ok: true, detail: `${mime === 'application/pdf' ? 'PDF' : mime.slice(6).toUpperCase()}, checked by the file’s own signature.` });

  if (bytes.length > BILL_MAX_BYTES) refuse(steps, 'Size', 'The file is larger than 4 MB.');
  const raw = Buffer.from(bytes).toString('latin1');
  let pages: number | null = null;
  let streams: { dict: string; data: Buffer }[] = [];
  if (mime === 'application/pdf') {
    streams = pdfStreams(bytes);
    const everything = decodeNames(raw + streams.map((s) => s.data.toString('latin1')).join('\n'));
    pages = (everything.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    if (pages > MAX_PAGES) refuse(steps, 'Size', `A bill has at most ${MAX_PAGES} pages; this file has ${pages}.`);
  }
  steps.push({ step: 'Size', ok: true, detail: `${(bytes.length / 1024).toFixed(0)} KB${pages !== null ? `, ${pages} page${pages === 1 ? '' : 's'}` : ''}.` });

  if (raw.includes(EICAR)) refuse(steps, 'Virus scan', 'The file matched a known malware signature.');
  steps.push({ step: 'Virus scan', ok: true, detail: 'No known signature found (prototype: test signature only).' });

  if (mime === 'application/pdf') {
    const everything = decodeNames(raw + streams.map((s) => s.data.toString('latin1')).join('\n'));
    if (/\/Encrypt\b/.test(everything)) refuse(steps, 'Active content', 'Encrypted PDFs cannot be checked. Please upload an unprotected copy.');
    const found = ACTIVE_CONTENT.exec(everything);
    if (found) refuse(steps, 'Active content', `The PDF contains active content (${found[1]}), so it was not opened.`);
    steps.push({ step: 'Active content', ok: true, detail: 'No scripts, actions, forms or embedded files.' });
    steps.push({ step: 'Clean copy', ok: true, detail: 'The PDF was not opened or rendered; only its text was read.' });
  } else {
    steps.push({ step: 'Active content', ok: true, detail: 'A picture carries no scripts.' });
    steps.push({ step: 'Clean copy', ok: true, detail: 'Re-drawn on your phone before upload, which removes hidden data.' });
  }
  return { mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), pages, steps };
}

/** Reads one file and the text fields of a bill-upload form, never more than the limit. */
export async function readBillForm(req: Request): Promise<{ form: FormData; file: Uint8Array }> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) throw badRequest('Send this request as a form.');
  const body = await readBody(req, BILL_MAX_BYTES + 50_000);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': type } }).formData();
  } catch {
    throw badRequest('The form could not be read.');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw badRequest('Attach a photo or PDF of your bill.');
  if (file.size > BILL_MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 4 MB.');
  return { form, file: new Uint8Array(await file.arrayBuffer()) };
}
