/**
 * Initiative in the remote view, Connect's part: the list players may see, and how the GM's window groups it,
 * reach Atlas through the client (the entries with the scene, the grouping as stand-in rules with the player's
 * part), from the GM's real projection. Atlas's own `PlayerInitiativePanel` draws them; that it draws the same
 * markup as the player window is Atlas's test.
 */
import { describe, expect, it } from 'vitest';
import type { Character, InitiativeEntry, InitiativeRules, InitiativeState } from '@atlas-vtt/api-types';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from '../sceneFixtures';
import { admitted, remoteSceneSetup } from './remoteSceneFixtures';

const TURN_ORDER: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players' };

const token = (id: string, overrides: Partial<Character> = {}): Character => ({ id, kind: 'character', x: 70, y: 70, imagePath: '', name: id, ...overrides });
const TOKENS: Record<string, Character> = {
  hero: token('hero', { side: 'players' }),
  orc: token('orc'),
  boss: token('boss', { side: 'opponents' }),
  spy: token('spy', { isHidden: true }),
};
const entry = (tokenId: string, initiative: number, order: number, overrides: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: false, order, ...overrides,
});
const ENTRIES = [entry('orc', 21, 0), entry('hero', 17, 1), entry('boss', 12, 2), entry('spy', 8, 3)];

function projected(initiative: Partial<InitiativeState>, rules: InitiativeRules) {
  return projectForPlayers(snapshotOf({
    objects: { tokens: TOKENS, fog: {}, texts: {}, drawings: {} },
    initiative: { ...createDefaultInitiativeState(), round: 3, ...initiative },
    initiativeTrackerOpen: true,
  }), {
    sceneId: 's', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
    coverage: coverageOfFog({}), assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, initiativeRules: rules,
  });
}

async function shown(initiative: Partial<InitiativeState>, rules: InitiativeRules) {
  const t = await remoteSceneSetup();
  t.sink().session(admitted());
  t.sink().scene(projected(initiative, rules));
  return t;
}

describe("the remote view's initiative list", () => {
  it('in turn order: the numbers, the turn and the round, without hidden combatants', async () => {
    const t = await shown({ entries: ENTRIES.map((e, i) => (i === 1 ? { ...e, isActive: true } : e)), isActive: true }, TURN_ORDER);
    expect(t.handle.player?.initiative.rules).toEqual({ mode: 'turn-order', roll: '1d20', firstSide: 'players' });
    expect(t.handle.scene?.initiative).toMatchObject({ round: 3, isActive: true, currentIndex: 1 });
    expect(t.handle.scene?.initiative.entries.map((e) => [e.tokenId, e.initiative])).toEqual([['orc', 21], ['hero', 17], ['boss', 12]]);
  });

  it('by sides in a fight: the fight keeps its sides, with no numbers and no active combatant', async () => {
    const t = await shown({ entries: ENTRIES, isActive: true, sides: { first: 'opponents', active: 'players' } }, TURN_ORDER);
    expect(t.handle.player?.initiative.rules).toMatchObject({ mode: 'sides', firstSide: 'opponents' });
    expect(t.handle.scene?.initiative.sides).toEqual({ first: 'opponents', active: 'players' });
    expect(t.handle.scene?.initiative.entries.every((e) => e.initiative === 0 && !e.isActive)).toBe(true);
    expect(t.handle.scene?.objects.tokens.hero).toMatchObject({ side: 'players' });
  });

  it("by sides between fights, from the collection's rules, which the player's own vault does not have", async () => {
    const t = await shown({ entries: ENTRIES }, { ...SIDES, firstSide: 'opponents' });
    expect(t.handle.player?.initiative.rules).toEqual({ mode: 'sides', roll: '1d20', firstSide: 'opponents' });
    expect(t.handle.scene?.initiative.isActive).toBe(false);
  });

  it('marks a combatant that sits out', async () => {
    const t = await shown({ entries: [entry('hero', 5, 0, { sitsOut: true }), entry('orc', 4, 1)] }, SIDES);
    expect(t.handle.scene?.initiative.entries.map((e) => e.sitsOut ?? false)).toEqual([true, false]);
  });

  it('shows no list when the GM has none, and no rules without a scene', async () => {
    const t = await shown({ entries: ENTRIES }, SIDES);
    t.sink().scene(projected({ entries: [] }, SIDES));
    expect(t.handle.scene?.initiative.entries).toEqual([]);
    t.sink().scene(null);
    expect(t.handle.player?.initiative).toEqual({ rules: null, health: {} });
  });

  it('sends the player state again only when it changed, so Atlas keeps the list (and its scroll) when something else moves', async () => {
    const t = await shown({ entries: ENTRIES }, SIDES);
    const sent = t.handle.count('setPlayer');
    // Another token moves and a token takes a condition another token already shows: the stand-ins are the same.
    const scene = projected({ entries: ENTRIES }, SIDES);
    t.sink().scene({ ...scene, tokens: { ...scene.tokens, orc: { ...scene.tokens.orc!, x: 300 } } });
    expect(t.handle.count('setScene')).toBeGreaterThan(1);
    expect(t.handle.count('setPlayer')).toBe(sent);
    t.sink().images();
    t.runFrames();
    t.sink().control([]);
    expect(t.handle.count('setPlayer')).toBe(sent);
    // A real change is sent.
    t.sink().control(['hero']);
    expect(t.handle.count('setPlayer')).toBe(sent + 1);
    t.sink().scene(projected({ entries: ENTRIES }, TURN_ORDER));
    expect(t.handle.count('setPlayer')).toBe(sent + 2);
    expect(t.handle.player?.initiative.rules?.mode).toBe('turn-order');
  });

  it('sends a condition change only when the stand-in definitions change', async () => {
    const t = await remoteSceneSetup();
    const base = projected({ entries: ENTRIES }, SIDES);
    const withCondition = (ids: Record<string, string[]>): typeof base => ({
      ...base,
      tokens: Object.fromEntries(Object.entries(base.tokens).map(([id, tok]) => [id, { ...tok, conditions: (ids[id] ?? []).map((c) => ({ id: c, value: null })) }])),
    });
    t.sink().scene(withCondition({ orc: ['prone'] }));
    const sent = t.handle.count('setPlayer');
    t.sink().scene(withCondition({ orc: ['prone'], boss: ['prone'] }));
    expect(t.handle.count('setPlayer')).toBe(sent);
    t.sink().scene(withCondition({ orc: ['prone', 'blinded'] }));
    expect(t.handle.count('setPlayer')).toBe(sent + 1);
  });
});
