import type { Disposer, SceneSnapshot, ViewCamera, ViewId, ViewInfo, ViewsApi } from '@atlas-vtt/api-types';
import {
  EMPTY_SCENE, guarded, sameSlice, SHOW_TAB_TIMEOUT_MS, sliceOf, tabsKey, type FakeTab, type FakeView, type FakeViewsHooks, type Own, type Scene,
} from './fakeViewParts';

export { SHOW_TAB_TIMEOUT_MS, type FakeTab, type FakeViewsHooks, type Own } from './fakeViewParts';

/**
 * Atlas's map views as the test drives them: tabs, the store's scene, the viewport. With the `scene-tabs` capability
 * (`tabsEnabled`), as Atlas 1.17.0: snapshots carry `tabId`, subscribers hear it change, 'tabs-changed' fires and
 * `showTab` switches. A switch follows Atlas's order (`switchToTab`): the tab is made active while the store still holds
 * the previous scene, a microtask later the store starts loading, and the tab's scene is loaded after `loadDelayMs`.
 */
export class FakeViews {
  private readonly views = new Map<ViewId, FakeView>();
  private activeId: ViewId | null = null;
  private tabsAdded = 0;
  /** How long a load takes when the switch names no delay (`showTab`, `closeTab`): `setLoadDelay`. */
  private loadDelayMs = 0;

  constructor(private readonly hooks: FakeViewsHooks, private readonly tabsEnabled: () => boolean = () => false) {}

  /** Opens a map view with these tabs (the first active), its store empty until `setSnapshot`. */
  open(viewId: ViewId, tabs: FakeTab[] = [{ tabId: 't1', mapPath: 'maps/a.atlasmap', name: 'A' }], kind: ViewInfo['kind'] = 'map'): void {
    if (this.views.has(viewId)) return;
    this.views.set(viewId, {
      viewId, kind, tabs: [...tabs], activeTabId: tabs[0]?.tabId ?? null, scene: EMPTY_SCENE, camera: null,
      subscribers: new Set(), cameraWatchers: new Set(), closers: new Set(), loadedPath: null,
      saved: new Map(), switches: 0, reported: '', reporting: false,
    });
    const view = this.views.get(viewId)!;
    view.reported = tabsKey(view);
  }

  /**
   * Opens another extension's remote view (1.12.0): no tabs, listed with `kind: 'remote'`; `setSnapshot` with the map
   * path `remote:<viewId>` loads it, which fires 'map-loaded' as for a map view. It is never `active()`.
   */
  openRemote(viewId: ViewId): void {
    this.open(viewId, [], 'remote');
  }

  /** The view's kind; 'map' for a view that is not open. */
  kindOf(viewId: ViewId): ViewInfo['kind'] {
    return this.views.get(viewId)?.kind ?? 'map';
  }

  /** The map paths open in a map view, loaded or among its scene tabs (what `scenes.replaceMap` refuses). */
  openMapPaths(): Set<string> {
    const paths = new Set<string>();
    for (const view of this.views.values()) {
      if (view.kind !== 'map') continue;
      if (view.scene.mapPath) paths.add(view.scene.mapPath);
      for (const tab of view.tabs) paths.add(tab.mapPath);
    }
    return paths;
  }

  /** The view's store scene now; undefined for a view that is closed or was never opened. */
  sceneOf(viewId: ViewId): Readonly<Scene> | undefined {
    return this.views.get(viewId)?.scene;
  }

  /** The view's store now holds `snapshot` (its `viewId` is ignored); opens the view with one tab for its map when it is new. */
  setSnapshot(viewId: ViewId, snapshot: Omit<SceneSnapshot, 'viewId'> & { viewId?: ViewId }): void {
    if (!this.views.has(viewId)) this.open(viewId, [{ tabId: 't1', mapPath: snapshot.mapPath ?? '', name: 't1' }]);
    const view = this.views.get(viewId)!;
    const { viewId: _ignored, tabId: _tab, ...scene } = snapshot;
    const before = sliceOf(view.scene, this.tabIdOf(view));
    view.scene = scene;
    const loadedPath = scene.loaded ? scene.mapPath : null;
    // Whatever the renderer worked out for the last map is gone before anyone reads the new one (sight is pending).
    if (loadedPath !== null && loadedPath !== view.loadedPath) this.hooks.mapLoading(viewId);
    this.notifyIfChanged(view, before);
    if (loadedPath !== view.loadedPath) {
      view.loadedPath = loadedPath;
      if (loadedPath !== null) this.hooks.emitMapLoaded(this.infoOf(view));
    }
    this.hooks.storeChanged(viewId);
  }

