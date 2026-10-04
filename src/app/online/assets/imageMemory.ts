import type { StoredImage } from './AssetCache';

interface Remembered {
  image: StoredImage;
  shownAt: number;
}

/** The images of this visit kept in memory under a byte cap, the least recently shown dropped first (the cache's fallback when nothing is stored). */
export class ImageMemory {
  private readonly images = new Map<string, Remembered>();
  private bytes = 0;

  constructor(private readonly limit: number) {}

  /** The image, counted as shown at `now`; null when not held. */
  get(id: string, now: number): StoredImage | null {
    const held = this.images.get(id);
    if (!held) return null;
    held.shownAt = now;
    return held.image;
  }

  remember(image: StoredImage, now: number): void {
    const size = image.bytes.byteLength;
    const held = this.images.get(image.id);
    if (held) {
      held.shownAt = now;
      return;
    }
    if (size > this.limit) return;
    for (const [id, old] of [...this.images].sort(([, a], [, b]) => a.shownAt - b.shownAt)) {
      if (this.bytes + size <= this.limit) break;
      this.images.delete(id);
      this.bytes -= old.image.bytes.byteLength;
    }
    this.images.set(image.id, { image, shownAt: now });
    this.bytes += size;
  }

  clear(): void {
    this.images.clear();
    this.bytes = 0;
  }
}
