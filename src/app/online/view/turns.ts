/**
 * Whose turn it is, as players can tell from the initiative the GM shows them: the token whose entry has the turn in
 * a fight in turn order, or the side whose turn it is in a fight by sides. Nothing while no fight runs or the list is
 * not shown. Shared with the web page.
 */
import type { PlayerScene } from '../scene/sceneTypes';

export interface Turn {
  /** The token that has the turn; null by sides (a whole side acts) or with no fight. */
  tokenId: string | null;
  /** Whether it is this player's turn: a token they control has it, or its side does. */
  mine: boolean;
  /** The name of the player's own token that acts, for "Your turn: Anna"; null when none or nameless. */
  name: string | null;
}

export const NO_TURN: Turn = { tokenId: null, mine: false, name: null };

export function turnOf(scene: PlayerScene | null, controlled: ReadonlySet<string>): Turn {
  const initiative = scene?.initiative;
  if (!scene || !initiative?.active) return NO_TURN;
  const sides = initiative.sides;
  if (sides) {
    if (!sides.active) return NO_TURN;
    // By sides: every token of the acting side the player controls acts; the first named one names it.
    const mine = initiative.entries
      .filter((entry) => controlled.has(entry.tokenId) && scene.tokens[entry.tokenId]?.side === sides.active && entry.sitsOut !== true);
    const named = mine.map((entry) => scene.tokens[entry.tokenId]?.name ?? entry.name).find((name) => !!name) ?? null;
    return { tokenId: null, mine: mine.length > 0, name: named };
  }
  const entry = initiative.entries.find((candidate) => candidate.isActive);
  if (!entry || !scene.tokens[entry.tokenId]) return NO_TURN;
  const mine = controlled.has(entry.tokenId);
  return { tokenId: entry.tokenId, mine, name: mine ? scene.tokens[entry.tokenId]?.name ?? entry.name : null };
}

/** The note a player reads on their turn. */
export function turnNotice(turn: Turn): string | null {
  if (!turn.mine) return null;
  return turn.name ? `Your turn: ${turn.name}` : 'Your turn';
}
