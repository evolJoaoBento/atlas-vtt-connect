/**
 * What players see of each resource, as a section of Atlas's Edit Token dialog (applied when it saves), and how the
 * player view draws a bar or wheel shown without its numbers, or a number shown alone.
 */
import { describe, expect, it } from 'vitest';
import type { Character, ResourceDefinition, SceneSnapshot, TokenMenuContext } from '@atlas-vtt/api-types';
import type { EditTokenSectionSpec } from '../../../src/app/online/gm-ui/editTokenSection';
import {
  collectionDefaultLabel, everyTokenLabel, PLAYERS_SEE_TITLE, resourceVisibilitySection, sameAsStatblockLabel, THIS_TOKEN_LABEL,
} from '../../../src/app/online/gm-ui/resourceVisibilitySection';
import { atlasBars, SHARE_SCALE } from '../../../src/app/online/obsidian/convertResources';
import { ResourceVisibilityStore } from '../../../src/app/online/scene/resourceVisibility';
import { drawTokenUi } from '../../../src/app/online/view/layers/tokenUiDrawing';
import { drawWheels, WHEEL_NUMBER } from '../../../src/app/online/view/layers/tokenWheels';
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
  const provider = resourceVisibilitySection({ views, resources: () => DEFINITIONS, store });
  const ctx: TokenMenuContext = { viewId: 'v1', kind: 'map', isPlayerView: false, tokenId: 'g1', tokenKind: 'character' };
  return { store, section: (patch: Partial<TokenMenuContext> = {}): EditTokenSectionSpec | null => provider({ ...ctx, ...patch }) };
}

describe("the Edit Token dialog's section of what players see", () => {
  it('has a row per resource the token has, with a choice for it and for every token of its statblock', () => {
    const spec = setup({ statblockPath: 'B/Goblin.md' }).section()!;
    expect(spec.title).toBe(PLAYERS_SEE_TITLE);
    expect(spec.columns).toEqual([THIS_TOKEN_LABEL, everyTokenLabel('Goblin')]);
    expect(spec.rows.map((row) => row.label)).toEqual(['HP', 'Mana']);
    const [own, every] = spec.rows[0]!.choices;
    expect(own!.options.map((option) => option.label)).toEqual([sameAsStatblockLabel('Goblin'), 'Bar and numbers', 'Bar only', 'Number only', 'Hidden']);
    expect(every!.options[0]!.label).toBe('Map default (shown)');
    expect(collectionDefaultLabel(DEFINITIONS[1]!)).toBe('Map default (hidden)');
    expect([own!.value, every!.value]).toEqual(['', '']);
  });

  it('applies what was picked when the dialog saves, and nothing it left as it was', () => {
    const { section, store } = setup({ statblockPath: 'B/Goblin.md' });
    store.setTokenShow('maps/cave.md', 'g1', 'mp', 'both');
    const spec = section()!;
    expect(spec.rows[1]!.choices[0]!.value).toBe('both');
    spec.save(new Map([['token:hp', 'bar'], ['statblock:hp', 'hidden'], ['token:mp', ''], ['statblock:mp', 'nonsense']]));
    expect(store.tokenShow('maps/cave.md', 'g1', 'hp')).toBe('bar');
    expect(store.statblockShow('B/Goblin.md', 'hp')).toBe('hidden');
    expect(store.tokenShow('maps/cave.md', 'g1', 'mp')).toBeNull();
    expect(store.statblockShow('B/Goblin.md', 'mp')).toBeNull();
  });

  it('offers only the token level, defaulting to the map, for a token without a statblock', () => {
    const spec = setup({}).section()!;
    expect(spec.columns).toEqual([THIS_TOKEN_LABEL]);
    expect(spec.rows[1]!.choices.map((choice) => choice.options[0]!.label)).toEqual(['Map default (hidden)']);
  });

  it("is the GM's only: nothing for a plain token, a player's view, a remote one, or a token without resources", () => {
    const { section } = setup({});
    expect(section({ tokenKind: 'token' })).toBeNull();
    expect(section({ isPlayerView: true })).toBeNull();
    expect(section({ kind: 'remote' })).toBeNull();
    expect(setup({ resources: {} }).section()).toBeNull();
  });
});

describe('the player view draws', () => {
  const geometry = { size: 70, cellSize: 70, ringRadius: 33 };
  const texts = (surface: RecordingSurface): string[] => surface.ops('text').map((call) => call.text);

  it('the current number alone always, with no bar under it, and a static value alone', () => {
    const surface = new RecordingSurface();
    drawTokenUi(surface, playerToken({ resources: [{ color: '#22c55e', share: 1, spent: false, current: 4, bar: false }] }), geometry);
    expect(texts(surface)).toEqual(['4']);
    expect(surface.ops('roundRect')).toEqual([]);
    const fixed = new RecordingSurface();
    drawTokenUi(fixed, playerToken({ resources: [{ color: '#22c55e', share: 1, spent: false, max: 15, fixed: true, bar: false }] }), geometry);
    expect(texts(fixed)).toEqual(['15']);
  });

  it("numbers alone at the selected token's scale, so they read at any zoom", () => {
    const surface = new RecordingSurface();
    drawTokenUi(surface, playerToken({ resources: [{ color: '#22c55e', share: 1, spent: false, current: 4, bar: false }] }), geometry, { uiScale: 0.5, numbersAloneScale: 2 });
    expect(surface.ops('push').map((call) => call.scale)).toContain(4 * WHEEL_NUMBER.scale);
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

describe("Atlas's remote view (an Obsidian player on Atlas's API)", () => {
  it('draws a bar shown alone as its share, and leaves out a number shown alone, which it has no form for', () => {
    const alone = atlasBars(playerToken({ resources: [{ color: '#22c55e', share: 0.5, spent: false }] }));
    expect(alone?.values.bar0).toEqual({ current: 50, max: SHARE_SCALE });
    const numbers = atlasBars(playerToken({ resources: [{ color: '#22c55e', share: 1, spent: false, current: 4, bar: false }, { color: '#3b82f6', share: 0.5, spent: false }] }));
    expect(numbers?.values.bar0).toEqual({ current: 50, max: SHARE_SCALE });
    expect(numbers?.values).not.toHaveProperty('bar1');
  });
});
