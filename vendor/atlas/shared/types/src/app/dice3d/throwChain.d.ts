/**
 * The order of a throw. The dice of a roll leave the hand together; a die
 * rolled because another exploded is thrown only when that die lies: an
 * explosion is something that happens, not something that was always there.
 */
import type { DiceCrit } from '../tools/diceCrit';
import type { DiePlan } from './diceScene';
import { type DieAnim } from './dieMotion';
import type { Rng } from './dieTour';
import type { Quat } from './vectorMath';
/**
 * Launches every die of the plan towards its target. A die that follows an
 * explosion waits out the whole throw of the die before it, which is known
 * here already: a throw's length is planned at its launch, not found out.
 * `rngFor` gives each die its own randomness, by its place in the plan.
 */
export declare function beginThrow(anims: readonly DieAnim[], plan: readonly DiePlan[], targets: readonly Quat[], rngFor: (index: number) => Rng, maxWallHits?: number): void;
/** How the die at `index` bursts when it lands: it exploded upwards, downwards, or not at all. */
export declare function burstOf(plan: readonly DiePlan[], index: number): DiceCrit;
