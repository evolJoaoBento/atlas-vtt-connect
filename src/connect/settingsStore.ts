import type { Plugin } from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, resolveOnlineSettings, type OnlineSettings } from '../app/online/onlineSettings';

/**
 * The vault's steps of the migration from the fork (`migrateFromFork`), each marked once it is done; together they
 * make `migratedFromFork`. What the fork kept on each device is not marked here, in a file that may sync to other
 * devices: device keys are merged on every start, and the images mark lives on the device (`startMigration`).
 */
export const FORK_STEPS = ['settings', 'sharing', 'mapShares'] as const;
export type ForkStep = typeof FORK_STEPS[number];

/** What Connect keeps in its `data.json`. */
interface StoredData {
  online: OnlineSettings;
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

/** Connect's own settings, in the plugin's data file. Changes save 500 ms after the last one; migration marks at once. */
export class ConnectSettingsStore {
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  private migrated: boolean;
  private readonly steps: Set<ForkStep>;
  private readonly changed: Set<keyof OnlineSettings>;

  private constructor(private readonly plugin: DataPlugin, private online: OnlineSettings, migrated: boolean, steps: ForkStep[], ownKeys: Array<keyof OnlineSettings>) {
    this.migrated = migrated;
    this.steps = new Set(steps);
    this.changed = new Set(this.forkStepDone('settings') ? [] : ownKeys);
  }

  static async load(plugin: DataPlugin): Promise<ConnectSettingsStore> {
    const stored: unknown = await plugin.loadData();
    const data = typeof stored === 'object' && stored !== null ? stored as Partial<Record<keyof StoredData, unknown>> : {};
    const online = resolveOnlineSettings(data.online);
    online.playerPageUrl = movedPlayerPage(online.playerPageUrl);
    return new ConnectSettingsStore(plugin, online, data.migratedFromFork === 1, listOf(data.forkSteps, isForkStep), listOf(data.forkOwnKeys, isSettingKey));
  }

  get(): OnlineSettings {
    return this.online;
  }

  /** The settings changed in Connect while the migration's settings step was not done (kept across restarts until it is). */
  get changedSinceLoad(): ReadonlySet<keyof OnlineSettings> {
    return this.changed;
  }

  set(partial: Partial<OnlineSettings>): void {
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

  /** Saves at once when a change is waiting; called when the plugin unloads. */
  async flush(): Promise<void> {
    if (this.saveTimer === null) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
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

  private async save(): Promise<void> {
    const data: StoredData = {
      online: this.online,
      ...(this.migrated ? { migratedFromFork: 1 as const } : {}),
      ...(this.steps.size > 0 ? { forkSteps: [...this.steps] } : {}),
      ...(this.changed.size > 0 ? { forkOwnKeys: [...this.changed] } : {}),
    };
    try {
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not save the settings:', error);
    }
  }
}
