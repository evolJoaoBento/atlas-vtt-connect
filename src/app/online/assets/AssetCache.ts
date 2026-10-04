/**
 * The images a player keeps. With keeping on and storage available, finished
 * images are stored in the browser (`ImageStore`: IndexedDB on the join page)
 * up to 500 MB, the least recently shown dropped first; otherwise, and when
 * storing keeps failing, they are kept in memory for the visit under the same
 * cap. Shared with the web player page.
 */
import { ASSET_LIMITS, isArrayBuffer, isAssetId, isAssetMime, type AssetMime } from './assetIds';
import { ImageMemory } from './imageMemory';

export interface StoredImage {
  id: string;
  mime: AssetMime;
  bytes: ArrayBuffer;
}

export interface StoredEntry {
  id: string;
  size: number;
  /** When the image was last shown; the smallest goes first. */
  shownAt: number;
}

/** Persistent image storage: `openIndexedDbImageStore` on the join page, a map in tests. Any call may reject. */
export interface ImageStore {
  get(id: string): Promise<StoredImage | null>;
  put(image: StoredImage, shownAt: number): Promise<void>;
  touch(id: string, shownAt: number): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
  entries(): Promise<StoredEntry[]>;
  clear(): Promise<void>;
  /** Lets go of the connection to the storage; later calls reject. */
  close?(): void;
}

export interface AssetCacheState {
  keep: boolean;
  /** False when the browser cannot store images: private window, blocked storage, full disk. */
  available: boolean;
  /** Bytes of images stored on this device. */
  usedBytes: number;
}

export interface AssetCacheOptions {
  keep: boolean;
  /** Null when there is no storage; may reject. */
  openStore(): Promise<ImageStore | null>;
  now?: () => number;
  limitBytes?: number;
}

function isStoredEntry(value: unknown): value is StoredEntry {
  const entry = value as Partial<StoredEntry> | null;
  return typeof entry === 'object' && entry !== null && isAssetId(entry.id)
    && typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0
    && typeof entry.shownAt === 'number' && Number.isFinite(entry.shownAt);
}

export class AssetCache {
  private store: ImageStore | null = null;
  /** What the store holds, without the bytes. */
  private readonly entries = new Map<string, StoredEntry>();
  private readonly memory: ImageMemory;
  private current: AssetCacheState;
  private readonly listeners = new Set<(state: AssetCacheState) => void>();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly ready: Promise<void>;
  private disposed = false;
  /** The last queued storage-changing call. */
  private tail: Promise<void>;

  constructor(private readonly options: AssetCacheOptions) {
    this.now = options.now ?? Date.now;
    this.limit = options.limitBytes ?? ASSET_LIMITS.cacheBytes;
    this.memory = new ImageMemory(this.limit);
    this.current = { keep: options.keep, available: true, usedBytes: 0 };
    this.ready = this.open();
    this.tail = this.ready.catch(() => undefined);
  }

  get state(): AssetCacheState {
    return this.current;
  }

