import type { EventRef } from 'obsidian';

declare module 'obsidian' {
  interface App {
    /** Obsidian's plugin registry; not in the public typings. Read only to find Atlas's API. */
    plugins: { plugins: Record<string, { api?: unknown } | undefined> };
  }
  interface Workspace {
    /** Atlas's extension API is ready (its payload is the API); fired again after every Atlas reload. */
    on(name: 'atlas-vtt:api-ready', callback: (api: unknown) => unknown, ctx?: unknown): EventRef;
    /** Atlas is unloading; everything Connect started from the API must stop. */
    on(name: 'atlas-vtt:api-unload', callback: () => unknown, ctx?: unknown): EventRef;
  }
}
