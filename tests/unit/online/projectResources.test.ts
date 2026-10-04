/**
 * What online players receive of token resources is what the player window draws, and no more:
 * the bars its collection shows to players, in the colour the window shows them, as a share.
 */
import { describe, expect, it } from 'vitest';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { initiativeShare, isDowned, projectBars } from '../../../src/app/online/scene/projectResources';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import type { Character, ResourceDefinition, SceneSnapshot } from '@atlas-vtt/api-types';
import { fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

const define = (key: string, patch: Partial<ResourceDefinition> = {}): ResourceDefinition => ({
  key, name: key, field: key, direction: 'drains', color: '#22c55e', visibleToPlayers: true, ...patch,
});
const HP = define('hp', { defeatedWhenSpent: true });
const holder = (resources: Record<string, { current: number; max: number }>): Pick<Character, 'resources'> => ({ resources });

describe('projectBars', () => {
  it('sends a bar for each resource players see, in socket order, as a share', () => {
    const definitions = [define('stress', { direction: 'fills', color: '#a855f7', slot: 1 }), define('ammo', { color: '#f59e0b', slot: 0 })];
    expect(projectBars(holder({ stress: { current: 3, max: 6 }, ammo: { current: 7, max: 12 } }), definitions)).toEqual([
      { color: '#f59e0b', share: 0.58, spent: false },
      { color: '#a855f7', share: 0.5, spent: false },
    ]);
  });

  it('never sends a resource the collection keeps from players, nor one without a maximum or a value', () => {
    const definitions = [define('gm', { visibleToPlayers: false, slot: 0 }), define('empty', { slot: 1 }), define('none', { slot: 2 })];
    expect(projectBars(holder({ gm: { current: 1, max: 4 }, empty: { current: 0, max: 0 } }), definitions)).toEqual([]);
  });

  it('draws bars only: a resource in a wheel socket is not sent, as the window has no wheels for players', () => {
    const definitions = [define('a', { slot: 0 }), define('b', { slot: 1 }), define('wheel', { slot: 2 }), define('wheel2', { slot: 5 })];
    const values = { a: { current: 1, max: 2 }, b: { current: 1, max: 2 }, wheel: { current: 1, max: 2 }, wheel2: { current: 1, max: 2 } };
    expect(projectBars(holder(values), definitions)).toHaveLength(2);
  });

  it('stacks the bars that are shown, whatever their sockets: a hidden first resource lets the second move up', () => {
    const definitions = [define('gm', { visibleToPlayers: false, slot: 0 }), define('seen', { color: '#3b82f6', slot: 1 })];
    expect(projectBars(holder({ gm: { current: 1, max: 4 }, seen: { current: 2, max: 4 } }), definitions)).toEqual([{ color: '#3b82f6', share: 0.5, spent: false }]);
  });

  it('shows a static value as a full bar, with no share to give away', () => {
    expect(projectBars(holder({ ac: { current: 3, max: 15 } }), [define('ac', { direction: 'static', color: '#94a3b8' })])).toEqual([{ color: '#94a3b8', share: 1, spent: false }]);
  });

  it('sends the colour the window shows: a resource that defeats the token warns as it runs low', () => {
    const colorAt = (current: number): string | undefined => projectBars(holder({ hp: { current, max: 10 } }), [HP])[0]?.color;
    expect([colorAt(10), colorAt(7), colorAt(6), colorAt(3), colorAt(2)]).toEqual(['#22c55e', '#22c55e', '#eab308', '#eab308', '#ef4444']);
    // One that does not defeat it keeps its colour
    expect(projectBars(holder({ ammo: { current: 1, max: 10 } }), [define('ammo', { color: '#f59e0b' })])[0]?.color).toBe('#f59e0b');
  });

  it('darkens the first spent bar that defeats the token, and only that one', () => {
    const definitions = [HP, define('sanity', { direction: 'fills', defeatedWhenSpent: true, color: '#a855f7' })];
    const bars = projectBars(holder({ hp: { current: 0, max: 10 }, sanity: { current: 6, max: 6 } }), definitions);
    expect(bars).toEqual([{ color: '#ef4444', share: 0, spent: true }, { color: '#ef4444', share: 1, spent: false }]);
    expect(projectBars(holder({ hp: { current: 1, max: 10 }, sanity: { current: 6, max: 6 } }), definitions).map((bar) => bar.spent)).toEqual([false, true]);
  });

  it('sends no more precision than a bar shows: hundredths', () => {
    expect(projectBars(holder({ hp: { current: 1, max: 3 } }), [HP])[0]?.share).toBe(0.33);
    expect(projectBars(holder({ hp: { current: 2, max: 3 } }), [HP])[0]?.share).toBe(0.67);
    expect(projectBars(holder({ hp: { current: 99.9, max: 100 } }), [HP])[0]?.share).toBe(1);
  });

  it('reads messy values the way the validator needs: clamped, with a neutral colour for a bad one', () => {
    const odd = { resources: { hp: { current: '9', max: '4' } } } as unknown as Pick<Character, 'resources'>;
    expect(projectBars(odd, [HP])).toEqual([{ color: '#22c55e', share: 1, spent: false }]);
    const [bar] = projectBars(holder({ hp: { current: -5, max: 10 } }), [define('hp', { color: 'url(javascript:alert(1))' })]);
    expect(bar).toEqual({ color: '#888888', share: 0, spent: false });
  });
});

describe('isDowned', () => {
  it('greys a creature out when a resource that defeats it is spent, even one players do not see', () => {
    const definitions = [define('hp', { defeatedWhenSpent: true, visibleToPlayers: false })];
    expect(isDowned({ kind: 'character', ...holder({ hp: { current: 0, max: 10 } }) }, definitions)).toBe(true);
    expect(isDowned({ kind: 'character', ...holder({ hp: { current: 1, max: 10 } }) }, definitions)).toBe(false);
    expect(isDowned({ kind: 'token', ...holder({ hp: { current: 0, max: 10 } }) }, definitions)).toBe(false);
    expect(isDowned({ kind: 'character', ...holder({ hp: { current: 0, max: 10 } }) }, [])).toBe(false);
  });
});

describe('initiativeShare', () => {
  it('is the hp resource where the collection shows hp to players, whatever socket it takes', () => {
    const value = holder({ hp: { current: 5, max: 20 } });
    expect(initiativeShare(value, [define('hp', { slot: 4 })])).toBe(0.25);
    expect(initiativeShare(value, [define('hp', { visibleToPlayers: false })])).toBeNull();
    expect(initiativeShare(value, [define('health')])).toBeNull();
    expect(initiativeShare(holder({ hp: { current: 1, max: 0 } }), [define('hp')])).toBeNull();
    expect(initiativeShare(undefined, [define('hp')])).toBeNull();
  });
});

describe('resources in the projection', () => {
  const state = (tokens: Record<string, Character>): SceneSnapshot => snapshotOf({
    background: 'maps/tavern.png',
    objects: { tokens, fog: {}, texts: {}, drawings: {} },
  });
  const project = (tokens: Record<string, Character>, resources: readonly ResourceDefinition[]): ReturnType<typeof projectForPlayers> => projectForPlayers(state(tokens), {
    sceneId: 's', rules: { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }, coverage: FogCoverage.EMPTY,
    assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, resources,
  });
  const hero = (overrides: Partial<Character> = {}): Character => ({
    id: 'hero', kind: 'character', x: 70, y: 70, imagePath: 'hero.png', name: 'Hero', resources: { hp: { current: 5, max: 10 } }, ...overrides,
  });

  it('sends nothing without the collection’s definitions: a map whose collection is unknown shows no resource', () => {
    expect(project({ hero: hero() }, []).tokens.hero).toMatchObject({ resources: [], downed: false });
  });

  it('sends no resource of a hidden token, nor of one under fog', () => {
    const scene = project({ hero: hero(), spy: hero({ id: 'spy', isHidden: true }) }, [define('hp', { defeatedWhenSpent: true })]);
    expect(Object.keys(scene.tokens)).toEqual(['hero']);
    expect(JSON.stringify(scene)).not.toContain('spy');
  });

  it('keeps the GM’s resource names, keys and numbers off the wire', () => {
    const secret = define('secret-key', { name: 'SECRET name', field: 'SECRET.field', color: '#123456', slot: 0 });
    const scene = project({ hero: hero({ resources: { 'secret-key': { current: 3, max: 9 } }, overriddenMax: ['secret-key'] }) }, [secret]);
    const json = JSON.stringify(scene);
    expect(scene.tokens.hero?.resources).toEqual([{ color: '#123456', share: 0.33, spent: false }]);
    for (const leak of ['SECRET', 'secret-key', 'overriddenMax', '"current"', '"max"', '"key"']) expect(json).not.toContain(leak);
  });

  it('projects every mode into messages players accept, in snapshots and within the limits', () => {
    const definitions = [HP, define('stress', { direction: 'fills', slot: 1 }), define('doom', { visibleToPlayers: false, defeatedWhenSpent: true, slot: 3 })];
    const tokens = { hero: hero({ resources: { hp: { current: 0, max: 10 }, stress: { current: 6, max: 6 }, doom: { current: 0, max: 3 } } }) };
    const { fog, drawings, ...body } = project(tokens, definitions);
    expect(isPlayerSceneBody(body)).toBe(true);
    const message = decodeControl(encodeControl({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 1, drawingParts: 1 }));
    expect(message.kind).toBe('message');
    expect(fog).toEqual({});
    expect(drawings).toEqual({});
  });
});