  onChange(listener: (state: AssetCacheState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** An image this device has, from memory or storage; it counts as shown now. */
  async get(id: string): Promise<StoredImage | null> {
    await this.ready;
    const now = this.now();
    const remembered = this.memory.get(id, now);
    if (remembered) return remembered;
    const store = this.store;
    if (!this.entries.has(id) || !store) return null;
    let image: StoredImage | null = null;
    try {
      image = await store.get(id);
    } catch {
      return null;
    }
    if (image && image.id === id && isArrayBuffer(image.bytes) && isAssetMime(image.mime)) {
      void this.run(() => this.touchStored(store, id, now));
      return image;
    }
    // The row says it is there but the storage has no usable image: forget the phantom.
    void this.run(() => this.forget(store, id));
    return null;
  }

  /** Keeps a finished image: stored when keeping is on and storage works, otherwise in memory. */
  put(image: StoredImage): Promise<void> {
    return this.run(async () => {
      if (this.disposed) return;
      const now = this.now();
      const store = this.store;
      if (this.current.keep && this.current.available && store && await this.storeImage(store, image, now)) return;
      this.memory.remember(image, now);
    });
  }

  /** Switching keeping off deletes the stored images; images of this visit in memory stay. */
  setKeep(keep: boolean): Promise<void> {
    return this.run(async () => {
      if (keep === this.current.keep) return;
      this.update({ keep });
      if (!keep) await this.clearStore();
    });
  }

  /** "Clear saved images": empties the storage; images of this visit in memory stay. */
  clearSaved(): Promise<void> {
    return this.run(() => this.clearStore());
  }

  /** The cache is no longer used: forgets the images in memory and closes the storage. Stored images stay for the next visit. */
  dispose(): Promise<void> {
    this.disposed = true;
    this.memory.clear();
    this.listeners.clear();
    return this.run(async () => {
      this.memory.clear();
      this.entries.clear();
      try {
        this.store?.close?.();
      } catch {
        // Already closed.
      }
      this.store = null;
    });
  }

  /** Runs storage-changing work one call at a time, in call order, so limits and keeping hold. */
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async touchStored(store: ImageStore, id: string, now: number): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.shownAt = now;
    try {
      await store.touch(id, now);
    } catch {
      // Only the order of dropping is affected.
    }
  }

  private async forget(store: ImageStore, id: string): Promise<void> {
    if (!this.entries.delete(id)) return;
    try {
      await store.delete([id]);
    } catch {
      // The row is gone from the count either way.
    }
    this.update({ usedBytes: this.storedBytes() });
  }

  private async open(): Promise<void> {
    try {
      const store = await this.options.openStore();
      if (store) {
        for (const entry of await store.entries()) if (isStoredEntry(entry)) this.entries.set(entry.id, entry);
        this.store = store;
      }
    } catch {
      this.store = null;
      this.entries.clear();
    }
    if (!this.store) {
      this.update({ available: false });
      return;
    }
    // Keeping was switched off in a visit that could not delete what was stored.
    if (!this.current.keep && this.entries.size > 0) await this.clearStore();
    else await this.evict(this.store, this.limit);
    this.update({ usedBytes: this.storedBytes() });
  }

  private async storeImage(store: ImageStore, image: StoredImage, now: number): Promise<boolean> {
    const size = image.bytes.byteLength;
    if (size > this.limit) return false;
    if (this.entries.has(image.id)) {
      await this.touchStored(store, image.id, now);
      return true;
    }
    await this.evict(store, this.limit - size);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await store.put(image, now);
        this.entries.set(image.id, { id: image.id, size, shownAt: now });
        this.update({ usedBytes: this.storedBytes() });
        return true;
      } catch {
        // Full: drop the least recently shown to make room for this image, then try once more.
        if (attempt === 0) await this.evict(store, this.storedBytes() - size);
      }
    }
    this.update({ available: false, usedBytes: this.storedBytes() });
    return false;
  }

  /** Drops the least recently shown stored images until at most `target` bytes are stored. */
  private async evict(store: ImageStore, target: number): Promise<void> {
    let used = this.storedBytes();
    if (used <= target) return;
    const drop: string[] = [];
    for (const entry of [...this.entries.values()].sort((a, b) => a.shownAt - b.shownAt)) {
      if (used <= target) break;
      drop.push(entry.id);
      used -= entry.size;
    }
    try {
      await store.delete(drop);
    } catch {
      return;
    }
    for (const id of drop) this.entries.delete(id);
  }

  private async clearStore(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.clear();
      this.entries.clear();
    } catch {
      // Left as it was: the space shown stays true.
    }
    this.update({ usedBytes: this.storedBytes() });
  }

  private storedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.size;
    return total;
  }

  private update(partial: Partial<AssetCacheState>): void {
    const next: AssetCacheState = { ...this.current, ...partial };
    const same = next.keep === this.current.keep && next.available === this.current.available && next.usedBytes === this.current.usedBytes;
    if (same) return;
    this.current = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch {
        // A faulty listener must not break storing.
      }
    }
  }
}
