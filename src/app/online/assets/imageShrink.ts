/**
 * A smaller copy of a map image too large to send to players: a full-quality map of tens of megapixels is far over what
 * a data channel carries or a phone decodes (Atlas 0.7 keeps maps of up to 144 megapixels as they were imported). The
 * copy keeps the map's shape, its longest side cut to what Atlas itself held a map to before (8192 pixels), as WebP.
 * Taken in the GM's window, only for an image that would otherwise not be sent at all.
 */
import { imageDimensions } from '../../imageProcessing/imageDimensions';
import { ASSET_LIMITS } from './assetIds';

/** The longest side of the copy: what Atlas held a map to before 0.7. */
export const SHRUNK_LONGEST_SIDE = 8192;
/** The copy is saved smaller if it comes out over this share of the file limit. */
const SHARE_OF_LIMIT = 0.75;
const QUALITY = 0.85;
const MAX_ROUNDS = 4;

/** `width × height` cut to at most `longest` on the longer side, in the same shape; unchanged where it is smaller. */
export function shrunkSize(width: number, height: number, longest = SHRUNK_LONGEST_SIDE): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What `shrinkImage` uses of the window: decoding with a size, and a canvas that saves WebP. */
export interface ShrinkTools {
  decode(blob: Blob, width: number, height: number): Promise<{ readonly width: number; readonly height: number; close(): void }>;
  /** A WebP of the bitmap at `width × height`, as bytes; null when the canvas cannot save one. */
  encode(bitmap: { readonly width: number; readonly height: number }, width: number, height: number, quality: number): Promise<ArrayBuffer | null>;
}

/** What a browser window gives `windowShrinkTools`. */
export interface ShrinkWindow {
  createImageBitmap: typeof createImageBitmap;
  OffscreenCanvas: typeof OffscreenCanvas;
}

/** The tools in a browser window: `createImageBitmap` with a size (so a huge image is never held whole), and an `OffscreenCanvas`. */
export function windowShrinkTools(win: ShrinkWindow): ShrinkTools {
  return {
    decode: (blob, width, height) => win.createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }),
    encode: async (bitmap, width, height, quality) => {
      const canvas = new win.OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap as ImageBitmap, 0, 0, width, height);
      const saved = await canvas.convertToBlob({ type: 'image/webp', quality });
      return saved.size > 0 ? saved.arrayBuffer() : null;
    },
  };
}

/**
 * A copy of the raster image in `bytes` that fits the file limit: cut to `SHRUNK_LONGEST_SIDE`, then smaller still while
 * the WebP is over three quarters of the limit. Throws for an image whose size cannot be read or that cannot be saved
 * small enough; the map then goes unsent, as it always did.
 */
export async function shrinkImage(
  bytes: ArrayBuffer,
  mime: string,
  tools: ShrinkTools,
  dimensions: (blob: Blob) => Promise<{ width: number; height: number } | null> = imageDimensions,
): Promise<ArrayBuffer> {
  const blob = new Blob([bytes], { type: mime });
  const size = await dimensions(blob);
  if (!size) throw new Error("The map image's size cannot be read");
  let { width, height } = shrunkSize(size.width, size.height);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const bitmap = await tools.decode(blob, width, height);
    try {
      const saved = await tools.encode(bitmap, width, height, QUALITY);
      if (saved && saved.byteLength > 0 && saved.byteLength <= ASSET_LIMITS.fileBytes * SHARE_OF_LIMIT) return saved;
    } finally {
      bitmap.close();
    }
    ({ width, height } = shrunkSize(width, height, Math.max(width, height) / 2));
  }
  throw new Error('The map image cannot be made small enough to send');
}
