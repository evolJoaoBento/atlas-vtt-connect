/**
 * `ui` on a stock Atlas: the registry of what extensions add to Atlas's UI slots, drawn by the floating dock
 * (`floatingDock.ts`). The dock follows the map view the GM works in and is removed with the extension.
 */
import { Menu, setIcon, type App } from 'obsidian';
import type { Disposer, UiApi } from '@atlas-vtt/api-types';
import { FloatingDock, type DockEnv, type DockTab, type DockToken, type DockView, type MenuLike } from './floatingDock';
import { NativeToolbar } from './nativeToolbar';
import { createUiRegistry, type PanelHost } from './uiRegistry';

/** What the dock reads of a stock map view. */
export interface UiStockView {
  readonly viewId: string;
  readonly containerEl?: HTMLElement;
  /** Atlas's renderer: its token layer can say which token is under a point (`hitTestTokens`, in world coordinates). */
  readonly renderer?: { getTokenRenderer?(): { hitTestTokens?(x: number, y: number): string | null; viewport?: { toWorld?(point: { x: number; y: number }): { x: number; y: number } } } | null | undefined } | null | undefined;
  readonly atlasStore: { getState(): UiSceneState; subscribe(listener: () => void): () => void };
  readonly tabMetaStore: { getState(): { tabs: Array<{ id: string; filePath: string; displayName: string }>; activeTabId: string | null }; subscribe(listener: () => void): () => void };
}
interface UiToken {
  readonly kind?: string | undefined;
  readonly name?: string | null | undefined;
  readonly statblockName?: string | null | undefined;
  readonly imagePath?: string | undefined;
  /** Kept beside the map (Atlas 0.9): no part of it, so never under the pointer nor among the selected tokens. */
  readonly offMap?: unknown;
}
interface UiSceneState {
  selectedIds?: readonly string[] | undefined;
  objects: { tokens: Readonly<Record<string, UiToken>> };
}

export interface StockUiDeps {
  /** The open map views, and the one the GM works in. */
  views(): UiStockView[];
  active(): UiStockView | null;
  /** The tab Atlas presents, or null. */
  presentedTabId: () => string | null;
  /** Calls `listener` when views open, close or change tabs. */
  onViewsChanged(listener: () => void): Disposer;
  /** Tabletop's 3D boards open on the GM's side: their toolbars carry Connect's buttons too. */
  boards?(): BoardDockSource[];
}

const MEMORY_PREFIX = 'atlas-vtt-connect:dock:';

function tokenLabel(token: UiToken): string {
  const name = token.kind === 'character' ? (token.name || token.statblockName || '').trim() : '';
  if (name !== '') return name;
  const file = token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  return file === '' ? 'Unnamed token' : file;
}

function dockView(view: UiStockView, presentedTabId: () => string | null): DockView {
  return {
    viewId: view.viewId,
    doc: view.containerEl?.ownerDocument ?? document,
    root: view.containerEl ?? null,
    tokenAt: (clientX, clientY): DockToken | null => {
      const canvas = view.containerEl?.querySelector('canvas');
      const layer = view.renderer?.getTokenRenderer?.();
      if (!canvas || !layer?.hitTestTokens || !layer.viewport?.toWorld) return null;
      const rect = canvas.getBoundingClientRect();
      const at = layer.viewport.toWorld({ x: clientX - rect.left, y: clientY - rect.top });
      const id = layer.hitTestTokens(at.x, at.y);
      const token = id === null ? undefined : view.atlasStore.getState().objects.tokens[id];
      return id === null || !token || token.offMap === true ? null : { id, kind: token.kind === 'character' ? 'character' : 'token', label: tokenLabel(token) };
    },
    selectedTokens: (): DockToken[] => {
      const { selectedIds, objects } = view.atlasStore.getState();
      return (selectedIds ?? []).filter((id) => Object.hasOwn(objects.tokens, id) && objects.tokens[id]?.offMap !== true).map((id) => {
        const token = objects.tokens[id]!;
        return { id, kind: token.kind === 'character' ? 'character' : 'token', label: tokenLabel(token) };
      });
    },
    tabs: (): DockTab[] => {
      const { tabs, activeTabId } = view.tabMetaStore.getState();
      const presented = presentedTabId();
      return tabs.map((tab) => ({ tabId: tab.id, mapPath: tab.filePath, name: tab.displayName, active: tab.id === activeTabId, presented: tab.id === presented }));
    },
  };
}

/** A Tabletop 3D board, as Connect puts its buttons in: its key, the map it shows, and its root (with Atlas's toolbar slot). */
export interface BoardDockSource {
  key: string;
  mapPath: string;
  root: HTMLElement;
}

/**
 * A board as a view of the dock: its buttons act on the Atlas view holding its map (else the one the GM works in), its
 * scenes are that view's, and it has no selection of its own.
 */
function boardDockView(board: BoardDockSource, deps: StockUiDeps): DockView {
  const views = deps.views();
  const holder = views.find((view) => (view.atlasStore.getState() as { mapPath?: unknown }).mapPath === board.mapPath)
    ?? views.find((view) => view.tabMetaStore.getState().tabs.some((tab) => tab.filePath === board.mapPath))
    ?? deps.active();
  const atlas = holder ? dockView(holder, deps.presentedTabId) : null;
  return {
    viewId: board.key,
    ...(holder ? { contextViewId: holder.viewId } : {}),
    doc: board.root.ownerDocument,
    root: board.root,
    selectedTokens: () => [],
    tabs: () => atlas?.tabs() ?? [],
  };
}

