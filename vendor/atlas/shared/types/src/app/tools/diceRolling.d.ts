/**
 * Atlas's dice: the dice its tray offers, the formula a selection makes, rolling a formula, and
 * what players may see of a roll. It imports only pure dice maths (`diceFormula.ts`, `diceCrit.ts`
 * and the dice rules they read, `gameSystems/diceRules`), so it needs no PIXI or UI code.
 */
import { type DiceCrit } from './diceCrit';
import { type RolledDie } from './diceFormula';
import type { DiceRules } from '../types/diceRulesTypes';
/** The dice of Atlas's dice tray, in tray order. */
export declare const DICE_TYPES: readonly ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
export type DieType = typeof DICE_TYPES[number];
/** How many of each die are picked; a die left out counts 0. */
export type DiceSelection = Partial<Record<DieType, number>>;
/** Every roll reaches Atlas's dice log, toasts and sounds as this document event. */
export declare const DICE_ROLLED_EVENT = "atlas-dice-rolled";
export interface DiceRollResult {
    id: string;
    timestamp: number;
    formula: string;
    rolls: RolledDie[];
    modifiers: number;
    total: number;
    /** Decided by the collection's critical rule when rolled; missing on rolls logged before rules existed. */
    crit?: DiceCrit;
    player?: string;
    source?: {
        type: 'toolbar' | 'statblock';
        /** Let the roll follow its token's or statblock's current artwork. */
        tokenId?: string;
        statblockPath?: string;
        tokenName?: string;
        tokenImagePath?: string;
        abilityName?: string;
    };
}
export declare function isDieType(value: unknown): value is DieType;
/** The picked dice in the order they were picked, e.g. `['2d6', 'd20']`; dice with no count are left out. */
export declare function diceTerms(selection: Readonly<Partial<Record<string, number>>>): string[];
/** The formula Atlas rolls for a selection and a modifier, e.g. "2d6+d20-1"; empty without dice. */
export declare function diceFormula(selection: Readonly<Partial<Record<string, number>>>, modifier?: number): string;
/**
 * Rolls `formula` with `random` for the dice (`diceFormula.ts`), by the collection's `rules` when
 * given: its exploding dice and, for the result, its critical rule. The id stays random however
 * the dice are rolled, so rolls made in the same millisecond never share one.
 */
export declare function rollFormula(formula: string, random?: () => number, now?: number, rules?: DiceRules): DiceRollResult;
/** A roll for a token hidden from players keeps its ability and result, not the token's name or portrait. */
export declare function withoutHiddenToken(result: DiceRollResult, isTokenHidden: (tokenId: string) => boolean): DiceRollResult;
