/**
 * Runs the migration from the fork when Connect binds to Atlas, step by step until every step is marked: the device
 * keys at once (before joining can make new ones), the settings and the sharing folder once Connect's storage folder
 * is known, then the kept images in the background. Hosting and sharing wait until the settings and the folder are
 * in (`migrationGate`), so nothing of Connect's is written where the fork's data is still to arrive.
 */
import { Notice, type App, type Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import { openIndexedDbImageStore } from '../app/online/assets/indexedDbImageStore';
import { obsidianLocalStore } from '../app/online/sharing/identity/deviceKeys';
import { need } from './capabilities';
import { migrateFromFork, MIGRATED_NOTICE, type MigrationSettings } from './migrateFromFork';
import { FORK_SETTINGS_FILE, migrateForkSettings } from './migrateForkSettings';
import { indexedDbImageCaches, migrateDeviceKeys, migrateImageCache, type ImageCacheDeps } from './migrateLocalStores';

export const RETRY_COMMAND = { id: 'bring-over-preview-data', name: "Bring over the online preview's data again" } as const;
const FAILED = "Atlas VTT Connect couldn't bring over the preview's online play data, so hosting and sharing are off for now.";
const AGAIN = `To try again, run "${RETRY_COMMAND.name}" or restart Obsidian.`;

export interface MigrationStart {
  /** Where the notices go; Obsidian's notices by default. */
  notify?: (message: string) => void;
  /** The image caches; Obsidian's IndexedDB by default. */
  images?: ImageCacheDeps;
  /** See `ForkSettingsDeps.rereadDelayMs`. */
  rereadDelayMs?: number;
}

/** What the user can do about a failure, from its cause. */
export function failureNotice(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const hint = code === 'ENOSPC' ? 'Free some disk space.'
    : code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'EROFS' ? "Check that the vault's files can be written and aren't open elsewhere."
      : error === 'settings' ? `Check that ${FORK_SETTINGS_FILE} is whole (Atlas VTT rewrites it as settings change).`
        : 'The developer console has the details.';
  return `${FAILED} ${hint} ${AGAIN}`;
}

/** One run at a time per store: an Atlas reload or the command while it runs waits for the same run. */
const running = new WeakMap<MigrationSettings, Promise<boolean>>();

function copyImages(settings: MigrationSettings, images: ImageCacheDeps | undefined): void {
  if (settings.forkStepDone('images')) return;
  // Read after the settings step: the preview's choice, once it is in.
  if (!settings.get().keepImages) {
    settings.markForkStep('images');
    return;
  }
  void migrateImageCache(images ?? indexedDbImageCaches(openIndexedDbImageStore)).then((copied) => {
    if (copied !== null) settings.markForkStep('images');
  });
}

/** True when hosting and sharing may start: the settings and the sharing folder are in. */
async function migrateVault(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings, start: MigrationStart, notify: (message: string) => void): Promise<boolean> {
  const storage = need(api, atlas, 'storage');
  try {
    if (!storage) {
      // No hosting or sharing to wait for, nowhere for the folder: the settings still come over.
      const step = await migrateForkSettings({ adapter: app.vault.adapter, settings, ...(start.rereadDelayMs === undefined ? {} : { rereadDelayMs: start.rereadDelayMs }) });
      if (step.result === 'copied') notify(MIGRATED_NOTICE);
    } else if (!settings.migratedFromFork) {
      await migrateFromFork({
        adapter: app.vault.adapter, settings, storageFolder: await storage.folder(), scenes: need(api, atlas, 'scenes'), notify,
        ...(start.rereadDelayMs === undefined ? {} : { rereadDelayMs: start.rereadDelayMs }),
      });
    }
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not bring over the preview\'s online play data:', error);
    notify(failureNotice(error));
    return false;
  }
  copyImages(settings, start.images);
  if (settings.forkStepDone('settings')) return true;
  notify(failureNotice('settings'));
  return false;
}

/** Runs the steps not done yet; resolves true once hosting and sharing may start. Without `settings` there is nothing to bring. */
export function startMigration(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings | undefined, start: MigrationStart = {}): Promise<boolean> {
  if (!settings) return Promise.resolve(true);
  const existing = running.get(settings);
  if (existing) return existing;
  if (!settings.forkStepDone('keys')) {
    migrateDeviceKeys(obsidianLocalStore(app));
    settings.markForkStep('keys');
  }
  if (settings.migratedFromFork && settings.forkStepDone('images')) return Promise.resolve(true);
  const notify = start.notify ?? ((message: string): void => { new Notice(message); });
  const run = migrateVault(app, api, atlas, settings, start, notify).finally(() => { running.delete(settings); });
  running.set(settings, run);
  return run;
}

/**
 * `ready` resolves once a run lets hosting and sharing start. Until then the command "Bring over the online preview's
 * data again" runs the steps not done yet; `stop` takes it off (the binding ended).
 */
export function migrationGate(plugin: Plugin, run: () => Promise<boolean>): { ready: Promise<void>; stop: Disposer } {
  let open: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { open = resolve; });
  let stopped = false;
  let offered = false;
  const attempt = async (): Promise<void> => {
    const ok = await run();
    if (stopped) return;
    if (ok) {
      if (offered) plugin.removeCommand(RETRY_COMMAND.id);
      offered = false;
      open();
    } else if (!offered) {
      offered = true;
      plugin.addCommand({ ...RETRY_COMMAND, callback: () => { void attempt(); } });
    }
  };
  void attempt();
  return {
    ready,
    stop: () => {
      stopped = true;
      if (offered) plugin.removeCommand(RETRY_COMMAND.id);
    },
  };
}
