import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readPhoto, rebuildImage } from '@/server/http/uploads';

/**
 * Every uploaded photo is decoded and saved again as a fresh image, so only its pixels
 * survive: hidden data, disguised files and metadata (including a phone's GPS) are dropped.
 */

const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));
const formWith = (bytes: Uint8Array<ArrayBuffer>, name = 'photo.png', type = 'image/png') => {
  const form = new FormData();
  form.set('photo', new File([bytes], name, { type }));
  return form;
};

async function jpegWithMetadata(): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 160, b: 200 } } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'SECRET-OWNER', ImageDescription: 'Taken at 3.1795 N 101.5083 E' } })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('Uploaded photos are rebuilt as fresh images', () => {
  it('drops data hidden after the picture', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4a90d9' } }).png().toBuffer();
    const smuggled = new Uint8Array([...png, ...Buffer.from('MZ<script>alert(1)</script>HIDDEN-PAYLOAD')]);
    expect(contains(smuggled, 'HIDDEN-PAYLOAD')).toBe(true);
    const photo = await readPhoto(formWith(smuggled));
    expect(photo!.mime).toBe('image/png');
    expect(contains(photo!.bytes, 'HIDDEN-PAYLOAD')).toBe(false);
    expect(contains(photo!.bytes, '<script>')).toBe(false);
    expect((await sharp(photo!.bytes).metadata()).width).toBe(8); // still the same picture
  });

  it('removes metadata such as the owner and location a camera writes into a photo', async () => {
    const jpeg = await jpegWithMetadata();
    expect(contains(jpeg, 'SECRET-OWNER')).toBe(true);
    const rebuilt = await rebuildImage({ mime: 'image/jpeg', bytes: jpeg });
    expect(contains(rebuilt.bytes, 'SECRET-OWNER')).toBe(false);
    expect(contains(rebuilt.bytes, '101.5083')).toBe(false);
    expect((await sharp(rebuilt.bytes).metadata()).exif).toBeUndefined();
  });

  it('refuses a file that only pretends to be an image', async () => {
    // A real PNG signature followed by something that is not a picture.
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('this is not an image at all')]);
    await expect(readPhoto(formWith(fake))).rejects.toMatchObject({ status: 400 });
    // And anything that is not JPEG, PNG or WebP at all, whatever its name says.
    await expect(readPhoto(formWith(new Uint8Array(Buffer.from('MZ fake program')), 'photo.jpg', 'image/jpeg'))).rejects.toMatchObject({ status: 400 });
  });

  it('scales a very large photo down to fit 2560 pixels', async () => {
    const big = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#88aacc' } }).webp().toBuffer();
    const rebuilt = await rebuildImage({ mime: 'image/webp', bytes: new Uint8Array(big) });
    const meta = await sharp(rebuilt.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([2560, 640]);
    expect(meta.format).toBe('webp');
  });
});
