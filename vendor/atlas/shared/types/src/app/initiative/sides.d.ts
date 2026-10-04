import type { TokenEntity } from '../types';
import type { InitiativeRules, InitiativeSide } from '../types/initiativeRulesTypes';
import type { InitiativeState } from '../types/initiativeTypes';
/** What the tracker and the players' list call a side. */
export declare const SIDE_LABELS: Record<InitiativeSide, string>;
export declare function otherSide(side: InitiativeSide): InitiativeSide;
/** Both sides in the order they act in a round. */
export declare function sidesInOrder(first: InitiativeSide): [InitiativeSide, InitiativeSide];
/**
 * Whether the tracker and the players' list group the combatants by side: a running fight
 * keeps the mode it was started in, and without a fight the collection's rules decide.
 */
export declare function listedBySides(initiative: Pick<InitiativeState, 'isActive' | 'sides'>, rules: InitiativeRules): boolean;
/**
 * The side a token fights on: the one the GM gave it, else the players' for a token
 * that sees (the lighting takes those for the party), else the opponents'.
 */
export declare function sideOf(token: Pick<TokenEntity, 'side' | 'vision'> | undefined): InitiativeSide;
