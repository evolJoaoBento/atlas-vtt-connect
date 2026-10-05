import { describe, expect, it } from 'vitest';
import { cellNumberFontSize } from '@atlas-vtt/shared/grid';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { createGridLayer, MIN_CELL_NUMBER_SCREEN_SIZE } from '../../../src/app/online/view/layers/gridLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

// The fork's `sharedLayout` test compared the page with Atlas's PIXI `CellNumberLabels`, which Connect does not
// have. The page's side of it stays: Atlas hides a number below 7 CSS pixels on screen, so does the page.
describe('cell numbers on the join page', () => {
  const grid: PlayerGrid = { ...playerScene().grid!, cellNumbers: 'column-row', cellNumberOpacity: 1 };
  const numbers = (zoom: number): number => {
    const surface = new RecordingSurface();
    createGridLayer().draw(surface, frame(playerScene({ grid }), { zoom }));
    return surface.ops('text').length;
  };

  it('hide below 7 CSS pixels on screen', () => {
    expect(MIN_CELL_NUMBER_SCREEN_SIZE).toBe(7);
  });

  it("hide where Atlas's cell numbers hide: below the readable size, shown just above it", () => {
    const fontSize = cellNumberFontSize(grid.size);
    expect(numbers((MIN_CELL_NUMBER_SCREEN_SIZE + 0.01) / fontSize)).toBeGreaterThan(0);
    expect(numbers((MIN_CELL_NUMBER_SCREEN_SIZE - 0.01) / fontSize)).toBe(0);
    expect(numbers((MIN_CELL_NUMBER_SCREEN_SIZE + 0.01) / fontSize)).toBeGreaterThan(0);
  });
});
