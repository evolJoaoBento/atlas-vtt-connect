import type { Plugin } from 'obsidian';

type Callback = (...args: unknown[]) => unknown;

/** Just enough of `app` for AtlasLink: plugin registry, workspace events and layout-ready (which fires at once). */
export function fakeWorkspaceApp(): {
  app: Plugin['app'];
  plugins: Record<string, { api?: unknown } | undefined>;
  fire: (name: string, ...args: unknown[]) => void;
} {
  const handlers = new Map<string, Set<Callback>>();
  const plugins: Record<string, { api?: unknown } | undefined> = {};
  const workspace = {
    on: (name: string, callback: Callback) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(callback);
      return { name, callback };
    },
    offref: (ref: { name: string; callback: Callback }) => { handlers.get(ref.name)?.delete(ref.callback); },
    onLayoutReady: (callback: () => void) => callback(),
  };
  const fire = (name: string, ...args: unknown[]): void => { for (const callback of [...(handlers.get(name) ?? [])]) callback(...args); };
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
