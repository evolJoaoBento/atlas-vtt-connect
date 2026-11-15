/** The vault's images for the asset registry: sizes and times from Obsidian's file index, bytes with `readBinary`. */
import { normalizePath, TFile, type App } from 'obsidian';
import type { ImageFiles, ImageFileStat } from '../scene/sceneContracts';
import { ASSET_LIMITS, isRasterMime, isVideoPath, mimeForPath } from './assetIds';
import { imageDimensions } from '../../imageProcessing/imageDimensions';
import { MAX_SENT_PIXELS, MEASURED_FROM_BYTES, shrinkWithAtlas } from './atlasMosaic';
import { shrinkImage, windowShrinkTools, type ShrinkTools, type ShrinkWindow } from './imageShrink';
import { videoStill } from './videoStill';

/** Cuts a raster image over the limit down to a copy that fits (`shrinkImage` in the GM's window); tests pass their own. */
export type ShrinkImage = (bytes: ArrayBuffer, mime: string) => Promise<ArrayBuffer>;

const windowTools = (): ShrinkTools => windowShrinkTools(activeWindow as unknown as ShrinkWindow);
const shrinkInWindow: ShrinkImage = (bytes, mime) => shrinkImage(bytes, mime, windowTools());

/** Cuts a map down from Atlas 0.11's tiles, never reading the file; null where Atlas gives none (an older Atlas, no map open). */
export type ShrinkFromAtlas = (file: TFile, mime: string) => Promise<ArrayBuffer | null>;

const shrinkFromAtlas = (app: App): ShrinkFromAtlas => (file, mime) => shrinkWithAtlas(app, file, mime, windowTools());

export function vaultImageFiles(app: App, shrink: ShrinkImage = shrinkInWindow, fromAtlas: ShrinkFromAtlas = shrinkFromAtlas(app)): ImageFiles {
  const fileAt = (path: string): TFile | null => {
    const file = app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  };
  /** The still of each animated map as of the file's last change: asked for at every request, taken once. */
  const stills = new Map<string, { mtime: number; bytes: Promise<ArrayBuffer> }>();
  /** The smaller copy of each raster image over the file limit, as of the file's last change: made once, not for every request. */
  const reduced = new Map<string, { mtime: number; bytes: Promise<ArrayBuffer> }>();
  /** Whether each file is a picture of more pixels than `MAX_SENT_PIXELS`, as of its last change: its header is read once. */
  const measured = new Map<string, { mtime: number; many: boolean }>();
  const manyPixels = async (path: string, file: TFile, bytes: ArrayBuffer): Promise<boolean> => {
    const kept = measured.get(path);
    if (kept?.mtime === file.stat.mtime) return kept.many;
    // The header is all `imageDimensions` reads: a view of the bytes serves it, without a copy of the whole file in a Blob.
    const header = { slice: (start: number, end: number) => ({ arrayBuffer: async () => bytes.slice(start, end) }) } as unknown as Blob;
    const size = await imageDimensions(header).catch(() => null);
    const many = size !== null && size.width * size.height > MAX_SENT_PIXELS;
    measured.set(path, { mtime: file.stat.mtime, many });
    return many;
  };
  /** The smaller copy of a raster image over the limit, one copy each time (a transfer may take the bytes it is given). */
  const reducedCopy = async (path: string, file: TFile, mime: Parameters<typeof isRasterMime>[0]): Promise<ArrayBuffer> => {
    const kept = reduced.get(path);
    if (kept?.mtime === file.stat.mtime) return (await kept.bytes).slice(0);
    // Atlas 0.11 holds maps of up to 1,000 megapixels, files of any size: its tiles give the copy where it can; else the file is read and cut.
    const bytes = fromAtlas(file, mime).then((copy) => copy ?? app.vault.readBinary(file).then((whole) => shrink(whole, mime)));
    reduced.set(path, { mtime: file.stat.mtime, bytes });
    // An image that could not be cut down is tried again next time, not remembered as failed.
    bytes.catch(() => { if (reduced.get(path)?.bytes === bytes) reduced.delete(path); });
    return (await bytes).slice(0);
  };
  return {
    reducesLarge: true,
    stat: (path: string): ImageFileStat | null => {
      const file = fileAt(path);
      return file ? { size: file.stat.size, mtime: file.stat.mtime } : null;
    },
    read: async (path: string, raw?: boolean): Promise<ArrayBuffer> => {
      const file = fileAt(path);
      if (!file) throw new Error('The image is no longer in the vault');
      if (raw) return app.vault.readBinary(file);
      if (!isVideoPath(path)) {
        const mime = mimeForPath(path);
        if (file.stat.size > ASSET_LIMITS.fileBytes && mime !== null && isRasterMime(mime)) return reducedCopy(path, file, mime);
        const whole = await app.vault.readBinary(file);
        // Mosaic Canvas keeps maps a phone could not decode in files under the limit (a 1,000 megapixel JPEG): those go as the copy too.
        if (mime !== null && isRasterMime(mime) && file.stat.size >= MEASURED_FROM_BYTES && await manyPixels(path, file, whole)) return reducedCopy(path, file, mime);
        return whole;
      }
      // An animated map: its first frame, read from the video where it lies, never the video itself.
      const kept = stills.get(path);
      // A copy each time: the bytes of a still may go to a transfer that takes them.
      if (kept?.mtime === file.stat.mtime) return (await kept.bytes).slice(0);
      const bytes = videoStill(activeDocument, app.vault.getResourcePath(file));
      stills.set(path, { mtime: file.stat.mtime, bytes });
      // A video that cannot give a frame is asked again next time, not remembered as failed.
      bytes.catch(() => { if (stills.get(path)?.bytes === bytes) stills.delete(path); });
      return (await bytes).slice(0);
    },
    onChange: (listener: (path: string) => void): (() => void) => {
      const { vault } = app;
      const refs = [
        vault.on('modify', (file) => listener(file.path)),
        vault.on('delete', (file) => listener(file.path)),
        vault.on('rename', (file, oldPath) => { listener(oldPath); listener(file.path); }),
      ];
      return () => { refs.forEach((ref) => vault.offref(ref)); };
    },
  };
}
