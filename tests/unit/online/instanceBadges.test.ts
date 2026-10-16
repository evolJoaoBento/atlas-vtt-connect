import { describe, expect, it } from 'vitest';
import type { Character, SceneSnapshot } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { projectForPlayers, type ProjectionContext, type ProjectionInput } from '../../../src/app/online/scene/projectForPlayers';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { createTokensLayer } from '../../../src/app/online/view/layers/tokensLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { fakeAssetIds, playerScene, playerToken, snapshotOf } from './sceneFixtures';

const context: ProjectionContext = {
  sceneId: 'scene-1', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
  coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 },
};

function goblin(id: string, x: number, instanceNumber?: number): Character {
  return { id, kind: 'character', x, y: 140, imagePath: 'atlas-vtt/assets/goblin.png', name: 'Goblin', ...(instanceNumber ? { instanceNumber } : {}) } as Character;
}

function state(tokens: Character[], tokenSettings?: ProjectionInput['tokenSettings']): ProjectionInput {
  const snapshot: SceneSnapshot = snapshotOf({ grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1 } });
  return { ...snapshot, objects: { ...snapshot.objects, tokens: Object.fromEntries(tokens.map((token) => [token.id, token])) }, ...(tokenSettings ? { tokenSettings } : {}) };
}

const instances = (scene: ReturnType<typeof projectForPlayers>): Record<string, number | undefined> =>
  Object.fromEntries(Object.entries(scene.tokens).map(([id, token]) => [id, token.instance]));

describe("Atlas's instance badges for players", () => {
  it('numbers look-alikes players see by their rank, and leaves a lone token unnumbered', () => {
    const memo = createProjectionMemo();
    const scene = projectForPlayers(state([goblin('a', 140, 2), goblin('b', 280, 1), { ...goblin('c', 420), imagePath: 'atlas-vtt/assets/orc.png' }]), context, memo);
    expect(instances(scene)).toEqual({ a: 2, b: 1, c: undefined });
    expect(isPlayerSceneBody(scene)).toBe(true);
  });

  it('keeps a number while its token stays in view, as Atlas does, and drops badges with one look-alike left', () => {
    const memo = createProjectionMemo();
    projectForPlayers(state([goblin('a', 140), goblin('b', 280), goblin('c', 420)]), context, memo);
    expect(instances(projectForPlayers(state([goblin('a', 140), goblin('c', 420)]), context, memo))).toEqual({ a: 1, c: 3 });
    expect(instances(projectForPlayers(state([goblin('c', 420)]), context, memo))).toEqual({ c: undefined });
  });

  it("shows none when the map's badges are off", () => {
    const scene = projectForPlayers(state([goblin('a', 140), goblin('b', 280)], { showInstanceBadges: false }), context, createProjectionMemo());
    expect(instances(scene)).toEqual({ a: undefined, b: undefined });
  });

  it("sends the map's ring size only when it is not 1", () => {
    expect(projectForPlayers(state([goblin('a', 140)], { tokenRingSize: 1.5 }), context, createProjectionMemo()).tokens.a?.ringScale).toBe(1.5);
    expect(projectForPlayers(state([goblin('a', 140)], { tokenRingSize: 1 }), context, createProjectionMemo()).tokens.a).not.toHaveProperty('ringScale');
  });

  it('refuses a badge number or ring size out of range', () => {
    const body = (token: object): unknown => ({ ...playerScene({ tokens: { t: { ...playerToken(), ...token } } }), sceneId: 'scene-1' });
    expect(isPlayerSceneBody(body({ instance: 2, ringScale: 1.5 }))).toBe(true);
    expect(isPlayerSceneBody(body({ instance: 0 }))).toBe(false);
    expect(isPlayerSceneBody(body({ instance: 1.5 }))).toBe(false);
    expect(isPlayerSceneBody(body({ ringScale: 40 }))).toBe(false);
  });
});

describe('the tokens layer', () => {
  it("draws Atlas's black numbered disc on the ring, up and to the right", () => {
    const surface = new RecordingSurface();
    createTokensLayer({ now: () => 0 }).draw(surface, frame(playerScene({ tokens: { t: playerToken({ instance: 3 }) } })));
    const text = surface.ops('text').find((call) => call.text === '3');
    expect(text).toBeDefined();
    expect(text!.x).toBeGreaterThan(100);
    expect(text!.y).toBeLessThan(100);
    expect(text!.style).toMatchObject({ color: '#ffffff', align: 'center' });
    expect(surface.ops('circle').some((call) => call.style.fill === '#000000' && call.x === text!.x)).toBe(true);
  });

  it("scales the ring by the map's ring size", () => {
    const diameter = (ringScale?: number): number => {
      const surface = new RecordingSurface();
      createTokensLayer({ now: () => 0 }).draw(surface, frame(playerScene({ tokens: { t: playerToken(ringScale ? { ringScale } : {}) } })));
      return surface.ops('tokenRing')[0]!.diameter;
    };
    expect(diameter(2)).toBeGreaterThan(diameter() * 1.8);
  });
});
