import type { AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, ConnectingPlugin, Disposer } from '@atlas-vtt/api-types';

type Listeners = { [E in keyof AtlasEvents]?: Set<AtlasEvents[E]> };

/** Namespaces the extension carries once their capability has landed (the real extension has them from API 1.1). */
const NAMESPACES = ['views', 'rules', 'settings', 'storage'] as const;

/** A namespace whose simulation lands with the feature that first uses it (B5 storage and settings, B6 views and rules). */
function notSimulated(name: string): unknown {
  return new Proxy({}, { get: (_target, member) => { throw new Error(`FakeAtlas does not simulate ${name}.${String(member)} yet.`); } });
}
type Trigger = (name: string, ...args: unknown[]) => void;

/** A plugin as `connect` sees it, plus `unload()` to run what it registered (what Obsidian does on unload). */
export type FakeConnectingPlugin = ConnectingPlugin & { unload(): void };

/** The two members of a plugin that `connect` reads. */
export function connectingPlugin(id: string): FakeConnectingPlugin {
  const cleanups: Array<() => void> = [];
  return {
    manifest: { id },
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    unload: () => { for (const cleanup of cleanups.splice(0)) cleanup(); },
  } as unknown as FakeConnectingPlugin;
}

interface Connection {
  plugin: ConnectingPlugin;
  listeners: Listeners;
  count(): number;
  dispose(): void;
}

/** A test-only Atlas: the API as Connect sees it, with the documented edge cases (Appendix A). */
export class FakeAtlas implements AtlasApi {
  readonly version: string;
  private readonly capabilities: Set<AtlasCapability>;
  private readonly connections = new Map<string, Connection>();
  private readonly registered = new WeakSet<object>();
  private readonly trigger: Trigger;
  private unloaded = false;
  connectedIds: string[] = [];

  constructor(options: { version?: string; capabilities?: readonly AtlasCapability[]; trigger?: Trigger } = {}) {
    this.version = options.version ?? '1.0.0';
    this.capabilities = new Set(options.capabilities ?? []);
    this.trigger = options.trigger ?? (() => undefined);
  }

  has(capability: AtlasCapability): boolean {
    return this.capabilities.has(capability);
  }

  /** Atlas publishes the API (workspace `atlas-vtt:api-ready`). */
  publish(): void {
    this.trigger('atlas-vtt:api-ready', this);
  }

  connect(plugin: ConnectingPlugin): AtlasExtension {
    if (this.unloaded) throw new Error('Atlas VTT has unloaded; wait for atlas-vtt:api-ready.');
    const id = plugin.manifest.id;
    this.connections.get(id)?.dispose(); // C-life-1: the first connection is disposed, without 'unload'
    this.connectedIds.push(id);
    const listeners: Listeners = {};
    const connection: Connection = {
      plugin,
      listeners,
      count: () => Object.values(listeners).reduce((sum, set) => sum + (set?.size ?? 0), 0),
      dispose: () => {
        for (const key of Object.keys(listeners) as Array<keyof AtlasEvents>) listeners[key]?.clear();
        if (this.connections.get(id) === connection) this.connections.delete(id);
      },
    };
    this.connections.set(id, connection);
    if (!this.registered.has(plugin)) {
      this.registered.add(plugin);
      // C-life-2: the plugin unloading removes its listeners (only if that plugin still owns the id)
      plugin.register(() => { if (this.connections.get(id)?.plugin === plugin) this.connections.get(id)?.dispose(); });
    }
    const on = <E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer => {
      const set = ((listeners as Record<string, Set<unknown>>)[event] ??= new Set()) as Set<AtlasEvents[E]>;
      set.add(listener);
      return () => { set.delete(listener); };
    };
    const extension: Record<string, unknown> = { id, on };
    for (const name of NAMESPACES) if (this.capabilities.has(name)) extension[name] = notSimulated(name);
    return extension as unknown as AtlasExtension;
  }

  /** Atlas unloads (C-life-3): 'unload' to every extension in connection order, dispose all, then `atlas-vtt:api-unload`. */
  unload(): void {
    if (this.unloaded) return;
    this.unloaded = true;
    const all = [...this.connections.values()];
    for (const connection of all) for (const listener of [...(connection.listeners.unload ?? [])]) listener();
    for (const connection of all) connection.dispose();
    this.trigger('atlas-vtt:api-unload');
  }

  listenerCount(): number {
    return [...this.connections.values()].reduce((sum, connection) => sum + connection.count(), 0);
  }
}
