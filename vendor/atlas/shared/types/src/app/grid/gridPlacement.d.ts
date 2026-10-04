import type { GridType } from './gridTypes';
import type { Point } from './hexGeometry';
export interface GridOffset {
    offsetX: number;
    offsetY: number;
}
/** Keeps offsets small without moving the grid: square offsets modulo the cell, hex offsets re-based to the hex containing the origin. */
export declare function normaliseGridOffset(gridType: GridType, cellSize: number, offsetX: number, offsetY: number): GridOffset;
/** Offsets of the grid whose cell `(0, 0)` is centred on `point`. */
export declare function gridOffsetCenteredAt(gridType: GridType, cellSize: number, point: Point): GridOffset;
/**
 * How far a token's centre lies from the centre of the cell its footprint starts from. A token covers whole
 * cells, so an even footprint centres where cells meet: on a square grid the intersection down and right of
 * that cell (2×2, 4×4), on a hex grid its lower right vertex, shared with the hexes to its right and below
 * (3 hexes for Large, 12 for Gargantuan). An odd footprint centres on the cell itself (1 hex, 7 hexes).
 */
export declare function tokenCenterShift(gridType: GridType | undefined, cellSize: number, tokenSize: number): Point;
/** Where the centre of a token of `tokenSize` snaps. `snapToCell` snaps a point to the centre of the cell containing it. */
export declare function snapTokenCenter(point: Point, tokenSize: number, gridType: GridType | undefined, cellSize: number, snapToCell: (point: Point) => Point): Point;
/**
 * Centre of a token resized from `fromSize` to `toSize`. Where tokens snap to a grid it keeps the cell its
 * footprint starts from (on a square grid its top-left corner), so an aligned token stays aligned at its new
 * size; elsewhere it keeps its centre.
 */
export declare function resizedTokenCenter(center: Point, fromSize: number, toSize: number, grid: {
    type?: GridType | undefined;
    size: number;
    snapToGrid?: boolean | undefined;
} | null | undefined): Point;
