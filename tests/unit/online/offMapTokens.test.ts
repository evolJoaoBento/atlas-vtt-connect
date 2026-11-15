/**
 * Combatants kept beside the map (Atlas 0.9's `offMap`): players never get them on their map, while
 * their initiative list keeps those not hidden, as Atlas's own players' list does (`TokenShare`).
 */
import { describe, expect, it } from 'vitest';
import type { Character, InitiativeEntry, SceneSnapshot } from '@atlas-vtt/api-types';
import { onMapTokens } from '../../../src/app/online/scene/projectForPlayers';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { closedFrame } from '../../../src/app/online/scene/lightingFrame';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, projectForPlayers, sceneBody, snapshotOf } from './sceneFixtures';

const ALL_ON: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const MAP = { width: 1000, height: 800 };

const token = (id: string, overrides: Partial<Character> & { offMap?: true } = {}): Character => ({ id, kind: 'character', x: 70, y: 70, imagePath: `${id}.png`, name: id, ...overrides } as Character);
const entry = (tokenId: string, order: number): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 10 - order, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order,
});

const TOKENS: Record<string, Character> = {
  hero: token('hero'),
  // Beside the map, in the column Atlas puts them in, one cell left of the map image.
  wolf: token('wolf', { offMap: true, x: -105, y: 35 }),
  ghost: token('ghost', { offMap: true, isHidden: true, x: -105, y: 122 }),
};

function scene(tokens: Record<string, Character> = TOKENS): SceneSnapshot {
  return snapshotOf({
    objects: { tokens, fog: {}, texts: {}, drawings: {} },
    initiative: { ...createDefaultInitiativeState(), isActive: true, round: 1, entries: [entry('hero', 0), entry('wolf', 1), entry('ghost', 2)] },
    initiativeTrackerOpen: true,
  });
}

const project = (snapshot: SceneSnapshot, extra: Partial<Parameters<typeof projectForPlayers>[1]> = {}) => projectForPlayers(snapshot, {
  sceneId: 's', rules: ALL_ON, coverage: coverageOfFog({}), assets: fakeAssetIds(), mapSize: MAP, ...extra,
});

describe('tokens kept beside the map', () => {
  it('never reach the players\' map', () => {
    const sent = project(scene());
    expect(Object.keys(sent.tokens)).toEqual(['hero']);
  });

  it('stay in the players\' initiative list unless hidden, as Atlas lists them', () => {
    const sent = project(scene());
    expect(sent.initiative?.entries.map((e) => e.tokenId)).toEqual(['hero', 'wolf']);
    expect(isPlayerSceneBody(sceneBody(sent))).toBe(true);
  });

  it('are left out of the list too on a lit scene that shows players nothing', () => {
    const sent = project(snapshotOf({ ...scene(), lighting: { ...scene().lighting, enabled: true } }), { lighting: closedFrame(MAP) });
    expect(sent.tokens).toEqual({});
    expect(sent.initiative?.entries ?? []).toEqual([]);
  });

  it('only a flag of true puts a token beside the map', () => {
    const tokens = { hero: token('hero'), odd: { ...token('odd'), offMap: 'yes' } as unknown as Character };
    expect(Object.keys(project(scene(tokens)).tokens).sort()).toEqual(['hero', 'odd']);
  });
});

describe('onMapTokens', () => {
  it('is the very record while no token is beside the map', () => {
    const tokens = { hero: token('hero') };
    expect(onMapTokens(tokens)).toBe(tokens);
    expect(onMapTokens(undefined)).toBeUndefined();
  });

  it('is the same filtered record for as long as the source record is the same', () => {
    const first = onMapTokens(TOKENS);
    expect(Object.keys(first ?? {})).toEqual(['hero']);
    expect(onMapTokens(TOKENS)).toBe(first);
    expect(onMapTokens({ ...TOKENS })).not.toBe(first);
  });
});
