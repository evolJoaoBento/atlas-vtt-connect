/**
 * Named sides and rolled side order (Atlas 0.10) for online players: the ported functions against copies of Atlas's own
 * (from its 0.10.2 build: `pAn`, `Gbe`, `T1t`, `Ly`, `C1t`, `uk`), what the projection sends, that an older page can still
 * read it, whose turn it is, and the Obsidian tab's conversion.
 */
import { describe, expect, it } from 'vitest';
import type { Character, InitiativeEntry, InitiativeRules, InitiativeState, SceneSnapshot } from '@atlas-vtt/api-types';
import { InitiativeView } from '../../../online-client/initiativeView.mts';
import { heldOffTurn } from '../../../src/app/online/control/turnHold';
import { atlasInitiative, atlasInitiativeRules } from '../../../src/app/online/obsidian/convertPanels';
import { atlasToken } from '../../../src/app/online/obsidian/convertTokens';
import { actingGroups, readRuleSides, sideRows, tokenSideId, type RuleSide } from '../../../src/app/online/scene/initiativeSides';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { PLAYER_SIDES, type PlayerInitiative } from '../../../src/app/online/scene/sceneTypes';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { initiativeLines } from '../../../src/app/online/preview/sceneSummary';
import { NO_TURN, nextTurnOf, turnOf } from '../../../src/app/online/view/turns';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, playerScene, playerToken, projectForPlayers, snapshotOf } from './sceneFixtures';

// ---- Atlas's own functions, transcribed from its 0.10.2 build ----
const BUILT_IN = ['players', 'opponents'];
const MAX_SIDES = 8;
const MAX_NAME = 40;
const isBuiltIn = (id: unknown): boolean => BUILT_IN.includes(id as string);
const atlasGbe = (first: string): Array<{ id: string; name?: string }> => [{ id: first }, { id: first === 'players' ? 'opponents' : 'players' }];
function atlasPan(value: unknown): Array<{ id: string; name?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const sides: Array<{ id: string; name?: string }> = [];
  for (const item of value as Array<{ id?: unknown; name?: unknown } | null>) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name } = item;
    if (typeof id !== 'string' || id.trim() === '' || id.length > 64 || sides.some((side) => side.id === id)) continue;
    if (isBuiltIn(id)) { sides.push({ id }); continue; }
    const label = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
    if (label !== '') sides.push({ id, name: label });
  }
  for (const id of BUILT_IN) if (!sides.some((side) => side.id === id)) sides.push({ id });
  const named = sides.filter((side) => !isBuiltIn(side.id)).slice(0, MAX_SIDES - BUILT_IN.length);
  return sides.filter((side) => isBuiltIn(side.id) || named.includes(side));
}
interface AtlasFight { first: string; active: string; order?: Array<{ id: string }>; roll?: string; rolls?: Record<number, Record<string, number>> }
const atlasT1t = (fight: AtlasFight): string[] => (fight.order ?? atlasGbe(fight.first)).map((side) => side.id);
function atlasLy(fight: AtlasFight, round: number): string[][] {
  const order = atlasT1t(fight);
  const rolls = fight.roll ? fight.rolls?.[round] : undefined;
  if (!rolls) return order.map((id) => [id]);
  const rolled = (id: string): number => rolls[id] ?? -Infinity;
  const groups: string[][] = [];
  for (const id of [...order].sort((a, b) => rolled(b) - rolled(a))) {
    const last = groups[groups.length - 1];
    if (last && rolled(last[0]!) === rolled(id) && Number.isFinite(rolled(id))) last.push(id);
    else groups.push([id]);
  }
  return groups;
}
const atlasC1t = (fight: AtlasFight, round: number): string[] => atlasLy(fight, round).find((group) => group.includes(fight.active)) ?? [fight.active];
const atlasUk = (token: { side?: string; vision?: { enabled?: boolean } } | undefined, ids: readonly string[] = BUILT_IN): string =>
  (token?.side && ids.includes(token.side) ? token.side : token?.vision?.enabled ? 'players' : 'opponents');

