/**
 * Atlas 0.18's initiative rules for what players are told (`playersEntryToken`, src/app/services/playerInitiativeList.ts;
 * commit 5f9deff9: the players' list shows art only): the GM's `hiddenFromPlayers`, combatants without a token (a player at
 * the table, an enemy added by name), and no initiative number, card or side's roll on the wire or on the page.
 */
import { describe, expect, it } from 'vitest';
import type { Character } from '@atlas-vtt/api-types';
import { InitiativeView } from '../../../online-client/initiativeView.mts';
import { sceneAssetIds } from '../../../src/app/online/assets/assetIds';
import { atlasInitiative } from '../../../src/app/online/obsidian/convertPanels';
import { initiativeLines } from '../../../src/app/online/preview/sceneSummary';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { projectInitiative, withCombatantSides } from '../../../src/app/online/scene/projectPanels';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import type { PlayerInitiative, PlayerInitiativeEntry, PlayerSideRow } from '../../../src/app/online/scene/sceneTypes';
import { NO_TURN, nextTurnOf, turnOf } from '../../../src/app/online/view/turns';
import { createDefaultInitiativeState, fakeAssetIds, playerScene, playerToken } from './sceneFixtures';

const RULES: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const token = (id: string, extra: object = {}) => ({ id, kind: 'character', x: 0, y: 0, imagePath: `art/${id}.png`, ...extra }) as unknown as Character;
const tokens = { ana: token('ana', { side: 'players' }), orc: token('orc'), lich: token('lich') };
const visible = new Set(['ana', 'orc', 'lich']);
const raw = (id: string, order: number, extra: object = {}) => ({
  id: `e-${id}`, tokenId: id, name: id, initiative: 20 - order, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: false, order, ...extra,
});
const stateOf = (entries: object[], extra: object = {}) => ({
  initiative: { ...createDefaultInitiativeState(), isActive: true, round: 2, entries, ...extra },
  initiativeTrackerOpen: true,
  objects: { tokens },
}) as never;
const SIDES_RULES = { mode: 'sides', roll: '1d20', firstSide: 'players' } as never;

const sceneBody = (initiative: PlayerInitiative | null) => ({
  sceneId: 's', map: { asset: null, width: 10, height: 10, cellSize: 70 }, grid: null, widgets: [], initiative, tokens: {}, texts: {},
  measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true },
});
const entryOf = (tokenId: string, patch: Partial<PlayerInitiativeEntry> = {}): PlayerInitiativeEntry => ({ id: `e-${tokenId}`, tokenId, initiative: 0, name: tokenId, hp: null, isActive: false, ...patch });
const tokenless = (patch: Partial<PlayerInitiativeEntry> = {}): PlayerInitiativeEntry => ({ id: 'e-imp', initiative: 0, name: 'Imp', hp: null, isActive: false, side: 'opponents', image: null, ...patch });

describe('hidden from players (Atlas 0.18 playersEntryToken)', () => {
  it('drops an entry the GM hid, whatever its token, and keeps the others', () => {
    const projected = projectInitiative(stateOf([raw('ana', 0), raw('orc', 1, { hiddenFromPlayers: true }), raw('lich', 2)]), visible, RULES);
    expect(projected?.entries.map((line) => line.tokenId)).toEqual(['ana', 'lich']);
    expect(JSON.stringify(projected)).not.toContain('orc');
  });

  it('drops a hidden player at the table and a hidden enemy added by name, which are otherwise always shown', () => {
    const entries = [
      raw('ana', 0),
      { id: 'zed', partyMemberId: 'pm1', name: 'Zed', initiative: 0, imagePath: '', isActive: false, order: 1, hiddenFromPlayers: true },
      { id: 'imp', name: 'Imp', initiative: 0, imagePath: '', isActive: false, order: 2, hiddenFromPlayers: true },
    ];
    expect(projectInitiative(stateOf(entries), visible, RULES)?.entries.map((line) => line.id)).toEqual(['e-ana']);
  });

  it('does not name a side whose only member is hidden, and does not file a hidden combatant', () => {
    const named = { first: 'players', active: 'players', order: [{ id: 'players' }, { id: 'opponents' }] };
    const state = stateOf([raw('ana', 0), raw('orc', 1, { hiddenFromPlayers: true })], { sides: named });
    const projected = projectInitiative(state, visible, RULES, [], SIDES_RULES);
    expect(projected?.sideList?.map((row) => row.id)).toEqual(['players']);
    expect(projected?.entries.map((line) => line.tokenId)).toEqual(['ana']);
  });
});

