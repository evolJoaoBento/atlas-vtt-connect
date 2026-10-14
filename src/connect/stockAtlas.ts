/**
 * A stand-in for Atlas's extension API on a stock Atlas (ByteMirror 0.7.x) that has none.
 *
 * It reads what stock Atlas leaves reachable at runtime: the map views in the workspace (`viewId`, `atlasStore`,
 * `tabMetaStore`, `renderer`), the plugin's `settingsService` and its `presentedScene`. It is hacky by design: it
 * depends on private shapes of those objects, so every member is checked before use and a failed check turns that
 * capability off (`has()` is false) rather than throwing. Only what hosting needs is provided: `views`,
 * `presentation`, `rules`, `settings`, `storage` and `lighting` (`stockLighting/`, which fails closed: a lit scene
 * whose lighting cannot be read shows players nothing).
 */
import { normalizePath, type App, type Plugin } from 'obsidian';
import type {
  AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, AtlasSettingKey, AtlasSettingsView, ConnectingPlugin, Disposer,
  MapRules, PresentationListener, PresentationTarget, PresentedSceneInfo, SceneSnapshot, ViewCamera, ViewInfo,
} from '@atlas-vtt/api-types';
import { resolveMeasurementSettings } from '@atlas-vtt/shared/grid';
import { stockLightingApi } from './stockLighting/stockLighting';
import { stockDiceApi } from './stockDice/stockDice';
import { stockLasersApi } from './stockLasers/stockLasers';
import { stockTokensApi } from './stockTokens/stockTokens';
import { stockUi } from './stockUi/stockUi';

export const STOCK_API_VERSION = '1.0.0';

const ATLAS_VIEW_TYPE = 'atlas-vtt';
const NEW_VIEW_POLL_MS = 1000;
const PRESENT_TIMEOUT_MS = 15_000;
const STORAGE_ROOT = 'atlas-vtt/.atlas-data/extensions';
const PLAYER_VIEW_KEYS = ['showGrid', 'showTokenNameplates', 'showWidgets', 'showInitiative'] as const;

interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}
interface StockTab { id: string; filePath: string; displayName: string }
interface StockSceneState {
  mapPath: string | null;
  mapLoaded: boolean;
  isMapLoading: boolean;
  background: SceneSnapshot['background'];
  grid: SceneSnapshot['grid'];
  objects: SceneSnapshot['objects'];
  widgetSettings: SceneSnapshot['widgets']['settings'];
  widgetValues: SceneSnapshot['widgets']['values'];
  initiative: SceneSnapshot['initiative'];
  initiativeTrackerOpen: boolean;
  lighting: SceneSnapshot['lighting'];
  remoteView?: unknown;
}
interface StockViewport {
  readonly center: { readonly x: number; readonly y: number };
  readonly worldScreenWidth: number;
  readonly worldScreenHeight: number;
  readonly destroyed: boolean;
  on(event: 'frame-end', listener: () => void): unknown;
  off(event: 'frame-end', listener: () => void): unknown;
}
interface StockView {
  readonly viewId: string;
  readonly containerEl?: HTMLElement;
  readonly serviceManager?: unknown;
  readonly atlasStore: Store<StockSceneState>;
  readonly tabMetaStore: Store<{ tabs: StockTab[]; activeTabId: string | null }>;
  readonly renderer?: {
    /** Stock Atlas 0.7: the tiled map image, whose `worldRect` is the map in world units. */
    getMapImage?(): { readonly worldRect: { width: number; height: number } | null } | null;
    /** The fork's earlier renderer: a single background sprite. */
    getBackgroundSprite?(): { width: number; height: number; destroyed: boolean } | null;
    getViewportInstance?(): StockViewport | null;
  } | null;
  switchToTab(tabId: string): Promise<void>;
}
interface StockPresentedScene {
  get(): { tabId: string; filePath: string } | null;
  onChange(listener: (scene: { tabId: string; filePath: string } | null) => void): () => void;
  showElsewhere(): () => void;
  set?(scene: { tabId: string; filePath: string } | null): void;
}
interface StockSettings {
  getLaserPointerSettings(): { color: string; size: number };
  getDiceLook(): { colour: string; font: string };
  getDiceDisplay(): AtlasSettingsView['diceDisplay'];
  getLocalPlayerViewSettings(): Record<string, unknown>;
  /** Whether an experimental feature is switched on (`dynamicLighting`); absent on an Atlas without them. */
  isExperimentalOn?(id: string): unknown;
  onChange(listener: () => void): () => void;
}
interface StockPlugin {
  settingsService?: StockSettings;
  presentedScene?: StockPresentedScene;
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A zustand store is a function with `getState` and `subscribe` attached, so it is not an object. */
const isStore = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;

function isStockView(view: unknown): view is StockView {
  if (!isObj(view)) return false;
  const { viewId, atlasStore, tabMetaStore } = view;
  return typeof viewId === 'string' && isStore(atlasStore) && typeof atlasStore.getState === 'function' && typeof atlasStore.subscribe === 'function'
    && isStore(tabMetaStore) && typeof tabMetaStore.getState === 'function' && typeof tabMetaStore.subscribe === 'function' && typeof view.switchToTab === 'function';
}

function isStockPlugin(plugin: unknown): plugin is StockPlugin & Plugin {
  return isObj(plugin);
}

/** Whether `plugin` is a stock Atlas whose internals this shim can read (it has no API of its own). */
export function canShimStockAtlas(plugin: unknown): boolean {
  if (!isStockPlugin(plugin)) return false;
  const { presentedScene, settingsService } = plugin;
  return isObj(presentedScene) && typeof presentedScene.get === 'function' && typeof presentedScene.onChange === 'function' && typeof presentedScene.showElsewhere === 'function'
    && isObj(settingsService) && typeof settingsService.getLocalPlayerViewSettings === 'function' && typeof settingsService.onChange === 'function';
}

function mapViews(app: App): StockView[] {
  const found: StockView[] = [];
  for (const leaf of app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
    const { view } = leaf;
    if (isStockView(view) && view.atlasStore.getState().remoteView == null) found.push(view);
  }
  return found;
}

/** The map view the GM works in: the most recent leaf when it is one, else the first open. */
function activeMapView(app: App): StockView | null {
  const recent = app.workspace.getMostRecentLeaf?.()?.view;
  if (isStockView(recent) && recent.atlasStore.getState().remoteView == null) return recent;
  return mapViews(app)[0] ?? null;
}

const loaded = (state: Pick<StockSceneState, 'mapLoaded' | 'isMapLoading'>): boolean => state.mapLoaded && !state.isMapLoading;

function viewInfo(view: StockView): ViewInfo {
  const state = view.atlasStore.getState();
  const { tabs, activeTabId } = view.tabMetaStore.getState();
  return Object.freeze({
    viewId: view.viewId,
    kind: 'map' as const,
    activeTabId,
    tabs: Object.freeze(tabs.map((tab) => Object.freeze({ tabId: tab.id, mapPath: tab.filePath, name: tab.displayName }))),
    mapPath: state.mapPath,
    loaded: loaded(state),
  });
}

/** The tab whose scene the view's store holds, loaded: its active tab once the store holds that tab's map. */
function snapshotTabId(view: StockView): string | null {
  const state = view.atlasStore.getState();
  const { tabs, activeTabId } = view.tabMetaStore.getState();
  const tab = tabs.find((entry) => entry.id === activeTabId);
  return tab && loaded(state) && state.mapPath === tab.filePath ? tab.id : null;
}

/** The loaded background's size in world pixels; 0 × 0 while none is loaded. */
function mapSize(view: StockView): { width: number; height: number } {
  const rect = view.renderer?.getMapImage?.()?.worldRect ?? null;
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const sprite = view.renderer?.getBackgroundSprite?.() ?? null;
  return sprite && !sprite.destroyed && sprite.width > 0 && sprite.height > 0 ? { width: sprite.width, height: sprite.height } : { width: 0, height: 0 };
}

function snapshot(view: StockView): SceneSnapshot {
  const state = view.atlasStore.getState();
  return Object.freeze({
    viewId: view.viewId,
    mapPath: state.mapPath,
    loaded: loaded(state),
    tabId: snapshotTabId(view),
    mapSize: Object.freeze(mapSize(view)),
    background: state.background,
    grid: state.grid,
    objects: state.objects,
    widgets: Object.freeze({ settings: state.widgetSettings, values: state.widgetValues }),
    initiative: state.initiative,
    initiativeTrackerOpen: state.initiativeTrackerOpen,
    lighting: state.lighting,
  });
}

function liveViewport(view: StockView): StockViewport | null {
  const viewport = view.renderer?.getViewportInstance?.() ?? null;
  return viewport && !viewport.destroyed ? viewport : null;
}

function camera(view: StockView): ViewCamera | null {
  const viewport = liveViewport(view);
  if (!viewport || !(viewport.worldScreenWidth > 0) || !(viewport.worldScreenHeight > 0)) return null;
  return Object.freeze({ centerX: viewport.center.x, centerY: viewport.center.y, width: viewport.worldScreenWidth, height: viewport.worldScreenHeight });
}

/** The slice of a view's stores a snapshot is made of; unchanged by reference means no new snapshot. */
function snapshotSlice(view: StockView): readonly unknown[] {
  const s = view.atlasStore.getState();
  return [snapshotTabId(view), s.mapPath, s.mapLoaded, s.isMapLoading, s.background, s.grid, s.objects.tokens, s.objects.texts, s.objects.drawings,
    s.objects.fog, s.widgetSettings, s.widgetValues, s.initiative, s.initiativeTrackerOpen, s.lighting];
}

function guard(what: string, call: () => void): void {
  try {
    call();
  } catch (error) {
    console.error(`[Atlas VTT Connect] A stock Atlas ${what} listener failed:`, error);
  }
}

/** Atlas's defaults: a stock Atlas gives no read of a collection's rules, so every map gets these. */
function defaultRules(): MapRules {
  return Object.freeze({
    collectionId: null,
    gridDefaults: null,
    measurement: Object.freeze({ ...resolveMeasurementSettings(undefined, null), coneAngle: 90 }),
    resources: Object.freeze([]),
    conditions: Object.freeze([]),
    initiative: Object.freeze({ mode: 'turn-order' as const, roll: '1d20', firstSide: 'players' as const }),
    dice: Object.freeze({ defaultRoll: '1d20', crit: 'natural' as const }),
  });
}

function settingsView(service: StockSettings): AtlasSettingsView {
  const laser = service.getLaserPointerSettings();
  const look = service.getDiceLook();
  const player = service.getLocalPlayerViewSettings();
  return {
    laserPointer: { color: laser.color, size: laser.size },
    diceLook: { colour: look.colour, font: look.font },
    diceDisplay: service.getDiceDisplay(),
    // Stock 0.7 has no `showGrid` rule: players see the grid as the GM set it (the scene's own `visible` still hides it).
    playerView: Object.fromEntries(PLAYER_VIEW_KEYS.map((key) => [key, key === 'showGrid' ? player[key] !== false : player[key] === true])) as AtlasSettingsView['playerView'],
  };
}

class Events {
  private readonly listeners = new Map<keyof AtlasEvents, Set<(...args: never[]) => void>>();
  on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer {
    if (typeof listener !== 'function') return () => undefined;
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(listener);
    return () => { set.delete(listener); };
  }
  emit<E extends keyof AtlasEvents>(event: E, ...args: Parameters<AtlasEvents[E]>): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) guard(String(event), () => (listener as (...a: unknown[]) => void)(...args));
  }
}

