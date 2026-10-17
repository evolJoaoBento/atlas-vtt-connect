import { describe, expect, it } from 'vitest';
import type { PlayerInitiative, PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { NO_TURN, turnNotice, turnOf } from '../../../src/app/online/view/turns';
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
});
