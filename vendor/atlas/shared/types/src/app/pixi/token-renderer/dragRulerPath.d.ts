/**
 * The path of Atlas's token drag ruler: the snapped start, every waypoint, and the cell the
 * token would land in. A waypoint never repeats the last point, and the path is empty while the
 * token has not left its start. Used by `DragRuler`, and part of the shared drawing contract.
 */
import { type GridGeometry } from '../../grid/gridDistance';
import type { Point } from '../../grid/hexGeometry';
import { type DistanceSettings } from '../../grid/measurementFormat';
/** Atlas's key for adding a waypoint while dragging a token. */
export declare const WAYPOINT_KEY = " ";
export declare function samePoint(a: Point, b: Point): boolean;
export declare class DragRulerPath {
    private readonly snap;
    /** The snapped start followed by every waypoint. */
    private waypoints;
    private landing;
    constructor(snap: (point: Point) => Point);
    get active(): boolean;
    begin(origin: Point): void;
    /** Moves the end to the cell a token at `position` would snap to. */
    update(position: Point): void;
    /** Adds a waypoint at the landing cell; false when there is none or it repeats the last point. */
    addWaypoint(): boolean;
    /** The start, the waypoints and the landing cell; null until the path leaves its start. */
    points(): Point[] | null;
    end(): void;
}
/** The ruler's label: the path's length in the measurement's units or range bands. */
export declare function dragRulerLabel(grid: GridGeometry, points: readonly Point[], settings: DistanceSettings): string;