describe('no numbers for players (Atlas 0.18 commit 5f9deff9)', () => {
  it('sends 0 for every number in a list in turn order, dealt cards and "not rolled yet" included, and keeps the order', () => {
    const entries = [raw('orc', 1, { initiative: 4 }), raw('ana', 0, { initiative: 18, isActive: true }), raw('lich', 2, { initiative: 0, awaitingInitiative: true })];
    const projected = projectInitiative(stateOf(entries), visible, RULES);
    expect(projected?.entries.map((line) => [line.tokenId, line.initiative])).toEqual([['ana', 0], ['orc', 0], ['lich', 0]]);
    expect(projected?.entries.find((line) => line.tokenId === 'ana')?.isActive).toBe(true);
    expect(projected?.entries.some((line) => line.awaiting)).toBe(false);
    const cards = projectInitiative(stateOf([raw('ana', 0, { card: 7 }), raw('orc', 1, { card: 3 })], { cards: { deck: [] } }), visible, RULES);
    expect(cards?.entries.map((line) => line.initiative)).toEqual([0, 0]);
    expect(JSON.stringify(cards)).not.toMatch(/7|3/);
  });

  it('sends no side roll, only the group that sides which rolled alike act in, so the next turn can still be told', () => {
    const fightSides = { first: 'players', active: 'players', order: [{ id: 'players' }, { id: 'opponents' }], roll: '1d20', rolls: { 2: { players: 17, opponents: 17 } } };
    const projected = projectInitiative(stateOf([raw('ana', 0), raw('orc', 1)], { sides: fightSides }), visible, RULES, [], SIDES_RULES);
    expect(projected?.sideList).toEqual([{ id: 'players', name: 'Players', group: 0, turn: true }, { id: 'opponents', name: 'Opponents', group: 0, turn: true }]);
    expect(JSON.stringify(projected)).not.toContain('17');
    expect(isPlayerSceneBody(sceneBody(projected))).toBe(true);
  });
});

