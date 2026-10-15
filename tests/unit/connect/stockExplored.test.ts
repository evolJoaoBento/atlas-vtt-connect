import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerVisibility } from '@atlas-vtt/api-types';
import { darknessRaster, type ExploredImage } from '../../../src/connect/stockLighting/darknessRaster';
import { EXPLORED_SETTLE_MS, ExploredFollower, type ExploredInput } from '../../../src/connect/stockLighting/exploredMemory';
import { stockLightingApi } from '../../../src/connect/stockLighting/stockLighting';
import { litView, REAL } from '../../fake/fakeStockLighting';

type Ready = Extract<PlayerVisibility, { status: 'ready' }>;

/** A memory of `cols × rows` texels, explored where `where(col, row)` says. */
const image = (cols: number, rows: number, where: (col: number, row: number) => boolean): ExploredImage => {
  const coverage = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) coverage[row * cols + col] = where(col, row) ? 255 : 0;
  return { width: cols, height: rows, coverage };
};

const sightAt = { all: false, regions: [{ sense: { sees: { bright: 'normal', dim: 'normal', dark: 'none', magicalDark: 'none' }, reveals: 'all', lineOfSight: true, precise: true }, origin: { x: 500, y: 500 }, radius: 50, polygon: [{ x: 450, y: 450 }, { x: 550, y: 450 }, { x: 550, y: 550 }, { x: 450, y: 550 }] }] };
const BRIGHT = { ambient: 1 };

