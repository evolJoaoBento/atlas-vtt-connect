// Copied from Atlas VTT src/app/dice3d/rollPresentation.ts at cd9ef86 (AGPL-3.0-only).
// The join page's own chunk loads the vendored dice (three.js); these three need none, so the page's first script stays small.
import type { DiceRollResult } from '@atlas-vtt/shared/rules';
import type { DiceDisplay } from './diceDisplay';
import { sceneFromRolls, type DiceScene } from './diceScene';

/**
 * The stage a roll is thrown on, or null when it shows as a result card: cards
 * are chosen, or the roll holds dice no real body can show.
 */
export function diceSceneToShow(result: DiceRollResult, display: DiceDisplay): DiceScene | null {
  return display === 'card' ? null : sceneFromRolls(result.rolls);
}
