import type { Plugin } from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, resolveOnlineSettings, validStoredTable, type OnlineSettings, type StoredTable } from '../app/online/onlineSettings';
import type { KeyValueStore } from '../app/online/sharing/identity/deviceKeys';
import { FORK_TABLE_KEY_STORAGE } from './migrateLocalStores';

/**
 * Where the GM's table key lives: Obsidian's local storage, which Obsidian keeps per vault on each device. Never in
 * `data.json`, which sits in the vault's configuration folder and syncs, or is handed to players with the vault.
 */
export const TABLE_KEY_STORAGE = 'atlas-vtt-connect:table-key';

/**
 * The vault's steps of the migration from the fork (`migrateFromFork`), each marked once it is done; together they
 * make `migratedFromFork`. What the fork kept on each device is not marked here, in a file that may sync to other
 * devices: device keys are merged on every start, and the images mark lives on the device (`startMigration`).
 */
export const FORK_STEPS = ['settings', 'sharing', 'mapShares'] as const;
export type ForkStep = typeof FORK_STEPS[number];

/** What Connect keeps in its `data.json`: never a private key (`table` only while local storage refuses it). */
interface StoredData {
  online: Omit<OnlineSettings, 'table'> & { table?: StoredTable };
  /** Set once every migration step is done; each counts as done then. */
  migratedFromFork?: 1;
  /** The migration steps done so far. */
  forkSteps?: ForkStep[];
  /** The settings changed in Connect while the settings step is not done: they stay over the fork's, across restarts. */
  forkOwnKeys?: Array<keyof OnlineSettings>;
}

/** The player page the fork shipped before Connect had its own; also matched without the trailing slash. */
export const FORK_PLAYER_PAGE_URL = 'https://evoljoaobento.github.io/atlas-vtt/';

/** Connect's own player page in place of the fork's old default; any other address is kept. */
export function movedPlayerPage(url: string): string {
  return url === FORK_PLAYER_PAGE_URL || url === FORK_PLAYER_PAGE_URL.slice(0, -1) ? DEFAULT_ONLINE_SETTINGS.playerPageUrl : url;
}

const isForkStep = (value: unknown): value is ForkStep => (FORK_STEPS as readonly unknown[]).includes(value);
const isSettingKey = (value: unknown): value is keyof OnlineSettings => typeof value === 'string' && Object.hasOwn(DEFAULT_ONLINE_SETTINGS, value);
const listOf = <T>(value: unknown, check: (item: unknown) => item is T): T[] => (Array.isArray(value) ? value.filter(check) : []);
const SAVE_DELAY_MS = 500;

type DataPlugin = Pick<Plugin, 'loadData' | 'saveData'>;

const sameTable = (a: StoredTable | null, b: StoredTable): boolean => a !== null && a.id === b.id && a.publicKey === b.publicKey && a.privateKey.d === b.privateKey.d;

/**
 * Connect's own settings, in the plugin's data file, and the table key in local storage on this device. Changes save
 * 500 ms after the last one; migration marks at once.
 */
export class ConnectSettingsStore {
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  private migrated: boolean;
  private readonly steps: Set<ForkStep>;
  private readonly changed: Set<keyof OnlineSettings>;
  /** Whether the table key is safely in local storage (read back after writing), or there is none: then `data.json` holds none. */
  private tableKept = true;
  /** A save that did not reach the file; `flush` (at unload) tries it again. */
  private unsaved = false;
  /** The table key moved here this session (out of `data.json`, or from the online play preview): `takeKeyMoved` tells once. */
  private keyMoved = false;

  private constructor(
    private readonly plugin: DataPlugin, private readonly local: KeyValueStore, private online: OnlineSettings,
    migrated: boolean, steps: ForkStep[], ownKeys: Array<keyof OnlineSettings>,
  ) {
    this.migrated = migrated;
    this.steps = new Set(steps);
    this.changed = new Set(this.forkStepDone('settings') ? [] : ownKeys);
  }

