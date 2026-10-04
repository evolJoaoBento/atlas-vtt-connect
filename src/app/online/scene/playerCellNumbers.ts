/**
 * How the player window numbers the grid's cells, read from what the GM sent: `cellNumbers` on
 * any grid, or from a GM before Atlas 0.5.1 the older `hexNumbers`, which numbered hex grids only.
 * Shared with the web page.
 */
import { type CellNumberStyle, DEFAULT_CELL_NUMBER_OPACITY, isHexGridType } from '@atlas-vtt/shared/grid';
import type { PlayerGrid } from './sceneTypes';

export function playerCellNumbers(grid: PlayerGrid): CellNumberStyle | null {
  if (grid.cellNumbers !== undefined) {
    return grid.cellNumbers ? { format: grid.cellNumbers, opacity: grid.cellNumberOpacity ?? DEFAULT_CELL_NUMBER_OPACITY } : null;
  }
  if (!grid.hexNumbers || !isHexGridType(grid.type)) return null;
  return { format: grid.hexNumbers, opacity: grid.hexNumberOpacity ?? DEFAULT_CELL_NUMBER_OPACITY };
}
