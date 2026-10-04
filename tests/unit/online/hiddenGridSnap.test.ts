import { describe, expect, it } from 'vitest';
import type { GridState } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * A grid players do not see (hidden, switched off, or kept from them by the player view rules) still
 * decides where the GM's check puts a dropped token (`tokens.snapPoint`). The projection must send that
 * grid's geometry in the measurement so the page's drag ruler and the Online scene's drag land on the same
 * point. This file pins what the projection sends; that the GM, the page ruler and the Online scene then
 * land on one point is checked where they exist (the token snapping, the join page and the player tab).
 */
const ALL_ON: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };

function project(grid: GridState | null, rules: PlayerViewRules = ALL_ON): PlayerScene {
  return projectForPlayers(snapshotOf({ background: 'maps/lair.png', grid }), {
    sceneId: 'scene-1', rules, coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 },
  });
}

const HIDDEN: ReadonlyArray<{ name: string; grid: GridState; rules?: PlayerViewRules }> = [
  { name: 'a hidden square grid with an offset', grid: { enabled: true, visible: false, type: 'square', size: 70, offsetX: 23, offsetY: 41, opacity: 1 } },
  { name: 'a switched-off flat hex grid', grid: { enabled: false, type: 'hex-vertical', size: 64, offsetX: 10, offsetY: 7, opacity: 1 } },
  {
    name: 'a pointy hex grid kept from players',
    grid: { enabled: true, visible: true, type: 'hex-horizontal', size: 64, offsetX: -5, offsetY: 30, opacity: 1 },
    rules: { ...ALL_ON, showGrid: false },
  },
];

describe('snapping on a grid players do not see', () => {
  it.each(HIDDEN)('sends the GM grid as the snap grid while players see none: $name', ({ grid, rules }) => {
    const scene = project(grid, rules);
    expect(scene.grid).toBeNull();
    const { fog: _fog, drawings: _drawings, ...body } = scene;
    expect(isPlayerSceneBody(body)).toBe(true);
    expect(scene.measurement.snapGrid).toEqual({ type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY });
  });

  it('snaps nowhere on a map without a grid, as the GM does not', () => {
    const scene = project(null);
    expect(scene.measurement.snapGrid).toBeNull();
  });
});