/** What follows the open Atlas views: map-loaded, map-closed, tabs-changed; polled for views opened later (no event announces them). */
function watchViews(app: App, events: Events): Disposer {
  const tracked = new Map<string, { view: StockView; stop: () => void }>();
  const track = (view: StockView): void => {
    if (tracked.has(view.viewId)) return;
    let wasLoaded = loaded(view.atlasStore.getState());
    let tabsKey = JSON.stringify([view.tabMetaStore.getState().activeTabId, view.tabMetaStore.getState().tabs.map((tab) => [tab.id, tab.filePath, tab.displayName])]);
    let queued = false;
    const stopScene = view.atlasStore.subscribe(() => {
      const now = loaded(view.atlasStore.getState());
      if (now && !wasLoaded) events.emit('map-loaded', viewInfo(view));
      wasLoaded = now;
    });
    const stopTabs = view.tabMetaStore.subscribe(() => {
      const state = view.tabMetaStore.getState();
      const key = JSON.stringify([state.activeTabId, state.tabs.map((tab) => [tab.id, tab.filePath, tab.displayName])]);
      if (key === tabsKey || queued) return;
      tabsKey = key;
      queued = true;
      queueMicrotask(() => { queued = false; events.emit('tabs-changed', viewInfo(view)); });
    });
    tracked.set(view.viewId, { view, stop: () => { stopScene(); stopTabs(); } });
    if (wasLoaded) events.emit('map-loaded', viewInfo(view));
  };
  const sync = (): void => {
    const open = new Set<string>();
    for (const view of mapViews(app)) {
      open.add(view.viewId);
      track(view);
    }
    for (const [viewId, entry] of [...tracked]) {
      if (open.has(viewId)) continue;
      entry.stop();
      tracked.delete(viewId);
      events.emit('map-closed', viewId);
    }
  };
  sync();
  const timer = window.setInterval(sync, NEW_VIEW_POLL_MS);
  const ref = app.workspace.on('layout-change', sync);
  return () => {
    window.clearInterval(timer);
    app.workspace.offref(ref);
    for (const { stop } of tracked.values()) stop();
    tracked.clear();
  };
}

