import type { AxialCoord, HexLayout } from './hexGeometry';
import type { CellLattice } from './cellNumbering';
export declare function axialKey(coord: AxialCoord): string;
/** The lattice of a hex grid: cells addressed by axial coordinates. */
export declare function hexLattice(layout: HexLayout): CellLattice;
