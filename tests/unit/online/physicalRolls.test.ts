import type { DiceRules } from '@atlas-vtt/api-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceHost } from '../../../src/app/online/tools/DiceHost';
import { critOf, offeredDiceRules, physicalRollResult, totalOf } from '../../../src/app/online/tools/physicalRolls';
import type { OfferedDiceRules, PhysicalDie, PhysicalRoll } from '../../../src/app/online/tools/toolMessages';
import { TAVERN_MAP } from './presentedFixtures';
import { toolsWorld } from './toolsFixtures';

const D20: OfferedDiceRules = { defaultRoll: '1d20', crit: 'natural' };
const roll = (rolls: PhysicalDie[], modifier = 0): PhysicalRoll => ({ rolls, modifier });
const die = (kind: PhysicalDie['die'], value: number, flags: Partial<PhysicalDie> = {}): PhysicalDie => ({ die: kind, value, ...flags });

describe('critOf and totalOf', () => {
  const rolled = (kind: string, value: number, max: number, flags: Record<string, true> = {}) => ({ die: kind, value, max, ...flags });

  it('reads the critical result from the default dice that count only', () => {
    expect(critOf(D20, [rolled('d20', 20, 20)])).toBe('success');
    expect(critOf(D20, [rolled('d20', 1, 20)])).toBe('failure');
    expect(critOf(D20, [rolled('d20', 20, 20, { dropped: true }), rolled('d20', 7, 20)])).toBeUndefined();
    expect(critOf(D20, [rolled('d6', 6, 6)])).toBeUndefined();
    expect(critOf({ defaultRoll: '1d100', crit: 'roll-under' }, [rolled('d100', 1, 100)])).toBe('success');
    expect(critOf({ defaultRoll: '2d12', crit: 'doubles' }, [rolled('d12', 5, 12), rolled('d12', 5, 12)])).toBe('success');
    expect(critOf({ defaultRoll: '2d10', crit: 'high-total' }, [rolled('d10', 10, 10), rolled('d10', 9, 10)])).toBe('success');
    expect(critOf({ defaultRoll: '1d20', crit: 'none' }, [rolled('d20', 20, 20)])).toBeUndefined();
  });

  it('adds the dice that count, subtracting negative ones, and the modifier', () => {
    expect(totalOf([rolled('d6', 4, 6), rolled('d6', 2, 6, { negative: true }), rolled('d6', 6, 6, { dropped: true })], 3)).toBe(5);
  });
});

