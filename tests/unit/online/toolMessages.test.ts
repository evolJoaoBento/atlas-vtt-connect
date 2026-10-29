import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { diceLogEntry, isDiceLogEntry, type DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';

const valid = (message: object): boolean => decodeControl(JSON.stringify(message)).kind === 'message';
const entry = (overrides: Partial<DiceLogEntry> = {}): DiceLogEntry => ({
  id: 'roll_1', name: 'Anna', formula: '2d6+1', dice: [{ die: 'd6', value: 4 }, { die: 'd6', value: 6 }], modifier: 1, total: 11, at: 5,
  ...overrides,
});
const laser = (overrides: object = {}): object => ({ v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: false, ...overrides });

describe('player tool messages', () => {
  it('round-trips a roll, a dice log and a laser either way', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'dice-roll', dice: { d6: 2, d20: 1 }, modifier: -3 },
      { v: 1, type: 'dice-log', entries: [entry()], replay: true },
      { v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: true },
      { v: 1, type: 'laser', from: 'gm', sceneId: 'scene-1', points: [], lifted: false },
    ];
    for (const message of messages) expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it('holds a roll to 1 to 20 known dice and a whole modifier within 1000', () => {
    const roll = (dice: object, modifier: unknown = 0): boolean => valid({ v: 1, type: 'dice-roll', dice, modifier });
    expect(roll({ d20: 20 })).toBe(true);
    expect(roll({ d4: 10, d100: 10 }, 1000)).toBe(true);
    expect(roll({ d6: 1 }, -1000)).toBe(true);
    expect(roll({ d20: 21 })).toBe(false);
    expect(roll({ d6: 10, d8: 11 })).toBe(false);
    expect(roll({})).toBe(false);
    expect(roll({ d6: 0 })).toBe(false);
    expect(roll({ d3: 1 })).toBe(false);
    expect(roll({ d6: 1.5 })).toBe(false);
    expect(roll({ d6: -1, d8: 2 })).toBe(false);
    expect(roll({ d6: 1 }, 1001)).toBe(false);
    expect(roll({ d6: 1 }, 0.5)).toBe(false);
    expect(roll({ d6: 1 }, '2')).toBe(false);
    expect(decodeControl('{"v":1,"type":"dice-roll","dice":{"__proto__":1},"modifier":0}').kind).toBe('invalid');
  });

  it('holds dice log entries to their limits', () => {
    const log = (entries: unknown[], replay: unknown = false): boolean => valid({ v: 1, type: 'dice-log', entries, replay });
    expect(log([])).toBe(true);
    expect(log(Array.from({ length: 50 }, (_, i) => entry({ id: `r${i}` })))).toBe(true);
    expect(log(Array.from({ length: 51 }, (_, i) => entry({ id: `r${i}` })))).toBe(false);
    expect(log([entry()], 'yes')).toBe(false);
    expect(log([entry({ name: '' })])).toBe(false);
    expect(log([entry({ name: 'x'.repeat(81) })])).toBe(false);
    expect(log([entry({ formula: 'd6+'.repeat(70) })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'd6', value: 7 }] })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'd6', value: 0 }] })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'x6', value: 1 }] })])).toBe(false);
    expect(log([entry({ dice: Array.from({ length: 101 }, () => ({ die: 'd6', value: 1 })) })])).toBe(false);
    expect(log([entry({ total: Number.POSITIVE_INFINITY })])).toBe(false);
    expect(log([entry({ id: '__proto__' })])).toBe(false);
  });

  it('takes the flags of a logged die, the crit, the unlisted count and mine only in their own shapes', () => {
    const log = (overrides: object): boolean => valid({ v: 1, type: 'dice-log', entries: [{ ...entry(), ...overrides }], replay: false });
    const dice = (flags: object): object => ({ dice: [{ die: 'd6', value: 6, ...flags }] });
    expect(log(dice({ exploded: true, negative: true }))).toBe(true);
    expect(log(dice({ exploded: false }))).toBe(false);
    expect(log(dice({ negative: 1 }))).toBe(false);
    expect(log({ crit: 'high' })).toBe(true);
    expect(log({ crit: 'low' })).toBe(true);
    expect(log({ crit: null })).toBe(false);
    expect(log({ crit: 'max' })).toBe(false);
    expect(log({ unlisted: 50 })).toBe(true);
    expect(log({ unlisted: 0 })).toBe(false);
    expect(log({ unlisted: 1.5 })).toBe(false);
    expect(log({ mine: true })).toBe(true);
    expect(log({ mine: 'yes' })).toBe(false);
  });

  it('holds a laser to 64 points in range, and checks the from of a relayed one', () => {
    expect(valid(laser({ points: Array.from({ length: 64 }, () => ({ x: 0, y: 0 })) }))).toBe(true);
    expect(valid(laser({ points: Array.from({ length: 65 }, () => ({ x: 0, y: 0 })) }))).toBe(false);
    expect(valid(laser({ points: [{ x: 10_000_001, y: 0 }] }))).toBe(false);
    expect(valid(laser({ points: [{ x: 'a', y: 0 }] }))).toBe(false);
    expect(valid(laser({ lifted: 'no' }))).toBe(false);
    expect(valid(laser({ sceneId: '' }))).toBe(false);
    expect(valid(laser({ from: '' }))).toBe(false);
    expect(valid(laser({ from: 'p1' }))).toBe(true);
  });

  it('checks the point times of a laser: none, or one gap from 0 to 2 seconds per point', () => {
    expect(valid(laser({ dt: [0] }))).toBe(true);
    expect(valid(laser({ points: [], dt: [] }))).toBe(true);
    expect(valid(laser({ dt: [2000] }))).toBe(true);
    expect(valid(laser({ dt: [2001] }))).toBe(false);
    expect(valid(laser({ dt: [-1] }))).toBe(false);
    expect(valid(laser({ dt: ['5'] }))).toBe(false);
    expect(valid(laser({ dt: [null] }))).toBe(false);
    expect(valid(laser({ dt: [0, 0] }))).toBe(false);
    expect(valid(laser({ dt: {} }))).toBe(false);
    expect(valid(laser({ dt: null }))).toBe(false);
    expect(valid(laser({ dt: 5 }))).toBe(false);
  });

  it('lets admitted players send rolls and lasers, never dice logs', () => {
    expect(PLAYER_MESSAGE_TYPES.has('dice-roll')).toBe(true);
    expect(PLAYER_MESSAGE_TYPES.has('laser')).toBe(true);
    expect(PLAYER_MESSAGE_TYPES.has('dice-log')).toBe(false);
  });
});