describe('combatants without a token (Atlas 0.18 party members and enemies added by name)', () => {
  const party = { id: 'e-zed', partyMemberId: 'pm1', name: 'Zed', initiative: 0, initiativeModifier: 0, imagePath: 'art/zed.png', isActive: false, isNPC: false, order: 1 };
  const enemy = { id: 'e-imp', name: 'Imp', initiative: 0, initiativeModifier: 0, imagePath: '', isActive: true, isNPC: true, order: 2 };

  it("lists them always: a party member on the players' side with its art, an enemy on the opponents' with its name", () => {
    // Nameplates are off: a token's name is not told; a combatant without a token and without art is named, as Atlas's list does.
    const projected = projectInitiative(stateOf([raw('ana', 0), party, enemy]), visible, { ...RULES, showTokenNameplates: false }, [], undefined, undefined, fakeAssetIds());
    expect(projected?.entries).toEqual([
      { id: 'e-ana', tokenId: 'ana', initiative: 0, name: null, hp: null, hpShare: null, isActive: false },
      { id: 'e-zed', initiative: 0, name: null, hp: null, hpShare: null, isActive: false, side: 'players', image: 'asset-1' },
      { id: 'e-imp', initiative: 0, name: 'Imp', hp: null, hpShare: null, isActive: true, side: 'opponents', image: null },
    ]);
    expect(isPlayerSceneBody(sceneBody(projected))).toBe(true);
  });

  it('names a party member whose art cannot be sent, so the card is not blank', () => {
    const projected = projectInitiative(stateOf([party]), visible, RULES);
    expect(projected?.entries[0]).toMatchObject({ name: 'Zed', image: null, side: 'players' });
  });

  it('files them under their side in a list by sides, and counts that side as listed', () => {
    const fight = { first: 'players', active: 'players', order: [{ id: 'players' }, { id: 'opponents' }] };
    const projected = projectInitiative(stateOf([party, enemy], { sides: fight }), visible, RULES, [], SIDES_RULES, undefined, fakeAssetIds());
    expect(projected?.sideList?.map((row) => row.id)).toEqual(['players', 'opponents']);
    expect(projected?.entries.map((line) => line.side)).toEqual(['players', 'opponents']);
    expect(withCombatantSides({ ana: playerToken() }, projected, undefined)).toEqual({ ana: playerToken() });
  });

  it('is not shown while the list is not shown, like any entry', () => {
    expect(projectInitiative({ ...(stateOf([party]) as object), initiativeTrackerOpen: false } as never, visible, RULES)).toBeNull();
  });

  it("sends their art to the page like a token's, so it is fetched", () => {
    const art = 'Z'.repeat(43);
    const initiative = projectInitiative(stateOf([party]), visible, RULES, [], undefined, undefined, { idFor: () => art });
    expect(initiative?.entries[0]?.image).toBe(art);
    expect(sceneAssetIds(playerScene({ initiative, tokens: {} }))).toContain(art);
  });

  it('keeps the turn on them, and tells no player it is theirs', () => {
    const initiative: PlayerInitiative = { round: 1, active: true, entries: [entryOf('ana'), tokenless({ isActive: true })] };
    const scene = playerScene({ initiative, tokens: { ana: playerToken({ side: 'players' }) } });
    expect(turnOf(scene, new Set(['ana']))).toEqual(NO_TURN);
    // The one after Ana's own turn is the enemy: not hers.
    const hers: PlayerInitiative = { ...initiative, entries: [entryOf('ana', { isActive: true }), tokenless()] };
    expect(nextTurnOf(playerScene({ initiative: hers, tokens: scene.tokens }), new Set(['ana']))).toEqual(NO_TURN);
    expect(initiativeLines(initiative, scene.tokens).map((line) => line.text)).toEqual(['Round 1', 'ana', '▶ Imp']);
    expect(atlasInitiative(initiative, {}).initiative.entries.map((e) => e.id)).toEqual(['e-ana']);
  });
});

