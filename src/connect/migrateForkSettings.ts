/**
 * The settings step of the migration from the fork: the preview's `online` settings, table key included. From 0.6 the
 * fork keeps them in Atlas's plugin data (`<config folder>/plugins/atlas-vtt/data.json`) and leaves the older
 * `settings.json` behind untouched, so the plugin data is read first and the old file only when it holds no `online`
 * record. Connect only reads them (Atlas rewrites both on a debounce). They are merged field by field: a setting
 * changed in Connect since it loaded wins, and the table key comes from the preview while Connect has none here, on
 * the first device only (`forkTableKeyTaken`), never for a retired table, whichever file it is in.
 */
import type { DataAdapter } from 'obsidian';
import { isRecord, resolveOnlineSettings, type OnlineSettings } from '../app/online/onlineSettings';
import { movedPlayerPage, type ConnectSettingsStore } from './settingsStore';

/** Atlas's settings file, where the fork before 0.6 kept its `online` settings. */
export const FORK_SETTINGS_FILE = 'atlas-vtt/.atlas-data/settings.json';

/** Atlas's plugin data, where the fork from 0.6 keeps its `online` settings. */
export function atlasPluginDataFile(configDir: string): string {
  return `${configDir}/plugins/atlas-vtt/data.json`;
}
/** Longer than Atlas's 500 ms save debounce and its write: a file caught mid-rewrite is whole again by then. */
const REREAD_DELAY_MS = 1500;

export type ForkSettingsStore = Pick<ConnectSettingsStore, 'get' | 'set' | 'changedSinceLoad' | 'forkStepDone' | 'markForkStep' | 'markKeyMoved' | 'takeForkFileTable'>;

export interface ForkSettingsDeps {
  adapter: Pick<DataAdapter, 'exists' | 'read'>;
  /** The vault's configuration folder (`app.vault.configDir`), where Atlas's plugin data is. */
  configDir: string;
  settings: ForkSettingsStore;
  /** How long to wait before reading a file that is not JSON once more; tests pass 0. */
  rereadDelayMs?: number;
}

export interface Step<T> {
  result: T;
  /** False when this run could not finish the step (the next run, or the command, tries again). */
  done: boolean;
  /** The file that was not JSON, when that is why the step is not done. */
  unreadable?: string;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/** The parsed file; undefined when there is none, null when it is not JSON twice. A read that fails rejects. */
async function readJson(deps: ForkSettingsDeps, path: string): Promise<unknown> {
  if (!(await deps.adapter.exists(path))) return undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await wait(deps.rereadDelayMs ?? REREAD_DELAY_MS);
    try {
      return JSON.parse(await deps.adapter.read(path)) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

const onlineOf = (parsed: unknown): unknown => (isRecord(parsed) && isRecord(parsed.online) ? parsed.online : undefined);

/**
 * The preview's `online` record: Atlas's plugin data's when it has one, which wins whole, else the old settings
 * file's; undefined when neither has one. A file that is not JSON stops the step (`unreadable`) rather than falling
 * back, so stale settings are never taken for current ones.
 */
async function readForkOnline(deps: ForkSettingsDeps): Promise<{ online: unknown } | { unreadable: string }> {
  for (const path of [atlasPluginDataFile(deps.configDir), FORK_SETTINGS_FILE]) {
    const parsed = await readJson(deps, path);
    if (parsed === null) return { unreadable: path };
    const online = onlineOf(parsed);
    if (online !== undefined) return { online };
  }
  return { online: undefined };
}

/**
 * The preview's settings under what Connect changed since loading. The table key comes from the preview only when
 * Connect has none here and this is the first device to take it (`takeForkFileTable`), and its table was not retired.
 */
function merged(fork: OnlineSettings, settings: ForkSettingsStore): OnlineSettings {
  const current = settings.get();
  const result: OnlineSettings = { ...fork, playerPageUrl: movedPlayerPage(fork.playerPageUrl) };
  const own = Object.fromEntries([...settings.changedSinceLoad].map((key) => [key, current[key]])) as Partial<OnlineSettings>;
  const table = current.table ?? (fork.table && settings.takeForkFileTable(fork.table) ? fork.table : null);
  return { ...result, ...own, table };
}

/** `skipped` once done before, `none` when the preview kept no settings, `copied` when they were merged in. */
export async function migrateForkSettings(deps: ForkSettingsDeps): Promise<Step<'copied' | 'skipped' | 'none'>> {
  const { settings } = deps;
  if (settings.forkStepDone('settings')) return { result: 'skipped', done: true };
  const read = await readForkOnline(deps);
  if ('unreadable' in read) return { result: 'none', done: false, unreadable: read.unreadable };
  const copied = read.online !== undefined;
  if (copied) {
    const hadTable = settings.get().table !== null;
    settings.set(merged(resolveOnlineSettings(read.online), settings));
    if (!hadTable && settings.get().table !== null) settings.markKeyMoved();
  }
  settings.markForkStep('settings');
  return { result: copied ? 'copied' : 'none', done: true };
}
