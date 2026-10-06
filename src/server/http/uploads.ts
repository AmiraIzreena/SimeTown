import { sniffImage, type Photo } from '../ai/classifier';
import { AppError, badRequest } from '../errors';
import { readBody } from './body';

export const MAX_PHOTO_BYTES = 1_500_000;

/**
 * Reads one optional photo from a multipart form. The browser's stated type and
 * file name are ignored: the type comes from the file's own first bytes, and
 * only JPEG, PNG and WebP are accepted.
 */
export async function readPhoto(form: FormData, field = 'photo'): Promise<Photo | undefined> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return undefined;
  if (file.size > MAX_PHOTO_BYTES) throw new AppError(413, 'PHOTO_TOO_LARGE', 'The photo is too large. Please use one under 1.5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) throw badRequest('The photo must be a JPEG, PNG or WebP image.');
  return { mime, bytes };
}

export async function readForm(req: Request): Promise<FormData> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw badRequest('Send this request as a form.');
  }
  // Read at most one photo plus the text fields, so an oversized upload is never held in memory.
  const bytes = await readBody(req, MAX_PHOTO_BYTES + 100_000);
  try {
    return await new Response(bytes, { headers: { 'content-type': type } }).formData();
  } catch {
    throw badRequest('The form could not be read.');
  }
}
