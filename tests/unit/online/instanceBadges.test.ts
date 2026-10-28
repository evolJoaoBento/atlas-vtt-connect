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
  it("shows each look-alike's own stored number, and leaves a lone token unnumbered", () => {
    const scene = projectForPlayers(state([goblin('a', 140, 2), goblin('b', 280, 1), { ...goblin('c', 420), imagePath: 'atlas-vtt/assets/orc.png' }]), context, createProjectionMemo());
    expect(instances(scene)).toEqual({ a: 2, b: 1, c: undefined });
    expect(isPlayerSceneBody(scene)).toBe(true);
  });

  it('shows the number the GM sees: stored numbers are never made up again for what players see', () => {
    // 3 and 5 are the GM's numbers (others were removed); players read them as they are.
    expect(instances(projectForPlayers(state([goblin('a', 140, 3), goblin('b', 280, 5)]), context, createProjectionMemo()))).toEqual({ a: 3, b: 5 });
    // A token with no stored number shows 1, as Atlas draws it.
    expect(instances(projectForPlayers(state([goblin('a', 140), goblin('b', 280, 2)]), context, createProjectionMemo()))).toEqual({ a: 1, b: 2 });
    // Twice, with a token gone in between: nothing is kept or renumbered.
    const memo = createProjectionMemo();
    projectForPlayers(state([goblin('a', 140, 1), goblin('b', 280, 2), goblin('c', 420, 3)]), context, memo);
    expect(instances(projectForPlayers(state([goblin('a', 140, 1), goblin('c', 420, 3)]), context, memo))).toEqual({ a: 1, c: 3 });
  });

  it('counts the look-alikes players cannot see, so a lone visible one still shows its number (Atlas 0.10.2)', () => {
    const hiddenTwin = { ...goblin('h', 560, 2), isHidden: true } as Character;
    const scene = projectForPlayers(state([goblin('a', 140, 1), hiddenTwin]), context, createProjectionMemo());
    expect(Object.keys(scene.tokens)).toEqual(['a']);
    expect(instances(scene)).toEqual({ a: 1 });
    // The same for one kept beside the map.
    const offMap = { ...goblin('o', 700, 2), offMap: true } as Character;
    expect(instances(projectForPlayers(state([goblin('a', 140, 1), offMap]), context, createProjectionMemo()))).toEqual({ a: 1 });
    // And one under fog: sent to no one, counted all the same.
    const fogged = { ...goblin('f', 5000, 2) } as Character;
    const scene2 = projectForPlayers(state([goblin('a', 140, 1), fogged]), { ...context, coverage: { revealsSome: (box: { x: number }) => box.x < 1000, within: () => ({ shows: () => true }) } as unknown as FogCoverage }, createProjectionMemo());
    expect(Object.keys(scene2.tokens)).toEqual(['a']);
    expect(instances(scene2)).toEqual({ a: 1 });
  });

  it('counts only the look-alikes of the same art', () => {
    const orc = { ...goblin('o', 420, 1), imagePath: 'atlas-vtt/assets/orc.png', isHidden: true } as Character;
    expect(instances(projectForPlayers(state([goblin('a', 140, 1), orc]), context, createProjectionMemo()))).toEqual({ a: undefined });
  });

  it('sends a whole number the player page accepts, whatever a note holds', () => {
    const odd = (value: unknown): Character => ({ ...goblin('x', 140), instanceNumber: value } as unknown as Character);
    for (const [stored, shown] of [[0, 1], [-4, 1], [2.9, 2], ['7', 7], ['many', 1], [123456, 9999], [null, 1], [Number.NaN, 1]] as Array<[unknown, number]>) {
      const scene = projectForPlayers(state([odd(stored), goblin('b', 280, 1)]), context, createProjectionMemo());
      expect(scene.tokens.x?.instance).toBe(shown);
      expect(isPlayerSceneBody(scene)).toBe(true);
    }
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
