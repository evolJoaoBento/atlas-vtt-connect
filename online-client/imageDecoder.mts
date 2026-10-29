// online-client/imageDecoder.mts
/**
 * Turns image bytes into something the preview can draw. SVG goes through an
 * `<img>` (not every browser decodes SVG in `createImageBitmap`), which never
 * runs its scripts; the page never inserts an image's markup.
 */
import { isVideoMime, type AssetMime } from '../src/app/online/assets/assetIds';
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

/** How long a video may take to give its first frame before it is left out (the map keeps its still). */
const VIDEO_READY_MS = 15_000;

/**
 * An animated map: a muted, looping `<video>` the map layer draws from every frame. Not in the page: it is only a picture
 * source for the canvas, and never has controls or sound. Null when the browser cannot play the file.
 */
async function viaVideoElement(blob: Blob): Promise<DecodedImage | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  const release = (): void => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  const ready = new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), VIDEO_READY_MS);
    const done = (ok: boolean): void => { window.clearTimeout(timer); resolve(ok); };
    video.addEventListener('loadeddata', () => done(true), { once: true });
    video.addEventListener('error', () => done(false), { once: true });
  });
  video.src = url;
  if (!(await ready) || !(video.videoWidth > 0)) {
    release();
    return null;
  }
  // A browser may refuse to start a video nobody asked for; the layer asks again when it draws a paused one.
  await video.play().catch(() => undefined);
  return { image: video, width: video.videoWidth, height: video.videoHeight, release };
}

export async function decodeImage(bytes: ArrayBuffer, mime: AssetMime): Promise<DecodedImage | null> {
  const blob = new Blob([bytes], { type: mime });
  if (isVideoMime(mime)) return viaVideoElement(blob);
  if (mime === 'image/svg+xml' || typeof createImageBitmap !== 'function') return viaImageElement(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return null;
  }
}
