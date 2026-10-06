/**
 * A grid repeats itself, so its origin can be moved by whole repeats without changing a single line. The drawers and
 * lattices step from the origin one cell at a time; with an origin far from the map (1e40 and up) a step no longer
 * changes the float, and the loop never ends. Moving the origin next to zero first keeps every step exact.
 */
import { type HexLayout } from './hexGeometry';
/** `value` moved by whole `period`s into [0, period); `%` on floats is exact, whatever their size. */
export declare function withinPeriod(value: number, period: number): number;
/** A square grid's offset, moved next to zero. */
export declare function squareOffset(offset: number, size: number): number;
/**
 * `layout` with its origin moved next to zero by whole repeats of the hex lattice: one cell along its lines, and two
 * lines (whose half-cell stagger then lines up again) across them.
 */
export declare function hexLayoutNearZero(layout: HexLayout): HexLayout;
/**
 * A saved grid's offsets with any that lie farther than `limit` from zero moved next to it, by whole repeats of its
 * lattice, so the grid draws the same; a grid without a usable size gets 0, since it draws nothing anyway.
 */
export declare function offsetsWithin(grid: {
    type?: string;
    size: number;
    offsetX: number;
    offsetY: number;
}, limit: number): {
    offsetX: number;
    offsetY: number;
};
