import { describe, expect, it } from 'vitest';
import { backgroundOfLevel, levelHeld, objectsOnLevel, shownLevel } from '../../../src/connect/stockLevels';

const levels = [{ id: 'ground', background: null }, { id: 'upper', background: 'upper.png' }];
const objects = {
  tokens: { a: { id: 'a' }, b: { id: 'b', level: 'upper' } },
  walls: { w1: { id: 'w1' }, w2: { id: 'w2', levels: ['upper'] }, w3: { id: 'w3', levels: 'all' } },
  initiative: 'kept',
};

describe('Atlas 0.10 levels', () => {
  it('sends players the one floor shown, never the others', () => {
    expect(Object.keys(objectsOnLevel(objects, levels, 'ground').tokens)).toEqual(['a']);
    expect(Object.keys(objectsOnLevel(objects, levels, 'upper').tokens)).toEqual(['b']);
    expect(Object.keys(objectsOnLevel(objects, levels, 'upper').walls)).toEqual(['w2', 'w3']);
    expect(objectsOnLevel(objects, levels, 'ground').initiative).toBe('kept');
  });

  it('shows the first floor for a floor the scene does not have', () => {
    expect(shownLevel(levels, 'gone')).toBe('ground');
    expect(shownLevel(levels, undefined)).toBe('ground');
    expect(Object.keys(objectsOnLevel(objects, levels, 'gone').tokens)).toEqual(['a']);
  });

  it('uses the shown floor\'s map image; the first floor\'s is the scene\'s own', () => {
    expect(backgroundOfLevel('ground.png', levels, 'ground')).toBe('ground.png');
    expect(backgroundOfLevel('ground.png', levels, 'upper')).toBe('upper.png');
  });

  it('leaves a scene of one level, or a stock Atlas without levels, exactly as it was', () => {
    expect(objectsOnLevel(objects, undefined, undefined)).toBe(objects);
    expect(objectsOnLevel(objects, [{ id: 'only' }], 'only')).toBe(objects);
    expect(shownLevel(undefined, 'x')).toBeNull();
    expect(backgroundOfLevel('ground.png', undefined, undefined)).toBe('ground.png');
  });
});

describe('the level players see against the one the GM looks at', () => {
  it('holds while the GM looks at a level the player view does not show', () => {
    // The player view shows the presented level, the first where none is named: not the GM's.
    expect(levelHeld(levels, 'upper', undefined)).toBe(true);
    expect(levelHeld(levels, 'upper', 'ground')).toBe(true);
    expect(levelHeld(levels, 'ground', 'upper')).toBe(true);
    expect(levelHeld(levels, 'ground', undefined)).toBe(false);
    expect(levelHeld(levels, 'upper', 'upper')).toBe(false);
    expect(levelHeld(levels, null, undefined)).toBe(false);
  });

  it('counts a level the scene lacks as none named, and holds nothing for a scene without levels', () => {
    expect(levelHeld(levels, 'ground', 'gone')).toBe(false);
    expect(levelHeld(levels, 'upper', 'gone')).toBe(true);
    expect(levelHeld(undefined, 'upper', 'ground')).toBe(false);
    expect(levelHeld([{ id: 'only' }], 'only', 'other')).toBe(false);
  });
});