  /** The store's current scene with `partial` replacing whole fields. */
  update(viewId: ViewId, partial: Partial<Scene>): void {
    const view = this.views.get(viewId);
    if (view) this.setSnapshot(viewId, { ...view.scene, ...partial });
  }

  /** The GM clicks a tab: it is active at once; the store keeps what it holds (`switchTab` also loads the tab's scene). */
  setActiveTab(viewId: ViewId, tabId: string): void {
    const view = this.views.get(viewId);
    if (!view || view.activeTabId === tabId) return;
    this.changeTabs(view, () => {
      this.keepScene(view);
      view.activeTabId = tabId;
      view.switches++;
    });
  }

  /** Adds a tab after the others; `tab` is the tab, or its map path with `name` (its id is made: `tab-<n>`). Returns its id. */
  addTab(viewId: ViewId, tab: FakeTab | string, name = ''): string {
    const view = this.views.get(viewId);
    const added: FakeTab = typeof tab === 'string' ? { tabId: `tab-${++this.tabsAdded}`, mapPath: tab, name } : tab;
    if (view) this.changeTabs(view, () => { view.tabs = [...view.tabs, added]; });
    return added.tabId;
  }

  /** Removes a tab; when it was active the first tab becomes active, the store keeping what it holds (`closeTab` loads it). */
  removeTab(viewId: ViewId, tabId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.changeTabs(view, () => {
      view.tabs = view.tabs.filter((tab) => tab.tabId !== tabId);
      view.saved.delete(tabId);
      if (view.activeTabId === tabId) {
        view.activeTabId = view.tabs[0]?.tabId ?? null;
        view.switches++;
      }
    });
  }

  /** The GM closes a tab, as Atlas does: the active one's successor is switched to (loaded). */
  closeTab(viewId: ViewId, tabId: string, options: { loadDelayMs?: number } = {}): void {
    const view = this.views.get(viewId);
    const wasActive = view?.activeTabId === tabId;
    this.removeTab(viewId, tabId);
    const next = view?.activeTabId;
    if (view && wasActive && next) void this.load(view, next, view.switches, options.loadDelayMs ?? this.loadDelayMs);
  }

