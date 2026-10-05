/**
 * The settings step of the migration from the fork: the preview's `online` settings, table key included, come from
 * Atlas's settings file, which Connect only reads (Atlas rewrites it on a debounce). They are merged field by field:
 * a setting changed in Connect since it loaded wins, and the table key comes from the preview whenever Connect has none.
 */
import type { DataAdapter } from 'obsidian';
import { isRecord, resolveOnlineSettings, type OnlineSettings } from '../app/online/onlineSettings';
import { movedPlayerPage, type ConnectSettingsStore } from './settingsStore';

/** Atlas's settings file, where the fork kept its `online` settings. */
export const FORK_SETTINGS_FILE = 'atlas-vtt/.atlas-data/settings.json';
/** Longer than Atlas's 500 ms save debounce and its write: a file caught mid-rewrite is whole again by then. */
const REREAD_DELAY_MS = 1500;

export type ForkSettingsStore = Pick<ConnectSettingsStore, 'get' | 'set' | 'changedSinceLoad' | 'forkStepDone' | 'markForkStep' | 'markKeyMoved'>;

export interface ForkSettingsDeps {
  adapter: Pick<DataAdapter, 'exists' | 'read'>;
  settings: ForkSettingsStore;
  /** How long to wait before reading a file that is not JSON once more; tests pass 0. */
  rereadDelayMs?: number;
}

export interface Step<T> {
  result: T;
  /** False when this run could not finish the step (the next run, or the command, tries again). */
  done: boolean;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/** The parsed file; undefined when there is none, null when it is not JSON twice. A read that fails rejects. */
async function readForkSettings(deps: ForkSettingsDeps): Promise<unknown> {
  if (!(await deps.adapter.exists(FORK_SETTINGS_FILE))) return undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await wait(deps.rereadDelayMs ?? REREAD_DELAY_MS);
    try {
      return JSON.parse(await deps.adapter.read(FORK_SETTINGS_FILE)) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

/** The preview's settings under what Connect changed since loading; the table key from the preview when Connect has none. */
function merged(fork: OnlineSettings, settings: ForkSettingsStore): OnlineSettings {
  const current = settings.get();
  const result: OnlineSettings = { ...fork, playerPageUrl: movedPlayerPage(fork.playerPageUrl) };
  const own = Object.fromEntries([...settings.changedSinceLoad].map((key) => [key, current[key]])) as Partial<OnlineSettings>;
  return { ...result, ...own, table: current.table ?? fork.table };
}

/** `skipped` once done before, `none` when the preview kept no settings, `copied` when they were merged in. */
export async function migrateForkSettings(deps: ForkSettingsDeps): Promise<Step<'copied' | 'skipped' | 'none'>> {
  const { settings } = deps;
  if (settings.forkStepDone('settings')) return { result: 'skipped', done: true };
  const parsed = await readForkSettings(deps);
  if (parsed === null) return { result: 'none', done: false };
  const copied = isRecord(parsed) && isRecord(parsed.online);
  if (copied) {
    const hadTable = settings.get().table !== null;
    settings.set(merged(resolveOnlineSettings(parsed.online), settings));
    if (!hadTable && settings.get().table !== null) settings.markKeyMoved();
  }
  settings.markForkStep('settings');
  return { result: copied ? 'copied' : 'none', done: true };
}
