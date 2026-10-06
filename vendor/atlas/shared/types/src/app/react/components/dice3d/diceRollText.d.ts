import type { DiceScene } from '../../../dice3d/diceScene';
import type { DiceRollResult } from '../../../types/diceTypes';
/**
 * What was rolled, e.g. "Scimitar"; a roll without an action is just a roll.
 * Never who rolled it: the creature's portrait beside the label says that.
 */
export declare function rollLabel(result: DiceRollResult): string;
/**
 * The line under the total. A die stood in for another (a d2 on a d6) explains
 * itself, since a 6 on the stage next to a total of 2 looks like an error. More
 * than six dice are summed rather than listed: the chain would wrap, the panel
 * holds one line, and the pips lie on the stage anyway.
 */
export declare function rollBreakdown(result: DiceRollResult, scene: DiceScene): string | null;
/** Whether a breakdown line will show, known before landing so the panel never grows. */
export declare function hasBreakdown(result: DiceRollResult, scene: DiceScene): boolean;
