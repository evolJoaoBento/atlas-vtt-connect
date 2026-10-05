import type { FogOperation, GridState, InitiativeState, Point, SceneSnapshot } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { projectForPlayers as projectWithMemo, type ProjectionContext, type ProjectionInput } from '../../../src/app/online/scene/projectForPlayers';
import { createProjectionMemo, projectFog } from '../../../src/app/online/scene/projectRecords';
import type { AssetIds } from '../../../src/app/online/scene/sceneContracts';
import type { PlayerFogOp, PlayerScene, PlayerSceneBody, PlayerToken, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

/** An idle tracker, as Atlas starts one (the type only reaches Connect, so the value is built here). */
export const createDefaultInitiativeState = (): InitiativeState => ({
  entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true },
});

/** A loaded, empty, unlit scene as the API's snapshot carries it; `partial` replaces whole fields. */
export function snapshotOf(partial: Partial<SceneSnapshot> = {}): SceneSnapshot {
  return {
    viewId: 'view-1',
    mapPath: 'maps/tavern.atlasmap',
    loaded: true,
    mapSize: { width: 1000, height: 800 },
    background: null,
    grid: null,
    objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    lighting: { enabled: false, ambient: 1 },
    ...partial,
  };
}

/** Where the GM's own drag lands a token on a map holding `grid`: Atlas's `tokens.snapPoint`, which the fake mirrors (C-tok-2). */
export function gmSnapPoint(grid: GridState | null): (point: Point, tokenSize: number) => Readonly<Point> {
  const atlas = new FakeAtlas({ capabilities: ['views', 'tokens'] });
  const { viewId: _viewId, ...scene } = snapshotOf({ grid });
  atlas.views.setSnapshot('view-1', scene);
  const { tokens } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  return (point, tokenSize) => tokens.snapPoint('view-1', point, tokenSize);
}

/** `projectForPlayers` with a memo of its own for each call. */
export function projectForPlayers(snapshot: ProjectionInput, context: ProjectionContext): ReturnType<typeof projectWithMemo> {
  return projectWithMemo(snapshot, context, createProjectionMemo());
}

export function playerToken(overrides: Partial<PlayerToken> = {}): PlayerToken {
  return {
    x: 100, y: 100, size: 1, rotation: 0, layer: 0, image: 'asset-1', ring: '#ffffff',
    conditions: [], name: null, hp: null, stress: null, ...overrides,
  };
}

export function fogRect(order: number, overrides: Partial<Extract<PlayerFogOp, { type: 'rectangle' }>> = {}): PlayerFogOp {
  return { type: 'rectangle', erase: false, order, x: 0, y: 0, width: 100, height: 100, ...overrides };
}

/** Coverage built the way the app builds it: from the fog players receive. */
export function coverageOfFog(fog: Readonly<Record<string, FogOperation>>): FogCoverage {
  return FogCoverage.fromPlayerFog(projectFog(fog, createProjectionMemo()));
}

export function playerScene(overrides: Partial<PlayerScene> = {}): PlayerScene {
  return {
    sceneId: 'scene-1',
    map: { asset: 'map-asset', width: 1000, height: 800, cellSize: 70 },
    grid: {
      type: 'square', size: 70, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
      lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null,
    },
    tokens: { t1: playerToken() },
    fog: { f1: fogRect(1) },
    texts: {
      x1: {
        x: 50, y: 50, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#000000', backgroundColor: null,
        padding: 4, borderRadius: 0, opacity: 1, width: null, height: null, align: 'center',
        bold: false, italic: false, rotation: 0, scale: 1,
      },
    },
    drawings: {
      d1: { type: 'pen', order: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0000', width: 4, opacity: 1, icon: null },
    },
    widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 3 }],
    initiative: { round: 1, active: true, entries: [{ id: 'e1', tokenId: 't1', initiative: 15, name: null, hp: null, isActive: true }] },
    measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true, coneAngle: 90 },
    ...overrides,
  };
}

/** The scene as a snapshot carries it: everything but the fog and the drawings. */
export function sceneBody(scene: PlayerScene): PlayerSceneBody {
  const { fog: _fog, drawings: _drawings, ...body } = scene;
  return body;
}

/** A valid fingerprint made up from a number, for tests that need many different ones. */
export function fingerprint(n: number): string {
  return String(n).padStart(43, 'A');
}

/** A scene whose map and tokens (`t0`, `t1`, ...) show these images; null for none. */
export function sceneWithImages(mapAsset: string | null, tokenImages: ReadonlyArray<string | null>): PlayerScene {
  return playerScene({
    map: { asset: mapAsset, width: 1000, height: 800, cellSize: 70 },
    tokens: Object.fromEntries(tokenImages.map((image, index) => [`t${index}`, playerToken({ image })])),
  });
}

/** Asset ids as the projection sees them, without hashing: one stable id per path, `asset-1` first. */
export function fakeAssetIds(): AssetIds {
  const ids = new Map<string, string>();
  return {
    idFor: (path) => {
      if (typeof path !== 'string' || path.length === 0) return null;
      if (!ids.has(path)) ids.set(path, `asset-${ids.size + 1}`);
      return ids.get(path) ?? null;
    },
  };
}

/** Whether `point` lies inside the ring by nonzero winding, as both clients' canvases fill a fog lasso. */
export function insideByNonzero(ring: readonly ScenePoint[], point: ScenePoint): boolean {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if ((a.y <= point.y) === (b.y <= point.y)) continue;
    const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (x > point.x) winding += b.y > a.y ? 1 : -1;
  }
  return winding !== 0;
}
