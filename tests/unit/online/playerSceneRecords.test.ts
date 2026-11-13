import { describe, expect, it } from 'vitest';
import { gridUnits } from '../../../src/app/online/obsidian/playerSceneRecords';
import { playerScene } from './sceneFixtures';

describe("the grid units an Obsidian player's Atlas measures with", () => {
  const measurement = playerScene().measurement;

  it('keeps a custom unit and its name, so the ruler reads "8 mi" and not a bare number', () => {
    expect(gridUnits({ ...measurement, unitType: 'custom', unitName: 'mi', unitDistance: 1 })).toMatchObject({ unitType: 'custom', unitNameOverride: 'mi', unitDistance: 1 });
  });

  it('names nothing where the GM named nothing', () => {
    expect(gridUnits({ ...measurement, unitType: 'feet' })).not.toHaveProperty('unitNameOverride');
    expect(gridUnits({ ...measurement, unitType: 'feet' })).toMatchObject({ unitType: 'feet' });
  });
});
