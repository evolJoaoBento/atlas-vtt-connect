/**
 * Runs the migration from the fork once per vault, when Connect binds to Atlas: the device keys at once (before
 * joining can make new ones), the kept images in the background, and the rest once Connect's storage folder is
 * known. Hosting and sharing wait for it, so nothing of Connect's is written where the fork's data is still to arrive.
 */
import { Notice, type App } from 'obsidian';
import type { AtlasApi, AtlasExtension } from '@atlas-vtt/api-types';
import { openIndexedDbImageStore } from '../app/online/assets/indexedDbImageStore';
import { obsidianLocalStore } from '../app/online/sharing/identity/deviceKeys';
import { need } from './capabilities';
import { migrateFromFork, type MigrationSettings } from './migrateFromFork';
import { indexedDbImageCaches, migrateDeviceKeys, migrateImageCache, type ImageCacheDeps } from './migrateLocalStores';

export const MIGRATION_FAILED_NOTICE = "Atlas VTT Connect couldn't bring over the preview's online play data, so hosting and sharing are off for now. It tries again the next time it starts.";

export interface MigrationStart {
  /** Where the notices go; Obsidian's notices by default. */
  notify?: (message: string) => void;
  /** The image caches; Obsidian's IndexedDB by default. */
  images?: ImageCacheDeps;
}

/** One run at a time per store: an Atlas reload while it runs waits for the same run. */
const running = new WeakMap<MigrationSettings, Promise<boolean>>();

async function migrateVault(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings, notify: (message: string) => void): Promise<boolean> {
  const storage = need(api, atlas, 'storage');
  // Without storage there is no hosting or sharing to wait, and nowhere to bring the data: a newer Atlas runs it.
  if (!storage) return true;
  try {
    await migrateFromFork({ adapter: app.vault.adapter, settings, storageFolder: await storage.folder(), scenes: need(api, atlas, 'scenes'), notify });
    return true;
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not bring over the preview\'s online play data:', error);
    notify(MIGRATION_FAILED_NOTICE);
    return false;
  }
}

/**
 * Resolves true once hosting and sharing may start: the migration is done (or not needed), false when it failed.
 * Without `settings` (nothing to migrate into) it resolves true at once.
 */
export function startMigration(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings | undefined, start: MigrationStart = {}): Promise<boolean> {
  if (!settings || settings.migratedFromFork) return Promise.resolve(true);
  const existing = running.get(settings);
  if (existing) return existing;
  const notify = start.notify ?? ((message: string): void => { new Notice(message); });
  // Read now, before joining starts: a name typed into a join while the folder is asked for must not count as Connect's own settings.
  const hasOnline = settings.hasOnline;
  const store: MigrationSettings = {
    get: () => settings.get(), set: (partial) => settings.set(partial), hasOnline,
    migratedFromFork: settings.migratedFromFork, markMigrated: () => settings.markMigrated(),
  };
  migrateDeviceKeys(obsidianLocalStore(app));
  if (settings.get().keepImages) void migrateImageCache(start.images ?? indexedDbImageCaches(openIndexedDbImageStore));
  const run = migrateVault(app, api, atlas, store, notify).finally(() => { running.delete(settings); });
  running.set(settings, run);
  return run;
}
