/**
 * What the fork kept on this device outside the vault, under its own names: the player's device key per table
 * (Obsidian's local storage) and the images kept from joined sessions (IndexedDB). Connect uses its own names, so
 * both are copied over once; the fork's are left as they were. The join page's own images, kept by the browser for
 * the page's address, are the page's to keep and are not reached from here.
 */
import { ASSET_LIMITS, isAssetId, isAssetMime, isArrayBuffer } from '../app/online/assets/assetIds';
import type { ImageStore } from '../app/online/assets/AssetCache';
import { IMAGES_DB_NAME } from '../app/online/assets/indexedDbImageStore';
import { isRecord } from '../app/online/onlineSettings';
import { FORK_NAME, pageKey } from '../app/online/page/pageStorage';
import { DEVICE_KEYS_STORAGE, isKeyPairJwk, type KeyValueStore } from '../app/online/sharing/identity/deviceKeys';

export const FORK_DEVICE_KEYS_STORAGE = `${FORK_NAME}-device-keys`;
export const FORK_IMAGES_DB_NAME = `${FORK_NAME}-images`;
/** Set in Obsidian's local storage (this vault on this device) once the fork's kept images were copied: each device has its own. */
export const IMAGES_COPIED_KEY = pageKey('fork-images-copied');

export const imagesCopied = (store: KeyValueStore): boolean => store.get(IMAGES_COPIED_KEY) === true;
export const markImagesCopied = (store: KeyValueStore): void => { store.set(IMAGES_COPIED_KEY, true); };

/**
 * Adds the fork's device key of each table this device has no key for yet, so the GM still knows this device when it
 * joins again; a key Connect made itself wins. Malformed entries are dropped. Cheap and safe to repeat, so it runs on
 * every start (no mark: one in the vault's settings would sync to devices whose keys were never merged). Returns how
 * many keys were added.
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
 * Copies the fork's kept images that Connect's cache lacks, the most recently shown first, until Connect's cache would
 * pass its limit; each is checked as the cache does on reading. Best effort: these can be downloaded again, so a
 * failure stops the copy quietly. Returns how many images were copied, or null when the copy failed (tried again later).
 */
export async function migrateImageCache(deps: ImageCacheDeps, limitBytes: number = ASSET_LIMITS.cacheBytes): Promise<number | null> {
  let fork: ImageStore | null = null;
  let own: ImageStore | null = null;
  let copied = 0;
  try {
    if (!(await deps.exists(FORK_IMAGES_DB_NAME))) return 0;
    fork = await deps.open(FORK_IMAGES_DB_NAME);
    own = fork ? await deps.open(IMAGES_DB_NAME) : null;
    if (!fork || !own) return fork ? null : 0;
    const ownEntries = await own.entries();
    const have = new Set(ownEntries.map((entry) => entry.id));
    let used = ownEntries.reduce((total, entry) => total + (Number.isFinite(entry.size) ? entry.size : 0), 0);
    const valid = (await fork.entries()).filter((entry) => isRecord(entry) && isAssetId(entry.id) && !have.has(entry.id)
      && typeof entry.shownAt === 'number' && Number.isFinite(entry.shownAt));
    for (const entry of valid.sort((a, b) => b.shownAt - a.shownAt)) {
      const image = await fork.get(entry.id);
      if (!image || image.id !== entry.id || !isAssetMime(image.mime) || !isArrayBuffer(image.bytes)) continue;
      if (used + image.bytes.byteLength > limitBytes) break;
      await own.put({ id: image.id, mime: image.mime, bytes: image.bytes }, entry.shownAt);
      used += image.bytes.byteLength;
      copied++;
    }
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not copy the images kept by the preview:', error);
    return null;
  } finally {
    fork?.close?.();
    own?.close?.();
  }
  return copied;
}