describe('diceLogEntry', () => {
  const result: DiceRollResult = {
    id: 'roll_1', timestamp: 5, formula: '2d6+1', modifiers: 1, total: 11,
    rolls: [{ die: 'd6', value: 4, max: 6 }, { die: 'd6', value: 6, max: 6 }],
  };

  it('lists each die, the modifier and the total under the given name', () => {
    expect(diceLogEntry(result, 'Anna')).toEqual(entry());
  });

  it('clips what a large GM roll would make too long, and keeps its total', () => {
    const big = { ...result, formula: 'd6+'.repeat(100), rolls: Array.from({ length: 150 }, () => ({ die: 'd6', value: 3, max: 6 })), total: 450 };
    const logged = diceLogEntry(big, 'x'.repeat(90));
    expect(logged?.dice).toHaveLength(100);
    expect(logged?.unlisted).toBe(50);
    expect(logged?.formula).toHaveLength(200);
    expect(logged?.name).toHaveLength(80);
    expect(logged?.total).toBe(450);
  });

  it('counts the dice a roll made elsewhere already left out of its own list as more', () => {
    expect(diceLogEntry({ ...result, unlistedDice: 7 }, 'Anna')).toMatchObject({ unlisted: 7 });
    const big = { ...result, rolls: Array.from({ length: 150 }, () => ({ die: 'd6', value: 3, max: 6 })), unlistedDice: 7 };
    expect(diceLogEntry(big, 'Anna')?.unlisted).toBe(57);
    for (const bad of [0, -3, 1.5, Number.NaN]) expect(diceLogEntry({ ...result, unlistedDice: bad }, 'Anna')).toEqual(entry());
  });

  it('keeps exploded and subtracted dice in their order, with the crit', () => {
    const rolls = [
      { die: 'd6', value: 6, max: 6 }, { die: 'd6', value: 2, max: 6, exploded: true as const }, { die: 'd4', value: 1, max: 4, negative: true as const },
    ];
    expect(diceLogEntry({ ...result, rolls, crit: 'high' }, 'Anna')).toEqual(entry({
      dice: [{ die: 'd6', value: 6 }, { die: 'd6', value: 2, exploded: true }, { die: 'd4', value: 1, negative: true }], crit: 'high',
    }));
    expect(diceLogEntry({ ...result, crit: null }, 'Anna')).toEqual(entry());
  });

  it('lists no dice of a roll with a die players cannot take, and counts them unlisted', () => {
    const logged = diceLogEntry({ ...result, rolls: [...result.rolls, { die: 'd20000', value: 5, max: 20000 }] }, 'Anna');
    expect(logged).toMatchObject({ dice: [], unlisted: 3, total: 11 });
  });

  it('makes no entry of a roll players would refuse', () => {
    expect(diceLogEntry({ ...result, total: Number.NaN }, 'Anna')).toBeNull();
  });
});

