/**
 * A stand-in for Atlas's extension API on a stock Atlas (ByteMirror 0.7 to 0.12) that has none.
 *
 * It reads what stock Atlas leaves reachable at runtime: the map views in the workspace (`viewId`, `atlasStore`,
 * `tabMetaStore`, `renderer`, `serviceManager`), the plugin's `settingsService` and its `presentedScene`. It is hacky by
 * design: it depends on private shapes of those objects, so every member is checked before use and a failed check turns
 * that capability off (`has()` is false) or makes the call fail closed, rather than throwing. What it provides:
 * `views` (with `showTab`, so `scene-tabs`), `presentation`, `rules` (the defaults), `settings`, `storage`, `lighting`
 * (`stockLighting/`, which fails closed: a lit scene whose lighting cannot be read shows players nothing), `tokens`
 * (`stockTokens/`: players' moves, stopped at walls on a lit scene), `dice` (`stockDice/`), `lasers` (`stockLasers/`)
 * and `ui` (`stockUi/`: a floating dock and panels, in place of the slots stock Atlas does not have). Not provided:
 * `scenes`, `bundles` and `collections` (sharing notes and maps, per-collection rules).
 */
import { tabletopBoardViews } from './tabletopMinis';
import { backgroundOfLevel, levelHeld, objectsOnLevel, shownLevel } from './stockLevels';
import { effectiveAlignment } from '../app/online/scene/mapPlacement';
import { normalizePath, TFile, type App, type Plugin } from 'obsidian';
import type {
  AtlasApi, AtlasCapability, AtlasEvents, AtlasExtension, AtlasSettingKey, AtlasSettingsView, ConnectingPlugin, Disposer,
  MapRules, PresentationListener, PresentationTarget, PresentedSceneInfo, SceneSnapshot, TokenSettings, ViewCamera, ViewInfo,
} from '@atlas-vtt/api-types';
import { readDragDistance, resolveMeasurementSettings } from '../../packages/atlas-shared/src/index';
import { stockLightingApi } from './stockLighting/stockLighting';
import { onlineSessionStore } from '../app/online/onlineSessionStore';
import { stockDiceApi } from './stockDice/stockDice';
import { stockMapRules, stockMovement } from './stockRules';
import { stockMeasuresApi } from './stockMeasures';
import { fileMemory, PartyLinks, type LibraryToken } from './stockParty/partyLinks';
import { partyScenes, SavedSceneTokens } from './stockParty/savedScene';
import { AtlasHost, loadDeferredLeaves, wakeAtlasForHosting } from '../../packages/atlas-host/src/index';
import { claimHostWhileHosting } from './hostClaim';
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
  /** Atlas 0.10's levels (floors) and the one this view shows; an older Atlas has neither. */
  levels?: unknown;
  viewedLevel?: unknown;
  /** Atlas 0.10's alignment of each level's map image, by level id. */
  levelAlignments?: unknown;
  widgetSettings: SceneSnapshot['widgets']['settings'];
  widgetValues: SceneSnapshot['widgets']['values'];
  initiative: SceneSnapshot['initiative'];
  initiativeTrackerOpen: boolean;
  lighting: SceneSnapshot['lighting'];
  /** The map's token settings: instance badges and the ring's size reach players from here. */
  tokenSettings?: Partial<TokenSettings>;
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
    /** The token layer, which can say which token is under a point (for the token menu). */
    getTokenRenderer?(): { hitTestTokens?(x: number, y: number): string | null; viewport?: { toWorld?(point: { x: number; y: number }): { x: number; y: number } } } | null | undefined;
  } | null;
  switchToTab(tabId: string): Promise<void>;
}
/** The scene shown to players: its tab, its file, and (Atlas 0.10, "Show this level on the player view") the level of it. */
interface StockPresentedState {
  tabId: string;
  filePath: string;
  levelId?: string;
}
interface StockPresentedScene {
  get(): StockPresentedState | null;
  onChange(listener: (scene: StockPresentedState | null) => void): () => void;
  showElsewhere(): () => void;
  set?(scene: StockPresentedState | null): void;
}
interface StockSettings {
  getLaserPointerSettings(): { color: string; size: number };
  getDiceLook(): { colour: string; font: string };
  getDiceDisplay(): AtlasSettingsView['diceDisplay'];
  getLocalPlayerViewSettings(): Record<string, unknown>;
  /** What the initiative tracker does as the turn moves on (`movesOnTurn`: players move only on their turn); absent on an Atlas without it. */
  initiativeTurnOptions?(): { movesOnTurn?: unknown };
  /** Atlas 0.15: when a dragged token shows its distance (`always`, `combat`, `never`); absent on an older Atlas. */
  getDragDistance?(): unknown;
  /** Whether an experimental feature is switched on (`dynamicLighting`); absent on an Atlas without them. */
  isExperimentalOn?(id: string): unknown;
  onChange(listener: () => void): () => void;
}
interface StockPlugin {
  settingsService?: StockSettings;
  presentedScene?: StockPresentedScene;
  /** Obsidian's copy of the plugin's manifest: its version. */
  manifest?: { version?: unknown };
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
function loadedTabId(view: StockView): string | null {
  const state = view.atlasStore.getState();
  const { tabs, activeTabId } = view.tabMetaStore.getState();
  const tab = tabs.find((entry) => entry.id === activeTabId);
  return tab && loaded(state) && state.mapPath === tab.filePath ? tab.id : null;
}

/**
 * The tab whose scene a snapshot holds and shows players: the loaded tab (`loadedTabId`), except while it is the
 * presented tab and the GM looks at another level than the player view shows (the presented scene's level, the first
 * where none is named; Atlas's `N4e`). Players keep the last picture then, as Atlas's own online play holds it, instead of
 * seeing a floor the GM is only browsing.
 */
function snapshotTabId(view: StockView, presented: StockPresentedScene | null): string | null {
  const tabId = loadedTabId(view);
  const scene = presented?.get();
  if (tabId === null || !scene || scene.tabId !== tabId) return tabId;
  const state = view.atlasStore.getState();
  return levelHeld(state.levels, state.viewedLevel, scene.levelId) ? null : tabId;
}

/** The loaded background's size in world pixels; 0 × 0 while none is loaded. */
function mapSize(view: StockView): { width: number; height: number } {
  const rect = view.renderer?.getMapImage?.()?.worldRect ?? null;
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const sprite = view.renderer?.getBackgroundSprite?.() ?? null;
  return sprite && !sprite.destroyed && sprite.width > 0 && sprite.height > 0 ? { width: sprite.width, height: sprite.height } : { width: 0, height: 0 };
}

/**
 * The view's scene as players are sent it: the floor the view shows. With `level`, that floor of the scene instead
 * (a cutscene's scene at the level its shot names, whatever floor the GM is on): its tab is the loaded one then, never
 * held back for the level the GM browses. Its `mapSize` stays the shown floor's image's.
 */
function snapshot(view: StockView, presented: StockPresentedScene | null, level?: string): SceneSnapshot {
  const state = view.atlasStore.getState();
  const viewed = level ?? state.viewedLevel;
  return Object.freeze({
    viewId: view.viewId,
    mapPath: state.mapPath,
    loaded: loaded(state),
    tabId: level === undefined ? snapshotTabId(view, presented) : loadedTabId(view),
    mapSize: Object.freeze(mapSize(view)),
    // A scene of several floors is sent as the one floor shown (Atlas 0.10), never all of them.
    background: backgroundOfLevel(state.background, state.levels, viewed),
    // How Atlas aligned that floor's map image (the grid's stretch, or the level's own alignment): players draw it so.
    mapAlignment: effectiveAlignment(state.grid, state.levelAlignments, shownLevel(state.levels, viewed)),
    grid: state.grid,
    // Atlas 0.15's rooms are walls among the others: nothing to add for them.
    objects: objectsOnLevel(state.objects, state.levels, viewed),
    widgets: Object.freeze({ settings: state.widgetSettings, values: state.widgetValues }),
    initiative: state.initiative,
    initiativeTrackerOpen: state.initiativeTrackerOpen,
    lighting: state.lighting,
    ...(state.tokenSettings ? { tokenSettings: state.tokenSettings } : {}),
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
function snapshotSlice(view: StockView, presented: StockPresentedScene | null): readonly unknown[] {
  const s = view.atlasStore.getState();
  return [snapshotTabId(view, presented), s.mapPath, s.mapLoaded, s.isMapLoading, s.background, s.grid, s.objects.tokens, s.objects.texts, s.objects.drawings, (s.objects as { pins?: unknown }).pins,
    s.objects.fog, s.widgetSettings, s.widgetValues, s.initiative, s.initiativeTrackerOpen, s.lighting, s.tokenSettings,
    // Walls and lights: Tabletop's 3D board shows players doors opening and lights.
    (s.objects as { walls?: unknown }).walls, (s.objects as { lights?: unknown }).lights,
    // Atlas 0.14's rooms, whose outline stands as walls.
    (s.objects as { rooms?: unknown }).rooms,
    // Atlas 0.10's water, lava and acid: map art players are sent.
    (s.objects as { liquids?: unknown }).liquids,
    s.levels, s.viewedLevel, s.levelAlignments];
}

function guard(what: string, call: () => void): void {
  try {
    call();
  } catch (error) {
    console.error(`[Atlas VTT Connect] A stock Atlas ${what} listener failed:`, error);
  }
}

/** Atlas's defaults: what a map gets of every rule its collection does not say (`stockMapRules`), its dice rules included. */
function defaultRules(): MapRules {
  return Object.freeze({
    collectionId: null,
    gridDefaults: null,
    // Atlas 0.15's settings; the extension API's type is older (it knows no Manhattan rule).
    measurement: Object.freeze({ ...resolveMeasurementSettings(undefined, null), coneAngle: 90 }) as unknown as MapRules['measurement'],
    resources: Object.freeze([]),
    conditions: Object.freeze([]),
    initiative: Object.freeze({ mode: 'turn-order' as const, roll: '1d20', firstSide: 'players' as const }),
    dice: Object.freeze({ defaultRoll: '1d20', crit: 'natural' as const }),
  });
}

/** The initiative tracker's turn options, read as they are; none where this Atlas keeps no such setting or it cannot be read. */
function turnOptions(service: StockSettings): { movesOnTurn?: unknown } {
  try {
    const options = service.initiativeTurnOptions?.();
    return isObj(options) ? options : {};
  } catch {
    return {};
  }
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
    // `showDiceRolls` is no rule of the API's: it says whether the GM's rolls are shared with players, as Atlas's own online play reads it.
    // `movesOnTurn` is none either: whether players may move a token only while it has the turn.
    playerView: {
      ...Object.fromEntries(PLAYER_VIEW_KEYS.map((key) => [key, key === 'showGrid' ? player[key] !== false : player[key] === true])),
      showDiceRolls: player.showDiceRolls === true,
      movesOnTurn: turnOptions(service).movesOnTurn === true,
      // Atlas 0.15: when a dragged token shows its distance; players' rulers follow it.
      dragDistance: readDragDistance(typeof service.getDragDistance === 'function' ? service.getDragDistance() : undefined),
    } as unknown as AtlasSettingsView['playerView'],
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

/** How long a woken Atlas tab is waited for to become a map view. */
const WAKE_VIEW_MS = 5_000;

/** Atlas's map views with their map loaded, or soon: loads a deferred Atlas tab (`atlas-host`) and waits for it. */
async function waitForLoadedView(app: App, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (mapViews(app).some((view) => loadedTabId(view) !== null)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

/**
 * The map view to present `tabId` of when `viewId` names none: Atlas's tab was deferred (not shown since Obsidian
 * started, the GM on Tabletop's board). It is loaded, then the view named, else the one holding the tab, else the first.
 */
async function wokenView(app: App, viewId: string, tabId: string | undefined): Promise<StockView | null> {
  if (!(await loadDeferredLeaves(app, ATLAS_VIEW_TYPE))) return null;
  const deadline = Date.now() + WAKE_VIEW_MS;
  while (mapViews(app).length === 0 && Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 50));
  const views = mapViews(app);
  return trackedView(app, viewId)
    ?? (tabId === undefined ? null : views.find((view) => view.tabMetaStore.getState().tabs.some((tab) => tab.id === tabId)) ?? null)
    ?? views[0] ?? null;
}

/**
 * After waking Atlas's tab for hosting: with nothing presented, the view's tab is presented, so players get a scene. A
 * scene presented before (Atlas keeps it across restarts) stays the presented one, and Atlas's tab is left where it is:
 * Connect never moves the host on its own. The GM's board brings its map up, or the GM presents from Atlas.
 */
async function ensurePresented(app: App, presented: StockPresentedScene): Promise<void> {
  if (presented.get()) return;
  const view = activeMapView(app);
  const tabId = view ? loadedTabId(view) : null;
  const tab = tabId === null ? undefined : view?.tabMetaStore.getState().tabs.find((entry) => entry.id === tabId);
  if (tab) presented.set?.({ tabId: tab.id, filePath: tab.filePath });
}

function presentationApi(app: App, atlas: StockPlugin, presented: StockPresentedScene, disposers: Set<Disposer>): AtlasExtension['presentation'] {
  let counter = 0;
  let presentationId = '';
  const remember = (scene: StockPresentedState | null): void => {
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
    // Held while the GM's view is not on the presented tab, nor on the presented level (`snapshotTabId`).
    return Object.freeze({ presentationId, viewId: owner.viewId, tabId: tab.id, mapPath: tab.filePath, held: snapshotTabId(owner, presented) !== tab.id });
  };

  return Object.freeze({
    current,
    present: async (viewId: string, tabId?: string): Promise<boolean> => {
      const view = trackedView(app, viewId) ?? await wokenView(app, viewId, tabId);
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

/** The name Connect's data is kept under: Atlas's extension folder and the map files' extensions key. */
export const CONNECT_STORAGE_ID = 'atlas-vtt-connect';

function viewsApi(app: App, presented: StockPresentedScene | null, disposers: Set<Disposer>): AtlasExtension['views'] {
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
    snapshot: (viewId: string, level?: string): SceneSnapshot | null => {
      const view = trackedView(app, viewId);
      return view ? snapshot(view, presented, level) : null;
    },
    subscribe: (viewId: string, listener: (snapshot: SceneSnapshot) => void): Disposer => {
      const view = trackedView(app, viewId);
      if (!view || typeof listener !== 'function') return () => undefined;
      let slice = snapshotSlice(view, presented);
      const changed = (): void => {
        const next = snapshotSlice(view, presented);
        if (slice.length === next.length && slice.every((value, index) => value === next[index])) return;
        slice = next;
        guard('view', () => listener(snapshot(view, presented)));
      };
      const stopScene = view.atlasStore.subscribe(changed);
      const stopTabs = view.tabMetaStore.subscribe(changed);
      // Showing another level on the player view changes what is live, with nothing changed in the store.
      const stopPresented = presented?.onChange(changed) ?? (() => undefined);
      return add(() => { stopScene(); stopTabs(); stopPresented(); });
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
    // The GM's view does show the tab while it loads, as it does on any switch; the presented scene holds meanwhile.
    showTab: (viewId: string, tabId: string): Promise<boolean> => showTab(app, viewId, tabId, disposers),
    // Whether the GM works elsewhere than this map view (Tabletop's board): a tab shown only to be read goes back then.
    workingElsewhere: (viewId: string): boolean => {
      const recent = app.workspace.getMostRecentLeaf?.()?.view;
      return !(isStockView(recent) && recent.viewId === viewId);
    },
  } as AtlasExtension['views']);
}

/** How long a tab may take to load before `showTab` gives up. */
const SHOW_TAB_TIMEOUT_MS = 60_000;
/** How often a waiting `showTab` looks for its view having closed. */
const SHOW_TAB_POLL_MS = 500;

/**
 * Makes a tab of a map view active without presenting it, and answers true once its map is loaded in the view's store
 * (`loadedTabId`). False for an unknown view or tab, when another switch (a later `showTab`, or the GM's own click)
 * overtakes this one (the view then shows another tab), when the view closes meanwhile, and after 60 seconds. Never throws.
 */
async function showTab(app: App, viewId: string, tabId: string, disposers: Set<Disposer>): Promise<boolean> {
  const view = trackedView(app, viewId);
  if (!view || typeof tabId !== 'string' || !view.tabMetaStore.getState().tabs.some((tab) => tab.id === tabId)) return false;
  try {
    await view.switchToTab(tabId);
  } catch (error) {
    console.error('[Atlas VTT Connect] Atlas could not switch tabs:', error);
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const stops: Disposer[] = [];
    const finish = (ok: boolean): void => {
      for (const stop of stops.splice(0)) stop();
      resolve(ok);
    };
    const check = (): void => {
      const now = trackedView(app, viewId);
      if (!now || now.tabMetaStore.getState().activeTabId !== tabId) finish(false);
      else if (loadedTabId(now) === tabId) finish(true);
    };
    stops.push(view.atlasStore.subscribe(check), view.tabMetaStore.subscribe(check));
    const poll = window.setInterval(check, SHOW_TAB_POLL_MS);
    const timeout = window.setTimeout(() => finish(false), SHOW_TAB_TIMEOUT_MS);
    // Atlas unloading ends the wait.
    const unload = (): void => finish(false);
    disposers.add(unload);
    stops.push(() => { window.clearInterval(poll); window.clearTimeout(timeout); disposers.delete(unload); });
    check();
  });
}

/** Atlas's library tokens (`AssetService.getTokenAssets`), with whether each is a player character; none where it cannot be read. */
/** Atlas's library tokens; null while no loaded Atlas map view gives its asset service (a deferred tab). */
async function libraryTokens(app: App): Promise<LibraryToken[] | null> {
  const manager = activeMapView(app)?.serviceManager;
  const getService = isObj(manager) ? manager.getAssetService : undefined;
  const service: unknown = typeof getService === 'function' ? (getService as () => unknown).call(manager) : null;
  const getTokens = isObj(service) ? service.getTokenAssets : undefined;
  if (typeof getTokens !== 'function') return null;
  const list: unknown = await (getTokens as () => Promise<unknown>).call(service);
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).flatMap((asset) => (isObj(asset) && typeof asset.id === 'string' && typeof asset.imagePath === 'string' ? [{ id: asset.id, imagePath: asset.imagePath, playerCharacter: asset.playerCharacter === true }] : []));
}

/** Calls `listener` when a view opens or closes, or the tokens on its scene are replaced (placed, removed, a scene loaded). */
function watchTokens(app: App, events: Events, listener: () => void): Disposer {
  const followed = new Map<string, Disposer>();
  const follow = (): void => {
    const open = mapViews(app);
    for (const view of open) {
      if (followed.has(view.viewId)) continue;
      let tokens = view.atlasStore.getState().objects.tokens;
      followed.set(view.viewId, view.atlasStore.subscribe(() => {
        const now = view.atlasStore.getState().objects.tokens;
        // A drag replaces the tokens as it goes: only the set of them matters here.
        if (now === tokens || Object.keys(now).length === Object.keys(tokens).length) { tokens = now; return; }
        tokens = now;
        listener();
      }));
    }
    for (const [id, stop] of [...followed]) {
      if (open.some((view) => view.viewId === id)) continue;
      stop();
      followed.delete(id);
    }
  };
  follow();
  const stops = (['map-loaded', 'map-closed', 'tabs-changed'] as const).map((event) => events.on(event, () => { follow(); listener(); }));
  return () => {
    for (const stop of stops) stop();
    for (const stop of followed.values()) stop();
    followed.clear();
  };
}

/**
 * Whether this Atlas lights scenes as standard: 0.9.1 made dynamic lighting no longer an experiment (a pre-release of
 * 0.9.1 counts too: calling lighting on when Atlas has none built leaves a lit scene dark, never shown).
 */
export function lightingIsStandard(version: unknown): boolean {
  const parts = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
  if (!parts) return false;
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return major > 0 || minor > 9 || (minor === 9 && patch >= 1);
}

/**
 * Whether Atlas's dynamic lighting is on: always from 0.9.1, where asking for the experiment says off; before, the
 * experiment's switch. Null when its settings cannot be read.
 */
function dynamicLighting(service: StockSettings, plugin: StockPlugin): boolean | null {
  if (lightingIsStandard(plugin.manifest?.version)) return true;
  const on = typeof service.isExperimentalOn === 'function' ? service.isExperimentalOn('dynamicLighting') : undefined;
  return typeof on === 'boolean' ? on : null;
}

/** Builds the stand-in API. The caller has checked `canShimStockAtlas(app.plugins.plugins['atlas-vtt'])`. */
export function stockAtlasApi(app: App, atlasPlugin: StockPlugin): AtlasApi {
  const capabilities = new Set<AtlasCapability>(['views', 'presentation', 'rules', 'settings', 'storage', 'lighting', 'ui', 'tokens', 'dice', 'lasers', 'scene-tabs']);
  return Object.freeze({
    version: STOCK_API_VERSION,
    has: (capability: AtlasCapability): boolean => capabilities.has(capability),
    connect: (plugin: ConnectingPlugin): AtlasExtension => {
      const disposers = new Set<Disposer>();
      const events = new Events();
      const presented = atlasPlugin.presentedScene as StockPresentedScene;
      const service = atlasPlugin.settingsService as StockSettings;
      disposers.add(watchViews(app, events));
      // Online play needs Atlas's map view: a tab still deferred since Obsidian started is loaded when hosting starts and
      // when a player comes in, and Start online session then makes sure a scene is presented.
      // A hosted session needs Atlas's one view (players are sent its scene): Connect claims it while it hosts, so a
      // tab Tabletop opened behind a board stays when that board closes.
      const host = new AtlasHost(app, { pluginId: 'atlas-vtt-connect' });
      disposers.add(() => host.dispose());
      disposers.add(claimHostWhileHosting(host, { state: () => onlineSessionStore.getState(), subscribe: (listener) => onlineSessionStore.subscribe(listener) }));
      disposers.add(wakeAtlasForHosting({
        state: () => onlineSessionStore.getState(),
        subscribe: (listener) => onlineSessionStore.subscribe(listener),
        wake: () => loadDeferredLeaves(app, ATLAS_VIEW_TYPE),
        hasLoadedView: () => mapViews(app).some((view) => loadedTabId(view) !== null),
        waitForLoadedView: (ms) => waitForLoadedView(app, ms),
        ensurePresented: () => ensurePresented(app, presented),
      }));
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
      // A map's rules are read from its view's token renderer and the asset index (`stockRules.ts`), neither of which
      // says when it is ready: a loaded map and a loaded index are when the rules may read differently.
      const rulesMayChange = (): void => { events.emit('rules-changed', null); };
      disposers.add(events.on('map-loaded', rulesMayChange));
      let indexAsked = false;
      const askIndex = (): void => {
        if (indexAsked) return;
        const assets = mapViews(app).map((view) => (view.serviceManager as { getAssetService?: () => unknown } | undefined)?.getAssetService?.())
          .find((found): found is { initialize: () => Promise<unknown> } => typeof (found as { initialize?: unknown } | null)?.initialize === 'function');
        if (!assets) return;
        indexAsked = true;
        assets.initialize().then(rulesMayChange, () => undefined);
      };
      askIndex();
      disposers.add(events.on('map-loaded', askIndex));
      plugin.register(() => { for (const dispose of [...disposers]) guard('teardown', dispose); disposers.clear(); });
      // Connect's data keeps the name it has always had (its folder, and its key in map files), whatever the plugin id.
      const extensionId = CONNECT_STORAGE_ID;
      // Asked for by Connect and by the player character links at once: made once.
      let made: Promise<string> | null = null;
      const folder = (): Promise<string> => {
        made ??= (async (): Promise<string> => {
          const path = normalizePath(`${STORAGE_ROOT}/${extensionId}`);
          let built = '';
          for (const part of path.split('/')) {
            built = built ? `${built}/${part}` : part;
            if (await app.vault.adapter.exists(built)) continue;
            try {
              await app.vault.adapter.mkdir(built);
            } catch (error) {
              // Made meanwhile by something else: fine, so long as it is there.
              if (!(await app.vault.adapter.exists(built))) throw error;
            }
          }
          return path;
        })().catch((error: unknown) => {
          made = null;
          throw error;
        });
        return made;
      };
      // Connect's "Controlled by", kept across sessions: a token given to a player is theirs again next session, and a player
      // character on every scene.
      // Maps the GM shows players without Atlas's view (the presented one, Tabletop's boards) are read from their file:
      // after a restart Atlas's tab stays deferred, and a GM on Tabletop's board never shows it.
      const sceneListeners = new Set<() => void>();
      const sceneChanged = (): void => { for (const listener of [...sceneListeners]) listener(); };
      const saved = new SavedSceneTokens(async (path) => {
        const file = app.vault?.getAbstractFileByPath?.(path);
        return file instanceof TFile ? app.vault.cachedRead(file) : null;
      }, sceneChanged);
      disposers.add(() => saved.dispose());
      // A board's moves and edits are saved to the file: read again then. (A stand-in vault may hear nothing.)
      const vault = app.vault as Partial<App['vault']> | undefined;
      const vaultRefs = typeof vault?.on === 'function' ? [
        app.vault.on('modify', (file) => saved.changed(file.path)),
        app.vault.on('delete', (file) => saved.changed(file.path)),
        app.vault.on('rename', (file, old) => { saved.changed(old); saved.changed(file.path); }),
      ] : [];
      disposers.add(() => { for (const ref of vaultRefs) app.vault.offref(ref); });
      disposers.add(presented.onChange(sceneChanged));
      const party = new PartyLinks({
        session: { state: () => onlineSessionStore.getState(), subscribe: (listener) => onlineSessionStore.subscribe(listener) },
        scenes: () => {
          const active = activeMapView(app);
          const views = [...(active ? [active] : []), ...mapViews(app).filter((view) => view !== active)];
          // A loaded view's tokens; its map path only once the store holds its active tab's map, so they are that map's, all of them.
          const live = views.flatMap((view) => {
            const state = view.atlasStore.getState();
            return loaded(state) ? [{ mapPath: loadedTabId(view) !== null ? state.mapPath : null, tokens: state.objects.tokens }] : [];
          });
          const presentedPath = presented.get()?.filePath;
          const wanted = [...(presentedPath ? [presentedPath] : []), ...tabletopBoardViews(app).map((board) => board.mapPath)];
          return partyScenes(live, wanted, (path) => saved.get(path));
        },
        watchScene: (listener) => {
          sceneListeners.add(listener);
          const stopTokens = watchTokens(app, events, listener);
          return () => { sceneListeners.delete(listener); stopTokens(); };
        },
        library: () => libraryTokens(app),
        memory: fileMemory(async () => `${await folder()}/player-characters.json`, {
          exists: (path) => app.vault.adapter.exists(path),
          read: (path) => app.vault.adapter.read(path),
          write: (path, data) => app.vault.adapter.write(path, data),
        }),
      });
      party.start();
      disposers.add(() => party.stop());
      // Connect goes into Atlas's own toolbar; a floating dock stands in for a view whose toolbar cannot be found.
      const ui = stockUi(app, {
        views: () => mapViews(app),
        active: () => activeMapView(app),
        presentedTabId: () => presented.get()?.tabId ?? null,
        // Tabletop's 3D boards carry the same buttons, for the Atlas view holding their map.
        boards: () => tabletopBoardViews(app),
        onViewsChanged: (listener) => {
          const stops = (['map-loaded', 'map-closed', 'tabs-changed'] as const).map((event) => events.on(event, listener as never));
          return () => { for (const stop of stops) stop(); };
        },
      });
      disposers.add(ui.dispose);
      return Object.freeze({
        id: extensionId,
        views: viewsApi(app, presented, disposers),
        presentation: presentationApi(app, atlasPlugin, presented, disposers),
        rules: Object.freeze({
          forMap: (mapPath: string | null): MapRules => {
            try {
              const views = mapViews(app).map((view) => ({ mapPath: () => view.atlasStore.getState().mapPath, serviceManager: view.serviceManager }));
              return stockMapRules(views, mapPath, defaultRules());
            } catch (error) {
              console.warn('[Atlas VTT Connect] Could not read the rules of a stock Atlas map; using the defaults:', error);
              return defaultRules();
            }
          },
          // Atlas 0.15's movement: what the GM's own drag ruler reads (`stockMovement`). The extension API has none.
          movementFor: (mapPath: string | null) => {
            try {
              const views = mapViews(app).map((view) => ({ mapPath: () => view.atlasStore.getState().mapPath, serviceManager: view.serviceManager }));
              return stockMovement(views, mapPath);
            } catch (error) {
              console.warn('[Atlas VTT Connect] Could not read the movement rules of a stock Atlas map:', error);
              return null;
            }
          },
        }),
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
        // Atlas 0.15's kept measures, written through its own store: where players' templates and spells are kept. The
        // extension API has no such namespace.
        measures: stockMeasuresApi({
          view: (viewId) => trackedView(app, viewId),
          // What the players of a presented tab see is the presented scene's level, even while the GM browses another floor.
          playersLevel: (viewId) => {
            const view = trackedView(app, viewId);
            if (!view) return undefined;
            const state = view.atlasStore.getState();
            const scene = atlasPlugin.presentedScene?.get() ?? null;
            return shownLevel(state.levels, scene && scene.tabId === loadedTabId(view) ? scene.levelId : state.viewedLevel);
          },
        }),
        tokens: stockTokensApi({
          view: (viewId) => trackedView(app, viewId),
          mapSize,
          dynamicLighting: () => dynamicLighting(service, atlasPlugin),
        }),
        lighting: stockLightingApi({
          view: (viewId) => trackedView(app, viewId),
          mapSize,
          dynamicLighting: () => dynamicLighting(service, atlasPlugin),
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
