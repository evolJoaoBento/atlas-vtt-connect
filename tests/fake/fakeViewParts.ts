/** The shapes and helpers of `FakeViews`: a view's state, the snapshot slice Atlas compares, guarded listeners. */
import type { Disposer, SceneSnapshot, ViewCamera, ViewId, ViewInfo } from '@atlas-vtt/api-types';

/** A scene tab of a fake view. */
export interface FakeTab {
  tabId: string;
  mapPath: string;
  name: string;
}

/** What a fake view's store holds: a snapshot without its view id; `objects` and `widgets` are re-wrapped per snapshot, as Atlas does. */
export type Scene = Omit<SceneSnapshot, 'viewId'>;

export interface FakeView {
  readonly viewId: ViewId;
  /** A GM map view, or a remote view (1.12.0): listed and announced like a map view, never `active()`. */
  readonly kind: ViewInfo['kind'];
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
  /** Each background tab's scene as the GM left it (Atlas reloads a tab from its file): what `switchTab` loads. */
  readonly saved: Map<string, Scene>;
  /** Counts tab switches: a switch, or a `showTab`, that another one overtook loads nothing and answers false. */
  switches: number;
  /** The tabs and active tab 'tabs-changed' reported last, and whether a report waits for the microtask. */
  reported: string;
  reporting: boolean;
}

/** What the views namespace tells the rest of the fake: events, and changes the presentation follows. */
export interface FakeViewsHooks {
  emitMapLoaded(info: ViewInfo): void;
  /** The store holds a newly loaded map, before its subscribers hear of it: the view's sight is pending again. */
  mapLoading(viewId: ViewId): void;
  emitMapClosed(viewId: ViewId): void;
  storeChanged(viewId: ViewId): void;
  tabsChanged(viewId: ViewId): void;
  viewClosed(viewId: ViewId): void;
  /** 'tabs-changed' (1.17.0, `scene-tabs`), coalesced per view and microtask. */
  emitTabsChanged(info: ViewInfo): void;
}

/** Registers a teardown with the extension's connection; the returned disposer runs it once. */
export type Own = (teardown: () => void) => Disposer;

export const EMPTY_SCENE: Scene = {
  mapPath: null, loaded: false, mapSize: { width: 0, height: 0 }, background: null, grid: null,
  objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
  widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
  initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
  initiativeTrackerOpen: false,
  lighting: { enabled: false, ambient: 1 },
};

/** The fields whose replacement (by reference) is a new snapshot, as Atlas's `snapshotSlice` (`tabId` from 1.17.0). */
export function sliceOf(scene: Scene, tabId: string | null): readonly unknown[] {
  return [
    tabId, scene.mapPath, scene.loaded, scene.background, scene.grid, scene.objects.tokens, scene.objects.texts,
    scene.objects.drawings, scene.objects.fog, scene.widgets.settings, scene.widgets.values, scene.initiative,
    scene.initiativeTrackerOpen, scene.lighting,
  ];
}

export const sameSlice = (a: readonly unknown[], b: readonly unknown[]): boolean => a.every((value, index) => value === b[index]);

export function guarded<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch (error) {
    console.error('[Atlas API] A view listener failed:', error);
  }
}

/** What 'tabs-changed' compares: the active tab and the tabs by id, path, name and order (not dirty or loaded marks). */
export const tabsKey = (view: FakeView): string => JSON.stringify([view.activeTabId, view.tabs.map((tab) => [tab.tabId, tab.mapPath, tab.name])]);

/** How long `showTab` waits at most for its switch and load (Atlas's `SHOW_TAB_TIMEOUT_MS`); past it the answer is false. */
export const SHOW_TAB_TIMEOUT_MS = 60_000;
