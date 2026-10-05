/**
 * Where the fog of war lies, coarsely, to decide what players may receive. Replays the fog operations like
 * `FogCanvasCompositor` (in order, erase clearing) onto one cell per 8 world pixels.
 *
 * `reveals` and `revealsSome` are the checks every projection asks (ruling F-POS). They are fail closed by
 * construction: the fog is replayed the other way round (`reveal` mode: paint fogs every cell it touches, erase clears
 * only cells it covers whole), so a cell left clear is proven revealed, and they answer from a summed-area table in O(1). `isCovered` (where fog surely
 * lies, `hide` mode) never decides what is sent; it is built only when asked.
 */
import { CLEAR, FOGGED, fillBrush, fillLasso, fillRect, type CellGrid, type RasterMode } from './fogRaster';
import { sortedByOrder, type MapSize, type PlayerFogOp, type ScenePoint } from './sceneTypes';

export const FOG_CELL_SIZE = 8;
/** Beyond this many cells the cell size doubles, so a huge fogged area stays cheap. */
export const MAX_FOG_CELLS = 4_000_000;
/** A brush scans about this many cells across per segment; bigger brushes coarsen the cells, which bounds the replay time. */
export const MAX_BRUSH_CELLS = 64;
/** The reveal raster reaches this many cells past the painted area (more for a brush's simplifying slack), so no cell paint touches is off its grid. */
const REVEAL_PAD_CELLS = 2;

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A positive check bound to one map: whether every part of `bounds` inside it is shown. */
export interface Shows {
  shows(bounds: WorldBounds): boolean;
}

/** A replayed raster and, for `reveal`, its summed-area table of fogged cells. */
interface Raster extends CellGrid {
  /** `(cols + 1) * (rows + 1)` running counts of fogged cells; unset for `hide`. */
  sums?: Uint32Array;
}

export class FogCoverage {
  static readonly EMPTY: FogCoverage = new FogCoverage([], null, FOG_CELL_SIZE, 0);

  private hidden: Raster | null = null;
  private readonly revealed: Raster | null;
  /** Some cell of the reveal raster is fogged; without one nothing in the scene can be under fog. */
  readonly hasFog: boolean;

  private constructor(private readonly shapes: readonly FogShape[], private readonly bounds: WorldBounds | null, readonly cellSize: number, pad: number) {
    this.revealed = bounds ? replay(shapes, bounds, cellSize, 'reveal', pad) : null;
    this.hasFog = this.revealed !== null && this.revealed.cells.includes(FOGGED);
  }

  /** From exactly the fog players receive, so what the GM withholds matches what players can see. */
  static fromPlayerFog(fog: Readonly<Record<string, PlayerFogOp>>): FogCoverage {
    return FogCoverage.fromShapes(sortedByOrder(fog, (op) => op.order).map(([, op]) => shapeOfPlayerOp(op)));
  }

  private static fromShapes(shapes: readonly FogShape[]): FogCoverage {
    const bounds = paintedBounds(shapes);
    if (!bounds) return FogCoverage.EMPTY;
    let cellSize = FOG_CELL_SIZE;
    // Huge brushes, paint or erase, coarsen the cells, which bounds the replay time whatever their points do.
    const widest = Math.max(0, ...shapes.map((shape) => (shape.type === 'brush' && Number.isFinite(shape.radius) ? shape.radius : 0)));
    while ((bounds.width / cellSize + 2) * (bounds.height / cellSize + 2) > MAX_FOG_CELLS || widest / cellSize > MAX_BRUSH_CELLS) cellSize *= 2;
    // A simplified brush may reach a sixteenth of its radius further (`fillBrush`); the padding holds that too.
    return new FogCoverage(shapes, bounds, cellSize, REVEAL_PAD_CELLS + Math.ceil(widest / 16 / cellSize));
  }

  /**
   * Whether no part of `bounds` inside the map can be under fog (ruling F-POS, for texts, drawings and pins, whose
   * content under fog is data): true only when every cell its in-map part touches is proven revealed, the partial
   * cells at the map's edges included. A zero-area item is judged by the cell under it.
   */
  reveals(bounds: WorldBounds, map: MapSize): boolean {
    const cells = this.inMapCells(bounds, map);
    return cells === true || (cells !== null && cells.fogged === 0);
  }

  /**
   * Whether some cell of `bounds` inside the map is proven revealed (ruling F-POS, for tokens: the player window draws
   * a token whose part shows, so a half-fogged token stays). Partial edge cells count as fogged unless revealed, and
   * space outside the map counts as fogged.
   */
  revealsSome(bounds: WorldBounds, map: MapSize): boolean {
    const cells = this.inMapCells(bounds, map);
    return cells === true || (cells !== null && cells.fogged < cells.total);
  }