describe('explored memory on a stock Atlas', () => {
  describe('the raster', () => {
    const map = { width: 640, height: 615 };
    it('shows the explored places outside what any token sees now, only while a token has vision', () => {
      const left = image(64, 61, (col) => col < 10);
      const shown = (explored: ExploredImage | null, sight = sightAt): number => darknessRaster({ sight: sight as never, ambient: BRIGHT, reaches: [] }, map, 384, explored).dark.reduce((n, v) => n + (v ? 0 : 1), 0);
      const without = shown(null);
      const withMemory = shown(left);
      expect(withMemory).toBeGreaterThan(without);
      // Cells of the first texels' columns (the left tenth) show, the rest of the map stays dark.
      const raster = darknessRaster({ sight: sightAt as never, ambient: BRIGHT, reaches: [] }, map, 384, left);
      expect(raster.dark[0]).toBe(0);
      expect(raster.dark[raster.cols - 1]).toBe(1);
      // With no token having vision, normal sight reaches everywhere and memory adds nothing.
      expect(shown(left, { all: true, regions: [] } as never)).toBe(shown(null, { all: true, regions: [] } as never));
    });

    it('counts a texel explored from more than half coverage on', () => {
      const faint = { width: 1, height: 1, coverage: Uint8Array.of(127) };
      const strong = { width: 1, height: 1, coverage: Uint8Array.of(128) };
      const cells = (memory: ExploredImage): number => darknessRaster({ sight: { all: false, regions: [] }, ambient: BRIGHT, reaches: [] }, map, 384, memory).dark.reduce((n, v) => n + (v ? 0 : 1), 0);
      expect(cells(faint)).toBe(0);
      expect(cells(strong)).toBeGreaterThan(0);
    });
  });

  describe('the follower', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const input = (extra: Partial<ExploredInput> = {}): ExploredInput => ({ keeps: true, isMemory: true, mask: 'mask-a', edits: 0, mapPath: 'm', ...extra });

    function setup() {
      let now = 0;
      const decoded: string[] = [];
      const resolvers: Array<(value: ExploredImage) => void> = [];
      let changes = 0;
      const memory = image(2, 2, () => true);
      const follower = new ExploredFollower(() => { changes++; }, () => now, (mask) => {
        decoded.push(mask);
        return new Promise<ExploredImage>((resolve) => { resolvers.push(resolve); });
      });
      return { follower, decoded, resolvers, memory, tick: (ms: number) => { now += ms; vi.advanceTimersByTime(ms); }, changes: () => changes };
    }

    it('shows nothing at first, tells when the settle time is over, decodes the mask once and then shows it', async () => {
      const t = setup();
      expect(t.follower.read(input())).toBeNull();
      expect(t.decoded).toEqual([]);
      t.tick(EXPLORED_SETTLE_MS + 30);
      expect(t.changes()).toBe(1);
      expect(t.follower.read(input())).toBeNull();
      expect(t.decoded).toEqual(['mask-a']);
      // Asked again while it decodes: not decoded twice.
      t.follower.read(input());
      expect(t.decoded).toEqual(['mask-a']);
      t.resolvers[0]!(t.memory);
      await Promise.resolve();
      expect(t.changes()).toBe(2);
      expect(t.follower.read(input())).toBe(t.memory);
    });

    it('forgets everything when edits are made, the map changes, or memory is taken out, and shows nothing until it settles again', async () => {
      const t = setup();
      t.follower.read(input());
      t.tick(EXPLORED_SETTLE_MS + 30);
      t.follower.read(input());
      t.resolvers[0]!(t.memory);
      await Promise.resolve();
      expect(t.follower.read(input())).toBe(t.memory);
      // The GM erased memory (or undid a reveal): the saved mask still holds it until Atlas saves.
      expect(t.follower.read(input({ edits: 1 }))).toBeNull();
      t.tick(EXPLORED_SETTLE_MS - 100);
      expect(t.follower.read(input({ edits: 1, mask: 'mask-old' }))).toBeNull();
      t.tick(200);
      expect(t.follower.read(input({ edits: 1, mask: 'mask-new' }))).toBeNull();
      expect(t.decoded).toEqual(['mask-a', 'mask-new']);
      // Another map: the same.
      t.resolvers[1]!(t.memory);
      await Promise.resolve();
      expect(t.follower.read(input({ edits: 1, mask: 'mask-new', mapPath: 'other' }))).toBeNull();
    });

    it('shows nothing where the scene keeps no memory or the engine\'s memory is not in, and starts over when it is', async () => {
      const t = setup();
      t.follower.read(input());
      t.tick(EXPLORED_SETTLE_MS + 30);
      expect(t.follower.read(input({ keeps: false }))).toBeNull();
      expect(t.follower.read(input({ isMemory: false }))).toBeNull();
      expect(t.decoded).toEqual([]);
      t.follower.read(input());
      t.resolvers[0]!(t.memory);
      await Promise.resolve();
      expect(t.follower.read(input())).toBe(t.memory);
      expect(t.follower.read(input({ isMemory: false }))).toBeNull();
      // Back in: decoded anew, not what was held before.
      expect(t.follower.read(input())).toBeNull();
      expect(t.decoded).toEqual(['mask-a', 'mask-a']);
    });

    it('shows nothing for a mask that cannot be decoded, a scene without one, or a mask that changed while decoding', async () => {
      const t = setup();
      t.follower.read(input());
      t.tick(EXPLORED_SETTLE_MS + 30);
      expect(t.follower.read(input({ mask: null }))).toBeNull();
      t.follower.read(input({ mask: 'one' }));
      t.follower.read(input({ mask: 'two' }));
      t.resolvers[0]!(t.memory); // the first answers late: not the current mask
      await Promise.resolve();
      expect(t.follower.read(input({ mask: 'two' }))).toBeNull();
      t.resolvers[1]!(image(1, 1, () => true));
      await Promise.resolve();
      expect(t.follower.read(input({ mask: 'two' }))).not.toBeNull();

      const failing = new ExploredFollower(() => undefined, () => 10_000, () => Promise.reject(new Error('bad png')));
      failing.read(input());
      failing.read(input({ edits: 0 }));
      await Promise.resolve();
      expect(failing.read(input())).toBeNull();
    });

    it('stops calling back when disposed', async () => {
      const t = setup();
      t.follower.read(input());
      t.follower.dispose();
      t.tick(EXPLORED_SETTLE_MS * 2);
      expect(t.changes()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('in what players are told', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const cellsShown = (visibility: PlayerVisibility): number => (visibility as Ready).darkness.shown.reduce((n, v) => n + v, 0);

    it('adds the places explored before, once the memory has settled and decoded, and only on the engine', async () => {
      let now = 1000;
      const memory = image(64, 61, () => true);
      const lit = litView({ explored: { mask: 'mask', memory: true }, now: () => now, decode: () => Promise.resolve(memory) });
      const api = stockLightingApi(lit.deps);
      const first = api.playerVisibility('view-a') as Ready;
      expect(first.showsExplored).toBe(false);
      now += EXPLORED_SETTLE_MS + 100;
      api.playerVisibility('view-a');
      await vi.advanceTimersByTimeAsync(0);
      const later = api.playerVisibility('view-a') as Ready;
      expect(later.showsExplored).toBe(true);
      // The whole map was explored: every cell shows now.
      expect(cellsShown(later)).toBe(later.darkness.shown.length);
      expect(cellsShown(later)).toBeGreaterThan(cellsShown(first));

      // The line-of-sight fallback has no memory, and shows none.
      const fallback = litView({ explored: { mask: 'mask', memory: false }, now: () => now, decode: () => Promise.resolve(memory) });
      const fallbackApi = stockLightingApi(fallback.deps);
      fallbackApi.playerVisibility('view-a');
      now += EXPLORED_SETTLE_MS + 100;
      await vi.advanceTimersByTimeAsync(0);
      expect((fallbackApi.playerVisibility('view-a') as Ready).showsExplored).toBe(false);
    });

    it('takes the memory away at once when the GM erases some, and tells a watcher when it is back', async () => {
      let now = 1000;
      const memory = image(64, 61, () => true);
      const lit = litView({ explored: { mask: 'mask', memory: true }, now: () => now, decode: () => Promise.resolve(memory) });
      const api = stockLightingApi(lit.deps);
      const told: string[] = [];
      api.watch('view-a', () => told.push('due'));
      api.playerVisibility('view-a');
      now += EXPLORED_SETTLE_MS + 100;
      api.playerVisibility('view-a');
      await vi.advanceTimersByTimeAsync(0);
      expect((api.playerVisibility('view-a') as Ready).showsExplored).toBe(true);
      told.length = 0;
      lit.scene.set({ exploredEdits: 1 } as never);
      expect((api.playerVisibility('view-a') as Ready).showsExplored).toBe(false);
      expect(told.length).toBeGreaterThan(0);
      now += EXPLORED_SETTLE_MS + 100;
      vi.advanceTimersByTime(EXPLORED_SETTLE_MS + 100);
      expect(told.length).toBeGreaterThan(1);
    });

    it('shows no memory where the scene keeps none, or while the engine\'s memory is not in', () => {
      const memory = image(64, 61, () => true);
      const decode = () => Promise.resolve(memory);
      const now = () => 1_000_000;
      for (const explored of [{ mask: 'mask', memory: true, keeps: false }, { mask: 'mask', memory: { ready: false } }, { mask: 'mask', memory: { contextLost: true } }]) {
        const api = stockLightingApi(litView({ explored, now, decode }).deps);
        api.playerVisibility('view-a');
        expect((api.playerVisibility('view-a') as Ready).showsExplored).toBe(false);
      }
      expect(REAL.map.width).toBeGreaterThan(0);
    });
  });
});