// ---- fixtures ----
const ALL_ON: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const NAMED: RuleSide[] = [{ id: 'players' }, { id: 'goblins', name: 'Goblins' }, { id: 'opponents' }, { id: 'wolves', name: 'Wolves' }];
const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players', sides: NAMED } as InitiativeRules;
const token = (id: string, overrides: Omit<Partial<Character>, 'side'> & { side?: string } = {}): Character =>
  ({ id, kind: 'character', x: 70, y: 70, imagePath: `${id}.png`, name: id, ...overrides }) as Character;
const TOKENS: Record<string, Character> = {
  hero: token('hero', { side: 'players' }),
  gob: token('gob', { side: 'goblins' }),
  gob2: token('gob2', { side: 'goblins' }),
  wolf: token('wolf', { side: 'wolves' }),
  orc: token('orc', { side: 'opponents' }),
  spy: token('spy', { side: 'wolves', isHidden: true }),
  stale: token('stale', { side: 'removed-side' }),
};
const entry = (tokenId: string, order: number, overrides: Partial<InitiativeEntry> = {}): InitiativeEntry =>
  ({ id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: false, order, ...overrides });
const ENTRIES = [entry('hero', 0), entry('gob', 1), entry('gob2', 2), entry('wolf', 3), entry('orc', 4)];

function fight(sides: Record<string, unknown> | undefined, extra: Partial<InitiativeState> = {}, entries = ENTRIES): SceneSnapshot {
  return snapshotOf({
    objects: { tokens: TOKENS, fog: {}, texts: {}, drawings: {} },
    initiative: { ...createDefaultInitiativeState(), round: 2, isActive: sides !== undefined, entries, ...(sides && { sides }), ...extra } as InitiativeState,
    initiativeTrackerOpen: true,
  });
}
const project = (scene: SceneSnapshot, rules: InitiativeRules = SIDES) => projectForPlayers(scene, {
  sceneId: 's', rules: ALL_ON, coverage: coverageOfFog({}), assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, initiativeRules: rules,
});
const ROLLED = { first: 'players', active: 'wolves', order: [{ id: 'players' }, { id: 'goblins', name: 'Goblins' }, { id: 'opponents' }, { id: 'wolves', name: 'Wolves' }], roll: '1d20', rolls: { 2: { players: 9, goblins: 17, opponents: 17, wolves: 4 } } };

