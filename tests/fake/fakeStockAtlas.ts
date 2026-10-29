import { vi } from 'vitest';
import { fakeWorkspaceApp } from './fakeWorkspace';

/** A zustand-like store: `getState`, `subscribe`, and `set` to change it as Atlas would. */
export function store<T extends object>(initial: T): { getState(): T; subscribe(l: () => void): () => void; set(patch: Partial<T>): void } {
  let state = initial;
  const listeners = new Set<() => void>();
  // A real zustand store is a hook function with its methods attached, not a plain object.
  const hook = (): T => state;
  return Object.assign(hook, {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (patch: Partial<T>) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener(); },
  });
}

export function fakeView(viewId: string, tabs: Array<{ id: string; filePath: string; displayName: string }>) {
  const scene = store({
    mapPath: tabs[0]?.filePath ?? null, mapLoaded: true, isMapLoading: false, background: null, grid: null,
    objects: { tokens: {}, texts: {}, drawings: {}, fog: {} }, widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {}, initiative: { entries: [], currentIndex: 0, round: 1, isActive: false }, initiativeTrackerOpen: false,
    lighting: { enabled: false },
  } as never);
  const tabMeta = store({ tabs, activeTabId: tabs[0]?.id ?? null });
  const view = {
    viewId, atlasStore: scene, tabMetaStore: tabMeta, renderer: { getMapImage: () => ({ worldRect: { x: 0, y: 0, width: 1400, height: 900 } }) },
    switchToTab: vi.fn(async (tabId: string) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      tabMeta.set({ activeTabId: tabId });
      scene.set({ mapPath: tab?.filePath ?? null } as never);
    }),
  };
  return { view, scene, tabMeta };
}

export function fakePresented() {
  let scene: { tabId: string; filePath: string; levelId?: string } | null = null;
  const listeners = new Set<(s: typeof scene) => void>();
  let elsewhere = 0;
  return {
    get: () => scene,
    set: (next: typeof scene) => { scene = next; for (const listener of [...listeners]) listener(next); },
    onChange: (listener: (s: typeof scene) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    showElsewhere: () => { elsewhere += 1; return () => { elsewhere -= 1; }; },
    elsewhere: () => elsewhere,
  };
}

export function setupStockAtlas() {
  const { app, plugins } = fakeWorkspaceApp();
  const a = fakeView('view-a', [{ id: 't1', filePath: 'maps/one.atlasmap', displayName: 'One' }, { id: 't2', filePath: 'maps/two.atlasmap', displayName: 'Two' }]);
  const leaves = [{ view: a.view }];
  const workspace = app.workspace as unknown as Record<string, unknown>;
  workspace.getLeavesOfType = (type: string) => (type === 'atlas-vtt' ? leaves : []);
  workspace.getMostRecentLeaf = () => leaves[0];
  workspace.setActiveLeaf = () => undefined;
  const presented = fakePresented();
  const settingsListeners = new Set<() => void>();
  const settingsService = {
    getLaserPointerSettings: () => ({ color: '#f00', size: 2 }),
    getDiceLook: () => ({ colour: '#fff', font: 'x' }),
    getDiceDisplay: () => 'card' as const,
    getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: false }),
    onChange: (listener: () => void) => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener); }; },
  };
  const atlas = { presentedScene: presented, settingsService };
  plugins['atlas-vtt'] = atlas as never;
  return { app, plugins, atlas, a, presented, leaves };
}

