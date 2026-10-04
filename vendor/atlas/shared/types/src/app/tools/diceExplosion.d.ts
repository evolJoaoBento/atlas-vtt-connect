/**
 * Exploding dice: a die that shows one of its highest faces is rolled again
 * and the new die adds to the roll (Savage Worlds' aces, the 10 of Cyberpunk
 * RED). In some systems a lowest face rolls again too, and that die subtracts.
 *
 * A chain has one direction, set by its first die: up when that die shows a
 * high face, down when it shows a low one. The dice rolled for it keep it
 * going on a high face only, so a chain downwards never turns around.
 */
import type { RolledDie } from './diceFormula';
/** The most dice one die may add. Rules that explode "again and again" stop here. */
export declare const MAX_EXPLOSIONS = 10;
/** How one die explodes. */
export interface Explosion {
    /** How many of the die's highest faces explode. */
    highFaces: number;
    /** How many of its lowest faces roll again and subtract. */
    lowFaces: number;
    /** How many dice the explosion may add at most. */
    limit: number;
}
/** The face a die of `sides` shows, 1 to `sides`. */
export declare function rollFace(sides: number, random: () => number): number;
/**
 * How many faces of a die of `sides` really explode upwards and downwards.
 * At least one face never explodes: a d2 whose two highest faces explode
 * would roll for ever. The high faces go first.
 */
export declare function explodingFaces(sides: number, highFaces: number, lowFaces: number): {
    high: number;
    low: number;
};
/**
 * The dice rolled because `die` exploded, in the order they were rolled; none
 * when it did not.
 */
export declare function rollExplosions(die: RolledDie, explosion: Explosion, random?: () => number): RolledDie[];
/** Whether the die at `index` exploded: the die after it was rolled for it. */
export declare function explodes(rolls: readonly Pick<RolledDie, 'exploded'>[], index: number): boolean;