describe('the initiative column draws art and names only', () => {
  const setup = (images: (id: string) => unknown = () => null, onFind?: (tokenId: string) => void) => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    const view = new InitiativeView({ panel, images: images as never, ...(onFind ? { onFind } : {}) });
    return { panel, show: (initiative: PlayerInitiative | null) => view.update(playerScene({ initiative, tokens: { ana: playerToken({ side: 'players' }), orc: playerToken({ side: 'opponents' }) } })) };
  };

  it('draws no initiative value and no side roll, even from an older GM that still sends them', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entryOf('ana', { initiative: 18, isActive: true }), entryOf('orc', { initiative: 12, awaiting: true })] });
    expect(panel.querySelector('.initiative-value')).toBeNull();
    expect(panel.textContent).not.toMatch(/18|12|–/);
    show({
      round: 1, active: true, entries: [entryOf('ana'), entryOf('orc')], sides: { first: 'players', active: 'players' },
      sideList: [{ id: 'players', name: 'Players', roll: 14, turn: true }, { id: 'opponents', name: 'Opponents', roll: 9 }],
    });
    expect(panel.querySelector('.initiative-side-roll')).toBeNull();
    expect(panel.textContent).not.toMatch(/14|9/);
    expect(panel.querySelector('.initiative-side')?.getAttribute('aria-label')).toBe('Players');
  });

  it('lists a combatant without a token by its name and turn, offers no find, and by sides stands it under its own side', () => {
    const found: string[] = [];
    const { panel, show } = setup(() => null, (id) => found.push(id));
    show({ round: 1, active: true, entries: [entryOf('ana'), tokenless({ isActive: true })] });
    const cards = [...panel.querySelectorAll('.initiative-card')] as HTMLElement[];
    expect(cards.map((card) => card.querySelector('.initiative-name')?.textContent)).toEqual(['ana', 'Imp']);
    expect(cards[1]!.classList.contains('is-active')).toBe(true);
    expect(cards[1]!.classList.contains('is-findable')).toBe(false);
    cards[1]!.click();
    expect(found).toEqual([]);
    show({
      round: 1, active: true, entries: [entryOf('ana'), tokenless()], sides: { first: 'players', active: 'opponents' },
      sideList: [{ id: 'players', name: 'Players' }, { id: 'opponents', name: 'Opponents', turn: true }],
    });
    const groups = [...panel.querySelectorAll('.initiative-side')];
    expect(groups.map((group) => [group.querySelector('.initiative-side-label')?.textContent, group.querySelectorAll('.initiative-card').length])).toEqual([['Players', 1], ['Opponents', 1]]);
    expect(groups[1]!.classList.contains('is-active')).toBe(true);
  });

  it('asks for the art of a combatant without a token by the id it was sent', () => {
    const asked: string[] = [];
    const { panel, show } = setup((id) => { asked.push(id); return null; });
    const member = tokenless({ id: 'e-zed', name: null, side: 'players', image: 'zed-art' });
    show({ round: 1, active: false, entries: [member] });
    expect(panel.hidden).toBe(false);
    // The page asks for the art by the id it was sent, as it asks for a token's.
    expect(asked).toContain('zed-art');
  });
});

describe('the wire stays tolerant of both sides of a version gap', () => {
  it("accepts entries with and without a token id, and an older GM's numbers, rolls and awaiting flags", () => {
    expect(isPlayerSceneBody(sceneBody({
      round: 1, active: true, entries: [entryOf('ana', { initiative: 15, awaiting: true }), tokenless({ side: 'players', image: null })],
      sides: { first: 'players' }, sideList: [{ id: 'players', name: 'Players', roll: 12 }],
    }))).toBe(true);
    expect(isPlayerSceneBody(sceneBody({ round: 1, active: true, entries: [{ ...entryOf('x'), side: 'bogus' as never }] }))).toBe(false);
    expect(isPlayerSceneBody(sceneBody({
      round: 1, active: true, entries: [entryOf('x')], sides: { first: 'players' }, sideList: [{ id: 'players', name: 'P', group: -1 }],
    }))).toBe(false);
  });

  it('works out the next turn from groups as it did from rolls', () => {
    const rows = (groups: Array<[string, number | undefined, true?]>): PlayerSideRow[] => groups.map(([id, group, turn]) => ({ id, name: id, ...(group !== undefined && { group }), ...(turn && { turn }) }));
    const scene = (sideList: PlayerSideRow[]) => playerScene({
      initiative: { round: 1, active: true, sides: { first: 'players' }, sideList, entries: [entryOf('ana', { sideId: 'a' }), entryOf('orc', { sideId: 'b' }), entryOf('lich', { sideId: 'c' })] },
      tokens: { ana: playerToken(), orc: playerToken(), lich: playerToken() },
    });
    // a acts; b and c share the next group: both act together.
    expect(nextTurnOf(scene(rows([['a', 0, true], ['b', 1], ['c', 1]])), new Set(['lich'])).mine).toBe(true);
    // The last group acts where the sides roll: the next round is rolled anew, unknown.
    expect(nextTurnOf(scene(rows([['a', 0], ['b', 1], ['c', 2, true]])), new Set(['ana']))).toEqual(NO_TURN);
    // Nobody rolled: the first side again.
    expect(nextTurnOf(scene(rows([['a', undefined], ['b', undefined], ['c', undefined, true]])), new Set(['ana'])).mine).toBe(true);
  });
});
