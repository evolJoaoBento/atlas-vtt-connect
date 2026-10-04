/**
 * The numerals a face carries, and where.
 *
 * Every body but the d4 writes one number in the middle of each face and is
 * read on the face lying on top. A d4 has no top face: it lies on one and
 * points a tip up. So it is numbered like the real one, at the corners: each
 * face carries three numbers, head first towards its corners, and the three
 * faces around a corner agree on it. The number at the tip is the roll.
 */
import type { DieGeometry } from './dieGeometry';
type Point = readonly [number, number];
export interface NumeralMark {
    value: number;
    /** The numeral's ink centre in the face's cell: cell pixels from the face centre, y up. */
    at: Point;
    /** Where the numeral's head points in the cell, as a unit vector. */
    up: Point;
    /** The room it may fill, as an outline around `at` in the numeral's own frame (x right, y towards its head). */
    room: Point[];
}
/** The numerals of face `face`, in the order of its corners on the d4. */
export declare function faceMarks(geometry: DieGeometry, face: number, cellPx: number): NumeralMark[];
export {};
