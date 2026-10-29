import { describe, expect, it } from 'vitest';
import type { MapRules } from '@atlas-vtt/api-types';
import { stockMapRules, type RulesView } from '../../../src/connect/stockRules';

const DEFAULTS = Object.freeze({
  collectionId: null, gridDefaults: null, measurement: {} as MapRules['measurement'],
  resources: Object.freeze([]), conditions: Object.freeze([]),
  initiative: Object.freeze({ mode: 'turn-order', roll: '1d20', firstSide: 'players' }),
  dice: Object.freeze({ defaultRoll: '1d20', crit: 'natural' }),
}) as MapRules;

const HP = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true, slot: 0 };
const FRIGHTENED = { id: 'c1', name: 'Frightened', color: '#ff0000', valued: true, effect: 'none' };

function view(mapPath: string | null, parts: { sync?: unknown; assets?: unknown } = {}): RulesView {
  return {
    mapPath: () => mapPath,
    serviceManager: {
      getRendererService: () => ({ getRenderer: () => ({ getTokenRenderer: () => ({ collectionSync: parts.sync }) }) }),
      getAssetService: () => parts.assets,
    },
  };
}

const assets = (settings: Record<string, unknown> | null) => ({
  getCollectionForMap: (path: string) => (path.startsWith('atlas-vtt/collections/Main/') ? 'Main' : null),
  getCollectionSettings: () => settings ?? { conditions: [] },
});

describe('the rules of a stock Atlas map', () => {
  it("reads the map a view shows from its token renderer, as Atlas draws it", () => {
    const sync = { resources: () => [HP], conditions: () => [FRIGHTENED] };
    const rules = stockMapRules([view('atlas-vtt/collections/Main/scenes/a.atlasmap', { sync, assets: assets({ conditions: [] }) })], 'atlas-vtt/collections/Main/scenes/a.atlasmap', DEFAULTS);
    expect(rules.collectionId).toBe('Main');
    expect(rules.resources).toEqual([HP]);
    expect(rules.conditions).toEqual([{ id: 'c1', name: 'Frightened', color: '#ff0000', valued: true }]);
    expect(rules.resources[0]).not.toBe(HP);
    expect(Object.isFrozen(rules.resources[0])).toBe(true);
  });

  it("reads another tab's map from the asset index, with Atlas's HP where nothing is stored", () => {
    const shown = view('atlas-vtt/collections/Main/scenes/a.atlasmap', { assets: assets({ conditions: [FRIGHTENED], initiative: { mode: 'sides', roll: '2d6', firstSide: 'opponents' } }) });
    const rules = stockMapRules([shown], 'atlas-vtt/collections/Main/scenes/b.atlasmap', DEFAULTS);
    expect(rules.resources).toEqual([expect.objectContaining({ key: 'hp', visibleToPlayers: false })]);
    expect(rules.conditions.map((condition) => condition.name)).toEqual(['Frightened']);
    expect(rules.initiative).toEqual({ mode: 'sides', roll: '2d6', firstSide: 'opponents' });
  });

  it("reads Atlas 0.9's initiative by cards as the collection says, never as the defaults", () => {
    const shown = view('atlas-vtt/collections/Main/scenes/a.atlasmap', { assets: assets({ initiative: { mode: 'cards', roll: '1d8', firstSide: 'opponents', deck: 10 } }) });
    const rules = stockMapRules([shown], 'atlas-vtt/collections/Main/scenes/a.atlasmap', DEFAULTS);
    expect(rules.initiative).toEqual({ mode: 'cards', roll: '1d8', firstSide: 'opponents' });
  });

  it("reads a side the collection named as first (Atlas 0.9) as the players'", () => {
    const shown = view('atlas-vtt/collections/Main/scenes/a.atlasmap', { assets: assets({ initiative: { mode: 'sides', roll: '1d20', firstSide: 'monsters', sides: [{ id: 'monsters', name: 'Monsters' }] } }) });
    // The named side is kept as a side of the collection (Atlas 0.10), with both built-in sides after it, as Atlas reads the list.
    expect(stockMapRules([shown], 'atlas-vtt/collections/Main/scenes/a.atlasmap', DEFAULTS).initiative).toEqual({
      mode: 'sides', roll: '1d20', firstSide: 'players', sides: [{ id: 'monsters', name: 'Monsters' }, { id: 'players' }, { id: 'opponents' }],
    });
  });

  it("reads the sides a collection names (Atlas 0.10), checked, and none where it names only the two built-in ones", () => {
    const sides = [{ id: 'opponents' }, { id: 'goblins', name: ' Goblins ' }, { id: 'goblins', name: 'Dup' }, { id: 'nameless' }, { id: 7 }, { id: 'players', name: 'Mine' }];
    const named = view('atlas-vtt/collections/Main/scenes/a.atlasmap', { assets: assets({ initiative: { mode: 'sides', roll: '1d20', firstSide: 'opponents', sides } }) });
    const rules = stockMapRules([named], 'atlas-vtt/collections/Main/scenes/a.atlasmap', DEFAULTS).initiative as unknown as { sides: unknown[] };
    expect(rules.sides).toEqual([{ id: 'opponents' }, { id: 'goblins', name: 'Goblins' }, { id: 'players' }]);
    expect(Object.isFrozen(rules.sides)).toBe(true);
    const plain = view('atlas-vtt/collections/Main/scenes/a.atlasmap', { assets: assets({ initiative: { mode: 'sides', roll: '1d20', firstSide: 'players', sides: [{ id: 'players' }, { id: 'opponents' }] } }) });
    expect(stockMapRules([plain], 'atlas-vtt/collections/Main/scenes/a.atlasmap', DEFAULTS).initiative).toEqual({ mode: 'sides', roll: '1d20', firstSide: 'players' });
  });

  it('keeps the defaults without a map, a view, an index or a collection, and drops what it cannot read', () => {
    expect(stockMapRules([], 'x.atlasmap', DEFAULTS)).toBe(DEFAULTS);
    expect(stockMapRules([view('a')], null, DEFAULTS)).toBe(DEFAULTS);
    expect(stockMapRules([view('elsewhere.atlasmap', { assets: assets(null) })], 'elsewhere.atlasmap', DEFAULTS)).toBe(DEFAULTS);
    const throwing = { resources: () => { throw new Error('no'); }, conditions: () => [{ id: 3 }, FRIGHTENED, null] };
    const rules = stockMapRules([view('m', { sync: throwing })], 'm', DEFAULTS);
    expect(rules.resources).toBe(DEFAULTS.resources);
    expect(rules.conditions.map((condition) => condition.id)).toEqual(['c1']);
  });
});