  /** A tab renamed, or its file moved: its id stays. */
  renameTab(viewId: ViewId, tabId: string, name: string, mapPath?: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.changeTabs(view, () => {
      view.tabs = view.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, name, ...(mapPath !== undefined ? { mapPath } : {}) } : tab));
    });
  }

  /** How long a load takes from now on when its switch names no delay (`showTab`, the successor `closeTab` loads); 0 is a microtask. */
  setLoadDelay(ms: number): void {
    this.loadDelayMs = ms;
  }

  /** What a background tab holds (from its file), loaded when a switch reaches it; its map path is the tab's. */
  setTabScene(viewId: ViewId, tabId: string, partial: Partial<Scene>): void {
    const view = this.views.get(viewId);
    const tab = view?.tabs.find((entry) => entry.tabId === tabId);
    if (view && tab) view.saved.set(tabId, { ...(view.saved.get(tabId) ?? EMPTY_SCENE), ...partial, mapPath: tab.mapPath, loaded: true });
  }

  /**
   * Atlas's `switchToTab`: the tab is made active (snapshots name no tab), a microtask later the store starts loading,
   * and after `loadDelayMs` (a timer; 0 is a microtask) it holds the tab's scene, loaded. A later switch drops this one
   * unloaded. Resolves when the switch ended, loaded or dropped.
   */
  switchTab(viewId: ViewId, tabId: string, options: { loadDelayMs?: number } = {}): Promise<void> {
    const view = this.views.get(viewId);
    if (!view || !view.tabs.some((tab) => tab.tabId === tabId)) return Promise.resolve();
    // As Atlas: the active tab whose scene the store holds needs no load.
    if (view.activeTabId === tabId && this.showsTab(viewId, tabId)) return Promise.resolve();
    if (view.activeTabId === tabId) view.switches++;
    else this.setActiveTab(viewId, tabId);
    return this.load(view, tabId, view.switches, options.loadDelayMs ?? this.loadDelayMs);
  }

  /** The workspace's active map view; null for none. */
  setActive(viewId: ViewId | null): void {
    this.activeId = viewId;
  }

  /** The workspace's active map view id; null for none, a closed one or a remote view. */
  activeViewId(): ViewId | null {
    return this.activeId !== null && this.views.get(this.activeId)?.kind === 'map' ? this.activeId : null;
  }

  /** Whether the view is open. */
  isOpen(viewId: ViewId): boolean {
    return this.views.has(viewId);
  }

  /** Gives the view a viewport showing `camera` (or what a function returns at each read); null removes it. */
  setCamera(viewId: ViewId, camera: ViewCamera | (() => ViewCamera | null) | null): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.camera = typeof camera === 'function' ? camera : camera && ((): ViewCamera => ({ ...camera }));
  }

  /** One rendered viewport frame: every camera watcher runs, as on pixi-viewport's `frame-end`. */
  frame(viewId: ViewId): void {
    const view = this.views.get(viewId);
    if (!view) return;
    for (const listener of [...view.cameraWatchers]) {
      const camera = view.camera?.() ?? null;
      if (camera) guarded(listener, camera);
    }
  }

  /** How many registrations watch the view's camera. */
  cameraWatchCount(viewId: ViewId): number {
    return this.views.get(viewId)?.cameraWatchers.size ?? 0;
  }

  /**
   * `views.showTab` (1.17.0): true once the tab's map is loaded; false for a closed, unknown or remote view, an unknown
   * tab, when another switch overtakes it, when the view closes before the load ends, or past `SHOW_TAB_TIMEOUT_MS`.
   */
  async showTab(viewId: ViewId, tabId: string): Promise<boolean> {
    const view = this.views.get(viewId);
    if (!view || view.kind !== 'map' || !view.tabs.some((tab) => tab.tabId === tabId)) return false;
    const switched = this.switchTab(viewId, tabId);
    const mine = view.switches;
    const settled = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => finish(false), SHOW_TAB_TIMEOUT_MS);
      const stopWatching = this.watchClose(viewId, () => finish(false));
      function finish(answer: boolean): void {
        window.clearTimeout(timer);
        stopWatching?.();
        resolve(answer);
      }
      void switched.then(() => finish(true));
    });
    return settled && view.switches === mine && this.views.get(viewId) === view && this.showsTab(viewId, tabId);
  }

  /** Closes the view: its registrations are disposed, 'map-closed' fires once, and its id is never reused. */
  close(viewId: ViewId): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.views.delete(viewId);
    for (const close of [...view.closers]) close();
    this.hooks.viewClosed(viewId);
    this.hooks.emitMapClosed(viewId);
  }

  /** Runs `close` when the view closes, as the registrations of the views namespace do; null when there is no such view. */
  watchClose(viewId: ViewId, close: () => void): Disposer | null {
    const view = this.views.get(viewId);
    if (!view) return null;
    view.closers.add(close);
    return () => { view.closers.delete(close); };
  }

  /** For the presentation: the view's tabs and store, or undefined once closed. */
  tabsOf(viewId: ViewId): { tabs: readonly FakeTab[]; activeTabId: string | null } | undefined {
    return this.views.get(viewId);
  }

  /** Whether the view's store holds a loaded map; a map loading is not. */
  isLoaded(viewId: ViewId): boolean {
    return this.views.get(viewId)?.scene.loaded === true;
  }

  /** Whether the store holds `tabId`'s map, loaded (Atlas's `showsTab`). */
  showsTab(viewId: ViewId, tabId: string): boolean {
    const view = this.views.get(viewId);
    const tab = view?.tabs.find((entry) => entry.tabId === tabId);
    return Boolean(view && tab && view.scene.loaded && view.scene.mapPath === tab.mapPath);
  }

  /** The namespace one extension sees; `own` ties its registrations to that extension's connection. */
  api(own: Own): ViewsApi {
    const register = <T>(viewId: ViewId, set: (view: FakeView) => Set<T>, listener: T): Disposer => {
      const view = this.views.get(viewId);
      if (!view) return own(() => undefined);
      set(view).add(listener);
      let close: () => void = () => undefined;
      const dispose = own(() => { set(view).delete(listener); view.closers.delete(close); });
      close = dispose;
      view.closers.add(close);
      return dispose;
    };
    return Object.freeze({
      list: (): ViewInfo[] => [...this.views.values()].map((view) => this.infoOf(view)),
      active: (): ViewInfo | null => {
        const id = this.activeViewId();
        const view = id === null ? undefined : this.views.get(id);
        return view ? this.infoOf(view) : null;
      },
      snapshot: (viewId: ViewId): SceneSnapshot | null => {
        const view = this.views.get(viewId);
        return view ? this.snapshotOf(view) : null;
      },
      subscribe: (viewId: ViewId, listener: (snapshot: SceneSnapshot) => void): Disposer => register(viewId, (view) => view.subscribers, listener),
      camera: (viewId: ViewId): ViewCamera | null => {
        return this.views.get(viewId)?.camera?.() ?? null;
      },
      watchCamera: (viewId: ViewId, listener: (camera: ViewCamera) => void): Disposer => register(viewId, (view) => view.cameraWatchers, listener),
      ...(this.tabsEnabled() ? { showTab: (viewId: ViewId, tabId: string): Promise<boolean> => this.showTab(viewId, tabId) } : {}),
    });
  }

  /** The tab whose scene the store holds, loaded (Atlas's `snapshotTabId`); null while loading, for a remote view, or without `scene-tabs`. */
  private tabIdOf(view: FakeView): string | null {
    if (!this.tabsEnabled() || view.kind !== 'map' || view.activeTabId === null) return null;
    return this.showsTab(view.viewId, view.activeTabId) ? view.activeTabId : null;
  }

  private notifyIfChanged(view: FakeView, before: readonly unknown[]): void {
    if (sameSlice(before, sliceOf(view.scene, this.tabIdOf(view)))) return;
    for (const listener of [...view.subscribers]) guarded(listener, this.snapshotOf(view));
  }

  /** A change of the view's tabs: the presentation follows, subscribers hear `tabId` change, 'tabs-changed' is queued. */
  private changeTabs(view: FakeView, change: () => void): void {
    const before = sliceOf(view.scene, this.tabIdOf(view));
    change();
    this.hooks.tabsChanged(view.viewId);
    this.notifyIfChanged(view, before);
    if (!this.tabsEnabled() || view.kind !== 'map' || view.reporting) return;
    view.reporting = true;
    void Promise.resolve().then(() => {
      view.reporting = false;
      const key = tabsKey(view);
      if (!this.views.has(view.viewId) || key === view.reported) return;
      view.reported = key;
      this.hooks.emitTabsChanged(this.infoOf(view));
    });
  }

  /** Keeps the scene the store holds for its tab (leaving a tab flushes it to its file), for the switch back. */
  private keepScene(view: FakeView): void {
    const tab = view.tabs.find((entry) => entry.tabId === view.activeTabId);
    if (tab && view.scene.loaded && view.scene.mapPath === tab.mapPath) view.saved.set(tab.tabId, view.scene);
  }

  /** The rest of a switch to `tabId` (`switches` was `request` when it began): loading, then the tab's scene. */
  private async load(view: FakeView, tabId: string, request: number, delayMs: number): Promise<void> {
    await Promise.resolve();
    if (request !== view.switches || !this.views.has(view.viewId)) return;
    this.setSnapshot(view.viewId, { ...view.scene, loaded: false });
    await new Promise<void>((resolve) => {
      if (delayMs > 0) window.setTimeout(resolve, delayMs);
      else void Promise.resolve().then(resolve);
    });
    const tab = view.tabs.find((entry) => entry.tabId === tabId);
    if (request !== view.switches || !this.views.has(view.viewId) || !tab) return;
    this.setSnapshot(view.viewId, { ...(view.saved.get(tabId) ?? EMPTY_SCENE), mapPath: tab.mapPath, loaded: true });
  }

  private infoOf(view: FakeView): ViewInfo {
    return {
      viewId: view.viewId, kind: view.kind, activeTabId: view.activeTabId,
      tabs: view.tabs.map((tab) => ({ ...tab })), mapPath: view.scene.mapPath, loaded: view.scene.loaded,
    };
  }

  /** Fresh frozen wrappers each time, the records by reference: like Atlas's `sceneSnapshot`. */
  private snapshotOf(view: FakeView): SceneSnapshot {
    const { scene } = view;
    return Object.freeze({
      ...scene,
      viewId: view.viewId,
      ...(this.tabsEnabled() ? { tabId: this.tabIdOf(view) } : {}),
      mapSize: Object.freeze({ ...scene.mapSize }),
      objects: Object.freeze({ ...scene.objects }),
      widgets: Object.freeze({ ...scene.widgets }),
    });
  }
}