describe("dice as Atlas 0.8's notation rolls them: Fate dice, rerolls and success counts", () => {
  const roll = (rolls: unknown[], extra: Record<string, unknown> = {}): DiceRollResult =>
    ({ id: 'roll_f', timestamp: 9, formula: '4dF', modifiers: 0, total: 1, rolls, ...extra }) as unknown as DiceRollResult;

  it('lists Fate dice, which read -1, 0 or +1, as the dice they are', () => {
    const logged = diceLogEntry(roll([{ die: 'dF', value: 1, max: 1, min: -1 }, { die: 'dF', value: -1, max: 1, min: -1 }, { die: 'dF', value: 0, max: 1, min: -1 }]), 'GM')!;
    expect(logged.dice).toEqual([{ die: 'dF', value: 1 }, { die: 'dF', value: -1 }, { die: 'dF', value: 0 }]);
    expect(logged.unlisted).toBeUndefined();
    expect(isDiceLogEntry(logged)).toBe(true);
  });

  it('refuses a Fate die that reads outside -1 to 1, and a die that is neither a Fate die nor a dN', () => {
    const entryWith = (die: unknown) => ({ ...diceLogEntry(roll([{ die: 'd6', value: 3, max: 6 }]), 'GM')!, dice: [die] });
    expect(isDiceLogEntry(entryWith({ die: 'dF', value: 2 }))).toBe(false);
    expect(isDiceLogEntry(entryWith({ die: 'dF', value: 0.5 }))).toBe(false);
    expect(isDiceLogEntry(entryWith({ die: 'dX', value: 1 }))).toBe(false);
    expect(isDiceLogEntry(entryWith({ die: 'd6', value: 0 }))).toBe(false);
  });

  it('carries the marks that strike a die through or count it, and nothing else Atlas may put on one', () => {
    const logged = diceLogEntry(roll([
      { die: 'd10', value: 3, max: 10, rerolled: true }, { die: 'd10', value: 9, max: 10, success: true },
      { die: 'd10', value: 2, max: 10, failure: true }, { die: 'd10', value: 7, max: 10, dropped: true }, { die: 'd10', value: 5, max: 10, success: false, label: 'Fire' },
    ]), 'GM')!;
    expect(logged.dice).toEqual([
      { die: 'd10', value: 3, rerolled: true }, { die: 'd10', value: 9, success: true },
      { die: 'd10', value: 2, failure: true }, { die: 'd10', value: 7, dropped: true }, { die: 'd10', value: 5 },
    ]);
    expect(isDiceLogEntry(logged)).toBe(true);
    // A mark must be exactly true, as Atlas sends it.
    expect(isDiceLogEntry({ ...logged, dice: [{ die: 'd10', value: 3, rerolled: 'yes' }] })).toBe(false);
    expect(isDiceLogEntry({ ...logged, dice: [{ die: 'd10', value: 3, success: false }] })).toBe(false);
  });
});
