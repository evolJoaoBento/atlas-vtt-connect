/**
 * Vectors and quaternions for the dice stage. Pure math without DOM, so it can
 * be tested like a formula.
 *
 * Convention: "up" is +Y and the camera looks down on the table from above.
 */
export type Vec3 = readonly [number, number, number];
export interface Quat {
    w: number;
    x: number;
    y: number;
    z: number;
}
export declare const vAdd: (a: Vec3, b: Vec3) => Vec3;
export declare const vSub: (a: Vec3, b: Vec3) => Vec3;
export declare const vScale: (a: Vec3, s: number) => Vec3;
export declare const vDot: (a: Vec3, b: Vec3) => number;
export declare const vCross: (a: Vec3, b: Vec3) => Vec3;
export declare const vLength: (a: Vec3) => number;
export declare function vNormalize(a: Vec3): Vec3;
export declare const qIdentity: () => Quat;
export declare function qAxisAngle(axis: Vec3, angle: number): Quat;
export declare function qMul(a: Quat, b: Quat): Quat;
export declare function qNormalize(q: Quat): Quat;
/** `v` rotated by `q`, with the two-cross-product formula instead of a matrix. */
export declare function qRotate(q: Quat, v: Vec3): Vec3;
/**
 * Spherical interpolation. `t` may exceed 1: the rotation then runs past the
 * target and comes back, the small overshoot of a die settling rather than
 * docking.
 */
export declare function qSlerp(a: Quat, b: Quat, t: number): Quat;
/** Angular distance between two orientations in radians (0 to π). */
export declare function qAngle(a: Quat, b: Quat): number;
/**
 * Quaternion from a rotation matrix given as three rows. The matrix maps
 * `right → +X`, `up → +Y`, `normal → +Z`. Shepperd's case split, so nothing
 * degenerates when the trace is near −1.
 */
export declare function qFromRows(r0: Vec3, r1: Vec3, r2: Vec3): Quat;
