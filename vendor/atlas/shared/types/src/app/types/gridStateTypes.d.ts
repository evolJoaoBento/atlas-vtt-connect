import type { CellNumberFormat } from '../grid/cellNumbering';
/** A scene's grid settings as saved in the map file (pure types, shared with extensions via `@atlas-vtt/shared`). */
export interface GridState {
    enabled: boolean;
    visible?: boolean;
    snapToGrid?: boolean;
    type?: 'square' | 'hex-horizontal' | 'hex-vertical';
    size: number;
    offsetX: number;
    offsetY: number;
    /** Hex colour of the grid lines. Unset lets the grid pick black or white from the map's brightness. */
    color?: string;
    opacity: number;
    scale?: number;
    mapScale?: number;
    unitType?: 'feet' | 'yards' | 'meters' | 'units';
    unitDistance?: number;
    lineType?: 'solid' | 'dashed' | 'dotted';
    lineWidth?: number;
    measurementType?: 'units' | 'abstract';
    /** Set on new scenes: align the grid to the map image on the first load, then cleared. */
    autoDetect?: boolean;
    /** Numbers every cell of the grid in this format; unset shows no numbers. */
    cellNumbers?: CellNumberFormat;
    /** Opacity of the cell numbers (0 to 1), separate from the grid lines; unset is `DEFAULT_CELL_NUMBER_OPACITY`. */
    cellNumberOpacity?: number;
}
