/**
 * The darkness of a lit scene as players receive it: one fog paint lasso over every dark
 * cell, so both players' clients draw it as they draw the GM's fog, opaque and above
 * everything. Its outline follows the cell edges, every loop of it oriented alike (dark on
 * the same side), and the loops are joined into one ring by zero-width bridges, each walked
 * there and back: under nonzero (and even-odd) filling only the dark cells are filled.
 */
import type { WorldBounds } from './FogCoverage';
import type { DarknessGrid } from './lightingFrame';
import { SCENE_LIMITS } from './sceneLimits';
import type { PlayerFogOp, ScenePoint } from './sceneTypes';

/** The darkness's fog id; GM fog ids are random, never this. */
export const DARKNESS_FOG_ID = 'atlas-lighting-darkness';
/** After every GM fog operation (their order is a timestamp), so nothing the GM erased reveals it again. */
export const DARKNESS_ORDER = Number.MAX_SAFE_INTEGER;

export interface Darkness {
  /** The darkness's fog operation, by id; empty when nothing is dark. */
  fog: Readonly<Record<string, PlayerFogOp>>;
  /** The dark area as rectangles, for the GM's coverage of what players cannot see (`FogCoverage`). */
  covered: readonly WorldBounds[];
}

export const NO_DARKNESS: Darkness = { fog: {}, covered: [] };

export function darknessOf(raster: DarknessGrid): Darkness {
  let grid = raster;
  for (;;) {
    if (!grid.dark.includes(1)) return NO_DARKNESS;
    const points = outline(grid);
    // A finer outline than a fog operation may carry is drawn coarser, never left out.
    if (points.length > SCENE_LIMITS.points) {
      grid = coarser(grid);
      continue;
    }
    const op: PlayerFogOp = { type: 'lasso', erase: false, order: DARKNESS_ORDER, points };
    return { fog: { [DARKNESS_FOG_ID]: op }, covered: rectangles(grid) };
  }
}

/** Half as many cells each way; a cell is dark when any of the cells it holds is. */
function coarser(grid: DarknessGrid): DarknessGrid {
  const cols = Math.ceil(grid.cols / 2);
  const rows = Math.ceil(grid.rows / 2);
  const dark = new Uint8Array(cols * rows);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.dark[row * grid.cols + col]) dark[(row >> 1) * cols + (col >> 1)] = 1;
    }
  }
  return { cols, rows, cellSize: grid.cellSize * 2, map: grid.map, dark };
}

/** The boundary of the dark cells as one ring of world points, clipped to the map. */
function outline(grid: DarknessGrid): ScenePoint[] {
  const loops = traceLoops(grid);
  const [first, ...others] = loops;
  if (!first) return [];
  const ring = [...first, first[0]!];
  for (const loop of others) ring.push(...loop, loop[0]!, first[0]!);
  const toWorld = ([col, row]: Vertex): ScenePoint => ({
    x: Math.min(col * grid.cellSize, grid.map.width),
    y: Math.min(row * grid.cellSize, grid.map.height),
  });
  return ring.map(toWorld);
}

type Vertex = readonly [col: number, row: number];

/**
 * Every boundary edge between a dark cell and one that is not (or the map's edge), walked
 * clockwise around the dark cells, chained into closed loops of their corners only.
 */
function traceLoops({ cols, rows, dark }: DarknessGrid): Vertex[][] {
  const width = cols + 1;
  const isDark = (col: number, row: number): boolean => col >= 0 && row >= 0 && col < cols && row < rows && dark[row * cols + col] === 1;
  // Each corner starts at most two edges (where two dark cells touch diagonally).
  const next = new Int32Array(width * (rows + 1) * 2).fill(-1);
  const add = (fromCol: number, fromRow: number, toCol: number, toRow: number): void => {
    const slot = (fromRow * width + fromCol) * 2;
    next[next[slot] === -1 ? slot : slot + 1] = toRow * width + toCol;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!isDark(col, row)) continue;
      if (!isDark(col, row - 1)) add(col, row, col + 1, row);
      if (!isDark(col + 1, row)) add(col + 1, row, col + 1, row + 1);
      if (!isDark(col, row + 1)) add(col + 1, row + 1, col, row + 1);
      if (!isDark(col - 1, row)) add(col, row + 1, col, row);
    }
  }
  const take = (vertex: number): number => {
    const slot = vertex * 2;
    const second = next[slot + 1]!;
    if (second !== -1) {
      next[slot + 1] = -1;
      return second;
    }
    const first = next[slot]!;
    next[slot] = -1;
    return first;
  };
  const loops: Vertex[][] = [];
  for (let start = 0; start < width * (rows + 1); start++) {
    while (next[start * 2] !== -1 || next[start * 2 + 1] !== -1) {
      const walk: number[] = [start];
      for (let at = take(start); at !== start; at = take(at)) walk.push(at);
      loops.push(corners(walk.map((vertex): Vertex => [vertex % width, Math.floor(vertex / width)])));
    }
  }
  return loops;
}

/** The loop without the points where it runs straight on. */
function corners(loop: readonly Vertex[]): Vertex[] {
  return loop.filter((point, index) => {
    const before = loop[(index + loop.length - 1) % loop.length]!;
    const after = loop[(index + 1) % loop.length]!;
    return (point[0] - before[0]) * (after[1] - point[1]) !== (point[1] - before[1]) * (after[0] - point[0]);
  });
}

/** The dark cells as rectangles: runs of each row, joined with the same run of the rows below. */
function rectangles({ cols, rows, cellSize, map, dark }: DarknessGrid): WorldBounds[] {
  const done: WorldBounds[] = [];
  let open = new Map<string, WorldBounds>();
  for (let row = 0; row <= rows; row++) {
    const still = new Map<string, WorldBounds>();
    for (let col = 0; row < rows && col < cols; col++) {
      if (!dark[row * cols + col]) continue;
      const from = col;
      while (col + 1 < cols && dark[row * cols + col + 1]) col++;
      const key = `${from}:${col}`;
      const top = row * cellSize;
      const bottom = Math.min((row + 1) * cellSize, map.height);
      const x = from * cellSize;
      const rect = open.get(key) ?? { x, y: top, width: Math.min((col + 1) * cellSize, map.width) - x, height: 0 };
      rect.height = bottom - rect.y;
      still.set(key, rect);
    }
    for (const [key, rect] of open) if (!still.has(key)) done.push(rect);
    open = still;
  }
  return done;
}
