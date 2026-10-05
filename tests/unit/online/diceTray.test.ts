import { describe, expect, it } from 'vitest';
import { DiceTray } from '../../../src/app/online/page/diceTray';
import { MAX_MODIFIER } from '@atlas-vtt/shared/rules';
import { DICE_LIMITS } from '../../../src/app/online/tools/toolMessages';

describe("the join page dice tray (Atlas's tray rules)", () => {
  it("writes Atlas's tray formula, dice in ascending order whatever the picking order", () => {
    const tray = new DiceTray();
    expect(tray.formula()).toBe('');
    tray.add(20);
    tray.add(6);
    tray.add(6);
    tray.step(3);
    expect(tray.formula()).toBe('2d6 + 1d20 + 3');
    expect(tray.roll()).toEqual({ dice: { d6: 2, d20: 1 }, modifier: 3 });
  });

  it('holds at most the 20 dice the GM accepts, and a modifier within ±20', () => {
    const tray = new DiceTray();
    for (let i = 0; i < 25; i++) tray.add(6);
    expect(tray.total()).toBe(DICE_LIMITS.dicePerRoll);
    expect(tray.canAdd(4)).toBe(false);
    for (let i = 0; i < 30; i++) tray.step(-1);
    expect(tray.modifier).toBe(-MAX_MODIFIER);
  });

  it('takes one back, rolls nothing without dice, and clears dice and modifier', () => {
    const tray = new DiceTray();
    expect(tray.remove(8)).toBe(false);
    tray.add(8);
    expect(tray.remove(8)).toBe(true);
    tray.step(2);
    expect(tray.roll()).toBeNull();
    expect(tray.isEmpty()).toBe(false);
    tray.clear();
    expect(tray.isEmpty()).toBe(true);
  });
});
