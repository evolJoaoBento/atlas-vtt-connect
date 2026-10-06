import type { DiceRollResult } from '../types/diceTypes';
import type { DiceDisplay } from './diceDisplay';
import { type DiceScene } from './diceScene';
/**
 * The stage a roll is thrown on, or null when it shows as a result card: cards
 * are chosen, or the roll holds dice no real body can show.
 */
export declare function diceSceneToShow(result: DiceRollResult, display: DiceDisplay): DiceScene | null;
/** Marks `result`, the object handed to the map views' dice events, as never thrown in 3D. */
export declare function showAsCardOnly(result: DiceRollResult): void;
/**
 * The stage a logged roll (a view's `dice-rolled` event) is thrown on, or null for a result card: a roll by someone
 * other than the GM is thrown on their own screen, and a card-only roll was shown elsewhere already.
 */
export declare function loggedRollScene(result: DiceRollResult, display: DiceDisplay): DiceScene | null;
