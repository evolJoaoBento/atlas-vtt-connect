import type { AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, ConnectingPlugin, Disposer } from '@atlas-vtt/api-types';

type Listeners = { [E in keyof AtlasEvents]?: Set<AtlasEvents[E]> };

/** The two members of a plugin that `connect` reads. */
export function connectingPlugin(id: string): ConnectingPlugin {
  return { manifest: { id }, register: () => undefined } as unknown as ConnectingPlugin;
}

/** A test-only Atlas: the API as Connect sees it, with the documented edge cases (Appendix A). */
export class FakeAtlas implements AtlasApi {
  readonly version: string;
  private readonly listeners: Listeners = {};
  private readonly capabilities: Set<AtlasCapability>;
  private readonly disposers = new Set<() => void>();
  connectedIds: string[] = [];

  constructor(options: { version?: string; capabilities?: readonly AtlasCapability[] } = {}) {
    this.version = options.version ?? '1.0.0';
    this.capabilities = new Set(options.capabilities ?? []);
  }

  has(capability: AtlasCapability): boolean {
    return this.capabilities.has(capability);
  }

  connect(plugin: ConnectingPlugin): AtlasExtension {
    this.connectedIds.push(plugin.manifest.id);
    const on = <E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer => {
      const set = (this.listeners[event] ??= new Set()) as Set<AtlasEvents[E]>;
      set.add(listener);
      const dispose = (): void => { set.delete(listener); this.disposers.delete(dispose); };
      this.disposers.add(dispose);
      return dispose;
    };
    return { id: plugin.manifest.id, on } as AtlasExtension;
  }

  emit<E extends keyof AtlasEvents>(event: E, ...args: Parameters<AtlasEvents[E]>): void {
    const set = this.listeners[event] as Set<(...a: Parameters<AtlasEvents[E]>) => void> | undefined;
    for (const listener of [...(set ?? [])]) listener(...args);
  }

  /** Atlas unloads: 'unload', then everything is disposed (C-life-3). */
  unload(): void {
    this.emit('unload');
    for (const dispose of [...this.disposers]) dispose();
  }

  listenerCount(): number {
    return Object.values(this.listeners).reduce((sum, set) => sum + (set?.size ?? 0), 0);
  }
}
