import { describe, expect, it } from 'vitest';
import type { MapRules } from '@atlas-vtt/api-types';
import { readUserPreset, userPresetInitiative } from '../../../src/connect/stockPresets';
import { stockMapRules, type RulesView } from '../../../src/connect/stockRules';

const DEFAULTS = Object.freeze({
  collectionId: null, gridDefaults: null, measurement: {} as MapRules['measurement'],
  resources: Object.freeze([]), conditions: Object.freeze([]),
  initiative: Object.freeze({ mode: 'turn-order', roll: '1d20', firstSide: 'players' }),
  dice: Object.freeze({ defaultRoll: '1d20', crit: 'natural' }),
}) as MapRules;

const MAP = 'atlas-vtt/collections/Main/scenes/a.atlasmap';
const viewWith = (settings: Record<string, unknown>): RulesView => ({
  mapPath: () => null,
  serviceManager: { getAssetService: () => ({ getCollectionForMap: () => 'Main', getCollectionSettings: () => settings }) },
});

describe('the game system presets a stock Atlas collection follows (Atlas 0.21)', () => {
  it('reads a user preset file: its id and initiative rules, never a built-in id', () => {
    const file = (id: unknown, name: unknown, rules: unknown = {}): string => JSON.stringify({ format: 1, id, name, rules });
    expect(readUserPreset(file('p1', 'Mine', { initiative: { mode: 'sides' } }))).toEqual({ id: 'p1', initiative: { mode: 'sides' } });
    expect(readUserPreset(file('builtin:cairn', 'Copy'))).toBeNull();
    expect(readUserPreset(file('p2', ''))).toBeNull();
    expect(readUserPreset('{')).toBeNull();
    const byId = userPresetInitiative([
      { path: 'atlas-vtt/system-presets/z.json', text: file('same', 'Z', { initiative: { mode: 'cards' } }) },
      { path: 'atlas-vtt/system-presets/a.json', text: file('same', 'A', { initiative: { mode: 'sides' } }) },
    ]);
    expect(byId.get('same')).toEqual({ mode: 'sides' });
  });

  it('a collection without rules of its own plays by its preset\'s; its own come first', () => {
    const presetInitiative = (id: unknown): unknown => (id === 'mine' ? { mode: 'sides', roll: '1d20', firstSide: 'opponents' } : undefined);
    expect(stockMapRules([viewWith({ systemPresetId: 'mine' })], MAP, DEFAULTS, presetInitiative).initiative).toMatchObject({ mode: 'sides', firstSide: 'opponents' });
    expect(stockMapRules([viewWith({ systemPresetId: 'mine', initiative: { mode: 'cards', roll: '1d20', firstSide: 'players' } })], MAP, DEFAULTS, presetInitiative).initiative.mode).toBe('cards');
    expect(stockMapRules([viewWith({ systemPresetId: 'other' })], MAP, DEFAULTS, presetInitiative).initiative.mode).toBe('turn-order');
    expect(stockMapRules([viewWith({ systemPresetId: 'mine' })], MAP, DEFAULTS).initiative.mode).toBe('turn-order');
  });
});
