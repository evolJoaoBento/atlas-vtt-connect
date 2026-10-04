/**
 * Connect's sharing data, in the extension folder Atlas keeps for it (`atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/`,
 * see `sharingPaths`): a dot folder, which Obsidian does not index, so neither the vault check nor search ever sees it.
 * Read and written through the adapter. A file's writes are queued, so it always ends as the last value saved.
 */
import type { DataAdapter } from 'obsidian';
import { ensureAdapterFolder } from '../../plugin/vaultFolders';

export type DataAdapterLike = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'mkdir' | 'remove' | 'copy'>;

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

export async function writeText(adapter: DataAdapterLike, path: string, text: string): Promise<void> {
  await ensureAdapterFolder({ vault: { adapter } }, parentOf(path));
  await adapter.write(path, text);
}

/** The file's text; null when there is none or it cannot be read. */
export async function readText(adapter: DataAdapterLike, path: string): Promise<string | null> {
  try {
    return (await adapter.exists(path)) ? await adapter.read(path) : null;
  } catch {
    return null;
  }
}

export async function removeFile(adapter: DataAdapterLike, path: string): Promise<void> {
  if (await adapter.exists(path)) await adapter.remove(path);
}

/** Where an unreadable file is kept before its first save replaces it: `people.json` becomes `people.broken.json`. */
export const brokenCopyPath = (path: string): string => path.replace(/\.json$/, '') + '.broken.json';

export class JsonDataFile<T> {
  private queue: Promise<void> = Promise.resolve();
  /** Set when the stored file could not be read, until it is copied aside once: its text, or null when even reading it failed. */
  private unreadable: { text: string | null } | null = null;

  /** `parse` turns whatever is stored (null for nothing) into a value, dropping what it cannot read. */
  constructor(private readonly adapter: DataAdapterLike, readonly path: string, private readonly parse: (value: unknown) => T) {}

  async load(): Promise<T> {
    let text: string | null;
    try {
      text = (await this.adapter.exists(this.path)) ? await this.adapter.read(this.path) : null;
    } catch (error) {
      console.error(`[Atlas VTT Connect] ${this.path} could not be read; starting from empty, a copy is kept next to it.`, error);
      this.unreadable = { text: null };
      return this.parse(null);
    }
    if (text === null) return this.parse(null);
    try {
      return this.parse(JSON.parse(text));
    } catch (error) {
      console.error(`[Atlas VTT Connect] ${this.path} is not readable; starting from empty, a copy is kept next to it.`, error);
      this.unreadable = { text };
      return this.parse(null);
    }
  }

  save(value: T): Promise<void> {
    const text = JSON.stringify(value, null, 2);
    this.queue = this.queue
      .then(async () => {
        await this.keepUnreadable();
        await writeText(this.adapter, this.path, text);
      })
      .catch((error: unknown) => console.error(`[Atlas VTT Connect] Could not save ${this.path}:`, error));
    return this.queue;
  }

  /**
   * Before the first save replaces an unreadable file, once: it is copied to `<name>.broken.json`,
   * which is never overwritten. When the copy fails the save fails too, and is tried again next time.
   */
  private async keepUnreadable(): Promise<void> {
    const unreadable = this.unreadable;
    if (unreadable === null) return;
    const copy = brokenCopyPath(this.path);
    if (!(await this.adapter.exists(copy))) {
      if (unreadable.text !== null) await writeText(this.adapter, copy, unreadable.text);
      else await this.adapter.copy(this.path, copy);
    }
    this.unreadable = null;
  }
}
