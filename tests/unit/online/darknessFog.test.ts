import { describe, expect, it } from 'vitest';
import { DARKNESS_FOG_ID, DARKNESS_ORDER, NO_DARKNESS, darknessOf } from '../../../src/app/online/scene/darknessFog';
import type { DarknessGrid as DarknessRaster } from '../../../src/app/online/scene/lightingFrame';
import { SCENE_LIMITS } from '../../../src/app/online/scene/sceneLimits';
import type { PlayerFogOp, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { isFogRecords } from '../../../src/app/online/scene/sceneValidation';
import { insideByNonzero } from './sceneFixtures';

function raster(rows: string[], cellSize = 8, map = { width: rows[0]!.length * cellSize, height: rows.length * cellSize }): DarknessRaster {
  const cols = rows[0]!.length;
  const dark = new Uint8Array(cols * rows.length);
  rows.forEach((row, r) => [...row].forEach((cell, c) => { dark[r * cols + c] = cell === '#' ? 1 : 0; }));
  return { cols, rows: rows.length, cellSize, map, dark };
}

/** A seeded pseudo-random raster: rooms, pillars and diagonal touches all come up. */
function randomRaster(cols: number, rows: number, seed: number): DarknessRaster {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const dark = new Uint8Array(cols * rows).map(() => (next() < 0.5 ? 1 : 0));
  return { cols, rows, cellSize: 8, map: { width: cols * 8, height: rows * 8 }, dark };
}

function ringOf(op: PlayerFogOp | undefined): ScenePoint[] {
  if (op?.type !== 'lasso') throw new Error('expected one lasso');
  return op.points;
}

/** Every cell centre: inside the lasso exactly where the cell is dark. */
function expectRingMatches(grid: DarknessRaster, ring: readonly ScenePoint[], cellSize = grid.cellSize): void {
  const mismatches: string[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const point = { x: (col + 0.5) * cellSize, y: (row + 0.5) * cellSize };
      if (insideByNonzero(ring, point) !== (grid.dark[row * grid.cols + col] === 1)) mismatches.push(`${col},${row}`);
    }
  }
  expect(mismatches).toEqual([]);
}

describe('darkness as fog', () => {
  it('sends nothing when nothing is dark', () => {
    expect(darknessOf(raster(['...', '...']))).toBe(NO_DARKNESS);
  });

  it('covers the whole map with four corners when everything is dark', () => {
    const darkness = darknessOf(raster(['###', '###'], 10, { width: 25, height: 20 }));
    expect(ringOf(darkness.fog[DARKNESS_FOG_ID])).toEqual([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }]);
    expect(darkness.covered).toEqual([{ x: 0, y: 0, width: 25, height: 20 }]);
  });

  it('is one paint lasso after every GM fog operation, valid on the wire', () => {
    const { fog } = darknessOf(raster(['#..#', '#..#', '####']));
    expect(Object.keys(fog)).toEqual([DARKNESS_FOG_ID]);
    expect(fog[DARKNESS_FOG_ID]).toMatchObject({ type: 'lasso', erase: false, order: DARKNESS_ORDER });
    expect(isFogRecords(fog)).toBe(true);
  });

  it('fills exactly the dark cells: holes, islands in holes and cells touching at a corner', () => {
    const grid = raster([
      '#########',
      '#.......#',
      '#..###..#',
      '#..#.#..#',
      '#..###..#',
      '#.....#.#',
      '#......##',
      '##.#....#',
      '#.#.#####',
    ]);
    expectRingMatches(grid, ringOf(darknessOf(grid).fog[DARKNESS_FOG_ID]));
  });

  it('fills exactly the dark cells of random rasters', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const grid = randomRaster(23, 17, seed);
      expectRingMatches(grid, ringOf(darknessOf(grid).fog[DARKNESS_FOG_ID]));
    }
  });

  it('covers for the GM exactly the dark cells, as rectangles', () => {
    const grid = randomRaster(30, 20, 7);
    const { covered } = darknessOf(grid);
    // Ruling L-POS: the rectangles only describe the dark area; checked here by the cells' centres.
    const inside = (x: number, y: number): boolean => covered.some((rect) => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height);
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        expect(inside(col * 8 + 4, row * 8 + 4), `${col},${row}`).toBe(grid.dark[row * grid.cols + col] === 1);
      }
    }
  });

  it('coarsens an outline with more points than a fog operation carries, darkening rather than revealing', () => {
    // A checkerboard: every cell is a corner.
    const cols = 120;
    const grid: DarknessRaster = {
      cols, rows: cols, cellSize: 8, map: { width: cols * 8, height: cols * 8 },
      dark: new Uint8Array(cols * cols).map((_, i) => ((i % cols) + Math.floor(i / cols)) % 2),
    };
    const ring = ringOf(darknessOf(grid).fog[DARKNESS_FOG_ID]);
    expect(ring.length).toBeLessThanOrEqual(SCENE_LIMITS.points);
    for (let i = 0; i < grid.dark.length; i++) {
      if (grid.dark[i] === 1) expect(insideByNonzero(ring, { x: ((i % cols) + 0.5) * 8, y: (Math.floor(i / cols) + 0.5) * 8 })).toBe(true);
    }
  });
});
