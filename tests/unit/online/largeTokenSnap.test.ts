import { describe, expect, it } from 'vitest';
import type { GridState } from '@atlas-vtt/api-types';
import { axialToPixel, createHexLayout, hexCircumradius, nearestHexCenter, pixelToAxial } from '@atlas-vtt/shared/grid';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { snapGridOfState } from '../../../src/app/online/scene/projectForPlayers';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { toolGridOf } from '../../../src/app/online/view/tools/toolGrid';
import { remoteDropPoint } from './remoteDrop';
import { fakeAssetIds, gmSnapPoint, playerScene, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * Online players' token moves snap as the GM's drag does (`tokens.snapPoint`, upstream #207). The
 * projection's share of that is the snap grid it sends: the GM grid's type, size and offsets while the
 * GM snaps, and none where the GM snaps nothing. That a token of each size then lands on the same point
 * on the GM and on the page is checked here against `tokens.snapPoint` (the fake mirrors Atlas's C-tok-2) and the
 * page's drag ruler (`ToolGrid.snapDrag`), and the remote view's own drag, which Atlas snaps over the grid Connect
 * feeds it (`toRemoteScene`).
 */
const SIZE = 70;
const OFFSET = { x: 13, y: 29 };
const TYPES = ['square', 'hex-vertical', 'hex-horizontal'] as const;
const TOKEN_SIZES = [1, 1.5, 2, 2.5] as const;
const POINTS = [{ x: 300, y: 150 }, { x: 517.3, y: 402.9 }, { x: -40, y: 12 }, { x: 999, y: 1001 }];

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

  it('sends a grid type players accept, whatever the map holds', () => {
    const scene = project(gridState('square', { type: 'triangle' as unknown as NonNullable<GridState['type']> }));
    expect(scene.measurement.snapGrid?.type).toBe('square');
    const { fog: _fog, drawings: _drawings, ...body } = scene;
    expect(isPlayerSceneBody(body)).toBe(true);
  });

  it('defaults a missing type to square and missing offsets to zero', () => {
    const { type: _type, ...untyped } = gridState('square');
    expect(snapGridOfState({ ...untyped, offsetX: undefined as unknown as number, offsetY: undefined as unknown as number })).toEqual({ type: 'square', size: SIZE, offsetX: 0, offsetY: 0 });
  });
});

function toolGrid(type: NonNullable<GridState['type']>) {
  const base = playerScene();
  return toolGridOf({ ...base, grid: { ...base.grid!, type, size: SIZE, offsetX: OFFSET.x, offsetY: OFFSET.y } });
}

describe("the GM's check of a token drop and the page's drag ruler snap alike", () => {
  it.each(TYPES)('lands every token size on the same point on the GM and on the page (%s)', (type) => {
    const gm = gmSnapPoint(gridState(type));
    for (const tokenSize of TOKEN_SIZES) {
      for (const point of POINTS) {
        const landed = gm(point, tokenSize);
        const ruler = toolGrid(type).snapDrag(point, tokenSize);
        expect(ruler.x).toBeCloseTo(landed.x, 6);
        expect(ruler.y).toBeCloseTo(landed.y, 6);
      }
    }
  });

  it.each(TYPES)('lands every token size on the same point on the GM and in the remote view (%s)', async (type) => {
    const gm = gmSnapPoint(gridState(type));
    const scene = project(gridState(type));
    for (const tokenSize of TOKEN_SIZES) {
      for (const point of POINTS) {
        const landed = gm(point, tokenSize);
        const online = await remoteDropPoint(scene, point, tokenSize);
        expect(online?.x).toBeCloseTo(landed.x, 6);
        expect(online?.y).toBeCloseTo(landed.y, 6);
      }
    }
    // Snapping off on the GM's map: the remote view drops where the player let go, as the GM's drag does.
    expect(await remoteDropPoint(project(gridState(type, { snapToGrid: false })), { x: 300.5, y: 150.25 }, 1.5)).toEqual({ x: 300.5, y: 150.25 });
  });

  it('puts a Large token on a square grid where four cells meet', () => {
    const gm = gmSnapPoint(gridState('square'));
    for (const point of POINTS) {
      const snapped = gm(point, 1.5);
      expect((snapped.x - OFFSET.x) / SIZE).toBeCloseTo(Math.round((snapped.x - OFFSET.x) / SIZE), 6);
      expect((snapped.y - OFFSET.y) / SIZE).toBeCloseTo(Math.round((snapped.y - OFFSET.y) / SIZE), 6);
      expect(toolGrid('square').snapDrag(point, 1.5)).toEqual(snapped);
    }
    // A Medium or Huge one stays on a cell's centre.
    expect(gm({ x: 300, y: 150 }, 1)).toEqual({ x: 328, y: 134 });
    expect(gm({ x: 300, y: 150 }, 2)).toEqual({ x: 328, y: 134 });
  });

  it.each(['hex-vertical', 'hex-horizontal'] as const)('puts a Large token on a hex grid on a corner three hexes share (%s)', (type) => {
    const layout = createHexLayout(type, SIZE, OFFSET.x, OFFSET.y);
    const gm = gmSnapPoint(gridState(type));
    for (const point of POINTS) {
      const snapped = gm(point, 1.5);
      const around = pixelToAxial(layout, snapped);
      // The three hexes nearest the point are all one circumradius from it: it is their shared vertex.
      const distances = [-1, 0, 1].flatMap((dq) => [-1, 0, 1].map((dr) => axialToPixel(layout, { q: around.q + dq, r: around.r + dr })))
        .map((center) => Math.hypot(center.x - snapped.x, center.y - snapped.y))
        .sort((a, b) => a - b);
      for (const distance of distances.slice(0, 3)) expect(distance).toBeCloseTo(hexCircumradius(SIZE), 6);
      expect(distances[3]!).toBeGreaterThan(hexCircumradius(SIZE) + 1);
    }
    // A Huge one stays on a hex.
    expect(gm({ x: 300, y: 150 }, 2)).toEqual(nearestHexCenter(layout, { x: 300, y: 150 }));
  });

  it('follows the snap-to-grid setting the GM sends, for every size', () => {
    const base = playerScene();
    const free = toolGridOf({ ...base, measurement: { ...base.measurement, snapToGrid: false } });
    expect(free.snapDrag({ x: 300.5, y: 150.25 }, 1.5)).toEqual({ x: 300.5, y: 150.25 });
    expect(gmSnapPoint(gridState('square', { snapToGrid: false }))({ x: 300.5, y: 150.25 }, 1.5)).toEqual({ x: 300.5, y: 150.25 });
  });

  it('measures from cell centres whatever the token: the measure tool is not a drag', () => {
    expect(toolGrid('square').snap({ x: 300, y: 150 })).toEqual(gmSnapPoint(gridState('square'))({ x: 300, y: 150 }, 1));
  });
});
