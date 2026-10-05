/**
 * Brings over what the fork's online play preview kept in the vault, for someone moving to upstream Atlas plus
 * Connect: its online settings (table key included, `migrateForkSettings`), its sharing folder (people, shares, pulls,
 * `migrateSharingFolder`), and a count of the scenes with Connect's data, where Atlas itself moved the map shares.
 * Never destructive: Atlas's plugin data and settings file are only read, the fork's folder only copied. Each step is marked once done
 * and never runs again, so a run cut short repeats only what it had not finished; once all are, the store is migrated.
 */
import type { ScenesApi } from '@atlas-vtt/api-types';
import { sharingPaths } from '../app/online/sharing/sharingPaths';
import { migrateForkSettings, type ForkSettingsStore, type Step } from './migrateForkSettings';
import { FORK_SHARING_DIR, migrateSharingFolder, removePending, type MigrationAdapter, type SharingMigration } from './migrateSharingFolder';
import type { ConnectSettingsStore } from './settingsStore';

export const MIGRATED_NOTICE = 'Atlas VTT Connect brought over your online play settings, people and shares from the preview.';
/** Added when the sharing folder was copied: the preview's copy stays, and the user should know what it holds. */
export const LEFTOVER_NOTICE = `The preview's copy stays in ${FORK_SHARING_DIR} and still holds the old text of notes shared with you. Delete it once you've checked your people and shares.`;

export type MigrationSettings = ForkSettingsStore & Pick<ConnectSettingsStore, 'migratedFromFork' | 'takeKeyMoved'>;

export interface MigrationDeps {
  adapter: MigrationAdapter;
  /** The vault's configuration folder (`app.vault.configDir`), where Atlas's plugin data is. */
  configDir: string;
  settings: MigrationSettings;
  /** Connect's storage folder (`storage.folder()`). */
  storageFolder: string;
  /** Null on an Atlas older than 1.8, which has not moved the fork's map shares yet. */
  scenes: Pick<ScenesApi, 'list' | 'getData'> | null;
  notify(message: string): void;
  /** See `ForkSettingsDeps.rereadDelayMs`. */
  rereadDelayMs?: number;
}

export interface MigrationReport {
  settings: 'copied' | 'skipped' | 'none';
  sharing: SharingMigration;
  /** Scenes with Connect's data: the fork's map shares Atlas moved, and any Connect wrote since an earlier unfinished run. */
  mapShares: number;
  /** The settings file that was not JSON, when that left the settings step to do. */
  unreadable?: string;
}

/**
 * Atlas moved each scene's legacy `data.sharing` into Connect's scene data when it loaded the index, so there is
 * nothing to write: the scenes with Connect's data are counted, for the report. Without `scenes` Atlas cannot have
 * moved them, and a list that fails says nothing either; both wait for the next run. A scene whose data cannot be read
 * is not counted.
 */
async function countScenesWithData(scenes: MigrationDeps['scenes']): Promise<Step<number>> {
  if (!scenes) return { result: 0, done: false };
  let records;
  try {
    records = await scenes.list();
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not list the scenes to count the shared maps:', error);
    return { result: 0, done: false };
  }
  const data = await Promise.all(records.map((record) => scenes.getData(record.id).catch(() => undefined)));
  return { result: data.filter((value) => value !== undefined && value !== null).length, done: true };
}

/** The sharing step, once: Connect's copy is its own from then on, so files it later removes are never put back. */
async function sharingStep(deps: MigrationDeps): Promise<SharingMigration> {
  const { adapter, settings } = deps;
  if (settings.forkStepDone('sharing')) return 'none';
  const target = sharingPaths(deps.storageFolder).root;
  const sharing = await migrateSharingFolder(adapter, target, (message) => deps.notify(message));
  settings.markForkStep('sharing');
  await removePending(adapter, target);
  return sharing;
}

/** Runs the steps not done yet, in order; rejects when one fails (it runs again next time, the done ones do not). */
export async function migrateFromFork(deps: MigrationDeps): Promise<MigrationReport> {
  const settings = await migrateForkSettings(deps);
  const sharing = await sharingStep(deps);
  const mapShares = deps.settings.forkStepDone('mapShares') ? { result: 0, done: true } : await countScenesWithData(deps.scenes);
  if (mapShares.done) deps.settings.markForkStep('mapShares');
  if (sharing === 'moved') deps.notify(`${MIGRATED_NOTICE} ${LEFTOVER_NOTICE}`);
  else if (settings.result === 'copied' || sharing === 'merged') deps.notify(MIGRATED_NOTICE);
  return { settings: settings.result, sharing, mapShares: mapShares.result, ...(settings.unreadable ? { unreadable: settings.unreadable } : {}) };
}
