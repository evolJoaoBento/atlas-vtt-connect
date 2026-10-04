/**
 * A collection's initiative rules: reading them from the settings, checking and
 * comparing them.
 */
import type { InitiativeMode, InitiativeRules, InitiativeSide } from '../types/initiativeRulesTypes';
import type { SystemPreset } from '../types/systemPresetTypes';
/** Initiative of a collection without a game system: a d20 each, highest first. */
export declare const DEFAULT_INITIATIVE_RULES: Readonly<InitiativeRules>;
export declare const INITIATIVE_MODES: readonly InitiativeMode[];
export declare const INITIATIVE_SIDES: readonly InitiativeSide[];
/** Stored initiative rules, or undefined when they are none. */
export declare function parseInitiativeRules(raw: unknown): InitiativeRules | undefined;
/**
 * Whether the rules can be saved as they stand; while they are edited the roll may be half
 * typed. By sides nothing is rolled, so the roll does not matter there.
 */
export declare function isValidInitiativeRules(rules: InitiativeRules): boolean;
/** The rules as they are stored: the roll trimmed, and a d20 where it was left half typed behind another mode. */
export declare function savedInitiativeRules(rules: InitiativeRules): InitiativeRules;
/**
 * The collection's initiative rules: its own, else those of the preset it was
 * set from, else the default. A collection stores rules of its own only once
 * the GM edits them, so a corrected built-in system reaches it.
 */
export declare function collectionInitiativeRules(settings: {
    initiative?: unknown;
    systemPresetId?: string | undefined;
}, presets: readonly SystemPreset[]): InitiativeRules;
export declare function sameInitiativeRules(a: InitiativeRules | undefined, b: InitiativeRules | undefined): boolean;
