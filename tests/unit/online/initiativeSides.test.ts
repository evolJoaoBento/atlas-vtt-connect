/**
 * Initiative by sides for online players: what the projection sends (exactly what the player window
 * lists, with no numbers by sides), the wire's limits and the join page's rows.
 */
import { describe, expect, it } from 'vitest';
import { INITIATIVE_SIDES, sideOf } from '@atlas-vtt/shared/rules';
import { initiativeLines } from '../../../src/app/online/preview/sceneSummary';
import { projectInitiative, projectSides } from '../../../src/app/online/scene/projectPanels';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { PLAYER_SIDES } from '../../../src/app/online/scene/sceneTypes';
import type { Character, InitiativeEntry, InitiativeRules, InitiativeState, SceneSnapshot } from '@atlas-vtt/api-types';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

const ALL_ON: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const TURN_ORDER: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players' };

const token = (id: string, overrides: Partial<Character> = {}): Character => ({ id, kind: 'character', x: 70, y: 70, imagePath: `${id}.png`, name: id, ...overrides });
const TOKENS: Record<string, Character> = {
  hero: token('hero', { side: 'players' }),
  // A creature that sees is the players' party unless the GM filed it elsewhere (`sideOf`)
  scout: token('scout', { vision: { enabled: true, range: 100 } }),
  ally: token('ally', { side: 'players' }),
  orc: token('orc'),
  boss: token('boss', { side: 'opponents', vision: { enabled: true, range: 100 } }),
  spy: token('spy', { isHidden: true }),
  extra: token('extra'),
};
const entry = (tokenId: string, initiative: number, order: number, overrides: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: false, order, ...overrides,
});
const ENTRIES = [entry('orc', 21, 0, { isActive: true }), entry('hero', 17, 1), entry('boss', 12, 2), entry('scout', 9, 3), entry('spy', 8, 4), entry('ally', 3, 5)];

function state(initiative: Partial<InitiativeState> = {}, tokens = TOKENS): SceneSnapshot {
  return snapshotOf({
    objects: { tokens, fog: {}, texts: {}, drawings: {} },
    initiative: { ...createDefaultInitiativeState(), round: 2, entries: ENTRIES, ...initiative },
    initiativeTrackerOpen: true,
  });
}
const project = (scene: SceneSnapshot, initiativeRules?: InitiativeRules, rules = ALL_ON) => projectForPlayers(scene, {
  sceneId: 's', rules, coverage: coverageOfFog({}), assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 },
  ...(initiativeRules && { initiativeRules }),
});

describe('the sides on the wire', () => {
  it('are the initiative sides of Atlas, in the same order', () => {
    expect([...PLAYER_SIDES]).toEqual([...INITIATIVE_SIDES]);
  });
});

describe('a list in turn order', () => {
  it('sends the numbers and the turn, and no side, with a fight in turn order or none', () => {
    for (const scene of [state({ isActive: true }), state()]) {
      const sent = project(scene, TURN_ORDER);
      expect(sent.initiative).not.toHaveProperty('sides');
      expect(sent.initiative?.entries.map((e) => [e.tokenId, e.initiative])).toEqual([['orc', 21], ['hero', 17], ['boss', 12], ['scout', 9], ['ally', 3]]);
      for (const shown of Object.values(sent.tokens)) expect(shown).not.toHaveProperty('side');
    }
    expect(project(state({ isActive: true }), TURN_ORDER).initiative?.entries[0]?.isActive).toBe(true);
  });

  it('is what a fight started in turn order keeps, whatever the collection says since', () => {
    const sent = project(state({ isActive: true }), SIDES);
    expect(sent.initiative).not.toHaveProperty('sides');
    expect(sent.initiative?.entries[0]).toMatchObject({ initiative: 21, isActive: true });
  });
});

