/**
 * The camera over the dice stage: fitted to the canvas once per size, fixed
 * afterwards, nudged only by the shake of a wall hit.
 */
import * as THREE from 'three';
export declare const STAGE_FOV: number;
/**
 * **The camera stands still, far enough away that the whole sheet fits.**
 *
 * There once was a camera move here: back during the flight, in again on
 * landing. It was a workaround for the die living in a 16:10 cutout with no
 * room in it. Now the canvas is the whole sheet, and a moving camera would be
 * outright **wrong**: a die bouncing off a wall that is not at the edge of the
 * picture visibly bounces off nothing.
 *
 * Instead the distance is **measured** once per canvas size (`fit`), so the
 * die appears the same size on a tall sheet as on a wide one. Whatever the
 * camera sees as the edge is the wall.
 */
export declare const VIEW_HALF_WIDTH = 2.72;
export declare class StageCamera {
    readonly camera: THREE.PerspectiveCamera;
    /** The measured camera distance and the half visible area below it. */
    private reachValue;
    private half;
    /** Where the camera looks: the point the dice come to rest on. */
    private focus;
    private shake;
    constructor();
    get reach(): number;
    get focusZ(): number;
    /** Half width and half depth of the stage in world units; the walls stand there. */
    stage(): readonly [number, number];
    setAspect(aspect: number): void;
    /**
     * **Fits the sheet.**
     *
     * Two values are settled here: the distance (far enough that the same width
     * of table is always visible, otherwise the die would be twice as large on a
     * tall sheet as on a wide one) and the depth of the look-at point (chosen so
     * the dice come to rest where `focus` asks).
     *
     * Both are **measured, not derived**, and both are linear in the value
     * sought, so one probe per size is enough.
     */
    fit(focus: number, halfWidth?: number): void;
    /**
     * A tremor when a die just hit the wall (`bang` is the strongest hit this
     * frame). It stays tiny: it should confirm the blow, not shake the picture,
     * and above all it must not move the walls the die bounces off.
     */
    place(bang: number, dt: number): void;
    /** Whether a wall hit still moves the camera by anything a pixel could show. */
    get shaking(): boolean;
    resetShake(): void;
    /** Camera at `reach` times the base distance, looking at `focusZ` in the depth. */
    private aim;
    /**
     * Where the ray through screen point `(sx, sy)` meets the rest plane. This
     * reads what the camera actually sees of the table, instead of deriving it
     * from field of view and tilt and getting it wrong.
     */
    private groundAt;
    /** The half visible area around `focusZ`; the tightest corner counts. */
    private visible;
    /** Where the world origin lands on screen, in normalised device coordinates (-1…1). */
    private originOnScreen;
}