describe("a stock Atlas map's dice rules", () => {
  const MAP = 'atlas-vtt/collections/Main/scenes/a.atlasmap';
  const EXPLODE = { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 };
  const withTool = (diceRules: unknown, settings: Record<string, unknown> | null = null): RulesView => ({
    mapPath: () => MAP,
    serviceManager: {
      getToolController: () => ({ getDiceTool: () => ({ getDiceRules: () => diceRules }) }),
      getAssetService: () => assets(settings),
    },
  });

  it("reads the dice tool of the view showing the map first, the collection's explode included", () => {
    const rules = stockMapRules([withTool({ defaultRoll: '1d6', crit: 'none', explode: EXPLODE })], MAP, DEFAULTS);
    expect(rules.dice).toEqual({ defaultRoll: '1d6', crit: 'none', explode: EXPLODE });
  });

  it("reads a dice set's groups as its default roll", () => {
    const rules = stockMapRules([withTool({ dice: [{ count: 2, sides: 12 }], crit: 'doubles' })], MAP, DEFAULTS);
    expect(rules.dice).toEqual({ defaultRoll: '2d12', crit: 'doubles' });
  });

  it("reads the collection's stored dice where no view shows the map, and the defaults without either", () => {
    const shown = view(MAP, { assets: assets({ dice: { defaultRoll: '2d10', crit: 'high-total', explode: EXPLODE } }) });
    expect(stockMapRules([shown], 'atlas-vtt/collections/Main/scenes/b.atlasmap', DEFAULTS).dice).toEqual({ defaultRoll: '2d10', crit: 'high-total', explode: EXPLODE });
    expect(stockMapRules([view(MAP, { assets: assets({}) })], MAP, DEFAULTS).dice).toBe(DEFAULTS.dice);
    // A dice tool that throws, or answers nothing, leaves the collection's stored dice.
    const throwing: RulesView = { mapPath: () => MAP, serviceManager: { getToolController: () => { throw new Error('no'); }, getAssetService: () => assets({ dice: { defaultRoll: '1d8', crit: 'none' } }) } };
    expect(stockMapRules([throwing], MAP, DEFAULTS).dice).toEqual({ defaultRoll: '1d8', crit: 'none' });
  });

  it("takes a mixed dice set's default die from the collection's stored dice, not the defaults", () => {
    const rules = stockMapRules([withTool({ dice: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }], crit: 'doubles' }, { dice: { defaultRoll: '2d6', crit: 'none' } })], MAP, DEFAULTS);
    expect(rules.dice).toEqual({ defaultRoll: '2d6', crit: 'doubles' });
  });

  it('reads each field it cannot as the default, and drops an explode rule it cannot read', () => {
    const rules = stockMapRules([withTool({ defaultRoll: 'lots', crit: 'sometimes', explode: { dice: 'all', repeats: 'yes', highFaces: 1, lowFaces: 0 } })], MAP, DEFAULTS);
    expect(rules.dice).toEqual({ defaultRoll: '1d20', crit: 'natural' });
  });
});

