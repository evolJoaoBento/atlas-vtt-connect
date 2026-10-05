/**
 * Resources in the remote view, Connect's part: the GM's real projection, through the client, reaches Atlas as
 * stand-in bar definitions per token and shares out of 100, never the GM's definitions or numbers. Atlas draws them
 * with its own token UI (its tests cover the drawing: bars from the first two sockets, no numbers on hover, the grey
 * skull of a downed token).
 */
import { describe, expect, it } from 'vitest';
import type { Character, ResourceDefinition } from '@atlas-vtt/api-types';
import { DOWNED_KEY } from '../../../../src/app/online/obsidian/convertResources';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, playerScene, playerToken, projectForPlayers, snapshotOf } from '../sceneFixtures';
import { admitted, remoteSceneSetup } from './remoteSceneFixtures';

const DEFINITIONS: readonly ResourceDefinition[] = [
  { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true, slot: 0 },
  { key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', color: '#a855f7', visibleToPlayers: true, slot: 1 },
  { key: 'mana', name: 'Mana', field: 'mana', direction: 'drains', color: '#3b82f6', visibleToPlayers: true, slot: 2 },
  { key: 'doom', name: 'Doom', field: 'doom', direction: 'drains', color: '#111111', defeatedWhenSpent: true, visibleToPlayers: false, slot: 3 },
];
const character = (id: string, resources: NonNullable<Character['resources']>): Character => ({ id, kind: 'character', x: 70, y: 70, imagePath: `${id}.png`, name: id, resources });
const TOKENS = {
  hurt: character('hurt', { hp: { current: 5, max: 10 }, stress: { current: 3, max: 6 }, mana: { current: 1, max: 2 } }),
  fallen: character('fallen', { hp: { current: 0, max: 10 } }),
  // A resource players do not see downs it
  ghoul: character('ghoul', { hp: { current: 9, max: 10 }, doom: { current: 0, max: 5 } }),
};

function projected(definitions: readonly ResourceDefinition[] = DEFINITIONS) {
  return projectForPlayers(snapshotOf({
    objects: { tokens: TOKENS, fog: {}, texts: {}, drawings: {} },
    initiative: {
      ...createDefaultInitiativeState(), isActive: true, round: 1,
      entries: [{ id: 'e1', tokenId: 'hurt', name: 'hurt', initiative: 12, initiativeModifier: 0, imagePath: '', isActive: true, isNPC: false, order: 0 }],
    },
    initiativeTrackerOpen: true,
  }), {
    sceneId: 's', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
    coverage: coverageOfFog({}), assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, resources: definitions,
  });
}

async function shown(definitions?: readonly ResourceDefinition[]) {
  const t = await remoteSceneSetup();
  t.sink().session(admitted());
  t.sink().scene(projected(definitions));
  return t;
}

describe('resources in the remote view', () => {
  it('sends a stand-in per bar the window draws, in the colour it shows, and the downed one out of sight', async () => {
    const t = await shown();
    const resources = t.handle.player?.tokenUi.resources ?? {};
    expect(resources.hurt?.map((definition) => [definition.key, definition.color, definition.slot ?? null])).toEqual([
      // HP at 50% is yellow in the window (its definition is green); stress keeps its own colour
      ['bar0', '#eab308', 0], ['bar1', '#a855f7', 1], [DOWNED_KEY, '#ef4444', null],
    ]);
    expect(resources.hurt?.find((definition) => definition.key === DOWNED_KEY)).toMatchObject({ visibleToPlayers: false, defeatedWhenSpent: true });
    expect(t.handle.scene?.objects.tokens.hurt).toMatchObject({ resources: { bar0: { current: 50, max: 100 }, bar1: { current: 50, max: 100 }, downed: { current: 1, max: 1 } } });
    // Nothing of the GM's definitions: no names, no fields, no wheel
    const text = JSON.stringify(t.handle.player);
    for (const word of ['"HP"', '"Stress"', '"Mana"', '"Doom"', '"hp"', '"mana"']) expect(text).not.toContain(word);
  });

  it('downs a spent token, also when a resource players do not see downs it, and draws only its HP bar', async () => {
    const t = await shown();
    const tokens = t.handle.scene?.objects.tokens ?? {};
    expect(tokens.fallen).toMatchObject({ resources: { bar0: { current: 0, max: 100 }, downed: { current: 0, max: 1 } } });
    expect(tokens.ghoul).toMatchObject({ resources: { bar0: { current: 90, max: 100 }, downed: { current: 0, max: 1 } } });
    expect(t.handle.player?.tokenUi.resources.ghoul?.map((definition) => definition.key)).toEqual(['bar0', DOWNED_KEY]);
  });

  it('follows the collection: a resource hidden from players is gone from the view', async () => {
    const t = await shown(DEFINITIONS.map((definition) => ({ ...definition, visibleToPlayers: false })));
    expect(t.handle.player?.tokenUi.resources).not.toHaveProperty('hurt');
    expect(t.handle.scene?.objects.tokens.hurt).not.toHaveProperty('resources');
  });

  it("sends the HP bar after a combatant's name, at its share", async () => {
    const t = await shown();
    expect(t.handle.player?.initiative.health).toEqual({ hurt: { value: 50, max: 100 } });
  });

  it('never gives a stand-in a wheel socket, however many bars arrive', async () => {
    const t = await remoteSceneSetup();
    const bar = { color: '#3b82f6', share: 0.5, spent: false };
    t.sink().scene(playerScene({ tokens: { t1: playerToken({ name: 'Many', resources: Array.from({ length: 6 }, () => bar), downed: true }) } }));
    expect(t.handle.player?.tokenUi.resources.t1?.map((definition) => [definition.key, definition.slot ?? null])).toEqual([['bar0', 0], ['bar1', 1], [DOWNED_KEY, null]]);
  });
});