function trackedView(app: App, viewId: string): StockView | null {
  return mapViews(app).find((view) => view.viewId === viewId) ?? null;
}

function presentationApi(app: App, atlas: StockPlugin, presented: StockPresentedScene, disposers: Set<Disposer>): AtlasExtension['presentation'] {
  let counter = 0;
  let presentationId = '';
  const remember = (scene: { tabId: string; filePath: string } | null): void => {
    if (scene) presentationId = `stock-${Date.now()}-${++counter}`;
  };
  remember(presented.get());
  disposers.add(presented.onChange(remember));
  const add = (dispose: Disposer): Disposer => {
    disposers.add(dispose);
    return () => { disposers.delete(dispose); dispose(); };
  };

  const current = (): PresentedSceneInfo | null => {
    const scene = presented.get();
    if (!scene) return null;
    const views = mapViews(app);
    const owner = views.find((view) => view.tabMetaStore.getState().tabs.some((tab) => tab.id === scene.tabId))
      ?? views.find((view) => view.tabMetaStore.getState().tabs.some((tab) => tab.filePath === scene.filePath));
    if (!owner) return null;
    const tab = owner.tabMetaStore.getState().tabs.find((entry) => entry.id === scene.tabId)
      ?? owner.tabMetaStore.getState().tabs.find((entry) => entry.filePath === scene.filePath);
    if (!tab) return null;
    return Object.freeze({ presentationId, viewId: owner.viewId, tabId: tab.id, mapPath: tab.filePath, held: snapshotTabId(owner) !== tab.id });
  };

  return Object.freeze({
    current,
    present: async (viewId: string, tabId?: string): Promise<boolean> => {
      const view = trackedView(app, viewId);
      const target = tabId ?? view?.tabMetaStore.getState().activeTabId ?? null;
      const tab = view?.tabMetaStore.getState().tabs.find((entry) => entry.id === target);
      if (!view || !tab) return false;
      try {
        await view.switchToTab(tab.id);
        const leaf = app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).find((entry) => entry.view === (view as unknown));
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: false });
        // Atlas's own command also hands the canvas to an open player window; without it the scene is only recorded.
        const commands = (app as unknown as { commands?: { executeCommandById?(id: string): boolean } }).commands;
        const ran = commands?.executeCommandById?.('atlas-vtt:send-map-to-player-view') === true;
        if (!ran) presented.set?.({ tabId: tab.id, filePath: tab.filePath });
        const deadline = Date.now() + PRESENT_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const now = presented.get();
          if (now?.tabId === tab.id) break;
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error('[Atlas VTT Connect] Presenting a scene on stock Atlas failed:', error);
        return false;
      }
      const info = current();
      return Boolean(info && info.viewId === view.viewId && info.tabId === tab.id && !info.held);
    },
    stop: (): void => {
      if (typeof presented.set === 'function') presented.set?.(null);
    },
    subscribe: (listener: PresentationListener): Disposer => {
      let previous = current();
      const evaluate = (): void => {
        const next = current();
        const before = previous;
        previous = next;
        if (!before && next) guard('presentation', () => (next.held ? listener.held?.(next) : listener.presented?.(next, false)));
        else if (before && !next) guard('presentation', () => listener.cleared?.(before));
        else if (before && next) {
          if (before.presentationId !== next.presentationId || before.viewId !== next.viewId || before.tabId !== next.tabId) {
            guard('presentation', () => (next.held ? listener.held?.(next) : listener.presented?.(next, false)));
          } else if (!before.held && next.held) guard('presentation', () => listener.held?.(next));
          else if (before.held && !next.held) guard('presentation', () => listener.presented?.(next, true));
        }
      };
      // The tabs and the store of every open view say whether the presented tab is still the one on screen.
      const stores = new Map<string, () => void>();
      const watchStores = (): void => {
        const open = new Set<string>();
        for (const view of mapViews(app)) {
          open.add(view.viewId);
          if (stores.has(view.viewId)) continue;
          const stopTabs = view.tabMetaStore.subscribe(evaluate);
          const stopScene = view.atlasStore.subscribe(evaluate);
          stores.set(view.viewId, () => { stopTabs(); stopScene(); });
        }
        for (const [viewId, stop] of [...stores]) if (!open.has(viewId)) { stop(); stores.delete(viewId); }
        evaluate();
      };
      watchStores();
      const stopChange = presented.onChange(evaluate);
      const timer = window.setInterval(watchStores, NEW_VIEW_POLL_MS);
      return add(() => {
        window.clearInterval(timer);
        stopChange();
        for (const stop of stores.values()) stop();
        stores.clear();
      });
    },
    addTarget: (target: PresentationTarget): Disposer => {
      if (!isObj(target) || typeof target.id !== 'string' || target.id === '' || typeof target.label !== 'string' || typeof target.isActive !== 'function') {
        throw new Error('presentation.addTarget: the target must be { id: non-empty string, label: string, isActive(): boolean }.');
      }
      // Connect shows players the scene itself: stock Atlas then opens no player window when a scene is presented.
      return add(presented.showElsewhere());
    },
  });
}

