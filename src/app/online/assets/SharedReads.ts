/**
 * File bytes shared by the transfers sending a fingerprint at this moment: read
 * once, when the first transfer gets to it, and let go when no transfer sends it
 * any more (a player who asks later reads, and the registry verifies, again).
 */
import type { AssetFile } from '../scene/sceneContracts';

interface Shared {
  holders: number;
  file: Promise<AssetFile | null> | null;
}

export class SharedReads {
  private readonly entries = new Map<string, Shared>();

  constructor(private readonly read: (id: string) => Promise<AssetFile | null>) {}

  hold(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.holders++;
    else this.entries.set(id, { holders: 1, file: null });
  }

  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry && --entry.holders <= 0) this.entries.delete(id);
  }

  /** The file behind a held fingerprint, read on first use; null when it is not held or cannot be served. */
  file(id: string): Promise<AssetFile | null> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve(null);
    entry.file ??= this.read(id).catch(() => null);
    return entry.file;
  }

  clear(): void {
    this.entries.clear();
  }
}
