/**
 * The dice bodies as pure math: vertices, faces, numbers.
 *
 * Convention: "up" is +Y and the camera looks **down** on the table. The rolled
 * face is the one whose normal points to +Y, and the top of its numeral points
 * to −Z so the number reads upright on screen. The d4 is the exception: its
 * rolled face lies on the table (see `restingQuaternion`).
 */
import { type Quat, type Vec3 } from './vectorMath';
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;
export interface DieGeometry {
    sides: DieSides;
    /** Vertices, scaled to a circumradius of about 1. */
    vertices: Vec3[];
    /** Faces as vertex indices, counter-clockwise seen from outside. */
    faces: number[][];
    /** The number each face stands for; opposite faces add up to n+1. What is printed where: `faceMarks`. */
    values: number[];
    normals: Vec3[];
    centers: Vec3[];
    /** The "up" of the numeral in the face plane; makes the target orientation unique. */
    ups: Vec3[];
}
export declare function dieGeometry(sides: DieSides): DieGeometry;
/**
 * The orientation in which face `face` **lies on top** and its numeral reads
 * upright from above (head towards −Z). This is where the roll ends.
 */
export declare function faceQuaternion(geometry: DieGeometry, face: number): Quat;
export declare function faceIndexForValue(geometry: DieGeometry, value: number): number;
/**
 * How high the centre of a die lies above the table when the die lies on a
 * face, as a share of its radius: a third on the d4, four fifths on the d20.
 */
export declare function lyingHeight(geometry: DieGeometry): number;
/** How far a resting die may be turned on the table, either way: enough to show its sides, not enough to tip the number. */
export declare const REST_YAW = 0.3;
/**
 * How the die **comes to rest**: lying on a face, as a body on a table does,
 * and turned by `yaw` about the vertical. The rolled face lies on top.
 *
 * The d4 has no face on top: it lies **on** the rolled face and points its tip
 * up, with one face turned to the viewer. The roll is the number at the tip
 * (`faceMarks`).
 *
 * The dice once came to rest tilted, a share of the way to the next face, so
 * that the body would not flatten to a polygon seen from above. They stood on
 * an edge or a corner for it, the d4 on its tip, and the d6 showed two numbers
 * almost alike.
 */
export declare function restingQuaternion(geometry: DieGeometry, face: number, yaw?: number): Quat;
