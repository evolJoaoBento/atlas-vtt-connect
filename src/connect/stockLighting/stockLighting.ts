/**
 * `lighting.playerVisibility` and `lighting.watch` on a stock Atlas VTT, which has no extension API.
 *
 * What the GM's player window shows of a lit scene is worked out from what the view's lighting hands out
 * (`renderer.lightingFeature.controller`, private and duck-typed like everything the stand-in reads): its sight, ambient
 * light and light reaches, which the ported rules (`darknessRaster`) turn into the map cell by cell, and the token
 * perception of the players' frame (`TokenRenderer.playerFramePerception`, which also hides what committed fog covers).
 * Nothing of walls, lights or sight leaves this file: only what they decide.
 *
 * Fails closed. Whatever cannot be read, or is not the scene's yet, is `pending` (players see nothing); `unlit` is
 * answered only where Atlas itself shows the scene unlit: dynamic lighting switched off, or a scene saved unlit.
 * What is left out shows players less, never more: the footprints of tokens seen in the dark and the explored memory.
 */
import type { Disposer, LightingApi, Perception, PlayerVisibility, PlayerVisibilityOptions } from '@atlas-vtt/api-types';
import { darknessRaster, MAX_DARKNESS_CELLS_PER_SIDE, type DarknessRaster, type Lighting, type MapSize } from './darknessRaster';
import type { AmbientLight, LightReach, Point, Polygon, SenseRules, Sight, SightRegion } from './visionRules';

/** The cells per side a caller may ask for, and what it gets when it asks for none. */
const CELLS = { min: 16, max: 1024, default: MAX_DARKNESS_CELLS_PER_SIDE } as const;
/** How often a watched, lit view is asked whether its sight changed: the controller says so itself where it can be hooked. */
const WATCH_POLL_MS = 250;
/** Rasters kept in all: callers rarely ask for more than one or two cell counts of a view. */
const KEPT_RASTERS = 8;

const UNLIT: PlayerVisibility = Object.freeze({ status: 'unlit' });
const PENDING: PlayerVisibility = Object.freeze({ status: 'pending' });

interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

/** What the lighting reads of a stock map view's scene. */
export interface LightingScene {
  mapLoaded: boolean;
  isMapLoading: boolean;
  lighting: { enabled: boolean };
  objects: { tokens: Record<string, unknown>; fog?: unknown; walls?: unknown; lights?: unknown };
}

export interface LightingView {
  readonly viewId: string;
  readonly atlasStore: Store<LightingScene>;
  readonly renderer?: unknown;
}

export interface StockLightingDeps {
  /** The open map view with this id, or null. */
  view(viewId: string): LightingView | null;
  /** The loaded map's size in world pixels; 0 × 0 while none is loaded. */
  mapSize(view: LightingView): MapSize;
  /** Whether Atlas's dynamic lighting experiment is on; null when Atlas's settings cannot be read. */
  dynamicLighting(): boolean | null;
  /** Registers a disposer to run when the extension unloads; returns a function that runs and forgets it. */
  add(dispose: Disposer): Disposer;
}

/** The view's lighting as the controller hands it out. */
interface SceneLightingView {
  isEnabled(): boolean;
  sightIsCurrent(): boolean;
  currentSight(): unknown;
  ambientLight(): unknown;
  lightReaches(): unknown;
}

interface Controller {
  readonly renderer: SceneLightingView;
  playerSight(): unknown;
  onSightChange?: (...args: unknown[]) => unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;
const field = (target: unknown, name: string): unknown => (isObject(target) ? target[name] : undefined);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value: unknown): value is Point => isObject(value) && isNumber(value.x) && isNumber(value.y);
const isPolygon = (value: unknown): value is Polygon => Array.isArray(value) && value.every(isPoint);
const SEEING = new Set(['none', 'normal', 'as-bright', 'as-dim']);
const isSeeing = (value: unknown): boolean => typeof value === 'string' && SEEING.has(value);

/** The view's lighting controller, or null while Atlas has none (dynamic lighting off, or not built yet) or it cannot be read. */
function controllerOf(view: LightingView): Controller | null {
  const controller = field(field(view.renderer, 'lightingFeature'), 'controller');
  const lighting = field(controller, 'renderer');
  const names = ['isEnabled', 'sightIsCurrent', 'currentSight', 'ambientLight', 'lightReaches'] as const;
  if (!isObject(controller) || typeof controller.playerSight !== 'function' || !isObject(lighting) || names.some((name) => typeof lighting[name] !== 'function')) return null;
  return controller as unknown as Controller;
}

