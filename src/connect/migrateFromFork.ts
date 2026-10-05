/**
 * Brings over what the fork's online play preview kept, for someone moving to upstream Atlas plus Connect: its online
 * settings (table key included), its sharing folder (people, shares, pulls), and a count of the map shares Atlas moved
 * into Connect's scene data itself. Idempotent, and never destructive: Atlas's settings file is only read, the fork's
 * folder only copied. The store is marked migrated only after every step succeeded, so a run cut short starts again.
 */
import type { ScenesApi } from '@atlas-vtt/api-types';
import { isRecord, resolveOnlineSettings } from '../app/online/onlineSettings';
import { sharingPaths } from '../app/online/sharing/sharingPaths';
import { migrateSharingFolder, type MigrationAdapter, type SharingMigration } from './migrateSharingFolder';
import { movedPlayerPage, type ConnectSettingsStore } from './settingsStore';

/** Atlas's settings file, where the fork kept its `online` settings. Atlas rewrites it on a debounce; Connect never writes it. */
export const FORK_SETTINGS_FILE = 'atlas-vtt/.atlas-data/settings.json';
export const MIGRATED_NOTICE = 'Atlas VTT Connect brought over your online play settings, people and shares from the preview.';

export type MigrationSettings = Pick<ConnectSettingsStore, 'get' | 'set' | 'hasOnline' | 'migratedFromFork' | 'markMigrated'>;

export interface MigrationDeps {
  adapter: MigrationAdapter;
  settings: MigrationSettings;
  /** Connect's storage folder (`storage.folder()`). */
  storageFolder: string;
  /** Null on an Atlas older than 1.8, which has not moved the fork's map shares yet. */
  scenes: Pick<ScenesApi, 'list' | 'getData'> | null;
  notify(message: string): void;
}

export interface MigrationReport {
  settings: 'copied' | 'skipped' | 'none';
  sharing: SharingMigration;
  mapShares: number;
}

interface Step<T> {
  result: T;
  /** False when this run could not finish the step for now (the next run tries again); true otherwise. */
  done: boolean;
}

/** Copies the fork's online settings into a store that has none of its own; Atlas's file is never written. */
async function migrateSettings({ adapter, settings }: MigrationDeps): Promise<Step<MigrationReport['settings']>> {
  if (settings.hasOnline) return { result: 'skipped', done: true };
  if (!(await adapter.exists(FORK_SETTINGS_FILE))) return { result: 'none', done: true };
  // A read that fails rejects the run: nothing is marked, and the next start reads again.
  const text = await adapter.read(FORK_SETTINGS_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Most likely caught while Atlas rewrites it: tried again next start, without holding up the rest.
    return { result: 'none', done: false };
  }
  if (!isRecord(parsed) || !isRecord(parsed.online)) return { result: 'none', done: true };
  const online = resolveOnlineSettings(parsed.online);
  settings.set({ ...online, playerPageUrl: movedPlayerPage(online.playerPageUrl) });
  return { result: 'copied', done: true };
}

/**
 * Atlas moved each scene's legacy `data.sharing` into Connect's scene data when it loaded the index, so there is
 * nothing to write: the scenes with Connect's data are counted. Without `scenes` Atlas cannot have moved them, and a
 * list that fails says nothing either; both wait for the next run. A scene whose data cannot be read is not counted.
 */
async function countMapShares(scenes: MigrationDeps['scenes']): Promise<Step<number>> {
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

/** Runs the steps in order; rejects when a step fails (nothing is marked, the next run starts again). */
export async function migrateFromFork(deps: MigrationDeps): Promise<MigrationReport> {
  const settings = await migrateSettings(deps);
  const sharing = await migrateSharingFolder(deps.adapter, sharingPaths(deps.storageFolder).root, (message) => deps.notify(message));
  const mapShares = await countMapShares(deps.scenes);
  if (settings.result === 'copied' || sharing !== 'none') deps.notify(MIGRATED_NOTICE);
  if (settings.done && mapShares.done) deps.settings.markMigrated();
  return { settings: settings.result, sharing, mapShares: mapShares.result };
}
