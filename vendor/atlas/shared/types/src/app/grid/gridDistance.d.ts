/**
 * Grid distance along a path, in cells.
 *
 * Hex grids count hex steps. Square grids split every segment into straight
 * and diagonal cells and price the diagonals with the collection's
 * `DiagonalRule`. The alternating rule counts diagonals over the whole path,
 * so a path with waypoints costs the same as one straight move.
 */
import type { DiagonalRule } from '../types/collectionSettingsTypes';
import type { GridOptions } from './gridTypes';
import { type Point } from './hexGeometry';
export type GridGeometry = Pick<GridOptions, 'type' | 'size' | 'offsetX' | 'offsetY'>;
/** Length in cells of the path through `points`. */
export declare function pathLengthInCells(grid: GridGeometry, points: readonly Point[], diagonalRule: DiagonalRule): number;
/** The centre of the cell holding `point`: the nearest hex centre, or the square's centre. */
export declare function cellCenterAt(grid: GridGeometry, point: Point): Point;