/** How the players' frame perceives each token (`TokenRenderer.playerFramePerception`, committed fog included); null where it cannot be had. */
function perceptionOf(view: LightingView, controller: Controller): ((id: string) => unknown) | null {
  const get = field(view.renderer, 'getTokenRenderer');
  if (typeof get !== 'function') return null;
  const tokens = (get as () => unknown).call(view.renderer);
  const frame = field(tokens, 'playerFramePerception');
  if (typeof frame !== 'function') return null;
  const perceive = (frame as (sight: unknown) => unknown).call(tokens, controller.playerSight());
  return typeof perceive === 'function' ? (perceive as (id: string) => unknown) : null;
}

function readSense(value: unknown): SenseRules | null {
  if (!isObject(value) || !isObject(value.sees)) return null;
  const { bright, dim, dark, magicalDark } = value.sees;
  if (![bright, dim, dark, magicalDark].every(isSeeing)) return null;
  if ((value.reveals !== 'all' && value.reveals !== 'creatures') || typeof value.lineOfSight !== 'boolean' || typeof value.precise !== 'boolean') return null;
  return value as unknown as SenseRules;
}

function readSight(value: unknown): Sight | null {
  if (!isObject(value) || typeof value.all !== 'boolean' || !Array.isArray(value.regions)) return null;
  for (const region of value.regions as unknown[]) {
    if (!isObject(region) || !readSense(region.sense) || !isPoint(region.origin) || !isNumber(region.radius)) return null;
    if (region.polygon !== null && !isPolygon(region.polygon)) return null;
  }
  return value as unknown as Sight & { regions: SightRegion[] };
}

function readAmbient(value: unknown): AmbientLight | null {
  if (!isObject(value) || !isNumber(value.ambient)) return null;
  for (const key of ['litThreshold', 'brightThreshold'] as const) if (value[key] !== undefined && !isNumber(value[key])) return null;
  const { zones } = value;
  if (zones !== undefined) {
    if (!Array.isArray(zones)) return null;
    for (const zone of zones as unknown[]) if (!isObject(zone) || !isNumber(zone.ambient) || !isPolygon(zone.polygon)) return null;
  }
  return value as unknown as AmbientLight;
}

function readReaches(value: unknown): LightReach[] | null {
  if (!Array.isArray(value)) return null;
  for (const reach of value as unknown[]) {
    if (!isObject(reach) || !isPoint(reach.origin) || !isNumber(reach.bright) || !isNumber(reach.dim) || !isPolygon(reach.polygon)) return null;
    if ((reach.darkness !== undefined && typeof reach.darkness !== 'boolean') || (reach.priority !== undefined && !isNumber(reach.priority))) return null;
  }
  return value as LightReach[];
}

function cellsPerSide(asked: unknown): number {
  return isNumber(asked) ? Math.min(CELLS.max, Math.max(CELLS.min, Math.round(asked))) : CELLS.default;
}

const PERCEPTIONS = new Set<string>(['seen', 'sensed', 'unseen']);

interface Built {
  inputs: readonly unknown[];
  raster: DarknessRaster;
}

/** Shares one hook on a controller's `onSightChange` between the watches on its view; the controller says when its sight changed. */
class SightHooks {
  private readonly hooks = new WeakMap<Controller, { listeners: Set<() => void>; restore: () => void }>();

  /** Runs `listener` after the controller's sight changes; returns the function that stops it. Unhooks with the last listener. */
  on(controller: Controller, listener: () => void): () => void {
    let hook = this.hooks.get(controller);
    if (!hook) {
      const listeners = new Set<() => void>();
      const original = controller.onSightChange as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') return () => undefined;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        const result = original.apply(this, args);
        for (const each of [...listeners]) each();
        return result;
      };
      controller.onSightChange = wrapper;
      const restore = (): void => {
        // The prototype's own method comes back; something that wrapped ours since stays, with ours inside it.
        if (controller.onSightChange === wrapper) delete controller.onSightChange;
      };
      hook = { listeners, restore };
      this.hooks.set(controller, hook);
    }
    const { listeners } = hook;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        hook.restore();
        this.hooks.delete(controller);
      }
    };
  }
}

