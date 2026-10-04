/**
 * The spark bursts of a throw: a spray at every hard wall hit and a shower when
 * a die comes to rest.
 */
import type { DieAnim } from './dieMotion';
import type { SparkBurst } from './sparks';
export type Crit = 'high' | 'low' | null;
/**
 * **Sparks only at the wall.**
 *
 * They once also flew at every bounce on the table. Well meant, and it read as
 * random: flashes here and there without showing *what* was hit. A spark is
 * information: it says something hard was struck. On the table the die hits
 * nothing, it only lands; at the wall it bangs, and that is where it should
 * spray. Null when this frame has no such hit.
 */
export declare function wallSparks(die: DieAnim): SparkBurst | null;
/**
 * **Landing is the burst.**
 *
 * When the die stands, it sprays: a gush, not a trickle. The top roll gets one
 * size bigger, but every throw gets it: this is the moment the whole path led
 * to.
 *
 * What is **gone** is the shock ring. A ring rising over the table is the
 * visual language of hit and miss, and a throw is neither: it is a number. The
 * sparks tell the impact, the glow on the paper tells the rank. A ring in
 * between said nothing that was not already said twice.
 */
export declare function landingSparks(die: DieAnim, crit: Crit): SparkBurst;
