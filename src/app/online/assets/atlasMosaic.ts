/**
 * Atlas 0.11's Mosaic Canvas, as far as sending a map to players uses it: maps of up to 1,000 megapixels and 65,535 pixels
 * a side, files of hundreds of megabytes, which a browser cannot decode and `readBinary` cannot always read. Atlas cuts
 * such a map into a pyramid of tiles once and answers for the whole map at any size asked, so the smaller copy players
 * get (`imageShrink.ts`) is made from the tiles and the file is never read here.
 *
 * Atlas has no extension API, so the tile service is found as the rest of Connect finds Atlas: through an open map view's
 * private objects, every member checked before use. Where it is not there (an Atlas before 0.11, whose maps are small
 * enough to decode; no map view open) these functions answer null and the file is read as before.
 */
import type { App, TFile } from 'obsidian';
import { shrinkImage, type ShrinkTools } from './imageShrink';

/** The most pixels a map is sent with as it is: what Atlas held a map to before Mosaic Canvas (0.10: 144 megapixels). */
export const MAX_SENT_PIXELS = 144_000_000;
/** A file smaller than this is not measured: 144 megapixels do not fit in it in any format a map comes in. */
export const MEASURED_FROM_BYTES = 8 * 1024 * 1024;

/** How long the full-size copy is waited for before the quick one is taken (the tiles of a huge map are still being cut). */
const FULL_WAIT_MS = 45_000;
const QUICK_SIDE = 2048;
const QUICK_WAIT_MS = 120_000;

/** What Atlas's `MosaicCanvasService` answers to (its `open`, `overview` and `close`). */
export interface MosaicService {
  open(file: TFile): Promise<{ handle: number; pyramid: { width: number; height: number } }>;
  overview(handle: number, maxSide: number, signal?: AbortSignal): Promise<ImageBitmap>;
  close(handle: number): void;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => (typeof value === 'object' || typeof value === 'function') && value !== null;

export function isMosaicService(value: unknown): value is MosaicService {
  return isObject(value) && typeof value.open === 'function' && typeof value.overview === 'function' && typeof value.close === 'function';
}

/** Atlas's tile service, through any map view that has a map image (it is one per Obsidian, not per view); null where there is none. */
export function mosaicServiceOf(app: App): MosaicService | null {
  const leaves = app.workspace?.getLeavesOfType?.('atlas-vtt') ?? [];
  for (const leaf of leaves) {
    try {
      const renderer = (leaf.view as unknown as Rec).renderer;
      const image = isObject(renderer) && typeof renderer.getMapImage === 'function' ? (renderer.getMapImage as () => unknown).call(renderer) : null;
      const deps = isObject(image) ? image.deps : null;
      const service = isObject(deps) ? deps.service : null;
      if (isMosaicService(service)) return service;
    } catch {
      // A view that is still starting has no renderer yet: the next one is asked.
    }
  }
  return null;
}

/**
 * The tools `shrinkImage` cuts a copy with, reading the map from Atlas's tiles at the size asked instead of decoding a
 * file. A copy not given in time is taken at Atlas's quick size and saved at the size it has.
 */
export function mosaicShrinkTools(service: MosaicService, handle: number, window: Pick<ShrinkTools, 'encode'>): ShrinkTools {
  return {
    decode: async (_blob, width, height) => {
      const side = Math.max(width, height);
      try {
        return await service.overview(handle, side, AbortSignal.timeout(FULL_WAIT_MS));
      } catch (error) {
        if (side <= QUICK_SIDE) throw error;
        return service.overview(handle, QUICK_SIDE, AbortSignal.timeout(QUICK_WAIT_MS));
      }
    },
    // The picture has the size it came with, which may be smaller than asked.
    encode: (bitmap, _width, _height, quality) => window.encode(bitmap, bitmap.width, bitmap.height, quality),
  };
}

/**
 * The smaller copy of a raster map in `file` made from Atlas's tiles; null where Atlas cannot give it (see the top), and the
 * file is then read and cut as before.
 */
export async function shrinkWithAtlas(app: App, file: TFile, mime: string, tools: ShrinkTools): Promise<ArrayBuffer | null> {
  const service = mosaicServiceOf(app);
  if (!service) return null;
  let opened: Awaited<ReturnType<MosaicService['open']>>;
  try {
    opened = await service.open(file);
  } catch {
    return null;
  }
  try {
    // No file is read: the size comes from the tiles, and every decode is a picture of them.
    return await shrinkImage(new ArrayBuffer(0), mime, mosaicShrinkTools(service, opened.handle, tools), async () => opened.pyramid);
  } catch {
    return null;
  } finally {
    service.close(opened.handle);
  }
}
