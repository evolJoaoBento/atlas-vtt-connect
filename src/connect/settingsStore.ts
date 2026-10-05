import type { Plugin } from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, resolveOnlineSettings, type OnlineSettings } from '../app/online/onlineSettings';

/**
 * The steps of the migration from the fork, each marked once it is done. The vault's (`migrateFromFork`) together make
 * `migratedFromFork`; this device's (`migrateLocalStores`) are marked on their own, since each device has its own.
 */
const VAULT_STEPS = ['settings', 'sharing', 'mapShares'] as const;
const DEVICE_STEPS = ['keys', 'images'] as const;
export const FORK_STEPS = [...VAULT_STEPS, ...DEVICE_STEPS] as const;
export type ForkStep = typeof FORK_STEPS[number];

/** What Connect keeps in its `data.json`. */
interface StoredData {
  online: OnlineSettings;
  /** Set once the vault's steps of the migration from the fork are done; each of them counts as done then. */
  migratedFromFork?: 1;
  /** The migration steps done so far. */
  forkSteps?: ForkStep[];
}

/** The player page the fork shipped before Connect had its own; also matched without the trailing slash. */
export const FORK_PLAYER_PAGE_URL = 'https://evoljoaobento.github.io/atlas-vtt/';

/** Connect's own player page in place of the fork's old default; any other address is kept. */
export function movedPlayerPage(url: string): string {
  return url === FORK_PLAYER_PAGE_URL || url === FORK_PLAYER_PAGE_URL.slice(0, -1) ? DEFAULT_ONLINE_SETTINGS.playerPageUrl : url;
}

const isForkStep = (value: unknown): value is ForkStep => (FORK_STEPS as readonly unknown[]).includes(value);
const SAVE_DELAY_MS = 500;

type DataPlugin = Pick<Plugin, 'loadData' | 'saveData'>;

/** Connect's own settings, in the plugin's data file. Changes save 500 ms after the last one. */
export class ConnectSettingsStore {
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  private migrated: boolean;
  private readonly steps: Set<ForkStep>;
  private readonly changed = new Set<keyof OnlineSettings>();

  private constructor(private readonly plugin: DataPlugin, private online: OnlineSettings, migrated: boolean, steps: ForkStep[]) {
    this.migrated = migrated;
    this.steps = new Set(steps);
  }

  static async load(plugin: DataPlugin): Promise<ConnectSettingsStore> {
    const stored: unknown = await plugin.loadData();
    const data = typeof stored === 'object' && stored !== null ? stored as Partial<Record<keyof StoredData, unknown>> : {};
    const online = resolveOnlineSettings(data.online);
    online.playerPageUrl = movedPlayerPage(online.playerPageUrl);
    const steps = Array.isArray(data.forkSteps) ? data.forkSteps.filter(isForkStep) : [];
    return new ConnectSettingsStore(plugin, online, data.migratedFromFork === 1, steps);
  }

  get(): OnlineSettings {
    return this.online;
  }

  /** The settings changed since loading: the migration keeps these over the fork's. */
  get changedSinceLoad(): ReadonlySet<keyof OnlineSettings> {
    return this.changed;
  }

  set(partial: Partial<OnlineSettings>): void {
    this.online = { ...this.online, ...partial };
    for (const key of Object.keys(partial) as Array<keyof OnlineSettings>) this.changed.add(key);
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

  /** Whether this step of the migration is done (the vault's all are, once `migratedFromFork` is set). */
  forkStepDone(step: ForkStep): boolean {
    return this.steps.has(step) || (this.migrated && (VAULT_STEPS as readonly ForkStep[]).includes(step));
  }

  /** Marks a step done; once the vault's steps all are, the migration is marked too. */
  markForkStep(step: ForkStep): void {
    if (this.forkStepDone(step)) return;
    this.steps.add(step);
    if (VAULT_STEPS.every((vaultStep) => this.steps.has(vaultStep))) this.migrated = true;
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
    const data: StoredData = { online: this.online, ...(this.migrated ? { migratedFromFork: 1 as const } : {}), ...(this.steps.size > 0 ? { forkSteps: [...this.steps] } : {}) };
    try {
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not save the settings:', error);
    }
  }
}
