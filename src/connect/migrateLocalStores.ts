/**
 * What the fork kept on this device outside the vault, under its own names: the player's device key per table
 * (Obsidian's local storage) and the images kept from joined sessions (IndexedDB). Connect uses its own names, so
 * both are copied over once; the fork's are left as they were. The join page's own images, kept by the browser for
 * the page's address, are the page's to keep and are not reached from here.
 */
import { isAssetId, isAssetMime, isArrayBuffer } from '../app/online/assets/assetIds';
import type { ImageStore } from '../app/online/assets/AssetCache';
import { IMAGES_DB_NAME } from '../app/online/assets/indexedDbImageStore';
import { isRecord } from '../app/online/onlineSettings';
import { FORK_NAME } from '../app/online/page/pageStorage';
import { DEVICE_KEYS_STORAGE, isKeyPairJwk, type KeyValueStore } from '../app/online/sharing/identity/deviceKeys';

export const FORK_DEVICE_KEYS_STORAGE = `${FORK_NAME}-device-keys`;
export const FORK_IMAGES_DB_NAME = `${FORK_NAME}-images`;

/**
 * Adds the fork's device key of each table this device has no key for yet, so the GM still knows this device when it
 * joins again; a key Connect made itself wins. Malformed entries are dropped. Returns how many keys were added.
 */
export function migrateDeviceKeys(store: KeyValueStore): number {
  const fork = store.get(FORK_DEVICE_KEYS_STORAGE);
  if (!isRecord(fork)) return 0;
  const stored = store.get(DEVICE_KEYS_STORAGE);
  const own = isRecord(stored) ? stored : {};
  const added = Object.entries(fork).filter(([table, keys]) => table.length <= 200 && !isKeyPairJwk(own[table]) && isKeyPairJwk(keys));
  if (added.length > 0) store.set(DEVICE_KEYS_STORAGE, { ...own, ...Object.fromEntries(added) });
  return added.length;
}

export interface ImageCacheDeps {
  /** Whether a database of this name exists (opening one would create it). */
  exists(name: string): Promise<boolean>;
  open(name: string): Promise<ImageStore | null>;
}

/** Obsidian's IndexedDB; `databases()` tells whether the fork's database is there without making it. */
export function indexedDbImageCaches(open: (name: string) => Promise<ImageStore | null>): ImageCacheDeps {
  return {
    exists: async (name) => typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
      && (await indexedDB.databases()).some((database) => database.name === name),
    open,
  };
}

/**
 * Copies the fork's kept images that Connect's cache lacks, checking each as the cache does on reading. Best effort:
 * these can be downloaded again, so any failure stops the copy quietly. Returns how many images were copied.
 */
export async function migrateImageCache(deps: ImageCacheDeps): Promise<number> {
  let fork: ImageStore | null = null;
  let own: ImageStore | null = null;
  let copied = 0;
  try {
    if (!(await deps.exists(FORK_IMAGES_DB_NAME))) return 0;
    fork = await deps.open(FORK_IMAGES_DB_NAME);
    own = fork ? await deps.open(IMAGES_DB_NAME) : null;
    if (!fork || !own) return 0;
    const have = new Set((await own.entries()).map((entry) => entry.id));
    for (const entry of await fork.entries()) {
      if (!isRecord(entry) || !isAssetId(entry.id) || have.has(entry.id) || typeof entry.shownAt !== 'number' || !Number.isFinite(entry.shownAt)) continue;
      const image = await fork.get(entry.id);
      if (!image || image.id !== entry.id || !isAssetMime(image.mime) || !isArrayBuffer(image.bytes)) continue;
      await own.put({ id: image.id, mime: image.mime, bytes: image.bytes }, entry.shownAt);
      copied++;
    }
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not copy the images kept by the preview:', error);
  } finally {
    fork?.close?.();
    own?.close?.();
  }
  return copied;
}
