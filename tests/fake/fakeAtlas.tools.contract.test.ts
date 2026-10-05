import { persistableDiceLog, rollFormula } from '@atlas-vtt/shared/rules';
import type { DiceRollResult, LocalLaserEvent } from '@atlas-vtt/api-types';
import { describe, expect, it } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const MAP = 'maps/a.atlasmap';

/** Plays `values` to the dice in turn. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0.5;
}

/** A collection whose dice are one d6 that explodes on its highest face, with a natural critical rule. */
function atlasWithExplodingD6() {
  const atlas = new FakeAtlas({ capabilities: ['rules', 'dice'] });
  atlas.rules.saveCollection('c1', {
    maps: [MAP], dice: { defaultRoll: '1d6', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } },
  });
  return { atlas, dice: atlas.connect(connectingPlugin('atlas-vtt-connect')).dice };
}

// C-laser-2 (fading, and a sender silent for a second is let go) is drawn by Atlas: the fake has no drawing, and
// the vendored SOURCE.json lists no such case, so it has no ATLAS_ONLY entry either (the meta-test would reject one).
describe('FakeAtlas follows the dice and laser contract cases', () => {
  it('C-dice-1: roll uses the collection dice rules, sets rolledBy, reaches onRolled, and is not persisted', () => {
    const { atlas, dice } = atlasWithExplodingD6();
    const seen: DiceRollResult[] = [];
    dice.onRolled((result) => seen.push(result));
    // 2d6: the first die shows a 6 and explodes into a 1, the second die shows a 3 (floor(0.4 × 6) + 1 = 3).
    atlas.dice.setRandom(sequence(0.99, 0, 0.4));
    const result = dice.roll({ formula: '2d6+1', mapPath: MAP, rolledBy: 'Ana' });
    expect(result.rolledBy).toBe('Ana');
    expect(result.formula).toBe('2d6+1');
    expect(result.rolls.map((die) => [die.value, die.exploded === true])).toEqual([[6, false], [1, true], [3, false]]);
    expect(result.total).toBe(6 + 1 + 3 + 1);
    expect(result.crit).toBe('high');
    expect(seen).toEqual([result]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(persistableDiceLog([result])).toEqual([]);
  });

  it('C-dice-1: outside a collection nothing explodes, and a bonus is added to the default roll', () => {
    const { atlas, dice } = atlasWithExplodingD6();
    atlas.dice.setRandom(sequence(0.99));
    const outside = dice.roll({ formula: '1d6', mapPath: 'maps/loose.atlasmap' });
    expect(outside.rolls).toHaveLength(1);
    expect(outside.rolledBy).toBeUndefined();
    atlas.dice.setRandom(sequence(0.5));
    const bonus = dice.roll({ formula: '+3', mapPath: MAP });
    expect(bonus.formula).toBe('1d6+3');
    expect(bonus.total).toBe(4 + 3);
  });

  it('C-dice-1: roll checks its request, and a roll shown to onRolled listeners is a copy that stops with the disposer', () => {
    const { dice } = atlasWithExplodingD6();
    for (const bad of [null, {}, { formula: 4 }, { formula: '1d4', rolledBy: 3 }, { formula: '1d4', mapPath: 3 }]) {
      expect(() => dice.roll(bad as never)).toThrow('[Atlas API] roll needs');
    }
    const seen: DiceRollResult[] = [];
    dice.onRolled((result) => seen.push(result))();
    dice.roll({ formula: '1d6' });
    expect(seen).toEqual([]);
  });

  it('C-dice-2: publish adds a roll made elsewhere without re-rolling it', () => {
    const { dice } = atlasWithExplodingD6();
    const seen: DiceRollResult[] = [];
    dice.onRolled((result) => seen.push(result));
    const made = rollFormula('1d20', () => 0.5, 1);
    dice.publish(made);
    expect(seen).toEqual([made]);
    expect(() => dice.publish({ formula: '1d20' } as unknown as DiceRollResult)).toThrow('[Atlas API] publish needs a roll');
  });

  it('C-laser-1: onLocal hears points and the lift; show reaches the remote layer; unknown views are harmless', () => {
    const atlas = new FakeAtlas({ capabilities: ['views', 'lasers'] });
    atlas.views.open('v1');
    const { lasers } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    const events: LocalLaserEvent[] = [];
    const stop = lasers.onLocal('v1', (event) => events.push(event));
    atlas.lasers.emitLocal('v1', { kind: 'point', x: 1, y: 2 });
    atlas.lasers.emitLocal('v1', { kind: 'lift' });
    expect(events).toEqual([{ kind: 'point', x: 1, y: 2 }, { kind: 'lift' }]);
    stop();
    atlas.lasers.emitLocal('v1', { kind: 'lift' });
    expect(events).toHaveLength(2);
    lasers.show('v1', { from: 'ana', color: '#f00000', points: [{ x: 0, y: 0 }], lifted: false });
    expect(atlas.lasers.shown('v1')).toEqual([{ from: 'ana', color: '#f00000', points: [{ x: 0, y: 0 }], lifted: false }]);
    expect(() => lasers.show('nope', { from: 'ana', color: '#f00000', points: [], lifted: true })).not.toThrow();
    lasers.onLocal('nope', () => undefined)();
    expect(atlas.lasers.shown('nope')).toEqual([]);
  });

  it('C-laser-1: onLocal ends when the view closes or the extension unloads; show refuses a malformed laser and keeps the newest 64 points', () => {
    const atlas = new FakeAtlas({ capabilities: ['views', 'lasers'] });
    atlas.views.open('v1');
    const plugin = connectingPlugin('atlas-vtt-connect');
    const { lasers } = atlas.connect(plugin);
    lasers.onLocal('v1', () => undefined);
    expect(atlas.lasers.listening('v1')).toBe(1);
    atlas.views.close('v1');
    expect(atlas.lasers.listening('v1')).toBe(0);
    atlas.views.open('v2');
    lasers.onLocal('v2', () => undefined);
    plugin.unload();
    expect(atlas.lasers.listening('v2')).toBe(0);
    const again = atlas.connect(connectingPlugin('atlas-vtt-connect')).lasers;
    expect(() => again.show('v2', { from: '', color: '#f00000', points: [], lifted: false })).toThrow(/from/);
    expect(() => again.show('v2', { from: 'a', color: 'red', points: [], lifted: false })).toThrow(/color/);
    expect(() => again.show('v2', { from: 'a', color: '#f00000', points: [{ x: Number.NaN, y: 0 }], lifted: false })).toThrow(/points/);
    const points = Array.from({ length: 200 }, (_, index) => ({ x: index, y: 0 }));
    again.show('v2', { from: 'a', color: '#f00000', points, lifted: false });
    expect(atlas.lasers.shown('v2')[0]?.points).toHaveLength(64);
    expect(atlas.lasers.shown('v2')[0]?.points.at(-1)).toEqual({ x: 199, y: 0 });
  });
});
