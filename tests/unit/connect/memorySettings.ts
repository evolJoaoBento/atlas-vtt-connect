import { DEFAULT_ONLINE_SETTINGS, type OnlineSettings } from '../../../src/app/online/onlineSettings';

/** An in-memory online settings store with the `get`/`set`/`onChange` interface of `ConnectSettingsStore`. */
export function memorySettings(initial: Partial<OnlineSettings> = {}): {
  get(): OnlineSettings;
  set(partial: Partial<OnlineSettings>): void;
  onChange(cb: () => void): () => void;
} {
  let online: OnlineSettings = { ...DEFAULT_ONLINE_SETTINGS, ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => online,
    set: (partial) => { online = { ...online, ...partial }; listeners.forEach((cb) => cb()); },
    onChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
