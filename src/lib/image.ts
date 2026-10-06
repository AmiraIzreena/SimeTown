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
