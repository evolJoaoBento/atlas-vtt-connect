import { describe, expect, it } from 'vitest';
import { controlledTokenAt } from '../../../src/app/online/view/tokenHit';
import { playerScene, playerToken } from './sceneFixtures';

// On the 70 px cells of `playerScene` a size-1 token's art is 62 px wide: radius 31.
const scene = playerScene({
  tokens: {
    low: playerToken({ x: 100, y: 100, layer: 0 }),
    high: playerToken({ x: 120, y: 100, layer: 1 }),
    other: playerToken({ x: 300, y: 100 }),
  },
});
const both = new Set(['low', 'high']);
const unmoved = new Map<string, { x: number; y: number }>();

describe('controlledTokenAt', () => {
  it('finds a controlled token inside the circle its art is drawn in', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 70, y: 100 })).toBe('low');
    expect(controlledTokenAt(scene, both, unmoved, { x: 68, y: 100 })).toBeNull();
  });

  it('takes the topmost of overlapping tokens, as the tokens layer draws them', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 110, y: 100 })).toBe('high');
  });

  it('ignores tokens the player does not control, and ids the scene does not have', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 300, y: 100 })).toBeNull();
    expect(controlledTokenAt(scene, new Set(['ghost', '__proto__']), unmoved, { x: 100, y: 100 })).toBeNull();
  });

  it('hits a dragged or waiting token where it is shown', () => {
    const moved = new Map([['low', { x: 500, y: 500 }]]);
    expect(controlledTokenAt(scene, new Set(['low']), moved, { x: 500, y: 520 })).toBe('low');
    expect(controlledTokenAt(scene, new Set(['low']), moved, { x: 100, y: 100 })).toBeNull();
  });
});
