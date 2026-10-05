/**
 * Atlas's grid: square lines or hex outlines over the visible part of the map (Atlas
 * clips its grid to the map), dashed or dotted by line type, and cell numbers when the
 * GM shows them and they are large enough to read, numbered as `GridSystem` numbers them.
 */
import { createHexLayout, isHexGridType } from '@atlas-vtt/shared/grid';
import {
  cellNumberAnchor, cellNumberFontSize, numberCells, type CellLattice, type CellNumberStyle, type NumberedCell,
} from '@atlas-vtt/shared/grid';
import { hexLattice } from '@atlas-vtt/shared/grid';
import { squareLattice } from '@atlas-vtt/shared/grid';
import { gridLines, type GridLimits, type GridLines } from '../../preview/previewShapes';
import { playerCellNumbers } from '../../scene/playerCellNumbers';
import type { PlayerGrid, PlayerMap } from '../../scene/sceneTypes';
import { intersection, type WorldRect } from '../camera';
import type { TextStyle, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

const DEFAULT_NUMBER_COLOR = '#ffffff';
/**
 * Numbers smaller than this on screen (CSS pixels) hide until zoomed in, as `CellNumberLabels` hides
 * them; its own copy is private, so upstream's file stays as written (`sharedLayout.test.ts` checks both).
 */
export const MIN_CELL_NUMBER_SCREEN_SIZE = 7;
/** Beyond this many cells on the map, numbering them costs more than they are worth. */
export const MAX_NUMBERED_CELLS = 100_000;
/** The view only builds what is on screen, so its caps are far above the preview's. */
const VIEW_LIMITS: GridLimits = { lines: 100_000, hexes: MAX_NUMBERED_CELLS };

interface Anchored {
  x: number;
  y: number;
  label: string;
}

interface Numbered {
  grid: PlayerGrid;
  width: number;
  height: number;
  style: CellNumberStyle | null;
  /** Where each number sits, ordered by y so the visible rows are found by bisection. */
  anchors: Anchored[];
}

interface CachedLines {
  grid: PlayerGrid;
  width: number;
  height: number;
  area: WorldRect;
  lines: GridLines | null;
}

/**
 * The area the lines are built for: the visible area grown outwards to a grid of tiles
 * (a power of two at least as large as the view), so panning inside a tile reuses them.
 * Lines beyond the screen are clipped by the canvas.
 */
function snapArea(visible: WorldRect, map: PlayerMap): WorldRect | null {
  const tile = 2 ** Math.ceil(Math.log2(Math.max(1, visible.width, visible.height)));
  const x0 = Math.floor(visible.x / tile) * tile;
  const y0 = Math.floor(visible.y / tile) * tile;
  const wide = { x: x0, y: y0, width: Math.ceil((visible.x + visible.width) / tile) * tile - x0, height: Math.ceil((visible.y + visible.height) / tile) * tile - y0 };
  return map.width > 0 && map.height > 0 ? intersection(wide, { x: 0, y: 0, width: map.width, height: map.height }) : wide;
}

export function createGridLayer(): PlayerLayer {
  // Numbering every cell of the map, and building lines, run once per grid, map size and tile, not per frame.
  let numbered: Numbered | null = null;
  let cached: CachedLines | null = null;
  const numbersOf = (grid: PlayerGrid, map: PlayerMap): Numbered => {
    if (numbered === null || numbered.grid !== grid || numbered.width !== map.width || numbered.height !== map.height) {
      const style = playerCellNumbers(grid);
      numbered = { grid, width: map.width, height: map.height, style, anchors: style ? anchorsOf(grid, map, style) : [] };
    }
    return numbered;
  };
  const linesOf = (grid: PlayerGrid, map: PlayerMap, area: WorldRect): GridLines | null => {
    if (
      cached === null || cached.grid !== grid || cached.width !== map.width || cached.height !== map.height
      || cached.area.x !== area.x || cached.area.y !== area.y || cached.area.width !== area.width || cached.area.height !== area.height
    ) {
      cached = { grid, width: map.width, height: map.height, area, lines: gridLines(grid, area, VIEW_LIMITS) };
    }
    return cached.lines;
  };
  return {
    draw(surface, frame): void {
      const { grid, map } = frame.scene;
      if (!grid) return;
      // The visible area first (Atlas clips its grid to the map), then its tile.
      const area = map.width > 0 && map.height > 0
        ? intersection(frame.visible, { x: 0, y: 0, width: map.width, height: map.height })
        : frame.visible;
      if (!area) return;
      const tile = snapArea(frame.visible, map);
      if (tile) drawLines(surface, frame, linesOf(grid, map, tile));
      drawCellNumbers(surface, frame, grid, numbersOf(grid, map));
    },
  };
}

function drawLines(surface: ViewSurface, frame: LayerFrame, lines: GridLines | null): void {
  if (!lines) return;
  const style = {
    stroke: lines.color,
    alpha: lines.alpha,
    lineWidth: Math.max(lines.width, frame.pixel),
    // The dash pattern is in screen pixels, so dashes keep their look at any zoom.
    dash: lines.dash.map((length) => length / frame.zoom),
  };
  if (lines.segments.length > 0) surface.paths(lines.segments, false, style);
  if (lines.hexes.length > 0) surface.paths(lines.hexes, true, style);
}

/** The lattice `GridSystem` numbers for this grid. */
function latticeOf(grid: PlayerGrid): CellLattice {
  return isHexGridType(grid.type)
    ? hexLattice(createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY))
    : squareLattice(grid.size, grid.offsetX, grid.offsetY);
}

function anchorsOf(grid: PlayerGrid, map: PlayerMap, style: CellNumberStyle): Anchored[] {
  const lattice = latticeOf(grid);
  return cellNumbersOf(grid, map, lattice, style)
    .map((cell) => ({ ...cellNumberAnchor(lattice.size, cell.center), label: cell.label }))
    .sort((a, b) => a.y - b.y);
}

function cellNumbersOf(grid: PlayerGrid, map: PlayerMap, lattice: CellLattice, style: CellNumberStyle): NumberedCell[] {
  if (!(map.width > 0) || !(map.height > 0)) return [];
  const cellArea = isHexGridType(grid.type) ? grid.size * grid.size * 0.866 : grid.size * grid.size;
  if ((map.width * map.height) / cellArea > MAX_NUMBERED_CELLS) return [];
  return numberCells(lattice, { x: 0, y: 0, width: map.width, height: map.height }, style.format);
}

function drawCellNumbers(surface: ViewSurface, frame: LayerFrame, grid: PlayerGrid, { style, anchors }: Numbered): void {
  if (!style || anchors.length === 0) return;
  const size = cellNumberFontSize(grid.size);
  if (size * frame.zoom < MIN_CELL_NUMBER_SCREEN_SIZE) return;
  const textStyle: TextStyle = {
    font: `bold ${size}px Arial, sans-serif`,
    color: grid.color ?? DEFAULT_NUMBER_COLOR,
    align: 'center',
    alpha: style.opacity,
  };
  const { visible } = frame;
  const top = visible.y;
  const bottom = visible.y + visible.height;
  // Anchors are ordered by y: bisect to the first visible row, then stop after the last.
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (anchors[middle]!.y < top) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < anchors.length; index++) {
    const at = anchors[index]!;
    if (at.y > bottom) break;
    if (at.x < visible.x || at.x > visible.x + visible.width) continue;
    surface.text(at.label, at.x, at.y, textStyle);
  }
}
