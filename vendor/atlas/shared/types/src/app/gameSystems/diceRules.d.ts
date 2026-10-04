/**
 * A collection's dice rules: reading them from the settings, checking and
 * comparing them.
 */
import type { CritRule, DiceRules, ExplodeRule, ExplodeScope } from '../types/diceRulesTypes';
import type { SystemPreset } from '../types/systemPresetTypes';
/** Dice of a collection without a game system: a d20, natural 20 and natural 1. */
export declare const DEFAULT_DICE_RULES: Readonly<DiceRules>;
export declare const CRIT_RULES: readonly CritRule[];
export declare const EXPLODE_SCOPES: readonly ExplodeScope[];
/** What a collection starts from when its dice are switched to explode: the highest face, again and again. */
export declare const DEFAULT_EXPLODE_RULE: Readonly<ExplodeRule>;
/** The most faces of a die a rule may name; the roll leaves every die one face that does not explode. */
export declare const MAX_EXPLODING_FACES = 99;
/** Whether `value` is a number of faces a rule may name: whole, from `least` to the most a rule allows. */
export declare function isFaceCount(value: unknown, least: number): value is number;
/** A stored exploding rule, or null when it is none: such dice do not explode. */
export declare function parseExplodeRule(raw: unknown): ExplodeRule | null;
/**
 * Whether dice rules can be saved as they stand. While they are edited they
 * may hold what was typed so far: half a default roll, or no face count yet.
 */
export declare function isValidDiceRules(dice: DiceRules): boolean;
/** What the settings offer for exploding dice: none, or the dice that explode. */
export type ExplodeChoice = ExplodeScope | 'off';
/**
 * The dice rules with exploding switched off, or set to the given dice. A rule
 * already there keeps its other settings; a new one starts from the default.
 */
export declare function withExplodeScope(dice: DiceRules, choice: ExplodeChoice): DiceRules;
/** Count and sides of a default roll such as `2d12`; null when it is not one valid dice group. */
export declare function parseDefaultRoll(defaultRoll: string): {
    count: number;
    sides: number;
} | null;
export declare function isValidDefaultRoll(value: string): boolean;
/**
 * The collection's dice rules: its own, else those of the preset it was set
 * from (collections saved before dice rules existed), else the default.
 */
export declare function collectionDiceRules(settings: {
    dice?: DiceRules | undefined;
    systemPresetId?: string | undefined;
}, presets: readonly SystemPreset[]): DiceRules;
export declare function sameDiceRules(a: DiceRules | undefined, b: DiceRules | undefined): boolean;
