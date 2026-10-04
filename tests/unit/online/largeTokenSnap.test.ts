import { describe, expect, it } from 'vitest';
import type { GridState } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { snapGridOfState } from '../../../src/app/online/scene/projectForPlayers';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * Online players' token moves snap as the GM's drag does (`tokens.snapPoint`, upstream #207). The
 * projection's share of that is the snap grid it sends: the GM grid's type, size and offsets while the
 * GM snaps, and none where the GM snaps nothing. That a token of each size then lands on the same point
 * on the GM and on the page is checked where the snapping lives (the page's drag ruler, the token tools).
 */
const SIZE = 70;
const OFFSET = { x: 13, y: 29 };
const TYPES = ['square', 'hex-vertical', 'hex-horizontal'] as const;

function gridState(type: NonNullable<GridState['type']>, overrides: Partial<GridState> = {}): GridState {
  return { enabled: true, visible: true, type, size: SIZE, offsetX: OFFSET.x, offsetY: OFFSET.y, opacity: 1, snapToGrid: true, ...overrides };
}

function project(grid: GridState | null): PlayerScene {
  return projectForPlayers(snapshotOf({ background: 'maps/lair.png', grid }), {
    sceneId: 'scene-1', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
    coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 },
  });
}

describe("online token moves snap as the GM's drag", () => {
  it.each(TYPES)('sends the grid every token size snaps to (%s)', (type) => {
    const scene = project(gridState(type));
    expect(scene.measurement.snapGrid).toEqual({ type, size: SIZE, offsetX: OFFSET.x, offsetY: OFFSET.y });
    expect(scene.measurement.snapGrid).toEqual(snapGridOfState(gridState(type)));
  });

  it('follows the snap-to-grid setting the GM sends, for every size', () => {
    const scene = project(gridState('square', { snapToGrid: false }));
    expect(scene.measurement.snapToGrid).toBe(false);
    expect(scene.measurement.snapGrid).toBeNull();
    expect(snapGridOfState(gridState('square', { snapToGrid: false }))).toBeNull();
  });

  it('snaps nowhere on a grid without a usable cell size', () => {
    expect(snapGridOfState(gridState('square', { size: 0 }))).toBeNull();
    expect(snapGridOfState(gridState('square', { size: Number.NaN }))).toBeNull();
    expect(snapGridOfState(null)).toBeNull();
  });

  it('defaults a missing type to square and missing offsets to zero', () => {
    const { type: _type, ...untyped } = gridState('square');
    expect(snapGridOfState({ ...untyped, offsetX: undefined as unknown as number, offsetY: undefined as unknown as number })).toEqual({ type: 'square', size: SIZE, offsetX: 0, offsetY: 0 });
  });
});
