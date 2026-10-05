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
import { KEY_MOVED_NOTICE } from './newTableKey';
import { need } from './capabilities';
import { migrateFromFork, MIGRATED_NOTICE, type MigrationSettings } from './migrateFromFork';
import { FORK_SETTINGS_FILE, migrateForkSettings } from './migrateForkSettings';
import { imagesCopied, indexedDbImageCaches, markImagesCopied, migrateDeviceKeys, migrateImageCache, type ImageCacheDeps } from './migrateLocalStores';
import type { KeyValueStore } from '../app/online/sharing/identity/deviceKeys';

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

/** What the user can do about a failure, from its cause; `file` names the settings file that was not whole. */
export function failureNotice(error: unknown, file = FORK_SETTINGS_FILE): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const hint = code === 'ENOSPC' ? 'Free some disk space.'
    : code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'EROFS' ? "Check that the vault's files can be written and aren't open elsewhere."
      : error === 'settings' ? `Check that ${file} is whole (Atlas VTT rewrites it as settings change).`
        : 'The developer console has the details.';
  return `${FAILED} ${hint} ${AGAIN}`;
}

/** One run at a time per store: an Atlas reload or the command while it runs waits for the same run. */
const running = new WeakMap<MigrationSettings, Promise<boolean>>();

/** The fork's kept images on this device, once per device (the mark is in `local`, this device's storage). */
function copyImages(settings: MigrationSettings, local: KeyValueStore, images: ImageCacheDeps | undefined): void {
  if (imagesCopied(local)) return;
  // Read after the settings step: the preview's choice, once it is in.
  if (!settings.get().keepImages) {
    markImagesCopied(local);
    return;
  }
  void migrateImageCache(images ?? indexedDbImageCaches(openIndexedDbImageStore)).then((copied) => {
    if (copied !== null) markImagesCopied(local);
  });
}

/**
 * An Atlas without storage can neither host nor share, so nothing waits and there is nothing to retry: the settings
 * come over if they can, and a step that could not finish runs again next start, without a notice.
 */
async function migrateSettingsOnly(app: App, settings: MigrationSettings, start: MigrationStart, notify: (message: string) => void): Promise<void> {
  try {
    const step = await migrateForkSettings({ adapter: app.vault.adapter, configDir: app.vault.configDir, settings, ...(start.rereadDelayMs === undefined ? {} : { rereadDelayMs: start.rereadDelayMs }) });
    if (step.result === 'copied') notify(MIGRATED_NOTICE);
    if (settings.takeKeyMoved()) notify(KEY_MOVED_NOTICE);
  } catch (error) {
    console.error("[Atlas VTT Connect] Could not bring over the preview's online settings; tried again next start:", error);
  }
}

/** True when hosting and sharing may start: the settings and the sharing folder are in. */
async function migrateVault(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings, start: MigrationStart, notify: (message: string) => void): Promise<boolean> {
  const storage = need(api, atlas, 'storage');
  const local = obsidianLocalStore(app);
  if (!storage) {
    await migrateSettingsOnly(app, settings, start, notify);
    copyImages(settings, local, start.images);
    return true;
  }
  let unreadable: string | undefined;
  try {
    if (!settings.migratedFromFork) {
      ({ unreadable } = await migrateFromFork({
        adapter: app.vault.adapter, configDir: app.vault.configDir, settings, storageFolder: await storage.folder(), scenes: need(api, atlas, 'scenes'), notify,
        ...(start.rereadDelayMs === undefined ? {} : { rereadDelayMs: start.rereadDelayMs }),
      }));
    }
    if (settings.takeKeyMoved()) notify(KEY_MOVED_NOTICE);
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not bring over the preview\'s online play data:', error);
    notify(failureNotice(error));
    return false;
  }
  copyImages(settings, local, start.images);
  if (settings.forkStepDone('settings')) return true;
  notify(failureNotice('settings', unreadable));
  return false;
}

/** Runs the steps not done yet; resolves true once hosting and sharing may start. Without `settings` there is nothing to bring. */
export function startMigration(app: App, api: AtlasApi, atlas: AtlasExtension, settings: MigrationSettings | undefined, start: MigrationStart = {}): Promise<boolean> {
  if (!settings) return Promise.resolve(true);
  const existing = running.get(settings);
  if (existing) return existing;
  // Every start: cheap, safe to repeat, and on this device only.
  migrateDeviceKeys(obsidianLocalStore(app));
  if (settings.migratedFromFork && imagesCopied(obsidianLocalStore(app))) return Promise.resolve(true);
  const notify = start.notify ?? ((message: string): void => { new Notice(message); });
  const run = migrateVault(app, api, atlas, settings, start, notify).finally(() => { running.delete(settings); });
  running.set(settings, run);
  return run;
}

/**
 * `ready` resolves true once a run lets hosting and sharing start, and false when the binding ends first (`stop`), so
 * nothing waits on it for good. Until then the command "Bring over the online preview's data again" runs the steps not
 * done yet; `stop` takes it off.
 */
export function migrationGate(plugin: Plugin, run: () => Promise<boolean>): { ready: Promise<boolean>; stop: Disposer } {
  let settle: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => { settle = resolve; });
  let stopped = false;
  let offered = false;
  const attempt = async (): Promise<void> => {
    const ok = await run();
    if (stopped) return;
    if (ok) {
      if (offered) plugin.removeCommand(RETRY_COMMAND.id);
      offered = false;
      settle(true);
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
      settle(false);
    },
  };
}
