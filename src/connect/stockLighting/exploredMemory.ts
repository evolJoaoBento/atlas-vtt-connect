/**
 * The scene's explored memory as the GM's player window shows it, for the stock Atlas stand-in. The window's own
 * memory lives on the graphics device; what the scene saves of it is the mask (`ViewAtlasState.exploredMask`, a PNG data
 * URL of white with the coverage as alpha), which follows the memory within Atlas's save delay (2 seconds). Decoded
 * here, the mask shows players where the window shows memory, as the extension API branch of Atlas does.
 *
 * The mask holds *more* than the window shows after the GM takes memory away (an erase, an undo, a reset): until the
 * next save it still has what is gone. Stock Atlas does not say when that settles, so after any change of the count of
 * explored edits, and after a map change, no memory is shown for `EXPLORED_SETTLE_MS`, long enough for the save. The
 * mask holds *less* while the memory grows (the save lags), which only shows players less. Memory is shown only while
 * the engine's memory is in (`isMemory`: its mask has loaded and no graphics context was lost) and the scene keeps it.
 */
import type { ExploredImage } from './darknessRaster';

/** Atlas saves the memory 2 seconds after it changes; this leaves the save, and a slow read of the texture, room. */
export const EXPLORED_SETTLE_MS = 4000;

export type ExploredDecoder = (dataUrl: string) => Promise<ExploredImage>;

/** The mask's alpha, texel for texel, decoded off the page (`createImageBitmap`, `OffscreenCanvas`). */
export async function decodeExploredMask(dataUrl: string): Promise<ExploredImage> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const { width, height } = bitmap;
    const context = new OffscreenCanvas(width, height).getContext('2d');
    if (!context) throw new Error('no 2D context to read the explored memory');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    const coverage = new Uint8Array(width * height);
    for (let i = 0; i < coverage.length; i++) coverage[i] = data[i * 4 + 3]!;
    return { width, height, coverage };
  } finally {
    bitmap.close();
  }
}

/** What the follower reads of the view each time it is asked. */
export interface ExploredInput {
  /** The scene keeps explored memory (`lighting.exploredMemory` is not false). */
  keeps: boolean;
  /** The engine's memory holds the scene's mask and was not lost with a graphics context. */
  isMemory: boolean;
  mask: string | null;
  /** The store's count of explored edits (undo and redo move it too). */
  edits: number;
  mapPath: string | null;
}

/**
 * Follows one view's explored memory: decodes each new mask once, forgets everything when memory may have been taken
 * out, and answers what players may be shown. `onChange` is called when the answer may have changed without the store
 * saying so: a mask decoded, or the settle time over.
 */
export class ExploredFollower {
  private mask: string | null = null;
  private image: ExploredImage | null = null;
  private edits: number | null = null;
  private mapPath: string | null = null;
  /** When memory may last have been taken out. */
  private changedAt = -Infinity;
  private timer: number | null = null;
  private disposed = false;

  constructor(
    private readonly onChange: () => void,
    private readonly now: () => number = () => Date.now(),
    private readonly decode: ExploredDecoder = decodeExploredMask,
  ) {}

  /** The memory players are shown now, or null: none kept, not the engine's yet, settling, or not decoded yet. */
  read(input: ExploredInput): ExploredImage | null {
    const now = this.now();
    // The first look is also a change: an erase just before it may not have been saved yet.
    if (this.edits === null || input.edits !== this.edits || input.mapPath !== this.mapPath) this.forget(now);
    this.edits = input.edits;
    this.mapPath = input.mapPath;
    if (!input.keeps || !input.isMemory) {
      // Not the memory the window shows now: what was decoded stands in for nothing when it is again.
      this.mask = null;
      this.image = null;
      return null;
    }
    const wait = this.changedAt + EXPLORED_SETTLE_MS - now;
    if (wait > 0) {
      this.wake(wait);
      return null;
    }
    if (input.mask === null) {
      this.mask = null;
      this.image = null;
      return null;
    }
    if (input.mask !== this.mask) {
      const mask = input.mask;
      this.mask = mask;
      this.decode(mask).then((image) => this.decoded(mask, image), () => this.decoded(mask, null));
    }
    return this.image;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Memory may have been taken out: nothing decoded before stands in, and nothing shows until it settles. */
  private forget(now: number): void {
    this.changedAt = now;
    this.mask = null;
    this.image = null;
  }

  private decoded(mask: string, image: ExploredImage | null): void {
    if (this.disposed || mask !== this.mask) return;
    this.image = image;
    this.onChange();
  }

  private wake(ms: number): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.disposed) this.onChange();
    }, ms + 20);
  }
}
