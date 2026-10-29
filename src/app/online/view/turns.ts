/**
 * Whose turn it is, as players can tell from the initiative the GM shows them: the token whose entry has the turn in
 * a fight in turn order, or the side whose turn it is in a fight by sides. Nothing while no fight runs or the list is
 * not shown. Shared with the web page.
 */
import { listedSide, sidesActing, sidesNext } from '../scene/initiativeSides';
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
  if (initiative.sides) {
    const acting = sidesActing(initiative);
    if (acting.size === 0) return NO_TURN;
    // By sides: every token of an acting side the player controls acts (sides with equal rolls act together); the first named one names it.
    const mine = initiative.entries
      .filter((entry) => controlled.has(entry.tokenId) && acting.has(listedSide(scene.tokens, entry)) && entry.sitsOut !== true);
    const named = mine.map((entry) => scene.tokens[entry.tokenId]?.name ?? entry.name).find((name) => !!name) ?? null;
    return { tokenId: null, mine: mine.length > 0, name: named };
  }
  const entry = initiative.entries.find((candidate) => candidate.isActive);
  if (!entry || !scene.tokens[entry.tokenId]) return NO_TURN;
  const mine = controlled.has(entry.tokenId);
  return { tokenId: entry.tokenId, mine, name: mine ? scene.tokens[entry.tokenId]?.name ?? entry.name : null };
}

/**
 * Whose turn comes next, as players can tell it: in turn order the entry after the active one that does not sit out,
 * the first again after the last (the next round); by sides the other side. Worked out from the entries players see,
 * so a hidden combatant between makes it come a turn early, and tells nothing of that combatant.
 */
export function nextTurnOf(scene: PlayerScene | null, controlled: ReadonlySet<string>): Turn {
  const initiative = scene?.initiative;
  if (!scene || !initiative?.active) return NO_TURN;
  if (initiative.sides) {
    const next = sidesNext(initiative);
    if (!next) return NO_TURN;
    const mine = initiative.entries
      .filter((entry) => controlled.has(entry.tokenId) && next.has(listedSide(scene.tokens, entry)) && entry.sitsOut !== true);
    const named = mine.map((entry) => scene.tokens[entry.tokenId]?.name ?? entry.name).find((name) => !!name) ?? null;
    return { tokenId: null, mine: mine.length > 0, name: named };
  }
  const acting = initiative.entries.findIndex((candidate) => candidate.isActive);
  if (acting === -1) return NO_TURN;
  const count = initiative.entries.length;
  for (let step = 1; step < count; step++) {
    const entry = initiative.entries[(acting + step) % count]!;
    if (entry.sitsOut === true || !scene.tokens[entry.tokenId]) continue;
    const mine = controlled.has(entry.tokenId);
    return { tokenId: entry.tokenId, mine, name: mine ? scene.tokens[entry.tokenId]?.name ?? entry.name : null };
  }
  return NO_TURN;
}

/** The note a player reads on their turn, and on the turn before it ("Your turn is next"). */
export function turnNotice(turn: Turn, next: Turn = NO_TURN): string | null {
  if (turn.mine) return turn.name ? `Your turn: ${turn.name}` : 'Your turn';
  if (next.mine) return next.name ? `Your turn is next: ${next.name}` : 'Your turn is next';
  return null;
}
