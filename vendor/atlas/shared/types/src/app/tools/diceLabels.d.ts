/** How the dice of a roll are written out, wherever a roll is listed. */
import type { RolledDie } from './diceFormula';
type ListedDie = Pick<RolledDie, 'value' | 'negative' | 'exploded'>;
/** The dice of a roll as a sum: `6! + 4 + 3`, or `1! − 7` where a die subtracts. */
export declare function diceSum(rolls: readonly ListedDie[]): string;
/** One die for a list of the dice rolled: `d6: 6!`, and `−d10: 7` for a die an explosion subtracts. */
export declare function dieLabel(rolls: readonly RolledDie[], index: number): string;
export {};
