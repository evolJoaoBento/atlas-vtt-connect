import { createHash } from 'node:crypto';
import type { ImageStore, StoredEntry, StoredImage } from '../../../src/app/online/assets/AssetCache';
import type { ImageFiles } from '../../../src/app/online/scene/sceneContracts';

/** SHA-256 as an asset id, resolved at once: Web Crypto finishes outside fake timers' control. */
export function nodeHash(bytes: ArrayBuffer): Promise<string> {
  return Promise.resolve(createHash('sha256').update(new Uint8Array(bytes)).digest('base64url'));
}

/** The fingerprint the GM gives these bytes, computed independently. */
export function fingerprintOf(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

export interface MemoryImageFiles {
  source: ImageFiles;
  set(path: string, content: Uint8Array | string, mtime?: number): void;
  remove(path: string): void;
  /** Paths read, in order. */
  reads: string[];
  /** Makes reads of `path` fail from now on. */
  fail(path: string): void;
  /** Tells the registry the vault reported a change to `path`. */
  changed(path: string): void;
  /** How many registries are listening. */
  listening(): number;
}

/** Vault images in memory; strings are stored as their UTF-8 bytes. */
export function memoryImageFiles(initial: Record<string, Uint8Array | string> = {}): MemoryImageFiles {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  const failing = new Set<string>();
  const reads: string[] = [];
  const listeners = new Set<(path: string) => void>();
  const set = (path: string, content: Uint8Array | string, mtime = 1): void => {
    files.set(path, { bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content, mtime });
  };
  for (const [path, content] of Object.entries(initial)) set(path, content);
  return {
    source: {
      stat: (path) => {
        const file = files.get(path);
        return file ? { size: file.bytes.byteLength, mtime: file.mtime } : null;
      },
      read: async (path) => {
        reads.push(path);
        const file = files.get(path);
        if (!file || failing.has(path)) throw new Error(`Cannot read ${path}`);
        return file.bytes.slice().buffer;
      },
      onChange: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
    set,
    remove: (path) => { files.delete(path); },
    reads,
    fail: (path) => { failing.add(path); },
    changed: (path) => { [...listeners].forEach((listener) => listener(path)); },
    listening: () => listeners.size,
  };
}

/** `size` bytes of noise; a different `seed` gives a different file. */
export function imageBytes(size: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  let value = seed;
  for (let index = 0; index < size; index++) {
    value = (Math.imul(value, 1103515245) + 12345) >>> 0;
    bytes[index] = value >>> 24;
  }
  return bytes;
}

/** Waits until every pending promise chain settled (real timers only). */
export function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

/** Browser storage in memory; a write over `quota` bytes fails like a full disk. */
export class MemoryStore implements ImageStore {
  readonly images = new Map<string, { image: StoredImage; shownAt: number }>();
  quota = Infinity;
  closed = false;

  close(): void { this.closed = true; }

  private used(): number {
    let total = 0;
    for (const { image } of this.images.values()) total += image.bytes.byteLength;
    return total;
  }
  async get(id: string): Promise<StoredImage | null> { return this.images.get(id)?.image ?? null; }
  async put(image: StoredImage, shownAt: number): Promise<void> {
    const replaced = this.images.get(image.id)?.image.bytes.byteLength ?? 0;
    if (this.used() - replaced + image.bytes.byteLength > this.quota) throw new Error('QuotaExceededError');
    this.images.set(image.id, { image, shownAt });
  }
  async touch(id: string, shownAt: number): Promise<void> {
    const entry = this.images.get(id);
    if (entry) entry.shownAt = shownAt;
  }
  async delete(ids: readonly string[]): Promise<void> { for (const id of ids) this.images.delete(id); }
  async entries(): Promise<StoredEntry[]> {
    return [...this.images.values()].map(({ image, shownAt }) => ({ id: image.id, size: image.bytes.byteLength, shownAt }));
  }
  async clear(): Promise<void> { this.images.clear(); }
}