/** The boards, never failing: a Tabletop that throws has none. */
function boardsOf(deps: StockUiDeps): BoardDockSource[] {
  try {
    return deps.boards?.() ?? [];
  } catch (error) {
    console.warn('[Atlas VTT Connect] Could not read the Tabletop boards:', error);
    return [];
  }
}

/** The dock's surroundings on Obsidian and on the stand-in's views. */
export function stockDockEnv(app: App, deps: StockUiDeps): DockEnv {
  const read = (key: string): unknown => {
    try {
      return (app.loadLocalStorage(MEMORY_PREFIX + key) as unknown) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const write = (key: string, value: unknown): void => {
    try {
      app.saveLocalStorage(MEMORY_PREFIX + key, value);
    } catch {
      // Remembering where the dock sat is a convenience.
    }
  };
  return {
    activeView: () => {
      const view = deps.active();
      return view ? dockView(view, deps.presentedTabId) : null;
    },
    view: (viewId) => {
      const view = deps.views().find((candidate) => candidate.viewId === viewId);
      if (view) return dockView(view, deps.presentedTabId);
      const board = boardsOf(deps).find((candidate) => candidate.key === viewId);
      return board ? boardDockView(board, deps) : null;
    },
    views: () => [...deps.views().map((view) => dockView(view, deps.presentedTabId)), ...boardsOf(deps).map((board) => boardDockView(board, deps))],
    watch: (listener) => {
      let timer: number | null = null;
      // One redraw for a burst of changes (a selection drag, a tab switch).
      const soon = (): void => {
        if (timer !== null) return;
        timer = window.setTimeout(() => { timer = null; listener(); }, 50);
      };
      const stops: Disposer[] = [deps.onViewsChanged(soon)];
      const refs = [app.workspace.on('active-leaf-change', soon), app.workspace.on('layout-change', soon)];
      stops.push(() => { for (const ref of refs) app.workspace.offref(ref); });
      // What each open view says of its selection and tabs, followed as views come and go.
      const followed = new Map<string, Disposer>();
      const follow = (): void => {
        const open = deps.views();
        for (const view of open) {
          if (followed.has(view.viewId)) continue;
          let selection = view.atlasStore.getState().selectedIds;
          let tokens = view.atlasStore.getState().objects.tokens;
          const stopScene = view.atlasStore.subscribe(() => {
            const state = view.atlasStore.getState();
            // A moved token changes `tokens` too often to follow; the selection and the set of tokens is what shows.
            if (state.selectedIds === selection && Object.keys(state.objects.tokens).length === Object.keys(tokens).length) return;
            selection = state.selectedIds;
            tokens = state.objects.tokens;
            soon();
          });
          const stopTabs = view.tabMetaStore.subscribe(soon);
          followed.set(view.viewId, () => { stopScene(); stopTabs(); });
        }
        for (const [id, stop] of [...followed]) {
          if (open.some((view) => view.viewId === id)) continue;
          stop();
          followed.delete(id);
        }
      };
      follow();
      stops.push(deps.onViewsChanged(follow));
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        for (const stop of stops) stop();
        for (const stop of followed.values()) stop();
        followed.clear();
      };
    },
    menu: (): MenuLike => new Menu(),
    setIcon: (element, name) => { setIcon(element, name); },
    memory: { get: read, set: write },
  };
}

/**
 * The `ui` namespace of one extension and what draws it: Connect in Atlas's own toolbar where it can be put there
 * (`nativeToolbar.ts`), the floating dock (`floatingDock.ts`) for a view whose toolbar cannot be found. `dispose` takes
 * both away.
 */
export function stockUi(app: App, deps: StockUiDeps): { api: UiApi; dispose: Disposer } {
  const env = stockDockEnv(app, deps);
  // The surfaces and the registry need each other: the registry tells them of changes, the panels they hold answer it.
  let native: NativeToolbar | null = null;
  let floating: FloatingDock | null = null;
  const refresh = (): void => {
    native?.sync();
    floating?.refresh();
  };
  const host: PanelHost = {
    open: (panelId, viewId) => {
      const id = viewId ?? env.activeView()?.viewId;
      if (id !== undefined && native?.handles(id)) native.open(panelId, viewId);
      else floating?.open(panelId, viewId);
    },
    close: (panelId, viewId) => {
      native?.close(panelId, viewId);
      floating?.close(panelId, viewId);
    },
    isOpen: (panelId, viewId) => native?.isOpen(panelId, viewId) === true || floating?.isOpen(panelId, viewId) === true,
    remove: (panelId) => {
      native?.remove(panelId);
      floating?.remove(panelId);
    },
  };
  const registry = createUiRegistry(() => host, refresh);
  floating = new FloatingDock(registry.records, env, (viewId) => native?.handles(viewId) !== true);
  native = new NativeToolbar(registry.records, env, () => floating?.refresh());
  const stopWatching = env.watch(() => native?.sync());
  const stopFloating = floating.start();
  native.sync();
  return {
    api: registry.api,
    dispose: () => {
      registry.dispose();
      stopWatching();
      stopFloating();
      native?.stop();
      native = null;
      floating = null;
    },
  };
}
