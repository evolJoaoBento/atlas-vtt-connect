import { diceFormula, parseFormula, type DiceSelection } from '@atlas-vtt/shared/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { DiceHost } from '../../../src/app/online/tools/DiceHost';
import { DICE_LIMITS, isDiceModifier, isDiceSelection, playerRollFormula } from '../../../src/app/online/tools/toolMessages';

const ALL_KINDS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;

describe("the formulas Connect sends to Atlas's dice.roll", () => {
  it('fit its limits at the widest roll a player can send: 20 dice of every kind and a modifier of 1000', () => {
    const widest: DiceSelection = { d4: 3, d6: 3, d8: 3, d10: 3, d12: 3, d20: 3, d100: 2 };
    expect(isDiceSelection(widest)).toBe(true);
    for (const modifier of [DICE_LIMITS.modifier, -DICE_LIMITS.modifier, 0]) {
      const formula = playerRollFormula(widest, modifier);
      expect(formula).toBe(diceFormula(widest, modifier));
      expect(parseFormula(formula!).ok).toBe(true);
      expect(formula!.length).toBeLessThanOrEqual(64);
    }
    expect(playerRollFormula({ d20: DICE_LIMITS.dicePerRoll }, DICE_LIMITS.modifier)).toBe('20d20+1000');
  });

  it('fit for every single kind at 20 dice, and the limits stay inside Atlas: at most 100 dice, a modifier of four digits', () => {
    for (const die of ALL_KINDS) expect(playerRollFormula({ [die]: DICE_LIMITS.dicePerRoll }, -DICE_LIMITS.modifier)).not.toBeNull();
    expect(DICE_LIMITS.dicePerRoll).toBeLessThanOrEqual(100);
    expect(String(DICE_LIMITS.modifier)).toHaveLength(4);
  });

  it('are refused, as null, when Atlas would refuse them', () => {
    expect(playerRollFormula({ d6: 101 }, 0)).toBeNull();
    expect(playerRollFormula({ d6: 1 }, 10_000)).toBeNull();
    expect(playerRollFormula({ d6: 1 }, -10_000)).toBeNull();
  });

  it('are never made from a modifier the wire refuses', () => {
    expect(isDiceModifier(1001)).toBe(false);
    expect(isDiceModifier(-1001)).toBe(false);
    expect(isDiceModifier(10_000)).toBe(false);
  });
});

describe('DiceHost with a roll Atlas refuses', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function host(roll: () => never): DiceHost {
    return new DiceHost({
      session: { use: () => () => {}, send: () => {}, getPlayers: () => [] } as never,
      projection: { slotOf: () => null, shownSlot: () => null, scenesInUse: () => 0 },
      roll,
      feed: { subscribe: () => () => {}, publish: () => {} },
    });
  }
  const player = { playerId: 'p1', name: 'Anna', status: 'admitted' } as SessionPlayer;

  it('ignores a roll whose formula Atlas refuses by throwing, and tells the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roll = vi.fn(() => { throw new Error('Atlas does not roll that'); });
    expect(() => host(roll as never).onMessage(player, { v: 1, type: 'dice-roll', dice: { d6: 1 }, modifier: 0 })).not.toThrow();
    expect(roll).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not ask Atlas to roll a formula it would refuse, such as a modifier of five digits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roll = vi.fn();
    host(roll as never).onMessage(player, { v: 1, type: 'dice-roll', dice: { d6: 1 }, modifier: 10_000 });
    expect(roll).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('rolls the widest roll a player can send', () => {
    const roll = vi.fn();
    host(roll as never).onMessage(player, { v: 1, type: 'dice-roll', dice: { d4: 3, d6: 3, d8: 3, d10: 3, d12: 3, d20: 3, d100: 2 }, modifier: -1000 });
    expect(roll).toHaveBeenCalledWith(expect.objectContaining({ formula: '3d4+3d6+3d8+3d10+3d12+3d20+2d100-1000', rolledBy: 'Anna' }));
  });
});
