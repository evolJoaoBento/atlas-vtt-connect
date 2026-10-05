import type { Plugin } from 'obsidian';

type Callback = (...args: unknown[]) => unknown;

/** An Obsidian event emitter: `on` gives a ref naming its emitter (`e`), as Obsidian's do, and `offref` takes it off. */
export interface FakeEvents {
  on(name: string, callback: Callback): { e: FakeEvents; name: string; callback: Callback };
  offref(ref: { name: string; callback: Callback }): void;
  /** How many handlers listen to `name`. */
  count(name: string): number;
  fire(name: string, ...args: unknown[]): void;
}

export function fakeEvents(): FakeEvents {
  const handlers = new Map<string, Set<Callback>>();
  const events: FakeEvents = {
    on: (name, callback) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(callback);
      return { e: events, name, callback };
    },
    offref: (ref) => { handlers.get(ref.name)?.delete(ref.callback); },
    count: (name) => handlers.get(name)?.size ?? 0,
    fire: (name, ...args) => { for (const callback of [...(handlers.get(name) ?? [])]) callback(...args); },
  };
  return events;
}

/** Just enough of `app` for AtlasLink: plugin registry, workspace events and layout-ready (which fires at once). */
export function fakeWorkspaceApp(): {
  app: Plugin['app'];
  plugins: Record<string, { api?: unknown } | undefined>;
  fire: (name: string, ...args: unknown[]) => void;
} {
  const events = fakeEvents();
  const plugins: Record<string, { api?: unknown } | undefined> = {};
  const workspace = {
    on: events.on,
    offref: events.offref,
    count: events.count,
    onLayoutReady: (callback: () => void) => callback(),
    updateOptions: () => undefined,
    getLeavesOfType: () => [],
    getActiveFile: () => null,
  };
  const fire = events.fire;
  return { app: { workspace, plugins: { plugins } } as unknown as Plugin['app'], plugins, fire };
}

/** A stand-in for Connect's own plugin object; `unload()` runs what it registered, as Obsidian does. */
export function fakeConnectPlugin(app: Plugin['app']): Plugin & { unload(): void } {
  const cleanups: Array<() => void> = [];
  return {
    app,
    manifest: { id: 'atlas-vtt-connect' },
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    registerEvent: () => undefined,
    unload: () => { for (const cleanup of cleanups.splice(0)) cleanup(); },
  } as unknown as Plugin & { unload(): void };
}
