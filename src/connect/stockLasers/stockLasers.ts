/**
 * `lasers` on a stock Atlas VTT, which has no extension API. Stock Atlas has the GM's own laser pointer and nothing
 * else, both out of reach but for its private renderer object, so:
 * - `onLocal` hears the GM's laser by wrapping two methods of the view's laser pointer renderer on the instance: the one
 *   that adds a point to the trail (`addTrailPoint`) and the one that redraws (`redraw`, called whenever the pointer is
 *   let go), putting them back when the last listener goes. Atlas's own methods still run, first.
 * - `show` draws other people's lasers over the view on a canvas of its own (`laserOverlay.ts`).
 * Whatever of the renderer cannot be found makes `onLocal` hear nothing, and `show` draw nothing, and never throws.
 */
import type { Disposer, LasersApi, LocalLaserEvent, RemoteLaser } from '@atlas-vtt/api-types';
import { LaserOverlay } from './laserOverlay';
import { checkedLaser } from './laserModel';

/** A map view as the lasers read it. */
export interface LaserView {
  readonly viewId: string;
  readonly renderer?: unknown;
}

export interface StockLasersDeps {
  /** The open map view with this id, or null. */
  view(viewId: string): LaserView | null;
  /** Registers a disposer to run when the extension unloads; returns a function that runs and forgets it. */
  add(dispose: Disposer): Disposer;
}

interface TrailPoint {
  x: number;
  y: number;
}

/** The parts of a view's laser pointer renderer the hooks use. */
interface Pointer {
  trailPoints: TrailPoint[];
  isPointing: boolean;
  addTrailPoint?: (x: number, y: number) => void;
  redraw?: () => void;
}

const isObject = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The laser pointer renderer of a view, when it has the members the hooks wrap. */
function pointerOf(view: LaserView): Pointer | null {
  const pointer = isObject(view.renderer) ? view.renderer.laserPointerRenderer : undefined;
  if (!isObject(pointer) || !Array.isArray(pointer.trailPoints) || typeof pointer.isPointing !== 'boolean') return null;
  if (typeof pointer.addTrailPoint !== 'function' || typeof pointer.redraw !== 'function') return null;
  return pointer as unknown as Pointer;
}

/** The view's canvas and camera as the overlay reads them. */
function targetOf(view: LaserView, isOpen: () => boolean) {
  const renderer = isObject(view.renderer) ? view.renderer : {};
  const pointer = renderer.laserPointerRenderer;
  const found = isObject(pointer) ? pointer.canvasEl : null;
  // Not `instanceof`: a popout window has its own HTMLCanvasElement.
  const fromPointer = isObject(found) && found.tagName === 'CANVAS' && typeof found.getBoundingClientRect === 'function' ? (found as unknown as HTMLCanvasElement) : null;
  const viewport = (): Record<string, unknown> | null => {
    const get = renderer.getViewportInstance;
    const found: unknown = typeof get === 'function' ? (get as () => unknown).call(renderer) : null;
    return isObject(found) ? found : null;
  };
  return {
    canvas: (): HTMLCanvasElement | null => fromPointer,
    toScreen: (x: number, y: number): { x: number; y: number } | null => {
      const port = viewport();
      const toScreen = port?.toScreen;
      if (!port || typeof toScreen !== 'function') return null;
      const place: unknown = (toScreen as (x: number, y: number) => unknown).call(port, x, y);
      return isObject(place) && isNumber(place.x) && isNumber(place.y) ? { x: place.x, y: place.y } : null;
    },
    isOpen,
  };
}

/** One hook on a view's pointer, shared by every listener on it; it puts the wrapped methods back with the last one. */
class PointerHook {
  readonly listeners = new Set<(event: LocalLaserEvent) => void>();
  private wasPointing: boolean;
  private readonly restore: () => void;

  constructor(private readonly pointer: Pointer) {
    this.wasPointing = pointer.isPointing;
    const addTrailPoint = pointer.addTrailPoint as (x: number, y: number) => void;
    const redraw = pointer.redraw as () => void;
    const emit = (event: LocalLaserEvent): void => {
      const frozen = Object.freeze({ ...event });
      for (const listener of [...this.listeners]) {
        try {
          listener(frozen);
        } catch (error) {
          console.error('[Atlas VTT Connect] A laser listener failed:', error);
        }
      }
    };
    const wrappedAdd = (x: number, y: number): void => {
      const before = pointer.trailPoints.at(-1);
      addTrailPoint.call(pointer, x, y);
      const after = pointer.trailPoints.at(-1);
      // A point that came too close to the last is not added: nothing to say then.
      if (after && after !== before) emit({ kind: 'point', x: after.x, y: after.y });
    };
    const wrappedRedraw = (): void => {
      redraw.call(pointer);
      const pointing = pointer.isPointing === true;
      const lifted = this.wasPointing && !pointing;
      this.wasPointing = pointing;
      if (lifted) emit({ kind: 'lift' });
    };
    pointer.addTrailPoint = wrappedAdd;
    pointer.redraw = wrappedRedraw;
    this.restore = () => {
      // Atlas's own methods come back from the prototype, unless something else wrapped ours since: that stays.
      if (pointer.addTrailPoint === wrappedAdd) delete pointer.addTrailPoint;
      if (pointer.redraw === wrappedRedraw) delete pointer.redraw;
    };
  }

  end(): void {
    this.listeners.clear();
    this.restore();
  }
}

export function stockLasersApi(deps: StockLasersDeps): LasersApi {
  const hooks = new WeakMap<Pointer, PointerHook>();
  const overlays = new Map<string, LaserOverlay>();

  return Object.freeze({
    onLocal: (viewId: string, listener: (event: LocalLaserEvent) => void): Disposer => {
      if (typeof listener !== 'function') return () => undefined;
      const view = deps.view(viewId);
      const pointer = view ? pointerOf(view) : null;
      if (!pointer) return () => undefined;
      let hook = hooks.get(pointer);
      if (!hook) {
        hook = new PointerHook(pointer);
        hooks.set(pointer, hook);
      }
      const active = hook;
      active.listeners.add(listener);
      const remove = deps.add(() => {
        active.listeners.delete(listener);
        if (active.listeners.size === 0) {
          active.end();
          hooks.delete(pointer);
        }
      });
      return remove;
    },

    show: (viewId: string, laser: RemoteLaser): void => {
      // Checked first: a malformed laser throws whether or not the view is there.
      const checked = checkedLaser(laser);
      const view = deps.view(viewId);
      if (!view) return;
      let overlay = overlays.get(viewId);
      if (!overlay || overlay.isDisposed) {
        overlay = new LaserOverlay(targetOf(view, () => deps.view(viewId) !== null));
        overlays.set(viewId, overlay);
        const made = overlay;
        deps.add(() => { made.dispose(); overlays.delete(viewId); });
      }
      overlay.show(checked);
    },
  });
}
