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
