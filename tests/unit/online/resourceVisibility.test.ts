/**
 * What the GM lets players see of each resource, per placed token and per statblock: the placed token's choice first,
 * then its statblock's, then the collection's; a bar shown alone never carries its numbers, and a hidden resource
 * leaves nothing on the wire, on the token or in the initiative list.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Character, ResourceDefinition } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { initiativeShare, projectBars, projectWheels } from '../../../src/app/online/scene/projectResources';
import {
  NO_RESOURCE_VISIBILITY, readResourceVisibility, resourceShowsFor, ResourceVisibilityStore, statblockKey, statblockLabel, withStatblockShow, withTokenShow,
  type ResourceShow, type ResourceVisibilityData,
} from '../../../src/app/online/scene/resourceVisibility';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { wheelGauge } from '../../../src/app/online/view/layers/tokenWheels';
import { fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

const define = (key: string, patch: Partial<ResourceDefinition> = {}): ResourceDefinition => ({
  key, name: key.toUpperCase(), field: key, direction: 'drains', color: '#22c55e', visibleToPlayers: true, ...patch,
});
const HP = define('hp', { slot: 0 });
const KI = define('ki', { slot: 2 });
const holder = (resources: Record<string, { current: number; max: number }>): Pick<Character, 'resources'> => ({ resources });
const showAll = (show: ResourceShow) => () => show;

describe('resourceShowsFor', () => {
  const data: ResourceVisibilityData = {
    tokens: { 'maps/cave.md': { g1: { hp: 'numbers' } } },
    statblocks: { 'Bestiary/Goblin.md': { hp: 'bar' }, 'name:Orc': { hp: 'hidden' } },
  };
  const shows = resourceShowsFor(data, 'maps/cave.md');

  it("takes the placed token's choice, then its statblock's, then the collection's", () => {
    const goblin = { statblockPath: 'Bestiary/Goblin.md' };
    expect(shows('g1', goblin)(HP)).toBe('numbers');
    expect(shows('g2', goblin)(HP)).toBe('bar');
    expect(shows('g2', {})(HP)).toBe('both');
    expect(shows('g2', {})(define('hp', { visibleToPlayers: false }))).toBe('hidden');
    expect(shows('o1', { statblockName: 'Orc' })(HP)).toBe('hidden');
  });

  it("keeps a placed token's choice to its own map", () => {
    expect(resourceShowsFor(data, 'maps/inn.md')('g1', {})(HP)).toBe('both');
    expect(resourceShowsFor(data, null)('g1', {})(HP)).toBe('both');
  });

  it('can show a resource the collection hides', () => {
    const revealed = resourceShowsFor(withTokenShow(NO_RESOURCE_VISIBILITY, 'm', 't', 'hp', 'both'), 'm');
    expect(revealed('t', {})(define('hp', { visibleToPlayers: false }))).toBe('both');
  });
});

describe('statblock keys', () => {
  it("is the statblock's note, else the bestiary creature's name, else none", () => {
    expect(statblockKey({ statblockPath: 'B/Goblin.md', statblockName: 'Goblin' })).toBe('B/Goblin.md');
    expect(statblockKey({ statblockName: ' Orc ' })).toBe('name:Orc');
    expect(statblockKey({ statblockPath: '', statblockName: null })).toBeNull();
    expect(statblockLabel({ statblockPath: 'B/Goblin Boss.md' })).toBe('Goblin Boss');
    expect(statblockLabel({ statblockPath: 'B/x.md', statblockName: 'Goblin' })).toBe('Goblin');
  });
});

describe('the choices file', () => {
  it('keeps only choices, and leaves out what is not one', () => {
    expect(readResourceVisibility({
      tokens: { m: { t: { hp: 'bar', mp: 'loud' }, empty: {} }, '': { t: { hp: 'bar' } }, bad: 3 },
      statblocks: { s: { hp: 'hidden' }, junk: ['x'] },
    })).toEqual({ tokens: { m: { t: { hp: 'bar' } } }, statblocks: { s: { hp: 'hidden' } } });
    expect(readResourceVisibility(null)).toEqual(NO_RESOURCE_VISIBILITY);
  });

  it('drops a choice set back to the level below, and empty records with it', () => {
    const set = withStatblockShow(withTokenShow(NO_RESOURCE_VISIBILITY, 'm', 't', 'hp', 'bar'), 's', 'hp', 'numbers');
    expect(set).toEqual({ tokens: { m: { t: { hp: 'bar' } } }, statblocks: { s: { hp: 'numbers' } } });
    expect(withStatblockShow(withTokenShow(set, 'm', 't', 'hp', null), 's', 'hp', null)).toEqual({ tokens: {}, statblocks: {} });
  });

  it('reads the file once, keeps a change made before then, writes each change, and tells its listeners', async () => {
    const saved: unknown[] = [];
    let release!: (value: unknown) => void;
    const file = { load: () => new Promise<unknown>((resolve) => { release = resolve; }), save: vi.fn(async (data: ResourceVisibilityData) => { saved.push(data); }) };
    const store = new ResourceVisibilityStore(file);
    const heard = vi.fn();
    store.subscribe(heard);
    const loading = store.load();
    store.setStatblockShow('s', 'hp', 'bar');
    expect(store.statblockShow('s', 'hp')).toBe('bar');
    release({ tokens: { m: { t: { hp: 'hidden' } } }, statblocks: {} });
    await loading;
    expect(store.tokenShow('m', 't', 'hp')).toBe('hidden');
    expect(store.statblockShow('s', 'hp')).toBe('bar');
    store.setTokenShow('m', 't', 'hp', null);
    await store.flush();
    expect(saved.at(-1)).toEqual({ tokens: {}, statblocks: { s: { hp: 'bar' } } });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});

describe('what each choice sends', () => {
  const values = holder({ hp: { current: 7, max: 12 }, ki: { current: 2, max: 5 } });

  it('both: the bar or wheel with its numbers, as the collection would', () => {
    expect(projectBars(values, [HP], showAll('both'))).toEqual(projectBars(values, [HP]));
    expect(projectWheels(values, [KI], showAll('both'))).toEqual([{ slot: 2, color: '#22c55e', current: 2, max: 5, fixed: false }]);
  });

  it('bar only: how full, never the numbers, nor a wheel\'s segments', () => {
    const [bar] = projectBars(values, [HP], showAll('bar'));
    expect(bar).toEqual({ color: '#22c55e', share: 0.58, spent: false });
    const [wheel] = projectWheels(values, [KI], showAll('bar'));
    expect(wheel).toEqual({ slot: 2, color: '#22c55e', share: 0.4, fixed: false });
    expect(wheelGauge(wheel!)).toEqual({ share: 0.4, ticks: [] });
  });

  it('numbers only: the current number alone, with nothing that tells the maximum, drawn without the bar or ring', () => {
    expect(projectBars(values, [HP], showAll('numbers'))).toEqual([{ color: '#22c55e', share: 1, spent: false, current: 7, bar: false }]);
    const [wheel] = projectWheels(values, [KI], showAll('numbers'));
    expect(wheel).toEqual({ slot: 2, color: '#22c55e', current: 2, fixed: false, ring: false });
    expect(wheelGauge(wheel!)).toBeNull();
    // A static resource's number is its value; a low one keeps its own colour, never the warning red; nor is it marked spent.
    expect(projectBars(holder({ ac: { current: 0, max: 15 } }), [define('ac', { direction: 'static' })], showAll('numbers'))).toEqual([{ color: '#22c55e', share: 1, spent: false, max: 15, fixed: true, bar: false }]);
    const low = projectBars(holder({ hp: { current: 0, max: 12 } }), [define('hp', { defeatedWhenSpent: true })], showAll('numbers'));
    expect(low).toEqual([{ color: '#22c55e', share: 1, spent: false, current: 0, bar: false }]);
  });

  it('hidden: nothing, and the next bar moves up', () => {
    const MP = define('mp', { slot: 1, color: '#3b82f6' });
    const both = holder({ hp: { current: 7, max: 12 }, mp: { current: 1, max: 2 } });
    expect(projectBars(both, [HP, MP], (definition) => (definition.key === 'hp' ? 'hidden' : 'both'))).toEqual([{ color: '#3b82f6', share: 0.5, spent: false, current: 1, max: 2 }]);
    expect(projectWheels(values, [KI], showAll('hidden'))).toEqual([]);
  });

  it("gives the initiative list's bar only where players see the HP bar", () => {
    expect(initiativeShare(values, [HP], showAll('both'))).toBe(0.58);
    expect(initiativeShare(values, [HP], showAll('bar'))).toBe(0.58);
    expect(initiativeShare(values, [HP], showAll('numbers'))).toBeNull();
    expect(initiativeShare(values, [HP], showAll('hidden'))).toBeNull();
    expect(initiativeShare(values, [define('hp', { visibleToPlayers: false })], showAll('bar'))).toBe(0.58);
  });
});

describe('the scene players receive', () => {
  const goblin = (id: string, x: number): Character => ({
    id, kind: 'character', x, y: 70, imagePath: 'goblin.png', name: 'Goblin', statblockPath: 'B/Goblin.md',
    resources: { hp: { current: 4, max: 7 }, ki: { current: 1, max: 3 } },
  } as Character);
  const project = (data: ResourceVisibilityData) => projectForPlayers(snapshotOf({
    background: 'maps/cave.png',
    mapPath: 'maps/cave.md',
    objects: { tokens: { g1: goblin('g1', 70), g2: goblin('g2', 140) }, fog: {}, texts: {}, drawings: {} },
    initiative: { isActive: true, round: 1, entries: [{ id: 'e1', tokenId: 'g1', name: 'Goblin', initiative: 12, order: 0, isActive: true }] },
    initiativeTrackerOpen: true,
  } as never), {
    sceneId: 's', rules: { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }, coverage: FogCoverage.EMPTY,
    assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, resources: [HP, KI], resourceShows: resourceShowsFor(data, 'maps/cave.md'),
  });

  it('sends each goblin what its own choice, else its statblock\'s, lets through, in a scene players accept', () => {
    let data = withStatblockShow(NO_RESOURCE_VISIBILITY, 'B/Goblin.md', 'hp', 'bar');
    data = withStatblockShow(data, 'B/Goblin.md', 'ki', 'hidden');
    data = withTokenShow(data, 'maps/cave.md', 'g2', 'hp', 'numbers');
    const scene = project(data);
    expect(scene.tokens.g1?.resources).toEqual([{ color: '#22c55e', share: 0.57, spent: false }]);
    expect(scene.tokens.g1).not.toHaveProperty('wheels');
    expect(scene.tokens.g2?.resources).toEqual([{ color: '#22c55e', share: 1, spent: false, current: 4, bar: false }]);
    expect(scene.initiative?.entries[0]?.hpShare).toBe(0.57);
    const { fog: _fog, drawings: _drawings, ...body } = scene;
    expect(isPlayerSceneBody(body)).toBe(true);
    // No number of a goblin shown as a bar is anywhere in what goes out.
    expect(JSON.stringify(scene.tokens.g1)).not.toMatch(/"(current|max)"/);
  });

  it('leaves out a hidden HP everywhere, the initiative list too', () => {
    const scene = project(withStatblockShow(NO_RESOURCE_VISIBILITY, 'B/Goblin.md', 'hp', 'hidden'));
    expect(scene.tokens.g1?.resources).toEqual([]);
    expect(scene.initiative?.entries[0]?.hpShare).toBeNull();
  });

  it('accepts a bar-only wheel and refuses a wheel with neither numbers nor share', () => {
    const scene = project(withStatblockShow(NO_RESOURCE_VISIBILITY, 'B/Goblin.md', 'ki', 'bar'));
    expect(scene.tokens.g1?.wheels).toEqual([{ slot: 2, color: '#22c55e', share: 0.33, fixed: false }]);
    const { fog: _fog, drawings: _drawings, ...body } = scene;
    expect(isPlayerSceneBody(body)).toBe(true);
    const broken = { ...body, tokens: { g1: { ...body.tokens.g1, wheels: [{ slot: 2, color: '#22c55e', fixed: false }] } } };
    expect(isPlayerSceneBody(broken)).toBe(false);
  });
});
