import type { Disposer, SceneSnapshot, ViewCamera, ViewId, ViewInfo, ViewsApi } from '@atlas-vtt/api-types';

/** A scene tab of a fake view. */
export interface FakeTab {
  tabId: string;
  mapPath: string;
  name: string;
}

/** What a fake view's store holds: a snapshot without its view id; `objects` and `widgets` are re-wrapped per snapshot, as Atlas does. */
type Scene = Omit<SceneSnapshot, 'viewId'>;

interface FakeView {
  readonly viewId: ViewId;
  tabs: FakeTab[];
  activeTabId: string | null;
  scene: Scene;
  /** The viewport's camera now; null without a viewport (no renderer yet). */
  camera: (() => ViewCamera | null) | null;
  readonly subscribers: Set<(snapshot: SceneSnapshot) => void>;
  readonly cameraWatchers: Set<(camera: ViewCamera) => void>;
  /** Teardowns of this view's registrations, run when it closes. */
  readonly closers: Set<() => void>;
  /** The map whose load 'map-loaded' reported last; null while not loaded. */
  loadedPath: string | null;
}

/** What the views namespace tells the rest of the fake: events, and changes the presentation follows. */
export interface FakeViewsHooks {
  emitMapLoaded(info: ViewInfo): void;
  emitMapClosed(viewId: ViewId): void;
  storeChanged(viewId: ViewId): void;
  tabsChanged(viewId: ViewId): void;
  viewClosed(viewId: ViewId): void;
}

/** Registers a teardown with the extension's connection; the returned disposer runs it once. */
export type Own = (teardown: () => void) => Disposer;

const EMPTY_SCENE: Scene = {
  mapPath: null, loaded: false, mapSize: { width: 0, height: 0 }, background: null, grid: null,
  objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
  widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
  initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
  initiativeTrackerOpen: false,
  lighting: { enabled: false, ambient: 1 },
};

/** The fields whose replacement (by reference) is a new snapshot, as Atlas's `snapshotSlice`. */
function sliceOf(scene: Scene): readonly unknown[] {
  return [
    scene.mapPath, scene.loaded, scene.background, scene.grid, scene.objects.tokens, scene.objects.texts,
    scene.objects.drawings, scene.objects.fog, scene.widgets.settings, scene.widgets.values, scene.initiative,
    scene.initiativeTrackerOpen, scene.lighting,
  ];
}

const sameSlice = (a: readonly unknown[], b: readonly unknown[]): boolean => a.every((value, index) => value === b[index]);

function guarded<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch (error) {
    console.error('[Atlas API] A view listener failed:', error);
  }
}

/** Atlas's map views as the test drives them: tabs, the store's scene, the viewport. */
export class FakeViews {
  private readonly views = new Map<ViewId, FakeView>();
  private activeId: ViewId | null = null;

  constructor(private readonly hooks: FakeViewsHooks) {}

  /** Opens a map view with these tabs (the first active), its store empty until `setSnapshot`. */
  open(viewId: ViewId, tabs: FakeTab[] = [{ tabId: 't1', mapPath: 'maps/a.atlasmap', name: 'A' }]): void {
    if (this.views.has(viewId)) return;
    this.views.set(viewId, {
      viewId, tabs: [...tabs], activeTabId: tabs[0]?.tabId ?? null, scene: EMPTY_SCENE, camera: null,
      subscribers: new Set(), cameraWatchers: new Set(), closers: new Set(), loadedPath: null,
    });
  }

  /** The view's store now holds `snapshot` (its `viewId` is ignored); opens the view with one tab for its map when it is new. */
  setSnapshot(viewId: ViewId, snapshot: Omit<SceneSnapshot, 'viewId'> & { viewId?: ViewId }): void {
    if (!this.views.has(viewId)) this.open(viewId, [{ tabId: 't1', mapPath: snapshot.mapPath ?? '', name: 't1' }]);
    const view = this.views.get(viewId)!;
    const { viewId: _ignored, ...scene } = snapshot;
    const before = sliceOf(view.scene);
    view.scene = scene;
    if (!sameSlice(before, sliceOf(scene))) for (const listener of [...view.subscribers]) guarded(listener, this.snapshotOf(view));
    const loadedPath = scene.loaded ? scene.mapPath : null;
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

  setActiveTab(viewId: ViewId, tabId: string): void {
    const view = this.views.get(viewId);
    if (!view || view.activeTabId === tabId) return;
    view.activeTabId = tabId;
    this.hooks.tabsChanged(viewId);
  }

  addTab(viewId: ViewId, tab: FakeTab): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.tabs = [...view.tabs, tab];
    this.hooks.tabsChanged(viewId);
  }

  removeTab(viewId: ViewId, tabId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    view.tabs = view.tabs.filter((tab) => tab.tabId !== tabId);
    if (view.activeTabId === tabId) view.activeTabId = view.tabs[0]?.tabId ?? null;
    this.hooks.tabsChanged(viewId);
  }

  /** The workspace's active map view; null for none. */
  setActive(viewId: ViewId | null): void {
    this.activeId = viewId;
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

  /** Closes the view: its registrations are disposed, 'map-closed' fires once, and its id is never reused. */
  close(viewId: ViewId): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.views.delete(viewId);
    for (const close of [...view.closers]) close();
    this.hooks.viewClosed(viewId);
    this.hooks.emitMapClosed(viewId);
  }

  /** For the presentation: the view's tabs and store, or undefined once closed. */
  tabsOf(viewId: ViewId): { tabs: readonly FakeTab[]; activeTabId: string | null } | undefined {
    return this.views.get(viewId);
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
        const view = this.activeId === null ? undefined : this.views.get(this.activeId);
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
    });
  }

  private infoOf(view: FakeView): ViewInfo {
    return {
      viewId: view.viewId, kind: 'map', activeTabId: view.activeTabId,
      tabs: view.tabs.map((tab) => ({ ...tab })), mapPath: view.scene.mapPath, loaded: view.scene.loaded,
    };
  }

  /** Fresh frozen wrappers each time, the records by reference: like Atlas's `sceneSnapshot`. */
  private snapshotOf(view: FakeView): SceneSnapshot {
    const { scene } = view;
    return Object.freeze({
      ...scene,
      viewId: view.viewId,
      mapSize: Object.freeze({ ...scene.mapSize }),
      objects: Object.freeze({ ...scene.objects }),
      widgets: Object.freeze({ ...scene.widgets }),
    });
  }
}
