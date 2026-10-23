import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '@/shared/photos';

/** What every photo picker offers: JPG and PNG only (the server checks the same). */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png';
/** The line shown with every photo picker. */
export const PHOTO_HINT = 'JPG or PNG, up to 10 MB';

/** Why a chosen file cannot be sent, or null when it can. The type comes from the browser, or the name when it gives none. */
export function photoProblem(file: File): string | null {
  const typeOk = file.type ? (PHOTO_TYPES as readonly string[]).includes(file.type) : /\.(jpe?g|png)$/i.test(file.name);
  if (!typeOk) return 'This file is not a JPG or PNG photo. Please choose another one.';
  if (file.size > MAX_PHOTO_BYTES) return 'This photo is larger than 10 MB. Please choose a smaller one.';
  return null;
}

/**
 * Reads the photo chosen in a file input. A file of the wrong type or size is refused
 * with a message and the input is cleared, so a form sent afterwards does not carry it.
 */
export function usePhotoPick() {
  const toast = useToast();
  return useCallback((input: HTMLInputElement): File | null => {
    const file = input.files?.[0] ?? null;
    const problem = file && photoProblem(file);
    if (!problem) return file;
    toast.show(problem, 'error');
    input.value = '';
    return null;
  }, [toast]);
}

/**
 * Shrinks a phone photo in the browser before upload: the longest side becomes
 * 1280 px and the file is re-encoded as JPEG (which also drops location data
 * embedded by the camera). Falls back to the original file if the browser
 * cannot do it.
 */
export async function shrinkPhoto(file: File, maxSide = 1280, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality));
  } catch {
    return file;
  }
}
