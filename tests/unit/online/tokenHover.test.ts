import { describe, expect, it } from 'vitest';
import { hoverCardFor, tokenAt } from '../../../src/app/online/view/tokenHover';
import { playerScene, playerToken } from './sceneFixtures';

describe("a player's token card", () => {
  const scene = playerScene({
    tokens: {
      hero: playerToken({ name: 'Anna', conditions: [{ id: 'f', value: 2, name: 'Frightened', color: '#ff0000' }, { id: 'p', value: null, name: 'Prone' }, { id: 'x', value: null }] }),
      rock: playerToken({ x: 300, name: null, conditions: [] }),
      top: playerToken({ x: 100, layer: 5, name: 'Bat' }),
    },
  });

  it('names the token and spells out its conditions, leaving out what the GM sends unnamed', () => {
    expect(hoverCardFor(scene, 'hero', null)).toEqual({ title: 'Anna', lines: [{ text: 'Frightened 2', color: '#ff0000' }, { text: 'Prone' }] });
    expect(hoverCardFor(scene, 'rock', null)).toBeNull();
    expect(hoverCardFor(scene, 'nobody', null)).toBeNull();
  });

  it("shows the player's own numbers first", () => {
    const numbers = { resources: [{ name: 'HP', current: 7, max: 12, color: '#22c55e' }, { name: 'Temp', current: 2.5, max: 5 }] };
    expect(hoverCardFor(scene, 'rock', numbers)?.lines).toEqual([{ text: 'HP 7 / 12', color: '#22c55e' }, { text: 'Temp 2.5 / 5' }]);
  });

  it('finds the topmost token under a point, at the position shown', () => {
    expect(tokenAt(scene, new Map(), { x: 100, y: 100 })).toBe('top');
    expect(tokenAt(scene, new Map(), { x: 300, y: 100 })).toBe('rock');
    expect(tokenAt(scene, new Map([['rock', { x: 900, y: 900 }]]), { x: 900, y: 900 })).toBe('rock');
    expect(tokenAt(scene, new Map(), { x: 2000, y: 2000 })).toBeNull();
  });
});
