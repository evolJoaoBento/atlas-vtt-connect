import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerVisibility } from '@atlas-vtt/api-types';
import { stockLightingApi } from '../../../src/connect/stockLighting/stockLighting';
import { FakeController, litView, REAL } from '../../fake/fakeStockLighting';

type Ready = Extract<PlayerVisibility, { status: 'ready' }>;

/** Even-odd test, written out here so the raster is not checked by the code that made it. */
function inside(polygon: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let in_ = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) in_ = !in_;
  }
  return in_;
}

const visibility = (lit: ReturnType<typeof litView>, options?: { maxCellsPerSide?: number }): PlayerVisibility => stockLightingApi(lit.deps).playerVisibility('view-a', options);

describe('lighting on a stock Atlas', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a lit scene as Atlas\'s own lighting hands it out: which tokens, and which cells of the map', () => {
    const answer = visibility(litView());
    expect(answer.status).toBe('ready');
    const ready = answer as Ready;
    expect(ready.tokens).toEqual(REAL.perception);
    expect(ready.showsExplored).toBe(false);
    const { cellSize, cols, rows, shown } = ready.darkness;
    expect(shown).toHaveLength(cols * rows);
    expect(cols).toBe(Math.ceil(REAL.map.width / cellSize));
    expect(rows).toBe(Math.ceil(REAL.map.height / cellSize));
    let showing = 0;
    const [region] = REAL.sight.regions;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (shown[row * cols + col] !== 1) continue;
        showing++;
        // Players never see where the token with vision does not: every shown cell lies in its line of sight, within its range.
        const x = (col + 0.5) * cellSize;
        const y = (row + 0.5) * cellSize;
        expect(inside(region!.polygon as never, x, y)).toBe(true);
        expect(Math.hypot(x - region!.origin.x, y - region!.origin.y)).toBeLessThanOrEqual(region!.radius);
      }
    }
    expect(showing).toBeGreaterThan(0);
    // A scene lit by a torch and a dim ambient light is not wholly shown either.
    expect(showing).toBeLessThan(cols * rows);
  });

  it('shows a cell only where the light there lets the sense perceive it', () => {
    const lit = litView();
    const dark = structuredClone(REAL.sight);
    const none = { ...REAL.ambient, ambient: 0 };
    (lit.controller!.parts as { ambient: unknown; reaches: unknown; sight: unknown }).ambient = none;
    (lit.controller!.parts as { reaches: unknown }).reaches = [];
    (lit.controller!.parts as { sight: unknown }).sight = dark;
    const answer = visibility(lit) as Ready;
    // No light at all: normal sight perceives nothing, so players see no map.
    expect(answer.darkness.shown.every((cell) => cell === 0)).toBe(true);
  });

  it('shows the whole lit map where no token has vision and the light is bright', () => {
    const lit = litView();
    Object.assign(lit.controller!.parts, { sight: { all: true, regions: [] }, ambient: { ...REAL.ambient, ambient: 1 }, reaches: [] });
    const { shown } = (visibility(lit) as Ready).darkness;
    expect(shown.every((cell) => cell === 1)).toBe(true);
  });

  it('is unlit where the scene is saved unlit, or dynamic lighting is off in Atlas', () => {
    expect(visibility(litView({ savedLit: false })).status).toBe('unlit');
    const off = litView();
    off.setFlag(false);
    expect(visibility(off).status).toBe('unlit');
    const noController = litView({ savedLit: false, controller: null });
    expect(visibility(noController).status).toBe('unlit');
  });

  it('never calls a scene saved lit unlit when it cannot tell', () => {
    const unreadable = litView();
    unreadable.setFlag(null);
    expect(visibility(unreadable).status).toBe('pending');
    expect(visibility(litView({ controller: null })).status).toBe('pending');
    // The GM is switching lighting on, or off: the store and the window disagree.
    expect(visibility(litView({ savedLit: false, controller: new FakeController({ enabled: true, current: true, sight: REAL.sight, ambient: REAL.ambient, reaches: REAL.reaches }) })).status).toBe('pending');
    expect(visibility(litView({ savedLit: true, controller: new FakeController({ enabled: false, current: true, sight: REAL.sight, ambient: REAL.ambient, reaches: REAL.reaches }) })).status).toBe('pending');
  });

  it('is pending while the view\'s sight is not the scene\'s, a map loads, or the map has no size', () => {
    const stale = litView();
    stale.controller!.parts.current = false;
    expect(visibility(stale).status).toBe('pending');
    const loading = litView();
    loading.scene.set({ isMapLoading: true } as never);
    expect(visibility(loading).status).toBe('pending');
    expect(visibility(litView({ map: { width: 0, height: 0 } })).status).toBe('pending');
    expect(stockLightingApi(litView().deps).playerVisibility('unknown').status).toBe('pending');
  });

  it('is pending for anything it cannot read, never showing the map on a guess', () => {
    const bad = (patch: Record<string, unknown>) => {
      const lit = litView();
      Object.assign(lit.controller!.parts, patch);
      return visibility(lit).status;
    };
    expect(bad({ sight: null })).toBe('pending');
    expect(bad({ sight: { all: false, regions: [{ sense: { sees: { bright: 'sometimes' } }, origin: { x: 1, y: 1 }, radius: 5, polygon: null }] } })).toBe('pending');
    expect(bad({ sight: { all: false, regions: [{ ...REAL.sight.regions[0], polygon: [{ x: 'a', y: 1 }] }] } })).toBe('pending');
    expect(bad({ ambient: { ambient: 'bright' } })).toBe('pending');
    expect(bad({ reaches: [{ origin: { x: 1, y: 1 }, bright: 1, dim: 2 }] })).toBe('pending');
    expect(bad({ reaches: 'none' })).toBe('pending');
    const noFrames = litView();
    (noFrames.view.renderer as { getTokenRenderer: unknown }).getTokenRenderer = () => ({});
    expect(visibility(noFrames).status).toBe('pending');
    const throwing = litView();
    throwing.controller!.renderer.currentSight = () => { throw new Error('graphics context lost'); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(visibility(throwing).status).toBe('pending');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the perception the players\' frame gives, hidden tokens and fog included', () => {
    const ids = Object.keys(REAL.perception);
    const lit = litView({ perception: { [ids[0]!]: 'unseen', [ids[1]!]: 'sensed' } });
    expect((visibility(lit) as Ready).tokens).toEqual({ [ids[0]!]: 'unseen', [ids[1]!]: 'sensed' });
    const odd = litView({ perception: { [ids[0]!]: 'visible' } });
    expect((visibility(odd) as Ready).tokens).toEqual({ [ids[0]!]: 'unseen', [ids[1]!]: 'unseen' });
  });

  it('answers a cell count within bounds, and a fresh buffer on every call', () => {
    const lit = litView();
    const api = stockLightingApi(lit.deps);
    const first = api.playerVisibility('view-a') as Ready;
    const second = api.playerVisibility('view-a') as Ready;
    expect(second.darkness.shown).not.toBe(first.darkness.shown);
    first.darkness.shown.fill(1);
    expect(api.playerVisibility('view-a') as Ready).toMatchObject({ darkness: { shown: second.darkness.shown } });
    const coarse = api.playerVisibility('view-a', { maxCellsPerSide: 16 }) as Ready;
    expect(Math.max(coarse.darkness.cols, coarse.darkness.rows)).toBeLessThanOrEqual(16);
    // A coarse cell is shown only when all of it is: never more than the fine answer.
    const fine = second.darkness;
    const { cellSize, cols, rows, shown } = coarse.darkness;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (shown[row * cols + col] !== 1) continue;
        for (let y = row * cellSize; y < Math.min((row + 1) * cellSize, REAL.map.height); y += fine.cellSize) {
          for (let x = col * cellSize; x < Math.min((col + 1) * cellSize, REAL.map.width); x += fine.cellSize) {
            expect(fine.shown[Math.floor(y / fine.cellSize) * fine.cols + Math.floor(x / fine.cellSize)]).toBe(1);
          }
        }
      }
    }
  });

  describe('watch', () => {
    it('tells when the sight, the lights or the scene change, once per change', () => {
      const lit = litView();
      const heard: string[] = [];
      stockLightingApi(lit.deps).watch('view-a', () => heard.push('changed'));
      lit.tick(1000);
      expect(heard).toEqual([]);
      lit.controller!.parts.sight = structuredClone(REAL.sight);
      lit.tick(300);
      expect(heard).toHaveLength(1);
      lit.tick(1000);
      expect(heard).toHaveLength(1);
      lit.controller!.parts.current = false;
      lit.tick(300);
      lit.controller!.parts.current = true;
      lit.tick(300);
      expect(heard).toHaveLength(3);
      lit.scene.set({ lighting: { enabled: false } } as never);
      expect(heard).toHaveLength(4);
    });

    it('hears the controller\'s own sight change at once, and gives the hook back when the last watch ends', () => {
      const lit = litView();
      const controller = lit.controller!;
      const api = stockLightingApi(lit.deps);
      const heard: string[] = [];
      expect(Object.hasOwn(controller, 'onSightChange')).toBe(false);
      const first = api.watch('view-a', () => heard.push('one'));
      const second = api.watch('view-a', () => heard.push('two'));
      controller.parts.reaches = structuredClone(REAL.reaches);
      controller.onSightChange();
      // Atlas's own method still runs, and both watchers heard it without waiting for a poll.
      expect(controller.sightChanges).toBe(1);
      expect(heard).toEqual(['one', 'two']);
      first();
      expect(Object.hasOwn(controller, 'onSightChange')).toBe(true);
      second();
      expect(Object.hasOwn(controller, 'onSightChange')).toBe(false);
      controller.onSightChange();
      expect(controller.sightChanges).toBe(2);
    });

    it('follows a controller Atlas builds anew, ends with the view and with the extension, and a throwing listener harms nobody', () => {
      const lit = litView();
      const api = stockLightingApi(lit.deps);
      const heard: string[] = [];
      api.watch('view-a', () => heard.push('x'));
      const next = new FakeController({ enabled: true, current: true, sight: REAL.sight, ambient: REAL.ambient, reaches: REAL.reaches });
      (lit.view.renderer.lightingFeature as { controller: unknown }).controller = next;
      lit.tick(300);
      expect(heard).toEqual(['x']);
      next.onSightChange();
      expect(next.sightChanges).toBe(1);
      lit.close();
      lit.tick(300);
      expect(lit.added).toEqual([]);
      expect(Object.hasOwn(next, 'onSightChange')).toBe(false);

      const other = litView();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      stockLightingApi(other.deps).watch('view-a', () => { throw new Error('listener'); });
      other.scene.set({ isMapLoading: true } as never);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
      other.unload();
      expect(vi.getTimerCount()).toBe(0);
      expect(Object.hasOwn(other.controller!, 'onSightChange')).toBe(false);
    });

    it('does nothing for an unknown view or a listener that is not a function', () => {
      const api = stockLightingApi(litView().deps);
      expect(() => api.watch('nope', () => undefined)()).not.toThrow();
      expect(() => api.watch('view-a', 'x' as never)()).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