function viewsApi(app: App, disposers: Set<Disposer>): AtlasExtension['views'] {
  const add = (dispose: Disposer): Disposer => {
    disposers.add(dispose);
    return () => { disposers.delete(dispose); dispose(); };
  };
  return Object.freeze({
    list: (): ViewInfo[] => mapViews(app).map(viewInfo),
    active: (): ViewInfo | null => {
      // The most recent leaf is the one the GM works in; any open map view stands in when it is something else.
      const recent = app.workspace.getMostRecentLeaf?.()?.view;
      if (isStockView(recent) && recent.atlasStore.getState().remoteView == null) return viewInfo(recent);
      const [first] = mapViews(app);
      return first ? viewInfo(first) : null;
    },
    snapshot: (viewId: string): SceneSnapshot | null => {
      const view = trackedView(app, viewId);
      return view ? snapshot(view) : null;
    },
    subscribe: (viewId: string, listener: (snapshot: SceneSnapshot) => void): Disposer => {
      const view = trackedView(app, viewId);
      if (!view || typeof listener !== 'function') return () => undefined;
      let slice = snapshotSlice(view);
      const changed = (): void => {
        const next = snapshotSlice(view);
        if (slice.length === next.length && slice.every((value, index) => value === next[index])) return;
        slice = next;
        guard('view', () => listener(snapshot(view)));
      };
      const stopScene = view.atlasStore.subscribe(changed);
      const stopTabs = view.tabMetaStore.subscribe(changed);
      return add(() => { stopScene(); stopTabs(); });
    },
    camera: (viewId: string): ViewCamera | null => {
      const view = trackedView(app, viewId);
      return view ? camera(view) : null;
    },
    watchCamera: (viewId: string, listener: (camera: ViewCamera) => void): Disposer => {
      const view = trackedView(app, viewId);
      const viewport = view ? liveViewport(view) : null;
      if (!view || !viewport || typeof listener !== 'function') return () => undefined;
      const frame = (): void => {
        const now = camera(view);
        if (now) guard('camera', () => listener(now));
      };
      viewport.on('frame-end', frame);
      return add(() => { if (!viewport.destroyed) viewport.off('frame-end', frame); });
    },
  });
}

/** Whether Atlas's dynamic lighting experiment is on; null when its settings cannot be read. */
function dynamicLighting(service: StockSettings): boolean | null {
  const on = typeof service.isExperimentalOn === 'function' ? service.isExperimentalOn('dynamicLighting') : undefined;
  return typeof on === 'boolean' ? on : null;
}

