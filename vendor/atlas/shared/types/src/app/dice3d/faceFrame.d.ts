import type { DieGeometry } from './dieGeometry';
import { type Vec3 } from './vectorMath';
/**
 * How far a face reaches into its atlas cell, as a share of the cell: 82 % of
 * the cell across, so the rim stays ground colour and nothing bleeds into the
 * neighbouring cell.
 */
export declare const FACE_CELL_REACH = 0.41;
export interface FaceFrame {
    center: Vec3;
    right: Vec3;
    up: Vec3;
    /** Largest corner distance in the plane; normalises the face into its cell. */
    reach: number;
}
export declare function faceFrame(geometry: DieGeometry, face: number): FaceFrame;
/** The face's corners in its atlas cell, in cell pixels, x right and y towards the numeral's top. */
export declare function faceOutline(geometry: DieGeometry, face: number, cellPx: number): [number, number][];
