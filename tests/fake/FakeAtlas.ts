import type { AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, AtlasSettingKey, AtlasSettingsView, ConnectingPlugin, Disposer, SettingsApi, StorageApi } from '@atlas-vtt/api-types';
import { FakeBundles } from './fakeBundles';
import { FakeDice } from './fakeDice';
import { FakeLasers } from './fakeLasers';
import { FakeLighting } from './fakeLighting';
import { FakePresentation } from './fakePresentation';
import { FakeRules } from './fakeRules';
import { FakeScenes } from './fakeScenes';
import { FakeTokens } from './fakeTokens';
import { FakeUi } from './fakeUi';
import { FakeViews, type Own } from './fakeViews';

type Listeners = { [E in keyof AtlasEvents]?: Set<AtlasEvents[E]> };

/** Atlas's settings as the fake starts with them; `setSetting` changes them. */
const DEFAULT_SETTINGS: AtlasSettingsView = {
  laserPointer: { color: '#ff0000', size: 3 },
  diceLook: { colour: '#7f1d1d', font: 'default' },
  diceDisplay: 'card',
  playerView: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as AtlasSettingKey[];

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
};

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

const EXTENSION_ID = /^[a-z0-9-]+$/;

/** `atlas-vtt/.atlas-data/extensions/<id>`; an id that is not kebab-case rejects in `folder()`, not at connect. */
function storageApi(extensionId: string): StorageApi {
  return Object.freeze({
    folder: (): Promise<string> => EXTENSION_ID.test(extensionId)
      ? Promise.resolve(`atlas-vtt/.atlas-data/extensions/${extensionId}`)
      : Promise.reject(new Error(`[Atlas API] "${extensionId}" cannot have a storage folder: the extension id must be kebab-case (a-z, 0-9, -).`)),
  });
}

interface Connection {
  plugin: ConnectingPlugin;
  listeners: Listeners;
  /** Teardowns of the namespaces' registrations (view subscriptions, presentation listeners, targets). */
  owned: Set<() => void>;
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
  private settings: AtlasSettingsView = structuredClone(DEFAULT_SETTINGS);
  connectedIds: string[] = [];
  /** Atlas's map views, as the test drives them. */
  readonly views: FakeViews;
  /** The presented scene and the presentation targets. */
  readonly presentation: FakePresentation;
  /** The collections' rules. */
  readonly rules: FakeRules;
  /** Atlas's dice log. */
  readonly dice: FakeDice;
  /** The GM's laser per view, and the lasers shown in a view. */
  readonly lasers: FakeLasers;
  /** What each view's player window shows (`lighting.playerVisibility`). */
  readonly lighting: FakeLighting;
  /** Token moves: each successful move is one GM undo step (`undoSteps`, `undo`). */
  readonly tokens: FakeTokens;
  /** The UI slots extensions registered; undefined without the `ui` capability, as Atlas's `ui` is. */
  readonly ui: FakeUi | undefined;
  /** Scene records with extension data, saved maps, and scenes added to a collection. */
  readonly scenes: FakeScenes;
  /** The note properties exports and installs strip. */
  readonly bundles: FakeBundles;

  constructor(options: { version?: string; capabilities?: readonly AtlasCapability[]; trigger?: Trigger } = {}) {
    this.version = options.version ?? '1.0.0';
    this.capabilities = new Set(options.capabilities ?? []);
    this.trigger = options.trigger ?? (() => undefined);
    this.views = new FakeViews({
      emitMapLoaded: (info) => { this.emit('map-loaded', info); this.lighting.mapLoaded(info.viewId); },
      emitMapClosed: (viewId) => this.emit('map-closed', viewId),
      storeChanged: (viewId) => this.presentation.storeChanged(viewId),
      tabsChanged: (viewId) => this.presentation.tabsChanged(viewId),
      viewClosed: (viewId) => this.presentation.viewClosed(viewId),
    });
    this.presentation = new FakePresentation(this.views);
    this.rules = new FakeRules((collectionId) => this.emit('rules-changed', collectionId));
    this.dice = new FakeDice(this.rules);
    this.lasers = new FakeLasers(this.views);
    this.lighting = new FakeLighting(this.views);
    this.tokens = new FakeTokens(this.views);
    this.ui = this.capabilities.has('ui') ? new FakeUi(this.views) : undefined;
    this.scenes = new FakeScenes(() => this.emit('scenes-changed'));
    this.bundles = new FakeBundles();
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
    const owned = new Set<() => void>();
    const connection: Connection = {
      plugin,
      listeners,
      owned,
      count: () => Object.values(listeners).reduce((sum, set) => sum + (set?.size ?? 0), 0) + owned.size,
      dispose: () => {
        for (const key of Object.keys(listeners) as Array<keyof AtlasEvents>) listeners[key]?.clear();
        for (const teardown of [...owned]) teardown();
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
    const own: Own = (teardown) => {
      let live = true;
      const dispose = (): void => {
        if (!live) return;
        live = false;
        owned.delete(dispose);
        teardown();
      };
      owned.add(dispose);
      return dispose;
    };
    const extension: Record<string, unknown> = { id, on };
    if (this.capabilities.has('views')) extension.views = this.views.api(own);
    if (this.capabilities.has('presentation')) extension.presentation = this.presentation.api(own);
    if (this.capabilities.has('rules')) extension.rules = this.rules.api();
    if (this.capabilities.has('dice')) extension.dice = this.dice.api(own);
    if (this.capabilities.has('lasers')) extension.lasers = this.lasers.api(own);
    if (this.capabilities.has('lighting')) extension.lighting = this.lighting.api(own);
    if (this.capabilities.has('tokens')) extension.tokens = this.tokens.api();
    if (this.ui) extension.ui = this.ui.api(id, own);
    if (this.capabilities.has('scenes')) extension.scenes = this.scenes.api(id);
    if (this.capabilities.has('bundles')) extension.bundles = this.bundles.api(id, own);
    if (this.capabilities.has('settings')) extension.settings = this.settingsApi();
    if (this.capabilities.has('storage')) extension.storage = storageApi(id);
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

  /** Changes one of Atlas's settings, as its settings screen does; 'settings-changed' names the key, and only when the value differs. */
  setSetting<K extends AtlasSettingKey>(key: K, value: AtlasSettingsView[K]): void {
    const changed = JSON.stringify(this.settings[key]) !== JSON.stringify(value);
    this.settings = { ...this.settings, [key]: structuredClone(value) };
    if (changed) this.emit('settings-changed', key);
  }

  private settingsApi(): SettingsApi {
    return Object.freeze({
      get: <K extends AtlasSettingKey>(key: K): AtlasSettingsView[K] => {
        if (!SETTING_KEYS.includes(key)) throw new Error(`[Atlas API] Unknown setting "${String(key)}".`);
        return deepFreeze(structuredClone(this.settings[key]));
      },
    });
  }

  /** Every extension's listeners for `event` run, guarded: one that throws does not stop the others. */
  private emit<E extends keyof AtlasEvents>(event: E, ...args: Parameters<AtlasEvents[E]>): void {
    for (const connection of [...this.connections.values()]) {
      for (const listener of [...(connection.listeners[event] ?? [])]) {
        try {
          (listener as (...rest: unknown[]) => void)(...args);
        } catch (error) {
          console.error(`[Atlas API] A '${event}' listener threw:`, error);
        }
      }
    }
  }

  listenerCount(): number {
    return [...this.connections.values()].reduce((sum, connection) => sum + connection.count(), 0);
  }
}
