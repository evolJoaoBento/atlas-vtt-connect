/**
 * The token menu's choice of what players see of each resource, and how the player view draws a bar or wheel shown
 * without its numbers, or its numbers shown alone.
 */
import { describe, expect, it } from 'vitest';
import type { Character, MenuItem, ResourceDefinition, SceneSnapshot, TokenMenuContext } from '@atlas-vtt/api-types';
import {
  collectionDefaultLabel, everyTokenLabel, resourceMenuLabel, resourceVisibilityProvider, sameAsStatblockLabel, THIS_TOKEN_LABEL,
} from '../../../src/app/online/gm-ui/resourceVisibilityMenu';
import { ResourceVisibilityStore } from '../../../src/app/online/scene/resourceVisibility';
import { drawTokenUi } from '../../../src/app/online/view/layers/tokenUiDrawing';
import { drawWheels } from '../../../src/app/online/view/layers/tokenWheels';
import { playerToken } from './sceneFixtures';
import { RecordingSurface } from './recordingSurface';

const define = (key: string, name: string, patch: Partial<ResourceDefinition> = {}): ResourceDefinition => ({
  key, name, field: key, direction: 'drains', color: '#22c55e', visibleToPlayers: true, ...patch,
});
const DEFINITIONS = [define('hp', 'HP', { slot: 0 }), define('mp', 'Mana', { slot: 1, visibleToPlayers: false }), define('ki', 'Ki', { slot: 2 })];

function setup(token: Partial<Character>) {
  const store = new ResourceVisibilityStore({ load: () => Promise.resolve(null), save: () => Promise.resolve() });
  const character = { id: 'g1', kind: 'character', x: 0, y: 0, imagePath: 'g.png', name: 'Goblin', resources: { hp: { current: 4, max: 7 }, mp: { current: 1, max: 2 } }, ...token } as Character;
  const views = {
    list: () => [{ viewId: 'v1', kind: 'map' as const, activeTabId: null, tabs: [], mapPath: 'maps/cave.md', loaded: true }],
    snapshot: () => ({ objects: { tokens: { g1: character } } }) as unknown as SceneSnapshot,
  };
  const provider = resourceVisibilityProvider({ views, resources: () => DEFINITIONS, store });
  const ctx: TokenMenuContext = { viewId: 'v1', kind: 'map', isPlayerView: false, tokenId: 'g1', tokenKind: 'character' };
  return { store, menu: (patch: Partial<TokenMenuContext> = {}) => provider({ ...ctx, ...patch }) };
}
const labels = (items: readonly MenuItem[]): Array<string> => items.map((item) => (item.checked ? `✓ ${item.label}` : item.label));

describe("a token's menu of what players see", () => {
  it('has a submenu for each resource the token has, with choices for it and for every token of its statblock', () => {
    const { menu } = setup({ statblockPath: 'B/Goblin.md' });
    expect(menu().map((item) => item.label)).toEqual([resourceMenuLabel('HP'), resourceMenuLabel('Mana')]);
    expect(labels(menu()[0]!.submenu!)).toEqual([
      THIS_TOKEN_LABEL, `✓ ${sameAsStatblockLabel('Goblin')}`, 'Bar and numbers', 'Bar only', 'Numbers only', 'Hidden',
      everyTokenLabel('Goblin'), `✓ ${collectionDefaultLabel(DEFINITIONS[0]!)}`, 'Bar and numbers', 'Bar only', 'Numbers only', 'Hidden',
    ]);
    expect(collectionDefaultLabel(DEFINITIONS[0]!)).toBe('Map default (bar and numbers)');
    expect(collectionDefaultLabel(DEFINITIONS[1]!)).toBe('Map default (hidden)');
    expect(menu()[0]!.submenu!.filter((item) => !item.disabled).every((item) => item.keepOpen === true)).toBe(true);
  });

  it('sets and clears each level, its ticks following', () => {
    const { menu, store } = setup({ statblockPath: 'B/Goblin.md' });
    const pick = (label: string, nth = 0): void => menu()[0]!.submenu!.filter((item) => item.label === label)[nth]!.onClick!();
    pick('Bar only');
    expect(store.tokenShow('maps/cave.md', 'g1', 'hp')).toBe('bar');
    pick('Hidden', 1);
    expect(store.statblockShow('B/Goblin.md', 'hp')).toBe('hidden');
    expect(labels(menu()[0]!.submenu!)).toContain('✓ Bar only');
    expect(labels(menu()[0]!.submenu!)).toContain('✓ Hidden');
    pick(sameAsStatblockLabel('Goblin'));
    expect(store.tokenShow('maps/cave.md', 'g1', 'hp')).toBeNull();
  });

  it('offers only the token level, defaulting to the map, for a token without a statblock', () => {
    const { menu } = setup({});
    expect(labels(menu()[1]!.submenu!)).toEqual([THIS_TOKEN_LABEL, '✓ Map default (hidden)', 'Bar and numbers', 'Bar only', 'Numbers only', 'Hidden']);
  });

  it("is the GM's only: nothing for a plain token, a player's view or a remote one", () => {
    const { menu } = setup({});
    expect(menu({ tokenKind: 'token' })).toEqual([]);
    expect(menu({ isPlayerView: true })).toEqual([]);
    expect(menu({ kind: 'remote' })).toEqual([]);
  });
});

describe('the player view draws', () => {
  const geometry = { size: 70, cellSize: 70, ringRadius: 33 };
  const texts = (surface: RecordingSurface): string[] => surface.ops('text').map((call) => call.text);

  it('numbers alone always, with no bar under them', () => {
    const surface = new RecordingSurface();
    drawTokenUi(surface, playerToken({ resources: [{ color: '#22c55e', share: 0.5, spent: false, current: 4, max: 8, bar: false }] }), geometry);
    expect(texts(surface)).toEqual(['4', '/', '8']);
    expect(surface.ops('roundRect')).toEqual([]);
  });

  it('a bar alone with no numbers, even hovered', () => {
    const surface = new RecordingSurface();
    drawTokenUi(surface, playerToken({ resources: [{ color: '#22c55e', share: 0.5, spent: false }] }), geometry, { numbers: 1 });
    expect(texts(surface)).toEqual([]);
    expect(surface.calls.length).toBeGreaterThan(0);
  });

  it('a wheel alone filled to its share with no number, and a number alone with no ring', () => {
    const ring = new RecordingSurface();
    drawWheels(ring, { x: 0, y: 0 }, [{ slot: 2, color: '#3b82f6', share: 0.5, fixed: false }], 62, 33, 70);
    expect(texts(ring)).toEqual([]);
    expect(ring.ops('paths').some((call) => call.style.stroke === '#3b82f6')).toBe(true);
    const number = new RecordingSurface();
    drawWheels(number, { x: 0, y: 0 }, [{ slot: 2, color: '#3b82f6', current: 3, max: 5, fixed: false, ring: false }], 62, 33, 70);
    expect(texts(number)).toEqual(['3']);
    expect(number.calls.some((call) => (call.op === 'paths' || call.op === 'circle') && call.style.stroke === '#3b82f6')).toBe(false);
  });
});
