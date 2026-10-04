/**
 * Parses and rolls dice formulas such as `2d6+3`, `d20+2d6` or `2d6-1d4`.
 * Every term carries its own sign, so the `+2` of `+2d6` is a dice count and
 * never a modifier, and subtracted dice subtract.
 *
 * A dice term may explode (`diceExplosion.ts`): by its own notation, written
 * as Obsidian's Dice Roller writes it since statblocks use that (`2d6!` once,
 * `2d6!3` up to three times, `2d6!i` again and again; `!!` reads the same), or
 * by the collection's rule.
 */
import type { DiceRules } from '../types/diceRulesTypes';
export interface RolledDie {
    /** e.g. `d20`. */
    die: string;
    value: number;
    max: number;
    /** The die subtracts: it belongs to a subtracted term, e.g. the d4 of `2d6-1d4`, or to an explosion downwards. */
    negative?: true;
    /** The die was rolled because the die before it exploded. */
    exploded?: true;
}
export interface RolledFormula {
    rolls: RolledDie[];
    modifiers: number;
    total: number;
}
/** Whether the formula names any dice; a bare `+3` does not. */
export declare function hasDiceTerm(formula: string): boolean;
/**
 * Rolls every dice term of the formula and adds up the result. Dice with fewer
 * than two sides are skipped. `rules` are the collection's: its exploding rule
 * and the default roll that says which dice a default-dice rule means, the
 * first added dice of its size, as many as it rolls (as for criticals).
 */
export declare function rollFormula(formula: string, random?: () => number, rules?: Pick<DiceRules, 'defaultRoll' | 'explode'>): RolledFormula;
