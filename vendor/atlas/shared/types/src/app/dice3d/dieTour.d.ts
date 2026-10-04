/**
 * The path of a throw: a billiard in a rectangle that closes on itself.
 *
 * The die shoots off its spot, bounces off the walls and ends exactly where
 * it started. That it arrives is **arithmetic, not a correction**: unfold the
 * table at every wall instead of mirroring the ball and the billiard is a
 * straight line (`fold` folds it back). On that line "back on the spot" is
 * simply a distance that can be computed for a given number of wall hits
 * (`spanFor`).
 */
import { type Vec3 } from './vectorMath';
export type Rng = () => number;
/** The schedule of one throw, rolled anew at every launch. */
export interface DieTour {
    /**
     * The distance in **unfolded** space, per axis. From `spanFor`, so it is
     * guaranteed to end on the spot.
     */
    spanX: number;
    spanZ: number;
    /** The walls this body bounces off: stage minus its own radius. */
    wallX: number;
    wallZ: number;
    /** Duration of the throw in seconds. */
    duration: number;
    /**
     * The run-out of the path: 1 would be uniform, larger means flick and
     * friction.
     *
     * It once was 2.25, and the die covered its whole path in the first third
     * of the time and crawled the rest: a twitch, then a second of creeping.
     */
    ease: number;
    /** The two tumble axes. Never nearly the same. */
    axisA: Vec3;
    axisB: Vec3;
    /** How far to turn about each axis: several whole turns. */
    turnA: number;
    turnB: number;
    /**
     * The run-out of the spin. Flatter than the path's: the die should **spin
     * until the end**, not stop halfway and wait.
     */
    spinEase: number;
    /** Axis and amplitude of the final rock. */
    rockAxis: Vec3;
    rockAmount: number;
}
/** The table. Nothing exists below it. */
export declare const FLOOR_Y = -0.72;
/**
 * **The stage when nobody measures it.** At runtime the renderer passes the
 * real size (it knows the camera and canvas); these are the fallback for tests
 * and the first frame before measuring.
 */
export declare const STAGE_X = 3.25;
export declare const STAGE_Z = 2.1;
export declare function randomAxis(rng: Rng): Vec3;
/**
 * How much bounce is left at point `s` of the throw.
 *
 * The first half bounces fully, where the die should whirl. Afterwards the
 * bounce falls linearly to zero so the end happens **on the table**, not in
 * the air: a die still hopping while its number stands looks like a bug.
 */
export declare function damp(s: number): number;
/**
 * How high a tumbling die's centre stays above the table, as a share of its
 * radius: between lying on a face and standing on a corner.
 */
export declare const TUMBLE_HEIGHT = 0.78;
/** Where the centre of a die is when the die touches the table: `share` of its radius above it. */
export declare function restHeight(radius: number, share?: number): number;
/**
 * **Fold the unfolded table back together.**
 *
 * Mirroring the table instead of the die makes the billiard a straight line.
 * `fold` turns it back into the zigzag: a triangle wave of amplitude `wall`
 * and period `4·wall`, exactly the way between both walls and back.
 */
export declare function fold(u: number, wall: number): number;
/** Which unfolded cell `u` lies in. A change of cell is a wall hit. */
export declare function cellOf(u: number, wall: number): number;
/**
 * **Which of the two walls lies between two cells: `+wall` or `−wall`.**
 *
 * This once used the parity of the *new* cell alone, which was only right
 * while the die flew forwards. Flying backwards (`spanFor` rolls the direction
 * per axis, so in half of all throws), the crossed boundary lies on the
 * *other* side of the new cell and the answer flipped: sparks flew at the
 * opposite wall, where the die never was.
 *
 * Asking the **boundary** instead of the cell is direction-free: between cells
 * `k` and `k+1` it lies at `u = (2k+1)·wall`, where `fold` is exactly
 * `(−1)^k · wall`. So the smaller of the two cell numbers decides, whichever
 * way the die comes from.
 */
export declare function wallSide(prev: number, next: number): 1 | -1;
/** Roll the path: a hit pair, two directions, a pace, a tumble. */
export declare function planTour(home: readonly [number, number], radius: number, stage: readonly [number, number], rng: Rng, maxWallHits?: number): DieTour;