describe('physicalRollResult', () => {
  it('builds the roll from the dice as thrown: max from the die, min 1, the formula, the total, the player named', () => {
    const result = physicalRollResult(roll([die('d6', 4), die('d6', 5)], 2), D20, 'Anna');
    expect(result).toMatchObject({
      formula: '2d6+2', modifiers: 2, total: 11, rolledBy: 'Anna', source: { type: 'toolbar', tokenName: 'Anna' },
      rolls: [{ die: 'd6', value: 4, max: 6, min: 1 }, { die: 'd6', value: 5, max: 6, min: 1 }],
    });
    expect(result.crit).toBeUndefined();
    expect(result.id).toMatch(/^\S{1,128}$/);
  });

  it('decides the crit itself, as Atlas logs it, whatever the player sent', () => {
    const sent = { ...roll([die('d20', 20)]), crit: 'low' } as PhysicalRoll;
    expect(physicalRollResult(sent, D20, 'Anna').crit).toBe('high');
    expect(physicalRollResult(roll([die('d20', 1)]), D20, 'Anna').crit).toBe('low');
  });

  it('keeps only the fields it knows: extra keys of the message or a die never reach Atlas', () => {
    const sent = { rolls: [{ ...die('d6', 3, { color: '#ff0000', colorName: 'Fi‮re' }), max: 99, total: 50 }], modifier: 0, total: 99, label: 'Fireball!' } as unknown as PhysicalRoll;
    const result = physicalRollResult(sent, D20, 'Anna');
    expect(result.rolls).toEqual([{ die: 'd6', value: 3, max: 6, min: 1, color: '#ff0000' }]);
    expect(result.total).toBe(3);
    expect(JSON.stringify(result)).not.toContain('Fireball');
    const tagged = physicalRollResult(roll([die('d6', 3, { colorName: ' Fire ' })]), D20, 'Anna');
    expect(tagged.rolls[0]).toMatchObject({ colorName: 'Fire' });
  });

  it('names the ability it is given, never the label the player sent', () => {
    const result = physicalRollResult({ ...roll([die('d20', 9)], 5), label: 'Instant win' }, D20, 'Anna', 'Dagger');
    expect(result.source).toEqual({ type: 'toolbar', tokenName: 'Anna', abilityName: 'Dagger' });
    expect(JSON.stringify(result)).not.toContain('Instant win');
  });

  it('leaves a dropped die out of the total and the formula, and refuses a roll of dropped dice only', () => {
    const result = physicalRollResult(roll([die('d20', 3, { dropped: true }), die('d20', 17)], 1), D20, 'Anna');
    expect(result.total).toBe(18);
    expect(result.formula).toBe('d20+1');
    expect(result.rolls[0]).toMatchObject({ dropped: true });
    expect(() => physicalRollResult(roll([die('d20', 3, { dropped: true }), die('d20', 17, { dropped: true })]), D20, 'Anna')).toThrow();
  });

  describe('explosions: taken as marked only where the rules explode that die on that value', () => {
    const SAVAGE: OfferedDiceRules = { defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } };
    const ONCE: OfferedDiceRules = { defaultRoll: '1d10', crit: 'none', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 1 } };

    it('takes an explosion thrown later in the list than the die it came from, and a repeating chain', () => {
      const chain = physicalRollResult(roll([die('d6', 6), die('d8', 3), die('d6', 6, { exploded: true }), die('d6', 2, { exploded: true })]), SAVAGE, 'Anna');
      expect(chain.total).toBe(17);
      expect(chain.formula).toBe('d6+d8');
      expect(chain.rolls.filter((rolled) => rolled.exploded)).toHaveLength(2);
    });

    it('takes a downward explosion, which subtracts', () => {
      const down = physicalRollResult(roll([die('d10', 1), die('d10', 4, { exploded: true, negative: true })]), ONCE, 'Anna');
      expect(down.total).toBe(-3);
    });

    it('refuses a mark the rules do not allow, a repeat they do not allow, and a die outside their scope', () => {
      // A d6 showing 5 does not explode.
      expect(() => physicalRollResult(roll([die('d6', 5), die('d6', 4, { exploded: true })]), SAVAGE, 'Anna')).toThrow();
      // Without any rule nothing explodes.
      expect(() => physicalRollResult(roll([die('d20', 20), die('d20', 4, { exploded: true })]), D20, 'Anna')).toThrow();
      // Once only: an explosion's die does not explode in turn.
      expect(() => physicalRollResult(roll([die('d10', 10), die('d10', 10, { exploded: true }), die('d10', 3, { exploded: true })]), ONCE, 'Anna')).toThrow();
      // Default dice only: a d6 is not the default d10.
      expect(() => physicalRollResult(roll([die('d6', 6), die('d6', 2, { exploded: true })]), ONCE, 'Anna')).toThrow();
      // An explosion before the die it came from, or of another kind.
      expect(() => physicalRollResult(roll([die('d6', 2, { exploded: true }), die('d6', 6)]), SAVAGE, 'Anna')).toThrow();
      expect(() => physicalRollResult(roll([die('d6', 6), die('d8', 2, { exploded: true })]), SAVAGE, 'Anna')).toThrow();
      // One explosion per die that exploded.
      expect(() => physicalRollResult(roll([die('d6', 6), die('d6', 2, { exploded: true }), die('d6', 3, { exploded: true })]), SAVAGE, 'Anna')).toThrow();
    });

    it('refuses a downward explosion that does not subtract, an upward one that does, and a negative die no explosion threw', () => {
      expect(() => physicalRollResult(roll([die('d10', 1), die('d10', 4, { exploded: true })]), ONCE, 'Anna')).toThrow();
      expect(() => physicalRollResult(roll([die('d10', 10), die('d10', 4, { exploded: true, negative: true })]), ONCE, 'Anna')).toThrow();
      expect(() => physicalRollResult(roll([die('d6', 4), die('d6', 5, { negative: true })]), D20, 'Anna')).toThrow();
    });

    it('a die dropped by advantage earns no explosion, and a dropped die marked exploded is refused', () => {
      expect(() => physicalRollResult(roll([die('d6', 6, { dropped: true }), die('d6', 4), die('d6', 2, { exploded: true })]), SAVAGE, 'Anna')).toThrow();
      expect(() => physicalRollResult(roll([die('d6', 6), die('d6', 2, { exploded: true, dropped: true }), die('d6', 3)]), SAVAGE, 'Anna')).toThrow();
    });

    it('does not ask for an explosion the throw never added (a roll stops adding dice at 20)', () => {
      expect(physicalRollResult(roll([die('d6', 6)]), SAVAGE, 'Anna').total).toBe(6);
    });
  });
});

