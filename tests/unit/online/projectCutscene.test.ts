import { describe, expect, it } from 'vitest';
import type { Character, FogOperation, SceneSnapshot } from '@atlas-vtt/api-types';
import { CUTSCENE_SCENE_BYTES, projectCutscene, sceneBytes, type CutsceneProjectionOptions } from '../../../src/app/online/scene/projectCutscene';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import { isBoardExtras } from '../../../src/app/online/scene/boardValidation';
import { fakeAssetIds, snapshotOf } from './sceneFixtures';

const options = (): CutsceneProjectionOptions => ({
  settings: { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }), onChange: () => () => undefined },
  assets: { ...fakeAssetIds(), onChange: () => () => undefined },
});

function hero(id: string, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x: 140, y: 140, imagePath: 'tokens/hero.png', name: id, resources: {}, ...overrides } as Character;
}

/** A fog over the whole map: with it a player sees nothing. */
const FOG: Record<string, FogOperation> = {
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 1000, height: 800 } as FogOperation,
};

function scene(extra: Partial<SceneSnapshot> = {}, objects: Record<string, unknown> = {}): SceneSnapshot {
  const base = snapshotOf(extra);
  return { ...base, objects: { ...base.objects, tokens: { hero: hero('hero') }, ...objects } } as SceneSnapshot;
}

const project = (snapshot: SceneSnapshot) => projectCutscene(snapshot, options(), null, 'cutscene:r:k1', createProjectionMemo());

describe('projectCutscene', () => {
  it('sends a token under the GM fog and no fog at all', () => {
    const { scene: sent } = project(scene({}, { fog: FOG }));
    expect(Object.keys(sent.tokens)).toEqual(['hero']);
    expect(sent.fog).toEqual({});
  });

  it('sends tokens on a lit scene whatever its lighting frame says', () => {
    const { scene: sent } = project(scene({ lighting: { enabled: true, ambient: 0 } }));
    expect(Object.keys(sent.tokens)).toEqual(['hero']);
  });

  it('does not send a GM-hidden token', () => {
    const { scene: sent } = project(scene({}, { tokens: { hero: hero('hero'), ghost: hero('ghost', { isHidden: true }) } }));
    expect(Object.keys(sent.tokens)).toEqual(['hero']);
  });

  it('puts a wall of a fogged room in the extras, with a closed secret door as plain wall', () => {
    const walls = {
      w1: { id: 'w1', type: 'solid', p1: { x: 100, y: 100 }, p2: { x: 200, y: 100 } },
      s1: { id: 's1', type: 'secret-door', closed: true, p1: { x: 300, y: 100 }, p2: { x: 400, y: 100 } },
    };
    const { extras } = project(scene({}, { fog: FOG, walls }));
    expect(extras.walls.map((wall) => [wall.id, wall.type])).toEqual([['w1', 'solid'], ['s1', 'solid']]);
    expect(extras.walls[1]!.door).toBeUndefined();
    expect(isBoardExtras(extras)).toBe(true);
  });

  it('fits a scene of 5000 drawings under the cap, dropping the drawings', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ x: i * 3.14159, y: i * 2.71828 }));
    const drawings = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`d${i}`, { id: `d${i}`, kind: 'drawing', timestamp: i, type: 'pen', points, color: '#000000', width: 2, opacity: 1 }]));
    const { scene: sent } = project(scene({}, { drawings }));
    expect(sent.drawings).toEqual({});
    expect(sceneBytes(sent)).toBeLessThanOrEqual(CUTSCENE_SCENE_BYTES);
  });

  it('keeps shedding until the scene fits: drawings, texts, pins, panels, and last the tokens', () => {
    const texts = { t: { id: 't', kind: 'text', x: 50, y: 50, text: 'x'.repeat(200), fontSize: 12, fontFamily: 'serif', color: '#000000' } };
    const drawings = { d: { id: 'd', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], color: '#000000', width: 2, opacity: 1 } };
    const snapshot = scene({}, { texts, drawings });
    const whole = project(snapshot);
    expect(whole.fits).toBe(true);
    expect(Object.keys(whole.scene.texts)).toEqual(['t']);
    const run = (limit: number) => projectCutscene(snapshot, options(), null, 'cutscene:r:k1', createProjectionMemo(), limit);
    const bare = run(0).scene;
    const noDrawings = run(whole.sceneText.length - 1).scene;
    expect(noDrawings.drawings).toEqual({});
    expect(Object.keys(noDrawings.texts)).toEqual(['t']);
    expect(run(JSON.stringify(noDrawings).length - 1).scene.texts).toEqual({});
    // Nothing fits: everything is shed, the bare map is still returned, and it says it does not fit.
    expect(run(0).fits).toBe(false);
    expect(bare.tokens).toEqual({});
    expect(bare.map).toEqual(whole.scene.map);
    // Extras still know the tokens' lights.
    expect(run(0).extras.sceneId).toBe('cutscene:r:k1');
  });
});