/** Builds the stand-in API. The caller has checked `canShimStockAtlas(app.plugins.plugins['atlas-vtt'])`. */
export function stockAtlasApi(app: App, atlasPlugin: StockPlugin): AtlasApi {
  const capabilities = new Set<AtlasCapability>(['views', 'presentation', 'rules', 'settings', 'storage', 'lighting', 'ui', 'tokens', 'dice', 'lasers']);
  return Object.freeze({
    version: STOCK_API_VERSION,
    has: (capability: AtlasCapability): boolean => capabilities.has(capability),
    connect: (plugin: ConnectingPlugin): AtlasExtension => {
      const disposers = new Set<Disposer>();
      const events = new Events();
      const presented = atlasPlugin.presentedScene as StockPresentedScene;
      const service = atlasPlugin.settingsService as StockSettings;
      disposers.add(watchViews(app, events));
      let previous = settingsView(service);
      disposers.add(service.onChange(() => {
        guard('settings', () => {
          const next = settingsView(service);
          const changed = (Object.keys(next) as AtlasSettingKey[]).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
          previous = next;
          for (const key of changed) events.emit('settings-changed', key);
        });
      }));
      const ref = app.workspace.on('atlas-vtt:collection-settings-changed' as never, ((id: string | null) => events.emit('rules-changed', id ?? null)) as never);
      disposers.add(() => app.workspace.offref(ref));
      plugin.register(() => { for (const dispose of [...disposers]) guard('teardown', dispose); disposers.clear(); });
      const extensionId = plugin.manifest.id;
      const folder = async (): Promise<string> => {
        const path = normalizePath(`${STORAGE_ROOT}/${extensionId}`);
        let built = '';
        for (const part of path.split('/')) {
          built = built ? `${built}/${part}` : part;
          if (!(await app.vault.adapter.exists(built))) await app.vault.adapter.mkdir(built);
        }
        return path;
      };
      // The floating dock stands in for the toolbar, palette, menus and panels stock Atlas has no slots for.
      const ui = stockUi(app, {
        views: () => mapViews(app),
        active: () => activeMapView(app),
        presentedTabId: () => presented.get()?.tabId ?? null,
        onViewsChanged: (listener) => {
          const stops = (['map-loaded', 'map-closed', 'tabs-changed'] as const).map((event) => events.on(event, listener as never));
          return () => { for (const stop of stops) stop(); };
        },
      });
      disposers.add(ui.dispose);
      return Object.freeze({
        id: extensionId,
        views: viewsApi(app, disposers),
        presentation: presentationApi(app, atlasPlugin, presented, disposers),
        rules: Object.freeze({ forMap: (): MapRules => defaultRules() }),
        ui: ui.api,
        lasers: stockLasersApi({
          view: (viewId) => trackedView(app, viewId),
          add: (dispose) => {
            disposers.add(dispose);
            return () => { disposers.delete(dispose); dispose(); };
          },
        }),
        dice: stockDiceApi({
          views: () => {
            const first = activeMapView(app);
            const open = mapViews(app);
            return [...(first ? [first] : []), ...open.filter((view) => view !== first)].map((view) => ({
              viewId: view.viewId, mapPath: () => view.atlasStore.getState().mapPath, serviceManager: view.serviceManager,
            }));
          },
          onViewsChanged: (listener) => {
            const stops = (['map-loaded', 'map-closed'] as const).map((event) => events.on(event, listener as never));
            return () => { for (const stop of stops) stop(); };
          },
          add: (dispose) => {
            disposers.add(dispose);
            return () => { disposers.delete(dispose); dispose(); };
          },
        }),
        tokens: stockTokensApi({
          view: (viewId) => trackedView(app, viewId),
          mapSize,
          dynamicLighting: () => dynamicLighting(service),
        }),
        lighting: stockLightingApi({
          view: (viewId) => trackedView(app, viewId),
          mapSize,
          dynamicLighting: () => dynamicLighting(service),
          add: (dispose) => {
            disposers.add(dispose);
            return () => { disposers.delete(dispose); dispose(); };
          },
        }),
        settings: Object.freeze({ get: <K extends AtlasSettingKey>(key: K): AtlasSettingsView[K] => settingsView(service)[key] }),
        storage: Object.freeze({ folder }),
        on: <E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer => events.on(event, listener),
      }) as unknown as AtlasExtension;
    },
  });
}
