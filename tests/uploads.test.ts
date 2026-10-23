import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { photoProblem } from '@/lib/image';
import { MAX_PHOTO_BYTES, readForm, readPhoto, rebuildImage } from '@/server/http/uploads';

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
    // And anything that is not JPEG or PNG at all, whatever its name says.
    await expect(readPhoto(formWith(new Uint8Array(Buffer.from('MZ fake program')), 'photo.jpg', 'image/jpeg'))).rejects.toMatchObject({ status: 400 });
  });

  it('scales a very large photo down to fit 2560 pixels', async () => {
    const big = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
    const rebuilt = await rebuildImage({ mime: 'image/jpeg', bytes: new Uint8Array(big) });
    const meta = await sharp(rebuilt.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([2560, 640]);
    expect(meta.format).toBe('jpeg');
  });
});

describe('Only JPEG and PNG photos up to 10 MB are accepted', () => {
  const text = (s: string) => new Uint8Array(Buffer.from(s));
  const refusedType = { status: 400, message: 'The photo must be a JPG or PNG image.' };

  it('accepts JPEG and PNG, and refuses WebP and GIF even when they are real images', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4a90d9' } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4a90d9' } }).jpeg().toBuffer();
    expect((await readPhoto(formWith(new Uint8Array(png))))!.mime).toBe('image/png');
    expect((await readPhoto(formWith(new Uint8Array(jpeg), 'photo.jpg', 'image/jpeg')))!.mime).toBe('image/jpeg');
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4a90d9' } }).webp().toBuffer();
    await expect(readPhoto(formWith(new Uint8Array(webp), 'photo.webp', 'image/webp'))).rejects.toMatchObject(refusedType);
    const gif = new Uint8Array(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
    await expect(readPhoto(formWith(gif, 'photo.gif', 'image/gif'))).rejects.toMatchObject(refusedType);
  });

  it('refuses SVG, HTML and scripts renamed as photos', async () => {
    await expect(readPhoto(formWith(text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'photo.jpg', 'image/jpeg'))).rejects.toMatchObject(refusedType);
    await expect(readPhoto(formWith(text('<!doctype html><script>alert(1)</script>'), 'photo.jpg', 'image/jpeg'))).rejects.toMatchObject(refusedType);
    await expect(readPhoto(formWith(text('#!/bin/sh\necho hi\n'), 'photo.png', 'image/png'))).rejects.toMatchObject(refusedType);
  });

  it('accepts a photo above the old 1.5 MB limit, and refuses one over 10 MB', async () => {
    const noisy = await sharp({ create: { width: 1800, height: 1800, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 100 }).toBuffer();
    expect(noisy.length).toBeGreaterThan(1_500_000);
    expect(noisy.length).toBeLessThan(MAX_PHOTO_BYTES);
    expect((await readPhoto(formWith(new Uint8Array(noisy), 'photo.jpg', 'image/jpeg')))!.mime).toBe('image/jpeg');

    const tooBig = new Uint8Array(MAX_PHOTO_BYTES + 1);
    tooBig.set([0xff, 0xd8, 0xff]);
    await expect(readPhoto(formWith(tooBig, 'photo.jpg', 'image/jpeg'))).rejects.toMatchObject({ status: 413, code: 'PHOTO_TOO_LARGE' });
  });

  it('refuses a decompression bomb: a small file that unpacks into a huge picture', async () => {
    const bomb = await sharp({ create: { width: 12_000, height: 12_000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX_PHOTO_BYTES); // small enough to pass the size check
    await expect(readPhoto(formWith(new Uint8Array(bomb)))).rejects.toMatchObject({ status: 400 });
  });

  it('reads a form with a full 10 MB photo, but not a larger request', async () => {
    // Sent as finished bytes, as a browser sends a form (a FormData body would be generated on the fly instead).
    const request = async (bytes: number) => {
      const form = formWith(new Uint8Array(bytes), 'photo.jpg', 'image/jpeg');
      form.set('note', 'A few words');
      const body = await new Response(form).blob();
      return new Request('http://kita.test/upload', { method: 'POST', body: await body.arrayBuffer(), headers: { 'content-type': body.type } });
    };
    expect((await readForm(await request(MAX_PHOTO_BYTES))).get('note')).toBe('A few words');
    await expect(readForm(await request(MAX_PHOTO_BYTES + 300_000))).rejects.toMatchObject({ status: 413 });
  });
});

describe('The browser refuses the wrong file before uploading it', () => {
  const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

  it('takes JPG and PNG up to 10 MB, and nothing else', () => {
    expect(photoProblem(file('a.jpg', 'image/jpeg'))).toBeNull();
    expect(photoProblem(file('a.png', 'image/png'))).toBeNull();
    expect(photoProblem(file('a.jpeg', ''))).toBeNull(); // no type given: the name decides
    expect(photoProblem(file('a.webp', 'image/webp'))).toMatch(/not a JPG or PNG/);
    expect(photoProblem(file('a.jpg', 'image/svg+xml'))).toMatch(/not a JPG or PNG/); // the stated type wins over the name
    expect(photoProblem(file('a.gif', 'image/gif'))).toMatch(/not a JPG or PNG/);
    expect(photoProblem(file('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1))).toMatch(/larger than 10 MB/);
  });
});
