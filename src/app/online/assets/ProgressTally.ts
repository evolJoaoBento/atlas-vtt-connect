/**
 * The loading bar's numbers for `AssetLoader`: bytes of images finished since
 * the bar was last empty, and which image they came from, so a failed attempt
 * takes back exactly what it added and nothing after a reset.
 */

/** What the loading bar shows: images still coming for this scene, and their bytes. */
export interface AssetProgress {
  outstanding: number;
  receivedBytes: number;
  totalBytes: number;
}

/** One image still coming: bytes received so far, and the size it announced (null before). */
export interface PendingImage {
  received: number;
  size: number | null;
}

export class ProgressTally {
  private doneBytes = 0;
  private readonly counted = new Map<string, number>();

  /** An image finished arriving. */
  add(id: string, bytes: number): void {
    this.take(id);
    this.counted.set(id, bytes);
    this.doneBytes += bytes;
  }

  /** The attempt failed: take back what it added, if the bar still has it. */
  take(id: string): void {
    this.doneBytes -= this.counted.get(id) ?? 0;
    this.counted.delete(id);
  }

  /** The image left the scene: its bytes stay in the bar but can no longer be taken back. */
  forget(id: string): void {
    this.counted.delete(id);
  }

  /** The bar starts over: nothing finished is remembered. */
  reset(): void {
    this.doneBytes = 0;
    this.counted.clear();
  }

  progress(pending: Iterable<PendingImage>): AssetProgress {
    let outstanding = 0;
    let receivedBytes = this.doneBytes;
    let totalBytes = this.doneBytes;
    for (const image of pending) {
      outstanding++;
      receivedBytes += image.received;
      totalBytes += image.size ?? 0;
    }
    return outstanding === 0 ? { outstanding: 0, receivedBytes: 0, totalBytes: 0 } : { outstanding, receivedBytes, totalBytes };
  }
}
