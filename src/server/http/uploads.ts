import { sniffImage, type Photo } from '../ai/classifier';
import { one, type Queryable } from '../db/client';
import { AppError, badRequest } from '../errors';
import { readBody } from './body';

export const MAX_PHOTO_BYTES = 1_500_000;

/** Larger photos are scaled down to fit this box; plenty for a report or a drain reading. */
const MAX_SIDE_PX = 2560;
/** A decompression bomb (a small file that unpacks into a huge picture) is refused before it is decoded. */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Reads one optional photo from a multipart form. The browser's stated type and
 * file name are ignored: the type comes from the file's own first bytes, and
 * only JPEG, PNG and WebP are accepted. The picture is then decoded and saved
 * again as a fresh image (see `rebuildImage`), so nothing but pixels survives.
 */
export async function readPhoto(form: FormData, field = 'photo'): Promise<Photo | undefined> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return undefined;
  if (file.size > MAX_PHOTO_BYTES) throw new AppError(413, 'PHOTO_TOO_LARGE', 'The photo is too large. Please use one under 1.5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) throw badRequest('The photo must be a JPEG, PNG or WebP image.');
  return rebuildImage({ mime, bytes });
}

/**
 * Decodes a photo and writes it out again as a new image of the same type. Only the
 * pixels are carried over, so whatever else the file held is dropped: hidden data
 * appended after the picture, scripts or a second file disguised inside it, and all
 * metadata, including the GPS location a phone camera writes into a photo (privacy).
 * The picture is turned upright first (from its orientation tag), and very large ones
 * are scaled down. A file that does not decode as a real image is refused.
 */
export async function rebuildImage(photo: Photo): Promise<Photo> {
  // Loaded on first use: the image library is a native module, needed only by uploads.
  const { default: sharp } = await import('sharp');
  try {
    let image = sharp(photo.bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
      .rotate()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true });
    image = photo.mime === 'image/png' ? image.png({ compressionLevel: 9 }) : photo.mime === 'image/webp' ? image.webp({ quality: 85 }) : image.jpeg({ quality: 85, mozjpeg: true });
    // sharp writes no metadata unless asked to, so EXIF, GPS, XMP and ICC extras are all left behind.
    return { mime: photo.mime, bytes: new Uint8Array(await image.toBuffer()) };
  } catch {
    throw badRequest('The photo could not be read as an image. Please take or choose another photo.');
  }
}

/** Stores a checked photo for its owner and returns the upload's id. */
export async function storeUpload(q: Queryable, ownerId: string, photo: Photo): Promise<string> {
  const upload = await one<{ id: string }>(q, 'INSERT INTO uploads (owner_id, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4) RETURNING id', [
    ownerId, photo.mime, photo.bytes.length, Buffer.from(photo.bytes),
  ]);
  return upload!.id;
}

/** Sends a stored photo back: inline, never sniffed as another type, and cached only by the viewer's own browser. */
export const photoResponse = (upload: { mime: string; bytes: Uint8Array }) =>
  new Response(Buffer.from(upload.bytes), {
    headers: {
      'Content-Type': upload.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  });

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
