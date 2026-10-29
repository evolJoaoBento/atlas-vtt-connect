import { describe, expect, it } from 'vitest';
import type { ResourceDefinition } from '@atlas-vtt/api-types';
import { projectBars } from '../../../src/app/online/scene/projectResources';
import { hasShownValue, visibleResources } from '../../../src/app/online/scene/visibleResources';

const define = (key: string, extra: Partial<ResourceDefinition> = {}): ResourceDefinition =>
  ({ key, name: key.toUpperCase(), field: key, direction: 'drains', color: '#22c55e', visibleToPlayers: true, ...extra }) as ResourceDefinition;
const HP = define('hp', { defeatedWhenSpent: true });
const AC = define('ac', { direction: 'static', color: '#94a3b8' });
const STRESS = define('stress', { direction: 'fills', color: '#a855f7' });

describe("which values of a resource Atlas draws (Atlas 0.8's fix, kept in 0.10.2)", () => {
  it('draws a static value from a maximum of 0 up, and any other from above 0', () => {
    expect(hasShownValue(AC, { current: 0, max: 0 })).toBe(true);
    expect(hasShownValue(AC, { current: 15, max: 15 })).toBe(true);
    expect(hasShownValue(AC, { current: 0, max: -1 })).toBe(false);
    expect(hasShownValue(HP, { current: 0, max: 0 })).toBe(false);
    expect(hasShownValue(HP, { current: 3, max: 7 })).toBe(true);
    expect(hasShownValue(AC, { current: 0, max: Number.NaN })).toBe(false);
  });

  it('lists them in their sockets, and hides from a player what the collection keeps from players', () => {
    const token = { resources: { hp: { current: 4, max: 7 }, ac: { current: 0, max: 0 }, stress: { current: 0, max: 0 } } };
    const hidden = define('secret', { visibleToPlayers: false });
    const all = [HP, AC, STRESS, hidden];
    expect(visibleResources(token, all, 'dm').map(({ definition, slot }) => [definition.key, slot])).toEqual([['hp', 0], ['ac', 1]]);
    expect(visibleResources({ resources: { ...token.resources, secret: { current: 1, max: 1 } } }, all, 'dm').map(({ definition }) => definition.key)).toEqual(['hp', 'ac', 'secret']);
    expect(visibleResources({ resources: { ...token.resources, secret: { current: 1, max: 1 } } }, all, 'player').map(({ definition }) => definition.key)).toEqual(['hp', 'ac']);
    expect(visibleResources({}, all, 'dm')).toEqual([]);
  });

  it('puts a resource in the socket it names, the others in the first free ones, and drops past six', () => {
    const named = [define('a', { slot: 3 }), define('b'), define('c', { slot: 3 }), define('d')];
    const token = { resources: Object.fromEntries(['a', 'b', 'c', 'd'].map((key) => [key, { current: 1, max: 1 }])) };
    expect(visibleResources(token, named, 'dm').map(({ definition, slot }) => [definition.key, slot])).toEqual([['b', 0], ['c', 1], ['d', 2], ['a', 3]]);
    const seven = Array.from({ length: 7 }, (_, index) => define(`r${index}`));
    const full = { resources: Object.fromEntries(seven.map((definition) => [definition.key, { current: 1, max: 1 }])) };
    expect(visibleResources(full, seven, 'dm')).toHaveLength(6);
  });
});

describe('a static value of 0 on a token players see', () => {
  it('goes out as a bar with its number, as Atlas draws it (an AC of 0 is a number, not nothing)', () => {
    const token = { resources: { hp: { current: 7, max: 7 }, ac: { current: 0, max: 0 } } };
    const bars = projectBars(token, [HP, AC]);
    expect(bars).toHaveLength(2);
    expect(bars[1]).toMatchObject({ color: '#94a3b8', share: 1, spent: false, fixed: true, max: 0 });
  });

  it('still leaves out a bar that has no maximum', () => {
    expect(projectBars({ resources: { hp: { current: 0, max: 0 }, stress: { current: 0, max: 0 } } }, [HP, STRESS])).toEqual([]);
  });
});
