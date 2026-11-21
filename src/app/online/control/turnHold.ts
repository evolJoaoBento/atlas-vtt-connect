/**
 * Atlas's "Players move only on their turn" (0.9): during a fight, online players can move a token of theirs only while
 * it has the turn. Atlas 0.18 (`movesOutOfTurn`, online/gm/turnShare.ts) holds a token that fights in a running fight and
 * does not hold the turn, for the whole fight: what players are shown of it (the list hidden for them, the GM's tracker
 * closed) changes nothing, so closing the tracker never frees every token. In a fight in turn order the one combatant
 * whose turn it is holds it; by sides every combatant of the side (or tied sides) whose turn it is, leaving out one that
 * sits out the round and one the map's resources call defeated. A token that is not in the fight is never held.
 *
 * It is judged on the GM's own store, not on the scene sent to the player (which has no list while it is hidden).
 */
import type { ResourceDefinition, SceneSnapshot } from '@atlas-vtt/api-types';
import { currentTurn, defeatedCombatants, inFight, turnEntries } from '../../../../packages/atlas-shared/src/index';

type TurnState = Pick<SceneSnapshot, 'initiative'> & { objects?: Partial<Pick<SceneSnapshot['objects'], 'tokens'>> };

/** The shared rules' view of the store's fight (the API's type predates Atlas 0.18's tokenless entries). */
type FightState = Parameters<typeof currentTurn>[0] & { entries: Parameters<typeof turnEntries>[1]['entries'] };

/**
 * Whether a player may not move `tokenId` now (given the GM's choice that players move only on their turn): a fight
 * runs, the token fights in it, and it does not hold the turn. `definitions` are the map's resources, which say who is defeated.
 */
export function movesOutOfTurn(state: TurnState, definitions: readonly ResourceDefinition[], tokenId: string): boolean {
  const initiative = state.initiative as unknown as FightState | undefined;
  if (!initiative?.isActive || !Array.isArray(initiative.entries) || !inFight(initiative, tokenId)) return false;
  const tokens = (state.objects?.tokens ?? {}) as Parameters<typeof turnEntries>[2];
  const defeated = defeatedCombatants(initiative.entries, tokens, definitions);
  return !turnEntries(currentTurn(initiative), initiative, tokens, defeated).some((entry) => entry.tokenId === tokenId);
}