  /**
   * `local` is Obsidian's local storage (`obsidianLocalStore`). A table key found in `data.json` (written before keys
   * moved out, or synced from a device that still runs such a version) is moved once: written to local storage, read
   * back, and only then stripped from `data.json`. A key already in local storage wins over the synced one. With
   * neither, the online play preview's own key on this device (its local storage, from its 0.6 on) is adopted, on
   * every start and per device; the preview's entry is never removed. Its older key in Atlas's settings file comes
   * last, through the settings step of the migration (`migrateForkSettings`).
   */
  static async load(plugin: DataPlugin, local: KeyValueStore): Promise<ConnectSettingsStore> {
    const stored: unknown = await plugin.loadData();
    const data = typeof stored === 'object' && stored !== null ? stored as Partial<Record<keyof StoredData, unknown>> : {};
    const online = resolveOnlineSettings(data.online);
    online.playerPageUrl = movedPlayerPage(online.playerPageUrl);
    const synced = online.table;
    const kept = validStoredTable(local.get(TABLE_KEY_STORAGE));
    online.table = kept ?? synced;
    const store = new ConnectSettingsStore(plugin, local, online, data.migratedFromFork === 1, listOf(data.forkSteps, isForkStep), listOf(data.forkOwnKeys, isSettingKey));
    const inFile = typeof data.online === 'object' && data.online !== null && 'table' in data.online;
    if (!kept && synced) {
      store.tableKept = store.keepTable(synced);
      store.keyMoved = true;
    }
    const fork = kept || synced ? null : validStoredTable(local.get(FORK_TABLE_KEY_STORAGE));
    if (fork) {
      store.online.table = fork;
      store.tableKept = store.keepTable(fork);
      store.keyMoved = true;
    }
    // Strip the key from the file (or the leftover entry) once it is safe on this device.
    if (inFile && store.tableKept) store.saveNow();
    return store;
  }

  /** True once after the table key moved to this device's local storage this session; the caller shows `KEY_MOVED_NOTICE`. */
  takeKeyMoved(): boolean {
    const moved = this.keyMoved;
    this.keyMoved = false;
    return moved;
  }

  /** The table key came over from the online play preview's settings file (`migrateForkSettings`). */
  markKeyMoved(): void {
    this.keyMoved = true;
  }

  get(): OnlineSettings {
    return this.online;
  }

  /** The settings changed in Connect while the migration's settings step was not done (kept across restarts until it is). */
  get changedSinceLoad(): ReadonlySet<keyof OnlineSettings> {
    return this.changed;
  }

  set(partial: Partial<OnlineSettings>): void {
    if (partial.table !== undefined && partial.table !== this.online.table) this.tableKept = this.keepTable(partial.table);
    this.online = { ...this.online, ...partial };
    if (!this.forkStepDone('settings')) for (const key of Object.keys(partial) as Array<keyof OnlineSettings>) this.changed.add(key);
    this.scheduleSave();
    for (const listener of [...this.listeners]) listener();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  get migratedFromFork(): boolean {
    return this.migrated;
  }

  markMigrated(): void {
    this.migrated = true;
    this.saveNow();
  }

  /** Whether this step of the migration is done (all are, once `migratedFromFork` is set). */
  forkStepDone(step: ForkStep): boolean {
    return this.migrated || this.steps.has(step);
  }

  /** Marks a step done, saved at once; once all are, the migration is marked too. */
  markForkStep(step: ForkStep): void {
    if (this.forkStepDone(step)) return;
    this.steps.add(step);
    if (step === 'settings') this.changed.clear();
    if (FORK_STEPS.every((each) => this.steps.has(each))) this.migrated = true;
    this.saveNow();
  }

  /** Saves at once when a change is waiting, or the last save failed (a strip of the table key included); called when the plugin unloads. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    } else if (!this.unsaved) return;
    await this.save();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  /** A mark is saved at once, with whatever change was waiting: a run cut short right after it does not repeat the step. */
  private saveNow(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.save();
  }

  /** Writes the table key (or its removal) to local storage; true once it reads back the same. */
  private keepTable(table: StoredTable | null): boolean {
    this.local.set(TABLE_KEY_STORAGE, table);
    const back = this.local.get(TABLE_KEY_STORAGE);
    if (table === null) return back === null || back === undefined;
    const ok = sameTable(validStoredTable(back), table);
    if (!ok) console.error('[Atlas VTT Connect] Could not keep the table key on this device; it stays in the settings file for now.');
    return ok;
  }

  private async save(): Promise<void> {
    // Retried on every save while local storage refused it, so the file holds the key no longer than needed.
    if (!this.tableKept && this.online.table) this.tableKept = this.keepTable(this.online.table);
    const { table, ...rest } = this.online;
    const data: StoredData = {
      online: !this.tableKept && table ? { ...rest, table } : rest,
      ...(this.migrated ? { migratedFromFork: 1 as const } : {}),
      ...(this.steps.size > 0 ? { forkSteps: [...this.steps] } : {}),
      ...(this.changed.size > 0 ? { forkOwnKeys: [...this.changed] } : {}),
    };
    try {
      this.unsaved = true;
      await this.plugin.saveData(data);
      this.unsaved = false;
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not save the settings:', error);
    }
  }
}
