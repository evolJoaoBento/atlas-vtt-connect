import { describe, expect, it } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import { LIQUID_LIMITS, projectLiquids } from '../../../src/app/online/scene/projectLiquids';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { PlayerLiquid } from '../../../src/app/online/scene/sceneTypes';
import { createMapLayer } from '../../../src/app/online/view/layers/mapLayer';
import { fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const ring = (n = 4) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: (i % 2) * 10 }));
const pool = (extra: Record<string, unknown> = {}) => ({ kind: 'liquid', liquid: 'water', polygon: ring(), ...extra });

function scene(liquids: unknown) {
  const state: SceneSnapshot = snapshotOf({ background: 'atlas-vtt/assets/lair.png' });
  const withLiquids = { ...state, objects: { ...state.objects, liquids } } as SceneSnapshot;
  const rules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
  return projectForPlayers(withLiquids, { sceneId: 's', rules, coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, resources: [] });
}

describe('liquids on the map (Atlas 0.10)', () => {
  it('reads water, lava and acid with their colours, holes and the default palette of a kind', () => {
    const [water, lava] = projectLiquids({
      a: pool({ holes: [ring(3)], colors: { surface: '#112233', deep: '#445566', glint: '#778899' } }),
      b: pool({ liquid: 'lava', colors: { surface: 'red' } }),
    });
    expect(water).toMatchObject({ liquid: 'water', colors: { surface: '#112233', deep: '#445566', glint: '#778899' } });
    expect(water!.holes).toHaveLength(1);
    expect(lava!.colors).toEqual({ surface: '#ea580c', deep: '#7c2d12', glint: '#fde047' });
  });

  it('leaves out what Atlas could not have made and keeps within the limits', () => {
    expect(projectLiquids(null)).toEqual([]);
    expect(projectLiquids({ a: pool({ liquid: 'oil' }), b: pool({ polygon: ring(2) }), c: pool({ kind: 'wall' }), d: pool({ polygon: [{ x: 'a', y: 1 }, ...ring(3)] }) })).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`l${i}`, pool()]));
    expect(projectLiquids(many)).toHaveLength(LIQUID_LIMITS.liquids);
    const manyHoles = projectLiquids({ a: pool({ holes: Array.from({ length: 30 }, () => ring(3)) }) });
    expect(manyHoles[0]!.holes).toHaveLength(LIQUID_LIMITS.holes);
  });

  it('goes out inside the map, validates, and is absent without liquids', () => {
    const withPool = scene({ a: pool() });
    expect(withPool.map.liquids).toHaveLength(1);
    expect(isPlayerSceneBody(withPool)).toBe(true);
    expect(scene({}).map).not.toHaveProperty('liquids');
    expect(scene(undefined).map).not.toHaveProperty('liquids');
  });

  it('is refused on the wire when malformed', () => {
    const good = scene({ a: pool() });
    const bad = (liquids: unknown) => isPlayerSceneBody({ ...good, map: { ...good.map, liquids } });
    expect(bad([{ liquid: 'oil', polygon: ring(), colors: good.map.liquids![0]!.colors }])).toBe(false);
    expect(bad([{ ...good.map.liquids![0]!, colors: { surface: 'blue', deep: '#000000', glint: '#000000' } }])).toBe(false);
    expect(bad([{ ...good.map.liquids![0]!, polygon: ring(2) }])).toBe(false);
    expect(bad('water')).toBe(false);
  });

  it('draws over the map image: the surface with its holes cut out, then a glint on the edge', () => {
    const liquid: PlayerLiquid = { liquid: 'water', polygon: ring(), holes: [ring(3)], colors: { surface: '#3b82f6', deep: '#1e3a8a', glint: '#93c5fd' } };
    const base = playerScene();
    const surface = new RecordingSurface();
    createMapLayer().draw(surface, frame({ ...base, map: { ...base.map, liquids: [liquid] } }));
    const paths = surface.calls.filter((call) => call.op === 'paths');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ closed: true, style: { fill: '#3b82f6', evenOdd: true } });
    expect((paths[0] as { paths: unknown[] }).paths).toHaveLength(2);
    expect(paths[1]).toMatchObject({ style: { stroke: '#93c5fd' } });
  });
});