describe('a list by sides', () => {
  it('before a fight follows the collection: first side, no active side, no numbers, no turn', () => {
    const sent = project(state(), { ...SIDES, firstSide: 'opponents' });
    expect(sent.initiative).toMatchObject({ active: false, sides: { first: 'opponents' } });
    expect(sent.initiative?.sides).not.toHaveProperty('active');
    expect(sent.initiative?.entries.map((e) => [e.tokenId, e.initiative, e.isActive])).toEqual([
      ['orc', 0, false], ['hero', 0, false], ['boss', 0, false], ['scout', 0, false], ['ally', 0, false],
    ]);
  });

  it('in a fight follows the fight: its first side, the side to act, and keeps the mode whatever the collection says', () => {
    const fight = state({ isActive: true, sides: { first: 'opponents', active: 'players' } });
    for (const rules of [SIDES, TURN_ORDER, undefined]) {
      const sent = project(fight, rules);
      expect(sent.initiative).toMatchObject({ active: true, round: 2, sides: { first: 'opponents', active: 'players' } });
      expect(sent.initiative?.entries.every((e) => e.initiative === 0 && !e.isActive)).toBe(true);
    }
  });

  it("files the combatants as the window does: the GM's choice, else those that see are the players', else the opponents'", () => {
    const sent = project(state(), SIDES);
    const sides = Object.fromEntries(Object.entries(sent.tokens).map(([id, shown]) => [id, shown.side]));
    expect(sides).toEqual({ hero: 'players', scout: 'players', ally: 'players', orc: 'opponents', boss: 'opponents', extra: undefined });
    expect(Object.fromEntries(Object.entries(TOKENS).map(([id, held]) => [id, sideOf(held)]))).toMatchObject({ scout: 'players', boss: 'opponents', orc: 'opponents' });
    // A token with no entry has no side to show
    expect(sent.tokens.extra).not.toHaveProperty('side');
    expect(project(state({ entries: [entry('hero', 1, 0)] }), SIDES).tokens.orc).not.toHaveProperty('side');
  });

  it('drops the entries of hidden or missing tokens, and sends sitting out in both modes', () => {
    const entries = [entry('hero', 5, 0, { sitsOut: true }), entry('spy', 4, 1), entry('gone', 3, 2), entry('orc', 2, 3)];
    for (const rules of [SIDES, TURN_ORDER]) {
      const sent = project(state({ entries }), rules);
      expect(sent.initiative?.entries.map((e) => [e.tokenId, e.sitsOut ?? false])).toEqual([['hero', true], ['orc', false]]);
    }
  });

  it('sends no numbers anywhere in the wire form, however the entries are made', () => {
    const entries = [entry('hero', 4217, 0), entry('orc', 3318, 1, { initiativeModifier: 7771 })];
    const text = JSON.stringify(project(state({ entries }), SIDES));
    expect(text).not.toMatch(/4217|3318|7771/);
    // In turn order the numbers are what the window shows
    expect(JSON.stringify(project(state({ entries }), TURN_ORDER))).toMatch(/4217/);
  });

  it('is not shown when the tracker is closed or the player view hides it', () => {
    expect(project({ ...state(), initiativeTrackerOpen: false }, SIDES).initiative).toBeNull();
    const hidden = project(state(), SIDES, { ...ALL_ON, showInitiative: false });
    expect(hidden.initiative).toBeNull();
    for (const shown of Object.values(hidden.tokens)) expect(shown).not.toHaveProperty('side');
  });

  it('survives messy stores: a side that is not one, and entries that are not entries', () => {
    const messy = state({ isActive: true, sides: { first: 'dragons', active: 7 } as never, entries: [null, 5, entry('hero', 1, 0)] as never });
    const sent = projectInitiative(messy, new Set(['hero']), ALL_ON, [], SIDES);
    expect(sent?.sides).toEqual({ first: 'players' });
    expect(projectSides({ ...state(), initiative: { ...state().initiative, sides: 'x' as never } }, ALL_ON, SIDES)).toEqual({ first: 'players' });
  });
});

describe("the join page's list", () => {
  const rowsOf = (scene: SceneSnapshot, rules: InitiativeRules) => {
    const projected = project(scene, rules);
    return initiativeLines(projected.initiative, projected.tokens);
  };

  it('keeps turn order as it was: the number, the turn and the bar', () => {
    expect(rowsOf(state({ isActive: true }), TURN_ORDER).map((row) => row.text)).toEqual(['Round 2', '▶ 21 · orc', '17 · hero', '12 · boss', '9 · scout', '3 · ally']);
  });

  it('puts each side under its name, the side that acts first on top, and marks the side to act', () => {
    const rows = rowsOf(state({ isActive: true, sides: { first: 'opponents', active: 'players' } }), SIDES);
    expect(rows).toEqual([
      { text: 'Round 2' },
      { text: 'Opponents', heading: true }, { text: 'orc' }, { text: 'boss' },
      { text: 'Players', heading: true, current: true }, { text: 'hero' }, { text: 'scout' }, { text: 'ally' },
    ]);
  });

  it('shows no number, no round before a fight, and fades a combatant that sits out', () => {
    const entries = [entry('hero', 5, 0, { sitsOut: true }), entry('orc', 4, 1)];
    expect(rowsOf(state({ entries }), SIDES)).toEqual([
      { text: 'Players', heading: true }, { text: 'hero', sittingOut: true }, { text: 'Opponents', heading: true }, { text: 'orc' },
    ]);
    expect(rowsOf(state({ entries, isActive: true }), TURN_ORDER)[1]).toMatchObject({ sittingOut: true });
  });

  it('leaves out a side nobody is listed under, and files a token the page lacks among the opponents', () => {
    const entries = [entry('orc', 4, 0), entry('boss', 3, 1)];
    expect(rowsOf(state({ entries }), SIDES).map((row) => row.text)).toEqual(['Opponents', 'orc', 'boss']);
    const scene = project(state({ entries }), SIDES).initiative!;
    expect(initiativeLines(scene, {}).map((row) => row.text)).toEqual(['Opponents', 'orc', 'boss']);
    expect(initiativeLines({ ...scene, sides: { first: 'opponents', active: 'opponents' } }, {})[0]).toMatchObject({ heading: true, current: true });
  });

  it('hides a side whose combatants are all hidden', () => {
    const entries = [entry('spy', 4, 0), entry('orc', 3, 1)];
    expect(rowsOf(state({ entries }), SIDES).map((row) => row.text)).toEqual(['Opponents', 'orc']);
  });
});
