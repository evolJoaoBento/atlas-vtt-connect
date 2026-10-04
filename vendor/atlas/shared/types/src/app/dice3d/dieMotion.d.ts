/**
 * A throw as a **pinball path that closes on itself** and a **spin that
 * unwinds itself**. The die runs straight until a wall is in the way, like in
 * a tray, on a billiard path (`dieTour.ts`) that ends on its spot for any pace:
 * the pace lives only in `tau`, and `tau(1) = 1` always holds.
 *
 * The pose is **written down, not integrated** (`poseAt`): at time `s` it is
 * the target turned *back* about two axes by `−(1−s)^spinEase` times several
 * turns. A free tumble followed by a slerp into the target showed a body
 * *being turned* until the right number was up; here the target is the zero
 * point of the spin, so the die spins, ever slower, until the last frame.
 *
 * Physics stays where it is visible: ballistic hops whose rebound dies with the
 * throw, impacts that knock the pose (`wobble`, blended out with `1 − s` so
 * they never move the arrival), and one rock over an edge at the end. The
 * result is fixed first; the throw retells it. Everything is a pure
 * `step(dt)`: the caller keeps time, the tests run it dry.
 */
import { type Quat, type Vec3 } from './vectorMath';
import type { DieTour, Rng } from './dieTour';
/** `throw` runs its path, `rest` lies still. Nothing lies between. */
export type DiePhase = 'throw' | 'rest';
/** An impact of this frame, read by the caller for sound and sparks; `null` again next step. */
export interface DieImpact {
    /**
     * `settle` is not a hit but **the moment the throw stands**, reported a hair
     * before the clock runs out: the last tenth of a second moves invisibly, and
     * sparks tied to the clock would fall into a silence that is already over.
     */
    kind: 'floor' | 'wall' | 'settle';
    /** 0 to 1: how hard it was. Volume, pitch and spark count depend on it. */
    strength: number;
    /** Where it sparked, in world coordinates. */
    at: Vec3;
    /** The normal of the surface that was hit; sparks fly that way. */
    normal: Vec3;
}
export interface DieAnim {
    phase: DiePhase;
    /** Centre position in world coordinates. */
    p: Vec3;
    v: Vec3;
    q: Quat;
    /** Angular velocity (axis × rad/s), **measured** from two frames; drives the motion blur. */
    w: Vec3;
    /** The die's spot: start and end of every throw. */
    home: readonly [number, number];
    radius: number;
    /** How high the centre lies above the table once the die lies on a face, as a share of the radius. */
    lie: number;
    /** Where the table holds the centre right now (see `floorAt`). */
    floor: number;
    /** Half the stage in world units: the walls stand here. */
    stage: readonly [number, number];
    /** Delay until launch, so several dice set off staggered. */
    delay: number;
    target: Quat;
    /** Elapsed time of the throw. */
    t: number;
    /** Seconds since coming to rest, for highlight and fade-out by the caller. */
    restFor: number;
    bounces: number;
    wallHits: number;
    impact: DieImpact | null;
    /** What the impacts left of the pose. Decays towards rest. */
    wobble: Quat;
    tour: DieTour;
    /** The unfolded cell the die is in; a change means a wall lay exactly between. */
    cellX: number;
    cellZ: number;
}
/**
 * A die lying still and visible on its spot until `beginRoll` launches it.
 * `lie` is its body's height when lying on a face (`lyingHeight`).
 */
export declare function makeDie(rng: Rng, home?: readonly [number, number], radius?: number, stage?: readonly [number, number], lie?: number): DieAnim;
/**
 * The launch: rolls path and tumble and lifts the body off the table. The pose
 * jumps to `poseAt` in the first frame, which nobody sees at sixty turns a second.
 */
export declare function beginRoll(die: DieAnim, target: Quat, delay: number, rng: Rng, maxWallHits?: number): void;
export declare function stepDie(die: DieAnim, dt: number, rng: Rng): void;
/** Come to rest at once, for reduced motion. */
export declare function restImmediately(die: DieAnim, target: Quat): void;
