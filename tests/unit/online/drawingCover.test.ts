import { describe, expect, it } from 'vitest';
import type { DrawingStroke, FogOperation, SceneSnapshot } from '@atlas-vtt/api-types';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { projectCutscene, type CutsceneProjectionOptions } from '../../../src/app/online/scene/projectCutscene';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import type { PlayerDrawing } from '../../../src/app/online/scene/sceneTypes';
import { createDrawingsLayer } from '../../../src/app/online/view/layers/drawingsLayer';
import { createMapLayer } from '../../../src/app/online/view/layers/mapLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { coverageOfFog, fakeAssetIds, playerScene, projectForPlayers, snapshotOf } from './sceneFixtures';

const RULES = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const MAP = { width: 1000, height: 800 };
const ring = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }, { x, y }];
const drawing = (id: string, more: Record<string, unknown>): DrawingStroke => ({ id, kind: 'drawing', timestamp: 1, type: 'rectangle', points: ring(100, 100, 200), color: '#000000', width: 3, opacity: 1, ...more } as DrawingStroke);
const fogRect = (id: string, x: number, y: number, width: number, height: number, isErasing = false): FogOperation => ({ id, kind: 'fog', type: 'rectangle', timestamp: 1, isErasing, x, y, width, height } as FogOperation);
const fogOf = (...ops: FogOperation[]): Record<string, FogOperation> => Object.fromEntries(ops.map((op) => [op.id, op]));

function project(drawings: Record<string, DrawingStroke>, fog: Record<string, FogOperation>): Record<string, PlayerDrawing> {
  const base = snapshotOf({ mapSize: MAP, grid: { enabled: true, size: 50, type: 'square', offsetX: 0, offsetY: 0 } as never });
  const snapshot: SceneSnapshot = { ...base, objects: { ...base.objects, drawings, fog } };
  const context: ProjectionContext = { sceneId: 's', rules: RULES, coverage: coverageOfFog(fog), assets: fakeAssetIds(), mapSize: MAP };
  return projectForPlayers(snapshot, context).drawings;
}

describe("a box the GM covers part of the map with (Atlas 0.16's fills)", () => {
  it('is sent while any part of it is out of the fog (players see the part the fog does not cover); a line half in the fog is not', () => {
    // The fog covers all but the map's left half: the box straddles its edge.
    const fog = fogOf(fogRect('all', 0, 0, 1000, 800), fogRect('left', 0, 0, 200, 800, true));
    const sent = project({ box: drawing('box', { fill: 'solid', width: 0 }), line: drawing('line', {}) }, fog);
    expect(Object.keys(sent)).toEqual(['box']);
    // A box wholly under the fog is not sent.
    expect(project({ box: drawing('box', { fill: 'solid', points: ring(400, 400, 100) }) }, fog)).toEqual({});
  });

  it('is stacked in the order Atlas stacks it (`order`, sent as `stack`, then the time it was drawn)', () => {
    // A route drawn first and cut later (its pieces take a new time), a box drawn between: the box stays on top.
    const sent = project({
      routeA: drawing('routeA', { type: 'pen', timestamp: 900, order: 1, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }),
      box: drawing('box', { timestamp: 500, order: 2, fill: 'solid' }),
      routeB: drawing('routeB', { type: 'pen', timestamp: 901, order: 1, points: [{ x: 60, y: 60 }, { x: 90, y: 90 }] }),
      old: drawing('old', { type: 'pen', timestamp: 100, points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }),
    }, {});
    const byRank = Object.entries(sent).sort(([, a], [, b]) => (a.stack ?? 0) - (b.stack ?? 0) || a.order - b.order).map(([id]) => id);
    expect(byRank).toEqual(['old', 'routeA', 'routeB', 'box']);
  });

  it('a cutscene too large to send sheds drawings without a fill first, and never a fill', () => {
    const base = snapshotOf({ mapSize: MAP });
    const lines = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`l${i}`, drawing(`l${i}`, { type: 'pen', points: Array.from({ length: 400 }, (_, k) => ({ x: k, y: i * 10 + (k % 7) })) })]));
    const snapshot: SceneSnapshot = { ...base, objects: { ...base.objects, drawings: { ...lines, box: drawing('box', { fill: 'solid' }) } } };
    const options: CutsceneProjectionOptions = {
      settings: { getLocalPlayerViewSettings: () => RULES, onChange: () => () => undefined },
      assets: { ...fakeAssetIds(), onChange: () => () => undefined },
    };
    const { scene, fits } = projectCutscene(snapshot, options, null, 'cutscene:r:k1', createProjectionMemo(), 20_000);
    expect(fits).toBe(true);
    expect(Object.keys(scene.drawings)).toEqual(['box']);
  });

  it("is filled by Atlas's rule (nonzero): a hole cut out whichever way it winds; a drawing on the map's layer lies under the grid and the tokens", () => {
    const hole = [{ x: 140, y: 140 }, { x: 160, y: 140 }, { x: 160, y: 160 }];
    const drawings: Record<string, PlayerDrawing> = {
      box: { type: 'rectangle', order: 1, points: ring(100, 100, 200), color: '#000000', width: 0, opacity: 1, icon: null, fill: 'solid', holes: [hole] },
      floor: { type: 'rectangle', order: 2, points: ring(0, 0, 50), color: '#336699', width: 0, opacity: 0.4, icon: null, fill: 'solid', layer: 'map' },
    };
    const above = new RecordingSurface();
    createDrawingsLayer().draw(above, frame(playerScene({ drawings })));
    // The box only, its hole wound against its outline (the box runs clockwise on screen, so the hole runs the other way).
    expect(above.calls).toHaveLength(1);
    const [call] = above.calls as Array<{ op: string; paths: Array<Array<{ x: number; y: number }>>; style: Record<string, unknown> }>;
    expect(call!.style).toEqual({ fill: '#000000', alpha: 1 });
    const area = (points: Array<{ x: number; y: number }>) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p.x * q.y - q.x * p.y; }, 0);
    expect(Math.sign(area(call!.paths[0]!))).toBe(-Math.sign(area(call!.paths[1]!)));
    // The floor is drawn with the map, under the grid and the tokens.
    const map = new RecordingSurface();
    createMapLayer().draw(map, frame(playerScene({ drawings })));
    expect(map.calls.some((entry) => entry.op === 'paths')).toBe(true);
  });
});