describe('the ported side functions, against copies of Atlas\'s own', () => {
  const lists: unknown[] = [
    undefined, null, 'x', [], [{ id: 'players' }], [{ id: 'goblins' }], [{ id: 'goblins', name: '  ' }], [{ id: 'goblins', name: ' Goblins ' }],
    [{ id: 'opponents', name: 'Foes' }, { id: 'players' }], [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], [{ id: '', name: 'x' }], [{ id: 'x'.repeat(65), name: 'x' }],
    [{ id: 'x'.repeat(64), name: 'n'.repeat(60) }], [null, 3, { id: 7 }, { id: 'ok', name: 'Ok' }],
    Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Side ${i}` })), [{ id: 'z', name: 'Z' }, ...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: 'S' })), { id: 'players' }],
  ];
  it('read a collection\'s sides as pAn does', () => {
    for (const list of lists) expect(readRuleSides(list), JSON.stringify(list)).toEqual(atlasPan(list));
  });

  const rollSets: Array<Record<string, number> | undefined> = [
    undefined, {}, { players: 5, opponents: 5 }, { players: 5, opponents: 9 }, { goblins: 17, opponents: 17, players: 9, wolves: 4 },
    { players: 3 }, { players: 3, goblins: 3, opponents: 3, wolves: 3 }, { players: 1, opponents: 2, goblins: 2, wolves: 1 },
  ];
  it('order and group the sides by their rolls as Ly and C1t do', () => {
    const order = ['players', 'goblins', 'opponents', 'wolves'];
    for (const rolls of rollSets) {
      const sides: AtlasFight = { first: 'players', active: 'goblins', order: order.map((id) => ({ id })), roll: '1d20', ...(rolls && { rolls: { 1: rolls } }) };
      expect(actingGroups(order, rolls && new Map(Object.entries(rolls))), JSON.stringify(rolls)).toEqual(atlasLy(sides, 1));
      for (const active of order) {
        const rows = sideRows({ active: true, round: 1, fight: { ...sides, active }, rulesSides: undefined, firstSide: 'players' });
        expect(rows.map((row) => row.id)).toEqual(atlasLy({ ...sides, active }, 1).flat());
        expect(rows.filter((row) => row.turn).map((row) => row.id).sort()).toEqual([...atlasC1t({ ...sides, active }, 1)].sort());
      }
    }
  });

  it('file a token as uk does', () => {
    const ids = ['players', 'opponents', 'goblins'];
    const tokens = [undefined, {}, { side: 'goblins' }, { side: 'wolves' }, { side: 'opponents', vision: { enabled: true } }, { vision: { enabled: true } }, { vision: { enabled: false } }, { side: 'players' }];
    for (const held of tokens) expect(tokenSideId(held, ids), JSON.stringify(held)).toBe(atlasUk(held, ids));
  });

  it('keep a side id such as __proto__ as an ordinary id', () => {
    const rolls = JSON.parse('{"__proto__": 12, "players": 3}') as Record<string, number>;
    const fightSides = JSON.parse('{"first":"players","active":"__proto__","roll":"1d20","order":[{"id":"players"},{"id":"__proto__","name":"Odd"}],"rolls":{"2":{"__proto__":12,"players":3}}}') as unknown;
    const rows = sideRows({ active: true, round: 2, fight: fightSides, rulesSides: undefined, firstSide: 'players' });
    expect(rows).toEqual([{ id: '__proto__', name: 'Odd', roll: 12, turn: true }, { id: 'players', name: 'Players', roll: 3, turn: false }]);
    expect(Object.keys(rolls)).toContain('__proto__');
  });
});

describe('what the projection sends for named sides', () => {
  it('lists every side that has a combatant, in the order they act, with rolls and the sides whose turn it is', () => {
    const sent = project(fight(ROLLED)).initiative!;
    expect(sent.sideList).toEqual([
      { id: 'goblins', name: 'Goblins', roll: 17, turn: undefined },
      { id: 'opponents', name: 'Opponents', roll: 17 },
      { id: 'players', name: 'Players', roll: 9 },
      { id: 'wolves', name: 'Wolves', roll: 4, turn: true },
    ].map((row) => JSON.parse(JSON.stringify(row)) as object));
  });

  it('marks every side of a tie as acting, and files each combatant under its side', () => {
    const sent = project(fight({ ...ROLLED, active: 'goblins' })).initiative!;
    expect(sent.sideList?.filter((row) => row.turn).map((row) => row.id)).toEqual(['goblins', 'opponents']);
    expect(sent.entries.map((e) => [e.tokenId, e.sideId ?? null])).toEqual([['hero', null], ['gob', 'goblins'], ['gob2', 'goblins'], ['wolf', 'wolves'], ['orc', null]]);
  });

  it('before a fight lists the collection\'s sides, with no rolls and no turn', () => {
    const sent = project(fight(undefined)).initiative!;
    expect(sent.sideList).toEqual([{ id: 'players', name: 'Players' }, { id: 'goblins', name: 'Goblins' }, { id: 'opponents', name: 'Opponents' }, { id: 'wolves', name: 'Wolves' }]);
    expect(sent.sides).toEqual({ first: 'players' });
  });

  it('leaves out a side nobody is listed under, so a hidden combatant\'s side is not named', () => {
    const sent = project(fight(ROLLED, {}, [entry('hero', 0), entry('spy', 1), entry('orc', 2)])).initiative!;
    expect(sent.sideList?.map((row) => row.id)).toEqual(['opponents', 'players']);
    expect(JSON.stringify(sent)).not.toMatch(/Wolves|wolves|Goblins/);
  });

  it('files a token whose side was removed from the collection by its vision, as Atlas does', () => {
    const sent = project(fight(ROLLED, {}, [entry('stale', 0)])).initiative!;
    expect(sent.entries[0]).not.toHaveProperty('sideId');
    expect(sent.sideList?.map((row) => row.id)).toEqual(['opponents']);
  });

  it('keeps the old fields to the two built-in sides, for a page that knows no others', () => {
    for (const active of ['wolves', 'goblins', 'players', 'opponents']) {
      const scene = project(fight({ ...ROLLED, active }));
      const sent = scene.initiative!;
      expect(PLAYER_SIDES).toContain(sent.sides!.first);
      if (sent.sides!.active !== undefined) expect(PLAYER_SIDES).toContain(sent.sides!.active);
      for (const shown of Object.values(scene.tokens)) if (shown.side !== undefined) expect(PLAYER_SIDES).toContain(shown.side);
    }
    // Only named sides act: no built-in side is told to have the turn. A tie with a built-in side names that one.
    expect(project(fight(ROLLED)).initiative!.sides).toEqual({ first: 'players' });
    expect(project(fight({ ...ROLLED, active: 'goblins' })).initiative!.sides).toEqual({ first: 'players', active: 'opponents' });
    expect(project(fight(ROLLED)).tokens.wolf?.side).toBe('opponents');
    expect(project(fight(ROLLED)).tokens.hero?.side).toBe('players');
  });

  it('is a scene the validator accepts, and refuses a malformed side list', () => {
    const scene = project(fight(ROLLED));
    expect(isPlayerSceneBody(scene)).toBe(true);
    const withList = (sideList: unknown) => ({ ...scene, initiative: { ...scene.initiative, sideList } });
    const row = { id: 'a', name: 'A' };
    expect(isPlayerSceneBody(withList([row, { ...row, id: 'b', roll: 3, turn: true }]))).toBe(true);
    for (const bad of [[{ ...row, roll: Number.NaN }], [{ ...row, turn: false }], [{ ...row, name: '' }], [{ ...row, id: '' }], [row, row], 'x',
      Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: 'S' })), [{ ...row, name: 'n'.repeat(41) }]]) {
      expect(isPlayerSceneBody(withList(bad)), JSON.stringify(bad)).toBe(false);
    }
    const entries = scene.initiative!.entries.map((e, i) => (i === 0 ? { ...e, sideId: '' } : e));
    expect(isPlayerSceneBody({ ...scene, initiative: { ...scene.initiative, entries } })).toBe(false);
    // A side list without `sides` is no list by sides.
    const { sides: _sides, ...bare } = scene.initiative!;
    expect(isPlayerSceneBody({ ...scene, initiative: bare })).toBe(false);
  });

  it('adds nothing a page of before the named sides reads: without them every old field is as it was', () => {
    const plain = project(fight({ first: 'players', active: 'opponents' }), { mode: 'sides', roll: '1d20', firstSide: 'players' }).initiative!;
    expect(plain.sides).toEqual({ first: 'players', active: 'opponents' });
    expect(plain.sideList?.map((row) => [row.id, row.turn ?? false])).toEqual([['players', false], ['opponents', true]]);
    expect(plain.entries.every((e) => e.sideId === undefined)).toBe(true);
  });
});

const sceneOf = (initiative: PlayerInitiative, tokens: Record<string, ReturnType<typeof playerToken>> = {}) => playerScene({
  initiative, tokens: { hero: playerToken({ side: 'players' }), gob: playerToken({ side: 'opponents' }), gob2: playerToken({ side: 'opponents' }), wolf: playerToken({ side: 'opponents' }), orc: playerToken({ side: 'opponents' }), ...tokens },
});
const listed = (turns: Record<string, { roll?: number; turn?: true }>, entries: Array<[string, string?]>): PlayerInitiative => ({
  round: 2, active: true, sides: { first: 'players' },
  sideList: Object.entries(turns).map(([id, row]) => ({ id, name: id, ...row })),
  entries: entries.map(([tokenId, sideId]) => ({ id: `e-${tokenId}`, tokenId, initiative: 0, name: tokenId, hp: null, isActive: false, ...(sideId && { sideId }) })),
});

describe('whose turn it is, with named sides', () => {
  const entries: Array<[string, string?]> = [['hero'], ['gob', 'goblins'], ['gob2', 'goblins'], ['wolf', 'wolves'], ['orc']];
  const order = { goblins: { roll: 17 }, opponents: { roll: 17 }, players: { roll: 9 }, wolves: { roll: 4 } };

  it('is the turn of a player controlling a combatant of a side that acts, even when only named sides act', () => {
    const initiative = listed({ ...order, wolves: { roll: 4, turn: true } }, entries);
    const scene = sceneOf(initiative);
    expect(turnOf(scene, new Set(['wolf'])).mine).toBe(true);
    expect(turnOf(scene, new Set(['hero'])).mine).toBe(false);
    expect(turnOf(scene, new Set(['gob'])).mine).toBe(false);
    expect(heldOffTurn(scene, 'wolf')).toBe(false);
    expect(heldOffTurn(scene, 'hero')).toBe(true);
    expect(heldOffTurn(scene, 'gob')).toBe(true);
  });

  it('lets every side of a tie act, and not a combatant that sits out', () => {
    const initiative = listed({ goblins: { roll: 17, turn: true }, opponents: { roll: 17, turn: true }, players: { roll: 9 }, wolves: { roll: 4 } }, entries);
    initiative.entries[1] = { ...initiative.entries[1]!, sitsOut: true };
    const scene = sceneOf(initiative);
    expect([turnOf(scene, new Set(['gob2'])).mine, turnOf(scene, new Set(['orc'])).mine, turnOf(scene, new Set(['gob'])).mine]).toEqual([true, true, false]);
    expect([heldOffTurn(scene, 'gob'), heldOffTurn(scene, 'gob2'), heldOffTurn(scene, 'orc'), heldOffTurn(scene, 'hero')]).toEqual([true, false, false, true]);
  });

  it('holds every token when no side acts, as with no active side before', () => {
    const scene = sceneOf(listed(order, entries));
    expect(turnOf(scene, new Set(['hero']))).toEqual(NO_TURN);
    expect(heldOffTurn(scene, 'hero')).toBe(true);
  });

  it('knows the next group to act: the next row, with its equal rolls, and not guessing across a round where sides roll', () => {
    const scene = (turns: Record<string, { roll?: number; turn?: true }>) => sceneOf(listed(turns, entries));
    expect(nextTurnOf(scene({ goblins: { roll: 17, turn: true }, opponents: { roll: 17, turn: true }, players: { roll: 9 }, wolves: { roll: 4 } }), new Set(['hero'])).mine).toBe(true);
    expect(nextTurnOf(scene({ goblins: { roll: 17 }, opponents: { roll: 17 }, players: { roll: 9, turn: true }, wolves: { roll: 4 } }), new Set(['wolf'])).mine).toBe(true);
    expect(nextTurnOf(scene({ goblins: { roll: 17, turn: true }, opponents: { roll: 17, turn: true }, players: { roll: 9 }, wolves: { roll: 4 } }), new Set(['wolf'])).mine).toBe(false);
    // After the last side the next round is rolled anew: unknown. Without rolls the order is the same: the first side again.
    expect(nextTurnOf(scene({ goblins: { roll: 17 }, opponents: { roll: 17 }, players: { roll: 9 }, wolves: { roll: 4, turn: true } }), new Set(['gob']))).toEqual(NO_TURN);
    expect(nextTurnOf(scene({ players: { turn: true }, goblins: {}, wolves: {} }), new Set(['gob'])).mine).toBe(true);
    expect(nextTurnOf(scene({ players: {}, goblins: {}, wolves: { turn: true } }), new Set(['hero'])).mine).toBe(true);
  });

  it('keeps an older GM\'s two sides working: the other side is next', () => {
    const older: PlayerInitiative = { round: 1, active: true, sides: { first: 'players', active: 'players' }, entries: listed({}, [['hero'], ['orc']]).entries };
    const scene = sceneOf(older);
    expect(turnOf(scene, new Set(['hero'])).mine).toBe(true);
    expect(nextTurnOf(scene, new Set(['orc'])).mine).toBe(true);
    expect(heldOffTurn(scene, 'orc')).toBe(true);
  });
});

describe('the list and the summary for named sides', () => {
  const initiative = listed({ goblins: { roll: 17, turn: true }, opponents: { roll: 17, turn: true }, players: { roll: 9 }, wolves: { roll: 4 } }, [['hero'], ['gob', 'goblins'], ['wolf', 'wolves'], ['orc']]);

  it('draws a group per side in the order they act, with names and rolls, every side that acts marked', () => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    new InitiativeView({ panel, images: () => null }).update(sceneOf(initiative));
    const groups = [...panel.querySelectorAll('.initiative-side')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['goblins, rolled 17', 'opponents, rolled 17', 'players, rolled 9', 'wolves, rolled 4']);
    expect(groups.map((group) => group.classList.contains('is-active'))).toEqual([true, true, false, false]);
    expect(groups[0]!.querySelector('.initiative-side-label')?.textContent).toBe('goblins17');
    expect(groups[0]!.querySelector('.initiative-side-roll')?.textContent).toBe('17');
    expect(groups.map((group) => group.querySelectorAll('.initiative-card').length)).toEqual([1, 1, 1, 1]);
  });

  it('lists the same in the text summary', () => {
    expect(initiativeLines(initiative, sceneOf(initiative).tokens).filter((row) => row.heading).map((row) => [row.text, row.current ?? false])).toEqual([
      ['goblins, rolled 17', true], ['opponents, rolled 17', true], ['players, rolled 9', false], ['wolves, rolled 4', false],
    ]);
  });
});

describe('the Obsidian tab\'s conversion', () => {
  const initiative = listed({ goblins: { roll: 17, turn: true }, opponents: { roll: 17, turn: true }, players: { roll: 9 }, wolves: { roll: 4 } }, [['hero'], ['gob', 'goblins']]);

  it('gives Atlas\'s list the order, the round\'s rolls and the side acting, and files a combatant under its named side', () => {
    const state = atlasInitiative(initiative, {}).initiative.sides as unknown as AtlasFight;
    expect(state.order).toEqual([{ id: 'goblins', name: 'goblins' }, { id: 'opponents' }, { id: 'players' }, { id: 'wolves', name: 'wolves' }]);
    expect(state.rolls).toEqual({ 2: { goblins: 17, opponents: 17, players: 9, wolves: 4 } });
    expect(state.active).toBe('goblins');
    expect(atlasC1t(state, 2)).toEqual(['goblins', 'opponents']);
    const plain = playerToken({ side: 'opponents' });
    expect(atlasToken('gob', plain, '', null, 'goblins').side).toBe('goblins');
    expect(atlasToken('orc', plain, '').side).toBe('opponents');
  });

  it('names the collection\'s sides in the rules only when one is named, and leaves a plain list as it was', () => {
    expect((atlasInitiativeRules(initiative) as unknown as { sides?: unknown }).sides).toEqual([{ id: 'goblins', name: 'goblins' }, { id: 'opponents' }, { id: 'players' }, { id: 'wolves', name: 'wolves' }]);
    const plain = listed({ players: {}, opponents: {} }, [['hero']]);
    expect(atlasInitiativeRules(plain)).not.toHaveProperty('sides');
    expect(atlasInitiative({ ...plain, sideList: [{ id: 'players', name: 'Players', turn: true }, { id: 'opponents', name: 'Opponents' }], sides: { first: 'players', active: 'players' } }, {}).initiative.sides)
      .toEqual({ first: 'players', active: 'players' });
  });
});
