import { describe, expect, it } from 'vitest';
import { heldOffTurn } from '../../../src/app/online/control/turnHold';
import type { PlayerInitiative, PlayerInitiativeEntry, PlayerSide } from '../../../src/app/online/scene/sceneTypes';
import { playerToken } from './sceneFixtures';

const entry = (tokenId: string, patch: Partial<PlayerInitiativeEntry> = {}): PlayerInitiativeEntry => ({
  id: tokenId, tokenId, initiative: 10, name: tokenId, hp: null, isActive: false, ...patch,
});
const scene = (initiative: PlayerInitiative | null, sides: Record<string, PlayerSide> = {}) => ({
  initiative,
  tokens: Object.fromEntries(['ana', 'bo', 'orc', 'loose'].map((id) => [id, playerToken(sides[id] ? { side: sides[id] } : {})])),
});

describe('which tokens a running fight holds still (Atlas: players move only on their turn)', () => {
  it('holds every token in the fight but the one whose turn it is, in a list in turn order', () => {
    const fight = scene({ round: 2, active: true, entries: [entry('ana', { isActive: true }), entry('bo'), entry('orc')] });
    expect(heldOffTurn(fight, 'ana')).toBe(false);
    expect(heldOffTurn(fight, 'bo')).toBe(true);
    expect(heldOffTurn(fight, 'orc')).toBe(true);
    // A token that is not in the fight is never held.
    expect(heldOffTurn(fight, 'loose')).toBe(false);
    expect(heldOffTurn(fight, 'nobody')).toBe(false);
  });

  it('holds nothing without a list, or between fights', () => {
    expect(heldOffTurn(scene(null), 'ana')).toBe(false);
    expect(heldOffTurn(scene({ round: 0, active: false, entries: [entry('ana')] }), 'ana')).toBe(false);
  });

  it('by sides, lets every combatant of the side whose turn it is move, and holds the others and those who sit out', () => {
    const fight = scene({ round: 1, active: true, entries: [entry('ana'), entry('bo', { sitsOut: true }), entry('orc')], sides: { first: 'players', active: 'players' } },
      { ana: 'players', bo: 'players', orc: 'opponents' });
    expect(heldOffTurn(fight, 'ana')).toBe(false);
    expect(heldOffTurn(fight, 'bo')).toBe(true);
    expect(heldOffTurn(fight, 'orc')).toBe(true);
    const theirs = scene({ round: 1, active: true, entries: [entry('ana'), entry('orc')], sides: { first: 'players', active: 'opponents' } }, { ana: 'players', orc: 'opponents' });
    expect(heldOffTurn(theirs, 'ana')).toBe(true);
    expect(heldOffTurn(theirs, 'orc')).toBe(false);
    // No side has the turn yet: every combatant waits.
    expect(heldOffTurn(scene({ round: 1, active: true, entries: [entry('ana')], sides: { first: 'players' } }, { ana: 'players' }), 'ana')).toBe(true);
  });
});
