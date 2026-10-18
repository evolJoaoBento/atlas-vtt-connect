import { describe, expect, it } from 'vitest';
import type { PlayerInitiative, PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { NO_TURN, nextTurnOf, turnNotice, turnOf } from '../../../src/app/online/view/turns';
import { playerScene, playerToken } from './sceneFixtures';

const entry = (tokenId: string, isActive = false) => ({ id: `e-${tokenId}`, tokenId, initiative: 10, name: null, hp: null, isActive });

function withInitiative(initiative: PlayerInitiative | null): PlayerScene {
  return { ...playerScene({ tokens: { a: playerToken({ name: 'Anna', side: 'players' }), b: playerToken({ name: 'Goblin', side: 'opponents' }) } }), initiative };
}

describe('whose turn it is', () => {
  it('in turn order: the active entry, and the player whose token it is', () => {
    const scene = withInitiative({ round: 1, active: true, entries: [entry('a', true), entry('b')] });
    expect(turnOf(scene, new Set(['a']))).toEqual({ tokenId: 'a', mine: true, name: 'Anna' });
    expect(turnOf(scene, new Set(['b']))).toEqual({ tokenId: 'a', mine: false, name: null });
    expect(turnNotice(turnOf(scene, new Set(['a'])))).toBe('Your turn: Anna');
  });

  it('by sides: every token of the acting side the player controls', () => {
    const scene = withInitiative({ round: 1, active: true, entries: [entry('a'), entry('b')], sides: { first: 'players', active: 'opponents' } });
    expect(turnOf(scene, new Set(['b']))).toEqual({ tokenId: null, mine: true, name: 'Goblin' });
    expect(turnOf(scene, new Set(['a'])).mine).toBe(false);
  });

  it('nobody before a fight, without a list or for a token players do not see', () => {
    expect(turnOf(withInitiative({ round: 1, active: false, entries: [entry('a', true)] }), new Set(['a']))).toBe(NO_TURN);
    expect(turnOf(withInitiative(null), new Set(['a']))).toBe(NO_TURN);
    expect(turnOf(withInitiative({ round: 1, active: true, entries: [entry('gone', true)] }), new Set(['gone']))).toBe(NO_TURN);
    expect(turnNotice(NO_TURN)).toBeNull();
  });

  it('says "Your turn is next" on the turn before the player\'s, skipping who sits out, and wrapping to a new round', () => {
    const tokens = { a: playerToken({ name: 'Anna', side: 'players' }), b: playerToken({ name: 'Goblin', side: 'opponents' }), c: playerToken({ name: 'Orc', side: 'opponents' }) };
    const scene = (initiative: PlayerInitiative): PlayerScene => ({ ...playerScene({ tokens }), initiative });
    const goblinActs = scene({ round: 1, active: true, entries: [entry('b', true), { ...entry('c'), sitsOut: true }, entry('a')] });
    expect(nextTurnOf(goblinActs, new Set(['a']))).toEqual({ tokenId: 'a', mine: true, name: 'Anna' });
    expect(turnNotice(turnOf(goblinActs, new Set(['a'])), nextTurnOf(goblinActs, new Set(['a'])))).toBe('Your turn is next: Anna');
    // The last entry acts: the first of the next round is next.
    const orcActs = scene({ round: 1, active: true, entries: [entry('a'), entry('b'), entry('c', true)] });
    expect(nextTurnOf(orcActs, new Set(['a'])).mine).toBe(true);
    // Not next: someone else is.
    const annaWaits = scene({ round: 1, active: true, entries: [entry('b', true), entry('c'), entry('a')] });
    expect(turnNotice(turnOf(annaWaits, new Set(['a'])), nextTurnOf(annaWaits, new Set(['a'])))).toBeNull();
    // On the player's own turn, that is what they read.
    const annaActs = scene({ round: 1, active: true, entries: [entry('a', true), entry('b')] });
    expect(turnNotice(turnOf(annaActs, new Set(['a'])), nextTurnOf(annaActs, new Set(['a'])))).toBe('Your turn: Anna');
    expect(turnNotice(NO_TURN, { tokenId: 'a', mine: true, name: null })).toBe('Your turn is next');
  });

  it('by sides: the other side is next', () => {
    const scene = withInitiative({ round: 1, active: true, entries: [entry('a'), entry('b')], sides: { first: 'players', active: 'opponents' } });
    expect(nextTurnOf(scene, new Set(['a']))).toEqual({ tokenId: null, mine: true, name: 'Anna' });
    expect(nextTurnOf(scene, new Set(['b'])).mine).toBe(false);
  });

  it('nothing is next before a fight, without a list, or with one combatant', () => {
    expect(nextTurnOf(withInitiative({ round: 1, active: false, entries: [entry('b', true), entry('a')] }), new Set(['a']))).toBe(NO_TURN);
    expect(nextTurnOf(withInitiative(null), new Set(['a']))).toBe(NO_TURN);
    expect(nextTurnOf(withInitiative({ round: 1, active: true, entries: [entry('a', true)] }), new Set(['a']))).toBe(NO_TURN);
  });
});
