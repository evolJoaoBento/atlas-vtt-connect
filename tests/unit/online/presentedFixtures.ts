/**
 * The fork's presented-scene fixtures over `FakeAtlas`: a view is a fake Atlas view with the Tavern
 * and Dungeon tabs, and its store a zustand store in the fork's field names whose every state goes to
 * `atlas.views.setSnapshot`. The presenter is the `presentedSource` of the fake's extension, driven
 * with `present` and `clear` as the fork drove Atlas's `PresentedScene`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  DrawingStroke, FogOperation, GridState, InitiativeState, SceneLighting, SceneSnapshot, TextElement, TokenEntity, ViewCamera,
  WidgetSettings, WidgetValues,
} from '@atlas-vtt/api-types';
import { presentedSource, type PresentedSceneSource } from '../../../src/app/online/atlas/presentedSource';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';
import { createDefaultInitiativeState } from './sceneFixtures';

/** A view store's scene in the fork's field names; `pins`, `walls`, `lights` and `audios` never reach a snapshot. */
export interface ViewState {
  background: string | null;
  grid: GridState | null;
  objects: {
    tokens: Record<string, TokenEntity>;
    fog: Record<string, FogOperation>;
    texts: Record<string, TextElement>;
    drawings: Record<string, DrawingStroke>;
    pins?: Record<string, unknown>;
    walls?: Record<string, unknown>;
    lights?: Record<string, unknown>;
    audios?: Record<string, unknown>;
  };
  widgetSettings: WidgetSettings;
  widgetValues: WidgetValues;
  initiative: InitiativeState;
  initiativeTrackerOpen: boolean;
  isMapLoading: boolean;
  /** Unset is loaded. */
  mapLoaded?: boolean;
  /** Unset is the tab's map. */
  mapPath?: string | null;
  lighting?: SceneLighting;
  /** The GM's camera in the store: no snapshot field, so changing it sends nothing. */
  camera?: unknown;
}

const UNLIT: SceneLighting = { enabled: false, ambient: 1 };
export const TAVERN_MAP = 'maps/tavern.atlasmap';
export const DUNGEON_MAP = 'maps/dungeon.atlasmap';

/** An empty, loaded Tavern scene, as `emptySceneState` in the fork's camera fixtures. */
export function emptySceneState(isMapLoading = false): ViewState {
  return {
    background: 'maps/tavern.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as GridState,
    objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading,
    mapLoaded: true,
    mapPath: TAVERN_MAP,
  };
}

/** The snapshot Atlas would give of a store in this state; the records by reference. */
export function snapshotOfState(state: ViewState, mapSize: { width: number; height: number }, tabMap: string): Omit<SceneSnapshot, 'viewId'> {
  const { tokens, texts, drawings, fog } = state.objects;
  return {
    mapPath: state.mapPath === undefined ? tabMap : state.mapPath,
    loaded: state.mapLoaded !== false && !state.isMapLoading,
    mapSize,
    background: state.background,
    grid: state.grid,
    objects: { tokens, texts, drawings, fog },
    widgets: { settings: state.widgetSettings, values: state.widgetValues },
    initiative: state.initiative,
    initiativeTrackerOpen: state.initiativeTrackerOpen,
    lighting: state.lighting ?? UNLIT,
  };
}

/** The tab store of a fake view, as the fork's tests used Atlas's tab store. */
export interface FakeTabs {
  getState(): { setActiveTab(tabId: string): void; removeTab(tabId: string): void; addTab(mapPath: string, name: string): string };
}

export interface SceneView<S extends ViewState = ViewState> {
  /** The view's id; what `present` takes. */
  view: string;
  store: StoreApi<S>;
  tabs: FakeTabs;
  tavern: string;
  dungeon: string;
}

/** A presented scene source over a fake Atlas, with the fork's `present(view, tabId)` and `clear()`. */
export interface Presenter extends PresentedSceneSource {
  readonly atlas: FakeAtlas;
  readonly extension: ReturnType<FakeAtlas['connect']>;
  /** As Atlas's scene registers a presentation: held while the view shows another tab or not the tab's loaded map. */
  present(view: string, tabId: string): void;
  clear(): void;
}

export function presenter(atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage'] })): Presenter {
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  const source = presentedSource(extension);
  return {
    atlas,
    extension,
    current: () => source.current(),
    isHeld: () => source.isHeld(),
    subscribe: (listener) => source.subscribe(listener),
    present: (view, tabId) => { void atlas.presentation.present(view, tabId, { switchTab: false }); },
    clear: () => atlas.presentation.stop(),
  };
}

let views = 0;

/** A fake view with the Tavern tab (active) and the Dungeon tab, its store holding `state`; no viewport unless one is given. */
export function sceneView<S extends ViewState>(
  presenting: Presenter, state: S, options: { mapSize?: { width: number; height: number }; camera?: () => ViewCamera | null } = {},
): SceneView<S> {
  const { atlas } = presenting;
  const view = `view-${++views}`;
  atlas.views.open(view, [{ tabId: 'tavern', mapPath: TAVERN_MAP, name: 'Tavern' }, { tabId: 'dungeon', mapPath: DUNGEON_MAP, name: 'Dungeon' }]);
  if (options.camera) atlas.views.setCamera(view, options.camera);
  const mapSize = options.mapSize ?? { width: 0, height: 0 };
  const store = createStore<S>(() => state);
  const mirror = (next: S): void => atlas.views.setSnapshot(view, snapshotOfState(next, mapSize, TAVERN_MAP));
  mirror(state);
  store.subscribe(mirror);
  let added = 0;
  const tabs: FakeTabs = {
    getState: () => ({
      setActiveTab: (tabId) => atlas.views.setActiveTab(view, tabId),
      removeTab: (tabId) => atlas.views.removeTab(view, tabId),
      addTab: (mapPath, name) => {
        const tabId = `tab-${++added}`;
        atlas.views.addTab(view, { tabId, mapPath, name });
        return tabId;
      },
    }),
  };
  return { view, store, tabs, tavern: 'tavern', dungeon: 'dungeon' };
}

/** Just enough of the GM's viewport for the camera: its centre and visible world size, and its frames. */
export class FakeViewport {
  center = { x: 500, y: 400 };
  worldScreenWidth = 800;
  worldScreenHeight = 600;
  private bound: { atlas: FakeAtlas; view: string } | null = null;

  /** The camera the view reports, read live. */
  readonly camera = (): ViewCamera => ({ centerX: this.center.x, centerY: this.center.y, width: this.worldScreenWidth, height: this.worldScreenHeight });

  bind(atlas: FakeAtlas, view: string): void {
    this.bound = { atlas, view };
  }

  /** One rendered frame: the view's camera watchers run. */
  frame(): void {
    if (this.bound) this.bound.atlas.views.frame(this.bound.view);
  }

  /** Pans to (x, y), then renders a frame. */
  moveTo(x: number, y: number): void {
    this.center = { x, y };
    this.frame();
  }

  get listenerCount(): number {
    return this.bound ? this.bound.atlas.views.cameraWatchCount(this.bound.view) : 0;
  }
}

/** A view with two scene tabs (Tavern active) and `viewport` (null for none); the map is 2000 × 1500. */
export function viewWithViewport(presenting: Presenter, viewport: FakeViewport | null, state: ViewState = emptySceneState()): SceneView {
  const scene = sceneView(presenting, state, { mapSize: { width: 2000, height: 1500 }, ...(viewport ? { camera: viewport.camera } : {}) });
  viewport?.bind(presenting.atlas, scene.view);
  return scene;
}