export function stockLightingApi(deps: StockLightingDeps): LightingApi {
  const rasters = new Map<string, Built>();
  const hooks = new SightHooks();

  const raster = (viewId: string, cells: number, lighting: Lighting, map: MapSize): DarknessRaster => {
    const key = `${viewId}:${cells}`;
    const inputs = [lighting.sight, lighting.ambient, lighting.reaches, map.width, map.height];
    const last = rasters.get(key);
    if (last && last.inputs.length === inputs.length && last.inputs.every((input, index) => input === inputs[index])) return last.raster;
    const built = { inputs, raster: darknessRaster(lighting, map, cells) };
    rasters.delete(key);
    rasters.set(key, built);
    if (rasters.size > KEPT_RASTERS) rasters.delete(rasters.keys().next().value!);
    return built.raster;
  };

  const visibility = (view: LightingView, options: PlayerVisibilityOptions | undefined): PlayerVisibility => {
    const state = view.atlasStore.getState();
    if (!state.mapLoaded || state.isMapLoading) return PENDING;
    const switchedOn = deps.dynamicLighting();
    // With the experiment off, Atlas builds no lighting: its player window shows the scene unlit, whatever the scene says.
    if (switchedOn === false) return UNLIT;
    const savedLit = state.lighting.enabled === true;
    const controller = switchedOn === true ? controllerOf(view) : null;
    // Never unlit for a scene saved lit: whatever cannot be read now is not known, and unknown is dark.
    if (!controller) return savedLit ? PENDING : UNLIT;
    const lighting = controller.renderer;
    const lit = lighting.isEnabled();
    if (lit !== savedLit) return PENDING; // the GM is switching lighting on or off: the window is not settled
    if (!lit) return UNLIT;
    if (!lighting.sightIsCurrent()) return PENDING;
    const map = deps.mapSize(view);
    if (!(map.width > 0) || !(map.height > 0)) return PENDING;
    const sight = readSight(lighting.currentSight());
    const ambient = readAmbient(lighting.ambientLight());
    const reaches = readReaches(lighting.lightReaches());
    if (!sight || !ambient || !reaches) return PENDING;
    const perceive = perceptionOf(view, controller);
    if (!perceive) return PENDING;
    const tokens: Record<string, Perception> = {};
    for (const id of Object.keys(state.objects.tokens)) {
      const seen = perceive(id);
      tokens[id] = typeof seen === 'string' && PERCEPTIONS.has(seen) ? (seen as Perception) : 'unseen';
    }
    const grid = raster(view.viewId, cellsPerSide(options?.maxCellsPerSide), { sight, ambient, reaches }, map);
    // A fresh buffer on every call: the raster is kept between calls, and no caller may change it for another.
    const shown = new Uint8Array(grid.dark.length);
    for (let i = 0; i < shown.length; i++) shown[i] = grid.dark[i] ? 0 : 1;
    return Object.freeze({
      status: 'ready',
      tokens: Object.freeze(tokens),
      darkness: Object.freeze({ cellSize: grid.cellSize, cols: grid.cols, rows: grid.rows, shown }),
      showsExplored: false,
    });
  };

  return Object.freeze({
    playerVisibility: (viewId: string, options?: PlayerVisibilityOptions): PlayerVisibility => {
      const view = deps.view(viewId);
      if (!view) return PENDING;
      try {
        return visibility(view, options);
      } catch (error) {
        // Whatever fails while the view is read, players are shown nothing.
        console.error('[Atlas VTT Connect] Player visibility could not be worked out:', error);
        return PENDING;
      }
    },
    watch: (viewId: string, listener: () => void): Disposer => {
      const view = deps.view(viewId);
      if (!view || typeof listener !== 'function') return () => undefined;
      let active = true;
      let hooked: { controller: Controller; stop: () => void } | null = null;
      const signature = (): readonly unknown[] => {
        const state = view.atlasStore.getState();
        const controller = switchedControllerOf(view);
        const lighting = controller?.renderer;
        return [
          state.lighting, state.mapLoaded, state.isMapLoading, state.objects.fog, state.objects.walls, state.objects.lights, deps.dynamicLighting(),
          controller, lighting?.isEnabled(), lighting?.sightIsCurrent(), lighting?.currentSight(), lighting?.lightReaches(), lighting?.ambientLight(),
        ];
      };
      const switchedControllerOf = (target: LightingView): Controller | null => (deps.dynamicLighting() === true ? controllerOf(target) : null);
      let last = signature();
      const call = (): void => {
        if (!active) return;
        try {
          listener();
        } catch (error) {
          console.error('[Atlas VTT Connect] A lighting listener failed:', error);
        }
      };
      const hookCurrent = (): void => {
        const controller = switchedControllerOf(view);
        if (hooked?.controller === controller) return;
        hooked?.stop();
        hooked = controller ? { controller, stop: hooks.on(controller, check) } : null;
      };
      function check(): void {
        if (!active) return;
        if (!deps.view(viewId)) {
          dispose();
          return;
        }
        hookCurrent();
        const next = signature();
        if (next.length === last.length && next.every((value, index) => value === last[index])) return;
        last = next;
        call();
      }
      const stopStore = view.atlasStore.subscribe(check);
      const timer = window.setInterval(check, WATCH_POLL_MS);
      hookCurrent();
      const remove = deps.add(() => {
        active = false;
        stopStore();
        window.clearInterval(timer);
        hooked?.stop();
        hooked = null;
      });
      function dispose(): void {
        remove();
      }
      return dispose;
    },
  });
}
