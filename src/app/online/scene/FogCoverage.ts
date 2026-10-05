/**
 * Where the fog of war lies, coarsely, to decide what players may receive.
 * Replays the fog operations like `FogCanvasCompositor` (in order, erase
 * clearing) onto one cell per 8 world pixels. It is conservative: paint fogs
 * only cells it covers whole and erase clears every cell it touches, so an
 * object counts as covered only when no part of it can show.
 */
import { CLEAR, FOGGED, fillBrush, fillLasso, fillRect, type CellGrid } from './fogRaster';
import { sortedByOrder, type PlayerFogOp, type ScenePoint } from './sceneTypes';

export const FOG_CELL_SIZE = 8;
/** Beyond this many cells the cell size doubles, so a huge fogged area stays cheap. */
export const MAX_FOG_CELLS = 4_000_000;
/** A brush scans about this many cells across per segment; bigger brushes coarsen the cells, which bounds the replay time. */
export const MAX_BRUSH_CELLS = 64;

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FogCoverage {
  static readonly EMPTY: FogCoverage = new FogCoverage(new Uint8Array(0), 0, 0, 0, 0, FOG_CELL_SIZE);

  private constructor(
    private readonly cells: Uint8Array,
    private readonly cols: number,
    private readonly rows: number,
    private readonly originX: number,
    private readonly originY: number,
    readonly cellSize: number,
  ) {}

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
    const originX = Math.floor(bounds.x / cellSize) * cellSize;
    const originY = Math.floor(bounds.y / cellSize) * cellSize;
    const cols = Math.ceil((bounds.x + bounds.width - originX) / cellSize) + 1;
    const rows = Math.ceil((bounds.y + bounds.height - originY) / cellSize) + 1;
    const coverage = new FogCoverage(new Uint8Array(cols * rows), cols, rows, originX, originY, cellSize);
    for (const shape of shapes) coverage.apply(shape);
    return coverage;
  }

  /** True when every cell under `bounds` is fogged; anything reaching outside the fogged area is not covered. */
  isCovered(bounds: WorldBounds): boolean {
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (this.cells.length === 0 || ![bounds.x, bounds.y, right, bottom].every(Number.isFinite)) return false;
    const c0 = this.col(bounds.x);
    const r0 = this.row(bounds.y);
    const c1 = Math.max(c0, Math.ceil((right - this.originX) / this.cellSize) - 1);
    const r1 = Math.max(r0, Math.ceil((bottom - this.originY) / this.cellSize) - 1);
    if (c0 < 0 || r0 < 0 || c1 >= this.cols || r1 >= this.rows) return false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.cells[row * this.cols + col] !== FOGGED) return false;
      }
    }
    return true;
  }

  private col(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  private row(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  private get grid(): CellGrid {
    return { cells: this.cells, cols: this.cols, rows: this.rows, originX: this.originX, originY: this.originY, cellSize: this.cellSize };
  }

  private apply(shape: FogShape): void {
    const value = shape.erase ? CLEAR : FOGGED;
    if (shape.type === 'rectangle') fillRect(this.grid, shape.x, shape.y, shape.width, shape.height, value);
    else if (shape.type === 'brush') fillBrush(this.grid, shape.points, shape.radius, value);
    else fillLasso(this.grid, shape.points, value);
  }
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
 * more objects are sent, never fewer).
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
