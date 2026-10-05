// online-client/imageDecoder.mts
/**
 * Turns image bytes into something the preview can draw. SVG goes through an
 * `<img>` (not every browser decodes SVG in `createImageBitmap`), which never
 * runs its scripts; the page never inserts an image's markup.
 */
import type { AssetMime } from '../src/app/online/assets/assetIds';
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';

async function viaImageElement(blob: Blob): Promise<DecodedImage | null> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return { image, width: image.naturalWidth || 1, height: image.naturalHeight || 1, release: () => URL.revokeObjectURL(url) };
}

export async function decodeImage(bytes: ArrayBuffer, mime: AssetMime): Promise<DecodedImage | null> {
  const blob = new Blob([bytes], { type: mime });
  if (mime === 'image/svg+xml' || typeof createImageBitmap !== 'function') return viaImageElement(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return null;
  }
}
