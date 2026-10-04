/**
 * What the join page's map view takes from the preview: grid lines and fog shapes, in world coordinates.
 */
import { axialToPixel, createHexLayout, hexVertices, isHexGridType, pixelToAxial } from '@atlas-vtt/shared/grid';
import { sortedByOrder, type PlayerFogOp, type PlayerGrid, type ScenePoint } from '../scene/sceneTypes';
import type { PreviewRect } from './previewLayout';

/** Beyond this many lines or hexes the grid is too fine to be worth drawing. */
export const MAX_GRID_LINES = 2000;
export const MAX_GRID_HEXES = 5000;

/** How many lines or hexes a grid may have before it is skipped. */
export interface GridLimits {
  lines: number;
  hexes: number;
}

const DEFAULT_LIMITS: GridLimits = { lines: MAX_GRID_LINES, hexes: MAX_GRID_HEXES };
const DEFAULT_GRID_COLOR = '#808080';

export interface GridLines {
  segments: Array<[ScenePoint, ScenePoint]>;
  hexes: ScenePoint[][];
  color: string;
  alpha: number;
  width: number;
  /** Dash pattern in screen pixels; empty for solid lines. */
  dash: number[];
}

export type FogShape =
  | { kind: 'stroke'; erase: boolean; points: ScenePoint[]; width: number }
  | { kind: 'polygon'; erase: boolean; points: ScenePoint[] }
  | { kind: 'rect'; erase: boolean; x: number; y: number; width: number; height: number };

function dashFor(lineType: PlayerGrid['lineType']): number[] {
  if (lineType === 'dashed') return [6, 4];
  if (lineType === 'dotted') return [1, 3];
  return [];
}

export function gridLines(grid: PlayerGrid, area: PreviewRect, limits: GridLimits = DEFAULT_LIMITS): GridLines | null {
  const style = { color: grid.color ?? DEFAULT_GRID_COLOR, alpha: grid.opacity, width: grid.lineWidth, dash: dashFor(grid.lineType) };
  if (isHexGridType(grid.type)) {
    const hexes = hexOutlines(grid, area, limits.hexes);
    return hexes ? { segments: [], hexes, ...style } : null;
  }
  const segments = squareLines(grid, area, limits.lines);
  return segments ? { segments, hexes: [], ...style } : null;
}

function squareLines(grid: PlayerGrid, area: PreviewRect, maxLines: number): Array<[ScenePoint, ScenePoint]> | null {
  if (Math.floor(area.width / grid.size) + Math.floor(area.height / grid.size) + 2 > maxLines) return null;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const first = (start: number, offset: number): number => offset + Math.ceil((start - offset) / grid.size) * grid.size;
  const segments: Array<[ScenePoint, ScenePoint]> = [];
  for (let x = first(area.x, grid.offsetX); x <= right; x += grid.size) segments.push([{ x, y: area.y }, { x, y: bottom }]);
  for (let y = first(area.y, grid.offsetY); y <= bottom; y += grid.size) segments.push([{ x: area.x, y }, { x: right, y }]);
  return segments;
}

function hexOutlines(grid: PlayerGrid, area: PreviewRect, maxHexes: number): ScenePoint[][] | null {
  if (grid.type === 'square') return null;
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const corners = [
    { x: area.x, y: area.y }, { x: right, y: area.y }, { x: area.x, y: bottom }, { x: right, y: bottom },
  ].map((point) => pixelToAxial(layout, point));
  const qMin = Math.min(...corners.map((hex) => hex.q)) - 1;
  const qMax = Math.max(...corners.map((hex) => hex.q)) + 1;
  const rMin = Math.min(...corners.map((hex) => hex.r)) - 1;
  const rMax = Math.max(...corners.map((hex) => hex.r)) + 1;
  if ((qMax - qMin + 1) * (rMax - rMin + 1) > maxHexes * 4) return null;
  const reach = grid.size;
  const hexes: ScenePoint[][] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const center = axialToPixel(layout, { q, r });
      if (center.x < area.x - reach || center.x > right + reach || center.y < area.y - reach || center.y > bottom + reach) continue;
      hexes.push(hexVertices(layout, center));
      if (hexes.length > maxHexes) return null;
    }
  }
  return hexes;
}

/** Fog operations in replay order; brushes become round strokes twice their radius wide. */
export function fogShapes(fog: Readonly<Record<string, PlayerFogOp>>): FogShape[] {
  return sortedByOrder(fog, (op) => op.order).map(([, op]): FogShape => {
    if (op.type === 'brush') return { kind: 'stroke', erase: op.erase, points: op.points, width: op.radius * 2 };
    if (op.type === 'lasso') return { kind: 'polygon', erase: op.erase, points: op.points };
    return { kind: 'rect', erase: op.erase, x: op.x, y: op.y, width: op.width, height: op.height };
  });
}
