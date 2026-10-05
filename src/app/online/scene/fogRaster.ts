/**
 * Pure rasterising of one fog operation onto a coarse cell grid, conservative by construction in one of two ways.
 * `hide` (where fog surely lies): paint fogs only cells the shape covers whole, erase clears every cell it touches.
 * `reveal` (where nothing can be fogged, ruling F-POS): paint fogs every cell it touches, erase clears only cells it
 * covers whole, so a cell left clear is proven revealed.
 */
import { insideSpans } from '@atlas-vtt/shared/draw';
import type { ScenePoint } from './sceneTypes';
import { distanceSqToSegment, simplifyPoints } from './simplifyPoints';

export const FOGGED = 1;
export const CLEAR = 0;

/** Which way a raster errs: `hide` toward clear cells, `reveal` toward fogged ones. */
export type RasterMode = 'hide' | 'reveal';

/** Whether a shape changes only the cells it covers whole (else every cell it touches). */
const coversWhole = (value: number, mode: RasterMode): boolean => (value === FOGGED) === (mode === 'hide');

/** A bitmap of cells at `originX`, `originY`, each `cellSize` world pixels square. */
export interface CellGrid {
  cells: Uint8Array;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cellSize: number;
}

function colOf(g: CellGrid, x: number): number {
  return Math.floor((x - g.originX) / g.cellSize);
}

function rowOf(g: CellGrid, y: number): number {
  return Math.floor((y - g.originY) / g.cellSize);
}

function forCells(g: CellGrid, c0: number, c1: number, r0: number, r1: number, visit: (index: number, left: number, top: number) => void): void {
  const lastRow = Math.min(g.rows - 1, r1);
  const lastCol = Math.min(g.cols - 1, c1);
  for (let row = Math.max(0, r0); row <= lastRow; row++) {
    for (let col = Math.max(0, c0); col <= lastCol; col++) {
      visit(row * g.cols + col, g.originX + col * g.cellSize, g.originY + row * g.cellSize);
    }
  }
}

/** `hide`: paint fogs the cells the rectangle covers whole, erase clears every cell it overlaps; `reveal` the other way round. */
export function fillRect(g: CellGrid, x: number, y: number, width: number, height: number, value: number, mode: RasterMode = 'hide'): void {
  const left = Math.min(x, x + width);
  const right = Math.max(x, x + width);
  const top = Math.min(y, y + height);
  const bottom = Math.max(y, y + height);
  if (![left, right, top, bottom].every(Number.isFinite)) return;
  const size = g.cellSize;
  const whole = coversWhole(value, mode);
  const c0 = whole ? Math.ceil((left - g.originX) / size) : colOf(g, left);
  const c1 = whole ? Math.floor((right - g.originX) / size) - 1 : Math.ceil((right - g.originX) / size) - 1;
  const r0 = whole ? Math.ceil((top - g.originY) / size) : rowOf(g, top);
  const r1 = whole ? Math.floor((bottom - g.originY) / size) - 1 : Math.ceil((bottom - g.originY) / size) - 1;
  forCells(g, c0, c1, r0, r1, (index) => { g.cells[index] = value; });
}

/**
 * Round-capped segments. A whole cover changes a cell whose four corners lie within the radius of one segment; a
 * touch changes a cell whose centre lies within the radius plus half a cell diagonal of any segment. `hide`: paint
 * covers whole, erase touches; `reveal` the other way round.
 */
export function fillBrush(g: CellGrid, rawPoints: ScenePoint[], brushRadius: number, value: number, mode: RasterMode = 'hide'): void {
  if (!(brushRadius > 0)) return;
  // Simplifying moves the stroke by at most `tolerance`; paint gives that back and erase adds it, so the result stays conservative.
  // The tolerance grows with the radius, which keeps the segments (each scanning about its own reach) proportional to the area painted.
  const tolerance = brushRadius / 16;
  const points = simplifyPoints(rawPoints, tolerance);
  const first = points[0];
  if (!first) return;
  const size = g.cellSize;
  const slack = points.length < rawPoints.length ? tolerance : 0;
  const whole = coversWhole(value, mode);
  const radius = whole ? brushRadius - slack : brushRadius + slack;
  const radiusSq = radius * radius;
  const reach = radius + (size * Math.SQRT2) / 2;
  const reachSq = reach * reach;
  const segments: Array<[ScenePoint, ScenePoint]> = points.length === 1
    ? [[first, first]]
    : points.slice(1).map((point, index): [ScenePoint, ScenePoint] => [points[index]!, point]);
  for (const [a, b] of segments) {
    // A capsule is convex: when it holds the bitmap's corners it holds every cell, so a huge brush costs O(1) per segment.
    if (whole ? capsuleHoldsBitmap(g, a, b, radiusSq, 0) : capsuleHoldsBitmap(g, a, b, reachSq, size / 2)) {
      g.cells.fill(value);
      return;
    }
    // Row by row, only the cells near the segment: a long diagonal stroke never scans its whole bounding box.
    const lastRow = Math.min(g.rows - 1, rowOf(g, Math.max(a.y, b.y) + reach));
    for (let row = Math.max(0, rowOf(g, Math.min(a.y, b.y) - reach)); row <= lastRow; row++) {
      const rowTop = g.originY + row * size;
      const span = segmentXSpan(a, b, rowTop - reach, rowTop + size + reach);
      if (!span) continue;
      forCells(g, colOf(g, span[0] - reach), colOf(g, span[1] + reach), row, row, (index, left, top) => {
        if (whole) {
          if (cellInsideCapsule(left, top, size, a, b, radiusSq)) g.cells[index] = value;
        } else if (distanceSqToSegment({ x: left + size / 2, y: top + size / 2 }, a, b) <= reachSq) {
          g.cells[index] = value;
        }
      });
    }
  }
}

