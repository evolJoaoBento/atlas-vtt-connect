/**
 * Atlas's "Players move only on their turn" (0.9): during a fight, online players can move a token of theirs only while
 * it has the turn. Atlas holds a token that is in a running fight, shown to players, and is not among those whose turn
 * it is: in a list in turn order the one combatant whose turn it is, by sides every combatant of the side whose turn it is
 * (leaving out one that sits out the round). A token that is not in the fight is never held.
 *
 * It is judged on what the player was sent, which is what Atlas shows them: no list (the tracker closed, hidden from
 * players, no fight) holds nothing, as Atlas holds nothing then.
 */
import { listedSide, sidesActing } from '../scene/initiativeSides';
import type { PlayerScene } from '../scene/sceneTypes';

/** Whether a player may not move `tokenId` now: it is in the running fight shown to them and has not got the turn. */
export function heldOffTurn(scene: Pick<PlayerScene, 'initiative' | 'tokens'>, tokenId: string): boolean {
  const { initiative } = scene;
  if (!initiative || !initiative.active) return false;
  const entry = initiative.entries.find((candidate) => candidate.tokenId === tokenId);
  if (!entry) return false;
  if (initiative.sides) {
    // Every side whose turn it is moves (sides with equal rolls act together); with none acting, all are held.
    return entry.sitsOut === true || !sidesActing(initiative).has(listedSide(scene.tokens, entry));
  }
  return !entry.isActive;
}
