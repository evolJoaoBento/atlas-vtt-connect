import type { Plugin } from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, resolveOnlineSettings, type OnlineSettings } from '../app/online/onlineSettings';

/** What Connect keeps in its `data.json`. */
interface StoredData {
  online: OnlineSettings;
  /** Set once the settings of the fork's Atlas have been copied over (see the migration task). */
  migratedFromFork?: 1;
}

/** The player page the fork shipped before Connect had its own. */
const FORK_PLAYER_PAGE = 'https://evoljoaobento.github.io/atlas-vtt/';
const SAVE_DELAY_MS = 500;

type DataPlugin = Pick<Plugin, 'loadData' | 'saveData'>;

/** Connect's own settings, in the plugin's data file. Changes save 500 ms after the last one. */
export class ConnectSettingsStore {
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  private migrated: boolean;

  private constructor(private readonly plugin: DataPlugin, private online: OnlineSettings, migrated: boolean) {
    this.migrated = migrated;
  }

  static async load(plugin: DataPlugin): Promise<ConnectSettingsStore> {
    const stored: unknown = await plugin.loadData();
    const data = typeof stored === 'object' && stored !== null ? stored as Partial<Record<keyof StoredData, unknown>> : {};
    const online = resolveOnlineSettings(data.online);
    if (online.playerPageUrl === FORK_PLAYER_PAGE) online.playerPageUrl = DEFAULT_ONLINE_SETTINGS.playerPageUrl;
    return new ConnectSettingsStore(plugin, online, data.migratedFromFork === 1);
  }

  get(): OnlineSettings {
    return this.online;
  }

  set(partial: Partial<OnlineSettings>): void {
    this.online = { ...this.online, ...partial };
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
    this.scheduleSave();
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

  private async save(): Promise<void> {
    const data: StoredData = { online: this.online, ...(this.migrated ? { migratedFromFork: 1 as const } : {}) };
    try {
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not save the settings:', error);
    }
  }
}
