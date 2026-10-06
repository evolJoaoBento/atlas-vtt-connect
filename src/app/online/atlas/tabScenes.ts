/**
 * The GM's scene tabs as split party reads them (Atlas API 1.17.0, `scene-tabs`): every tab of the GM's map views, and
 * which one is live. A tab is live only while its view's snapshot is loaded and names it (`SceneSnapshot.tabId`, ruling
 * P2): Atlas makes the next tab active before its store reloads, so `activeTabId` alone never says whose scene the store
 * holds. This is the only Connect file that reads `activeTabId` (`activeTabOf`), and never to attribute a scene.
 */
import type { AtlasExtension, Disposer, SceneSnapshot, ViewCamera, ViewId, ViewInfo, ViewsApi } from '@atlas-vtt/api-types';
import { sameTab, type TabKey } from '../split/tabKey';

/** A tab of a GM map view, as its tab bar names it. */
export interface TabInfo extends TabKey {
  mapPath: string;
  name: string;
}

export interface TabScenes {
  /** Every tab of the GM's map views (remote views have none), in each view's order. */
  tabs(): TabInfo[];
  tab(key: TabKey): TabInfo | null;
  /**
   * The tab whose scene a loaded snapshot holds (P2: `loaded && tabId`), read now: the active map view's first, then
   * any other's. Null while every view loads or names no tab. Atlas folds every map view into one, so there is one.
   */
  liveTab(): TabKey | null;
  /** The snapshot of `key`'s view, only while it is loaded and names `key`'s tab; null otherwise. */
  liveSnapshot(key: TabKey): SceneSnapshot | null;
  /**
   * Whether `key` is its view's active tab: the GM is on it, its map loaded or loading. It decides only whether a scene
   * is live or parked; what is sent of it comes from `liveSnapshot`, never from this.
   */
  isActive(key: TabKey): boolean;
  /** Calls `listener` after each change of `viewId`'s store (`views.subscribe`); only the live scene is watched so. */
  watch(viewId: ViewId, listener: (snapshot: SceneSnapshot) => void): Disposer;
  /** The view's camera now (`views.camera`), and each frame it moves (`views.watchCamera`): the GM's camera for the shown scene. */
  camera(viewId: ViewId): ViewCamera | null;
  watchCamera(viewId: ViewId, listener: () => void): Disposer;
  /** Called when a view's live tab or active tab changes (to another tab, or to none), with `liveTab()` then. */
  subscribeLive(listener: (live: TabKey | null) => void): Disposer;
  /** Called when the tabs change ('tabs-changed', a view opening or closing), with the tabs that went (none for a rename). */
  subscribeTabs(listener: (closed: TabKey[]) => void): Disposer;
  /** Makes `key` its view's active tab without presenting it (`views.showTab`); true once its map is loaded. */
  show(key: TabKey): Promise<boolean>;
  dispose(): void;
}

type TabsAtlas = Pick<AtlasExtension, 'views' | 'on'>;

/** The view's active tab id, as `views.list()` says; null for no such view. For decisions about tabs, never for a scene's data. */
export function activeTabOf(views: Pick<ViewsApi, 'list'>, viewId: ViewId): string | null {
  return views.list().find((view) => view.viewId === viewId)?.activeTabId ?? null;
}

/** The tab the snapshot holds, by P2; null while it loads or names none. */
function liveTabIn(snapshot: SceneSnapshot | null): string | null {
  return snapshot?.loaded === true && typeof snapshot.tabId === 'string' ? snapshot.tabId : null;
}

const infosOf = (view: ViewInfo): TabInfo[] => view.tabs.map((tab) => ({ viewId: view.viewId, tabId: tab.tabId, mapPath: tab.mapPath, name: tab.name }));

interface Watched {
  tabs: TabInfo[];
  /** The tab this view's snapshot named live last, and its active tab then; listeners hear when either changes. */
  live: string | null;
  active: string | null;
  stop: Disposer;
}

