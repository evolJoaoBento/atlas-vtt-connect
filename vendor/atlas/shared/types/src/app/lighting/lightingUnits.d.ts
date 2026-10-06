import type { MeasurementSettings } from '../grid/measurementFormat';
import type { GridState } from '../types/gridTypes';
/** How many game units one grid cell spans, and how many world pixels it is wide. */
export interface UnitScale {
    unitDistance: number;
    cellSize: number;
}
export declare function unitScaleOf(measurement: Pick<MeasurementSettings, 'unitDistance'> | null, grid: Pick<GridState, 'size'> | null): UnitScale;
export declare function gameUnitsToWorld(units: number, scale: UnitScale): number;
export declare function worldToGameUnits(world: number, scale: UnitScale): number;
