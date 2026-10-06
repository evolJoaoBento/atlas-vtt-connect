import type { AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, AtlasSettingKey, AtlasSettingsView, ConnectingPlugin, Disposer, SettingsApi, StorageApi } from '@atlas-vtt/api-types';
import { FakeBundles } from './fakeBundles';
import { FakeDice } from './fakeDice';
import { FakeLasers } from './fakeLasers';
import { FakeLighting } from './fakeLighting';
import { FakePresentation } from './fakePresentation';
import { FakeRemoteViews } from './fakeRemoteViews';
import { FakeRules } from './fakeRules';
import { FakeScenes, type FakeSceneVault } from './fakeScenes';
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
  /** The remote views extensions opened (1.12.0), each with a handle that records its calls. */
  readonly remoteViews: FakeRemoteViews;
  /** Atlas's UI slots, which every connection gets, as every namespace; `ui` is the test's view of them with the capability. */
  private readonly slots: FakeUi;

  /** `vault`: the in-memory app's files and folders, which `scenes.addToCollection` writes into (its own otherwise). */
  /** `before115`: Atlas as before API 1.15.0 (`isVisible` ignored, no `padded`, no status `actions`, no `onStatusAction`). */
  /** `scenesBefore113`: Atlas's scenes as before API 1.13.0 (no saved map fields, no `replaceMap`). */
  /**
   * `version`: by default the vendored API's, 1.15.0. Only Connect's version gate reads it: the fake behaves as 1.15.0
   * whatever it says (but for `before115`), so a test names an older version only where the gate is what it checks.
   */
  constructor(options: { version?: string; capabilities?: readonly AtlasCapability[]; trigger?: Trigger; vault?: FakeSceneVault; scenesBefore113?: boolean; before115?: boolean } = {}) {
    this.version = options.version ?? (options.before115 ? '1.14.0' : '1.15.0');
    this.capabilities = new Set(options.capabilities ?? []);
    this.trigger = options.trigger ?? (() => undefined);
    this.views = new FakeViews({
      emitMapLoaded: (info) => { this.emit('map-loaded', info); this.lighting.mapLoaded(info.viewId); },
      emitMapClosed: (viewId) => this.emit('map-closed', viewId),
      storeChanged: (viewId) => this.presentation.storeChanged(viewId),
      tabsChanged: (viewId) => this.presentation.tabsChanged(viewId),
      viewClosed: (viewId) => this.presentation.viewClosed(viewId),
      emitTabsChanged: (info) => this.emit('tabs-changed', info),
    }, () => this.capabilities.has('scene-tabs'));
    this.presentation = new FakePresentation(this.views, () => this.capabilities.has('scene-tabs'));
    this.rules = new FakeRules((collectionId) => this.emit('rules-changed', collectionId));
    this.dice = new FakeDice(this.rules, this.views, () => this.settings.diceDisplay);
    this.lasers = new FakeLasers(this.views);
    this.lighting = new FakeLighting(this.views);
    this.tokens = new FakeTokens(this.views);
    this.slots = new FakeUi(this.views, (viewId) => this.remoteViews.ownerOf(viewId), options.before115 === true, {
      enabled: () => this.capabilities.has('scene-tabs'),
      presented: () => this.presentation.current(),
    });
    this.ui = this.capabilities.has('ui') ? this.slots : undefined;
    this.scenes = new FakeScenes(() => this.emit('scenes-changed'), options.vault, () => this.views.openMapPaths(), options.scenesBefore113 === true);
    this.bundles = new FakeBundles();
    this.remoteViews = new FakeRemoteViews(this.views, options.before115 === true);
  }

  has(capability: AtlasCapability): boolean {
    return this.capabilities.has(capability);
  }

  /** This Atlas without `capability`, as an older one (`scene-tabs`: no `tabId`, `tabs-changed`, `showTab`, eye menu or badge); before connecting. */
  without(capability: AtlasCapability): this {
    this.capabilities.delete(capability);
    return this;
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
    // Every namespace, as Atlas gives them (`has()` says which have landed); `remoteViews` only with `remote-view`. A
    // namespace whose capability this Atlas lacks throws when called, as an older Atlas without it would.
    const gate = <T extends object>(capability: AtlasCapability, api: T): T => (this.capabilities.has(capability) ? api : new Proxy({ ...api }, {
      get: (target, key) => {
        const member: unknown = Reflect.get(target, key);
        return typeof member === 'function'
          ? (): never => { throw new Error(`[FakeAtlas] ${capability}.${String(key)} used without the ${capability} capability.`); }
          : member;
      },
    }));
    const extension: AtlasExtension = {
      id, on,
      views: gate('views', this.views.api(own)),
      presentation: gate('presentation', this.presentation.api(own)),
      rules: gate('rules', this.rules.api()),
      dice: gate('dice', this.dice.api(own)),
      lasers: gate('lasers', this.lasers.api(own)),
      lighting: gate('lighting', this.lighting.api(own)),
      tokens: gate('tokens', this.tokens.api()),
      ui: gate('ui', this.slots.api(id, own)),
      scenes: gate('scenes', this.scenes.api(id)),
      bundles: gate('bundles', this.bundles.api(id, own)),
      settings: gate('settings', this.settingsApi()),
      storage: gate('storage', storageApi(id)),
      ...(this.capabilities.has('remote-view') ? { remoteViews: this.remoteViews.api(id, own) } : {}),
    };
    return extension;
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