  /**
   * The fog cells the in-map part of `bounds` touches: how many there are and how many may be fogged. True for a scene
   * without fog, which hides nothing, as the player window shows it. Null (hidden) on a fogged scene for an item
   * wholly outside the map or only touching it from outside, and for any item while the map's size is unknown: parts
   * outside the map never prove anything.
   */
  private inMapCells(bounds: WorldBounds, map: MapSize): { total: number; fogged: number } | true | null {
    const grid = this.revealed;
    if (!this.hasFog || !grid?.sums) return true;
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (!(map.width > 0 && map.height > 0) || ![bounds.x, bounds.y, right, bottom, map.width, map.height].every(Number.isFinite)) return null;
    if (right <= 0 || bottom <= 0 || bounds.x >= map.width || bounds.y >= map.height) return null;
    const size = grid.cellSize;
    const c0 = Math.floor((Math.max(bounds.x, 0) - grid.originX) / size);
    const r0 = Math.floor((Math.max(bounds.y, 0) - grid.originY) / size);
    const c1 = Math.max(c0, Math.ceil((Math.min(right, map.width) - grid.originX) / size) - 1);
    const r1 = Math.max(r0, Math.ceil((Math.min(bottom, map.height) - grid.originY) / size) - 1);
    const total = (c1 - c0 + 1) * (r1 - r0 + 1);
    // Cells off the grid lie past the padding around everything painted: no fog reaches them.
    const left = Math.max(0, c0);
    const top = Math.max(0, r0);
    const last = Math.min(grid.cols - 1, c1);
    const lastRow = Math.min(grid.rows - 1, r1);
    if (left > last || top > lastRow) return { total, fogged: 0 };
    const width = grid.cols + 1;
    const { sums } = grid;
    const fogged = sums[(lastRow + 1) * width + last + 1]! - sums[top * width + last + 1]! - sums[(lastRow + 1) * width + left]! + sums[top * width + left]!;
    return { total, fogged };
  }

  /** `reveals` bound to one map, as texts, drawings and lit scenes are checked. */
  within(map: MapSize): Shows {
    return { shows: (bounds) => this.reveals(bounds, map) };
  }

  /** True when every cell under `bounds` is surely fogged; anything reaching outside the fogged area is not covered. Never decides what is sent. */
  isCovered(bounds: WorldBounds): boolean {
    if (!this.bounds) return false;
    this.hidden ??= replay(this.shapes, this.bounds, this.cellSize, 'hide', 0);
    const grid = this.hidden;
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (![bounds.x, bounds.y, right, bottom].every(Number.isFinite)) return false;
    const c0 = Math.floor((bounds.x - grid.originX) / grid.cellSize);
    const r0 = Math.floor((bounds.y - grid.originY) / grid.cellSize);
    const c1 = Math.max(c0, Math.ceil((right - grid.originX) / grid.cellSize) - 1);
    const r1 = Math.max(r0, Math.ceil((bottom - grid.originY) / grid.cellSize) - 1);
    if (c0 < 0 || r0 < 0 || c1 >= grid.cols || r1 >= grid.rows) return false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (grid.cells[row * grid.cols + col] !== FOGGED) return false;
      }
    }
    return true;
  }
}

/** The shapes replayed in order onto a grid over `bounds` grown by `pad` cells; `reveal` also counts its fogged cells. */
function replay(shapes: readonly FogShape[], bounds: WorldBounds, cellSize: number, mode: RasterMode, pad: number): Raster {
  const reach = pad * cellSize;
  const originX = Math.floor((bounds.x - reach) / cellSize) * cellSize;
  const originY = Math.floor((bounds.y - reach) / cellSize) * cellSize;
  const cols = Math.ceil((bounds.x + bounds.width + reach - originX) / cellSize) + 1;
  const rows = Math.ceil((bounds.y + bounds.height + reach - originY) / cellSize) + 1;
  const grid: Raster = { cells: new Uint8Array(cols * rows), cols, rows, originX, originY, cellSize };
  for (const shape of shapes) {
    const value = shape.erase ? CLEAR : FOGGED;
    if (shape.type === 'rectangle') fillRect(grid, shape.x, shape.y, shape.width, shape.height, value, mode);
    else if (shape.type === 'brush') fillBrush(grid, shape.points, shape.radius, value, mode);
    else fillLasso(grid, shape.points, value, mode);
  }
  if (mode === 'reveal') grid.sums = summedArea(grid);
  return grid;
}

/** Running counts of fogged cells: entry (row, col) holds those above and left of it, so any block's count takes four reads. */
function summedArea(grid: CellGrid): Uint32Array {
  const width = grid.cols + 1;
  const sums = new Uint32Array(width * (grid.rows + 1));
  for (let row = 0; row < grid.rows; row++) {
    let line = 0;
    for (let col = 0; col < grid.cols; col++) {
      line += grid.cells[row * grid.cols + col] === FOGGED ? 1 : 0;
      sums[(row + 1) * width + col + 1] = sums[row * width + col + 1]! + line;
    }
  }
  return sums;
}

/** A fog operation reduced to what the raster needs, offsets applied. */
type FogShape =
  | { type: 'rectangle'; erase: boolean; x: number; y: number; width: number; height: number }
  | { type: 'brush'; erase: boolean; points: ScenePoint[]; radius: number }
  | { type: 'lasso'; erase: boolean; points: ScenePoint[] };

function shapeOfPlayerOp(op: PlayerFogOp): FogShape {
  if (op.type === 'rectangle') return { type: 'rectangle', erase: op.erase, x: op.x, y: op.y, width: op.width, height: op.height };
  if (op.type === 'brush') return { type: 'brush', erase: op.erase, points: [...op.points], radius: op.radius };
  return { type: 'lasso', erase: op.erase, points: [...op.points] };
}

/**
 * The area the painting shapes reach; erasing outside it changes nothing.
 * One far painted outlier stretches it and coarsens the cells (conservative:
 * coarser reveal cells send fewer objects, never more).
 */
function paintedBounds(shapes: readonly FogShape[]): WorldBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const reach = (x: number, y: number, pad: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    left = Math.min(left, x - pad);
    right = Math.max(right, x + pad);
    top = Math.min(top, y - pad);
    bottom = Math.max(bottom, y + pad);
  };
  for (const shape of shapes) {
    if (shape.erase) continue;
    if (shape.type === 'rectangle') {
      reach(shape.x, shape.y, 0);
      reach(shape.x + shape.width, shape.y + shape.height, 0);
    } else {
      const pad = shape.type === 'brush' ? Math.max(0, shape.radius) : 0;
      for (const point of shape.points) reach(point.x, point.y, pad);
    }
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