describe("how a stock Atlas map measures (the collection's grid defaults)", () => {
  const MAP = 'atlas-vtt/collections/Main/scenes/a.atlasmap';
  // What Atlas's 5e preset saves into a collection: the very block in a collection.json.
  const FIVE_E = { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', diagonalRule: 'equidistant', coneAngle: 53.13, abstractRangeBands: [] };
  const rulesOf = (gridDefaults: unknown) => stockMapRules([view(MAP, { assets: assets({ conditions: [], gridDefaults }) })], MAP, { ...DEFAULTS, measurement: { mode: 'abstract', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 } as unknown as MapRules['measurement'] });

  it("reads the collection's measurement rules, which players' rulers and cones then follow", () => {
    const rules = rulesOf(FIVE_E);
    expect(rules.gridDefaults).toEqual({ unitType: 'feet', unitDistance: 5, measurementMode: 'metric', diagonalRule: 'equidistant', coneAngle: 53.13 });
    expect(rules.measurement).toMatchObject({ mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', coneAngle: 53.13 });
    expect(Object.isFrozen(rules.gridDefaults)).toBe(true);
  });

  it('reads metres, range bands and a diagonal rule the collection sets, and 90 degrees where it sets no cone', () => {
    const rules = rulesOf({ unitType: 'meters', unitDistance: 1.5, measurementMode: 'abstract', diagonalRule: 'alternating', abstractRangeBands: [{ name: 'Close', maxSquares: 2 }, { name: 'Far', maxSquares: 12 }] });
    expect(rules.measurement).toMatchObject({ mode: 'abstract', unitType: 'meters', diagonalRule: 'alternating', coneAngle: 90 });
    expect(rules.measurement.rangeBands).toEqual([{ name: 'Close', maxSquares: 2 }, { name: 'Far', maxSquares: 12 }]);
    expect(rules.gridDefaults?.coneAngle).toBeUndefined();
  });

  it('keeps what it cannot read as Atlas does: no collection rules, and a cone or diagonal rule left unset', () => {
    for (const bad of [undefined, null, 'x', {}, { ...FIVE_E, unitType: 'miles' }, { ...FIVE_E, unitDistance: 0 }, { ...FIVE_E, unitDistance: Number.NaN }, { ...FIVE_E, unitDistance: 1e9 }, { ...FIVE_E, measurementMode: 'both' }]) {
      const rules = rulesOf(bad);
      expect(rules.gridDefaults).toBeNull();
      expect(rules.measurement).toMatchObject({ mode: 'abstract', coneAngle: 90 });
    }
    const odd = rulesOf({ ...FIVE_E, diagonalRule: 'manhattan', coneAngle: 400 });
    expect(odd.gridDefaults).toEqual({ unitType: 'feet', unitDistance: 5, measurementMode: 'metric' });
    expect(odd.measurement).toMatchObject({ mode: 'metric', diagonalRule: 'equidistant', coneAngle: 90 });
    expect(rulesOf({ ...FIVE_E, coneAngle: 0 }).gridDefaults?.coneAngle).toBeUndefined();
  });

  it('drops range bands it cannot read and keeps at most twelve', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ name: `Band ${index}`, maxSquares: index + 1 }));
    const rules = rulesOf({ ...FIVE_E, measurementMode: 'abstract', abstractRangeBands: [{ name: 5, maxSquares: 1 }, { name: 'Bad', maxSquares: -2 }, null, ...many] });
    expect(rules.gridDefaults?.abstractRangeBands).toHaveLength(12);
    expect(rules.gridDefaults?.abstractRangeBands?.[0]).toEqual({ name: 'Band 0', maxSquares: 1 });
  });

  it("leaves a map outside every collection to Atlas's defaults and the map's own grid", () => {
    expect(stockMapRules([view(MAP, { assets: assets({ gridDefaults: FIVE_E }) })], 'loose/map.atlasmap', DEFAULTS).gridDefaults).toBeNull();
  });
});