export function createTabScenes(atlas: TabsAtlas): TabScenes {
  const { views } = atlas;
  const watched = new Map<ViewId, Watched>();
  const liveListeners = new Set<(live: TabKey | null) => void>();
  const tabsListeners = new Set<(closed: TabKey[]) => void>();
  const stops: Disposer[] = [];

  const liveTab = (): TabKey | null => {
    const active = views.active()?.viewId;
    const order = [...watched.keys()].sort((a, b) => Number(b === active) - Number(a === active));
    for (const viewId of order) {
      const tabId = liveTabIn(views.snapshot(viewId));
      if (tabId !== null) return { viewId, tabId };
    }
    return null;
  };
  const emit = <T>(listeners: Set<(value: T) => void>, value: T): void => {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error('[Atlas VTT Connect] A scene tabs listener failed:', error);
      }
    }
  };
  /** A view's snapshot changed, or its tabs: listeners hear a change of its live tab. */
  const recheck = (viewId: ViewId): void => {
    const entry = watched.get(viewId);
    if (!entry) return;
    const live = liveTabIn(views.snapshot(viewId));
    const active = activeTabOf(views, viewId);
    if (live === entry.live && active === entry.active) return;
    entry.live = live;
    entry.active = active;
    emit(liveListeners, liveTab());
  };
  const track = (view: ViewInfo): TabKey[] => {
    if (view.kind !== 'map') return [];
    const entry = watched.get(view.viewId);
    const tabs = infosOf(view);
    if (!entry) {
      const live = liveTabIn(views.snapshot(view.viewId));
      watched.set(view.viewId, { tabs, live, active: view.activeTabId, stop: views.subscribe(view.viewId, () => recheck(view.viewId)) });
      return [];
    }
    const closed = entry.tabs.filter((tab) => !tabs.some((next) => next.tabId === tab.tabId)).map(({ viewId, tabId }) => ({ viewId, tabId }));
    entry.tabs = tabs;
    return closed;
  };
  const changed = (view: ViewInfo): void => {
    const closed = track(view);
    recheck(view.viewId);
    emit(tabsListeners, closed);
  };
  const closedView = (viewId: ViewId): void => {
    const entry = watched.get(viewId);
    if (!entry) return;
    watched.delete(viewId);
    entry.stop();
    if (entry.live !== null || entry.active !== null) emit(liveListeners, liveTab());
    emit(tabsListeners, entry.tabs.map((tab) => ({ viewId, tabId: tab.tabId })));
  };

  for (const view of views.list()) track(view);
  stops.push(
    atlas.on('tabs-changed', (view) => changed(view)),
    // A map view opened after this started announces itself by loading its map.
    atlas.on('map-loaded', (view) => { if (view.kind === 'map' && !watched.has(view.viewId)) changed(view); }),
    atlas.on('map-closed', (viewId) => closedView(viewId)),
  );

  return {
    tabs: () => [...watched.values()].flatMap((entry) => entry.tabs.map((tab) => ({ ...tab }))),
    tab: (key) => {
      const found = watched.get(key.viewId)?.tabs.find((tab) => sameTab(tab, key));
      return found ? { ...found } : null;
    },
    liveTab,
    liveSnapshot: (key) => {
      const snapshot = views.snapshot(key.viewId);
      return snapshot && liveTabIn(snapshot) === key.tabId ? snapshot : null;
    },
    isActive: (key) => watched.has(key.viewId) && activeTabOf(views, key.viewId) === key.tabId,
    watch: (viewId, listener) => views.subscribe(viewId, listener),
    camera: (viewId) => views.camera(viewId),
    watchCamera: (viewId, listener) => views.watchCamera(viewId, () => listener()),
    subscribeLive: (listener) => {
      liveListeners.add(listener);
      return () => { liveListeners.delete(listener); };
    },
    subscribeTabs: (listener) => {
      tabsListeners.add(listener);
      return () => { tabsListeners.delete(listener); };
    },
    show: async (key) => {
      if (typeof views.showTab !== 'function') return false;
      try {
        return (await views.showTab(key.viewId, key.tabId)) === true;
      } catch (error) {
        console.error('[Atlas VTT Connect] Could not switch to the scene tab:', error);
        return false;
      }
    },
    dispose: () => {
      for (const stop of stops.splice(0)) stop();
      for (const entry of watched.values()) entry.stop();
      watched.clear();
      liveListeners.clear();
      tabsListeners.clear();
    },
  };
}