describe('offeredDiceRules', () => {
  it('copies the rules field by field, and reads anything it cannot as the defaults', () => {
    const explode = { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0, extra: 1 };
    expect(offeredDiceRules({ defaultRoll: '2d6', crit: 'doubles', explode, other: 'x' })).toEqual({ defaultRoll: '2d6', crit: 'doubles', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } });
    expect(offeredDiceRules({ defaultRoll: '2d6', crit: 'sometimes' })).toEqual(D20);
    expect(offeredDiceRules(null)).toEqual(D20);
  });
});

describe("the GM takes a player's physical roll", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  type World = ReturnType<typeof toolsWorld>;
  const setDiceRules = (w: World, dice: DiceRules): void => { w.atlas.rules.saveCollection('c1', { maps: [TAVERN_MAP], dice }); };
  const send = (player: { sendRaw(text: string): void }, message: Record<string, unknown>): void => {
    player.sendRaw(JSON.stringify({ v: 1, type: 'dice-result', ...message }));
  };

  it("publishes a 2d6 result once, under the player's name, theirs in their log and nobody else's", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    send(a, { rolls: [die('d6', 2), die('d6', 5)], modifier: 1 });
    expect(w.logged).toHaveLength(1);
    expect(w.logged[0]).toMatchObject({ formula: '2d6+1', rolledBy: 'A', total: 8 });
    expect(w.logged[0]?.rolls.every((rolled) => (rolled as { min?: number }).min === 1)).toBe(true);
    expect(w.logs(a).at(-1)?.entries[0]).toMatchObject({ name: 'A', total: 8, mine: true });
    expect(w.logs(b).at(-1)?.entries[0]).toMatchObject({ name: 'A', total: 8 });
    expect(w.logs(b).at(-1)?.entries[0]?.mine).toBeUndefined();
    w.finish();
  });

  it('decides the crit by the collection\'s rules: a natural 20 on the default d20 is a success', async () => {
    const w = toolsWorld();
    setDiceRules(w, { defaultRoll: '1d20', crit: 'natural' });
    w.present();
    const a = await w.join('A');
    send(a, { rolls: [die('d20', 20)], modifier: 0 });
    expect(w.logged[0]?.crit).toBe('high');
    expect(w.logs(a).at(-1)?.entries[0]?.crit).toBe('high');
    w.finish();
  });

  it("judges explosions by the rules of the collection holding the player's map", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const exploding = { rolls: [die('d6', 6), die('d6', 3, { exploded: true })], modifier: 0 };
    send(a, exploding);
    expect(w.logged).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    setDiceRules(w, { defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } });
    send(a, exploding);
    expect(w.logged[0]?.total).toBe(9);
    w.finish();
  });

  it('takes at most two rolls a second from one player, dice-roll and dice-result together', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    for (let i = 0; i < 3; i++) send(a, { rolls: [die('d6', 3)], modifier: 0 });
    expect(w.logged).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    send(a, { rolls: [die('d6', 3)], modifier: 0 });
    send(a, { rolls: [die('d6', 3)], modifier: 0 });
    expect(w.logged).toHaveLength(4);
    w.finish();
  });

  it("names a sheet roll after the GM's own copy of the sheet, and publishes nothing for a sheet roll the GM cannot find", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const rollLabel = vi.fn((_player: unknown, tokenId: string) => (tokenId === 'hero' ? 'Dagger' : null));
    (w.dice as DiceHost).useSheets({ rollLabel });
    send(a, { rolls: [die('d20', 9)], modifier: 5, label: 'Instant win', sheet: { tokenId: 'hero', roll: { kind: 'check', index: 0 } } });
    expect(rollLabel).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }), 'hero', { kind: 'check', index: 0 });
    expect(w.logged[0]?.source?.abilityName).toBe('Dagger');
    expect(w.logs(a).at(-1)?.entries[0]).toMatchObject({ name: 'A: Dagger', ability: 'Dagger' });
    expect(JSON.stringify(a.received)).not.toContain('Instant win');
    vi.advanceTimersByTime(1000);
    send(a, { rolls: [die('d20', 9)], modifier: 5, sheet: { tokenId: 'ogre', roll: { kind: 'check', index: 0 } } });
    expect(w.logged).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    w.finish();
  });

  it('a result without a sheet carries no ability, whatever label it sent', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    send(a, { rolls: [die('d8', 4)], modifier: 0, label: 'Longsword' });
    expect(w.logged[0]?.source?.abilityName).toBeUndefined();
    expect(w.logs(a).at(-1)?.entries[0]?.name).toBe('A');
    w.finish();
  });
});
