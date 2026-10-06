import { AppError } from '../errors';

const tooLarge = () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');

/**
 * Reads a request body, but never more than `maxBytes`: reading stops as soon as
 * the limit is passed, whatever the Content-Length header claims, and also when
 * there is no such header (a chunked upload).
 */
export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