/** True when all four corners of the bitmap, inset by `inset`, lie within `radiusSq` of segment ab. */
function capsuleHoldsBitmap(g: CellGrid, a: ScenePoint, b: ScenePoint, radiusSq: number, inset: number): boolean {
  const left = g.originX + inset;
  const top = g.originY + inset;
  const right = g.originX + g.cols * g.cellSize - inset;
  const bottom = g.originY + g.rows * g.cellSize - inset;
  return [[left, top], [right, top], [left, bottom], [right, bottom]]
    .every(([x, y]) => distanceSqToSegment({ x: x!, y: y! }, a, b) <= radiusSq);
}

/**
 * Cells whose centre lies inside the polygon (nonzero winding, as the canvas fills it). A whole cover leaves out the
 * cells an edge crosses, a touch adds them: `hide` paint covers whole and erase touches, `reveal` the other way round.
 */
export function fillLasso(g: CellGrid, points: ScenePoint[], value: number, mode: RasterMode = 'hide'): void {
  if (points.length < 3) return;
  const size = g.cellSize;
  const whole = coversWhole(value, mode);
  const crossed = new Set<number>();
  let top = Infinity;
  let bottom = -Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    top = Math.min(top, a.y);
    bottom = Math.max(bottom, a.y);
    // Only the part of the edge near the bitmap is walked, so far-away points cost nothing; winding below still sees the whole edge.
    const clipped = clipToRect(
      (a.x - g.originX) / size, (a.y - g.originY) / size,
      (b.x - g.originX) / size, (b.y - g.originY) / size,
      -1, -1, g.cols + 1, g.rows + 1,
    );
    if (!clipped) continue;
    traverseCells(clipped[0], clipped[1], clipped[2], clipped[3], (col, row) => {
      if (col >= 0 && row >= 0 && col < g.cols && row < g.rows) crossed.add(row * g.cols + col);
    });
  }
  const lastRow = Math.min(g.rows - 1, rowOf(g, bottom));
  for (let row = Math.max(0, rowOf(g, top)); row <= lastRow; row++) {
    const y = g.originY + (row + 0.5) * size;
    for (const [from, to] of insideSpans(points, y)) {
      const c0 = Math.max(0, Math.ceil((from - g.originX) / size - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor((to - g.originX) / size - 0.5));
      for (let col = c0; col <= c1; col++) {
        const index = row * g.cols + col;
        if (!whole || !crossed.has(index)) g.cells[index] = value;
      }
    }
  }
  if (!whole) for (const index of crossed) g.cells[index] = value;
}

/** The x range of segment ab where its y lies within [low, high]; null when it never does. */
function segmentXSpan(a: ScenePoint, b: ScenePoint, low: number, high: number): [number, number] | null {
  if (a.y === b.y) return a.y >= low && a.y <= high ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : null;
  const tLow = (low - a.y) / (b.y - a.y);
  const tHigh = (high - a.y) / (b.y - a.y);
  const t0 = Math.max(0, Math.min(tLow, tHigh));
  const t1 = Math.min(1, Math.max(tLow, tHigh));
  if (t0 > t1) return null;
  const x0 = a.x + (b.x - a.x) * t0;
  const x1 = a.x + (b.x - a.x) * t1;
  return [Math.min(x0, x1), Math.max(x0, x1)];
}

function cellInsideCapsule(left: number, top: number, size: number, a: ScenePoint, b: ScenePoint, radiusSq: number): boolean {
  return distanceSqToSegment({ x: left, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left, y: top + size }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top + size }, a, b) <= radiusSq;
}

/** Liang-Barsky: the part of segment (ax, ay)-(bx, by) inside the rectangle, or null when none is. */
function clipToRect(
  ax: number, ay: number, bx: number, by: number, minX: number, minY: number, maxX: number, maxY: number,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const sides: Array<[number, number]> = [[-dx, ax - minX], [dx, maxX - ax], [-dy, ay - minY], [dy, maxY - ay]];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Every cell a segment passes through, in cell coordinates (Amanatides and Woo). */
function traverseCells(ax: number, ay: number, bx: number, by: number, visit: (col: number, row: number) => void): void {
  let col = Math.floor(ax);
  let row = Math.floor(ay);
  const dx = bx - ax;
  const dy = by - ay;
  const stepCol = dx > 0 ? 1 : -1;
  const stepRow = dy > 0 ? 1 : -1;
  const deltaCol = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaRow = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextCol = dx === 0 ? Infinity : (dx > 0 ? col + 1 - ax : ax - col) * deltaCol;
  let nextRow = dy === 0 ? Infinity : (dy > 0 ? row + 1 - ay : ay - row) * deltaRow;
  visit(col, row);
  for (let steps = Math.abs(Math.floor(bx) - col) + Math.abs(Math.floor(by) - row); steps > 0; steps--) {
    if (nextCol < nextRow) {
      col += stepCol;
      nextCol += deltaCol;
    } else {
      row += stepRow;
      nextRow += deltaRow;
    }
    visit(col, row);
  }
}

